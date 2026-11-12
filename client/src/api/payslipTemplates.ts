import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export type LayoutKey = 'STANDARD' | 'MODERN' | 'MINIMAL' | 'DETAILED' | 'COMPACT' | 'CORPORATE' | 'BRANCH' | 'STATEMENT' | 'CUSTOM_HTML';
export interface LayoutInfo { key: LayoutKey; name: string; description: string; defaults: Record<string, boolean> }
export interface FieldInfo { key: string; label: string; group: 'Employee' | 'Blocks'; default: boolean }
export interface Applicability { departmentIds?: string[]; locationIds?: string[]; employmentTypes?: string[]; userIds?: string[] }
export interface PayslipTemplate {
  id: string; name: string; layout: LayoutKey; isDefault: boolean; isActive: boolean;
  companyName: string | null; companyAddress: string | null; logoUrl: string | null;
  primaryColor: string; accentColor: string | null; headerTitle: string; headerNote: string | null; footerNote: string | null;
  showSignature: boolean; signatureLabel: string; signatoryName: string | null; signatureUrl: string | null;
  showFields: Record<string, boolean> | null; applicability: Applicability | null;
  payslipCount?: number; createdAt: string; updatedAt: string;
  /** True for a template the administrator wrote their own HTML for. */
  isCustom?: boolean;
}
export type TemplateInput = Omit<PayslipTemplate, 'id' | 'payslipCount' | 'createdAt' | 'updatedAt'>;

/** A custom template's own markup and stylesheet. */
export interface CustomPayload {
  html: string;
  css: string;
  orientation?: 'portrait' | 'landscape';
  fontFamily?: string;
}

/** A placeholder a custom template may use. */
export interface CustomVariable {
  key: string;
  label: string;
  group: 'Employee' | 'Payslip' | 'Attendance' | 'Totals' | 'Company' | 'Blocks';
  hint?: string;
}

export interface CustomMeta {
  layout: string;
  variables: CustomVariable[];
  maxHtmlChars: number;
  maxCssChars: number;
}

export const usePayslipTemplates = () => useQuery<{ templates: PayslipTemplate[]; layouts: LayoutInfo[]; fields: FieldInfo[]; custom: CustomMeta }>({
  queryKey: ['payslip-templates'], queryFn: () => api.get('/hr/payroll/templates').then(r => r.data),
});

/** The ready-made template the custom designer opens with. */
export const useCustomStarter = (enabled = true) => useQuery<{ html: string; css: string; variables: CustomVariable[] }>({
  queryKey: ['payslip-custom-starter'],
  queryFn: () => api.get('/hr/payroll/templates/custom-starter').then(r => r.data),
  enabled, staleTime: 60 * 60_000,
});

const inv = (qc: ReturnType<typeof useQueryClient>) => { qc.invalidateQueries({ queryKey: ['payslip-templates'] }); qc.invalidateQueries({ queryKey: ['payslip-template'] }); };
export function useSaveTemplate() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...d }: Partial<TemplateInput> & { id?: string }) => (id ? api.put(`/hr/payroll/templates/${id}`, d) : api.post('/hr/payroll/templates', d)).then(r => r.data), onSuccess: () => inv(qc) }); }
export function useDeleteTemplate() { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api.delete(`/hr/payroll/templates/${id}`).then(r => r.data), onSuccess: () => inv(qc) }); }
export function useDuplicateTemplate() { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api.post(`/hr/payroll/templates/${id}/duplicate`).then(r => r.data), onSuccess: () => inv(qc) }); }

/** Preview HTML of an unsaved template (debounced by the caller via the query key). */
export const useTemplatePreview = (draft: Partial<TemplateInput> | null, payslipId?: string) => useQuery<{ html: string }>({
  queryKey: ['payslip-template-preview', draft, payslipId ?? ''],
  queryFn: () => api.post('/hr/payroll/templates/preview', draft, { params: { payslipId } }).then(r => r.data),
  enabled: !!draft, placeholderData: prev => prev, staleTime: 60_000,
});

export const usePayslipHtml = (id?: string, templateId?: string) => useQuery<{ html: string; template: { layout: LayoutKey } }>({
  queryKey: ['payslip-html', id, templateId ?? ''],
  queryFn: () => api.get(`/hr/payroll/payslips/${id}/html`, { params: { embed: '1', templateId } }).then(r => r.data),
  enabled: !!id,
});

/** Fetch a PDF through the authenticated client and hand it to the browser. */
export async function downloadPdf(path: string, filename: string, open = false) {
  const res = await api.get(path, { responseType: 'blob', timeout: 120_000 });
  const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
  if (open) window.open(url, '_blank');
  else { const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The same, for a PDF that is generated from a body (an unsaved draft). */
export async function downloadPdfPost(path: string, body: unknown, filename: string, open = false) {
  const res = await api.post(path, body, { responseType: 'blob', timeout: 120_000 });
  const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
  if (open) window.open(url, '_blank');
  else { const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export function useEmailPayslip() { const qc = useQueryClient(); return useMutation({ mutationFn: (id: string) => api.post(`/hr/payroll/payslips/${id}/email`).then(r => r.data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['payroll-run'] }); qc.invalidateQueries({ queryKey: ['payslips'] }); } }); }
export function useEmailRun() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, onlyUnsent = true }: { id: string; onlyUnsent?: boolean }) => api.post(`/hr/payroll/runs/${id}/email`, { onlyUnsent }).then(r => r.data as { sent: number; skipped: number; failed: { id: string; reason?: string }[] }), onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll-run'] }) }); }
