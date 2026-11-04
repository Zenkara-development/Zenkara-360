import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import {
  PageHeader, PageBody, Card, StatTile, Button, Modal, Badge, SearchInput, EmptyState,
  SearchableSelect, RowActions, Alert, Avatar, Field, Input, FormGrid, FormActions,
  AccessDenied, DataTable, type Column,
} from '../shared/components';
import { Users, Plus, UserX, Pencil, Shield, Mail, Copy, Check, KeyRound } from 'lucide-react';
import { useFormat } from '../hooks/useFormat';
import { useRoles } from '../api/work';
import { useDepartments } from '../api/people';
import { can } from '../shared/permissions';

/**
 * Role options come from the Role table, not a hardcoded list.
 *
 * The six legacy enum values used to be the only choices here, which meant a
 * role an admin created under Administration → Roles & Permissions — or any of
 * the built-in HR Manager / Finance / Executive roles — simply never appeared
 * when adding a user. Creating a role you could not then assign is worse than
 * not offering role creation at all.
 */
function useRoleOptions() {
  // GET /permissions/roles is MANAGERS-only. The role picker is only ever shown
  // to someone who can already administer users, but the forms it lives in are
  // reachable from a page a non-manager can still hit by URL, so ask only when
  // the answer can be anything other than a refusal.
  const { user } = useAuth();
  const canReadRoles = can.readRoles(user?.role);
  const { data, isLoading } = useRoles(canReadRoles);
  const options = (data?.data ?? [])
    .filter(r => r.isActive)
    .map(r => ({
      value: r.id,
      label: r.description ? `${r.name} — ${r.description}` : r.name,
    }));
  return { options, isLoading, roles: data?.data ?? [] };
}

const ROLES = ['SUPER_ADMIN','CRM_MANAGER','SALES_REP','IT_MANAGER','IT_AGENT','EMPLOYEE'];
/** Roles this page refuses outright — see the AccessDenied return below. */
const BLOCKED_ROLES = ['SALES_REP', 'IT_AGENT', 'EMPLOYEE'];
const roleVariant: Record<string, any> = {
  SUPER_ADMIN: 'red', CRM_MANAGER: 'purple', SALES_REP: 'blue',
  IT_MANAGER: 'orange', IT_AGENT: 'yellow', EMPLOYEE: 'gray',
};

