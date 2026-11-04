import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { AuthRequest } from '../../../middleware/authenticate';
import { AppError } from '../../../middleware/errorHandler';
import { logAction } from '../../../utils/auditLog';
import { ensureDefaultPipeline, normalizeStages, StageDef } from './pipelines.service';

const StageSchema = z.object({
  label: z.string().min(1).max(60),
  color: z.string().optional(),
  probability: z.number().min(0).max(100).optional(),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
});

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = req.user!.orgId;
    await ensureDefaultPipeline(orgId); // guarantee at least one exists
    const pipelines = await prisma.pipeline.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' } });
    res.json(pipelines.map(p => ({ ...p, stages: normalizeStages(p.stages) })));
  } catch (err) { next(err); }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const pipeline = await prisma.pipeline.findFirst({ where: { id: req.params.id, orgId: req.user!.orgId } });
    if (!pipeline) throw new AppError(404, 'Pipeline not found');
    res.json({ ...pipeline, stages: normalizeStages(pipeline.stages) });
  } catch (err) { next(err); }
}

export async function rename(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name } = z.object({ name: z.string().min(1).max(100) }).parse(req.body);
    const orgId = req.user!.orgId;
    const existing = await prisma.pipeline.findFirst({ where: { id: req.params.id, orgId } });
    if (!existing) throw new AppError(404, 'Pipeline not found');
    const pipeline = await prisma.pipeline.update({ where: { id: req.params.id }, data: { name } });
    res.json({ ...pipeline, stages: normalizeStages(pipeline.stages) });
  } catch (err) { next(err); }
}

export async function addStage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = StageSchema.parse(req.body);
    const orgId = req.user!.orgId;
    const pipeline = await prisma.pipeline.findFirst({ where: { id: req.params.id, orgId } });
    if (!pipeline) throw new AppError(404, 'Pipeline not found');
    const stages = normalizeStages(pipeline.stages);
    if (stages.some(s => s.label.toLowerCase() === data.label.toLowerCase())) {
      throw new AppError(400, 'A stage with that name already exists');
    }
    const newStage: StageDef = {
      label: data.label,
      color: data.color || '#6366f1',
      probability: data.probability ?? 50,
      isWon: data.isWon,
      isLost: data.isLost,
    };
    stages.push(newStage);
    const updated = await prisma.pipeline.update({ where: { id: pipeline.id }, data: { stages: stages as any } });
    logAction(req.user!.id, 'CREATE', 'PipelineStage', pipeline.id, { label: newStage.label });
    res.status(201).json({ ...updated, stages: normalizeStages(updated.stages) });
  } catch (err) { next(err); }
}

export async function updateStage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const oldLabel = decodeURIComponent(req.params.label);
    const data = StageSchema.partial().parse(req.body);
    const orgId = req.user!.orgId;
    const pipeline = await prisma.pipeline.findFirst({ where: { id: req.params.id, orgId } });
    if (!pipeline) throw new AppError(404, 'Pipeline not found');
    const stages = normalizeStages(pipeline.stages);
    const idx = stages.findIndex(s => s.label === oldLabel);
    if (idx === -1) throw new AppError(404, 'Stage not found');

    const newLabel = data.label?.trim();
    if (newLabel && newLabel !== oldLabel && stages.some((s, i) => i !== idx && s.label.toLowerCase() === newLabel.toLowerCase())) {
      throw new AppError(400, 'A stage with that name already exists');
    }

    stages[idx] = {
      ...stages[idx],
      ...(newLabel && { label: newLabel }),
      ...(data.color !== undefined && { color: data.color }),
      ...(data.probability !== undefined && { probability: data.probability }),
      ...(data.isWon !== undefined && { isWon: data.isWon }),
      ...(data.isLost !== undefined && { isLost: data.isLost }),
    };

    await prisma.$transaction(async (tx) => {
      await tx.pipeline.update({ where: { id: pipeline.id }, data: { stages: stages as any } });
      // Renaming a stage is a label change, and Deal.stage stores the label
      // verbatim — every deal currently sitting in the old label has to move
      // with it, or it silently falls off the board (matches no stage).
      if (newLabel && newLabel !== oldLabel) {
        await tx.deal.updateMany({ where: { orgId, pipelineId: pipeline.id, stage: oldLabel }, data: { stage: newLabel } });
      }
    });

    logAction(req.user!.id, 'UPDATE', 'PipelineStage', pipeline.id, { from: oldLabel, to: newLabel || oldLabel });
    const updated = await prisma.pipeline.findUnique({ where: { id: pipeline.id } });
    res.json({ ...updated, stages: normalizeStages(updated!.stages) });
  } catch (err) { next(err); }
}

export async function removeStage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const label = decodeURIComponent(req.params.label);
    const { reassignTo } = req.query as Record<string, string>;
    const orgId = req.user!.orgId;
    const pipeline = await prisma.pipeline.findFirst({ where: { id: req.params.id, orgId } });
    if (!pipeline) throw new AppError(404, 'Pipeline not found');
    const stages = normalizeStages(pipeline.stages);
    if (!stages.some(s => s.label === label)) throw new AppError(404, 'Stage not found');
    if (stages.length <= 1) throw new AppError(400, 'A pipeline needs at least one stage');

    const dealsInStage = await prisma.deal.count({ where: { orgId, pipelineId: pipeline.id, stage: label } });
    if (dealsInStage > 0 && !reassignTo) {
      throw new AppError(400, `${dealsInStage} deal(s) are still in "${label}" — pass ?reassignTo=<otherStageLabel> to move them first`);
    }
    if (dealsInStage > 0 && reassignTo) {
      if (!stages.some(s => s.label === reassignTo)) throw new AppError(400, `"${reassignTo}" is not a valid stage on this pipeline`);
      await prisma.deal.updateMany({ where: { orgId, pipelineId: pipeline.id, stage: label }, data: { stage: reassignTo } });
    }

    const remaining = stages.filter(s => s.label !== label);
    const updated = await prisma.pipeline.update({ where: { id: pipeline.id }, data: { stages: remaining as any } });
    logAction(req.user!.id, 'DELETE', 'PipelineStage', pipeline.id, { label });
    res.json({ ...updated, stages: normalizeStages(updated.stages) });
  } catch (err) { next(err); }
}

export async function reorderStages(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { labels } = z.object({ labels: z.array(z.string()) }).parse(req.body);
    const orgId = req.user!.orgId;
    const pipeline = await prisma.pipeline.findFirst({ where: { id: req.params.id, orgId } });
    if (!pipeline) throw new AppError(404, 'Pipeline not found');
    const stages = normalizeStages(pipeline.stages);
    if (labels.length !== stages.length || !labels.every(l => stages.some(s => s.label === l))) {
      throw new AppError(400, 'Reorder list must contain exactly the pipeline\'s current stage labels');
    }
    const reordered = labels.map(l => stages.find(s => s.label === l)!);
    const updated = await prisma.pipeline.update({ where: { id: pipeline.id }, data: { stages: reordered as any } });
    res.json({ ...updated, stages: normalizeStages(updated.stages) });
  } catch (err) { next(err); }
}
