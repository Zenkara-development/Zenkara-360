import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Clock, Plus, Trash2 } from 'lucide-react';
import { Card, Button, IconButton, Badge, Avatar, Field, Input, EmptyState } from '../../../shared/components';
import { useFormat } from '../../../hooks/useFormat';

interface TimeEntry {
  id: string;
  minutes: number;
  description: string | null;
  loggedAt: string;
  createdAt: string;
  user: { name: string };
}

interface Props { ticketId: string; }

export function TimeTrackingPanel({ ticketId }: Props) {
  const { dateTime: fmtLoggedAt } = useFormat();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ minutes: '', note: '' });

  const { data, isLoading } = useQuery<{ entries: TimeEntry[]; totalMinutes: number }>({
    queryKey: ['time-entries', ticketId],
    queryFn: () => api.get(`/itdesk/time-tracking/${ticketId}`).then(r => r.data),
  });

  const log = useMutation({
    mutationFn: (body: { minutes: number; description?: string }) =>
      api.post(`/itdesk/time-tracking/${ticketId}`, body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['time-entries', ticketId] });
      setForm({ minutes: '', note: '' });
      setShowForm(false);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/itdesk/time-tracking/entry/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['time-entries', ticketId] }),
  });

  const entries = data?.entries ?? [];
  const totalMinutes = data?.totalMinutes ?? 0;

  function formatTime(min: number) {
    if (min < 60) return `${min}m`;
    return `${Math.floor(min / 60)}h ${min % 60}m`;
  }

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line-subtle">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-accent" />
          <span className="font-semibold text-fg text-sm">Time Tracking</span>
          {totalMinutes > 0 && (
            <Badge variant="accent" className="tabular-nums">{formatTime(totalMinutes)} total</Badge>
          )}
        </div>
        <Button size="xs" variant="subtle" icon={<Plus size={12} />} onClick={() => setShowForm(f => !f)}>
          Log time
        </Button>
      </div>

      {showForm && (
        <div className="px-4 py-3 bg-surface-sunken border-b border-line-subtle">
          <div className="flex items-end gap-3">
            <div className="shrink-0">
              <Field label="Minutes" htmlFor="tt-minutes">
                <Input
                  id="tt-minutes"
                  aria-label="Minutes"
                  type="number"
                  min="1"
                  inputSize="sm"
                  className="w-20 text-center"
                  placeholder="30"
                  value={form.minutes}
                  onChange={e => setForm(f => ({ ...f, minutes: e.target.value }))}
                />
              </Field>
            </div>
            <div className="flex-1 min-w-0">
              <Field label="Note (optional)" htmlFor="tt-note">
                <Input
                  id="tt-note"
                  aria-label="Note"
                  inputSize="sm"
                  placeholder="What did you work on?"
                  value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                />
              </Field>
            </div>
            <div className="flex gap-2 pb-0.5">
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button
                size="sm"
                disabled={!form.minutes || Number(form.minutes) < 1}
                loading={log.isPending}
                onClick={() => log.mutate({ minutes: Number(form.minutes), description: form.note || undefined })}
              >
                {log.isPending ? 'Saving…' : 'Log'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="divide-y divide-line-subtle">
        {isLoading ? (
          <div className="px-4 py-3 space-y-2" aria-hidden="true">
            <div className="skeleton h-10 w-full" />
            <div className="skeleton h-10 w-full opacity-70" />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            compact
            icon={<Clock size={18} />}
            title="No time logged yet"
            description="Log the time spent on this ticket to keep effort visible."
            action={{ label: 'Log time', onClick: () => setShowForm(true) }}
          />
        ) : (
          entries.map(e => (
            <div key={e.id} className="px-4 py-3 flex items-start justify-between group hover:bg-surface-hover transition-colors">
              <div className="flex items-start gap-3 min-w-0">
                <Avatar name={e.user.name} size="sm" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-fg tabular-nums">{formatTime(e.minutes)}</span>
                    <span className="text-xs text-fg-subtle truncate" title={e.user.name}>by {e.user.name}</span>
                  </div>
                  {e.description && <p className="text-xs text-fg-muted mt-0.5 line-clamp-2" title={e.description}>{e.description}</p>}
                  <p className="text-xs text-fg-subtle mt-0.5 tabular-nums">{fmtLoggedAt(e.loggedAt || e.createdAt)}</p>
                </div>
              </div>
              <IconButton
                label="Delete time entry"
                tone="danger"
                size="xs"
                revealOnRowHover
                icon={<Trash2 size={13} />}
                onClick={() => remove.mutate(e.id)}
              />
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
