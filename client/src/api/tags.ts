import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

/**
 * Tags, on any record.
 *
 * One tag library per org (`/tags`) plus a polymorphic attach/detach on any
 * entityType + entityId (`/tags/record/…`) — the same shape comments,
 * attachments and tasks use.
 */

export interface Tag {
  id: string;
  name: string;
  color: string;
  module: string;
  usageCount: number;
}

/** A tag as it appears on a record — no usage count, plus when it was applied. */
export interface RecordTag {
  id: string;
  name: string;
  color: string;
  appliedAt: string;
}

export type TagEntityType =
  | 'DEAL' | 'TICKET' | 'CONTACT' | 'LEAD' | 'ACCOUNT'
  | 'CHANGE_REQUEST' | 'QUOTE' | 'ASSET' | 'CAMPAIGN'
  | 'EMPLOYEE' | 'TASK' | 'APPROVAL_REQUEST' | 'DEPARTMENT' | 'INVOICE';

// ─── The library ──────────────────────────────────────────────────────────────

/**
 * `enabled: false` keeps the library unfetched until something actually needs
 * it. A record view can carry several tag strips, and none of them need the
 * full library until a picker is opened — the chips come from
 * `useRecordTags`.
 */
export function useTags(params?: { search?: string; module?: string }, options?: { enabled?: boolean }) {
  return useQuery<{ data: Tag[]; total: number }>({
    queryKey: ['tags', params ?? {}],
    queryFn: () => api.get('/tags', { params }).then(r => r.data),
    // The library changes rarely and is read by every open record view.
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; color?: string; module?: string }) =>
      api.post('/tags', body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  });
}

export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; color?: string; module?: string }) =>
      api.patch(`/tags/${id}`, body).then(r => r.data),
    // A rename changes the tag on every record at once, so every record's
    // tag list is now stale, not just the library.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['record-tags'] });
    },
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      api.delete(`/tags/${id}`, { params: force ? { force: true } : undefined }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['record-tags'] });
    },
  });
}

export function useMergeTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { sourceId: string; targetId: string }) =>
      api.post('/tags/merge', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['record-tags'] });
    },
  });
}

/** Which records carry a tag, grouped by entity type. */
export function useTagRecords(tagId?: string) {
  return useQuery<{ tag: Pick<Tag, 'id' | 'name' | 'color'>; total: number; byType: Record<string, string[]> }>({
    queryKey: ['tag-records', tagId],
    queryFn: () => api.get(`/tags/${tagId}/records`).then(r => r.data),
    enabled: !!tagId,
  });
}

// ─── Tags on one record ───────────────────────────────────────────────────────

/**
 * ALL_STAFF-only on the server, so callers that render inside views an
 * EMPLOYEE can legitimately open (their own ticket) pass
 * `can.readStaffRecords(role)` rather than firing a certain 403.
 */
export function useRecordTags(entityType?: TagEntityType, entityId?: string, options?: { enabled?: boolean }) {
  return useQuery<RecordTag[]>({
    queryKey: ['record-tags', entityType, entityId],
    queryFn: () => api.get(`/tags/record/${entityType}/${entityId}`).then(r => r.data),
    enabled: !!entityType && !!entityId && (options?.enabled ?? true),
  });
}

/**
 * Attaches a tag by id, or by name — in which case the server creates it if
 * no tag with that name (case-insensitively) exists yet. That is what lets
 * the tag input coin a tag inline instead of sending people to a settings
 * screen first.
 */
export function useAttachTag(entityType: TagEntityType, entityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { tagId?: string; name?: string; color?: string }) =>
      api.post(`/tags/record/${entityType}/${entityId}`, body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['record-tags', entityType, entityId] });
      // A newly coined tag, or a changed usage count, both land in the library.
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useDetachTag(entityType: TagEntityType, entityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tagId: string) =>
      api.delete(`/tags/record/${entityType}/${entityId}/${tagId}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['record-tags', entityType, entityId] });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}
