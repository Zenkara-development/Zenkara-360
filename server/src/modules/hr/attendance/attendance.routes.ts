import { Router } from 'express';
import { authenticate, requireRole, ALL_USERS, MANAGERS, ADMIN } from '../../../middleware/authenticate';
import * as c from './attendance.controller';
import * as a from './attendanceAdmin.controller';
import * as f from './attendanceFace.controller';
import * as g from './attendanceGeofence.controller';

const router = Router();
router.use(authenticate);

// Self-service — every staff role, including EMPLOYEE, marks their own attendance.
router.post('/check-in',  requireRole(...ALL_USERS), c.checkIn);
router.post('/check-out', requireRole(...ALL_USERS), c.checkOut);
router.get('/me',         requireRole(...ALL_USERS), c.myAttendance);
router.post('/heartbeat', requireRole(...ALL_USERS), c.heartbeat);

// Geofence status for the caller. GET answers from what the server already
// knows (no GPS prompt); POST evaluates a fix the browser just obtained.
router.get('/my-location',  requireRole(...ALL_USERS), g.myLocation);
router.post('/my-location', requireRole(...ALL_USERS), g.reportMyLocation);

// Face verification — policy is readable by everyone (the check-in UI needs
// it), editable by managers; enrolment is self-service, reset is self or manager.
router.get('/policy',            requireRole(...ALL_USERS), c.getPolicy);
router.patch('/policy',          requireRole(...MANAGERS),  c.updatePolicy);
router.post('/face/enrol',       requireRole(...ALL_USERS), c.enrolFace);
// Removing a Face ID is a Super Admin action — an employee may not delete
// their own, and a manager may not reset someone else's around the
// re-enrolment approval policy.
router.delete('/face/me',        requireRole(...ADMIN),    c.deleteMyFace);
router.get('/face',              requireRole(...MANAGERS),  c.listEnrollments);
router.delete('/face/:userId',   requireRole(...ADMIN),    c.deleteUserFace);

// Face ID re-enrolment — the employee asks, a Super Admin decides.
// The employee's own status and submission are open to every staff role;
// reviewing, approving and rejecting are Super Admin only.
router.get('/face/reenroll/me',                    requireRole(...ALL_USERS), f.myReenrollment);
router.post('/face/reenroll',                      requireRole(...ALL_USERS), f.submitReenrollment);
router.get('/face/reenroll/requests',              requireRole(...ADMIN),    f.listReenrollmentRequests);
router.get('/face/reenroll/requests/:id',          requireRole(...ADMIN),    f.getReenrollmentRequest);
router.post('/face/reenroll/requests/:id/approve', requireRole(...ADMIN),    f.approveReenrollment);
router.post('/face/reenroll/requests/:id/reject',  requireRole(...ADMIN),    f.rejectReenrollment);

// Policy engine: groups, holidays, register, corrections (see attendanceAdmin.controller.ts)
router.get('/policy-groups',          requireRole(...MANAGERS),  a.listGroups);
router.post('/policy-groups',         requireRole(...MANAGERS),  a.saveGroup);
router.put('/policy-groups/:id',      requireRole(...MANAGERS),  a.saveGroup);
router.delete('/policy-groups/:id',   requireRole(...MANAGERS),  a.deleteGroup);
router.get('/my-policy',              requireRole(...ALL_USERS), a.myPolicy);
router.get('/holidays',               requireRole(...ALL_USERS), a.listHolidays);
router.post('/holidays',              requireRole(...MANAGERS),  a.saveHoliday);
router.post('/holidays/bulk',         requireRole(...MANAGERS),  a.bulkHolidays);
router.put('/holidays/:id',           requireRole(...MANAGERS),  a.saveHoliday);
router.delete('/holidays/:id',        requireRole(...MANAGERS),  a.deleteHoliday);
router.get('/register',               requireRole(...ALL_USERS), a.register);
router.get('/summary',                requireRole(...ALL_USERS), a.summary);
router.post('/days',                  requireRole(...MANAGERS),  a.markDay);
router.delete('/days/:userId/:date',  requireRole(...MANAGERS),  a.resetDay);
router.get('/audit',                  requireRole(...ALL_USERS), a.auditHistory);

// Manager views
router.get('/today',      requireRole(...MANAGERS), c.todayStatus);
router.get('/live',           requireRole(...MANAGERS), c.liveLocations);
router.get('/trail/:userId',  requireRole(...MANAGERS), c.locationTrail);
router.post('/locate/:userId', requireRole(...MANAGERS), c.requestLocate);
router.get('/',           requireRole(...MANAGERS), c.listAttendance);
router.post('/manual',    requireRole(...MANAGERS), c.manualEntry);

// Office locations (admin config)
router.get('/my-ip',                   requireRole(...MANAGERS), c.myIp);
router.get('/my-host',                 requireRole(...MANAGERS), c.myHost);
router.get('/check-host',              requireRole(...MANAGERS), c.checkHost);
router.get('/office-locations',        requireRole(...MANAGERS), c.listOfficeLocations);
router.post('/office-locations',       requireRole(...MANAGERS), c.createOfficeLocation);
router.patch('/office-locations/:id',  requireRole(...MANAGERS), c.updateOfficeLocation);
router.delete('/office-locations/:id', requireRole(...MANAGERS), c.deleteOfficeLocation);
// Boundary crossings and who is inside where. The literal path comes first
// so it can never be mistaken for an office id.
//
// The route is open to every staff role because a TEAM LEAD may review the
// movements of their own team; the controller decides what each caller may
// actually see (see reviewScope()).
router.get('/office-locations/presence',   requireRole(...ALL_USERS), g.officePresence);
router.get('/office-locations/:id/events', requireRole(...ALL_USERS), g.officeEvents);
// Address search for the geofence map editor.
router.get('/geocode',                 requireRole(...MANAGERS), g.searchAddress);

export { router as attendanceRouter };
