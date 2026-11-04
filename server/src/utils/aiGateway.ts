/**
 * AI model gateway — provider routing, fallback, cost accounting, governance.
 *
 * ── What was here before ──────────────────────────────────────────────────
 * utils/ai.ts::getClient() picked Groq-or-OpenAI from env at module load and
 * hardcoded two model names. That meant: no per-task routing, no fallback
 * when a provider 500s, no customer-managed keys, no token accounting, and a
 * response cache that was a process-local Map — so it evaporated on restart
 * and was never shared between instances. There was also no record that any
 * given AI call had happened: an action taken by the model was
 * indistinguishable from one taken by a person in the audit log.
 *
 * ── What this adds ────────────────────────────────────────────────────────
 * One `complete()` entry point that resolves provider → model → call →
 * fallback → log, with a budget check in front of it. Every round trip writes
 * an AiInteractionLog row carrying tokens, cost, latency, the feature that
 * asked, and (critically) which fields the permission layer stripped before
 * the model saw the data.
 *
 * ── Compatibility ─────────────────────────────────────────────────────────
 * utils/ai.ts is deliberately NOT rewritten in this change. Its 30+ functions
 * keep their existing behavior; this gateway sits alongside them and is what
 * new code (RAG answering, agents, the assistant) calls. Migrating ai.ts's
 * internal chat() to route through here is a mechanical follow-up that can be
 * done one function at a time without touching any controller.
 */
import OpenAI from 'openai';
import { prisma } from './prisma';
import { decryptSecretOrPlain } from './crypto';
import type { PermCtx } from './permissions';

// ─── Task types ───────────────────────────────────────────────────────────────

export type AiTaskType = 'FAST' | 'SMART' | 'EMBEDDING' | 'JSON';

export interface ResolvedModel {
  providerKey: string;
  baseUrl?: string;
  apiKey: string;
  model: string;
  inputCostPer1k: number;
  outputCostPer1k: number;
  supportsJson: boolean;
  embeddingDim?: number;
}

// ─── Env fallback ─────────────────────────────────────────────────────────────
//
// Preserves exactly what utils/ai.ts does today, so an org with no AiProvider
// rows behaves identically to before this file existed.

function envProviders(): ResolvedModel[] {
  const out: ResolvedModel[] = [];
  if (process.env.GROQ_API_KEY) {
    out.push({
      providerKey: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: process.env.GROQ_API_KEY,
      // Groq decommissioned llama-3.1-8b-instant / llama-3.3-70b-versatile on
      // 2026-08-16 — defaults now track their recommended replacements, and
      // AI_MODEL_FAST / AI_MODEL_SMART env vars override without a deploy
      // (kept in sync with utils/ai.ts's model routing).
      model: process.env.AI_MODEL_FAST || 'openai/gpt-oss-20b',
      // Groq pricing as configured by the operator; 0 means "don't attribute
      // a cost" rather than "free", so an unpriced provider shows 0 spend
      // instead of a fabricated number.
      inputCostPer1k: Number(process.env.GROQ_INPUT_COST_PER_1K ?? 0),
      outputCostPer1k: Number(process.env.GROQ_OUTPUT_COST_PER_1K ?? 0),
      supportsJson: true,
    });
  }
  if (process.env.OPENAI_API_KEY) {
    out.push({
      providerKey: 'openai',
      /* OPENAI_BASE_URL (optional) points this provider at any OpenAI-
         compatible endpoint — an org proxy, LiteLLM, or a self-hosted
         Ollama/vLLM box — which is the "run the cheap tier on our own
         model" path. Kept in sync with getClient() in utils/ai.ts. */
      baseUrl: process.env.OPENAI_BASE_URL || undefined,
      apiKey: process.env.OPENAI_API_KEY,
      /* Model names follow the same env overrides as the Groq path, so a
         self-hosted endpoint can name its local models (e.g.
         AI_MODEL_FAST=qwen2.5:7b-instruct) without a code change. */
      model: process.env.OPENAI_BASE_URL
        ? (process.env.AI_MODEL_FAST || 'gpt-4o-mini')
        : 'gpt-4o-mini',
      inputCostPer1k: Number(process.env.OPENAI_INPUT_COST_PER_1K ?? 0.00015),
      outputCostPer1k: Number(process.env.OPENAI_OUTPUT_COST_PER_1K ?? 0.0006),
      supportsJson: true,
    });
  }
  return out;
}

