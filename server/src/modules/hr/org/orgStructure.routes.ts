import { Router } from 'express';
import { authenticate, requireRole, ALL_USERS, MANAGERS } from '../../../middleware/authenticate';
import * as c from './orgStructure.controller';

const router = Router();
router.use(authenticate);

// Departments
router.get('/departments',            requireRole(...ALL_USERS), c.listDepartments);
router.get('/departments/tree',       requireRole(...ALL_USERS), c.departmentTree);
router.post('/departments',           requireRole(...MANAGERS),  c.createDepartment);
router.patch('/departments/:id',      requireRole(...MANAGERS),  c.updateDepartment);
router.delete('/departments/:id',     requireRole(...MANAGERS),  c.deleteDepartment);

// Teams
router.get('/teams',                          requireRole(...ALL_USERS), c.listTeams);
router.post('/teams',                         requireRole(...MANAGERS),  c.createTeam);
router.patch('/teams/:id',                    requireRole(...MANAGERS),  c.updateTeam);
router.delete('/teams/:id',                   requireRole(...MANAGERS),  c.deleteTeam);
router.post('/teams/:id/members',             requireRole(...MANAGERS),  c.addTeamMember);
router.delete('/teams/:id/members/:employeeId', requireRole(...MANAGERS), c.removeTeamMember);

// Locations
router.get('/locations',          requireRole(...ALL_USERS), c.listLocations);
router.post('/locations',         requireRole(...MANAGERS),  c.createLocation);
router.patch('/locations/:id',    requireRole(...MANAGERS),  c.updateLocation);
router.delete('/locations/:id',   requireRole(...MANAGERS),  c.deleteLocation);

export { router as orgStructureRouter };
