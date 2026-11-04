import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

const unwrap = (r: any) => (Array.isArray(r.data) ? r.data : (r.data?.data ?? r.data));

// ─── Modules ─────────────────────────────────────────────────────────────────
/**
 * `enabled` exists because the app shell calls this on every page, to build the
 * sidebar's per-module links. GET /custom-modules is ALL_STAFF, so for an
 * EMPLOYEE it returned 403 on every single navigation. Callers in the shell
 * pass `can.readStaffRecords(role)` rather than firing a request whose answer
 * is already known — an EMPLOYEE cannot read module records either, so there
 * is no link to draw for them in the first place.
 */
export const useCustomModules = (enabled = true) =>
  useQuery({
    queryKey: ['custom-modules'],
    queryFn: () => api.get('/custom-modules').then(r => r.data),
    enabled,
  });

export const useCustomModule = (id?: string, enabled = true) =>
  useQuery({ queryKey: ['custom-modules', id], queryFn: () => api.get(`/custom-modules/${id}`).then(r => r.data), enabled: enabled && !!id });

/** Templates are CRM_MANAGERS on the server, unlike the module list itself
 *  (ALL_STAFF) — callers pass `can.readCrmReports(role)`. */
export const useModuleTemplates = (enabled = true) =>
  useQuery({ queryKey: ['custom-module-templates'], queryFn: () => api.get('/custom-modules/templates').then(r => r.data), staleTime: Infinity, enabled });

export const useCreateCustomModule = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (data: any) => api.post('/custom-modules', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-modules'] }) });
};
export const useUpdateCustomModule = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...data }: any) => api.patch(`/custom-modules/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-modules'] }) });
};
export const useDeleteCustomModule = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.delete(`/custom-modules/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-modules'] }) });
};

// ─── Fields ──────────────────────────────────────────────────────────────────
// Field add/remove change a module's field COUNT, which the sidebar's nav
// injection (AppLayout.tsx) reads off the *list* query (['custom-modules'])
// to decide whether a module is visible yet — invalidating only the single-
// module detail query (['custom-modules', moduleId]) left that list stale,
// so a module could sit with 1+ fields and still never appear in the sidebar
// until something else happened to refetch the list. Update doesn't change
// the count, so it only needs the detail invalidation.
export const useAddModuleField = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ moduleId, ...data }: any) => api.post(`/custom-modules/${moduleId}/fields`, data).then(r => r.data),
    onSuccess: (_d, vars: any) => { qc.invalidateQueries({ queryKey: ['custom-modules', vars.moduleId] }); qc.invalidateQueries({ queryKey: ['custom-modules'], exact: true }); } });
};
export const useUpdateModuleField = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ moduleId, fieldId, ...data }: any) => api.patch(`/custom-modules/${moduleId}/fields/${fieldId}`, data).then(r => r.data),
    onSuccess: (_d, vars: any) => qc.invalidateQueries({ queryKey: ['custom-modules', vars.moduleId] }) });
};
export const useRemoveModuleField = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ moduleId, fieldId }: any) => api.delete(`/custom-modules/${moduleId}/fields/${fieldId}`).then(r => r.data),
    onSuccess: (_d, vars: any) => { qc.invalidateQueries({ queryKey: ['custom-modules', vars.moduleId] }); qc.invalidateQueries({ queryKey: ['custom-modules'], exact: true }); } });
};

// ─── Records ─────────────────────────────────────────────────────────────────
// ALL_STAFF-only on the server — callers pass `can.readStaffRecords(role)`.
export const useModuleRecords = (moduleId?: string, enabled = true) =>
  useQuery({ queryKey: ['custom-module-records', moduleId], queryFn: () => api.get(`/custom-modules/${moduleId}/records`, { params: { limit: 100 } }).then(unwrap), enabled: !!moduleId && enabled });

/** Same page of records, but keeping the full envelope — the Phase 2 list
 *  response also carries `relationTitles` (id → display title for every
 *  RELATION value on the page), which `unwrap` would throw away. */
export const useModuleRecordsFull = (moduleId?: string, enabled = true) =>
  useQuery({
    queryKey: ['custom-module-records', moduleId, 'full'],
    queryFn: () => api.get(`/custom-modules/${moduleId}/records`, { params: { limit: 100 } })
      .then(r => ({ rows: (r.data?.data ?? []) as any[], relationTitles: (r.data?.relationTitles ?? {}) as Record<string, string> })),
    enabled: !!moduleId && enabled,
  });

