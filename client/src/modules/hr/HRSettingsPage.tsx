import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../../shared/permissions';
import {
  PageHeader, PageBody, Card, CardHeader, Button, Modal, Badge, EmptyState, Tabs,
  RowActions, Field, Input, Checkbox, Alert, SkeletonTable, Toggle,
} from '../../shared/components';
import { Building2, Plus, Pencil, Trash2, Tag, ScanFace, Settings2, Clock, CalendarDays } from 'lucide-react';
import { PolicyGroupsSection } from './attendance/PolicyGroupsSection';
import { HolidaysSection } from './attendance/HolidaysSection';
import { OfficeLocationsSection } from './attendance/OfficeLocationsSection';

interface LeaveType {
  id: string; name: string; annualQuota: number; isPaid: boolean; color: string; isActive: boolean;
  carryForward?: boolean; carryForwardMaxDays?: number; carryForwardExpiryMonths?: number; allowHalfDay?: boolean; isUnlimited?: boolean;
}

const emptyType = { name: '', annualQuota: '12', isPaid: true, color: '#4f46e5', carryForward: false, carryForwardMaxDays: '0', carryForwardExpiryMonths: '0', allowHalfDay: true, isUnlimited: false };

const COLOR_SWATCHES = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#64748b'];

function LeaveTypesSection() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [form, setForm] = useState(emptyType);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery<LeaveType[]>({
    queryKey: ['leave-types', 'all'],
    queryFn: () => api.get('/hr/leave/types', { params: { all: '1' } }).then(r => r.data),
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = { name: form.name, annualQuota: Number(form.annualQuota), isPaid: form.isPaid, color: form.color, carryForward: form.carryForward, carryForwardMaxDays: Number(form.carryForwardMaxDays) || 0, carryForwardExpiryMonths: Number(form.carryForwardExpiryMonths) || 0, allowHalfDay: form.allowHalfDay, isUnlimited: form.isUnlimited };
      return editing
        ? api.patch(`/hr/leave/types/${editing.id}`, payload)
        : api.post('/hr/leave/types', payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leave-types'] }); closeModal(); },
    onError: (err: any) => setError(err?.response?.data?.error || 'Could not save leave type.'),
  });

  const toggleActive = useMutation({
    mutationFn: (t: LeaveType) => t.isActive
      ? api.delete(`/hr/leave/types/${t.id}`)
      : api.patch(`/hr/leave/types/${t.id}`, { isActive: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leave-types'] }),
  });

  function openCreate() { setEditing(null); setForm(emptyType); setError(''); setModalOpen(true); }
  function openEdit(t: LeaveType) {
    setEditing(t);
    setForm({ name: t.name, annualQuota: String(t.annualQuota), isPaid: t.isPaid, color: t.color, carryForward: !!t.carryForward, carryForwardMaxDays: String(t.carryForwardMaxDays ?? 0), carryForwardExpiryMonths: String(t.carryForwardExpiryMonths ?? 0), allowHalfDay: t.allowHalfDay !== false, isUnlimited: !!t.isUnlimited });
    setError(''); setModalOpen(true);
  }
  function closeModal() { setModalOpen(false); setEditing(null); }

  return (
    <Card>
      <CardHeader
        title="Leave Types"
        icon={<Tag size={14} />}
        className="mb-3"
        actions={<Button size="sm" icon={<Plus size={13} />} onClick={openCreate}>Add Type</Button>}
      />

      {isLoading ? <SkeletonTable rows={2} /> : (data || []).length === 0 ? (
        <EmptyState
          compact
          icon={<Tag />}
          title="No leave types yet"
          description="Add the kinds of leave your team can take — Annual, Sick, Casual and so on."
          action={{ label: 'Add type', onClick: openCreate }}
        />
      ) : (
        <div className="space-y-2">
          {(data || []).map(t => (
            <div key={t.id} className="flex items-center justify-between gap-3 p-3 border border-line-subtle rounded-card flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color }} />
                <span className="font-medium text-fg text-sm truncate" title={t.name}>{t.name}</span>
                <span className="text-xs text-fg-subtle tabular-nums">{t.isUnlimited ? 'Unlimited' : `${t.annualQuota} days/yr`} · {t.isPaid ? 'Paid' : 'Unpaid'}{t.carryForward ? ' · carry-forward' : ''}</span>
                {!t.isActive && <Badge variant="gray">Inactive</Badge>}
              </div>
              <RowActions items={[
                { label: 'Edit', icon: <Pencil size={13} />, onClick: () => openEdit(t) },
                { label: t.isActive ? 'Deactivate' : 'Activate', icon: <Tag size={13} />, onClick: () => toggleActive.mutate(t) },
              ]} />
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={closeModal} title={editing ? 'Edit leave type' : 'Add leave type'} icon={<Tag size={16} />} size="sm"
        footer={<>
          <Button variant="secondary" onClick={closeModal}>Cancel</Button>
          <Button onClick={() => { setError(''); save.mutate(); }} loading={save.isPending} disabled={!form.name}>
            {editing ? 'Save Changes' : 'Add Type'}
          </Button>
        </>}>
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Name">
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Annual Leave" />
          </Field>
          <Field label="Annual quota (days)">
            <Input type="number" min={0} max={365} value={form.annualQuota} onChange={e => setForm(f => ({ ...f, annualQuota: e.target.value }))} />
          </Field>
          <Checkbox
            label="Paid leave"
            checked={form.isPaid}
            onChange={e => setForm(f => ({ ...f, isPaid: e.target.checked }))}
          />
          <Checkbox label="Allow half days" checked={form.allowHalfDay} onChange={e => setForm(f => ({ ...f, allowHalfDay: e.target.checked }))} />
          <Checkbox label="No quota limit (e.g. Leave Without Pay)" checked={form.isUnlimited} onChange={e => setForm(f => ({ ...f, isUnlimited: e.target.checked }))} />
          <Checkbox label="Carry unused days into next year" checked={form.carryForward} onChange={e => setForm(f => ({ ...f, carryForward: e.target.checked }))} />
          {form.carryForward && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max days carried (0 = all)"><Input type="number" min={0} value={form.carryForwardMaxDays} onChange={e => setForm(f => ({ ...f, carryForwardMaxDays: e.target.value }))} /></Field>
              <Field label="Carried days expire after (months, 0 = never)"><Input type="number" min={0} max={12} value={form.carryForwardExpiryMonths} onChange={e => setForm(f => ({ ...f, carryForwardExpiryMonths: e.target.value }))} /></Field>
            </div>
          )}
          <Field label="Color">
            <div className="flex gap-2 flex-wrap">
              {COLOR_SWATCHES.map(c => (
                <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                  className={`w-7 h-7 rounded-full shrink-0 ${
                    form.color === c ? 'ring-2 ring-fg ring-offset-2 ring-offset-surface-raised' : ''
                  }`}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </Field>
        </div>
      </Modal>
    </Card>
  );
}

// ─── Face verification policy ────────────────────────────────────────────────

interface VerificationRule { location: boolean; network: boolean; face: boolean; mode: 'ALL' | 'ANY'; enforce: boolean }
interface AttendancePolicy {
  checkInRule: VerificationRule; checkOutRule: VerificationRule;
  faceVerificationRequired: boolean; faceMatchThreshold: number; keepCheckInSelfie: boolean;
  autoCheckoutOnLeave: boolean; autoCheckoutAfterMinutes: number; heartbeatTimeoutMinutes: number;
  shareLiveLocation: boolean; locationRetentionDays: number;
  nudgeAfterMinutes: number; nudgeRepeatMinutes: number;
}

const SIGNALS: { key: keyof Pick<VerificationRule, 'location' | 'network' | 'face'>; label: string; hint: string }[] = [
  { key: 'location', label: 'Location', hint: 'GPS inside an office geofence' },
  { key: 'network',  label: 'Office network', hint: 'Device IP on an office allowlist (skipped if no office has one)' },
  { key: 'face',     label: 'Face verification', hint: 'Live face matches the enrolled one' },
];

function describeRule(r: VerificationRule) {
  const on = SIGNALS.filter(s => r[s.key]).map(s => s.label.toLowerCase());
  if (on.length === 0) return 'No verification — anyone can mark it from anywhere.';
  const joined = on.length === 1 ? on[0] : on.slice(0, -1).join(', ') + (r.mode === 'ALL' ? ' and ' : ' or ') + on[on.length - 1];
  return `${r.mode === 'ALL' && on.length > 1 ? 'Requires all of: ' : on.length > 1 ? 'Requires at least one of: ' : 'Requires '}${joined}. ${r.enforce ? 'Blocked when it fails.' : 'Recorded only — never blocked.'}`;
}

/** Small numeric setting with its own Save so a half-typed value never fires a PATCH. */
function NumberSetting({ label, hint, value, min, max, onSave, saving }: { label: string; hint?: string; value: number; min: number; max: number; onSave: (v: number) => void; saving: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        <Input type="number" min={min} max={max} value={shown} onChange={e => setDraft(e.target.value)} />
        <Button size="sm" variant="secondary" disabled={draft === null || Number(draft) === value} loading={saving}
          onClick={() => { onSave(Math.min(max, Math.max(min, Math.round(Number(shown) || min)))); setDraft(null); }}>Save</Button>
      </div>
    </Field>
  );
}

/** One rule editor: which signals, AND/OR, enforce. Saves on every change. */
function RuleEditor({ title, subtitle, rule, onChange, saving }: { title: string; subtitle: string; rule: VerificationRule; onChange: (r: VerificationRule) => void; saving: boolean }) {
  const enabledCount = SIGNALS.filter(s => rule[s.key]).length;
  return (
    <div className="rounded-lg border border-line p-3.5" data-testid={`rule-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <p className="text-[13px] font-semibold text-fg">{title}</p>
          <p className="text-[11.5px] text-fg-muted">{subtitle}</p>
        </div>
        <div role="radiogroup" aria-label={`${title} combination`} className="inline-flex rounded-lg border border-line p-0.5 bg-surface-sunken">
          {(['ALL', 'ANY'] as const).map(m => (
            <button key={m} type="button" role="radio" aria-checked={rule.mode === m} disabled={saving || enabledCount < 2}
              onClick={() => onChange({ ...rule, mode: m })}
              className={`px-3 py-1 rounded-md text-[12px] font-medium transition disabled:opacity-50 ${rule.mode === m ? 'bg-surface shadow-ui-sm text-fg' : 'text-fg-muted hover:text-fg'}`}>
              {m === 'ALL' ? 'All (AND)' : 'Any (OR)'}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {SIGNALS.map(sig => (
          <Checkbox key={sig.key} label={sig.label} hint={sig.hint} checked={rule[sig.key]} disabled={saving}
            onChange={e => onChange({ ...rule, [sig.key]: e.target.checked })} />
        ))}
      </div>
      <div className="mt-3 pt-3 border-t border-line-subtle flex items-start justify-between gap-4 flex-wrap">
        <p className="text-[12px] text-fg-muted flex-1 min-w-[200px]">{describeRule(rule)}</p>
        <Toggle checked={rule.enforce} disabled={saving} onChange={v => onChange({ ...rule, enforce: v })} label="Block when the rule fails" />
      </div>
    </div>
  );
}
interface FaceEnrollmentRow { userId: string; samples: number; enrolledAt: string; user: { name: string; email: string; role: string } }

function FaceVerificationSection() {
  const qc = useQueryClient();
  const { user } = useAuth();
  /* Resetting someone's Face ID is a Super Admin action — the same authority
     that approves a re-enrolment. Managers can see who is enrolled, but they
     cannot wipe a face around the approval workflow. */
  const canResetFaces = can.reviewFaceEnrollments(user?.role);
  const { data: policy } = useQuery<AttendancePolicy>({
    queryKey: ['attendance-policy'],
    queryFn: () => api.get('/hr/attendance/policy').then(r => r.data),
  });
  const { data: enrolments, isLoading } = useQuery<FaceEnrollmentRow[]>({
    queryKey: ['attendance-face-enrolments'],
    queryFn: () => api.get('/hr/attendance/face').then(r => r.data),
    enabled: !!policy?.faceVerificationRequired,
  });
  const update = useMutation({
    mutationFn: (data: Partial<AttendancePolicy>) => api.patch('/hr/attendance/policy', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance-policy'] }),
  });
  const reset = useMutation({
    mutationFn: (userId: string) => api.delete(`/hr/attendance/face/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance-face-enrolments'] }),
  });
  const [threshold, setThreshold] = useState<string | null>(null);
  const shownThreshold = threshold ?? String(policy?.faceMatchThreshold ?? 0.5);

  return (
    <Card>
      <CardHeader
        title="Check-in / check-out verification"
        icon={<ScanFace size={14} />}
        subtitle="Choose which signals each action needs — location, office network, face — and whether they must all pass (AND) or any one is enough (OR)."
      />
      <div className="mt-4 space-y-4">
        {policy ? (
          <>
            <RuleEditor title="Check-in" subtitle="Starting a session." rule={policy.checkInRule} saving={update.isPending}
              onChange={r => update.mutate({ checkInRule: r })} />
            <RuleEditor title="Check-out" subtitle="Ending a session. Default is record-only so someone leaving for a client visit can still log their time." rule={policy.checkOutRule} saving={update.isPending}
              onChange={r => update.mutate({ checkOutRule: r })} />
          </>
        ) : <SkeletonTable rows={2} />}
        {policy && (
          <div className="rounded-lg border border-line p-3.5 space-y-3" data-testid="auto-checkout">
            <Toggle
              checked={policy.autoCheckoutOnLeave}
              disabled={update.isPending}
              onChange={v => update.mutate({ autoCheckoutOnLeave: v })}
              label="Check out automatically when someone leaves the office"
              hint="While the app is open, it sends a location ping every minute. Once every ping for the period below places the person outside all office radii, their session is closed at the moment they were first seen outside. Browsers can't track location with the app closed."
            />
            {policy.autoCheckoutOnLeave && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <NumberSetting label="Outside for (minutes) before check-out" hint="Avoids false check-outs from a GPS blip or a step outside the door." value={policy.autoCheckoutAfterMinutes} min={1} max={240}
                  onSave={v => update.mutate({ autoCheckoutAfterMinutes: v })} saving={update.isPending} />
                <NumberSetting label="Close silent sessions after (minutes, 0 = off)" hint="If no ping arrives for this long (app closed, phone off), check out at the last ping." value={policy.heartbeatTimeoutMinutes} min={0} max={1440}
                  onSave={v => update.mutate({ heartbeatTimeoutMinutes: v })} saving={update.isPending} />
              </div>
            )}
          </div>
        )}
        {policy && (
          <div className="rounded-lg border border-line p-3.5 space-y-3" data-testid="live-location">
            <Toggle
              checked={policy.shareLiveLocation}
              disabled={update.isPending}
              onChange={v => update.mutate({ shareLiveLocation: v })}
              label="Let managers see live locations while people are checked in"
              hint="Adds a Live map tab on Attendance for managers: each checked-in employee's latest position, whether they're inside an office radius, a 'Locate now' button, and the day's trail. Location is collected only while a session is open and the app is running; employees see a notice on their Attendance page. Nothing is collected once they check out."
            />
            {policy.shareLiveLocation && (
              <NumberSetting label="Keep location history for (days)" hint="Trails older than this are deleted automatically." value={policy.locationRetentionDays} min={1} max={365}
                onSave={v => update.mutate({ locationRetentionDays: v })} saving={update.isPending} />
            )}
            {(policy.shareLiveLocation || policy.autoCheckoutOnLeave || policy.heartbeatTimeoutMinutes > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-line-subtle pt-3">
                <NumberSetting label="Push a reminder when location is stale for (minutes, 0 = never)"
                  hint="Phones don't share GPS while the app is closed. When a checked-in person's last fix is older than this, they get a push notification asking them to open the app; an open app is relayed the request silently."
                  value={policy.nudgeAfterMinutes} min={0} max={1440} onSave={v => update.mutate({ nudgeAfterMinutes: v })} saving={update.isPending} />
                <NumberSetting label="Repeat the reminder at most every (minutes)" value={policy.nudgeRepeatMinutes} min={5} max={1440}
                  onSave={v => update.mutate({ nudgeRepeatMinutes: v })} saving={update.isPending} />
              </div>
            )}
          </div>
        )}
        {policy?.faceVerificationRequired && (
          <p className="text-[12px] text-fg-muted">Face verification: employees enrol once from the Attendance page (3 webcam samples). Only a numeric face signature is stored — not photos. Replacing an enrolled face is an approval workflow: the employee requests it and a Super Admin approves or rejects it, and their current Face ID keeps working until then.</p>
        )}
        {policy?.faceVerificationRequired && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Match strictness (max distance)" hint="0.5 is a good default. Lower = stricter (more false rejections), higher = looser. 0.6 is the model's conventional limit.">
                <div className="flex gap-2">
                  <Input type="number" min={0.3} max={0.8} step={0.05} value={shownThreshold} onChange={e => setThreshold(e.target.value)} />
                  <Button size="sm" variant="secondary" disabled={threshold === null} loading={update.isPending}
                    onClick={() => { update.mutate({ faceMatchThreshold: Number(shownThreshold) }); setThreshold(null); }}>Save</Button>
                </div>
              </Field>
              <Toggle
                checked={!!policy.keepCheckInSelfie}
                disabled={update.isPending}
                onChange={v => update.mutate({ keepCheckInSelfie: v })}
                label="Keep the check-in selfie as evidence"
                hint="A small photo is stored on each verified check-in for manager review. Turn off to store only the pass/fail result."
              />
            </div>

            <div className="border-t border-line-subtle pt-4">
              <p className="text-[12px] font-medium text-fg-muted mb-2">Enrolled employees {enrolments ? `(${enrolments.length})` : ''}</p>
              {isLoading ? <SkeletonTable rows={3} /> : !enrolments?.length ? (
                <p className="text-[12.5px] text-fg-subtle">Nobody has enrolled yet — each person is prompted at their next check-in.</p>
              ) : (
                <ul className="divide-y divide-line-subtle">
                  {enrolments.map(e => (
                    <li key={e.userId} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[13px] text-fg truncate">{e.user.name} <span className="text-fg-subtle">· {e.user.email}</span></p>
                        <p className="text-[11.5px] text-fg-subtle">{e.samples} samples · enrolled {new Date(e.enrolledAt).toLocaleDateString()}</p>
                      </div>
                      {canResetFaces ? (
                        <Button size="xs" variant="ghost" icon={<Trash2 size={12} />} loading={reset.isPending && reset.variables === e.userId} onClick={() => reset.mutate(e.userId)}>
                          Reset
                        </Button>
                      ) : (
                        <span className="text-[11.5px] text-fg-subtle text-right">Reset is a Super Admin action</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
        <p className="text-[11.5px] text-fg-subtle flex items-center gap-1.5"><ScanFace size={12} /> Biometric data: tell employees why it's collected and let them opt out via a manual entry where local law requires consent.</p>
      </div>
    </Card>
  );
}

/* One long page of settings; the pills jump to a section rather than
   hiding the others, so nothing moves out of reach. */
const SECTIONS = [
  { key: 'locations', label: 'Office Locations', icon: Building2 },
  { key: 'policies', label: 'Attendance Policies', icon: Clock },
  { key: 'holidays', label: 'Holidays', icon: CalendarDays },
  { key: 'verification', label: 'Verification', icon: ScanFace },
  { key: 'leave-types', label: 'Leave Types', icon: Tag },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];

export default function HRSettingsPage() {
  const [section, setSection] = useState<SectionKey>('locations');
  function jump(key: SectionKey) {
    setSection(key);
    document.getElementById(`hr-settings-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div>
      <PageHeader
        title="HR Settings"
        icon={Settings2}
        subtitle="Office locations, attendance policies, holidays, verification rules and leave types"
        below={
          <Tabs<SectionKey>
            aria-label="HR settings sections"
            variant="pill"
            value={section}
            onChange={jump}
            items={SECTIONS.map(s => ({ key: s.key, label: s.label, icon: <s.icon size={14} /> }))}
          />
        }
      />
      <PageBody width="full" className="max-w-6xl mx-auto">
        <section id="hr-settings-locations" className="scroll-mt-48"><OfficeLocationsSection /></section>
        <section id="hr-settings-policies" className="scroll-mt-48"><PolicyGroupsSection /></section>
        <section id="hr-settings-holidays" className="scroll-mt-48"><HolidaysSection /></section>
        <section id="hr-settings-verification" className="scroll-mt-48"><FaceVerificationSection /></section>
        <section id="hr-settings-leave-types" className="scroll-mt-48"><LeaveTypesSection /></section>
      </PageBody>
    </div>
  );
}
