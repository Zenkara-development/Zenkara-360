/**
 * RAG / knowledge engine — chunking, indexing, permission-aware retrieval.
 *
 * ── The pgvector decision ─────────────────────────────────────────────────
 * Embeddings live in `KnowledgeChunk.embedding Float[]` (Postgres
 * `double precision[]`), which Prisma types natively and which works on every
 * managed Postgres, including ones where you cannot `CREATE EXTENSION vector`.
 *
 * On boot we probe once for pgvector. If it's there we maintain a shadow
 * `embedding_vec vector` column plus an ivfflat index and let Postgres do the
 * ANN search; if it isn't, we narrow candidates in SQL (org + visibility +
 * permission) and compute cosine in Node over that bounded set. Same function
 * signature either way, so the fallback is a performance characteristic, never
 * a behavioral difference — and an org can gain pgvector later with a backfill
 * rather than a code change.
 *
 * ── Permission-aware retrieval ────────────────────────────────────────────
 * The point of §43 that is easy to get wrong: retrieval must filter BEFORE
 * ranking, not after. Ranking first and then dropping forbidden chunks leaks
 * information through the shape of the result (you learn a document exists,
 * and roughly how relevant it is, without being allowed to read it) and
 * quietly degrades answer quality for restricted users. Every query here
 * takes a PermCtx and folds it into the SQL predicate.
 */
import { prisma } from './prisma';
import { embed } from './aiGateway';
import type { PermCtx } from './permissions';
import { scopeFor } from './permissions';

// ─── Chunking ─────────────────────────────────────────────────────────────────

export interface Chunk {
  content: string;
  index: number;
  heading?: string;
  tokenCount: number;
}

/** Cheap token estimate. Good enough for budgeting chunk size; we don't ship a tokenizer for this. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Splits text into overlapping chunks on natural boundaries.
 *
 * Overlap matters: a fact that straddles a chunk edge is otherwise
 * unretrievable, because neither chunk contains enough of it to match the
 * query. 15% is the usual sweet spot between recall and storage.
 *
 * Markdown headings are tracked and attached to each chunk so a retrieved
 * fragment can cite "Leave Policy → Section 4.2" (§117) rather than a bare
 * document name.
 */
export function chunkText(text: string, maxTokens = 400, overlapRatio = 0.15): Chunk[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const maxChars = maxTokens * 4;
  const overlapChars = Math.floor(maxChars * overlapRatio);

  const paragraphs = clean.split(/\n{2,}/);
  const chunks: Chunk[] = [];
  let buffer = '';
  let heading: string | undefined;
  let index = 0;

  const flush = () => {
    const content = buffer.trim();
    if (!content) return;
    chunks.push({ content, index: index++, heading, tokenCount: estimateTokens(content) });
    buffer = overlapChars > 0 ? content.slice(-overlapChars) : '';
  };

  for (const para of paragraphs) {
    const h = para.match(/^#{1,6}\s+(.+)$/m);
    if (h) heading = h[1].trim();

    if (buffer.length + para.length + 2 > maxChars) {
      flush();
      // A single paragraph longer than the window gets hard-split on
      // sentence boundaries rather than mid-word.
      if (para.length > maxChars) {
        const sentences = para.split(/(?<=[.!?])\s+/);
        for (const s of sentences) {
          if (buffer.length + s.length + 1 > maxChars) flush();
          buffer += (buffer ? ' ' : '') + s;
        }
        continue;
      }
    }
    buffer += (buffer ? '\n\n' : '') + para;
  }
  flush();

  return chunks;
}

function sha256(text: string): string {
  // Local require keeps node:crypto out of the module's import surface for
  // callers that only want chunkText().
  return require('crypto').createHash('sha256').update(text).digest('hex');
}

// ─── pgvector probe ───────────────────────────────────────────────────────────

let pgvectorAvailable: boolean | null = null;

/**
 * Detects pgvector once per process. Cached because it's consulted on every
 * search and the answer cannot change without a redeploy of the database.
 */
export async function hasPgVector(): Promise<boolean> {
  if (pgvectorAvailable !== null) return pgvectorAvailable;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS exists`
    );
    pgvectorAvailable = !!rows[0]?.exists;
  } catch (err) {
    /* Deliberately NOT cached. A transient error here (connection blip during
       boot, a pool timeout) used to pin this process to `false` for its whole
       lifetime, silently downgrading every subsequent search to the slow
       in-Node path with no way to recover short of a restart. Returning false
       without caching means the next search re-probes. */
    console.error('[rag] pgvector probe failed, will retry on next search', err);
    return false;
  }
  if (pgvectorAvailable) {
    console.log('[rag] pgvector detected — using ANN search');
  } else {
    console.log('[rag] pgvector not available — using in-process cosine fallback');
  }
  return pgvectorAvailable;
}

/**
 * Creates the shadow vector column + ivfflat index when pgvector exists.
 * Idempotent; safe to call on every boot. Silently no-ops without the
 * extension, which is the whole point of the fallback design.
 */
export async function ensureVectorIndex(dim = 1536): Promise<void> {
  if (!(await hasPgVector())) return;
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_vec vector(${dim})`
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_vec_idx
         ON knowledge_chunks USING ivfflat (embedding_vec vector_cosine_ops) WITH (lists = 100)`
    );
  } catch (err) {
    console.error('[rag] could not prepare pgvector index; falling back', err);
    pgvectorAvailable = false;
  }
}

async function syncShadowVector(chunkId: string, vector: number[]): Promise<void> {
  if (!(await hasPgVector())) return;
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE knowledge_chunks SET embedding_vec = $1::vector WHERE id = $2`,
      `[${vector.join(',')}]`,
      chunkId
    );
  } catch {
    /* non-fatal: Float[] remains the source of truth */
  }
}