function UserForm({ initial, onSubmit, loading }: any) {
  const { options: roleOptions, isLoading: rolesLoading, roles } = useRoleOptions();
  // An existing user may still be on the legacy enum with no Role row linked,
  // so fall back to matching by legacyRole rather than showing an empty picker.
  const initialRoleId =
    initial?.roleId ?? roles.find(r => r.legacyRole === initial?.role)?.id ?? '';
  const [form, setForm] = useState(
    initial
      ? { ...initial, roleId: initialRoleId }
      : { name: '', email: '', password: '', roleId: '', department: '', phone: '' }
  );
  const f = (k: string) => (e: any) => setForm((p: any) => ({ ...p, [k]: e.target.value }));
  // Org Structure's department list, offered as a picker when defined. The
  // current (possibly legacy free-text) value is kept as an option so an
  // existing user's department never silently disappears from the select.
  const { data: departmentsRes } = useDepartments();
  const departmentNames = (departmentsRes?.data ?? []).filter((d: any) => d.isActive !== false).map((d: any) => d.name);
  const departmentOptions = [...new Set([...departmentNames, ...(form.department ? [form.department] : [])])]
    .map(n => ({ value: n, label: n }));
  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        /* Send only the fields this form edits.
           It used to spread the whole fetched user (`{ ...initial }`) into
           state and post all of it back, which shipped `id`, `createdAt`, the
           `employee` relation — and, fatally, `department: null` / `phone: null`
           for any user who had neither recorded. The server's optional string
           fields reject null, so editing a perfectly ordinary user failed with
           a validation error about fields the admin had never touched.
           Building the payload explicitly also means adding a column to the
           users API can no longer break this form by accident. */
        const payload: Record<string, unknown> = {
          name: form.name,
          roleId: form.roleId || undefined,
          department: form.department ?? '',
          phone: form.phone ?? '',
        };
        if (!initial) {
          payload.email = form.email;
          payload.password = form.password;
        }
        onSubmit(payload);
      }}
      className="space-y-3"
    >
      <div className="form-section">
        <p className="form-section-title">Account Details</p>
        <FormGrid>
          <Field label="Full Name" required>
            <Input aria-label="Full Name" required value={form.name} onChange={f('name')} placeholder="Jane Smith" />
          </Field>
          <Field label="Email" required>
            <Input aria-label="Email" required type="email" value={form.email} onChange={f('email')} disabled={!!initial} placeholder="jane@company.com" />
          </Field>
          {!initial && (
            <Field label="Password" required>
              <Input aria-label="Password" required type="password" minLength={8} value={form.password} onChange={f('password')} placeholder="Min 8 characters" />
            </Field>
          )}
          <Field label="Department" hint={departmentOptions.length ? undefined : 'Define departments in HR → Org Structure to pick from a list.'}>
            {departmentOptions.length > 0 ? (
              // Departments are managed in HR → Org Structure; the user record
              // stores the department NAME (matching the legacy free-text
              // column), so existing values keep working unchanged.
              <SearchableSelect
                ariaLabel="Department"
                value={form.department || ''}
                onChange={val => setForm((p: any) => ({ ...p, department: val }))}
                options={departmentOptions}
                placeholder="— none —"
              />
            ) : (
              <Input value={form.department} onChange={f('department')} placeholder="e.g. Engineering, Sales" />
            )}
          </Field>
          <Field label="Phone (WhatsApp)">
            <Input aria-label="Phone" value={form.phone || ''} onChange={f('phone')} placeholder="+14155551234" />
          </Field>
        </FormGrid>
      </div>
      <div className="form-section">
        <p className="form-section-title">Permissions</p>
        <Field
          label="Role"
          required
          hint={<>Decides what this user can see and do. Manage the list under Administration → Roles &amp; Permissions.</>}
        >
          <SearchableSelect
            ariaLabel="Role"
            value={form.roleId || (initialRoleId ?? '')}
            onChange={val => setForm((p: any) => ({ ...p, roleId: val }))}
            required
            options={rolesLoading ? [{ value: '', label: 'Loading roles…' }] : roleOptions}
          />
        </Field>
      </div>
      <FormActions>
        <Button type="submit" loading={loading}>{initial ? 'Save Changes' : 'Create User'}</Button>
      </FormActions>
    </form>
  );
}

