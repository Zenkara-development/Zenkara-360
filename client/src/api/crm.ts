import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

/** Unwrap paginated response — returns the data array directly.
 *  Server returns { data: [...], pagination: {...} }; r.data is the axios-unwrapped body. */
const unwrap = (r: any) => (Array.isArray(r.data) ? r.data : (r.data?.data ?? r.data));

// ─── Contacts ────────────────────────────────────────────────────────────────
export const useContacts = (params?: Record<string, string>, enabled = true) =>
  useQuery({ queryKey: ['contacts', params], queryFn: () => api.get('/crm/contacts', { params }).then(unwrap), enabled });

// CRM_STAFF-only on the server, like the list endpoint — callers reachable by
// URL from a non-CRM role pass `can.readCrm(role)`.
export const useContact = (id: string, enabled = true) =>
  useQuery({ queryKey: ['contacts', id], queryFn: () => api.get(`/crm/contacts/${id}`).then(r => r.data), enabled: !!id && enabled });

export const useCreateContact = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (data: any) => api.post('/crm/contacts', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }) });
};
export const useUpdateContact = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...data }: any) => api.patch(`/crm/contacts/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }) });
};
export const useDeleteContact = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.delete(`/crm/contacts/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }) });
};

// ─── Accounts ────────────────────────────────────────────────────────────────
// CRM_STAFF-only on the server — see useContacts.
export const useAccounts = (params?: Record<string, string>, enabled = true) =>
  useQuery({ queryKey: ['accounts', params], queryFn: () => api.get('/crm/accounts', { params }).then(unwrap), enabled });

export const useCreateAccount = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (data: any) => api.post('/crm/accounts', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }) });
};
export const useUpdateAccount = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...data }: any) => api.patch(`/crm/accounts/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }) });
};
export const useDeleteAccount = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.delete(`/crm/accounts/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }) });
};

// ─── Leads ───────────────────────────────────────────────────────────────────
export const useLeads = (params?: Record<string, string>, enabled = true) =>
  useQuery({ queryKey: ['leads', params], queryFn: () => api.get('/crm/leads', { params }).then(unwrap), enabled });

export const useCreateLead = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (data: any) => api.post('/crm/leads', data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); qc.invalidateQueries({ queryKey: ['deals'] }); } });
};
export const useUpdateLead = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...data }: any) => api.patch(`/crm/leads/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }) });
};
export const useConvertLead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...rest }: { id: string; dealTitle?: string; dealValue?: string; dealStage?: string; dealProbability?: string }) =>
      api.patch(`/crm/leads/${id}/convert`, rest).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); qc.invalidateQueries({ queryKey: ['deals'] }); qc.invalidateQueries({ queryKey: ['pipeline'] }); },
  });
};
export const useDeleteLead = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.delete(`/crm/leads/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }) });
};

// ─── Deals ───────────────────────────────────────────────────────────────────
export const useDeals = (params?: Record<string, string>) =>
  useQuery({ queryKey: ['deals', params], queryFn: () => api.get('/crm/deals', { params }).then(unwrap) });

// CRM_STAFF-only on the server — see useContacts.
export const usePipeline = (enabled = true) =>
  useQuery({ queryKey: ['pipeline'], queryFn: () => api.get('/crm/deals/pipeline').then(r => r.data), enabled });

// CRM_MANAGERS-only on the server. Callers that render for mixed roles pass
// `can.readCrmReports(role)` so lower-privilege users don't fire a certain 403.
export const useDealReports = (enabled = true) =>
  useQuery({ queryKey: ['deal-reports'], queryFn: () => api.get('/crm/deals/reports').then(r => r.data), enabled });

// Live single-deal query (history + activities included) — keeps an open
// detail panel in sync with mutations instead of holding a stale snapshot
// object passed down from the pipeline/list view.
export const useDeal = (id: string) =>
  useQuery({ queryKey: ['deals', id], queryFn: () => api.get(`/crm/deals/${id}`).then(r => r.data), enabled: !!id });

export const useCreateDeal = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (data: any) => api.post('/crm/deals', data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['deals'] }); qc.invalidateQueries({ queryKey: ['pipeline'] }); } });
};
export const useUpdateDeal = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...data }: any) => api.patch(`/crm/deals/${id}`, data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['deals'] }); qc.invalidateQueries({ queryKey: ['pipeline'] }); } });
};
export const useMoveDealStage = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, stage }: { id: string; stage: string }) => api.patch(`/crm/deals/${id}/stage`, { stage }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['deals'] }); qc.invalidateQueries({ queryKey: ['pipeline'] }); } });
};
export const useDeleteDeal = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.delete(`/crm/deals/${id}`).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['deals'] }); qc.invalidateQueries({ queryKey: ['pipeline'] }); } });
};

// ─── Activities ───────────────────────────────────────────────────────────────
export const useActivities = (params?: Record<string, string>) =>
  useQuery({ queryKey: ['activities', params], queryFn: () => api.get('/crm/activities', { params }).then(r => r.data), enabled: Object.keys(params || {}).length > 0 });

export const useCreateActivity = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/crm/activities', data).then(r => r.data),
    onSuccess: (_data, vars: any) => {
      qc.invalidateQueries({ queryKey: ['activities'] });
      if (vars.contactId) qc.invalidateQueries({ queryKey: ['contacts', vars.contactId] });
      if (vars.leadId) qc.invalidateQueries({ queryKey: ['leads', vars.leadId] });
    },
  });
};
export const useUpdateActivity = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) => api.patch(`/crm/activities/${id}`, data).then(r => r.data),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['activities'] });
      if (data?.leadId) qc.invalidateQueries({ queryKey: ['leads', data.leadId] });
    },
  });
};
export const useDeleteActivity = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.delete(`/crm/activities/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activities'] }) });
};

// ─── Lead detail (includes follow-up activities) ───────────────────────────────
export const useLead = (id: string) =>
  useQuery({ queryKey: ['leads', id], queryFn: () => api.get(`/crm/leads/${id}`).then(r => r.data), enabled: !!id });

// ─── Pipelines (stage management) ──────────────────────────────────────────────
export const usePipelines = () =>
  useQuery({ queryKey: ['pipelines'], queryFn: () => api.get('/crm/pipelines').then(r => r.data) });

export const useAddStage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pipelineId, ...data }: any) => api.post(`/crm/pipelines/${pipelineId}/stages`, data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pipelines'] }); qc.invalidateQueries({ queryKey: ['pipeline'] }); },
  });
};
export const useUpdateStage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pipelineId, label, ...data }: any) => api.patch(`/crm/pipelines/${pipelineId}/stages/${encodeURIComponent(label)}`, data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pipelines'] }); qc.invalidateQueries({ queryKey: ['pipeline'] }); qc.invalidateQueries({ queryKey: ['deals'] }); },
  });
};
export const useRemoveStage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pipelineId, label, reassignTo }: any) =>
      api.delete(`/crm/pipelines/${pipelineId}/stages/${encodeURIComponent(label)}`, { params: reassignTo ? { reassignTo } : undefined }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pipelines'] }); qc.invalidateQueries({ queryKey: ['pipeline'] }); qc.invalidateQueries({ queryKey: ['deals'] }); },
  });
};
export const useReorderStages = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pipelineId, labels }: { pipelineId: string; labels: string[] }) =>
      api.post(`/crm/pipelines/${pipelineId}/stages/reorder`, { labels }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pipelines'] }); qc.invalidateQueries({ queryKey: ['pipeline'] }); },
  });
};
