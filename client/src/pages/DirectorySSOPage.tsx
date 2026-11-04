import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { KeyRound, Trash2, Zap, Copy, Check, Plus, Pencil, X, RefreshCw } from 'lucide-react';
import { useFormat } from '../hooks/useFormat';
import {
  PageBody, Card, CardHeader, Field, Input, Select, Checkbox,
  Button, IconButton, Badge, Alert, Spinner, SkeletonCard,
} from '../shared/components';

/**
 * Microsoft's brand blue.
 *
 * Third-party brand marks are deliberately exempt from the design-token
 * system: the Entra ID tile has to read as Microsoft whichever theme the
 * customer picks, so this stays a literal hex rather than becoming
 * `bg-accent`.
 */
const MICROSOFT_BRAND_TILE = 'bg-[#0078D4]';

const ROLES = ['SUPER_ADMIN', 'CRM_MANAGER', 'SALES_REP', 'IT_MANAGER', 'IT_AGENT', 'EMPLOYEE'];

const ROLE_OPTIONS = ROLES.map(r => ({ value: r, label: r.replace(/_/g, ' ') }));

interface DirectoryConfig {
  tenantId: string;
  clientId: string;
  hasClientSecret: boolean;
  loginSlug: string;
  isEnabled: boolean;
  autoProvisioningEnabled: boolean;
  defaultRole: string;
  loginUrl: string;
  redirectUri: string;
  updatedAt: string;
}

interface RoleMapping {
  id: string;
  groupId: string;
  groupLabel: string;
  role: string;
  priority: number;
}

interface Form {
  tenantId: string; clientId: string; clientSecret: string; loginSlug: string; isEnabled: boolean;
  autoProvisioningEnabled: boolean; defaultRole: string;
}

const DEFAULT: Form = { tenantId: '', clientId: '', clientSecret: '', loginSlug: '', isEnabled: true, autoProvisioningEnabled: false, defaultRole: 'EMPLOYEE' };

const MAPPING_DEFAULT = { groupId: '', groupLabel: '', role: 'EMPLOYEE', priority: 0 };

function RoleMappingsSection() {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(MAPPING_DEFAULT);
  const [adding, setAdding] = useState(false);

  const { data: mappings = [], isLoading } = useQuery<RoleMapping[]>({
    queryKey: ['directory-mappings'],
    queryFn: () => api.get('/directory/mappings').then(r => r.data),
  });

  const create = useMutation({
    mutationFn: (data: typeof MAPPING_DEFAULT) => api.post('/directory/mappings', data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['directory-mappings'] }); setAdding(false); setForm(MAPPING_DEFAULT); },
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof MAPPING_DEFAULT }) => api.patch(`/directory/mappings/${id}`, data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['directory-mappings'] }); setEditingId(null); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/directory/mappings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['directory-mappings'] }),
  });

  function startEdit(m: RoleMapping) {
    setEditingId(m.id);
    setForm({ groupId: m.groupId, groupLabel: m.groupLabel, role: m.role, priority: m.priority });
  }

  const rowForm = (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_140px_80px_auto] gap-2 items-start">
      <Input inputSize="sm" placeholder="Entra group object ID" value={form.groupId} onChange={e => setForm(f => ({ ...f, groupId: e.target.value }))} />
      <Input inputSize="sm" placeholder="Group name (for reference)" value={form.groupLabel} onChange={e => setForm(f => ({ ...f, groupLabel: e.target.value }))} />
      <Select selectSize="sm" options={ROLE_OPTIONS} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} />
      <Input inputSize="sm" type="number" placeholder="Priority" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: Number(e.target.value) || 0 }))} />
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          aria-label="Save mapping"
          icon={<Check size={14} />}
          onClick={() => editingId ? update.mutate({ id: editingId, data: form }) : create.mutate(form)}
          disabled={!form.groupId || !form.groupLabel}
          loading={create.isPending || update.isPending}
        />
        <Button
          size="sm"
          variant="secondary"
          aria-label="Cancel"
          icon={<X size={14} />}
          onClick={() => { setAdding(false); setEditingId(null); setForm(MAPPING_DEFAULT); }}
        />
      </div>
    </div>
  );

  return (
    <Card className="space-y-4">
      <CardHeader
        title="Group → role mapping"
        subtitle="People in the highest-priority matching group get that role. Anyone not in a mapped group gets the default role above."
        actions={!adding && (
          <Button
            size="xs"
            variant="subtle"
            icon={<Plus size={14} />}
            onClick={() => { setAdding(true); setEditingId(null); setForm(MAPPING_DEFAULT); }}
          >
            Add mapping
          </Button>
        )}
      />

      {isLoading ? (
        <Spinner compact />
      ) : mappings.length === 0 && !adding ? (
        <p className="text-xs text-fg-subtle">No group mappings yet — everyone provisioned via SSO gets the default role.</p>
      ) : (
        <div className="space-y-2">
          {mappings.map(m => editingId === m.id ? (
            <div key={m.id}>{rowForm}</div>
          ) : (
            <div key={m.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-line-subtle last:border-0">
              <span className="flex-1 truncate text-fg" title={m.groupLabel}>{m.groupLabel}</span>
              <span className="text-fg-subtle tabular-nums shrink-0">priority {m.priority}</span>
              <span className="font-medium text-fg shrink-0">{m.role.replace(/_/g, ' ')}</span>
              <IconButton label="Edit mapping" icon={<Pencil size={13} />} onClick={() => startEdit(m)} />
              <IconButton label="Delete mapping" icon={<Trash2 size={13} />} tone="danger" onClick={() => remove.mutate(m.id)} />
            </div>
          ))}
        </div>
      )}

      {adding && rowForm}
    </Card>
  );
}

