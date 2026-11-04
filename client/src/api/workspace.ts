/**
 * Workspace identity (platform Phase 1) — the org-level skin that renames or
 * hides parts of the product so a tenant sees "their" system, not a CRM.
 * Read by every user to render the sidebar; written from Workspace Settings.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface WorkspaceConfig {
  /** Product name shown in the sidebar header (falls back to "CRM & IT Desk"). */
  appName?: string;
  /** Nav item + page-title renames, keyed by route ("/itdesk/tickets": "Service Jobs"). */
  navRenames?: Record<string, string>;
  /** Section heading renames ("IT Desk": "Service"). */
  sectionRenames?: Record<string, string>;
  /** Routes whose nav links are hidden for everyone. */
  hiddenRoutes?: string[];
  /** Whole sections hidden for everyone ("HR", "CRM", …). */
  hiddenSections?: string[];
}

export function useWorkspaceConfig() {
  return useQuery({
    queryKey: ['workspace-config'],
    queryFn: () => api.get('/workspace/config').then(r => (r.data?.config ?? null) as WorkspaceConfig | null),
    staleTime: 5 * 60_000,
  });
}

export function useSaveWorkspaceConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: WorkspaceConfig) =>
      api.put('/workspace/config', { config }).then(r => r.data.config as WorkspaceConfig),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace-config'] }),
  });
}

/**
 * The one lookup the whole app uses: rename/hide helpers with safe fallbacks
 * so an unconfigured org (config === null) renders exactly as before.
 */
export function useWorkspace() {
  const { data: config } = useWorkspaceConfig();
  return {
    config: config ?? null,
    appName: config?.appName || 'CRM & IT Desk',
    navLabel: (route: string, fallback: string) => config?.navRenames?.[route] || fallback,
    sectionLabel: (section: string, fallback?: string) => config?.sectionRenames?.[section] || fallback || section,
    isRouteHidden: (route: string) => !!config?.hiddenRoutes?.includes(route),
    isSectionHidden: (section: string | null) => !!(section && config?.hiddenSections?.includes(section)),
  };
}
