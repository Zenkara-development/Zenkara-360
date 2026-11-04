import { useState } from 'react';
import {
  usePeople,
  usePeopleStats,
  useCreatePerson,
  useGrantLogin,
  useRevokeLogin,
  useAssignPersonRole,
  useRepairUnlinked,
  useDepartments,
  useLocations,
  useEmployees,
  type Person,
} from '../../api/people';
import { useRoles } from '../../api/work';
import {
  PageHeader, PageBody, Toolbar, Card, PastelStatCard, Tabs, Button, Modal, Badge, StatusBadge, Avatar,
  Field, Input, Select, Alert, FormError, EmptyState, SearchInput, RowActions,
  SkeletonTable, type BadgeProps,
} from '../../shared/components';
import { UserSquare2, Plus, KeyRound, ShieldOff, Copy, Check, Link2, Building2, Mail, Users, LogIn, UserX, BellRing } from 'lucide-react';
import { useFormat } from '../../hooks/useFormat';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../../shared/permissions';

/**
 * People — one screen for everyone in the organization.
 *
 * Replaces the old split between Administration → Users and HR → Employees.
 * Underneath, User and Employee are still separate tables (a login costs a
 * metered seat, and bank/tax data has no business on an auth record), but that
 * is an implementation detail an admin should never have to hold in their head.
 * Here a person simply either can sign in or cannot.
 */

const STATUS_VARIANT: Record<string, NonNullable<BadgeProps['variant']>> = {
  ACTIVE: 'green',
  PROBATION: 'yellow',
  ON_LEAVE: 'blue',
  NOTICE_PERIOD: 'orange',
  SUSPENDED: 'red',
  EXITED: 'gray',
};

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT', 'TEMPORARY'];

