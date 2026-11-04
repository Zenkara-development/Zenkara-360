import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export type ScheduleEntityType = 'TICKET' | 'DEAL';
export type RecipientType = 'CONTACT' | 'ASSIGNEE' | 'CUSTOM_NUMBER' | 'ORG_DEFAULT';
export type Recurrence = 'NONE' | 'DAILY' | 'WEEKLY';
export type ScheduleStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface Schedule {
  id: string;
  entityType: ScheduleEntityType;
  entityId: string;
  dueAt: string;
  recurrence: Recurrence;
  message: string;
  recipientType: RecipientType;
  customNumber?: string | null;
  status: ScheduleStatus;
  lastError?: string | null;
  createdBy: string;
  createdAt: string;
  sentAt?: string | null;
  creator?: { id: string; name: string };
}

export interface CreateScheduleInput {
  entityType: ScheduleEntityType;
  entityId: string;
  dueAt: string; // ISO string
  recurrence: Recurrence;
  message: string;
  recipientType: RecipientType;
  customNumber?: string;
}

/** Reminders for one specific ticket or deal.
 *  ALL_STAFF-only on the server — callers rendered inside views an EMPLOYEE
 *  can open pass `can.readStaffRecords(role)`. */
export function useSchedules(entityType: ScheduleEntityType, entityId?: string, enabled = true) {
  return useQuery<Schedule[]>({
    queryKey: ['schedules', entityType, entityId],
    queryFn: () => api.get('/schedules', { params: { entityType, entityId } }).then(r => r.data),
    enabled: !!entityId && enabled,
  });
}

/** Org-wide upcoming reminders, for a dashboard/automation-page widget. */
export function useUpcomingSchedules() {
  return useQuery<Schedule[]>({
    queryKey: ['schedules-upcoming'],
    queryFn: () => api.get('/schedules/upcoming').then(r => r.data),
  });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateScheduleInput) => api.post('/schedules', data).then(r => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['schedules', vars.entityType, vars.entityId] });
      qc.invalidateQueries({ queryKey: ['schedules-upcoming'] });
    },
  });
}

export function useCancelSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/schedules/${id}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['schedules-upcoming'] });
    },
  });
}
