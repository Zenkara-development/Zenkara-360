import { Router } from 'express';
import { authenticate, requireRole, ALL_USERS, MANAGERS } from '../../../middleware/authenticate';
import * as c from './payroll.controller';
import * as cfg from './payrollConfig.controller';
import * as tpl from './payslipTemplates.controller';

const router = Router();
router.use(authenticate);

// Salary structures — managers only (sensitive compensation data).
router.get('/structures',        requireRole(...MANAGERS), c.listStructures);
router.post('/structures',       requireRole(...MANAGERS), c.upsertStructure);
router.delete('/structures/:id', requireRole(...MANAGERS), c.deactivateStructure);

// Salary components, cycles, employee salaries, preview — managers only.
router.get('/components',            requireRole(...MANAGERS), cfg.listComponents);
router.post('/components',           requireRole(...MANAGERS), cfg.createComponent);
router.patch('/components/reorder',  requireRole(...MANAGERS), cfg.reorderComponents);
router.patch('/components/:id',      requireRole(...MANAGERS), cfg.updateComponent);
router.delete('/components/:id',     requireRole(...MANAGERS), cfg.deleteComponent);
router.get('/cycles',                requireRole(...MANAGERS), cfg.listCycles);
router.post('/cycles',               requireRole(...MANAGERS), cfg.saveCycle);
router.put('/cycles/:id',            requireRole(...MANAGERS), cfg.saveCycle);
router.get('/employee-salaries',     requireRole(...MANAGERS), cfg.listEmployeeSalaries);
router.get('/employee-salaries/:userId', requireRole(...MANAGERS), cfg.getEmployeeSalary);
router.post('/employee-salaries',    requireRole(...MANAGERS), cfg.upsertEmployeeSalary);
router.delete('/employee-salaries/:id', requireRole(...MANAGERS), cfg.deactivateEmployeeSalary);
router.post('/preview',              requireRole(...MANAGERS), cfg.previewPayslip);

// Payroll runs — managers only. Draft → review/adjust → finalise → paid.
router.get('/runs',                  requireRole(...MANAGERS), c.listRuns);
router.post('/runs',                 requireRole(...MANAGERS), c.runPayroll);
router.get('/runs/:id',              requireRole(...MANAGERS), c.getRun);
router.post('/runs/:id/recalculate', requireRole(...MANAGERS), c.recalculateRun);
router.patch('/runs/:id/payslips/:payslipId', requireRole(...MANAGERS), c.adjustDraftPayslip);
router.post('/runs/:id/finalize',    requireRole(...MANAGERS), c.finalizeRun);
router.delete('/runs/:id',           requireRole(...MANAGERS), c.discardRun);
router.patch('/runs/:id/mark-paid',  requireRole(...MANAGERS), c.markRunPaid);

// Payslips — an employee can see their own; managers can see everyone's.
router.get('/payslips',                requireRole(...ALL_USERS), c.listPayslips);
router.get('/payslips/:id',            requireRole(...ALL_USERS), c.getPayslip);
router.patch('/payslips/:id/mark-paid', requireRole(...MANAGERS), c.markPayslipPaid);

// Payslip letterhead template — everyone can read (needed to render their
// own payslip print view), only managers can design/edit it.
router.get('/template', requireRole(...ALL_USERS), c.getTemplate);
router.put('/template',  requireRole(...MANAGERS), c.saveTemplate);

// Payslip templates (phase 4): many per org, layouts, field visibility, assignment.
router.get('/templates',                 requireRole(...MANAGERS), tpl.listTemplates);
router.post('/templates',                requireRole(...MANAGERS), tpl.createTemplate);
router.post('/templates/preview',        requireRole(...MANAGERS), tpl.previewDraftTemplate);
router.get('/templates/:id/preview',     requireRole(...MANAGERS), tpl.previewTemplate);
router.post('/templates/:id/duplicate',  requireRole(...MANAGERS), tpl.duplicateTemplate);
router.put('/templates/:id',             requireRole(...MANAGERS), tpl.updateTemplate);
router.delete('/templates/:id',          requireRole(...MANAGERS), tpl.deleteTemplate);

// Rendered payslips: HTML for the in-app print view, server-side PDF, bulk PDF per run, e-mail with PDF attached.
router.get('/payslips/:id/html',   requireRole(...ALL_USERS), tpl.payslipHtml);
router.get('/payslips/:id/pdf',    requireRole(...ALL_USERS), tpl.payslipPdf);
router.post('/payslips/:id/email', requireRole(...MANAGERS), tpl.emailPayslip);
router.get('/runs/:id/pdf',        requireRole(...MANAGERS), tpl.runPdf);
router.post('/runs/:id/email',     requireRole(...MANAGERS), tpl.emailRun);

export { router as payrollRouter };