/** The module dashboard row (Phase 5): totals, weekly inflow, stage distribution, currency sums. */
export const useModuleStats = (moduleId?: string, enabled = true) =>
  useQuery({
    queryKey: ['custom-module-stats', moduleId],
    queryFn: () => api.get(`/custom-modules/${moduleId}/stats`).then(r => r.data as {
      total: number; createdLast7d: number;
      byStage: { key: string; label: string; color?: string; count: number }[];
      currencySums: { fieldKey: string; label: string; sum: number }[];
    }),
    enabled: !!moduleId && enabled,
    staleTime: 30_000,
  });

/** Kanban drag — moves a record to another pipeline stage (fires CUSTOM_RECORD_STAGE_CHANGED workflows server-side). */
export const useSetRecordStage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ moduleId, recordId, stage }: { moduleId: string; recordId: string; stage: string }) =>
      api.patch(`/custom-modules/${moduleId}/records/${recordId}/stage`, { stage }).then(r => r.data),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['custom-module-records', vars.moduleId] }),
  });
};

/** Records elsewhere that point AT this record (reverse relations), grouped by module + field. */
export const useRelatedRecords = (moduleId?: string, recordId?: string, enabled = true) =>
  useQuery({
    queryKey: ['custom-module-related', moduleId, recordId],
    queryFn: () => api.get(`/custom-modules/${moduleId}/records/${recordId}/related`).then(r => r.data as {
      groups: { module: { id: string; name: string; slug: string }; viaField: string; records: { id: string; stage: string | null; title: string }[] }[];
    }),
    enabled: !!moduleId && !!recordId && enabled,
  });

export const useCreateModuleRecord = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ moduleId, data, stage }: any) => api.post(`/custom-modules/${moduleId}/records`, { data, ...(stage ? { stage } : {}) }).then(r => r.data),
    onSuccess: (_d, vars: any) => { qc.invalidateQueries({ queryKey: ['custom-module-records', vars.moduleId] }); qc.invalidateQueries({ queryKey: ['custom-modules'] }); } });
};
export const useUpdateModuleRecord = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ moduleId, recordId, data }: any) => api.patch(`/custom-modules/${moduleId}/records/${recordId}`, { data }).then(r => r.data),
    onSuccess: (_d, vars: any) => qc.invalidateQueries({ queryKey: ['custom-module-records', vars.moduleId] }) });
};
export const useDeleteModuleRecord = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ moduleId, recordId }: any) => api.delete(`/custom-modules/${moduleId}/records/${recordId}`).then(r => r.data),
    onSuccess: (_d, vars: any) => { qc.invalidateQueries({ queryKey: ['custom-module-records', vars.moduleId] }); qc.invalidateQueries({ queryKey: ['custom-modules'] }); } });
};

// ─── External sync ───────────────────────────────────────────────────────────
/** GET /custom-modules/:id/sync is CRM_MANAGERS — callers pass `can.readCrmReports(role)`. */
export const useSyncConfig = (moduleId?: string, enabled = true) =>
  useQuery({ queryKey: ['custom-module-sync', moduleId], queryFn: () => api.get(`/custom-modules/${moduleId}/sync`).then(r => r.data), enabled: enabled && !!moduleId });

export const useSaveSyncConfig = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ moduleId, ...data }: any) => api.put(`/custom-modules/${moduleId}/sync`, data).then(r => r.data),
    onSuccess: (_d, vars: any) => qc.invalidateQueries({ queryKey: ['custom-module-sync', vars.moduleId] }) });
};
export const useDeleteSyncConfig = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (moduleId: string) => api.delete(`/custom-modules/${moduleId}/sync`).then(r => r.data),
    onSuccess: (_d, moduleId: string) => qc.invalidateQueries({ queryKey: ['custom-module-sync', moduleId] }) });
};
export const useTriggerSync = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (moduleId: string) => api.post(`/custom-modules/${moduleId}/sync/run`).then(r => r.data),
    onSuccess: (_d, moduleId: string) => { qc.invalidateQueries({ queryKey: ['custom-module-sync', moduleId] }); qc.invalidateQueries({ queryKey: ['custom-module-records', moduleId] }); } });
};
