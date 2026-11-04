import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

// Keep these entity/field keys in sync with the server whitelist in
// aiStudio.controller.ts (ENTITY_KEYS / ENTITY_FIELD_KEYS) and with
// useLabels.ts, which is what actually reads this shape in the UI.
export interface LabelOverrides {
  entities?: Partial<Record<'ticket' | 'deal' | 'lead' | 'contact', { singular: string; plural: string }>>;
  fields?: Partial<Record<'ticket' | 'deal' | 'lead' | 'contact', Record<string, string>>>;
}

export interface BusinessContext {
  id?:             string;
  industry?:       string;
  companyDesc?:    string;
  terminology?:    Record<string, string>;
  labelOverrides?: LabelOverrides;
  customSystem?:   string;
  tone?:           'professional' | 'casual' | 'technical';
}

export interface InputField {
  name:     string;
  type:     'text' | 'number' | 'boolean' | 'select';
  label:    string;
  required?: boolean;
  options?:  string[];
}

export interface CustomAIFunction {
  id:           string;
  name:         string;
  description?: string;
  systemPrompt: string;
  inputSchema:  InputField[];
  outputType:   'text' | 'json' | 'number';
  isActive:     boolean;
  runCount:     number;
  createdAt:    string;
}

export interface CustomScript {
  id:           string;
  name:         string;
  description?: string;
  entityType:   string;
  trigger:      string;
  fieldTarget?: string;
  script:       string;
  isActive:     boolean;
  createdAt:    string;
}

// ─── Business Context ─────────────────────────────────────────────────────────

/** GET /ai/studio/context is MANAGERS-only — callers pass `can.readAiConfig(role)`.
 *  (useLabelOverrides below is the ALL_STAFF route and stays ungated.) */
export function useBusinessContext(enabled = true) {
  return useQuery<BusinessContext>({
    queryKey: ['ai-studio-context'],
    queryFn: () => api.get('/ai/studio/context').then(r => r.data),
    enabled,
  });
}

// Separate from useBusinessContext — that hook calls a MANAGERS-only
// endpoint, but every staff member needs relabeled terminology to render
// correctly, not just managers. See getLabelOverrides in
// aiStudio.controller.ts / the /ai/studio/labels route (ALL_STAFF).
export function useLabelOverrides() {
  return useQuery<{ labelOverrides: LabelOverrides | null }>({
    queryKey: ['ai-studio-labels'],
    queryFn: () => api.get('/ai/studio/labels').then(r => r.data),
    staleTime: 5 * 60 * 1000, // labels change rarely — avoid refetching on every page nav
  });
}

export function useSaveBusinessContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: BusinessContext) => api.put('/ai/studio/context', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-studio-context'] }),
  });
}

// ─── Custom AI Functions ──────────────────────────────────────────────────────

export function useCustomFunctions(enabled = true) {
  return useQuery<CustomAIFunction[]>({
    queryKey: ['ai-studio-functions'],
    queryFn: () => api.get('/ai/studio/functions').then(r => r.data),
    enabled,
  });
}

export function useCreateFunction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<CustomAIFunction>) =>
      api.post('/ai/studio/functions', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-studio-functions'] }),
  });
}

export function useUpdateFunction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<CustomAIFunction> & { id: string }) =>
      api.patch(`/ai/studio/functions/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-studio-functions'] }),
  });
}

export function useDeleteFunction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/ai/studio/functions/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-studio-functions'] }),
  });
}

export function useRunFunction() {
  return useMutation({
    mutationFn: ({ id, inputs }: { id: string; inputs: Record<string, unknown> }) =>
      api.post(`/ai/studio/functions/${id}/run`, { inputs }).then(r => r.data),
  });
}

// ─── Custom Scripts ───────────────────────────────────────────────────────────

export function useCustomScripts(entityType?: string, trigger?: string, enabled = true) {
  return useQuery<CustomScript[]>({
    queryKey: ['ai-studio-scripts', entityType, trigger],
    queryFn: () => {
      const params = new URLSearchParams();
      if (entityType) params.set('entityType', entityType);
      if (trigger)    params.set('trigger', trigger);
      return api.get(`/ai/studio/scripts?${params}`).then(r => r.data);
    },
    enabled,
  });
}

export function useCreateScript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<CustomScript>) =>
      api.post('/ai/studio/scripts', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-studio-scripts'] }),
  });
}

export function useUpdateScript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<CustomScript> & { id: string }) =>
      api.patch(`/ai/studio/scripts/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-studio-scripts'] }),
  });
}

export function useDeleteScript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/ai/studio/scripts/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-studio-scripts'] }),
  });
}

export function useValidateScript() {
  return useMutation({
    mutationFn: (script: string) =>
      api.post('/ai/studio/scripts/validate', { script }).then(r => r.data) as
        Promise<{ valid: boolean; error?: string }>,
  });
}

// The old AI Setup Generator hooks (useGenerateSetup/useApplySetup) were
// removed with their endpoints — the AI Solution Builder (api calls in
// pages/SolutionBuilderPage.tsx) covers that flow, writing label overrides
// into the same BusinessContext storage useLabelOverrides reads.
