import { prisma } from '../../../utils/prisma';

// Pipeline.stages is a Json column. Historically it stored a plain
// string[] (["Prospecting","Proposal",...]) and Deal.stage stored that
// exact string as its value. To support renaming/coloring/reordering
// stages without a data migration on already-seeded/production rows, new
// stages are stored as richer objects — but any *old* plain-string entries
// already in the DB are transparently upgraded to the same shape on read.
// Deal.stage keeps storing the stage's `label` verbatim (same as before);
// renaming a stage cascades that label change onto every Deal currently
// sitting in it (see renameStage below), so this never needs a separate
// stable "key" concept.
export interface StageDef {
  label: string;
  color: string;
  probability: number;
  isWon?: boolean;
  isLost?: boolean;
}

const DEFAULT_COLOR = '#6366f1';

export function normalizeStage(item: unknown, index = 0): StageDef {
  if (typeof item === 'string') {
    return { label: item, color: DEFAULT_COLOR, probability: Math.min(90, (index + 1) * 20) };
  }
  const s = (item ?? {}) as Record<string, unknown>;
  return {
    label: String(s.label ?? ''),
    color: typeof s.color === 'string' ? s.color : DEFAULT_COLOR,
    probability: typeof s.probability === 'number' ? s.probability : Math.min(90, (index + 1) * 20),
    isWon: Boolean(s.isWon),
    isLost: Boolean(s.isLost),
  };
}

export function normalizeStages(stages: unknown): StageDef[] {
  if (!Array.isArray(stages)) return [];
  return stages.map((s, i) => normalizeStage(s, i));
}

const DEFAULT_STAGES: StageDef[] = [
  { label: 'Prospecting', color: '#6366f1', probability: 20 },
  { label: 'Proposal',    color: '#8b5cf6', probability: 40 },
  { label: 'Negotiation', color: '#f59e0b', probability: 65 },
  { label: 'Won',         color: '#10b981', probability: 100, isWon: true },
  { label: 'Lost',        color: '#ef4444', probability: 0,   isLost: true },
];

export async function ensureDefaultPipeline(orgId: string) {
  let pipeline = await prisma.pipeline.findFirst({ where: { orgId, isDefault: true } });
  if (!pipeline) {
    pipeline = await prisma.pipeline.create({
      data: { name: 'Sales Pipeline', stages: DEFAULT_STAGES as any, isDefault: true, orgId },
    });
  }
  return pipeline;
}
