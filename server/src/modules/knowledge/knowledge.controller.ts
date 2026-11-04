import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';
import { parsePagination, paginate } from '../../utils/pagination';
import { getPermCtx, assertCan } from '../../utils/permissions';
import {
  indexDocument,
  removeDocument,
  search as ragSearch,
  answer as ragAnswer,
  reindexKnowledgeArticles,
  hasPgVector,
  ensureVectorIndex,
} from '../../utils/rag';
import { getObservability, recordFeedback, checkBudget } from '../../utils/aiGateway';

/**
 * Knowledge / RAG surface plus AI governance reporting (§43, §78, §79, §81).
 *
 * Every retrieval endpoint takes the caller's PermCtx straight through to the
 * retriever, which is what makes "permission-aware retrieval" true rather than
 * aspirational — there is no code path here that searches first and filters
 * afterwards.
 */

// ─── Search & answer ──────────────────────────────────────────────────────────

const SearchSchema = z.object({
  query: z.string().min(2).max(1000),
  limit: z.number().int().min(1).max(25).optional(),
  minScore: z.number().min(0).max(1).optional(),
  entityTypes: z.array(z.string()).optional(),
});

export async function search(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'ai.knowledge.read');
    const input = SearchSchema.parse(req.body);

    const hits = await ragSearch(ctx, input.query, {
      limit: input.limit,
      minScore: input.minScore,
      entityTypes: input.entityTypes,
    });

    res.json({ data: hits, total: hits.length, vectorBackend: (await hasPgVector()) ? 'pgvector' : 'in-process' });
  } catch (err) {
    next(err);
  }
}

export async function ask(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'ai.assistant.use');
    const input = SearchSchema.parse(req.body);

    const result = await ragAnswer(ctx, input.query, {
      limit: input.limit,
      minScore: input.minScore,
      entityTypes: input.entityTypes,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ─── Documents ────────────────────────────────────────────────────────────────

export async function listDocuments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'ai.knowledge.read');
    const { entityType, visibility, search: q } = req.query as Record<string, string>;

    const where: any = { orgId: req.user!.orgId };
    if (entityType) where.entityType = entityType;
    if (visibility) where.visibility = visibility;
    if (q) where.title = { contains: q, mode: 'insensitive' };

    const pag = parsePagination(req);
    const [rows, total] = await Promise.all([
      prisma.knowledgeDocument.findMany({
        where,
        include: { _count: { select: { chunks: true } }, source: { select: { id: true, name: true, type: true } } },
        orderBy: { updatedAt: 'desc' },
        take: pag.limit,
        skip: pag.skip,
      }),
      prisma.knowledgeDocument.count({ where }),
    ]);

    res.json(paginate(rows, total, pag));
  } catch (err) {
    next(err);
  }
}

const IndexSchema = z.object({
  title: z.string().min(1).max(300),
  content: z.string().min(1),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  url: z.string().optional(),
  visibility: z.enum(['PUBLIC', 'INTERNAL', 'RESTRICTED']).optional(),
  allowedRoleKeys: z.array(z.string()).optional(),
  allowedDepartmentIds: z.array(z.string()).optional(),
  requiredPermission: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export async function createDocument(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'ai.knowledge.create');
    const input = IndexSchema.parse(req.body);

    const result = await indexDocument({ orgId: req.user!.orgId, ...input });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function deleteDocument(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'ai.knowledge.delete');
    const doc = await prisma.knowledgeDocument.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId },
    });
    if (!doc) throw new AppError(404, 'Document not found');
    await prisma.knowledgeDocument.delete({ where: { id: doc.id } });
    res.json({ message: 'Document removed from the knowledge index' });
  } catch (err) {
    next(err);
  }
}

/**
 * Re-indexes published knowledge articles.
 *
 * Synchronous by design for now: it's an explicit admin action with a visible
 * result, and the content hash makes repeat runs nearly free. Moving it to the
 * background job queue is the right call once orgs have thousands of articles.
 */
export async function reindex(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'ai.knowledge.create');

    await ensureVectorIndex();
    const result = await reindexKnowledgeArticles(req.user!.orgId);

    res.json({
      ...result,
      vectorBackend: (await hasPgVector()) ? 'pgvector' : 'in-process',
      message: `Indexed ${result.indexed} article(s), skipped ${result.skipped} unchanged.`,
    });
  } catch (err) {
    next(err);
  }
}

export async function knowledgeStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'ai.knowledge.read');
    const orgId = req.user!.orgId;

    const [documents, chunks, byVisibility, byType, lastIndexed] = await Promise.all([
      prisma.knowledgeDocument.count({ where: { orgId, isActive: true } }),
      prisma.knowledgeChunk.count({ where: { orgId } }),
      prisma.knowledgeDocument.groupBy({ by: ['visibility'], where: { orgId }, _count: { _all: true } }),
      prisma.knowledgeDocument.groupBy({ by: ['entityType'], where: { orgId }, _count: { _all: true } }),
      prisma.knowledgeDocument.findFirst({
        where: { orgId },
        orderBy: { indexedAt: 'desc' },
        select: { indexedAt: true },
      }),
    ]);

    res.json({
      documents,
      chunks,
      lastIndexedAt: lastIndexed?.indexedAt ?? null,
      vectorBackend: (await hasPgVector()) ? 'pgvector' : 'in-process',
      byVisibility: byVisibility.map(v => ({ visibility: v.visibility, count: v._count._all })),
      byType: byType.map(t => ({ entityType: t.entityType ?? 'UNLINKED', count: t._count._all })),
    });
  } catch (err) {
    next(err);
  }
}