interface SyncLog {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'RUNNING' | 'OK' | 'ERROR';
  usersCreated: number;
  usersDeactivated: number;
  errorMessage: string | null;
}

function SyncSection({ autoProvisioningEnabled }: { autoProvisioningEnabled: boolean }) {
  const { dateTime } = useFormat();
  const qc = useQueryClient();

  const { data: logs = [] } = useQuery<SyncLog[]>({
    queryKey: ['directory-sync-logs'],
    queryFn: () => api.get('/directory/sync-logs').then(r => r.data),
  });

  const sync = useMutation({
    mutationFn: () => api.post('/directory/sync').then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['directory-sync-logs'] }),
  });

  return (
    <Card className="space-y-4">
      <CardHeader
        title="Scheduled sync"
        subtitle={
          <>
            Runs automatically once a day, pre-creating and deactivating accounts based on group membership.
            {!autoProvisioningEnabled && ' Turn on automatic provisioning above to enable it.'}
          </>
        }
        actions={
          <Button
            size="sm"
            variant="secondary"
            icon={<RefreshCw size={13} />}
            onClick={() => sync.mutate()}
            disabled={!autoProvisioningEnabled}
            loading={sync.isPending}
          >
            Sync now
          </Button>
        }
      />

      {sync.isError && (
        <Alert tone="danger">{(sync.error as any)?.response?.data?.error ?? 'Sync failed'}</Alert>
      )}

      {logs.length > 0 && (
        <div className="space-y-1.5">
          {logs.slice(0, 5).map(log => (
            <div key={log.id} className="flex items-center gap-3 text-xs py-1 border-b border-line-subtle last:border-0">
              <span className={`shrink-0 ${log.status === 'OK' ? 'text-success' : log.status === 'ERROR' ? 'text-danger' : 'text-fg-subtle'}`}>
                {log.status === 'RUNNING' ? 'Running…' : log.status === 'OK' ? 'Succeeded' : 'Failed'}
              </span>
              <span className="text-fg-subtle tabular-nums">{dateTime(log.startedAt)}</span>
              {log.status === 'OK' && (
                <span className="text-fg-muted ml-auto tabular-nums">
                  +{log.usersCreated} created, {log.usersDeactivated} deactivated
                </span>
              )}
              {log.status === 'ERROR' && (
                <span className="text-danger ml-auto truncate" title={log.errorMessage ?? undefined}>
                  {log.errorMessage}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <Input readOnly value={value} className="font-mono text-xs" onFocus={e => e.target.select()} />
        <Button
          variant="secondary"
          aria-label={`Copy ${label}`}
          icon={copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
          onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        />
      </div>
    </Field>
  );
}

export default function DirectorySSOPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(DEFAULT);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const { data: config, isLoading } = useQuery<DirectoryConfig | null>({
    queryKey: ['directory-config'],
    queryFn: () => api.get('/directory/config').then(r => r.data),
  });

  useEffect(() => {
    if (config) setForm({
      tenantId: config.tenantId, clientId: config.clientId, clientSecret: '', loginSlug: config.loginSlug, isEnabled: config.isEnabled,
      autoProvisioningEnabled: config.autoProvisioningEnabled, defaultRole: config.defaultRole,
    });
  }, [config]);

  const save = useMutation({
    mutationFn: (data: Form) => api.put('/directory/config', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['directory-config'] });
      setForm(f => ({ ...f, clientSecret: '' }));
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete('/directory/config'),
    onSuccess: () => {
      setForm(DEFAULT);
      qc.invalidateQueries({ queryKey: ['directory-config'] });
    },
  });

  async function runTest() {
    setTestResult(null);
    try {
      const { data } = await api.post('/directory/test');
      setTestResult({ ok: true, msg: data.message });
    } catch (err: any) {
      setTestResult({ ok: false, msg: err.response?.data?.error ?? 'Test failed' });
    }
  }

  const connected = !!config;
  const canSave = !!form.tenantId && !!form.clientId && !!form.loginSlug && (connected || !!form.clientSecret);

  if (isLoading) {
    return (
      <PageBody width="narrow">
        <div className="flex items-center gap-3" aria-hidden="true">
          <div className="skeleton w-10 h-10 rounded-card shrink-0" />
          <div className="space-y-2">
            <div className="skeleton h-4 w-56" />
            <div className="skeleton h-3 w-72" />
          </div>
        </div>
        <SkeletonCard lines={5} />
        <SkeletonCard lines={3} />
      </PageBody>
    );
  }

  return (
    <PageBody width="narrow">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-card flex items-center justify-center shrink-0 ${MICROSOFT_BRAND_TILE}`}>
          <KeyRound size={20} className="text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-[18px] font-semibold text-fg leading-tight tracking-tight">Single Sign-On (Microsoft Entra ID)</h1>
          <p className="text-[13px] text-fg-muted mt-0.5">Let employees sign in with their Microsoft work account</p>
        </div>
        {connected && form.isEnabled && <Badge variant="green" dot className="ml-auto">Connected</Badge>}
      </div>

      <Card>
        <CardHeader
          title="Entra app registration"
          subtitle="Register CRMITdesk as an app in your organization's Microsoft Entra admin center, then paste its details here. Existing CRMITdesk accounts can always sign in this way; turn on automatic provisioning below to also create accounts for new employees on first sign-in."
          className="mb-4"
        />
        <div className="space-y-4">
          <Field label="Tenant ID">
            <Input value={form.tenantId} onChange={e => setForm(f => ({ ...f, tenantId: e.target.value }))} placeholder="00000000-0000-0000-0000-000000000000" />
          </Field>
          <Field label="Client (Application) ID">
            <Input value={form.clientId} onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))} placeholder="00000000-0000-0000-0000-000000000000" />
          </Field>
          <Field label="Client secret">
            <Input
              type="password"
              value={form.clientSecret}
              onChange={e => setForm(f => ({ ...f, clientSecret: e.target.value }))}
              placeholder={config?.hasClientSecret ? '•••••••••••••• (saved — leave blank to keep it)' : 'Paste the secret value'}
            />
          </Field>
          <Field label="Sign-in link" hint="Share this link with your employees to sign in with Microsoft.">
            <div className="flex items-center gap-2">
              <span className="text-sm text-fg-subtle shrink-0">/login/</span>
              <Input value={form.loginSlug} onChange={e => setForm(f => ({ ...f, loginSlug: e.target.value.toLowerCase() }))} placeholder="acme" />
            </div>
          </Field>
          <Checkbox
            label="Enabled"
            checked={form.isEnabled}
            onChange={e => setForm(f => ({ ...f, isEnabled: e.target.checked }))}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Automatic provisioning"
          subtitle="When enabled, people signing in with Microsoft for the first time get a CRMITdesk account automatically instead of needing an Invite."
          className="mb-4"
        />
        <div className="space-y-4">
          <Checkbox
            label="Automatically create accounts for new Microsoft sign-ins"
            checked={form.autoProvisioningEnabled}
            onChange={e => setForm(f => ({ ...f, autoProvisioningEnabled: e.target.checked }))}
          />
          <Field label="Default role" hint="Given to anyone not in a group mapped below.">
            <Select options={ROLE_OPTIONS} value={form.defaultRole} onChange={e => setForm(f => ({ ...f, defaultRole: e.target.value }))} />
          </Field>
        </div>
      </Card>

      {connected && <RoleMappingsSection />}
      {connected && <SyncSection autoProvisioningEnabled={config.autoProvisioningEnabled} />}

      {connected && (
        <Card className="space-y-4">
          <CardHeader title="Give these to your Entra admin" />
          <CopyField label="Redirect URI (add under Authentication in your app registration)" value={config.redirectUri} />
          <CopyField label="Employee sign-in link" value={config.loginUrl} />
        </Card>
      )}

      {saved && <Alert tone="success" className="animate-fade-in">Configuration saved.</Alert>}
      {save.isError && (
        <Alert tone="danger">{(save.error as any)?.response?.data?.error ?? 'Could not save configuration'}</Alert>
      )}
      {testResult && <Alert tone={testResult.ok ? 'success' : 'danger'}>{testResult.msg}</Alert>}

      <div className="flex items-center gap-3 flex-wrap">
        <Button
          size="lg"
          className="flex-1"
          onClick={() => save.mutate(form)}
          disabled={!canSave}
          loading={save.isPending}
        >
          {save.isPending ? 'Saving…' : connected ? 'Save changes' : 'Connect Microsoft Entra ID'}
        </Button>
        {connected && (
          <>
            <Button size="lg" variant="secondary" icon={<Zap size={14} />} onClick={runTest}>
              Test
            </Button>
            <Button
              size="lg"
              variant="danger"
              icon={<Trash2 size={14} />}
              onClick={() => remove.mutate()}
              loading={remove.isPending}
            >
              Disconnect
            </Button>
          </>
        )}
      </div>
    </PageBody>
  );
}