// ─── Indexing ─────────────────────────────────────────────────────────────────

export interface IndexInput {
  orgId: string;
  title: string;
  content: string;
  sourceId?: string;
  entityType?: string;
  entityId?: string;
  url?: string;
  visibility?: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';
  allowedRoleKeys?: string[];
  allowedDepartmentIds?: string[];
  requiredPermission?: string;
  metadata?: Record<string, unknown>;
}

export interface IndexResult {
  documentId: string;
  chunkCount: number;
  skipped: boolean;
  costUsd: number;
}

/**
 * Indexes one document. Re-indexing an unchanged document is a no-op via the
 * content hash — which is what makes it safe to call this from a nightly
 * sweep over every KB article and ticket without re-embedding the world (and
 * re-paying for it) each night.
 */
export async function indexDocument(input: IndexInput): Promise<IndexResult> {
  const contentHash = sha256(input.content);

  const existing =
    input.entityType && input.entityId
      ? await prisma.knowledgeDocument.findFirst({
          where: { orgId: input.orgId, entityType: input.entityType, entityId: input.entityId },
        })
      : null;

  if (existing && existing.contentHash === contentHash && existing.indexedAt) {
    return { documentId: existing.id, chunkCount: 0, skipped: true, costUsd: 0 };
  }

  const chunks = chunkText(input.content);
  if (!chunks.length) {
    return { documentId: existing?.id ?? '', chunkCount: 0, skipped: true, costUsd: 0 };
  }

  const { vectors, model, dim, costUsd } = await embed(
    input.orgId,
    chunks.map(c => (c.heading ? `${c.heading}\n\n${c.content}` : c.content))
  );

  const doc = existing
    ? await prisma.knowledgeDocument.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          url: input.url,
          contentHash,
          version: { increment: 1 },
          visibility: input.visibility ?? 'INTERNAL',
          allowedRoleKeys: input.allowedRoleKeys ?? [],
          allowedDepartmentIds: input.allowedDepartmentIds ?? [],
          requiredPermission: input.requiredPermission ?? null,
          tokenCount: chunks.reduce((n, c) => n + c.tokenCount, 0),
          indexedAt: new Date(),
          isActive: true,
          metadata: (input.metadata as any) ?? undefined,
        },
      })
    : await prisma.knowledgeDocument.create({
        data: {
          orgId: input.orgId,
          sourceId: input.sourceId ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          title: input.title,
          url: input.url,
          contentHash,
          visibility: input.visibility ?? 'INTERNAL',
          allowedRoleKeys: input.allowedRoleKeys ?? [],
          allowedDepartmentIds: input.allowedDepartmentIds ?? [],
          requiredPermission: input.requiredPermission ?? null,
          tokenCount: chunks.reduce((n, c) => n + c.tokenCount, 0),
          indexedAt: new Date(),
          metadata: (input.metadata as any) ?? undefined,
        },
      });

  // Replace wholesale rather than diff: chunk boundaries shift when content
  // changes, so index N of the old version rarely corresponds to index N of
  // the new one and a partial update would leave orphaned text retrievable.
  /* Delete-then-insert runs in ONE transaction.
     Previously the new contentHash was written to the document first, then
     chunks were deleted and recreated in a bare loop. A crash or timeout
     partway through left a document whose hash matched its content but whose
     chunks were missing or partial — and because indexDocument short-circuits
     on a hash match, every future reindex skipped it. The document became
     permanently unsearchable with no error anywhere. */
  const createdIds = await prisma.$transaction(async tx => {
    await tx.knowledgeChunk.deleteMany({ where: { documentId: doc.id } });
    const ids: Array<{ id: string; vector: number[] }> = [];
    for (let i = 0; i < chunks.length; i++) {
      const created = await tx.knowledgeChunk.create({
        data: {
          orgId: input.orgId,
          documentId: doc.id,
          chunkIndex: chunks[i].index,
          content: chunks[i].content,
          heading: chunks[i].heading ?? null,
          tokenCount: chunks[i].tokenCount,
          embedding: vectors[i] ?? [],
          embeddingModel: model,
          embeddingDim: dim,
          visibility: input.visibility ?? 'INTERNAL',
        },
        select: { id: true },
      });
      if (vectors[i]) ids.push({ id: created.id, vector: vectors[i] });
    }
    return ids;
  });

  /* The shadow pgvector column is an optimisation, not the source of truth
     (KnowledgeChunk.embedding is), so it is synced outside the transaction —
     a failure here degrades search speed, never correctness. */
  for (const { id, vector } of createdIds) await syncShadowVector(id, vector);

  return { documentId: doc.id, chunkCount: chunks.length, skipped: false, costUsd };
}

