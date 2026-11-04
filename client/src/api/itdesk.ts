import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

const unwrap = (r: any) => (Array.isArray(r.data) ? r.data : (r.data?.data ?? r.data));

// ─── Tickets ─────────────────────────────────────────────────────────────────
export const useTickets = (params?: Record<string, string>) =>
  useQuery({ queryKey: ['tickets', params], queryFn: () => api.get('/itdesk/tickets', { params }).then(unwrap) });

export const useTicket = (id: string) =>
  useQuery({ queryKey: ['tickets', id], queryFn: () => api.get(`/itdesk/tickets/${id}`).then(r => r.data), enabled: !!id });

// IT_MANAGERS-only on the server. Callers that render for mixed roles pass
// `can.readTicketReports(role)` so lower-privilege users don't fire a certain 403.
export const useTicketReports = (enabled = true) =>
  useQuery({ queryKey: ['ticket-reports'], queryFn: () => api.get('/itdesk/tickets/reports').then(r => r.data), enabled });

export const useCreateTicket = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (data: any) => api.post('/itdesk/tickets', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }) });
};
export const useUpdateTicket = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...data }: any) => api.patch(`/itdesk/tickets/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }) });
};
export const useChangeTicketStatus = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/itdesk/tickets/${id}/status`, { status }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }) });
};
export const useAssignTicket = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, assignedTo }: { id: string; assignedTo: string }) => api.patch(`/itdesk/tickets/${id}/assign`, { assignedTo }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }) });
};
export const useDeleteTicket = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.delete(`/itdesk/tickets/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }) });
};

// ─── Categories ──────────────────────────────────────────────────────────────
export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => api.get('/itdesk/categories').then(r => r.data) });

export const useCreateCategory = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (data: any) => api.post('/itdesk/categories', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }) });
};
export const useUpdateCategory = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...data }: any) => api.patch(`/itdesk/categories/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }) });
};
export const useDeleteCategory = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.delete(`/itdesk/categories/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }) });
};

// ─── SLA Policies ────────────────────────────────────────────────────────────
// IT_STAFF-only on the server. Callers that render for mixed roles pass
// `can.readSla(role)` so CRM/EMPLOYEE users don't fire a certain 403.
export const useSLAPolicies = (enabled = true) =>
  useQuery({ queryKey: ['sla-policies'], queryFn: () => api.get('/itdesk/sla-policies').then(r => r.data), enabled });

export const useCreateSLAPolicy = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (data: any) => api.post('/itdesk/sla-policies', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sla-policies'] }) });
};
export const useUpdateSLAPolicy = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...data }: any) => api.patch(`/itdesk/sla-policies/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sla-policies'] }) });
};
export const useDeleteSLAPolicy = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.delete(`/itdesk/sla-policies/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sla-policies'] }) });
};

// ─── Articles ─────────────────────────────────────────────────────────────────
export const useArticles = (params?: Record<string, string>) =>
  useQuery({ queryKey: ['articles', params], queryFn: () => api.get('/itdesk/articles', { params }).then(unwrap) });

export interface ArticleSuggestion {
  id: string;
  title: string;
  snippet: string;
  body: string;
  category: { id: string; name: string } | null;
}

/**
 * Deflection lookup for the ticket create form. `q` should already be
 * debounced by the caller; below 4 characters the query never fires.
 * `placeholderData` keeps the previous suggestions on screen while the next
 * keystroke's batch loads, so the panel doesn't flicker empty mid-typing.
 */
export const useArticleSuggestions = (q: string) =>
  useQuery({
    queryKey: ['article-suggest', q],
    queryFn: () => api.get('/itdesk/articles/suggest', { params: { q } })
      .then(r => r.data.suggestions as ArticleSuggestion[]),
    enabled: q.trim().length >= 4,
    staleTime: 60_000,
    placeholderData: prev => prev,
  });

export const useCreateArticle = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (data: any) => api.post('/itdesk/articles', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['articles'] }) });
};
export const useUpdateArticle = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...data }: any) => api.patch(`/itdesk/articles/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['articles'] }) });
};
export const useDeleteArticle = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.delete(`/itdesk/articles/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['articles'] }) });
};
