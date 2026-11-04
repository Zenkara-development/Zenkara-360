import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Key, Plus, Trash2, Copy, CheckCircle, AlertCircle } from 'lucide-react';
import {
  PageHeader, PageBody, Card, Button, IconButton, Modal, Alert, Badge, Checkbox,
  Field, Input, DataTable, EmptyState, AccessDenied, type Column,
} from '../shared/components';
import { useFormat } from '../hooks/useFormat';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../shared/permissions';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  creator: { name: string };
}

// Matches server/src/modules/apikeys/apikeys.controller.ts's SCOPES exactly
// — these are the only scope strings authenticateApiKey() actually checks.
// (Previously this list offered resource-level scopes like "read:tickets"
// that nothing on the backend understood or enforced — every key worked
// the same regardless of what you picked here. 'read' allows GET requests;
// 'write' allows POST/PUT/PATCH/DELETE too; 'admin' also allows managing
// API keys and org settings via the key.)
const ALL_SCOPES = [
  { value: 'read', label: 'Read', hint: 'View data (GET requests)' },
  { value: 'write', label: 'Write', hint: 'Create, update, delete records' },
  { value: 'admin', label: 'Admin', hint: 'Manage org settings & API keys' },
];

export default function ApiKeysPage() {
  const { date } = useFormat();
  const qc = useQueryClient();
  const { user } = useAuth();
  /* /api-keys is SUPER_ADMIN-only on the server. */
  const canReadApiKeys = can.readApiKeys(user?.role);
  const [showModal, setShowModal] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Defaults to ['read'] rather than empty — now that scopes are actually
  // enforced (authenticateApiKey checks them on every request), a key
  // created with no scopes at all would authenticate successfully but 403
  // on every single call, which is a confusing dead end for whoever creates it.
  const [form, setForm] = useState({ name: '', scopes: ['read'] as string[], expiresAt: '' });

  const { data: keys = [], isLoading } = useQuery<ApiKey[]>({
    queryKey: ['api-keys'],
    queryFn: () => api.get('/api-keys').then(r => Array.isArray(r.data) ? r.data : (r.data.data ?? [])),
    enabled: canReadApiKeys,
  });

  const create = useMutation({
    mutationFn: (body: typeof form) => api.post('/api-keys', body).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      setNewKey(data.rawKey);
      setForm({ name: '', scopes: ['read'], expiresAt: '' });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/api-keys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  // After every hook.
  if (!canReadApiKeys) return <AccessDenied />;

  function toggleScope(scope: string) {
    setForm(f => ({
      ...f,
      scopes: f.scopes.includes(scope)
        ? f.scopes.filter(s => s !== scope)
        : [...f.scopes, scope],
    }));
  }

  function copyKey() {
    if (newKey) { navigator.clipboard.writeText(newKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  }

  const columns: Column<ApiKey>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: k => <span className="font-medium text-fg block max-w-[220px] truncate" title={k.name}>{k.name}</span>,
    },
    {
      key: 'prefix',
      header: 'Prefix',
      cell: k => <code className="bg-surface-sunken px-2 py-0.5 rounded-badge text-[12px] font-mono whitespace-nowrap">{k.keyPrefix}…</code>,
    },
    {
      key: 'scopes',
      header: 'Scopes',
      cell: k => (
        <div className="flex flex-wrap gap-1">
          {k.scopes.map(s => <Badge key={s} variant="blue" size="sm">{s}</Badge>)}
        </div>
      ),
    },
    {
      key: 'lastUsed',
      header: 'Last Used',
      hideBelow: 'sm',
      muted: true,
      cell: k => k.lastUsedAt ? date(k.lastUsedAt) : <span className="text-fg-subtle">Never</span>,
    },
    {
      key: 'expires',
      header: 'Expires',
      hideBelow: 'sm',
      muted: true,
      cell: k => k.expiresAt ? (
        <span className={new Date(k.expiresAt) < new Date() ? 'text-danger flex items-center gap-1' : ''}>
          {new Date(k.expiresAt) < new Date() && <AlertCircle size={12} />}
          {date(k.expiresAt)}
        </span>
      ) : <span className="text-fg-subtle">Never</span>,
    },
    { key: 'creator', header: 'Created by', muted: true, cell: k => k.creator?.name },
    {
      key: 'actions',
      header: '',
      cell: k => (
        <IconButton
          label="Revoke key"
          tone="danger"
          icon={<Trash2 size={15} />}
          onClick={() => { if (confirm('Revoke this API key?')) revoke.mutate(k.id); }}
        />
      ),
    },
  ];

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="API Keys"
        subtitle="Manage programmatic access to your data"
        actions={
          <>
            <a
              href={`${api.defaults.baseURL}/docs`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex"
            >
              <Button variant="secondary" tabIndex={-1}>API docs</Button>
            </a>
            <Button icon={<Plus size={16} />} onClick={() => setShowModal(true)}>Create API Key</Button>
          </>
        }
      />

      <PageBody>
        {/* New Key Banner */}
        {newKey && (
          <Alert
            tone="success"
            icon={<CheckCircle size={18} />}
            title="Your API key is shown once — copy it now before dismissing"
          >
            <div className="flex items-center gap-3 mt-2">
              <code
                className="flex-1 min-w-0 bg-surface border border-success/25 rounded-input px-3 py-2 text-[13px] font-mono text-fg truncate"
                title={newKey}
              >
                {newKey}
              </code>
              <Button
                size="sm"
                icon={copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                onClick={copyKey}
              >
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <Button variant="ghost" size="xs" className="mt-2 -ml-2.5" onClick={() => setNewKey(null)}>
              Dismiss
            </Button>
          </Alert>
        )}

        {/* Keys Table */}
        <Card padding="none">
          <DataTable
            columns={columns}
            rows={keys}
            rowKey={k => k.id}
            minWidth={640}
            loading={isLoading}
            empty={
              <EmptyState
                icon={<Key />}
                title="No API keys yet"
                description="Create a key to give scripts and integrations programmatic access to your data."
                action={{ label: 'Create API Key', onClick: () => setShowModal(true) }}
              />
            }
          />
        </Card>
      </PageBody>

      {/* Create Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Create API Key"
        icon={<Key size={16} />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button
              disabled={!form.name || form.scopes.length === 0 || create.isPending}
              loading={create.isPending}
              onClick={() => { create.mutate(form); setShowModal(false); }}
            >
              Create Key
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="form-section">
            <p className="form-section-title">Key Details</p>
            <div className="space-y-4">
              <Field label="Name" required>
                <Input
                  aria-label="Name"
                  placeholder="e.g. Zapier integration"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </Field>
              <Field label="Expires (optional)" hint="Leave blank for a non-expiring key">
                <Input
                  type="date"
                  value={form.expiresAt}
                  onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                />
              </Field>
            </div>
          </div>
          <div className="form-section">
            <p className="form-section-title">Permissions</p>
            <div className="space-y-2">
              {ALL_SCOPES.map(scope => (
                <Checkbox
                  key={scope.value}
                  checked={form.scopes.includes(scope.value)}
                  onChange={() => toggleScope(scope.value)}
                  label={<code className="font-semibold">{scope.label}</code>}
                  hint={scope.hint}
                />
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
