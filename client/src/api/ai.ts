import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export const useScoreLead = () =>
  useMutation({
    mutationFn: (id: string) => api.post(`/ai/lead/${id}/score`).then(r => r.data as { score: number; reason: string }),
  });

export const useLeadFollowUp = () =>
  useMutation({
    mutationFn: (id: string) => api.post(`/ai/lead/${id}/follow-up`).then(r => r.data as { subject: string; body: string }),
  });

export const useDealFollowUp = () =>
  useMutation({
    mutationFn: (id: string) => api.post(`/ai/deal/${id}/follow-up`).then(r => r.data as { subject: string; body: string }),
  });

export const useTicketSentiment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/ai/ticket/${id}/sentiment`).then(r => r.data as { sentiment: string }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
  });
};

export const useTicketReply = () =>
  useMutation({
    mutationFn: (id: string) => api.post(`/ai/ticket/${id}/reply`).then(r => r.data as { reply: string }),
  });

export const useNLQuery = () =>
  useMutation({
    mutationFn: (question: string) => api.post('/ai/query', { question }).then(r => r.data as { answer: string; question: string }),
  });

export const useKbArticle = () =>
  useMutation({ mutationFn: (id: string) => api.post(`/ai/ticket/${id}/kb-article`).then(r => r.data as { title: string; body: string }) });

export const useInvoiceReminder = () =>
  useMutation({ mutationFn: (id: string) => api.post(`/ai/invoice/${id}/reminder`).then(r => r.data as { subject: string; body: string }) });

export const useDetectDuplicates = () =>
  useMutation({ mutationFn: (data: { title: string; body?: string }) => api.post('/ai/ticket/check-duplicate', data).then(r => r.data as { duplicates: Array<{ id: string; title: string; confidence: number; reason: string }> }) });

export const useSummarizeThread = () =>
  useMutation({ mutationFn: (id: string) => api.post(`/ai/ticket/${id}/summarize`).then(r => r.data as { summary: string }) });

export const useEstimateResolution = () =>
  useMutation({ mutationFn: (id: string) => api.post(`/ai/ticket/${id}/estimate`).then(r => r.data as { hours: number; label: string; reason: string }) });

export const useSlaRisk = () =>
  useMutation({ mutationFn: (id: string) => api.post(`/ai/ticket/${id}/sla-risk`).then(r => r.data as { risk: string; score: number; reason: string }) });

export const useWinProbability = () =>
  useMutation({ mutationFn: (id: string) => api.post(`/ai/deal/${id}/win-probability`).then(r => r.data as { probability: number; factors: string[]; recommendation: string }) });

export const usePipelineHealth = () =>
  useMutation({ mutationFn: () => api.post('/ai/pipeline/health').then(r => r.data as { summary: string; risks: string[]; opportunities: string[] }) });

export const useChurnRisk = () =>
  useMutation({ mutationFn: (id: string) => api.post(`/ai/contact/${id}/churn-risk`).then(r => r.data as { risk: string; score: number; reason: string }) });

export const useNurtureSequence = () =>
  useMutation({ mutationFn: (id: string) => api.post(`/ai/lead/${id}/nurture-sequence`).then(r => r.data as { sequence: Array<{ day: number; subject: string; body: string }> }) });

export const useMeetingNotes = () =>
  useMutation({ mutationFn: (notes: string) => api.post('/ai/meeting-notes', { notes }).then(r => r.data) });

export const useAiInsights = () =>
  useMutation({ mutationFn: () => api.post('/ai/insights').then(r => r.data as { insights: Array<{ type: string; title: string; description: string; action?: string }> }) });

export const useToneCheck = () =>
  useMutation({ mutationFn: (data: { subject: string; body: string; context?: string }) => api.post('/ai/tone-check', data).then(r => r.data) });

export const useNlCommand = () =>
  useMutation({ mutationFn: (command: string) => api.post('/ai/command', { command }).then(r => r.data as { intent: string; entity: string; fields: Record<string, any>; confidence: number; explanation: string }) });

// ─── AI Actions (whitelisted "do it for me" commands) ─────────────────────────

export interface AiActionPlan {
  action: string | null;
  label?: string;
  params: Record<string, any>;
  confidence: number;
  explanation: string;
  allowed: boolean;
  requiresConfirmation: boolean;
}

// "What can I say" help panel data — no LLM call, safe to cache for the
// whole session (staleTime: Infinity). Role-filtered server-side, so this
// only ever shows actions the logged-in user could actually run.
export interface AiActionMenuItem {
  name: string;
  label: string;
  description: string;
  example: string;
}
export interface AiActionMenu {
  actions: AiActionMenuItem[];
  legacy: Array<{ entity: string; label: string; example: string }>;
}
export const useAiActionsMenu = (enabled = true) =>
  useQuery({ queryKey: ['ai-actions-menu'], queryFn: () => api.get('/ai/actions').then(r => r.data as AiActionMenu), staleTime: Infinity, enabled });

export const usePlanAiAction = () =>
  useMutation({
    mutationFn: (command: string) => api.post('/ai/actions/plan', { command }).then(r => r.data as AiActionPlan),
  });

export const useExecuteAiAction = () =>
  useMutation({
    mutationFn: (data: { action: string; params: Record<string, any>; command?: string }) =>
      api.post('/ai/actions/execute', data).then(r => r.data as { summary: string; data?: unknown }),
  });

// AI Feature Builder hooks
/** GET /ai/rules is MANAGERS-only — callers pass `can.readAiConfig(role)`. */
export function useAIRules(enabled = true) {
  return useQuery({ queryKey: ['ai-rules'], queryFn: () => api.get('/ai/rules').then(r => r.data), enabled });
}

export function useCreateAIRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/ai/rules', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-rules'] }),
  });
}

export function useUpdateAIRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) => api.patch(`/ai/rules/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-rules'] }),
  });
}

export function useDeleteAIRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/ai/rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-rules'] }),
  });
}

export function useRunAIRule() {
  return useMutation({
    mutationFn: ({ id, ...data }: any) => api.post(`/ai/rules/${id}/run`, data).then(r => r.data),
  });
}

export function useBulkScoreLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/ai/leads/bulk-score').then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}
