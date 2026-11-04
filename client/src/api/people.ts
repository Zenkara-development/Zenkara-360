import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

/**
 * People platform — employees, departments, teams and locations.
 *
 * Note the distinction between User and Employee that runs through these
 * types: a `User` is a login, an `Employee` is a member of staff. They're
 * linked one-to-one but either can exist alone, which is why `Employee.user`
 * is nullable and why the employee list is not just "the users list with more
 * columns".
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Department {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  parentId?: string | null;
  headId?: string | null;
  costCenter?: string | null;
  isActive: boolean;
  head?: { id: string; displayName: string; employeeCode: string } | null;
  parent?: { id: string; name: string } | null;
  children?: Department[];
  _count?: { employees: number; children: number; teams: number };
}

export interface LocationRecord {
  id: string;
  name: string;
  code?: string | null;
  type: string;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  timezone?: string | null;
  isActive: boolean;
  _count?: { employees: number; officeLocations: number };
}

export interface TeamMemberRecord {
  id: string;
  role: string;
  employee: { id: string; displayName: string; employeeCode: string; designation?: string | null };
}

export interface TeamRecord {
  id: string;
  name: string;
  description?: string | null;
  departmentId?: string | null;
  leadId?: string | null;
  type?: string | null;
  isActive: boolean;
  department?: { id: string; name: string } | null;
  lead?: { id: string; displayName: string } | null;
  members: TeamMemberRecord[];
}

export interface Employee {
  id: string;
  employeeCode: string;
  userId?: string | null;
  firstName: string;
  lastName?: string | null;
  displayName: string;
  workEmail?: string | null;
  personalEmail?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  photoUrl?: string | null;
  designation?: string | null;
  departmentId?: string | null;
  locationId?: string | null;
  managerId?: string | null;
  costCenter?: string | null;
  workMode: string;
  employmentType: string;
  employmentStatus: string;
  joiningDate: string;
  probationEndDate?: string | null;
  confirmationDate?: string | null;
  lastWorkingDate?: string | null;
  exitType?: string | null;
  exitReason?: string | null;
  // Masked to '••••••1234' or removed entirely depending on the caller's
  // field permissions — never assume these are readable.
  bankAccountNumber?: string | null;
  bankName?: string | null;
  taxId?: string | null;
  nationalId?: string | null;
  department?: { id: string; name: string } | null;
  location?: { id: string; name: string } | null;
  manager?: { id: string; displayName: string; employeeCode: string } | null;
  user?: { id: string; email: string; role: string; isActive: boolean } | null;
  reports?: Array<{ id: string; displayName: string; designation?: string | null; employeeCode: string }>;
  contacts?: Array<{ id: string; name: string; relationship: string; phone: string; isEmergency: boolean }>;
  certifications?: Array<{ id: string; name: string; issuer?: string | null; expiresOn?: string | null }>;
  skills?: Array<{ id: string; level: number; skill: { id: string; name: string; category?: string | null } }>;
}

export interface OrgChartNode {
  id: string;
  displayName: string;
  employeeCode: string;
  designation?: string | null;
  photoUrl?: string | null;
  managerId?: string | null;
  department?: { id: string; name: string } | null;
  reports: OrgChartNode[];
}

export interface EmployeeStats {
  total: number;
  recentJoiners: number;
  exiting: number;
  byStatus: Array<{ status: string; count: number }>;
  byType: Array<{ type: string; count: number }>;
  byDepartment: Array<{ departmentId: string | null; department: string; count: number }>;
}

interface Paged<T> {
  data: T[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

// ─── Employees ────────────────────────────────────────────────────────────────

export const useEmployees = (params: Record<string, string | undefined> = {}) =>
  useQuery<Paged<Employee>>({
    queryKey: ['employees', params],
    queryFn: () => api.get('/hr/employees', { params }).then(r => r.data),
  });

export const useEmployee = (id?: string) =>
  useQuery<Employee>({
    queryKey: ['employee', id],
    queryFn: () => api.get(`/hr/employees/${id}`).then(r => r.data),
    enabled: !!id,
  });

export const useMyEmployee = () =>
  useQuery<{ data: Employee | null; message?: string }>({
    queryKey: ['employee', 'me'],
    queryFn: () => api.get('/hr/employees/me').then(r => r.data),
  });

export const useOrgChart = () =>
  useQuery<{ data: OrgChartNode[]; total: number }>({
    queryKey: ['org-chart'],
    queryFn: () => api.get('/hr/employees/org-chart').then(r => r.data),
  });

export const useEmployeeStats = () =>
  useQuery<EmployeeStats>({
    queryKey: ['employee-stats'],
    queryFn: () => api.get('/hr/employees/stats').then(r => r.data),
  });

export const useExpiringDocuments = (days = 30) =>
  useQuery<{
    certifications: Array<{ id: string; kind: string; name: string; expiresOn: string; employee: { id: string; displayName: string } }>;
    documents: Array<{ id: string; kind: string; name: string; type: string; expiresOn: string; employee: { id: string; displayName: string } }>;
  }>({
    queryKey: ['expiring-docs', days],
    queryFn: () => api.get('/hr/employees/expiring', { params: { days } }).then(r => r.data),
  });

function invalidatePeople(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['employees'] });
  qc.invalidateQueries({ queryKey: ['employee'] });
  qc.invalidateQueries({ queryKey: ['org-chart'] });
  qc.invalidateQueries({ queryKey: ['employee-stats'] });
}

export const useCreateEmployee = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Employee> & { firstName: string; joiningDate: string }) =>
      api.post('/hr/employees', body).then(r => r.data as Employee),
    onSuccess: () => invalidatePeople(qc),
  });
};

export const useUpdateEmployee = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Employee> & { id: string }) =>
      api.patch(`/hr/employees/${id}`, body).then(r => r.data as Employee),
    onSuccess: () => invalidatePeople(qc),
  });
};

export const useRecordExit = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; lastWorkingDate: string; exitType: string; exitReason?: string; resignationDate?: string }) =>
      api.post(`/hr/employees/${id}/exit`, body).then(r => r.data as Employee),
    onSuccess: () => invalidatePeople(qc),
  });
};

export const useDeleteEmployee = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/hr/employees/${id}`).then(r => r.data),
    onSuccess: () => invalidatePeople(qc),
  });
};

// ─── Departments ──────────────────────────────────────────────────────────────

export const useDepartments = () =>
  useQuery<{ data: Department[]; total: number }>({
    queryKey: ['departments'],
    queryFn: () => api.get('/hr/org/departments').then(r => r.data),
  });

export const useDepartmentTree = () =>
  useQuery<{ data: Department[]; total: number }>({
    queryKey: ['department-tree'],
    queryFn: () => api.get('/hr/org/departments/tree').then(r => r.data),
  });

function invalidateOrg(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['departments'] });
  qc.invalidateQueries({ queryKey: ['department-tree'] });
}

export const useCreateDepartment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Department> & { name: string }) =>
      api.post('/hr/org/departments', body).then(r => r.data as Department),
    onSuccess: () => invalidateOrg(qc),
  });
};

export const useUpdateDepartment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Department> & { id: string }) =>
      api.patch(`/hr/org/departments/${id}`, body).then(r => r.data as Department),
    onSuccess: () => invalidateOrg(qc),
  });
};

export const useDeleteDepartment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/hr/org/departments/${id}`).then(r => r.data),
    onSuccess: () => invalidateOrg(qc),
  });
};

// ─── Teams ────────────────────────────────────────────────────────────────────

export const useTeams = () =>
  useQuery<{ data: TeamRecord[]; total: number }>({
    queryKey: ['internal-teams'],
    queryFn: () => api.get('/hr/org/teams').then(r => r.data),
  });

export const useCreateTeam = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string; departmentId?: string | null; leadId?: string | null }) =>
      api.post('/hr/org/teams', body).then(r => r.data as TeamRecord),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['internal-teams'] }),
  });
};

export const useUpdateTeam = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<TeamRecord>) =>
      api.patch(`/hr/org/teams/${id}`, body).then(r => r.data as TeamRecord),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['internal-teams'] }),
  });
};

export const useDeleteTeam = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/hr/org/teams/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['internal-teams'] }),
  });
};

export const useAddTeamMember = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, employeeId, role }: { teamId: string; employeeId: string; role?: string }) =>
      api.post(`/hr/org/teams/${teamId}/members`, { employeeId, role }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['internal-teams'] }),
  });
};

export const useRemoveTeamMember = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, employeeId }: { teamId: string; employeeId: string }) =>
      api.delete(`/hr/org/teams/${teamId}/members/${employeeId}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['internal-teams'] }),
  });
};

// ─── Locations ────────────────────────────────────────────────────────────────

export const useLocations = () =>
  useQuery<{ data: LocationRecord[]; total: number }>({
    queryKey: ['locations'],
    queryFn: () => api.get('/hr/org/locations').then(r => r.data),
  });

export const useCreateLocation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<LocationRecord> & { name: string }) =>
      api.post('/hr/org/locations', body).then(r => r.data as LocationRecord),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations'] }),
  });
};

export const useUpdateLocation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<LocationRecord> & { id: string }) =>
      api.patch(`/hr/org/locations/${id}`, body).then(r => r.data as LocationRecord),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations'] }),
  });
};

export const useDeleteLocation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/hr/org/locations/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations'] }),
  });
};

// ─── Unified People surface ───────────────────────────────────────────────────
//
// One list over the User and Employee tables. They stay separate in the
// database (see server/src/modules/people/people.controller.ts for why), but
// nothing here or in the UI needs to know that — a person either can sign in
// or cannot, and that is a property, not a different kind of record.

export interface Person {
  id: string;
  employeeId: string | null;
  userId: string | null;
  employeeCode: string | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  department: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  manager: { id: string; displayName: string } | null;
  employmentStatus: string | null;
  employmentType: string | null;
  joiningDate: string | null;
  photoUrl: string | null;
  hasLogin: boolean;
  loginActive: boolean;
  role: string | null;
  roleId: string | null;
  roleName: string | null;
}

export interface PeopleStats {
  total: number;
  canSignIn: number;
  noLogin: number;
  onNotice: number;
  activeLogins: number;
  unlinkedLogins: number;
}

export const usePeople = (params: Record<string, string | undefined> = {}) =>
  useQuery<Paged<Person>>({
    queryKey: ['people', params],
    queryFn: () => api.get('/people', { params }).then(r => r.data),
  });

export const usePeopleStats = () =>
  useQuery<PeopleStats>({
    queryKey: ['people-stats'],
    queryFn: () => api.get('/people/stats').then(r => r.data),
  });

function invalidatePeopleViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['people'] });
  qc.invalidateQueries({ queryKey: ['people-stats'] });
  qc.invalidateQueries({ queryKey: ['employees'] });
  qc.invalidateQueries({ queryKey: ['employee-stats'] });
  qc.invalidateQueries({ queryKey: ['org-chart'] });
  qc.invalidateQueries({ queryKey: ['admin-users'] });
}

export interface CreatePersonInput {
  firstName: string;
  lastName?: string;
  designation?: string;
  departmentId?: string | null;
  locationId?: string | null;
  managerId?: string | null;
  phone?: string;
  joiningDate: string;
  employmentType?: string;
  loginMode: 'none' | 'password' | 'invite';
  email?: string;
  password?: string;
  roleId?: string;
}

export const useCreatePerson = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePersonInput) =>
      api.post('/people', body).then(r => r.data as { person: Person; inviteLink: string | null }),
    onSuccess: () => invalidatePeopleViews(qc),
  });
};

export const useGrantLogin = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; email: string; roleId?: string; mode: 'password' | 'invite'; password?: string }) =>
      api.post(`/people/${id}/grant-login`, body).then(r => r.data as { message: string; inviteLink: string | null }),
    onSuccess: () => invalidatePeopleViews(qc),
  });
};

export const useRevokeLogin = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/people/${id}/revoke-login`).then(r => r.data),
    onSuccess: () => invalidatePeopleViews(qc),
  });
};

export const useAssignPersonRole = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, roleId }: { id: string; roleId: string }) =>
      api.post(`/people/${id}/role`, { roleId }).then(r => r.data),
    onSuccess: () => invalidatePeopleViews(qc),
  });
};

export const useRepairUnlinked = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/people/repair-unlinked').then(r => r.data as { created: number; message: string }),
    onSuccess: () => invalidatePeopleViews(qc),
  });
};
