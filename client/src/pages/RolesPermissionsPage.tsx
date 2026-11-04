import { useState, useMemo } from 'react';
import {
  useRoles,
  usePermissionCatalog,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
  useSetFieldPermission,
  useDeleteFieldPermission,
  type Role,
  type PermScope,
  type FieldAccess,
} from '../api/work';
import {
  PageHeader, PageBody, Button, IconButton, Modal, Badge, SkeletonTable, EmptyState, Card, Alert,
  FormError, Field, Input, Select, AccessDenied,
} from '../shared/components';
import { Shield, Plus, Trash2, Lock, Eye, EyeOff, Pencil } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../shared/permissions';

/**
 * Roles & permissions (§61, §66, §119).
 *
 * The mental model this screen has to teach in about five seconds:
 *
 *   - A **permission** is a verb on a resource ("read deals").
 *   - A **scope** answers *whose* records: none / own / team / department / all.
 *   - A **field rule** answers *which columns* — and is the only thing that
 *     stops a role that can read employees from also reading their salary.
 *
 * Scope is the part that didn't exist before: previously "can read deals"
 * always meant "can read every deal in the org".
 */

const SCOPES: PermScope[] = ['NONE', 'OWN', 'TEAM', 'DEPARTMENT', 'ALL'];

const SCOPE_HELP: Record<PermScope, string> = {
  NONE: 'No access at all',
  OWN: 'Only records they own or are assigned',
  TEAM: 'Their own, their team’s and their direct reports’',
  DEPARTMENT: 'Everything in their department',
  ALL: 'Every record in the organization',
};

const SCOPE_VARIANT: Record<PermScope, any> = {
  NONE: 'gray',
  OWN: 'blue',
  TEAM: 'teal',
  DEPARTMENT: 'indigo',
  ALL: 'orange',
};

const ACCESS_VARIANT: Record<FieldAccess, any> = {
  HIDDEN: 'red',
  MASKED: 'orange',
  READ: 'blue',
  WRITE: 'green',
};

// ─── Role editor ──────────────────────────────────────────────────────────────

