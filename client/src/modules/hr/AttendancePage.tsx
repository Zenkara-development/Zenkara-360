import { useState, useEffect, lazy, Suspense } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import {
  PageHeader, PageBody, Card, CardHeader, Tabs, Button, Badge, Alert, Avatar,
  DataTable, EmptyState, PastelStatCard,
} from '../../shared/components';
import {
  LogIn, LogOut, MapPin, Users, Clock, ScanFace, Trash2,
  CalendarDays, UserCheck, UserX, Plane, ClipboardCheck,
} from 'lucide-react';
import { useFormat } from '../../hooks/useFormat';
import { FaceCaptureModal, type FaceSample } from '../../shared/components/FaceCaptureModal';
import { RegisterSection } from './attendance/RegisterSection';
const LiveMap = lazy(() => import('./LiveMap').then(m => ({ default: m.LiveMap })));

const MANAGER_ROLES = ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'];

interface AttendanceRecord {
  id: string;
  date: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  checkInLocationOk: boolean | null;
  checkInNetworkOk: boolean | null;
  checkInFaceOk?: boolean | null;
  checkInFaceDistance?: number | null;
  checkInPassed?: boolean | null;
  checkOutFaceOk?: boolean | null;
  checkOutPassed?: boolean | null;
  checkOutSource?: string | null;
  source: string;
}

interface VerificationRule { location: boolean; network: boolean; face: boolean; mode: 'ALL' | 'ANY'; enforce: boolean }
interface AttendancePolicy {
  checkInRule: VerificationRule;
  checkOutRule: VerificationRule;
  faceVerificationRequired: boolean;
  faceMatchThreshold: number;
  keepCheckInSelfie: boolean;
  autoCheckoutOnLeave: boolean;
  autoCheckoutAfterMinutes: number;
  heartbeatTimeoutMinutes: number;
  shareLiveLocation: boolean;
  myEnrollment: { samples: number; enrolledAt: string; updatedAt: string; referenceSelfie: string | null } | null;
}

function useAttendancePolicy() {
  return useQuery<AttendancePolicy>({
    queryKey: ['attendance-policy'],
    queryFn: () => api.get('/hr/attendance/policy').then(r => r.data),
  });
}

function fmtHours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** Total worked minutes across a set of sessions — mirrors the server's
 *  sumWorkedMinutes() (attendanceVerification.ts): a completed session
 *  contributes checkOut - checkIn, a still-open one contributes up to now. */
function sumWorkedMinutes(sessions: AttendanceRecord[], now: Date = new Date()): number {
  let total = 0;
  for (const s of sessions) {
    if (!s.checkInAt) continue;
    const end = s.checkOutAt ? new Date(s.checkOutAt) : now;
    const mins = (end.getTime() - new Date(s.checkInAt).getTime()) / 60000;
    if (mins > 0) total += mins;
  }
  return total;
}

function isSameDay(iso: string, ref: Date) {
  // Compare UTC days, not the device's. The server stamps
  // AttendanceRecord.date via todayDateOnly() = Date.UTC(...), so a session
  // belongs to a UTC calendar day. toDateString() resolves in the device
  // timezone, so east of UTC every session between 00:00 local and the UTC
  // rollover looked like "yesterday": today's list came back empty, Check
  // Out disabled itself, and Check In then failed with "you're already
  // checked in" because the server saw an open session the client did not.
  return new Date(iso).toISOString().slice(0, 10) === new Date(ref).toISOString().slice(0, 10);
}

/** "location and network", "location or face", "no verification" */
function ruleSummary(r: VerificationRule) {
  const on = [r.location && 'location', r.network && 'office network', r.face && 'face'].filter(Boolean) as string[];
  if (on.length === 0) return 'no verification';
  const text = on.length === 1 ? on[0] : on.slice(0, -1).join(', ') + (r.mode === 'ALL' ? ' and ' : ' or ') + on[on.length - 1];
  return r.enforce ? text : `${text} (recorded only)`;
}

