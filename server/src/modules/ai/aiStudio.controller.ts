/**
 * AI Studio — Business Context, Custom AI Functions, Custom Scripts
 *
 * Business Context  : GET/PUT /api/ai/studio/context
 * Custom Functions  : CRUD   /api/ai/studio/functions
 *                     POST   /api/ai/studio/functions/:id/run
 * Custom Scripts    : CRUD   /api/ai/studio/scripts
 *                     POST   /api/ai/studio/scripts/validate
 */
import { Response, NextFunction } from 'express';
import { complete } from '../../utils/aiGateway';
import { z } from 'zod';
import OpenAI from 'openai';
import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/authenticate';
import { AppError } from '../../middleware/errorHandler';

// Use Groq via the OpenAI-compatible endpoint (same pattern as utils/ai.ts)
function getAiClient(): OpenAI | null {
  if (process.env.GROQ_API_KEY) {
    // Bounded — see the note in utils/ai.ts. AI Studio has no retry loop of
    // its own, so an unbounded request here just hangs the request thread.
    return new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1', timeout: 30_000, maxRetries: 1 });
  }
  if (process.env.OPENAI_API_KEY) {
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30_000, maxRetries: 1 });
  }
  return null;
}
// llama-3.1-8b-instant was decommissioned by Groq on 2026-08-16; default now
// tracks their recommended replacement, overridable via AI_MODEL_FAST (same
// convention as utils/ai.ts).
const AI_MODEL = process.env.AI_MODEL_FAST || (process.env.GROQ_API_KEY ? 'openai/gpt-oss-20b' : 'gpt-4o-mini');
const groq = getAiClient();

// ─── helpers ─────────────────────────────────────────────────────────────────

async function getContext(orgId: string) {
  return prisma.businessContext.findUnique({ where: { orgId } });
}

function buildSystemPrefix(ctx: any): string {
  if (!ctx) return '';
  const parts: string[] = [];
  if (ctx.industry)     parts.push(`Industry: ${ctx.industry}.`);
  if (ctx.companyDesc)  parts.push(`About the company: ${ctx.companyDesc}`);
  if (ctx.tone)         parts.push(`Tone: ${ctx.tone}.`);
  if (ctx.customSystem) parts.push(ctx.customSystem);
  if (ctx.terminology && typeof ctx.terminology === 'object') {
    const terms = Object.entries(ctx.terminology as Record<string, string>)
      .map(([k, v]) => `${k} = ${v}`)
      .join('; ');
    if (terms) parts.push(`Domain terminology: ${terms}.`);
  }
  return parts.join(' ');
}

// ─── Business Context ─────────────────────────────────────────────────────────

const ContextSchema = z.object({
  // These map to nullable columns in the BusinessContext model. GET returns
  // `null` (not omitted) for any field that hasn't been set yet, and the
  // frontend round-trips that same shape back on save — so `.optional()`
  // alone (undefined-only) rejected every re-save with a 400 once a row
  // existed. `.nullable()` lets the schema accept the null Prisma gives us.
  industry:     z.string().nullable().optional(),
  companyDesc:  z.string().nullable().optional(),
  terminology:  z.record(z.string()).nullable().optional(),
  customSystem: z.string().nullable().optional(),
  tone:         z.enum(['professional', 'casual', 'technical']).optional(),
});

export async function getBusinessContext(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getContext(req.user!.orgId);
    res.json(ctx ?? {});
  } catch (err) { next(err); }
}

/**
 * Label overrides only, for ALL_STAFF — not MANAGERS-gated like the rest of
 * Business Context. Relabeled terminology has to be visible to every staff
 * member who sees the entity in question (a sales rep looking at "Policies"
 * needs that label too), not just the managers who configured it, so this
 * intentionally exposes a narrower slice of BusinessContext under a looser
 * role check rather than loosening getBusinessContext itself (which also
 * returns industry/companyDesc/customSystem — reasonable to keep those
 * manager-only as configuration data).
 */
export async function getLabelOverrides(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ctx = await getContext(req.user!.orgId);
    res.json({ labelOverrides: ctx?.labelOverrides ?? null });
  } catch (err) { next(err); }
}

export async function upsertBusinessContext(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = ContextSchema.parse(req.body);
    // Prisma's Json? column doesn't accept a plain `null` — it needs the
    // Prisma.JsonNull sentinel to actually store a JSON null. Swap it in
    // only when terminology was explicitly sent as null.
    const { terminology, ...rest } = data;
    const prismaData = {
      ...rest,
      ...(terminology !== undefined && { terminology: terminology === null ? Prisma.JsonNull : terminology }),
    };
    const ctx = await prisma.businessContext.upsert({
      where:  { orgId: req.user!.orgId },
      create: { ...prismaData, orgId: req.user!.orgId },
      update: prismaData,
    });
    res.json(ctx);
  } catch (err) { next(err); }
}

// ─── Custom AI Functions ──────────────────────────────────────────────────────

const InputFieldSchema = z.object({
  name:     z.string(),
  type:     z.enum(['text', 'number', 'boolean', 'select']),
  label:    z.string(),
  required: z.boolean().optional(),
  options:  z.array(z.string()).optional(), // for type=select
});

const FunctionSchema = z.object({
  name:         z.string().min(1).max(80),
  description:  z.string().optional(),
  systemPrompt: z.string().min(1),
  inputSchema:  z.array(InputFieldSchema).default([]),
  outputType:   z.enum(['text', 'json', 'number']).default('text'),
  isActive:     z.boolean().optional(),
});

