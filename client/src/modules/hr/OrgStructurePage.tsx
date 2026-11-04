import { useState } from 'react';
import {
  useDepartmentTree,
  useDepartments,
  useCreateDepartment,
  useDeleteDepartment,
  useTeams,
  useCreateTeam,
  useDeleteTeam,
  useAddTeamMember,
  useRemoveTeamMember,
  useLocations,
  useCreateLocation,
  useDeleteLocation,
  useEmployees,
  type Department,
} from '../../api/people';
import {
  PageHeader, PageBody, Card, Tabs, PastelStatCard, Button, IconButton, Modal, Badge, EmptyState,
  Field, Input, Select, FormError, SkeletonCard, SkeletonTable,
} from '../../shared/components';
import { Building2, Plus, Users2, MapPin, Trash2, ChevronRight, X, Network } from 'lucide-react';

/**
 * Org structure — departments, teams and locations.
 *
 * These three exist because `User.department: String?` could not answer
 * "who runs Sales?", "which department does this cost centre belong to?" or
 * "who is on the escalation team?". Team membership additionally feeds
 * TEAM-scoped permissions, so editing a team here changes what its members
 * can see.
 */

// ─── Departments ──────────────────────────────────────────────────────────────

function DepartmentNode({ dept, depth = 0 }: { dept: Department; depth?: number }) {
  const [open, setOpen] = useState(true);
  const del = useDeleteDepartment();
  const [error, setError] = useState('');
  const children = dept.children ?? [];

  return (
    <div className={depth > 0 ? 'ml-6 border-l border-line pl-4' : ''}>
      <div className="flex items-center gap-3 py-3 group">
        {children.length > 0 ? (
          <IconButton
            size="xs"
            label={open ? 'Collapse departments' : 'Expand departments'}
            icon={<span className="text-[10px]">{open ? '▾' : '▸'}</span>}
            onClick={() => setOpen(v => !v)}
          />
        ) : (
          <span className="w-4" />
        )}
        <span className="tile-blue tile-surface tile-text w-10 h-10 rounded-full flex items-center justify-center shrink-0">
          <Building2 size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[15px] font-bold text-fg truncate" title={dept.name}>
            {dept.name}
            {dept.code && <Badge variant="blue" size="sm">{dept.code}</Badge>}
          </p>
          <p className="text-[12px] text-fg-muted mt-0.5">
            {dept._count?.employees ?? 0} people
            {dept.head ? ` · led by ${dept.head.displayName}` : ' · no head set'}
            {dept.costCenter ? ` · ${dept.costCenter}` : ''}
          </p>
        </div>
        {!dept.isActive && <Badge variant="gray">Inactive</Badge>}
        <IconButton
          label="Delete department"
          tone="danger"
          revealOnRowHover
          icon={<Trash2 size={13} />}
          onClick={() => {
            setError('');
            del.mutate(dept.id, {
              onError: (err: any) => setError(err?.response?.data?.error || 'Could not delete.'),
            });
          }}
        />
      </div>
      {error && <FormError className="ml-10 mb-1 !text-[11.5px]">{error}</FormError>}
      {open && children.map(c => <DepartmentNode key={c.id} dept={c} depth={depth + 1} />)}
    </div>
  );
}

