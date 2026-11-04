import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export type DayStatus = 'PRESENT' | 'LATE' | 'HALF_DAY' | 'ABSENT' | 'LEAVE' | 'UNPAID_LEAVE' | 'WFH' | 'HOLIDAY' | 'WEEK_OFF' | 'LOP';
export interface LateBand { untilMinutes: number | null; status: 'PRESENT' | 'LATE' | 'HALF_DAY' | 'ABSENT' }
export interface PolicyGroup {
  id: string; name: string; isDefault: boolean; isActive: boolean; shiftStart: string; shiftEnd: string; timezone: string | null;
  graceMinutes: number; lateBands: LateBand[] | null; minFullDayMinutes: number; minHalfDayMinutes: number;
  earlyDepartureGraceMinutes: number; earlyDepartureStatus: 'NONE' | 'HALF_DAY'; overtimeAfterMinutes: number; overtimeMinMinutes: number;
  lateAllowedPerMonth: number; lateConversionEvery: number; lateConversionUnit: 'HALF_DAY' | 'LOP' | 'NONE'; weeklyOffs: number[];
  assumeShiftEndOnMissingCheckout: boolean; applicability: { departmentIds?: string[]; locationIds?: string[]; employmentTypes?: string[]; userIds?: string[] } | null;
}
export interface Holiday { id: string; date: string; name: string; locationIds: string[]; isOptional: boolean }
export interface RegisterDay { date: string; status: DayStatus; source: 'COMPUTED' | 'MANUAL'; paidFraction: number; workedMinutes: number; lateMinutes: number; earlyMinutes: number; overtimeMinutes: number; firstInAt: string | null; lastOutAt: string | null; reason: string | null; notes: string | null; leaveRequestId: string | null }
export interface Summary { daysInPeriod: number; workingDays: number; presentDays: number; halfDays: number; leaveDays: number; unpaidLeaveDays: number; absentDays: number; lopDays: number; paidDays: number; lateCount: number; lateConversion: { note: string; extraLopDays: number }; overtimeHours: number; byStatus: Record<string, number>; policyGroupName?: string }
export interface RegisterRow { user: { id: string; name: string; avatarUrl?: string | null; department?: string | null }; policyGroup: string; days: RegisterDay[]; summary: Summary }
export interface AuditRow { id: string; date: string | null; entityType: string; action: string; before: any; after: any; reason: string | null; changedAt: string; changer: { id: string; name: string }; user: { id: string; name: string } }

export const STATUS_LABEL: Record<DayStatus, string> = { PRESENT: 'Present', LATE: 'Late', HALF_DAY: 'Half day', ABSENT: 'Absent', LEAVE: 'Leave', UNPAID_LEAVE: 'Unpaid leave', WFH: 'WFH', HOLIDAY: 'Holiday', WEEK_OFF: 'Week off', LOP: 'LOP' };
export const STATUS_SHORT: Record<DayStatus, string> = { PRESENT: 'P', LATE: 'L', HALF_DAY: '½', ABSENT: 'A', LEAVE: 'LV', UNPAID_LEAVE: 'UL', WFH: 'W', HOLIDAY: 'H', WEEK_OFF: 'O', LOP: 'X' };
export const STATUS_CLASS: Record<DayStatus, string> = {
  PRESENT: 'bg-success/15 text-success', LATE: 'bg-warning/20 text-warning', HALF_DAY: 'bg-warning/10 text-warning', ABSENT: 'bg-danger/15 text-danger',
  LEAVE: 'bg-info/15 text-info', UNPAID_LEAVE: 'bg-danger/10 text-danger', WFH: 'bg-accent-soft text-accent', HOLIDAY: 'bg-surface-sunken text-fg-subtle', WEEK_OFF: 'bg-surface-sunken text-fg-subtle', LOP: 'bg-danger/20 text-danger',
};

export const usePolicyGroups = () => useQuery<{ groups: PolicyGroup[]; defaultLateBands: LateBand[] }>({ queryKey: ['attendance-policy-groups'], queryFn: () => api.get('/hr/attendance/policy-groups').then(r => r.data) });
export const useMyPolicy = (enabled = true) => useQuery<any>({ queryKey: ['attendance-my-policy'], queryFn: () => api.get('/hr/attendance/my-policy').then(r => r.data), enabled, staleTime: 5 * 60_000 });
export const useHolidays = (year: number) => useQuery<Holiday[]>({ queryKey: ['holidays', year], queryFn: () => api.get('/hr/attendance/holidays', { params: { year } }).then(r => r.data) });
export const useRegister = (month: string, userId?: string, includeEmployees?: boolean) => useQuery<{ from: string; to: string; rows: RegisterRow[] }>({
  queryKey: ['attendance-register', month, userId ?? '', !!includeEmployees],
  queryFn: () => api.get('/hr/attendance/register', { params: { month, userId, includeEmployees: includeEmployees ? '1' : undefined } }).then(r => r.data),
});
export const useAttendanceAudit = (userId?: string) => useQuery<AuditRow[]>({ queryKey: ['attendance-audit', userId ?? ''], queryFn: () => api.get('/hr/attendance/audit', { params: { userId } }).then(r => r.data) });

const inv = (qc: ReturnType<typeof useQueryClient>) => { qc.invalidateQueries({ queryKey: ['attendance-register'] }); qc.invalidateQueries({ queryKey: ['attendance-audit'] }); qc.invalidateQueries({ queryKey: ['attendance-me'] }); };

export function useSavePolicyGroup() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...d }: Partial<PolicyGroup> & { id?: string }) => (id ? api.put(`/hr/attendance/policy-groups/${id}`, d) : api.post('/hr/attendance/policy-groups', d)).then(r => r.data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['attendance-policy-groups'] }); qc.invalidateQueries({ queryKey: ['attendance-register'] }); } }); }
export function useDeletePolicyGroup() { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api.delete(`/hr/attendance/policy-groups/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance-policy-groups'] }) }); }
export function useSaveHoliday() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...d }: Partial<Holiday> & { id?: string }) => (id ? api.put(`/hr/attendance/holidays/${id}`, d) : api.post('/hr/attendance/holidays', d)).then(r => r.data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['holidays'] }); qc.invalidateQueries({ queryKey: ['attendance-register'] }); } }); }
export function useDeleteHoliday() { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api.delete(`/hr/attendance/holidays/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['holidays'] }); qc.invalidateQueries({ queryKey: ['attendance-register'] }); } }); }
export function useMarkDay() { const qc = useQueryClient(); return useMutation({ mutationFn: (d: { userId: string; date: string; status: DayStatus; checkInAt?: string | null; checkOutAt?: string | null; notes?: string; reason: string }) => api.post('/hr/attendance/days', d).then(r => r.data), onSuccess: () => inv(qc) }); }
export function useResetDay() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ userId, date, reason }: { userId: string; date: string; reason?: string }) => api.delete(`/hr/attendance/days/${userId}/${date}`, { data: { reason } }).then(r => r.data), onSuccess: () => inv(qc) }); }
export function useConvertToLeave() { const qc = useQueryClient(); return useMutation({ mutationFn: (d: { userId: string; date: string; leaveTypeId: string; halfDay?: boolean; halfDayPeriod?: 'AM' | 'PM'; reason: string }) => api.post('/hr/leave/convert', d).then(r => r.data), onSuccess: () => { inv(qc); qc.invalidateQueries({ queryKey: ['leave-requests'] }); } }); }
