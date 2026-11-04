import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * The org's active users — the list every "assign to" control is built from.
 *
 * `GET /users` returns a **bare array**, not the `{ data, total }` envelope
 * that paginated endpoints use. That inconsistency has already caused one
 * silent bug: a caller wrote `usersData?.data ?? []`, which is `undefined ??
 * []` against an array, so the assignee dropdown rendered with no options and
 * no error. Nothing failed — the list was just empty.
 *
 * Two things stop that happening again:
 *
 *  1. The return type is `OrgUser[]`, so `.data` on it is a compile error
 *     rather than a runtime shrug.
 *  2. The queryFn normalises anyway, so if the endpoint is ever changed to
 *     return an envelope, every existing caller keeps working.
 */
export interface OrgUser {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string | null;
  avatarUrl: string | null;
}

export const useUsers = () =>
  useQuery<OrgUser[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then(r => {
      const d = r.data;
      return Array.isArray(d) ? d : (d?.data ?? []);
    }),
  });