/** Wraps navigator.geolocation in a promise; rejects with a friendly message. */
function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation is not supported on this device/browser.'));
    navigator.geolocation.getCurrentPosition(resolve, err => {
      if (err.code === err.PERMISSION_DENIED) reject(new Error('Location permission denied — allow location access to mark attendance.'));
      else reject(new Error('Could not get your location. Please try again.'));
    }, { enableHighAccuracy: true, timeout: 15000 });
  });
}

/** One check-in → check-out window, e.g. "09:02 – 13:30". */
function SessionChip({ session, compact = false }: { session: AttendanceRecord; compact?: boolean }) {
  const { time: fmtTime } = useFormat();
  return (
    <span
      className={`text-xs tabular-nums bg-surface-sunken border border-line-subtle rounded-badge text-fg-muted whitespace-nowrap ${
        compact ? 'px-1.5 py-0.5' : 'px-2 py-1'
      }`}
    >
      {fmtTime(session.checkInAt)}{compact ? '–' : ' – '}{session.checkOutAt ? fmtTime(session.checkOutAt) : 'now'}
      {session.checkOutSource === 'AUTO_GEOFENCE' && <span title="Checked out automatically after leaving the office" className="ml-1 text-warning">⤴</span>}
      {session.checkOutSource === 'AUTO_TIMEOUT' && <span title="Checked out automatically — app lost contact" className="ml-1 text-fg-subtle">⏱</span>}
    </span>
  );
}