// ─── AI governance & observability ────────────────────────────────────────────

export async function observability(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'ai.governance.manage');
    const days = Math.min(365, parseInt(req.query.days as string) || 30);
    res.json(await getObservability(req.user!.orgId, days));
  } catch (err) {
    next(err);
  }
}

export async function interactionLog(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'ai.governance.manage');
    const { feature, status, userId } = req.query as Record<string, string>;

    const where: any = { orgId: req.user!.orgId };
    if (feature) where.feature = feature;
    if (status) where.status = status;
    if (userId) where.userId = userId;

    const pag = parsePagination(req);
    const [rows, total] = await Promise.all([
      prisma.aiInteractionLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: pag.limit,
        skip: pag.skip,
      }),
      prisma.aiInteractionLog.count({ where }),
    ]);

    res.json(paginate(rows, total, pag));
  } catch (err) {
    next(err);
  }
}

const FeedbackSchema = z.object({
  feedback: z.enum(['UP', 'DOWN']),
  reason: z.string().max(1000).optional(),
});

/** 👍/👎 on an AI response (§78). Open to any authenticated user — feedback you can't give isn't feedback. */
export async function submitFeedback(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = FeedbackSchema.parse(req.body);
    await recordFeedback(req.params.id, req.user!.orgId, req.user!.id, data.feedback, data.reason);
    res.json({ message: 'Thanks — feedback recorded' });
  } catch (err) {
    next(err);
  }
}

const BudgetSchema = z.object({
  limitUsd: z.number().positive(),
  alertThresholdPercent: z.number().int().min(1).max(100).optional(),
  hardStop: z.boolean().optional(),
});

export async function getBudget(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'ai.governance.manage');
    res.json(await checkBudget(req.user!.orgId));
  } catch (err) {
    next(err);
  }
}

export async function setBudget(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'ai.governance.manage');
    const orgId = req.user!.orgId;
    const data = BudgetSchema.parse(req.body);

    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const row = await prisma.aiBudget.upsert({
      where: { orgId_period_periodStart: { orgId, period: 'MONTHLY', periodStart } },
      update: {
        limitUsd: data.limitUsd,
        alertThresholdPercent: data.alertThresholdPercent ?? 80,
        hardStop: data.hardStop ?? false,
      },
      create: {
        orgId,
        period: 'MONTHLY',
        limitUsd: data.limitUsd,
        alertThresholdPercent: data.alertThresholdPercent ?? 80,
        hardStop: data.hardStop ?? false,
        periodStart,
        periodEnd,
      },
    });

    res.json(row);
  } catch (err) {
    next(err);
  }
}

// ─── Providers ────────────────────────────────────────────────────────────────

export async function listProviders(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'ai.governance.manage');
    const rows = await prisma.aiProvider.findMany({
      where: { OR: [{ orgId: req.user!.orgId }, { orgId: null }] },
      include: { models: { orderBy: { priority: 'asc' } } },
      orderBy: [{ orgId: 'desc' }, { priority: 'asc' }],
    });
    // Never echo the key back, even encrypted.
    res.json({
      data: rows.map(({ apiKeyEncrypted, ...r }) => ({ ...r, hasApiKey: !!apiKeyEncrypted })),
      total: rows.length,
    });
  } catch (err) {
    next(err);
  }
}

const ProviderSchema = z.object({
  key: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  baseUrl: z.string().url().optional().nullable(),
  apiKey: z.string().min(1),
  priority: z.number().int().optional(),
  models: z
    .array(
      z.object({
        modelName: z.string().min(1),
        taskTypes: z.array(z.enum(['FAST', 'SMART', 'EMBEDDING', 'JSON'])),
        inputCostPer1k: z.number().optional(),
        outputCostPer1k: z.number().optional(),
        supportsJson: z.boolean().optional(),
        embeddingDim: z.number().int().optional(),
        priority: z.number().int().optional(),
      })
    )
    .optional(),
});

export async function createProvider(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'ai.governance.manage');
    const orgId = req.user!.orgId;
    const { apiKey, models, ...data } = ProviderSchema.parse(req.body);

    const { encryptSecret } = await import('../../utils/crypto');

    const provider = await prisma.aiProvider.upsert({
      where: { orgId_key: { orgId, key: data.key } },
      update: { ...data, apiKeyEncrypted: encryptSecret(apiKey) },
      create: { ...data, orgId, apiKeyEncrypted: encryptSecret(apiKey) },
    });

    if (models?.length) {
      for (const m of models) {
        await prisma.aiModelConfig.upsert({
          where: { providerId_modelName: { providerId: provider.id, modelName: m.modelName } },
          update: m,
          create: { ...m, providerId: provider.id },
        });
      }
    }

    const full = await prisma.aiProvider.findUnique({
      where: { id: provider.id },
      include: { models: true },
    });
    const { apiKeyEncrypted, ...safe } = full!;
    res.status(201).json({ ...safe, hasApiKey: true });
  } catch (err) {
    next(err);
  }
}

export async function deleteProvider(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getPermCtx(req.user!);
    assertCan(ctx, 'ai.governance.manage');
    const row = await prisma.aiProvider.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!row) throw new AppError(404, 'Provider not found');
    await prisma.aiProvider.delete({ where: { id: row.id } });
    res.json({ message: 'Provider removed' });
  } catch (err) {
    next(err);
  }
}