function DepartmentsPanel() {
  const { data, isLoading } = useDepartmentTree();
  const { data: flat } = useDepartments();
  const { data: employees } = useEmployees({ limit: '200' });
  const create = useCreateDepartment();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', code: '', parentId: '', headId: '', costCenter: '' });

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12.5px] text-fg-muted">
          Departments nest, so you can model Sales → Inside Sales → SDR.
        </p>
        <Button size="sm" icon={<Plus size={14} />} onClick={() => setOpen(true)}>
          Department
        </Button>
      </div>

      {isLoading ? (
        <SkeletonCard lines={5} />
      ) : !data?.data.length ? (
        <EmptyState
          icon={<Building2 />}
          title="No departments yet"
          description="Create your first department, or run the backfill to generate them from existing user records."
          action={{ label: 'Add department', onClick: () => setOpen(true) }}
        />
      ) : (
        <Card padding="none" className="px-5 py-1 divide-y divide-line-subtle">
          {data.data.map(d => (
            <DepartmentNode key={d.id} dept={d} />
          ))}
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New department"
        icon={<Building2 size={16} />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              disabled={!form.name.trim()}
              onClick={() => {
                setError('');
                create.mutate(
                  {
                    name: form.name,
                    code: form.code || null,
                    parentId: form.parentId || null,
                    headId: form.headId || null,
                    costCenter: form.costCenter || null,
                  },
                  {
                    onSuccess: () => {
                      setForm({ name: '', code: '', parentId: '', headId: '', costCenter: '' });
                      setOpen(false);
                    },
                    onError: (err: any) => setError(err?.response?.data?.error || 'Could not create that department.'),
                  }
                );
              }}
            >
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name">
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code">
              <Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
            </Field>
            <Field label="Cost centre">
              <Input value={form.costCenter} onChange={e => setForm({ ...form, costCenter: e.target.value })} />
            </Field>
          </div>
          <Field label="Parent department">
            <Select value={form.parentId} onChange={e => setForm({ ...form, parentId: e.target.value })}>
              <option value="">— top level —</option>
              {(flat?.data ?? []).map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Head of department" hint='Used by approval policies with a "Department head" step.'>
            <Select value={form.headId} onChange={e => setForm({ ...form, headId: e.target.value })}>
              <option value="">—</option>
              {(employees?.data ?? []).map(e => (
                <option key={e.id} value={e.id}>
                  {e.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <FormError>{error}</FormError>
        </div>
      </Modal>
    </>
  );
}

// ─── Teams ────────────────────────────────────────────────────────────────────

function TeamsPanel() {
  const { data, isLoading } = useTeams();
  const { data: departments } = useDepartments();
  const { data: employees } = useEmployees({ limit: '200' });
  const create = useCreateTeam();
  const del = useDeleteTeam();
  const addMember = useAddTeamMember();
  const removeMember = useRemoveTeamMember();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', description: '', departmentId: '', leadId: '' });

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12.5px] text-fg-muted">
          Team membership drives TEAM-scoped permissions — members can see each other's records where a role allows it.
        </p>
        <Button size="sm" icon={<Plus size={14} />} onClick={() => setOpen(true)}>
          Team
        </Button>
      </div>

      {isLoading ? (
        <SkeletonTable rows={3} />
      ) : !data?.data.length ? (
        <EmptyState
          icon={<Users2 />}
          title="No teams yet"
          description="Teams group people across departments — useful for escalation rotas and shared queues."
          action={{ label: 'Create team', onClick: () => setOpen(true) }}
        />
      ) : (
        <div className="space-y-2">
          {data.data.map(t => (
            <Card key={t.id} padding="none" className="overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3.5">
                <IconButton
                  size="xs"
                  label={expanded === t.id ? 'Collapse team' : 'Expand team'}
                  icon={
                    <ChevronRight
                      size={14}
                      className={expanded === t.id ? 'rotate-90 transition-transform' : 'transition-transform'}
                    />
                  }
                  onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                />
                <span className="tile-green tile-surface tile-text w-10 h-10 rounded-full flex items-center justify-center shrink-0">
                  <Users2 size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-fg truncate" title={t.name}>{t.name}</p>
                  <p className="text-[12px] text-fg-muted mt-0.5">
                    {t.members.length} member{t.members.length === 1 ? '' : 's'}
                    {t.department ? ` · ${t.department.name}` : ''}
                    {t.lead ? ` · led by ${t.lead.displayName}` : ''}
                  </p>
                </div>
                <IconButton
                  label="Delete team"
                  tone="danger"
                  icon={<Trash2 size={13} />}
                  onClick={() => del.mutate(t.id)}
                />
              </div>

              {expanded === t.id && (
                <div className="px-4 pb-3 border-t border-line-subtle pt-3">
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {t.members.map(m => (
                      <span
                        key={m.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[11.5px] rounded-badge bg-surface-sunken text-fg"
                      >
                        {m.employee.displayName}
                        {m.role === 'LEAD' && <span className="text-[10px] text-accent">lead</span>}
                        <IconButton
                          size="xs"
                          label="Remove member"
                          tone="danger"
                          className="!w-4 !h-4"
                          icon={<X size={11} />}
                          onClick={() => removeMember.mutate({ teamId: t.id, employeeId: m.employee.id })}
                        />
                      </span>
                    ))}
                    {!t.members.length && <span className="text-[12px] text-fg-subtle">No members yet</span>}
                  </div>
                  <Select
                    aria-label="Add a member"
                    value=""
                    onChange={e => {
                      if (e.target.value) addMember.mutate({ teamId: t.id, employeeId: e.target.value });
                    }}
                  >
                    <option value="">Add a member…</option>
                    {(employees?.data ?? [])
                      .filter(emp => !t.members.some(m => m.employee.id === emp.id))
                      .map(emp => (
                        <option key={emp.id} value={emp.id}>
                          {emp.displayName}
                        </option>
                      ))}
                  </Select>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New team"
        icon={<Users2 size={16} />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              disabled={!form.name.trim()}
              onClick={() => {
                setError('');
                create.mutate(
                  {
                    name: form.name,
                    description: form.description || undefined,
                    departmentId: form.departmentId || null,
                    leadId: form.leadId || null,
                  },
                  {
                    onSuccess: () => {
                      setForm({ name: '', description: '', departmentId: '', leadId: '' });
                      setOpen(false);
                    },
                    onError: (err: any) => setError(err?.response?.data?.error || 'Could not create that team.'),
                  }
                );
              }}
            >
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name">
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Department">
              <Select value={form.departmentId} onChange={e => setForm({ ...form, departmentId: e.target.value })}>
                <option value="">—</option>
                {(departments?.data ?? []).map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Team lead">
              <Select value={form.leadId} onChange={e => setForm({ ...form, leadId: e.target.value })}>
                <option value="">—</option>
                {(employees?.data ?? []).map(e => (
                  <option key={e.id} value={e.id}>
                    {e.displayName}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <FormError>{error}</FormError>
        </div>
      </Modal>
    </>
  );
}

// ─── Locations ────────────────────────────────────────────────────────────────

function LocationsPanel() {
  const { data, isLoading } = useLocations();
  const create = useCreateLocation();
  const del = useDeleteLocation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', code: '', type: 'BRANCH', city: '', country: '', timezone: '' });

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12.5px] text-fg-muted">
          A location is the HR/asset concept. Attendance geo-fences stay where they are and can roll up to one.
        </p>
        <Button size="sm" icon={<Plus size={14} />} onClick={() => setOpen(true)}>
          Location
        </Button>
      </div>

      {isLoading ? (
        <SkeletonTable rows={3} />
      ) : !data?.data.length ? (
        <EmptyState
          icon={<MapPin />}
          title="No locations yet"
          description="Add offices, plants and warehouses so employees and assets can be placed."
          action={{ label: 'Add location', onClick: () => setOpen(true) }}
        />
      ) : (
        <Card padding="none" className="overflow-hidden">
          {data.data.map(l => (
            <div
              key={l.id}
              className="flex items-center gap-3.5 px-5 py-3.5 border-b border-line-subtle last:border-0 group"
            >
              <span className="tile-orange tile-surface tile-text w-10 h-10 rounded-full flex items-center justify-center shrink-0">
                <MapPin size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold text-fg truncate" title={l.name}>{l.name}</p>
                <p className="text-[12px] text-fg-muted mt-0.5">
                  {[l.city, l.country].filter(Boolean).join(', ') || 'No address'}
                  {` · ${l._count?.employees ?? 0} people`}
                  {l._count?.officeLocations ? ` · ${l._count.officeLocations} geo-fence(s)` : ''}
                </p>
              </div>
              <Badge variant="indigo">{l.type.replace(/_/g, ' ')}</Badge>
              <IconButton
                label="Delete location"
                tone="danger"
                revealOnRowHover
                icon={<Trash2 size={13} />}
                onClick={() => del.mutate(l.id)}
              />
            </div>
          ))}
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New location"
        icon={<MapPin size={16} />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              disabled={!form.name.trim()}
              onClick={() => {
                setError('');
                create.mutate(
                  { ...form, code: form.code || null, city: form.city || null, country: form.country || null, timezone: form.timezone || null },
                  {
                    onSuccess: () => {
                      setForm({ name: '', code: '', type: 'BRANCH', city: '', country: '', timezone: '' });
                      setOpen(false);
                    },
                    onError: (err: any) => setError(err?.response?.data?.error || 'Could not create that location.'),
                  }
                );
              }}
            >
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Type">
              <Select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                {['HEAD_OFFICE', 'BRANCH', 'PLANT', 'WAREHOUSE', 'CLIENT_SITE', 'REMOTE'].map(t => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="City">
              <Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
            </Field>
            <Field label="Country">
              <Input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} />
            </Field>
          </div>
          <FormError>{error}</FormError>
        </div>
      </Modal>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'departments', label: 'Departments', icon: Building2 },
  { key: 'teams', label: 'Teams', icon: Users2 },
  { key: 'locations', label: 'Locations', icon: MapPin },
] as const;

export default function OrgStructurePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('departments');
  // Same queries the panels run, so these counts come from cache.
  const { data: departments } = useDepartments();
  const { data: teams } = useTeams();
  const { data: locations } = useLocations();
  const count = (d?: { data?: unknown[] }) => d?.data?.length ?? '…';

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Org Structure"
        icon={Network}
        subtitle="Departments, teams and locations — the backbone the org chart, approvals and permission scopes are built on."
      />

      <div className="flex-1 overflow-auto">
        <PageBody width="full">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <PastelStatCard variant="soft" tone="blue"   icon={Building2} label="Departments" value={count(departments)} onClick={() => setTab('departments')} />
            <PastelStatCard variant="soft" tone="green"  icon={Users2}    label="Teams"       value={count(teams)}       onClick={() => setTab('teams')} />
            <PastelStatCard variant="soft" tone="orange" icon={MapPin}    label="Locations"   value={count(locations)}   onClick={() => setTab('locations')} />
          </div>
          <Tabs<(typeof TABS)[number]['key']>
            aria-label="Org structure views"
            variant="pill"
            value={tab}
            onChange={setTab}
            items={TABS.map(t => ({ key: t.key, label: t.label, icon: <t.icon size={14} /> }))}
          />
          {tab === 'departments' && <DepartmentsPanel />}
          {tab === 'teams' && <TeamsPanel />}
          {tab === 'locations' && <LocationsPanel />}
        </PageBody>
      </div>
    </div>
  );
}