export async function listFunctions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const fns = await prisma.customAIFunction.findMany({
      where: { orgId: req.user!.orgId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(fns);
  } catch (err) { next(err); }
}

export async function createFunction(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = FunctionSchema.parse(req.body);
    const fn = await prisma.customAIFunction.create({
      data: { ...data, orgId: req.user!.orgId },
    });
    res.status(201).json(fn);
  } catch (err) { next(err); }
}

export async function updateFunction(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = FunctionSchema.partial().parse(req.body);
    const fn = await prisma.customAIFunction.updateMany({
      where: { id: req.params.id, orgId: req.user!.orgId },
      data,
    });
    if (!fn.count) throw new AppError(404, 'Function not found');
    const updated = await prisma.customAIFunction.findUnique({ where: { id: req.params.id } });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function deleteFunction(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.customAIFunction.deleteMany({
      where: { id: req.params.id, orgId: req.user!.orgId },
    });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
}

export async function runFunction(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const fn = await prisma.customAIFunction.findFirst({
      where: { id: req.params.id, orgId: req.user!.orgId, isActive: true },
    });
    if (!fn) throw new AppError(404, 'Function not found or inactive');
    if (!groq) throw new AppError(503, 'AI service not configured');

    // Build prompt: system = business context + function prompt
    const ctx = await getContext(req.user!.orgId);
    const contextPrefix = buildSystemPrefix(ctx);
    const systemPrompt = contextPrefix
      ? `${contextPrefix}\n\n${fn.systemPrompt}`
      : fn.systemPrompt;

    // Build user message from inputs
    const inputs = req.body.inputs ?? {};
    const inputLines = Object.entries(inputs)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    const userMessage = inputLines || (req.body.text ?? 'Run this function.');

    /* Through the gateway, so a custom function is budgeted, logged and
       costed like every other AI call. It used to use a module-level client
       directly, which meant AI Studio usage never appeared in AI Governance
       and could not be capped. */
    const result = await complete({
      orgId: req.user!.orgId,
      userId: req.user!.id,
      feature: 'studio.function',
      task: 'FAST',
      system: systemPrompt,
      user: userMessage,
      temperature: 0.4,
      maxTokens: 1024,
    });
    if (result.blocked) {
      throw new AppError(402, 'Monthly AI budget reached. Raise the limit in AI Governance, or wait for the next billing period.');
    }

    const raw = result.text;

    // Parse output based on outputType
    let output: any = raw;
    if (fn.outputType === 'json') {
      try {
        const match = raw.match(/```json\n?([\s\S]*?)\n?```/) || raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        output = JSON.parse(match ? match[1] : raw);
      } catch { output = raw; }
    } else if (fn.outputType === 'number') {
      const num = parseFloat(raw.replace(/[^0-9.]/g, ''));
      output = isNaN(num) ? raw : num;
    }

    // Increment run count
    prisma.customAIFunction.update({
      where: { id: fn.id },
      data: { runCount: { increment: 1 } },
    }).catch(() => {});

    res.json({ output, raw });
  } catch (err: any) {
    if (err?.status === 429) return res.status(402).json({ error: 'AI quota exceeded.' });
    next(err);
  }
}

// ─── Custom Scripts ───────────────────────────────────────────────────────────

const ScriptSchema = z.object({
  name:        z.string().min(1).max(80),
  description: z.string().optional(),
  entityType:  z.enum(['ticket', 'contact', 'deal', 'lead', 'asset', 'global']),
  trigger:     z.enum(['onLoad', 'onChange', 'onSubmit', 'onValidate', 'onFieldChange']),
  fieldTarget: z.string().optional(),
  script:      z.string().min(1),
  isActive:    z.boolean().optional(),
});

export async function listScripts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const where: any = { orgId: req.user!.orgId };
    if (req.query.entityType) where.entityType = req.query.entityType;
    if (req.query.trigger)    where.trigger    = req.query.trigger;
    const scripts = await prisma.customScript.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json(scripts);
  } catch (err) { next(err); }
}

export async function createScript(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = ScriptSchema.parse(req.body);
    const script = await prisma.customScript.create({
      data: { ...data, orgId: req.user!.orgId },
    });
    res.status(201).json(script);
  } catch (err) { next(err); }
}

export async function updateScript(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = ScriptSchema.partial().parse(req.body);
    const result = await prisma.customScript.updateMany({
      where: { id: req.params.id, orgId: req.user!.orgId },
      data,
    });
    if (!result.count) throw new AppError(404, 'Script not found');
    const updated = await prisma.customScript.findUnique({ where: { id: req.params.id } });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function deleteScript(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.customScript.deleteMany({
      where: { id: req.params.id, orgId: req.user!.orgId },
    });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
}

/**
 * Validate script syntax server-side (dry run in a try/catch new Function()).
 * Does NOT execute the script body — just checks it parses.
 */
export async function validateScript(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { script } = z.object({ script: z.string() }).parse(req.body);
    try {
      // eslint-disable-next-line no-new-func
      new Function('context', script);
      res.json({ valid: true });
    } catch (e: any) {
      res.json({ valid: false, error: e.message });
    }
  } catch (err) { next(err); }
}

// ─── (removed) AI Setup Generator ────────────────────────────────────────────
// The generate-setup/apply-setup endpoints that used to live here were
// superseded by the AI Solution Builder (solutionBuilder.controller.ts),
// which generates terminology, whole custom modules with pipelines and
// relations, the workspace skin, and automations from one description —
// and its apply path writes labelOverrides into this same BusinessContext
// storage, so getLabelOverrides above keeps serving every client unchanged.