export async function removeDocument(orgId: string, entityType: string, entityId: string): Promise<void> {
  await prisma.knowledgeDocument.deleteMany({ where: { orgId, entityType, entityId } });
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  title: string;
  heading: string | null;
  content: string;
  url: string | null;
  entityType: string | null;
  entityId: string | null;
  score: number;
}

function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * The permission predicate, as a Prisma where-fragment.
 *
 * A document is visible when ALL hold:
 *   - it's in the caller's org and active
 *   - PUBLIC, or the caller holds any role (INTERNAL), or the caller's role
 *     key / department is explicitly listed (RESTRICTED)
 *   - if requiredPermission is set, the caller actually holds it
 */
function visibilityWhere(ctx: PermCtx): Record<string, unknown> {
  return {
    orgId: ctx.orgId,
    isActive: true,
    OR: [
      { visibility: 'PUBLIC' },
      { visibility: 'INTERNAL' },
      {
        visibility: 'RESTRICTED',
        OR: [
          { allowedRoleKeys: { has: ctx.roleKey } },
          ...(ctx.departmentId ? [{ allowedDepartmentIds: { has: ctx.departmentId } }] : []),
        ],
      },
    ],
  };
}

function permittedDoc(ctx: PermCtx, requiredPermission: string | null): boolean {
  if (!requiredPermission) return true;
  return scopeFor(ctx, requiredPermission) !== 'NONE';
}

export interface SearchOptions {
  limit?: number;
  minScore?: number;
  entityTypes?: string[];
}

/**
 * Semantic search over the org's knowledge, filtered to what this caller may
 * see before anything is ranked.
 */
