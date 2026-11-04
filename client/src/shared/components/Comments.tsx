import { useState } from 'react';
import { RichText } from './RichText';
import { RichTextEditor } from './RichTextEditor';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { Send, Trash2, LayoutTemplate } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useReplyTemplates } from '../../api/templates';
import { SearchableSelect } from './SearchableSelect';
import { can } from '../permissions';

interface CommentsProps {
  entityType: 'DEAL' | 'TICKET' | 'CONTACT';
  entityId: string;
}

export function Comments({ entityType, entityId }: CommentsProps) {
  const [body, setBody] = useState('');
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ['comments', entityType, entityId];
  /* /comments/* and /templates/replies are both ALL_STAFF on the server, while
     this panel is embedded in record views an EMPLOYEE legitimately opens
     (their own ticket). Reading and posting are equally out of reach for them,
     so nothing is asked for and the whole thread is left out. */
  const canReadComments = can.readStaffRecords(user?.role);
  // Canned-response picker only makes sense on tickets (support replies).
  const { data: replyTemplates } = useReplyTemplates(canReadComments);
  const showReplyTemplates = entityType === 'TICKET' && (replyTemplates?.length ?? 0) > 0;

  const { data: comments = [] } = useQuery({
    queryKey: key,
    queryFn: () => api.get(`/comments/${entityType}/${entityId}`).then(r => r.data),
    enabled: !!entityId && canReadComments,
  });

  const create = useMutation({
    mutationFn: () => api.post(`/comments/${entityType}/${entityId}`, { body }).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setBody(''); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/comments/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  // After every hook, never before one.
  if (!canReadComments) return null;

  return (
    <div className="border-t border-line-subtle pt-4 mt-4">
      <h3 className="text-sm font-semibold text-fg mb-3">Comments ({comments.length})</h3>

      <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
        {comments.length === 0 && (
          <p className="text-xs text-fg-subtle text-center py-4">Nothing yet. Be the first to add a note.</p>
        )}
        {comments.map((c: any) => (
          <div key={c.id} className="flex gap-2 group">
            <div className="w-7 h-7 rounded-full bg-accent-soft text-accent-soft-fg flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
              {c.author?.name?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 bg-surface-sunken rounded-xl px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-fg">{c.author?.name}</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-fg-subtle">{formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}</span>
                  {c.author?.id === user?.id && (
                    <button onClick={() => remove.mutate(c.id)} className="opacity-0 group-hover:opacity-100 p-0.5 text-fg-subtle hover:text-danger transition-all">
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
              <RichText content={c.body} className="text-sm text-fg-muted mt-0.5" />
            </div>
          </div>
        ))}
      </div>

      {showReplyTemplates && (
        <div className="mb-2 ml-9 flex items-center gap-2">
          <LayoutTemplate size={13} className="text-fg-subtle flex-shrink-0" />
          <div className="flex-1 max-w-xs">
            <SearchableSelect
              ariaLabel="Canned response"
              value=""
              onChange={val => {
                const template = replyTemplates?.find(t => t.id === val);
                if (template) {
                  // Editor state is HTML — wrap the plain-text template in
                  // paragraphs so its line breaks survive setContent().
                  const html = template.body.split(/\n{2,}/).map(p2 => `<p>${p2.replace(/\n/g, '<br>')}</p>`).join('');
                  setBody(prev => (prev.trim() ? `${prev}${html}` : html));
                }
              }}
              options={(replyTemplates ?? []).map(t => ({ value: t.id, label: t.name }))}
              placeholder="Insert canned response…"
            />
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <div className="w-7 h-7 rounded-full bg-accent-soft text-accent-soft-fg flex items-center justify-center text-xs font-bold flex-shrink-0 mt-1">
          {user?.name?.[0]?.toUpperCase()}
        </div>
        <div className="flex-1 flex gap-2">
          <div className="flex-1">
            <RichTextEditor
              value={body}
              onChange={setBody}
              placeholder="Add a comment…"
              minHeight={56}
              ariaLabel="Add a comment"
              onSubmitShortcut={() => body.trim() && create.mutate()}
            />
          </div>
          <button
            onClick={() => body.trim() && create.mutate()}
            disabled={!body.trim() || create.isPending}
            className="self-end p-2 bg-accent hover:bg-accent-hover text-accent-fg rounded-btn disabled:opacity-40 transition-colors"
          >
            <Send size={15} />
          </button>
        </div>
      </div>
      <p className="text-xs text-fg-subtle mt-1 ml-9">Ctrl+Enter to send</p>
    </div>
  );
}