function envModelFor(task: AiTaskType, base: ResolvedModel): ResolvedModel {
  if (base.providerKey === 'groq') {
    if (task === 'SMART') return { ...base, model: process.env.AI_MODEL_SMART || 'openai/gpt-oss-120b' };
    if (task === 'EMBEDDING') return { ...base, model: 'text-embedding-3-small', embeddingDim: 1536 };
    return base;
  }
  if (task === 'SMART') {
    /* A custom-base-URL (self-hosted) provider names its own smart model via
       AI_MODEL_SMART; the real OpenAI API keeps the priced gpt-4o default. */
    if (base.baseUrl && process.env.AI_MODEL_SMART) return { ...base, model: process.env.AI_MODEL_SMART };
    return { ...base, model: 'gpt-4o', inputCostPer1k: 0.0025, outputCostPer1k: 0.01 };
  }
  if (task === 'EMBEDDING') return { ...base, model: 'text-embedding-3-small', embeddingDim: 1536, inputCostPer1k: 0.00002, outputCostPer1k: 0 };
  return base;
}

/**
 * Ordered candidate list for a task: the org's own configured providers first
 * (so a customer key beats the platform key), then env fallback.
 *
 * Embeddings deserve a note. Groq does not serve an embeddings endpoint, so
 * when the org is on Groq we still need OpenAI for EMBEDDING. Rather than
 * silently producing no vectors, we fall through to any provider that has an
 * embedding-capable model, and RAG indexing reports "no embedding provider"
 * clearly if none exists.
 */
export async function resolveModels(orgId: string, task: AiTaskType): Promise<ResolvedModel[]> {
  const providers = await prisma.aiProvider.findMany({
    where: { OR: [{ orgId }, { orgId: null }], isActive: true },
    include: { models: { where: { isActive: true }, orderBy: { priority: 'asc' } } },
    orderBy: { priority: 'asc' },
  });

  /* Org-owned providers must be tried before platform-owned ones — the
     customer's own key should serve the customer's traffic.
     `orderBy: { orgId: 'desc' }` did NOT achieve that: in Postgres, DESC sorts
     NULLS FIRST, so platform rows (orgId IS NULL) sorted ahead of the org's
     own. The platform key was billed for tenant traffic and per-org rate
     limits went unused — the exact inverse of the intent. Sorting in JS keeps
     it explicit and database-independent. */
  const ordered = [
    ...providers.filter(p => p.orgId === orgId),
    ...providers.filter(p => p.orgId === null),
  ];

  const out: ResolvedModel[] = [];
  for (const p of ordered) {
    const key = p.apiKeyEncrypted ? decryptSecretOrPlain(p.apiKeyEncrypted) : '';
    if (!key) continue;
    for (const m of p.models) {
      if (m.taskTypes.length && !m.taskTypes.includes(task)) continue;
      out.push({
        providerKey: p.key,
        baseUrl: p.baseUrl ?? undefined,
        apiKey: key,
        model: m.modelName,
        inputCostPer1k: Number(m.inputCostPer1k ?? 0),
        outputCostPer1k: Number(m.outputCostPer1k ?? 0),
        supportsJson: m.supportsJson,
        embeddingDim: m.embeddingDim ?? undefined,
      });
    }
  }

  for (const base of envProviders()) {
    const candidate = envModelFor(task, base);
    if (task === 'EMBEDDING' && base.providerKey === 'groq') continue;
    out.push(candidate);
  }

  return out;
}

export function isGatewayConfigured(): boolean {
  return envProviders().length > 0;
}

// ─── Budget ───────────────────────────────────────────────────────────────────

export interface BudgetState {
  allowed: boolean;
  hardStop: boolean;
  limitUsd: number;
  spendUsd: number;
  percentUsed: number;
  /** Monthly token allowance from the org's license (Subscription row), set
   *  by the platform operator. 0 = no token limit configured. Enforced as a
   *  HARD cap — unlike the USD budget's advisory mode, a license limit is a
   *  commercial term, not a preference. */
  tokenLimitMonthly: number;
  tokensUsed: number;
  tokenPercentUsed: number;
  /** Which constraint blocked the call, when allowed=false. */
  blockedBy?: 'USD_BUDGET' | 'TOKEN_LIMIT';
}

function monthWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

/**
 * Whether this org may make another AI call.
 *
 * No budget row = unlimited, which keeps every existing org working untouched.
 * A budget with hardStop=false is advisory: it reports over-limit for the
 * observability dashboard but still allows the call, because silently
 * degrading a customer's product mid-month is worse than an overspend they
 * can see coming.
 */