function CheckInWidget() {
  const { time: fmtTime, timezone } = useFormat();
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'in' | 'out' | null>(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: month } = useQuery<AttendanceRecord[]>({
    queryKey: ['attendance-me'],
    queryFn: () => api.get('/hr/attendance/me').then(r => r.data),
  });
  const { data: policy } = useAttendancePolicy();
  const [face, setFace] = useState<{ mode: 'enrol' | 'verify'; action: 'in' | 'out' } | null>(null);
  // Multiple sessions can exist today — sorted newest-first by the API.
  const todaysSessions = (month || []).filter(r => isSameDay(r.date, now));
  const lastSession = todaysSessions[0] ?? null;
  const isCheckedInNow = !!(lastSession?.checkInAt && !lastSession?.checkOutAt);
  const totalMinutesToday = sumWorkedMinutes(todaysSessions, now);
  const enrolled = !!policy?.myEnrollment;
  const ruleFor = (action: 'in' | 'out') => (action === 'in' ? policy?.checkInRule : policy?.checkOutRule);
  const needsLocation = (action: 'in' | 'out') => { const r = ruleFor(action); return !r || r.location || r.network; };

  async function postCheck(action: 'in' | 'out', extra: Record<string, unknown> = {}) {
    // Location is only requested when the rule uses it (or the network check, which is recorded alongside).
    let coords = { lat: 0, lng: 0 };
    if (needsLocation(action)) { const pos = await getPosition(); coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }; }
    await api.post(`/hr/attendance/check-${action}`, { ...coords, ...extra });
    qc.invalidateQueries({ queryKey: ['attendance-me'] });
  }

  async function handle(action: 'in' | 'out') {
    setError('');
    // When the rule includes a face, capture it up front (enrolling first if needed) —
    // the server then combines it with location/network per the org's AND/OR rule.
    if (ruleFor(action)?.face) {
      setFace({ mode: enrolled ? 'verify' : 'enrol', action });
      return;
    }
    setBusy(action);
    try {
      await postCheck(action);
    } catch (err: any) {
      const code = err?.response?.data?.code;
      if (code === 'FACE_NOT_ENROLLED' || code === 'FACE_REQUIRED') {
        qc.invalidateQueries({ queryKey: ['attendance-policy'] });
        setFace({ mode: code === 'FACE_NOT_ENROLLED' ? 'enrol' : 'verify', action });
        return;
      }
      setError(err?.response?.data?.error || err?.message || 'Something went wrong.');
    } finally { setBusy(null); }
  }

  /** Called by the capture modal with the live sample(s); throws so the modal can show the server's reason. */
  async function onFaceCaptured(samples: FaceSample[]) {
    if (!face) return;
    if (face.mode === 'enrol') {
      await api.post('/hr/attendance/face/enrol', { descriptors: samples.map(s => s.descriptor), referenceSelfie: samples[0]?.selfie });
      qc.invalidateQueries({ queryKey: ['attendance-policy'] });
    }
    // Straight on to the actual check-in/out with the last sample so the user isn't asked twice
    const last = samples[samples.length - 1];
    await postCheck(face.action, { faceDescriptor: last.descriptor, selfie: last.selfie });
  }

  return (
    <Card padding="lg" className="text-center">
      <p className="text-3xl font-bold text-fg tabular-nums">{fmtTime(now)}</p>
      <p className="text-sm text-fg-subtle mt-1">
        {new Intl.DateTimeFormat(undefined, { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(now)}
      </p>

      <div className="flex items-center justify-center gap-6 mt-5 text-sm">
        <div>
          <p className="text-fg-subtle text-xs uppercase tracking-wide">Status</p>
          <p className={`font-semibold mt-0.5 ${isCheckedInNow ? 'text-success' : 'text-fg'}`}>
            {isCheckedInNow ? 'Checked in' : 'Checked out'}
          </p>
        </div>
        <div className="w-px h-8 bg-line" />
        <div>
          <p className="text-fg-subtle text-xs uppercase tracking-wide">Today's total</p>
          <p className="font-semibold text-fg mt-0.5 tabular-nums">{fmtHours(totalMinutesToday)}</p>
        </div>
        <div className="w-px h-8 bg-line" />
        <div>
          <p className="text-fg-subtle text-xs uppercase tracking-wide">Sessions</p>
          <p className="font-semibold text-fg mt-0.5 tabular-nums">{todaysSessions.length}</p>
        </div>
      </div>

      {todaysSessions.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
          {[...todaysSessions].reverse().map(s => (
            <SessionChip key={s.id} session={s} />
          ))}
        </div>
      )}

      {error && <Alert tone="danger" className="mt-4 text-left">{error}</Alert>}

      <div className="flex gap-3 mt-5 justify-center flex-wrap">
        <Button
          size="lg"
          icon={<LogIn size={15} />}
          loading={busy === 'in'}
          onClick={() => handle('in')}
          disabled={isCheckedInNow || busy !== null}
        >
          Check In
        </Button>
        <Button
          size="lg"
          variant="secondary"
          icon={<LogOut size={15} />}
          loading={busy === 'out'}
          onClick={() => handle('out')}
          disabled={!isCheckedInNow || busy !== null}
        >
          Check Out
        </Button>
      </div>
      <p className="text-[11px] text-fg-subtle mt-4 flex items-center justify-center gap-1.5 flex-wrap">
        {policy ? (
          <>
            <MapPin size={11} /> Check-in: {ruleSummary(policy.checkInRule)} · Check-out: {ruleSummary(policy.checkOutRule)}
            {policy.faceVerificationRequired && <> · <ScanFace size={11} /> face</>}
            {policy.autoCheckoutOnLeave && <> · auto check-out after {policy.autoCheckoutAfterMinutes} min outside the office (keep the app open)</>}
            {policy.shareLiveLocation && <> · your location is shared with managers while you're checked in</>}
          </>
        ) : <><MapPin size={11} /> Requires location access and being on-site</>}
        {' '}· check in/out as many times as you need in a day
      </p>

      {face && (
        <FaceCaptureModal
          open
          mode={face.mode}
          onClose={() => setFace(null)}
          onCaptured={onFaceCaptured}
          title={face.mode === 'enrol' ? `Enrol your face to check ${face.action}` : 'Face verification'}
          subtitle={face.mode === 'enrol'
            ? `Your organisation's check-${face.action} rule includes face verification. We'll capture 3 quick samples now and check you ${face.action} straight after. Only a numeric face signature is stored, never the photos.`
            : undefined}
        />
      )}
    </Card>
  );
}

/** Self-service view of the user's enrolled face — re-enrol or remove. Shown only when the org requires face verification. */
function FaceIdCard() {
  const qc = useQueryClient();
  const { data: policy } = useAttendancePolicy();
  const { date } = useFormat();
  const [mode, setMode] = useState<'enrol' | null>(null);
  const [busy, setBusy] = useState(false);
  if (!policy?.faceVerificationRequired) return null;
  const e = policy.myEnrollment;

  async function enrol(samples: FaceSample[]) {
    await api.post('/hr/attendance/face/enrol', { descriptors: samples.map(s => s.descriptor), referenceSelfie: samples[0]?.selfie });
    qc.invalidateQueries({ queryKey: ['attendance-policy'] });
  }
  async function remove() {
    setBusy(true);
    try { await api.delete('/hr/attendance/face/me'); qc.invalidateQueries({ queryKey: ['attendance-policy'] }); } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader title="Face ID" subtitle="Used to confirm it's you at check-in." />
      <div className="flex items-center gap-4 mt-3 flex-wrap">
        {e?.referenceSelfie ? (
          <img src={e.referenceSelfie} alt="Enrolled face" className="w-16 h-16 rounded-lg object-cover -scale-x-100 border border-line" />
        ) : (
          <div className="w-16 h-16 rounded-lg bg-surface-sunken border border-line flex items-center justify-center text-fg-subtle"><ScanFace size={22} /></div>
        )}
        <div className="flex-1 min-w-[180px]">
          {e ? (
            <>
              <p className="text-[13px] font-medium text-fg flex items-center gap-2">Enrolled <Badge variant="green">{e.samples} samples</Badge></p>
              <p className="text-[12px] text-fg-muted">Since {date(e.enrolledAt)}. Only a numeric signature is stored — you can remove it any time.</p>
            </>
          ) : (
            <>
              <p className="text-[13px] font-medium text-fg">Not enrolled yet</p>
              <p className="text-[12px] text-fg-muted">You'll be asked to enrol the first time you check in, or do it now.</p>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" icon={<ScanFace size={14} />} onClick={() => setMode('enrol')}>{e ? 'Re-enrol' : 'Enrol now'}</Button>
          {e && <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} loading={busy} onClick={remove}>Remove</Button>}
        </div>
      </div>
      {mode && <FaceCaptureModal open mode="enrol" onClose={() => setMode(null)} onCaptured={enrol} />}
    </Card>
  );
}

interface DayGroup { date: string; sessions: AttendanceRecord[] }

function groupByDate(records: AttendanceRecord[]): DayGroup[] {
  const map = new Map<string, AttendanceRecord[]>();
  for (const r of records) {
    const key = new Date(r.date).toDateString();
    const list = map.get(key) || [];
    list.push(r);
    map.set(key, list);
  }
  return Array.from(map.entries()).map(([, sessions]) => ({ date: sessions[0].date, sessions }));
}

function MyHistory() {
  const { date } = useFormat();
  const { data, isLoading } = useQuery<AttendanceRecord[]>({
    queryKey: ['attendance-me'],
    queryFn: () => api.get('/hr/attendance/me').then(r => r.data),
  });

  const days = groupByDate(data || []);

  return (
    <Card padding="none">
      <div className="p-card pb-0">
        <CardHeader title="This month" />
      </div>
      <DataTable<DayGroup>
        minWidth={560}
        loading={isLoading}
        rows={days}
        rowKey={d => d.date}
        empty={
          <EmptyState
            compact
            icon={<Clock />}
            title="No records yet this month"
            description="Your check-ins will appear here day by day."
          />
        }
        columns={[
          { key: 'date', header: 'Date', cell: d => <span className="tabular-nums">{date(d.date)}</span> },
          {
            key: 'sessions',
            header: 'Sessions',
            cell: d => (
              <div className="flex flex-wrap gap-1">
                {[...d.sessions].reverse().map(s => <SessionChip key={s.id} session={s} compact />)}
              </div>
            ),
          },
          {
            key: 'total',
            header: 'Total',
            cell: d => <span className="font-medium text-fg tabular-nums">{fmtHours(sumWorkedMinutes(d.sessions))}</span>,
          },
          {
            key: 'verified',
            header: 'Verified',
            cell: d => {
              const allVerified = d.sessions.every(s => s.source === 'SELF' && (s.checkInPassed ?? (s.checkInLocationOk && s.checkInNetworkOk)));
              const anyManual = d.sessions.some(s => s.source === 'MANUAL');
              const faceVerified = d.sessions.some(s => s.checkInFaceOk || s.checkOutFaceOk);
              return anyManual ? <Badge variant="gray">Manual entry</Badge>
                : allVerified ? <span className="inline-flex items-center gap-1"><Badge variant="green">Verified</Badge>{faceVerified && <Badge variant="teal"><ScanFace size={10} className="mr-0.5" />Face</Badge>}</span>
                : <Badge variant="yellow">Partial</Badge>;
            },
          },
        ]}
      />
    </Card>
  );
}

interface TodayRow {
  user: { id: string; name: string; role: string; avatarUrl?: string };
  sessions: AttendanceRecord[];
  record: AttendanceRecord | null;
  isCheckedInNow: boolean;
  totalMinutes: number;
}

interface LeaveRequestRow { userId: string; startDate: string; endDate: string }

/* Today's team roll plus who is on approved leave today. Both endpoints are
   MANAGERS-only, so only the manager view calls this. */
function useTeamToday(enabled: boolean) {
  const today = useQuery<TodayRow[]>({
    queryKey: ['attendance-today'],
    queryFn: () => api.get('/hr/attendance/today').then(r => r.data),
    enabled,
  });
  const leave = useQuery<LeaveRequestRow[]>({
    queryKey: ['leave-requests', 'org', 'APPROVED'],
    queryFn: () => api.get('/hr/leave/requests', { params: { scope: 'org', status: 'APPROVED' } }).then(r => r.data),
    enabled,
  });
  // Leave dates are @db.Date (UTC midnight), so compare calendar days in UTC.
  const todayKey = new Date().toISOString().slice(0, 10);
  const onLeave = new Set(
    (leave.data || [])
      .filter(l => l.startDate.slice(0, 10) <= todayKey && l.endDate.slice(0, 10) >= todayKey)
      .map(l => l.userId),
  );
  const rows = today.data || [];
  const present = rows.filter(r => r.sessions.length > 0).length;
  const leaveCount = rows.filter(r => r.sessions.length === 0 && onLeave.has(r.user.id)).length;
  return {
    rows, onLeave, isLoading: today.isLoading,
    stats: { total: rows.length, present, onLeave: leaveCount, absent: rows.length - present - leaveCount },
  };
}

/** Minutes -> "09h 33m", the fixed-width style of the attendance table. */
function fmtHoursPadded(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
}

function TeamToday({ rows, onLeave, isLoading }: { rows: TodayRow[]; onLeave: Set<string>; isLoading: boolean }) {
  const { time: fmtTime } = useFormat();

  return (
    <Card padding="none" className="overflow-hidden">
      <DataTable<TodayRow>
        minWidth={680}
        loading={isLoading}
        rows={rows}
        rowKey={r => r.user.id}
        empty={
          <EmptyState
            compact
            icon={<Users />}
            title="No team members yet"
            description="People will appear here as soon as they have accounts."
          />
        }
        columns={[
          {
            key: 'employee',
            header: 'Employee',
            cell: r => (
              <div className="flex items-center gap-2.5">
                <Avatar name={r.user.name} src={r.user.avatarUrl} size="sm" />
                <span className="font-medium text-fg truncate" title={r.user.name}>{r.user.name}</span>
              </div>
            ),
          },
          {
            key: 'in',
            header: 'Check In',
            cell: r => {
              const first = [...r.sessions].filter(s => s.checkInAt)
                .sort((a, b) => a.checkInAt!.localeCompare(b.checkInAt!))[0];
              if (!first) return <span className="text-fg-subtle">—</span>;
              return (
                <span className="tabular-nums text-fg">
                  {fmtTime(first.checkInAt)}
                  {r.sessions.length > 1 && (
                    <span className="block text-[11px] text-fg-subtle" title={`${r.sessions.length} check-ins today`}>
                      {r.sessions.length} sessions
                    </span>
                  )}
                </span>
              );
            },
          },
          {
            key: 'out',
            header: 'Check Out',
            cell: r => {
              if (r.isCheckedInNow) return <span className="text-fg-subtle">—</span>;
              const last = [...r.sessions].filter(s => s.checkOutAt)
                .sort((a, b) => b.checkOutAt!.localeCompare(a.checkOutAt!))[0];
              return last ? <span className="tabular-nums text-fg">{fmtTime(last.checkOutAt)}</span> : <span className="text-fg-subtle">—</span>;
            },
          },
          {
            key: 'total',
            header: 'Working Hours',
            cell: r => r.sessions.length === 0
              ? <span className="text-fg-subtle">—</span>
              : <span className="tabular-nums text-fg">{fmtHoursPadded(r.totalMinutes)}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            cell: r => r.sessions.length > 0
              ? (r.isCheckedInNow ? <Badge variant="green" dot>Present · On-site</Badge> : <Badge variant="green">Present</Badge>)
              : onLeave.has(r.user.id) ? <Badge variant="purple">On Leave</Badge>
              : <Badge variant="red">Absent</Badge>,
          },
        ]}
      />
    </Card>
  );
}

export default function AttendancePage() {
  const { user } = useAuth();
  const { date: fmtDate } = useFormat();
  const isManager = MANAGER_ROLES.includes(user?.role || '');
  // Managers land on the team roll, as in the reference layout; everyone
  // else only has their own attendance.
  const [tab, setTab] = useState<'me' | 'team' | 'register' | 'map'>(isManager ? 'team' : 'me');
  const { data: policy } = useAttendancePolicy();
  const team = useTeamToday(isManager);

  return (
    <div>
      <PageHeader
        title={isManager ? 'Attendance Management' : 'My Attendance'}
        icon={Clock}
        subtitle={isManager ? "Track your team's check-in, check-out and working hours." : 'Check in, check out and see your working hours.'}
        actions={
          <>
            <span className="inline-flex items-center gap-2 h-ctl px-3.5 rounded-btn bg-surface border border-line shadow-ui-sm text-[13px] font-medium text-fg tabular-nums">
              <CalendarDays size={15} className="text-accent" /> {fmtDate(new Date())}
            </span>
            {/* Marking a day for someone is the Register's HR-correction flow. */}
            {isManager && (
              <Button icon={<ClipboardCheck size={14} />} onClick={() => setTab('register')}>
                Mark Attendance
              </Button>
            )}
          </>
        }
      />

      <PageBody width="full" className={tab === 'me' ? 'max-w-5xl mx-auto' : 'max-w-7xl mx-auto'}>
        {isManager && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <PastelStatCard tone="blue"   icon={Users}     label="Total Employees" value={team.isLoading ? '…' : team.stats.total} />
              <PastelStatCard tone="green"  icon={UserCheck} label="Present"         value={team.isLoading ? '…' : team.stats.present} />
              <PastelStatCard tone="red"    icon={UserX}     label="Absent"          value={team.isLoading ? '…' : team.stats.absent} />
              <PastelStatCard tone="purple" icon={Plane}     label="On Leave"        value={team.isLoading ? '…' : team.stats.onLeave} />
            </div>
            <Tabs<'me' | 'team' | 'register' | 'map'>
              aria-label="Attendance views"
              variant="pill"
              value={tab}
              onChange={setTab}
              items={[
                { key: 'team', label: 'Attendance' },
                { key: 'register', label: 'Summary' },
                { key: 'me', label: 'My Attendance' },
                ...(policy?.shareLiveLocation ? [{ key: 'map' as const, label: 'Live map' }] : []),
              ]}
            />
          </>
        )}
        {tab === 'me' ? (
          <div className="space-y-5">
            <CheckInWidget />
            <FaceIdCard />
            <MyHistory />
            {user?.id && <RegisterSection canEdit={false} onlyUserId={user.id} />}
          </div>
        ) : tab === 'register' ? (
          <RegisterSection canEdit />
        ) : tab === 'map' ? (
          <Suspense fallback={<div className="p-6 text-[13px] text-fg-subtle">Loading map…</div>}><LiveMap /></Suspense>
        ) : (
          <TeamToday rows={team.rows} onLeave={team.onLeave} isLoading={team.isLoading} />
        )}
      </PageBody>
    </div>
  );
}
