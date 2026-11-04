import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { RefreshCw, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import {
  PageHeader, PageBody, Card, Tabs, Badge, Button, DataTable, EmptyState, AccessDenied,
  type Column,
} from '../shared/components';
import { useFormat } from '../hooks/useFormat';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../shared/permissions';

interface Job {
  id: string;
  type: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  completedAt: string | null;
  payload: any;
}

const STATUS_TABS = ['FAILED', 'PENDING', 'PROCESSING', 'COMPLETED'] as const;

const STATUS_VARIANT: Record<string, 'red' | 'yellow' | 'blue' | 'green'> = {
  FAILED: 'red',
  PENDING: 'yellow',
  PROCESSING: 'blue',
  COMPLETED: 'green',
};

const TYPE_LABEL: Record<string, string> = {
  send_email: 'Email',
  slack_webhook: 'Slack',
  teams_webhook: 'Teams',
  web_push: 'Push notification',
};

/** Best-effort one-line description of what a job was trying to deliver, for the admin's benefit — payload shapes are internal (see jobQueue.ts callers), so this is deliberately defensive. */
function describePayload(type: string, payload: any): string {
  try {
    if (type === 'send_email') return `To: ${payload?.to ?? 'unknown'} — "${payload?.subject ?? ''}"`;
    if (type === 'slack_webhook' || type === 'teams_webhook') return payload?.payload?.text ?? 'Notification';
    if (type === 'web_push') return payload?.body ? JSON.parse(payload.body)?.title ?? 'Push notification' : 'Push notification';
  } catch { /* fall through */ }
  return '—';
}

export default function JobsPage() {
  const { time } = useFormat();
  const qc = useQueryClient();
  const { user } = useAuth();
  /* /jobs is MANAGERS-only on the server — and this list polls every 15s, so
     an ungated visit is a refusal every 15 seconds for as long as it's open. */
  const canReadAdmin = can.readAdmin(user?.role);
  const [status, setStatus] = useState<typeof STATUS_TABS[number]>('FAILED');

  const { data, isLoading } = useQuery<{ data: Job[]; summary: Record<string, number> }>({
    queryKey: ['jobs', status],
    queryFn: () => api.get(`/jobs?status=${status}`).then(r => r.data),
    refetchInterval: 15_000, // matches the server poll interval — see jobQueue.ts
    enabled: canReadAdmin,
  });

  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/jobs/${id}/retry`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });

  // After every hook.
  if (!canReadAdmin) return <AccessDenied />;

  const jobs = data?.data ?? [];
  const summary = data?.summary ?? { PENDING: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0 };

  const columns: Column<Job>[] = [
    {
      key: 'type',
      header: 'Type',
      cell: j => <span className="font-medium text-fg whitespace-nowrap">{TYPE_LABEL[j.type] ?? j.type}</span>,
    },
    {
      key: 'details',
      header: 'Details',
      cell: j => (
        <span className="block max-w-[240px] truncate text-fg-muted" title={describePayload(j.type, j.payload)}>
          {describePayload(j.type, j.payload)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: j => <Badge variant={STATUS_VARIANT[j.status] ?? 'gray'}>{j.status}</Badge>,
    },
    {
      key: 'attempts',
      header: 'Attempts',
      muted: true,
      cell: j => <span className="whitespace-nowrap tabular-nums">{j.attempts} / {j.maxAttempts}</span>,
    },
    {
      key: 'lastError',
      header: 'Last error',
      hideBelow: 'sm',
      cell: j => (
        <span className="block max-w-[260px] truncate text-[12px] text-danger" title={j.lastError ?? ''}>
          {j.lastError ?? '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: j => (
        <>
          {j.status === 'FAILED' && (
            <Button
              size="xs"
              variant="ghost"
              icon={<RefreshCw size={12} />}
              disabled={retry.isPending}
              loading={retry.isPending && retry.variables === j.id}
              onClick={() => retry.mutate(j.id)}
            >
              Retry
            </Button>
          )}
          {j.status === 'PENDING' && (
            <span className="flex items-center gap-1 text-[12px] text-fg-subtle">
              <Clock size={12} /> {time(j.nextAttemptAt)}
            </span>
          )}
        </>
      ),
    },
  ];

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Background Jobs"
        subtitle="Email, Slack, Teams, and push notifications retry automatically on failure. Anything here has already been retried up to its limit — retry it manually, or check the error below to see why it keeps failing."
        below={
          <Tabs
            variant="pill"
            aria-label="Job status"
            value={status}
            onChange={setStatus}
            items={STATUS_TABS.map(s => ({
              key: s,
              icon: s === 'FAILED'
                ? <AlertTriangle size={13} />
                : s === 'COMPLETED'
                  ? <CheckCircle2 size={13} />
                  : undefined,
              label: `${s.charAt(0) + s.slice(1).toLowerCase()} (${summary[s] ?? 0})`,
            }))}
          />
        }
      />

      <PageBody>
        <Card padding="none">
          <DataTable
            columns={columns}
            rows={jobs}
            rowKey={j => j.id}
            minWidth={720}
            loading={isLoading}
            empty={
              <EmptyState
                icon={<CheckCircle2 />}
                title={`No ${status.toLowerCase()} jobs`}
                description={status === 'FAILED'
                  ? 'Good news — every delivery either succeeded or is still being retried automatically.'
                  : 'Jobs in this state will appear here. The list refreshes automatically every 15 seconds.'}
              />
            }
          />
        </Card>
      </PageBody>
    </div>
  );
}