export async function checkBudget(orgId: string): Promise<BudgetState> {
  const { start, end } = monthWindow(new Date());
  const [budget, subscription, agg] = await Promise.all([
    prisma.aiBudget.findFirst({ where: { orgId, period: 'MONTHLY', periodStart: start } }),
    prisma.subscription.findUnique({ where: { orgId } }),
    prisma.aiInteractionLog.aggregate({
      where: { orgId, createdAt: { gte: start, lt: end } },
      _sum: { costUsd: true, totalTokens: true },
    }),
  ]);

  const spend = Number(agg._sum.costUsd ?? 0);
  const tokensUsed = Number(agg._sum.totalTokens ?? 0);
  const limit = budget ? Number(budget.limitUsd) : 0;
  const pct = limit > 0 ? (spend / limit) * 100 : 0;

  // License-level token allowance (platform operator sets it on the org's
  // subscription). Independent of, and checked alongside, the org's own USD
  // budget: the USD budget is the customer's self-imposed guardrail, the
  // token limit is the platform's commercial term — either can block.
  const tokenLimitMonthly = Number((subscription as any)?.aiTokenLimitMonthly ?? 0) || 0;
  const tokenPct = tokenLimitMonthly > 0 ? (tokensUsed / tokenLimitMonthly) * 100 : 0;

  const usdBlocked = !!budget && budget.hardStop && spend >= limit;
  const tokenBlocked = tokenLimitMonthly > 0 && tokensUsed >= tokenLimitMonthly;

  return {
    allowed: !usdBlocked && !tokenBlocked,
    hardStop: budget?.hardStop ?? false,
    limitUsd: limit,
    spendUsd: spend,
    percentUsed: Math.round(pct * 10) / 10,
    tokenLimitMonthly,
    tokensUsed,
    tokenPercentUsed: Math.round(tokenPct * 10) / 10,
    blockedBy: tokenBlocked ? 'TOKEN_LIMIT' : usdBlocked ? 'USD_BUDGET' : undefined,
  };
}

// ─── Completion ───────────────────────────────────────────────────────────────

export interface CompleteOptions {
  orgId: string;
  userId?: string | null;
  /** Product surface making the call, e.g. "rag.answer" or "lead.score". */
  feature: string;
  task?: AiTaskType;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  entityType?: string;
  entityId?: string;
  /** Field names the permission layer stripped before building this prompt. */
  redactedFields?: string[];
  citations?: unknown;
  confidence?: number;
}

export interface CompleteResult {
  text: string;
  model: string;
  providerKey: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  logId: string | null;
  /** True when the budget hard-stopped the call and no model ran. */
  blocked: boolean;
}

function costOf(m: ResolvedModel, promptTokens: number, completionTokens: number): number {
  return (promptTokens / 1000) * m.inputCostPer1k + (completionTokens / 1000) * m.outputCostPer1k;
}

const PREVIEW_LIMIT = 500;

/**
 * One LLM round trip, with fallback across the resolved candidates.
 *
 * Retries within a provider only for 429/503 (matching utils/ai.ts's existing
 * policy — an auth or bad-request error will never succeed on retry), then
 * moves to the next provider. A logged row is written for the final outcome,
 * success or failure, so the observability dashboard shows error rate rather
 * than just successful spend.
 */
