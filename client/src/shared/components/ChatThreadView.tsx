/**
 * ChatThreadView — the message pane of a team-chat thread, reused by the
 * Chat page (DMs) and the record detail panel (per-ticket/deal threads).
 * Live: SSE invalidates ['chat-messages', threadId] on every new message.
 * "@ai …" messages summon the assistant into the thread for everyone.
 */
import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useChatMessages, useSendChatMessage } from '../../api/chat';
import { RichText } from './RichText';
import { formatDistanceToNow } from 'date-fns';

export function ChatThreadView({ threadId, compact = false }: { threadId: string | undefined; compact?: boolean }) {
  const { user } = useAuth();
  const { data, isLoading } = useChatMessages(threadId);
  const send = useSendChatMessage();
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [data?.messages?.length]);

  async function submit() {
    const body = draft.trim();
    if (!body || !threadId || send.isPending) return;
    setDraft('');
    await send.mutateAsync({ threadId, body });
  }

  if (!threadId) return null;

  return (
    <div className={`flex flex-col ${compact ? 'h-72' : 'h-full'}`}>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-canvas">
        {isLoading ? (
          <div className="space-y-2" aria-hidden="true">
            <div className="skeleton h-10 w-3/5" />
            <div className="skeleton h-10 w-1/2 ml-auto" />
          </div>
        ) : data?.messages?.length ? (
          data.messages.map(m => {
            const mine = m.authorId === user?.id;
            return (
              <div key={m.id} className={mine ? 'flex justify-end' : 'flex justify-start'}>
                <div className={`max-w-[80%] rounded-card px-3 py-1.5 ${
                  m.isAssistant
                    ? 'bg-accent-soft/60 border border-accent/25'
                    : mine
                      ? 'bg-accent text-accent-fg'
                      : 'bg-surface border border-line-subtle'
                }`}>
                  <div className={`flex items-baseline gap-2 ${mine && !m.isAssistant ? 'text-accent-fg/80' : 'text-fg-subtle'}`}>
                    <span className="text-[11px] font-semibold flex items-center gap-1">
                      {m.isAssistant && <Sparkles size={10} className="text-accent" />}
                      {m.isAssistant ? 'AI Assistant' : mine ? 'You' : m.author?.name ?? 'Someone'}
                    </span>
                    <span className="text-[10px]">{formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}</span>
                  </div>
                  {mine && !m.isAssistant
                    ? <div className="text-[13px] leading-relaxed whitespace-pre-wrap [&_p]:m-0">
                        <RichText content={m.body} className="text-[13px] !text-accent-fg [&_*]:!text-accent-fg" />
                      </div>
                    : <RichText content={m.body} className="text-[13px]" />}
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-center text-[12.5px] text-fg-subtle pt-6">
            No messages yet — say hello, or type <span className="font-medium text-fg-muted">@ai</span> to bring the assistant in.
          </p>
        )}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={e => { e.preventDefault(); submit(); }}
        className="flex items-center gap-2 px-3 py-2 border-t border-line-subtle bg-surface"
      >
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder='Message… ("@ai …" asks the assistant)'
          aria-label="Chat message"
          className="flex-1 h-ctl-sm px-2.5 rounded-btn border border-line bg-surface text-[13px] text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent-ring"
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={!draft.trim() || send.isPending}
          className="p-2 bg-accent hover:bg-accent-hover text-accent-fg rounded-btn disabled:opacity-40 transition-colors"
        >
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