export async function search(
  ctx: PermCtx,
  query: string,
  opts: SearchOptions = {}
): Promise<RetrievedChunk[]> {
  const limit = opts.limit ?? 8;
  const minScore = opts.minScore ?? 0.15;

  const { vectors } = await embed(ctx.orgId, [query], 'rag.search');
  const qv = vectors[0];
  if (!qv?.length) return [];

  const docWhere: Record<string, unknown> = {
    ...visibilityWhere(ctx),
    ...(opts.entityTypes?.length ? { entityType: { in: opts.entityTypes } } : {}),
  };

  const docs = await prisma.knowledgeDocument.findMany({
    where: docWhere,
    select: {
      id: true,
      title: true,
      url: true,
      entityType: true,
      entityId: true,
      requiredPermission: true,
    },
  });

  const allowed = docs.filter(d => permittedDoc(ctx, d.requiredPermission));
  if (!allowed.length) return [];

  const byId = new Map(allowed.map(d => [d.id, d]));
  const allowedIds = [...byId.keys()];

  if (await hasPgVector()) {
    try {
      const rows = await prisma.$queryRawUnsafe<
        Array<{ id: string; document_id: string; content: string; heading: string | null; score: number }>
      >(
        `SELECT id, document_id, content, heading,
                1 - (embedding_vec <=> $1::vector) AS score
           FROM knowledge_chunks
          WHERE org_id = $2
            AND document_id = ANY($3::text[])
            AND embedding_vec IS NOT NULL
          ORDER BY embedding_vec <=> $1::vector
          LIMIT $4`,
        `[${qv.join(',')}]`,
        ctx.orgId,
        allowedIds,
        limit
      );

      return rows
        .filter(r => r.score >= minScore)
        .map(r => {
          const d = byId.get(r.document_id)!;
          return {
            chunkId: r.id,
            documentId: r.document_id,
            title: d.title,
            heading: r.heading,
            content: r.content,
            url: d.url,
            entityType: d.entityType,
            entityId: d.entityId,
            score: Math.round(r.score * 1000) / 1000,
          };
        });
    } catch (err) {
      console.error('[rag] pgvector search failed, using fallback', err);
    }
  }

  // Fallback: score in Node over the permitted candidate set. Bounded by
  // CANDIDATE_CAP so a large tenant can't turn one search into a full scan.
  const CANDIDATE_CAP = 2000;
  /* orderBy matters: without it Postgres returns an arbitrary 2000 rows, so
     the same query could score a different subset each time and silently lose
     recall on a large tenant. Newest-first at least makes the truncation
     predictable and biased toward current material. */
  const chunks = await prisma.knowledgeChunk.findMany({
    where: { orgId: ctx.orgId, documentId: { in: allowedIds } },
    select: { id: true, documentId: true, content: true, heading: true, embedding: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: CANDIDATE_CAP,
  });

  return chunks
    .map(c => {
      const d = byId.get(c.documentId)!;
      return {
        chunkId: c.id,
        documentId: c.documentId,
        title: d.title,
        heading: c.heading,
        content: c.content,
        url: d.url,
        entityType: d.entityType,
        entityId: d.entityId,
        score: Math.round(cosine(qv, c.embedding) * 1000) / 1000,
      };
    })
    .filter(c => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ─── Answering ────────────────────────────────────────────────────────────────

export interface RagAnswer {
  answer: string;
  citations: Array<{ documentId: string; title: string; heading: string | null; url: string | null; score: number }>;
  confidence: number;
  logId: string | null;
  /** True when nothing relevant was retrieved and no model call was made. */
  noContext: boolean;
}

const ANSWER_SYSTEM = `You answer questions using ONLY the numbered context passages provided.

Rules:
- If the context does not contain the answer, say exactly: "I could not find this in the available company information." Do not use outside knowledge.
- Cite the passage numbers you used inline, like [1] or [2][3].
- Be concise and factual. Do not speculate.
- If passages conflict, say so and cite both.`;

/**
 * Retrieval-augmented answer with citations (§43, §117).
 *
 * Returns early with `noContext` rather than calling the model when nothing
 * clears the relevance floor — an LLM given zero context will confabulate,
 * and paying for it makes that worse.
 */
export async function answer(ctx: PermCtx, question: string, opts: SearchOptions = {}): Promise<RagAnswer> {
  const { complete } = await import('./aiGateway');
  const hits = await search(ctx, question, { ...opts, limit: opts.limit ?? 6 });

  if (!hits.length) {
    return {
      answer: 'I could not find this in the available company information.',
      citations: [],
      confidence: 0,
      logId: null,
      noContext: true,
    };
  }

  const context = hits
    .map((h, i) => `[${i + 1}] ${h.title}${h.heading ? ` → ${h.heading}` : ''}\n${h.content}`)
    .join('\n\n---\n\n');

  const citations = hits.map(h => ({
    documentId: h.documentId,
    title: h.title,
    heading: h.heading,
    url: h.url,
    score: h.score,
  }));

  // Confidence is the top hit's similarity, not a model self-report — a model
  // asked "how confident are you" produces a number uncorrelated with being
  // right, whereas retrieval similarity at least measures whether we found
  // anything on topic.
  const confidence = hits[0].score;

  const res = await complete({
    orgId: ctx.orgId,
    userId: ctx.userId,
    feature: 'rag.answer',
    task: 'SMART',
    system: ANSWER_SYSTEM,
    user: `Context passages:\n\n${context}\n\n---\n\nQuestion: ${question}`,
    maxTokens: 700,
    temperature: 0.1,
    citations,
    confidence,
  });

  return { answer: res.text, citations, confidence, logId: res.logId, noContext: false };
}

// ─── Bulk indexing of existing product data ───────────────────────────────────

/**
 * Indexes an org's published knowledge articles. Deliberately the only source
 * wired on by default: articles are already written to be read by humans, are
 * already permission-scoped by publication status, and carry no personal data.
 * Tickets, deals and HR policies are richer but need per-source visibility
 * rules, so they're opt-in via KnowledgeSource rows rather than swept
 * automatically.
 */
export async function reindexKnowledgeArticles(orgId: string): Promise<{ indexed: number; skipped: number; costUsd: number }> {
  const articles = await prisma.knowledgeArticle.findMany({
    where: { orgId, status: 'PUBLISHED' },
    select: { id: true, title: true, body: true, categoryId: true },
  });

  let indexed = 0;
  let skipped = 0;
  let costUsd = 0;

  for (const a of articles) {
    try {
      const res = await indexDocument({
        orgId,
        title: a.title,
        content: a.body,
        entityType: 'KNOWLEDGE_ARTICLE',
        entityId: a.id,
        url: `/itdesk/articles?id=${a.id}`,
        visibility: 'INTERNAL',
        requiredPermission: 'itdesk.article.read',
      });
      costUsd += res.costUsd;
      if (res.skipped) skipped++;
      else indexed++;
    } catch (err) {
      console.error(`[rag] failed to index article ${a.id}`, err);
    }
  }

  return { indexed, skipped, costUsd };
}