function RoleEditor({ role, onClose }: { role: Role | null; onClose: () => void }) {
  // Mounted unconditionally by the page (it renders nothing until a role is
  // picked), so without this gate GET /permissions/catalog — MANAGERS-only —
  // went out on every load of this route, including from roles that can't read it.
  const { user } = useAuth();
  const { data: catalog } = usePermissionCatalog(can.readRoles(user?.role));
  const update = useUpdateRole();
  const setFieldPerm = useSetFieldPermission();
  const delFieldPerm = useDeleteFieldPermission();
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Record<string, PermScope>>({});
  const [newField, setNewField] = useState({ resource: 'employee', field: '', access: 'MASKED' as FieldAccess });

  const current = useMemo(() => {
    const map: Record<string, PermScope> = {};
    for (const p of role?.permissions ?? []) map[p.permissionKey] = p.scope;
    return { ...map, ...draft };
  }, [role, draft]);

  if (!role) return null;

  const save = () => {
    setError('');
    const permissions = Object.entries(current).map(([permissionKey, scope]) => ({ permissionKey, scope }));
    update.mutate(
      { id: role.id, permissions },
      {
        onSuccess: () => {
          setDraft({});
          onClose();
        },
        onError: (err: any) => setError(err?.response?.data?.error || 'Could not save those permissions.'),
      }
    );
  };

  return (
    <Modal
      open={!!role}
      onClose={onClose}
      title={`${role.name} permissions`}
      subtitle={
        role.orgId === null
          ? 'This is a built-in template — saving creates a copy for your organization.'
          : `${role._count?.users ?? 0} user(s) have this role`
      }
      icon={<Shield size={16} />}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={update.isPending}>
            Save permissions
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2 text-[11.5px]">
          {SCOPES.map(s => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <Badge variant={SCOPE_VARIANT[s]}>{s}</Badge>
              <span className="text-fg-subtle">{SCOPE_HELP[s]}</span>
            </span>
          ))}
        </div>

        {Object.entries(catalog?.data ?? {}).map(([module, perms]) => (
          <div key={module}>
            <p className="text-[12px] font-semibold text-fg-muted uppercase tracking-wide mb-2">
              {module}
            </p>
            <div className="space-y-1">
              {perms.map(p => (
                <div key={p.key} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] text-fg truncate">
                      {p.label}
                      {p.isSensitive && <Lock size={10} className="inline ml-1 text-warning" />}
                    </p>
                    <p className="text-[10.5px] text-fg-subtle font-mono">{p.key}</p>
                  </div>
                  <div className="w-[150px] shrink-0">
                    <Select
                      aria-label={`Scope for ${p.label}`}
                      selectSize="sm"
                      value={current[p.key] ?? 'NONE'}
                      onChange={e => setDraft(d => ({ ...d, [p.key]: e.target.value as PermScope }))}
                    >
                      {SCOPES.map(s => (
                        <option key={s} value={s} disabled={!p.scopable && s !== 'NONE' && s !== 'ALL'}>
                          {s}
                          {!p.scopable && s !== 'NONE' && s !== 'ALL' ? ' (n/a)' : ''}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Field rules */}
        <div>
          <p className="text-[12px] font-semibold text-fg-muted uppercase tracking-wide mb-2">
            Field visibility
          </p>
          <p className="text-[11.5px] text-fg-subtle mb-2">
            Applies everywhere — API responses, search, exports and anything sent to AI. A field with no rule is fully
            visible.
          </p>

          <div className="space-y-1 mb-3">
            {(role.fieldPermissions ?? []).map(fp => (
              <div key={fp.id} className="flex items-center gap-2 text-[12.5px]">
                <span className="font-mono text-fg-muted">
                  {fp.resource}.{fp.field}
                </span>
                <Badge variant={ACCESS_VARIANT[fp.access]}>{fp.access}</Badge>
                <IconButton
                  size="xs"
                  tone="danger"
                  label="Remove field rule"
                  icon={<Trash2 size={12} />}
                  onClick={() => delFieldPerm.mutate({ roleId: role.id, fieldPermissionId: fp.id })}
                />
              </div>
            ))}
            {!role.fieldPermissions?.length && (
              <p className="text-[12px] text-fg-subtle">No field rules — every field this role can read is visible in full.</p>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-center">
            <Input
              aria-label="Resource"
              placeholder="resource"
              value={newField.resource}
              onChange={e => setNewField({ ...newField, resource: e.target.value })}
            />
            <Input
              aria-label="Field"
              placeholder="field"
              value={newField.field}
              onChange={e => setNewField({ ...newField, field: e.target.value })}
            />
            <Select
              aria-label="Access"
              value={newField.access}
              onChange={e => setNewField({ ...newField, access: e.target.value as FieldAccess })}
            >
              {(['HIDDEN', 'MASKED', 'READ', 'WRITE'] as FieldAccess[]).map(a => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="secondary"
              disabled={!newField.field.trim()}
              loading={setFieldPerm.isPending}
              onClick={() => {
                setError('');
                setFieldPerm.mutate(
                  { roleId: role.id, ...newField },
                  {
                    onSuccess: () => setNewField({ ...newField, field: '' }),
                    onError: (err: any) => setError(err?.response?.data?.error || 'Could not set that field rule.'),
                  }
                );
              }}
            >
              Add rule
            </Button>
          </div>
        </div>

        <FormError>{error}</FormError>
      </div>
    </Modal>
  );
}

/**
 * Seniority tiers, so "rank" is a choice rather than a number to guess at.
 *
 * Rank exists for one job: stopping privilege escalation. An admin cannot
 * create or edit a role more senior than their own, and cannot grant a
 * permission they do not hold themselves. Lower number = more senior.
 */
const RANK_TIERS = [
  { value: 10, label: 'Executive', hint: 'Cross-company visibility, usually read-only' },
  { value: 20, label: 'Department head', hint: 'Runs a function — sales, IT, HR, finance' },
  { value: 30, label: 'Team lead', hint: 'Owns a team and approves for it' },
  { value: 50, label: 'Individual contributor', hint: 'Works their own records' },
  { value: 90, label: 'Self-service only', hint: 'Own payslips, leave and requests' },
];

function NewRoleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateRole();
  const { user } = useAuth();
  const { data: roles } = useRoles(can.readRoles(user?.role));
  const [error, setError] = useState('');
  const [form, setForm] = useState({ key: '', name: '', description: '', rank: 50 });
  // Which existing role to copy permissions from. A role created with nothing
  // granted is useless, and setting ~130 permissions by hand to get to a
  // working starting point is not a reasonable ask — so copying is the
  // default path and "blank" is the deliberate exception.
  const [copyFromId, setCopyFromId] = useState('');

  const copyFrom = roles?.data.find(r => r.id === copyFromId);
  const copiedCount = copyFrom?.permissions.filter(p => p.scope !== 'NONE').length ?? 0;

  const reset = () => {
    setForm({ key: '', name: '', description: '', rank: 50 });
    setCopyFromId('');
  };

  const submit = () => {
    setError('');
    create.mutate(
      {
        ...form,
        description: form.description || undefined,
        // Copy only real grants; a NONE row is the same as no row.
        permissions: copyFrom?.permissions.filter(p => p.scope !== 'NONE'),
      },
      {
        onSuccess: () => {
          reset();
          onClose();
        },
        onError: (err: any) => setError(err?.response?.data?.error || 'Could not create that role.'),
      }
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New role"
      subtitle="A role is a set of permissions, each with a scope deciding whose records it covers."
      icon={<Shield size={16} />}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} disabled={!form.key.trim() || !form.name.trim()} onClick={submit}>
            Create role
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Display name" required hint="What people see in the role picker.">
          <Input
            value={form.name}
            onChange={e =>
              setForm({
                ...form,
                name: e.target.value,
                // Only auto-fill the key while the admin hasn't typed their own.
                key: form.key || e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
              })
            }
            placeholder="e.g. Regional Sales Head"
          />
        </Field>

        <Field
          label="Key"
          required
          hint="Uppercase, digits and underscores. Approval policies reference roles by this key, so it is worth getting right — renaming it later breaks any policy pointing at it."
        >
          <Input
            className="font-mono"
            value={form.key}
            onChange={e => setForm({ ...form, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
            placeholder="REGIONAL_SALES_HEAD"
          />
        </Field>

        <Field
          label="Description"
          hint="Optional, but the next admin deciding whether to use this role will thank you."
        >
          <Input
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="Who this role is for and what they are expected to do"
          />
        </Field>

        <Field
          label="Seniority"
          hint="Used only to prevent privilege escalation: nobody can create or edit a role more senior than their own."
        >
          <Select value={form.rank} onChange={e => setForm({ ...form, rank: Number(e.target.value) })}>
            {RANK_TIERS.map(t => (
              <option key={t.value} value={t.value}>
                {t.label} — {t.hint}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Start from"
          hint={copyFrom
            ? `Copies ${copiedCount} permission(s) with their scopes. Edit them after creating — field rules are not copied.`
            : 'A blank role can sign in but see nothing. Pick the closest existing role and trim it down instead.'}
        >
          <Select value={copyFromId} onChange={e => setCopyFromId(e.target.value)}>
            <option value="">Blank — no permissions at all</option>
            {(roles?.data ?? []).map(r => (
              <option key={r.id} value={r.id}>
                Copy of {r.name} ({r.permissions.filter(p => p.scope !== 'NONE').length} permissions)
              </option>
            ))}
          </Select>
        </Field>

        <FormError>{error}</FormError>
      </div>
    </Modal>
  );
}

export default function RolesPermissionsPage() {
  /* Everything on this page comes from /permissions/roles and
     /permissions/catalog, both MANAGERS-only. Anyone else who reaches the URL
     gets the refusal instead of an empty list they can't populate. */
  const { user } = useAuth();
  const canReadRoles = can.readRoles(user?.role);
  const { data, isLoading } = useRoles(canReadRoles);
  const del = useDeleteRole();
  const [editing, setEditing] = useState<Role | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [error, setError] = useState('');

  if (!canReadRoles) return <AccessDenied />;

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Roles & Permissions"
        subtitle="Who can do what, whose records they can do it to, and which fields they can see."
        actions={
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setNewOpen(true)}>
            New role
          </Button>
        }
      />

      <PageBody>
        <Alert tone="info">
          Built-in roles start with exactly the access they had before permissions became configurable, so nothing
          changed when this shipped. Narrowing a scope from <strong>ALL</strong> to <strong>TEAM</strong> takes effect
          within a minute — no deploy needed.
        </Alert>

        <FormError>{error}</FormError>

        {isLoading ? (
          <SkeletonTable rows={6} />
        ) : !data?.data.length ? (
          <EmptyState
            icon={<Shield />}
            title="No roles found"
            description="Run the permission seed to create the built-in roles, or create your first role from scratch."
            action={{ label: 'New role', onClick: () => setNewOpen(true) }}
          />
        ) : (
          <Card padding="none" className="overflow-hidden">
            {data.data.map(r => {
              const granted = r.permissions.filter(p => p.scope !== 'NONE');
              const widest = granted.some(p => p.scope === 'ALL')
                ? 'ALL'
                : granted.some(p => p.scope === 'DEPARTMENT')
                  ? 'DEPARTMENT'
                  : granted.some(p => p.scope === 'TEAM')
                    ? 'TEAM'
                    : granted.length
                      ? 'OWN'
                      : 'NONE';
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-3 px-4 py-3 border-b border-line-subtle last:border-0 group"
                >
                  <Shield size={15} className="text-fg-subtle shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[13.5px] font-medium text-fg truncate">{r.name}</p>
                      {r.isSystem && <Badge variant="gray">Built-in</Badge>}
                      {r.orgId === null && <Badge variant="blue">Template</Badge>}
                    </div>
                    <p className="text-[11px] text-fg-subtle truncate">
                      <span className="font-mono">{r.key}</span> · rank {r.rank} · {granted.length} permission
                      {granted.length === 1 ? '' : 's'}
                      {r.fieldPermissions?.length ? ` · ${r.fieldPermissions.length} field rule(s)` : ''}
                      {r._count?.users != null ? ` · ${r._count.users} user(s)` : ''}
                    </p>
                  </div>
                  <Badge variant={SCOPE_VARIANT[widest as PermScope]}>
                    {widest === 'ALL' ? <Eye size={10} className="inline mr-1" /> : <EyeOff size={10} className="inline mr-1" />}
                    {widest}
                  </Badge>
                  <Button size="xs" variant="secondary" icon={<Pencil size={11} />} onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                  {!r.isSystem && (
                    <IconButton
                      size="xs"
                      tone="danger"
                      revealOnRowHover
                      label="Delete role"
                      icon={<Trash2 size={13} />}
                      onClick={() => {
                        setError('');
                        del.mutate(r.id, {
                          onError: (err: any) => setError(err?.response?.data?.error || 'Could not delete that role.'),
                        });
                      }}
                    />
                  )}
                </div>
              );
            })}
          </Card>
        )}
      </PageBody>

      <RoleEditor role={editing} onClose={() => setEditing(null)} />
      <NewRoleModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