export async function complete(opts: CompleteOptions): Promise<CompleteResult> {
  const task = opts.task ?? 'FAST';
  const started = Date.now();

  const budget = await checkBudget(opts.orgId);
  if (!budget.allowed) {
    const logId = await logInteraction({
      ...opts,
      task,
      providerKey: 'none',
      model: 'none',
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      status: 'BUDGET_EXCEEDED',
      errorMessage: budget.blockedBy === 'TOKEN_LIMIT'
        ? `Monthly AI token allowance of ${budget.tokenLimitMonthly.toLocaleString()} tokens exhausted (${budget.tokensUsed.toLocaleString()} used) — set by your license`
        : `Monthly AI budget of $${budget.limitUsd} exhausted ($${budget.spendUsd.toFixed(2)} spent)`,
      responsePreview: null,
    });
    return {
      text: '',
      model: 'none',
      providerKey: 'none',
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      logId,
      blocked: true,
    };
  }

  const candidates = await resolveModels(opts.orgId, task);
  if (!candidates.length) {
    throw new Error('No AI provider configured');
  }

  let lastErr: any;

  for (const m of candidates) {
    const client = new OpenAI({ apiKey: m.apiKey, ...(m.baseUrl ? { baseURL: m.baseUrl } : {}) });

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2 ** attempt * 1000));
      try {
        const res = await client.chat.completions.create({
          model: m.model,
          messages: [
            { role: 'system', content: opts.system },
            { role: 'user', content: opts.user },
          ],
          temperature: opts.temperature ?? 0.3,
          max_tokens: opts.maxTokens ?? 800,
          ...(opts.json && m.supportsJson ? { response_format: { type: 'json_object' as const } } : {}),
        });

        const text = res.choices[0]?.message?.content?.trim() ?? '';
        const promptTokens = res.usage?.prompt_tokens ?? 0;
        const completionTokens = res.usage?.completion_tokens ?? 0;
        const costUsd = costOf(m, promptTokens, completionTokens);
        const latencyMs = Date.now() - started;

        const logId = await logInteraction({
          ...opts,
          task,
          providerKey: m.providerKey,
          model: m.model,
          promptTokens,
          completionTokens,
          costUsd,
          latencyMs,
          status: 'SUCCESS',
          errorMessage: null,
          responsePreview: text.slice(0, PREVIEW_LIMIT),
        });

        return {
          text,
          model: m.model,
          providerKey: m.providerKey,
          promptTokens,
          completionTokens,
          costUsd,
          latencyMs,
          logId,
          blocked: false,
        };
      } catch (err: any) {
        lastErr = err;
        const status = err?.status;
        if (status !== 429 && status !== 503) break; // next provider
      }
    }
  }

  await logInteraction({
    ...opts,
    task,
    providerKey: candidates[0]?.providerKey ?? 'unknown',
    model: candidates[0]?.model ?? 'unknown',
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    latencyMs: Date.now() - started,
    status: 'ERROR',
    errorMessage: String(lastErr?.message ?? lastErr).slice(0, 500),
    responsePreview: null,
  });

  throw lastErr ?? new Error('All AI providers failed');
}

// ─── Embeddings ───────────────────────────────────────────────────────────────

export interface EmbedResult {
  vectors: number[][];
  model: string;
  dim: number;
  costUsd: number;
}

/**
 * Embeds a batch of texts. Batched deliberately — indexing a knowledge base
 * one chunk per request is the difference between a minute and an hour.
 */
