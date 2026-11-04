import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Shield, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  PageHeader, PageBody, Toolbar, Card, SearchInput, Select, Badge, IconButton,
  DataTable, EmptyState, AccessDenied, type Column,
} from '../shared/components';
import { useFormat } from '../hooks/useFormat';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../shared/permissions';

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: Record<string, unknown> | null;
  createdAt: string;
  user: { name: string; email: string } | null;
}

const ACTION_VARIANT: Record<string, 'green' | 'blue' | 'red' | 'purple'> = {
  CREATE: 'green',
  UPDATE: 'blue',
  DELETE: 'red',
  LOGIN: 'purple',
};

const ENTITY_TYPES = ['Ticket', 'Contact', 'Deal', 'Lead', 'User', 'ApiKey', 'Campaign'];

export default function AuditLogPage() {
  const { dateTime } = useFormat();
  const { user } = useAuth();
  /* /audit-logs is MANAGERS-only on the server. */
  const canReadAdmin = can.readAdmin(user?.role);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', page, search, action, entityType],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (search) params.set('search', search);
      if (action) params.set('action', action);
      if (entityType) params.set('entityType', entityType);
      return api.get(`/audit-logs?${params}`).then(r => r.data);
    },
    enabled: canReadAdmin,
  });

  // After every hook.
  if (!canReadAdmin) return <AccessDenied />;

  const logs: AuditLog[] = data?.data ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.ceil(total / 25);

  const columns: Column<AuditLog>[] = [
    {
      key: 'time',
      header: 'Time',
      muted: true,
      cell: log => <span className="whitespace-nowrap">{dateTime(log.createdAt)}</span>,
    },
    {
      key: 'user',
      header: 'User',
      cell: log => log.user
        ? <span className="font-medium text-fg">{log.user.name}</span>
        : <span className="text-fg-subtle">System</span>,
    },
    {
      key: 'action',
      header: 'Action',
      cell: log => <Badge variant={ACTION_VARIANT[log.action] ?? 'gray'}>{log.action}</Badge>,
    },
    { key: 'entityType', header: 'Type', muted: true, cell: log => log.entityType },
    {
      key: 'entityId',
      header: 'Entity ID',
      cell: log => (
        <code className="text-[12px] font-mono text-fg-muted" title={log.entityId ?? undefined}>
          {log.entityId?.slice(0, 12) ?? '—'}
        </code>
      ),
    },
    {
      key: 'ip',
      header: 'IP Address',
      hideBelow: 'lg',
      cell: () => <span className="text-[12px] text-fg-subtle">—</span>,
    },
    {
      key: 'browser',
      header: 'Browser',
      hideBelow: 'lg',
      cell: () => <span className="text-[12px] text-fg-subtle">—</span>,
    },
    {
      key: 'details',
      header: 'Details',
      cell: log => (
        <span className="block max-w-xs truncate text-[12px] text-fg-subtle">
          {log.changes ? JSON.stringify(log.changes).slice(0, 80) : '—'}
        </span>
      ),
    },
  ];

  return (
    <div className="animate-slide-up">
      <PageHeader title="Audit Log" subtitle="Track all actions across your organization" />

      <PageBody>
        <Toolbar>
          <SearchInput
            className="flex-1 min-w-[200px]"
            value={search}
            onChange={v => { setSearch(v); setPage(1); }}
            placeholder="Search by entity ID or user…"
          />
          <Select
            aria-label="Action"
            value={action}
            onChange={e => { setAction(e.target.value); setPage(1); }}
            placeholder="All actions"
            options={['CREATE', 'UPDATE', 'DELETE', 'LOGIN'].map(a => ({ value: a, label: a }))}
          />
          <Select
            aria-label="Entity type"
            value={entityType}
            onChange={e => { setEntityType(e.target.value); setPage(1); }}
            placeholder="All types"
            options={ENTITY_TYPES.map(t => ({ value: t, label: t }))}
          />
        </Toolbar>

        <Card padding="none">
          <DataTable
            columns={columns}
            rows={logs}
            rowKey={log => log.id}
            minWidth={640}
            loading={isLoading}
            empty={
              <EmptyState
                icon={<Shield />}
                title="No audit events found"
                description={search || action || entityType
                  ? 'No events match the current filters. Try broadening your search.'
                  : 'Create, update, delete and login activity across your organization will appear here as it happens.'}
              />
            }
          />
        </Card>

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-[13px] text-fg-muted tabular-nums">
            <span>{total} total events</span>
            <div className="flex items-center gap-2">
              <IconButton
                label="Previous page"
                icon={<ChevronLeft size={16} />}
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
              />
              <span>Page {page} of {totalPages}</span>
              <IconButton
                label="Next page"
                icon={<ChevronRight size={16} />}
                disabled={page === totalPages}
                onClick={() => setPage(p => p + 1)}
              />
            </div>
          </div>
        )}
      </PageBody>
    </div>
  );
}
