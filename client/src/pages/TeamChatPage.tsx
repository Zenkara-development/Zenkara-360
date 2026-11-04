/**
 * Team Chat — DMs between org members plus the record threads you're part of.
 * Left pane: conversations with unread badges + a people picker to start a DM.
 * Right pane: the live thread (ChatThreadView), SSE-updated.
 */
import { useState } from 'react';
import { MessageSquare, Plus, Ticket, Briefcase, Target, User as UserIcon } from 'lucide-react';
import { PageHeader, PageBody, Card, EmptyState, Modal, SearchInput, Badge } from '../shared/components';
import { ChatThreadView } from '../shared/components/ChatThreadView';
import { useChatThreads, useChatPeople, useOpenDm, type ChatThreadRow } from '../api/chat';
import { useAuth } from '../contexts/AuthContext';

const RECORD_ICON: Record<string, React.ReactNode> = {
  TICKET: <Ticket size={13} />, DEAL: <Briefcase size={13} />, LEAD: <Target size={13} />,
};

function threadTitle(t: ChatThreadRow, myId: string | undefined) {
  if (t.kind === 'DM') {
    const other = t.participants.find(p => p.id !== myId);
    return other?.name ?? 'Direct message';
  }
  return `${(t.entityType ?? 'RECORD').replace('_', ' ').toLowerCase()} thread`;
}

export default function TeamChatPage() {
  const { user } = useAuth();
  const { data: threads } = useChatThreads();
  const { data: people } = useChatPeople();
  const openDm = useOpenDm();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  async function startDm(userId: string) {
    const thread = await openDm.mutateAsync(userId);
    setSelectedId(thread.id);
    setPickerOpen(false);
  }

  const filteredPeople = (people ?? []).filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
  const selected = (threads ?? []).find(t => t.id === selectedId) ?? null;

  return (
    <>
      <PageHeader
        title="Team Chat"
        subtitle="Direct messages and record threads — type @ai anywhere to bring the assistant in"
        actions={
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1.5 h-ctl-md px-3.5 rounded-btn bg-accent text-accent-fg text-[13px] font-medium border border-accent-active/50 hover:bg-accent-hover transition-colors"
          >
            <Plus size={14} /> New message
          </button>
        }
      />
      <PageBody>
        <Card padding="none" className="overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-[280px,1fr] h-[calc(100vh-220px)] min-h-[420px]">
            {/* Thread list */}
            <div className="border-r border-line-subtle overflow-y-auto bg-surface">
              {(threads ?? []).length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    icon={<MessageSquare size={22} />}
                    title="No conversations yet"
                    description="Start a direct message with a teammate, or open a ticket's chat panel."
                  />
                </div>
              ) : (
                (threads ?? []).map(t => {
                  const active = t.id === selectedId;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={`relative w-full text-left px-3 py-2.5 border-b border-line-subtle transition-colors ${
                        active ? 'bg-accent-soft' : 'hover:bg-surface-hover'
                      }`}
                    >
                      {active && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent" />}
                      <span className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-accent-soft text-accent-soft-fg flex items-center justify-center shrink-0">
                          {t.kind === 'DM' ? <UserIcon size={13} /> : (RECORD_ICON[t.entityType ?? ''] ?? <MessageSquare size={13} />)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="text-[13px] font-medium text-fg truncate capitalize">{threadTitle(t, user?.id)}</span>
                            {t.unread > 0 && <Badge variant="accent">{t.unread}</Badge>}
                          </span>
                          {t.lastMessage && (
                            <span className="block text-[11.5px] text-fg-subtle truncate">
                              {t.lastMessage.authorName ? `${t.lastMessage.authorName}: ` : ''}
                              {t.lastMessage.body.replace(/<[^>]+>/g, ' ').slice(0, 60)}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {/* Message pane */}
            <div className="min-h-0">
              {selected ? (
                <ChatThreadView threadId={selected.id} />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <EmptyState
                    icon={<MessageSquare size={22} />}
                    title="Pick a conversation"
                    description="Choose a thread on the left, or start a new direct message."
                  />
                </div>
              )}
            </div>
          </div>
        </Card>
      </PageBody>

      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="New direct message">
        <div className="space-y-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search teammates…" />
          <div className="max-h-72 overflow-y-auto divide-y divide-line-subtle rounded-card border border-line-subtle">
            {filteredPeople.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => startDm(p.id)}
                className="w-full text-left px-3 py-2.5 hover:bg-surface-hover transition-colors flex items-center gap-2.5"
              >
                <span className="w-7 h-7 rounded-full bg-accent-soft text-accent-soft-fg flex items-center justify-center text-xs font-bold">
                  {p.name[0]?.toUpperCase()}
                </span>
                <span>
                  <span className="block text-[13px] font-medium text-fg">{p.name}</span>
                  <span className="block text-[11.5px] text-fg-subtle">{p.department || p.role}</span>
                </span>
              </button>
            ))}
            {filteredPeople.length === 0 && <p className="px-3 py-4 text-[12.5px] text-fg-subtle text-center">No teammates match.</p>}
          </div>
        </div>
      </Modal>
    </>
  );
}