function InviteForm({ onSuccess }: { onSuccess: (link: string) => void }) {
  const { options: roleOptions, isLoading: rolesLoading } = useRoleOptions();
  const [form, setForm] = useState({ email: '', roleId: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/admin/users/invite', form);
      onSuccess(res.data.link);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to send invite');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="form-section">
        <p className="form-section-title">Invite Details</p>
        <div className="space-y-4">
          <Field label="Email address" required>
            <Input aria-label="Email" required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="colleague@company.com" />
          </Field>
          <Field
            label="Role"
            required
            hint="The role is stored on the invite, so a custom role survives until the person accepts."
          >
            <SearchableSelect
              ariaLabel="Role"
              value={form.roleId}
              onChange={val => setForm(f => ({ ...f, roleId: val }))}
              required
              options={rolesLoading ? [{ value: '', label: 'Loading roles…' }] : roleOptions}
            />
          </Field>
        </div>
      </div>
      <FormActions>
        <Button type="submit" loading={loading} icon={<Mail size={14} />}>Generate Invite Link</Button>
      </FormActions>
    </form>
  );
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div className="space-y-3">
      <Alert tone="success" icon={<Check size={16} />} className="font-medium">
        Invite link generated!
      </Alert>
      <p className="text-[13px] text-fg-muted">Share this link with the invitee — it expires in 7 days:</p>
      <div className="flex gap-2">
        <Input
          readOnly
          value={link}
          aria-label="Invite link"
          inputSize="sm"
          className="flex-1 font-mono truncate !bg-surface-sunken"
        />
        <Button size="sm" icon={copied ? <Check size={13} /> : <Copy size={13} />} onClick={copy}>
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

type ModalState = null | 'create' | 'invite' | { type: 'edit'; user: any };

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const { date } = useFormat();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalState>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const qc = useQueryClient();

  /* This page already refused these roles — but only after firing its two
     admin-scoped reads, so the refusal arrived with a pair of 403s behind it.
     Decide first, then ask. */
  const blocked = !!currentUser && BLOCKED_ROLES.includes(currentUser.role);

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get('/admin/users').then(r => Array.isArray(r.data) ? r.data : r.data.data ?? []),
    enabled: !blocked,
  });

  // Users with no employee record. Provisioning is automatic and non-throwing,
  // so this should normally be zero — when it isn't, it's a repairable state
  // rather than something to re-enter by hand.
  const unlinked = (users ?? []).filter((u: any) => !u.employee);

  const reconcile = useMutation({
    mutationFn: () => api.post('/admin/users/reconcile-employees?fix=true').then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const { data: invites } = useQuery({
    queryKey: ['admin-invites'],
    queryFn: () => api.get('/org/invites').then(r => r.data),
    enabled: !blocked,
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post('/admin/users', data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); setModal(null); },
  });
  const update = useMutation({
    mutationFn: ({ id, ...data }: any) => api.patch(`/admin/users/${id}`, data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); setModal(null); },
  });
  const deactivate = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/users/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
  const resetPassword = useMutation({
    mutationFn: (id: string) => api.post(`/admin/users/${id}/reset-password`).then(r => r.data),
    onSuccess: (data: any) => alert(data?.message || 'Reset link sent.'),
    onError: (err: any) => alert(err?.response?.data?.error || 'Could not send reset link.'),
  });

  const filtered = users?.filter((u: any) =>
    !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  );

  const roleGroups = ROLES.reduce((acc: any, role) => {
    acc[role] = users?.filter((u: any) => u.role === role).length || 0;
    return acc;
  }, {});

  const pendingInvites = invites?.filter((i: any) => !i.usedAt && new Date(i.expiresAt) > new Date()) || [];

  function closeModal() {
    setModal(null);
    setInviteLink(null);
  }

  const columns: Column<any>[] = [
    {
      key: 'user',
      header: 'User',
      cell: u => (
        <div className="flex items-center gap-3">
          <Avatar name={u.name} size="md" />
          <div>
            <p className="font-medium text-fg">{u.name}</p>
            <p className="text-[11.5px] text-fg-subtle">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      // Show the assigned Role's name when there is one — a custom role like
      // "Regional Sales Head" is far more useful here than the base access
      // level it maps to. Users still on the legacy enum fall back to it.
      cell: u => (
        <Badge variant={roleVariant[u.role] || 'gray'}>
          {u.roleRef?.name ?? u.role.replace(/_/g, ' ')}
        </Badge>
      ),
    },
    { key: 'department', header: 'Department', muted: true, cell: u => u.department || '—' },
    {
      key: 'employee',
      header: 'Employee',
      // Adding a user creates their employee record automatically, so this
      // should read as a code for everyone. "Not linked" means provisioning
      // was skipped or failed — use "Fix employee records" above to repair it.
      cell: u => u.employee
        ? <span className="text-[11.5px] font-mono text-fg-muted">{u.employee.employeeCode}</span>
        : <Badge variant="orange">Not linked</Badge>,
    },
    {
      key: 'lastLogin',
      header: 'Last Login',
      hideBelow: 'sm',
      cell: () => <span className="text-fg-subtle">—</span>,
    },
    {
      key: 'createdAt',
      header: 'Created At',
      hideBelow: 'sm',
      cell: u => <span className="text-fg-subtle">{u.createdAt ? date(u.createdAt) : '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: u => <Badge variant={u.isActive ? 'green' : 'gray'}>{u.isActive ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: u => (
        <RowActions items={[
          { label: 'Edit', icon: <Pencil size={14} />, onClick: () => setModal({ type: 'edit', user: u }) },
          { label: 'Reset Password', icon: <KeyRound size={14} />, onClick: () => resetPassword.mutate(u.id), hidden: !u.isActive },
          { label: 'Deactivate', icon: <UserX size={14} />, onClick: () => deactivate.mutate(u.id), variant: 'danger', hidden: !u.isActive },
          { label: 'Reactivate', icon: <Shield size={14} />, onClick: () => update.mutate({ id: u.id, isActive: true }), hidden: u.isActive },
        ]} />
      ),
    },
  ];

  if (blocked) {
    return <AccessDenied />;
  }

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Users"
        subtitle={`${filtered?.length ?? 0} users`}
        actions={<>
          <SearchInput value={search} onChange={setSearch} placeholder="Search users..." />
          <Button variant="secondary" icon={<Mail size={15} />} onClick={() => { setInviteLink(null); setModal('invite'); }}>Invite User</Button>
          <Button icon={<Plus size={15} />} onClick={() => setModal('create')}>Create User</Button>
        </>}
      />

      <PageBody>
        {/* Role summary */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {ROLES.map(role => (
            <StatTile key={role} label={role.replace(/_/g, ' ')} value={roleGroups[role]} />
          ))}
        </div>

        {/* Users with no employee record — one click to repair, never re-entry. */}
        {unlinked.length > 0 && (
          <Alert
            tone="warning"
            title={`${unlinked.length} user${unlinked.length === 1 ? '' : 's'} without an employee record`}
            actions={
              <Button
                variant="secondary"
                loading={reconcile.isPending}
                onClick={() => reconcile.mutate()}
              >
                Create {unlinked.length} employee record{unlinked.length === 1 ? '' : 's'}
              </Button>
            }
          >
            New users normally get one automatically. These predate that, or were created while HR was unavailable —
            creating them here takes a second and needs no re-typing.
          </Alert>
        )}

        {/* Pending Invites */}
        {pendingInvites.length > 0 && (
          <Alert tone="warning" title={`Pending Invites (${pendingInvites.length})`}>
            <div className="space-y-1 mt-1">
              {pendingInvites.map((inv: any) => (
                <div key={inv.id} className="flex items-center justify-between gap-2">
                  <span>{inv.email}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="yellow">{inv.role.replace(/_/g, ' ')}</Badge>
                    <span className="text-[11.5px] opacity-80">Expires {date(inv.expiresAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Alert>
        )}

        <Card padding="none">
          <DataTable
            columns={columns}
            rows={filtered ?? []}
            rowKey={(u: any) => u.id}
            minWidth={640}
            loading={isLoading}
            empty={
              <EmptyState
                icon={<Users size={24} />}
                title="No users found"
                description="Invite or create team members to get started"
                action={{ label: 'Invite User', onClick: () => setModal('invite') }}
              />
            }
          />
        </Card>
      </PageBody>

      {/* Create User Modal */}
      <Modal open={modal === 'create'} onClose={closeModal} title="Create User">
        <UserForm
          loading={create.isPending}
          onSubmit={(form: any) => create.mutate(form)}
        />
      </Modal>

      {/* Edit User Modal */}
      <Modal open={!!(modal && typeof modal === 'object' && modal.type === 'edit')} onClose={closeModal} title="Edit User">
        <UserForm
          initial={modal && typeof modal === 'object' && modal.type === 'edit' ? modal.user : null}
          loading={update.isPending}
          onSubmit={(form: any) => {
            if (modal && typeof modal === 'object' && modal.type === 'edit') {
              update.mutate({ id: modal.user.id, ...form });
            }
          }}
        />
      </Modal>

      {/* Invite User Modal */}
      <Modal open={modal === 'invite'} onClose={closeModal} title="Invite Team Member">
        {inviteLink ? (
          <CopyLink link={inviteLink} />
        ) : (
          <InviteForm onSuccess={(link) => {
            setInviteLink(link);
            qc.invalidateQueries({ queryKey: ['admin-invites'] });
          }} />
        )}
      </Modal>

    </div>
  );
}