function InviteLinkBox({ link, onDone }: { link: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Alert tone="success" title="Invite created">
      <p className="mb-3">
        We emailed it too, but sending can fail quietly — copy the link so you have it either way.
      </p>
      <div className="flex items-center gap-2">
        <Input readOnly value={link} aria-label="Invite link" className="font-mono !text-[11.5px]" />
        <Button
          size="sm"
          variant="secondary"
          aria-label="Copy invite link"
          icon={copied ? <Check size={13} /> : <Copy size={13} />}
          onClick={() => {
            navigator.clipboard?.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        />
      </div>
      <div className="flex justify-end mt-3">
        <Button size="sm" onClick={onDone}>Done</Button>
      </div>
    </Alert>
  );
}

// ─── Add person ───────────────────────────────────────────────────────────────

const LOGIN_MODES = [
  { key: 'invite', label: 'Send an invite' },
  { key: 'password', label: 'Set a password' },
  { key: 'none', label: 'No login' },
] as const;

function AddPersonModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreatePerson();
  const { data: departments } = useDepartments();
  const { data: locations } = useLocations();
  const { data: managers } = useEmployees({ limit: '200' });
  // GET /permissions/roles is MANAGERS-only, and this modal stays mounted
  // (closed) for the life of the page — so the lookup used to go out for every
  // role that can open People, including reps and employees.
  const { user } = useAuth();
  const { data: roles } = useRoles(can.readRoles(user?.role));

  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    designation: '',
    departmentId: '',
    locationId: '',
    managerId: '',
    phone: '',
    joiningDate: new Date().toISOString().slice(0, 10),
    employmentType: 'FULL_TIME',
    loginMode: 'invite' as 'none' | 'password' | 'invite',
    email: '',
    password: '',
    roleId: '',
  });

  const needsEmail = form.loginMode !== 'none';

  const reset = () => {
    setForm({
      firstName: '', lastName: '', designation: '', departmentId: '', locationId: '', managerId: '',
      phone: '', joiningDate: new Date().toISOString().slice(0, 10), employmentType: 'FULL_TIME',
      loginMode: 'invite', email: '', password: '', roleId: '',
    });
    setInviteLink(null);
    setError('');
  };

  const submit = () => {
    setError('');
    create.mutate(
      {
        ...form,
        departmentId: form.departmentId || null,
        locationId: form.locationId || null,
        managerId: form.managerId || null,
        email: needsEmail ? form.email : undefined,
        password: form.loginMode === 'password' ? form.password : undefined,
        roleId: needsEmail ? form.roleId || undefined : undefined,
      },
      {
        onSuccess: res => {
          if (res.inviteLink) setInviteLink(res.inviteLink);
          else {
            reset();
            onClose();
          }
        },
        onError: (err: any) => setError(err?.response?.data?.error || 'Could not add that person.'),
      }
    );
  };

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Add a person"
      subtitle="Everyone who works here — whether or not they need to sign in."
      icon={<UserSquare2 size={16} />}
      size="lg"
      footer={
        inviteLink ? undefined : (
          <>
            <Button variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button
              onClick={submit}
              loading={create.isPending}
              disabled={!form.firstName.trim() || !form.joiningDate || (needsEmail && !form.email.trim())}
            >
              Add person
            </Button>
          </>
        )
      }
    >
      {inviteLink ? (
        <InviteLinkBox link={inviteLink} onDone={() => { reset(); onClose(); }} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" required>
              <Input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} />
            </Field>
            <Field label="Last name">
              <Input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} />
            </Field>
            <Field label="Designation">
              <Input value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Account Executive" />
            </Field>
            <Field label="Joining date" required>
              <Input type="date" value={form.joiningDate} onChange={e => setForm({ ...form, joiningDate: e.target.value })} />
            </Field>
            <Field label="Department">
              <Select value={form.departmentId} onChange={e => setForm({ ...form, departmentId: e.target.value })}>
                <option value="">—</option>
                {(departments?.data ?? []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Location">
              <Select value={form.locationId} onChange={e => setForm({ ...form, locationId: e.target.value })}>
                <option value="">—</option>
                {(locations?.data ?? []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="Reports to">
              <Select value={form.managerId} onChange={e => setForm({ ...form, managerId: e.target.value })}>
                <option value="">—</option>
                {(managers?.data ?? []).map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
              </Select>
            </Field>
            <Field label="Employment type">
              <Select
                value={form.employmentType}
                onChange={e => setForm({ ...form, employmentType: e.target.value })}
                options={EMPLOYMENT_TYPES.map(t => ({ value: t, label: t.replace(/_/g, ' ') }))}
              />
            </Field>
          </div>

          {/* ── Access ── */}
          <div className="border-t border-line-subtle pt-4">
            <Field label="System access">
              <Tabs
                variant="segmented"
                aria-label="System access"
                className="mb-3 w-fit"
                value={form.loginMode}
                onChange={key => setForm({ ...form, loginMode: key })}
                items={LOGIN_MODES.map(o => ({ key: o.key, label: o.label }))}
              />
            </Field>

            {form.loginMode === 'none' ? (
              <p className="text-[12px] text-fg-muted">
                They'll appear in the directory and org chart, can be assigned tasks and hold assets — but cannot sign
                in, and don't use a licensed seat. You can grant access later at any time.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Work email" required>
                  <Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" />
                </Field>
                <Field label="Role">
                  <Select value={form.roleId} onChange={e => setForm({ ...form, roleId: e.target.value })}>
                    <option value="">Employee (self-service only)</option>
                    {(roles?.data ?? []).filter(r => r.isActive).map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </Select>
                </Field>
                {form.loginMode === 'password' && (
                  <Field label="Password" required className="col-span-2">
                    <Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" />
                  </Field>
                )}
              </div>
            )}
          </div>

          <FormError>{error}</FormError>
        </div>
      )}
    </Modal>
  );
}

// ─── Grant login to an existing person ────────────────────────────────────────

function GrantLoginModal({ person, onClose }: { person: Person | null; onClose: () => void }) {
  const grant = useGrantLogin();
  // Mounted with `person === null` until someone picks a row, so gate the
  // MANAGERS-only role lookup rather than firing it on every page load.
  const { user } = useAuth();
  const { data: roles } = useRoles(can.readRoles(user?.role));
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', roleId: '', mode: 'invite' as 'password' | 'invite', password: '' });

  if (!person) return null;

  return (
    <Modal
      open={!!person}
      onClose={() => { setInviteLink(null); onClose(); }}
      title={`Give ${person.displayName} a login`}
      subtitle="They stay the same person — this only adds system access."
      icon={<KeyRound size={16} />}
      footer={
        inviteLink ? undefined : (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              loading={grant.isPending}
              disabled={!form.email.trim() || (form.mode === 'password' && form.password.length < 8)}
              onClick={() => {
                setError('');
                grant.mutate(
                  { id: person.employeeId!, ...form, roleId: form.roleId || undefined },
                  {
                    onSuccess: res => {
                      if (res.inviteLink) setInviteLink(res.inviteLink);
                      else onClose();
                    },
                    onError: (err: any) => setError(err?.response?.data?.error || 'Could not create that login.'),
                  }
                );
              }}
            >
              {form.mode === 'invite' ? 'Send invite' : 'Create login'}
            </Button>
          </>
        )
      }
    >
      {inviteLink ? (
        <InviteLinkBox link={inviteLink} onDone={() => { setInviteLink(null); onClose(); }} />
      ) : (
        <div className="space-y-3">
          <Tabs
            variant="segmented"
            aria-label="Login mode"
            value={form.mode}
            onChange={mode => setForm({ ...form, mode })}
            items={[
              { key: 'invite' as const, label: 'Send an invite' },
              { key: 'password' as const, label: 'Set a password' },
            ]}
          />
          <Field label="Work email" required>
            <Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Role">
            <Select value={form.roleId} onChange={e => setForm({ ...form, roleId: e.target.value })}>
              <option value="">Employee (self-service only)</option>
              {(roles?.data ?? []).filter(r => r.isActive).map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </Select>
          </Field>
          {form.mode === 'password' && (
            <Field label="Password" required>
              <Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            </Field>
          )}
          <FormError>{error}</FormError>
        </div>
      )}
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = [
  { key: '', label: 'Everyone' },
  { key: 'yes', label: 'Can sign in' },
  { key: 'no', label: 'No login' },
] as const;

export default function PeoplePage() {
  const { user: currentUser } = useAuth();
  const fmt = useFormat();

  const [login, setLogin] = useState<'' | 'yes' | 'no'>('');
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [granting, setGranting] = useState<Person | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading } = usePeople({
    login: login || undefined,
    search: search || undefined,
    departmentId: departmentId || undefined,
  });
  const { data: stats } = usePeopleStats();
  const { data: departments } = useDepartments();
  /* The role list drives the per-row role selector, and both it and the
     assignment endpoint behind that selector are MANAGERS-only. For everyone
     else the row shows the person's role as plain text instead. */
  const canReadRoles = can.readRoles(currentUser?.role);
  const canManagePeople = can.managePeople(currentUser?.role);
  const { data: roles } = useRoles(canReadRoles);

  const revoke = useRevokeLogin();
  const assignRole = useAssignPersonRole();
  const repair = useRepairUnlinked();

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="People"
        icon={Users}
        subtitle="Everyone in the organization — staff who sign in, and staff who don't."
        actions={
          <Button icon={<Plus size={15} />} onClick={() => setAddOpen(true)}>
            Add person
          </Button>
        }
      />

      <div className="flex-1 overflow-auto">
        <PageBody>
          {stats && (
            <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4 gap-4">
              {([
                { label: 'Total people', value: stats.total,     icon: Users,    tone: 'blue' },
                { label: 'Can sign in',  value: stats.canSignIn, icon: LogIn,    tone: 'green' },
                { label: 'No login',     value: stats.noLogin,   icon: UserX,    tone: 'orange' },
                { label: 'On notice',    value: stats.onNotice,  icon: BellRing, tone: 'purple' },
              ] as const).map(s => (
                <PastelStatCard key={s.label} variant="soft" label={s.label} value={s.value} icon={s.icon} tone={s.tone} />
              ))}
            </div>
          )}

          {/* Logins that never got an employee record — one click to repair. */}
          {!!stats?.unlinkedLogins && (
            <Alert
              tone="warning"
              title={`${stats.unlinkedLogins} login${stats.unlinkedLogins === 1 ? '' : 's'} without a person record`}
              actions={
                <Button size="sm" variant="secondary" icon={<Link2 size={13} />} loading={repair.isPending} onClick={() => repair.mutate()}>
                  Fix {stats.unlinkedLogins}
                </Button>
              }
            >
              They can sign in but are missing from the directory and org chart. Creating the records takes a second
              and needs no re-typing.
            </Alert>
          )}

          <FormError>{error}</FormError>

          <Toolbar>
            <Tabs
              variant="pill"
              aria-label="Filter by login"
              value={login}
              onChange={setLogin}
              items={TABS.map(t => ({ key: t.key, label: t.label }))}
            />
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, code, email…" className="sm:w-80" />
            <Select
              className="w-auto"
              aria-label="Filter by department"
              value={departmentId}
              onChange={e => setDepartmentId(e.target.value)}
            >
              <option value="">All departments</option>
              {(departments?.data ?? []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Toolbar>

          {isLoading ? (
            <SkeletonTable rows={6} />
          ) : !data?.data.length ? (
            <EmptyState
              icon={<UserSquare2 />}
              title="Nobody here yet"
              description="Add your first person — you can decide whether they need a login."
              action={{ label: 'Add person', onClick: () => setAddOpen(true) }}
            />
          ) : (
            <Card padding="none" className="overflow-hidden">
              {data.data.map(p => (
                <div
                  key={p.id}
                  className="flex items-center gap-3.5 px-5 py-3.5 border-b border-line-subtle last:border-0 hover:bg-surface-hover transition-colors"
                >
                  <Avatar name={p.displayName} size="lg" />

                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold text-fg truncate" title={p.displayName}>{p.displayName}</p>
                    <div className="flex items-center gap-2 text-[12px] text-fg-muted flex-wrap mt-0.5">
                      {p.employeeCode && <span>{p.employeeCode}</span>}
                      {p.designation && <span>· {p.designation}</span>}
                      {p.department && (
                        <span className="inline-flex items-center gap-1">· <Building2 size={10} /> {p.department.name}</span>
                      )}
                      {p.email && (
                        <span className="inline-flex items-center gap-1">· <Mail size={10} /> {p.email}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Access state, said plainly rather than in table terms. */}
                    {!p.hasLogin ? (
                      <Badge variant="gray">No login</Badge>
                    ) : !p.loginActive ? (
                      <Badge variant="red">Access revoked</Badge>
                    ) : p.employeeId && canManagePeople ? (
                      <Select
                        selectSize="sm"
                        className="max-w-[150px]"
                        aria-label={`Role for ${p.displayName}`}
                        value={p.roleId ?? ''}
                        onChange={e => {
                          setError('');
                          assignRole.mutate(
                            { id: p.employeeId!, roleId: e.target.value },
                            { onError: (err: any) => setError(err?.response?.data?.error || 'Could not change that role.') }
                          );
                        }}
                      >
                        {!p.roleId && <option value="">{p.role?.replace(/_/g, ' ') ?? 'No role'}</option>}
                        {(roles?.data ?? []).filter(r => r.isActive).map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </Select>
                    ) : (
                      <Badge variant="blue">{p.roleName ?? 'Login'}</Badge>
                    )}

                    {p.employmentStatus && (
                      <StatusBadge value={p.employmentStatus} map={STATUS_VARIANT} dot />
                    )}

                    {!p.employeeId && <Badge variant="orange">Not in directory</Badge>}

                    <span className="text-[11px] text-fg-subtle tabular-nums hidden lg:block w-20 text-right">
                      {p.joiningDate ? fmt.date(p.joiningDate) : ''}
                    </span>

                    <RowActions
                      items={[
                        ...(p.employeeId && !p.hasLogin
                          ? [{ label: 'Give a login', icon: <KeyRound size={13} />, onClick: () => setGranting(p) }]
                          : []),
                        ...(p.employeeId && p.hasLogin && p.userId !== currentUser?.id
                          ? [{
                              label: 'Revoke access',
                              icon: <ShieldOff size={13} />,
                              variant: 'danger' as const,
                              onClick: () => {
                                setError('');
                                revoke.mutate(p.employeeId!, {
                                  onError: (err: any) =>
                                    setError(err?.response?.data?.error || 'Could not revoke access.'),
                                });
                              },
                            }]
                          : []),
                      ]}
                    />
                  </div>
                </div>
              ))}
            </Card>
          )}

          {canManagePeople && !!data?.data.some(p => p.hasLogin) && (
            <p className="text-[11.5px] text-fg-subtle">
              Change a role from the selector on any row. Create and edit the roles themselves under{' '}
              <span className="font-medium">Administration → Roles &amp; Permissions</span>.
            </p>
          )}
        </PageBody>
      </div>

      <AddPersonModal open={addOpen} onClose={() => setAddOpen(false)} />
      <GrantLoginModal person={granting} onClose={() => setGranting(null)} />
    </div>
  );
}
