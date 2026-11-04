import { Router } from 'express';
import { authenticate, requireRole, ALL_STAFF, CRM_MANAGERS } from '../../middleware/authenticate';
import * as c from './customModules.controller';
import * as sync from './externalSync.controller';

export const customModulesRouter = Router();
customModulesRouter.use(authenticate);

// Module admin — building/configuring a module is a manager-level action
customModulesRouter.get('/',                          requireRole(...ALL_STAFF),    c.listModules);
// Must be registered before GET /:id — otherwise Express would match
// "templates" as an :id value and route here to getModule instead.
customModulesRouter.get('/templates',                 requireRole(...CRM_MANAGERS), c.listModuleTemplates);
customModulesRouter.post('/',                          requireRole(...CRM_MANAGERS), c.createModule);
customModulesRouter.get('/:id',                        requireRole(...ALL_STAFF),    c.getModule);
customModulesRouter.patch('/:id',                      requireRole(...CRM_MANAGERS), c.updateModule);
customModulesRouter.delete('/:id',                     requireRole(...CRM_MANAGERS), c.deleteModule);

// Field schema
customModulesRouter.post('/:id/fields',                requireRole(...CRM_MANAGERS), c.addField);
customModulesRouter.patch('/:id/fields/:fieldId',      requireRole(...CRM_MANAGERS), c.updateField);
customModulesRouter.delete('/:id/fields/:fieldId',     requireRole(...CRM_MANAGERS), c.removeField);

// Records — day-to-day use, open to all staff
// Stats power the module dashboard row (Phase 5) — read-only aggregates.
customModulesRouter.get('/:id/stats',                  requireRole(...ALL_STAFF),    c.moduleStats);
customModulesRouter.get('/:id/records',                requireRole(...ALL_STAFF),    c.listRecords);
customModulesRouter.post('/:id/records',                requireRole(...ALL_STAFF),    c.createRecord);
customModulesRouter.get('/:id/records/:recordId',       requireRole(...ALL_STAFF),    c.getRecord);
customModulesRouter.get('/:id/records/:recordId/related', requireRole(...ALL_STAFF),  c.relatedRecords);
customModulesRouter.patch('/:id/records/:recordId',     requireRole(...ALL_STAFF),    c.updateRecord);
// The kanban drag — stage moves fire CUSTOM_RECORD_STAGE_CHANGED workflows.
customModulesRouter.patch('/:id/records/:recordId/stage', requireRole(...ALL_STAFF),  c.setRecordStage);
customModulesRouter.delete('/:id/records/:recordId',    requireRole(...CRM_MANAGERS), c.removeRecord);

// External polling sync
customModulesRouter.get('/:id/sync',                   requireRole(...CRM_MANAGERS), sync.getSyncConfig);
customModulesRouter.put('/:id/sync',                    requireRole(...CRM_MANAGERS), sync.upsertSyncConfig);
customModulesRouter.delete('/:id/sync',                 requireRole(...CRM_MANAGERS), sync.deleteSyncConfig);
customModulesRouter.post('/:id/sync/run',                requireRole(...CRM_MANAGERS), sync.triggerSync);