export async function embed(orgId: string, texts: string[], feature = 'rag.index'): Promise<EmbedResult> {
  if (!texts.length) return { vectors: [], model: 'none', dim: 0, costUsd: 0 };

  const candidates = await resolveModels(orgId, 'EMBEDDING');
  if (!candidates.length) {
    throw new Error(
      'No embedding-capable AI provider configured. Groq does not serve embeddings — set OPENAI_API_KEY or add an AiProvider with an EMBEDDING model.'
    );
  }

  let lastErr: any;
  for (const m of candidates) {
    const client = new OpenAI({ apiKey: m.apiKey, ...(m.baseUrl ? { baseURL: m.baseUrl } : {}) });
    try {
      const res = await client.embeddings.create({ model: m.model, input: texts });
      const vectors = res.data.map(d => d.embedding as number[]);
      const promptTokens = res.usage?.prompt_tokens ?? 0;
      const costUsd = (promptTokens / 1000) * m.inputCostPer1k;

      await logInteraction({
        orgId,
        userId: null,
        feature,
        task: 'EMBEDDING',
        system: '',
        user: '',
        providerKey: m.providerKey,
        model: m.model,
        promptTokens,
        completionTokens: 0,
        costUsd,
        latencyMs: 0,
        status: 'SUCCESS',
        errorMessage: null,
        responsePreview: null,
      });

      return { vectors, model: m.model, dim: vectors[0]?.length ?? 0, costUsd };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('All embedding providers failed');
}

// ─── Logging ──────────────────────────────────────────────────────────────────

interface LogInput extends Partial<CompleteOptions> {
  orgId: string;
  feature: string;
  task: AiTaskType;
  providerKey: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  status: 'SUCCESS' | 'ERROR' | 'CACHED' | 'BLOCKED' | 'BUDGET_EXCEEDED';
  errorMessage: string | null;
  responsePreview: string | null;
}

/**
 * Writes the audit row. Never throws — a logging failure must not take down
 * the feature that was being logged, same principle as utils/auditLog.ts.
 * Full prompts are deliberately not retained, only a bounded preview.
 */
async function logInteraction(input: LogInput): Promise<string | null> {
  try {
    const row = await prisma.aiInteractionLog.create({
      data: {
        orgId: input.orgId,
        userId: input.userId ?? null,
        feature: input.feature,
        taskType: input.task,
        providerKey: input.providerKey,
        model: input.model,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        totalTokens: input.promptTokens + input.completionTokens,
        costUsd: input.costUsd,
        latencyMs: input.latencyMs,
        status: input.status,
        errorMessage: input.errorMessage,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        confidence: input.confidence ?? null,
        citations: (input.citations as any) ?? undefined,
        promptPreview: input.user ? String(input.user).slice(0, PREVIEW_LIMIT) : null,
        responsePreview: input.responsePreview,
        redactedFields: input.redactedFields ?? [],
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    console.error('[aiGateway] failed to write interaction log', err);
    return null;
  }
}

/** Records 👍/👎 on a previous interaction (§78). */
export async function recordFeedback(
  logId: string,
  orgId: string,
  userId: string,
  feedback: 'UP' | 'DOWN',
  reason?: string
): Promise<void> {
  await prisma.aiInteractionLog.updateMany({
    where: { id: logId, orgId },
    data: { feedback, feedbackReason: reason ?? null, feedbackBy: userId, feedbackAt: new Date() },
  });
}

/** Links an executed AI action back to the interaction that proposed it (§63). */
export async function markActionExecuted(
  logId: string,
  actionName: string,
  approvedBy?: string
): Promise<void> {
  try {
    await prisma.aiInteractionLog.update({
      where: { id: logId },
      data: { actionName, actionExecuted: true, approvedBy: approvedBy ?? null },
    });
  } catch {
    /* non-fatal */
  }
}

// ─── Observability ────────────────────────────────────────────────────────────

export interface AiObservability {
  totalCalls: number;
  successRate: number;
  errorCount: number;
  totalTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  actionsExecuted: number;
  feedbackUp: number;
  feedbackDown: number;
  byFeature: Array<{ feature: string; calls: number; costUsd: number; tokens: number }>;
  byModel: Array<{ model: string; calls: number; costUsd: number }>;
  budget: BudgetState;
}

export async function getObservability(orgId: string, sinceDays = 30): Promise<AiObservability> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const where = { orgId, createdAt: { gte: since } };

  const [agg, statuses, features, models, budget] = await Promise.all([
    prisma.aiInteractionLog.aggregate({
      where,
      _count: { _all: true },
      _sum: { totalTokens: true, costUsd: true },
      _avg: { latencyMs: true },
    }),
    prisma.aiInteractionLog.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.aiInteractionLog.groupBy({
      by: ['feature'],
      where,
      _count: { _all: true },
      _sum: { costUsd: true, totalTokens: true },
    }),
    prisma.aiInteractionLog.groupBy({ by: ['model'], where, _count: { _all: true }, _sum: { costUsd: true } }),
    checkBudget(orgId),
  ]);

  const [actionsExecuted, feedbackUp, feedbackDown] = await Promise.all([
    prisma.aiInteractionLog.count({ where: { ...where, actionExecuted: true } }),
    prisma.aiInteractionLog.count({ where: { ...where, feedback: 'UP' } }),
    prisma.aiInteractionLog.count({ where: { ...where, feedback: 'DOWN' } }),
  ]);

  const total = agg._count._all || 0;
  const errors = statuses.filter(s => s.status === 'ERROR').reduce((n, s) => n + s._count._all, 0);

  return {
    totalCalls: total,
    successRate: total ? Math.round(((total - errors) / total) * 1000) / 10 : 100,
    errorCount: errors,
    totalTokens: agg._sum.totalTokens ?? 0,
    totalCostUsd: Number(agg._sum.costUsd ?? 0),
    avgLatencyMs: Math.round(agg._avg.latencyMs ?? 0),
    actionsExecuted,
    feedbackUp,
    feedbackDown,
    byFeature: features
      .map(f => ({
        feature: f.feature,
        calls: f._count._all,
        costUsd: Number(f._sum.costUsd ?? 0),
        tokens: f._sum.totalTokens ?? 0,
      }))
      .sort((a, b) => b.calls - a.calls),
    byModel: models
      .map(m => ({ model: m.model, calls: m._count._all, costUsd: Number(m._sum.costUsd ?? 0) }))
      .sort((a, b) => b.calls - a.calls),
    budget,
  };
}

/**
 * Convenience wrapper that redacts a record before it reaches a prompt and
 * carries the removed field names through to the log.
 *
 * This is the bridge between Gap 4 and Gap 5: it is what stops "the model
 * summarised an employee record and mentioned their salary" from being
 * possible, and — just as important — leaves evidence that the omission
 * happened.
 */
export function prepareContext<T>(
  ctx: PermCtx,
  resource: string,
  data: T,
  redactFn: (ctx: PermCtx, resource: string, data: T, collect?: Set<string>) => T
): { data: T; redactedFields: string[] } {
  const collected = new Set<string>();
  const safe = redactFn(ctx, resource, data, collected);
  return { data: safe, redactedFields: [...collected] };
}
