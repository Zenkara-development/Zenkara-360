import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface OrgSettings {
  id: string;
  name: string;
  slug: string;
  plan: string;
  currency: string;
  timezone: string;
}

// staleTime is generous — currency/timezone change maybe once ever per org,
// so there's no reason for every page mounting a component that reads this
// to refetch it. useUpdateOrgSettings' onSuccess still invalidates it
// immediately after a real change, so admins editing it see it update.
export const useOrgSettings = () =>
  useQuery({ queryKey: ['org'], queryFn: () => api.get('/org').then(r => r.data as OrgSettings), staleTime: 5 * 60 * 1000 });

export const useUpdateOrgSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Pick<OrgSettings, 'name' | 'currency' | 'timezone'>>) => api.patch('/org', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org'] }),
  });
};
