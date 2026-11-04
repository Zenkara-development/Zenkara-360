import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

const unwrap = (r: any) => (Array.isArray(r.data) ? r.data : (r.data?.data ?? r.data));

// ─── Record templates (pre-fill Ticket/Contact/Deal/Lead create forms) ────────

export interface RecordTemplate {
  id: string;
  entityType: 'TICKET' | 'CONTACT' | 'DEAL' | 'LEAD';
  name: string;
  description: string | null;
  fieldValues: Record<string, any>;
  customFieldValues: Record<string, any> | null;
}

// ALL_STAFF-only on the server. Callers embedded in views an EMPLOYEE can open
// pass `can.readStaffRecords(role)` so they don't fire a certain 403.
export const useRecordTemplates = (entityType: string, enabled = true) =>
  useQuery<RecordTemplate[]>({
    queryKey: ['record-templates', entityType],
    queryFn: () => api.get('/templates/records', { params: { entityType } }).then(unwrap),
    enabled: !!entityType && enabled,
  });

export const useCreateRecordTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/templates/records', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['record-templates'] }),
  });
};
export const useUpdateRecordTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) => api.patch(`/templates/records/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['record-templates'] }),
  });
};
export const useDeleteRecordTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/templates/records/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['record-templates'] }),
  });
};

/** Merges a chosen RecordTemplate into current form + custom-field state. */
export function applyRecordTemplate(
  template: RecordTemplate,
  setForm: (updater: (prev: any) => any) => void,
  setCustomValues: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
) {
  setForm(prev => ({ ...prev, ...template.fieldValues }));
  if (template.customFieldValues) {
    const values = template.customFieldValues;
    setCustomValues(prev => ({ ...prev, ...values }));
  }
}

// ─── Reply templates (ticket canned responses) ────────────────────────────────

export interface ReplyTemplate { id: string; name: string; body: string; }

// ALL_STAFF-only on the server — see useRecordTemplates.
export const useReplyTemplates = (enabled = true) =>
  useQuery<ReplyTemplate[]>({
    queryKey: ['reply-templates'],
    queryFn: () => api.get('/templates/replies').then(unwrap),
    enabled,
  });

export const useCreateReplyTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/templates/replies', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reply-templates'] }),
  });
};
export const useUpdateReplyTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) => api.patch(`/templates/replies/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reply-templates'] }),
  });
};
export const useDeleteReplyTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/templates/replies/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reply-templates'] }),
  });
};

// ─── Email templates (campaigns) ──────────────────────────────────────────────

export interface EmailTemplate { id: string; name: string; subject: string; body: string; }

// ALL_STAFF-only on the server — see useRecordTemplates. Callers rendered for
// mixed roles pass `can.manageTemplates(role)`.
export const useEmailTemplates = (enabled = true) =>
  useQuery<EmailTemplate[]>({
    queryKey: ['email-templates'],
    queryFn: () => api.get('/templates/emails').then(unwrap),
    enabled,
  });

export const useCreateEmailTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/templates/emails', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-templates'] }),
  });
};
export const useUpdateEmailTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) => api.patch(`/templates/emails/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-templates'] }),
  });
};
export const useDeleteEmailTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/templates/emails/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-templates'] }),
  });
};

// ─── Quote templates ───────────────────────────────────────────────────────────

export interface QuoteTemplateLine { description: string; quantity: number; unitPrice: number; discount?: number; }
export interface QuoteTemplate { id: string; name: string; description: string | null; lines: QuoteTemplateLine[]; }

// ALL_STAFF-only on the server — see useRecordTemplates.
export const useQuoteTemplates = (enabled = true) =>
  useQuery<QuoteTemplate[]>({
    queryKey: ['quote-templates'],
    queryFn: () => api.get('/templates/quotes').then(unwrap),
    enabled,
  });

export const useCreateQuoteTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/templates/quotes', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quote-templates'] }),
  });
};
export const useUpdateQuoteTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) => api.patch(`/templates/quotes/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quote-templates'] }),
  });
};
export const useDeleteQuoteTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/templates/quotes/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quote-templates'] }),
  });
};
