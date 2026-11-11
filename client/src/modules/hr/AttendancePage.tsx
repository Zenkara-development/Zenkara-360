import { useState, useEffect, lazy, Suspense } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import {
  PageHeader, PageBody, Card, CardHeader, Tabs, Button, Badge, Alert, Avatar,
  DataTable, EmptyState, PastelStatCard, InlineSpinner,
} from '../../shared/components';
import {
  LogIn, LogOut, MapPin, Users, Clock, ScanFace,
  CalendarDays, UserCheck, UserX, Plane, ClipboardCheck, LocateFixed,
} from 'lucide-react';
import { useFormat } from '../../hooks/useFormat';
import { FaceCaptureModal, type FaceSample } from '../../shared/components/FaceCaptureModal';
import { useMyFaceState, useSubmitFaceReenrollment, type EffectiveFaceStatus } from '../../api/faceReenrollment';
import { useMyLocation, useReportMyLocation } from '../../api/attendanceGeofence';
import { formatDistance } from '../../shared/geo';
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
      await api.post('/hr/attendance/face/enrol', {
        descriptors: samples.map(s => s.descriptor),
        referenceSelfie: samples[0]?.selfie,
        // Keep every sample image, so a later Face ID review can show the
        // actual pictures and not just one thumbnail.
        sampleImages: samples.map(s => s.selfie).filter(Boolean),
      });
      qc.invalidateQueries({ queryKey: ['attendance-policy'] });
      qc.invalidateQueries({ queryKey: ['face-state'] });
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

/**
 * Where am I right now, according to the office geofences?
 *
 * The verdict comes from the SERVER, never from the browser: the client
 * sends the GPS fix it obtained and the server runs the same point-in-polygon
 * (or distance-from-centre) check the check-in will use, so what the
 * employee is told and what they are judged by cannot disagree.
 *
 * Nothing here asks for the GPS on its own — the card reads the last
 * position the server already had, and only asks the browser for a fix when
 * the employee presses "Update my location".
 */
function MyOfficeStatusCard() {
  const { dateTime } = useFormat();
  const { data: location, isLoading } = useMyLocation();
  const report = useReportMyLocation();
  const [error, setError] = useState('');

  if (!location?.officeCount) return null;

  async function update() {
    setError('');
    if (!navigator.geolocation) { setError('This device has no location service.'); return; }
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000 }));
      await report.mutateAsync({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      });
    } catch (err: any) {
      if (err?.code === err.PERMISSION_DENIED) {
        setError('Location permission was denied — allow it to see whether you are at the office.');
      } else if (err?.code === err.POSITION_UNAVAILABLE) {
        setError('No location fix is available right now.');
      } else {
        setError(err?.response?.data?.error || 'Could not update your location.');
      }
    }
  }

  const inside = location.inside === true;
  const unknown = location.inside === null;
  const lastEvent = location.lastEvent;

  return (
    <Card data-testid="my-office-status">
      <CardHeader
        title="My office status"
        subtitle="Where the geofence thinks you are right now."
        actions={<Button size="sm" variant="secondary" icon={<LocateFixed size={13} />} loading={report.isPending} onClick={update}>Update my location</Button>}
      />
      <div className="mt-3 space-y-2">
        {error && <Alert tone="warning">{error}</Alert>}
        {isLoading ? (
          <p className="text-[12.5px] text-fg-subtle">Checking your location…</p>
        ) : (
          <>
            <p className="text-[13px] font-medium text-fg flex items-center gap-2 flex-wrap">
              {unknown
                ? <Badge variant="gray">Location unknown</Badge>
                : inside
                  ? <Badge variant="green" dot>Inside the office</Badge>
                  : <Badge variant="orange" dot>Outside the office</Badge>}
              {location.office && <span className="text-fg-muted font-normal">{location.office}</span>}
              {location.distanceMeters != null && (
                <span className="text-fg-subtle font-normal tabular-nums">
                  {inside ? 'at the boundary' : `${formatDistance(location.distanceMeters)} from the boundary`}
                </span>
              )}
            </p>
            {location.assignedOffice && (
              <p className="text-[12px] text-fg-muted">
                Your assigned office is <span className="font-medium text-fg">{location.assignedOffice.name}</span>.
              </p>
            )}
            {location.seenAt && (
              <p className="text-[12px] text-fg-subtle">
                Last position {dateTime(location.seenAt)}
                {location.stale ? ' — too old to be treated as "now"' : ''}.
              </p>
            )}
            {lastEvent && (
              <p className="text-[12px] text-fg-subtle">
                Last crossing: {lastEvent.type === 'ENTER' ? 'entered' : 'left'} at {dateTime(lastEvent.at)}.
              </p>
            )}
            <p className="text-[11.5px] text-fg-subtle">
              Browsers only report your position while the app is open, so this status can be minutes old. It never
              marks you absent — leaving the office is recorded as a crossing, not as a missed shift.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * Self-service view of the user's Face ID.
 *
 * An employee may enrol their face for the first time, and they may *ask* to
 * replace it — but they can never remove or overwrite it themselves. A
 * replacement becomes a request that a Super Admin approves or rejects, and
 * the employee's current Face ID keeps working the whole time it waits.
 *
 * There is deliberately no Remove button here: deleting a Face ID is not a
 * self-service act.
 */
function FaceIdCard() {
  const qc = useQueryClient();
  const { data: policy } = useAttendancePolicy();
  const { data: face, isLoading, error, refetch } = useMyFaceState(!!policy?.faceVerificationRequired);
  const { date, dateTime } = useFormat();
  const [mode, setMode] = useState<'enrol' | 'reenrol' | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [dismissed, setDismissed] = useState<string>('');
  const submitReenrollment = useSubmitFaceReenrollment();

  if (!policy?.faceVerificationRequired) return null;

  const enrollment = face?.enrollment ?? null;
  const request = face?.reEnrollment ?? null;
  const pending = request?.status === 'PENDING';
  const status: EffectiveFaceStatus = face?.effectiveStatus ?? (enrollment ? 'VERIFIED' : 'NOT_ENROLLED');
  const decided = request && request.status !== 'PENDING' && request.id !== dismissed ? request : null;

  /** First-time enrolment — the original, unchanged flow. */
  async function enrol(samples: FaceSample[]) {
    setFormError('');
    await api.post('/hr/attendance/face/enrol', {
      descriptors: samples.map(s => s.descriptor),
      referenceSelfie: samples[0]?.selfie,
      sampleImages: samples.map(s => s.selfie).filter(Boolean),
    });
    qc.invalidateQueries({ queryKey: ['attendance-policy'] });
    qc.invalidateQueries({ queryKey: ['face-state'] });
  }

  /** Replacement — becomes a request for a Super Admin, nothing more. */
  async function reenrol(samples: FaceSample[]) {
    setFormError('');
    setBusy(true);
    try {
      await submitReenrollment.mutateAsync({
        descriptors: samples.map(s => s.descriptor),
        sampleImages: samples.map(s => s.selfie).filter(Boolean),
      });
    } catch (err: any) {
      setFormError(err?.response?.data?.error || err?.message || 'Could not send your new Face ID for approval.');
      throw err; // the modal shows the reason too
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Face ID" subtitle="Used to confirm it's you at check-in." />
      <div className="flex items-center gap-4 mt-3 flex-wrap">
        {enrollment?.referenceSelfie ? (
          <img src={enrollment.referenceSelfie} alt="Enrolled face" className="w-16 h-16 rounded-lg object-cover -scale-x-100 border border-line" />
        ) : (
          <div className="w-16 h-16 rounded-lg bg-surface-sunken border border-line flex items-center justify-center text-fg-subtle"><ScanFace size={22} /></div>
        )}
        <div className="flex-1 min-w-[180px]">
          {enrollment ? (
            <>
              <p className="text-[13px] font-medium text-fg flex items-center gap-2">
                Face ID enrolled
                {status === 'PENDING_VERIFICATION'
                  ? <Badge variant="yellow" dot>Pending Verification</Badge>
                  : <Badge variant="green" dot>Verified</Badge>}
                <Badge variant="gray">{enrollment.samples} samples</Badge>
              </p>
              <p className="text-[12px] text-fg-muted">
                Since {date(enrollment.enrolledAt)}. Only a numeric signature is stored for matching.
              </p>
            </>
          ) : (
            <>
              <p className="text-[13px] font-medium text-fg flex items-center gap-2">
                Not enrolled yet <Badge variant="gray">Not enrolled</Badge>
              </p>
              <p className="text-[12px] text-fg-muted">You'll be asked to enrol the first time you check in, or do it now.</p>
            </>
          )}
        </div>
        <div className="flex gap-2">
          {/* While a request is waiting there is nothing to click — the Re-enrol
              button disappears so a second request cannot be raised by accident. */}
          {!pending && (
            <Button
              size="sm"
              variant="secondary"
              icon={<ScanFace size={14} />}
              loading={busy}
              onClick={() => { setFormError(''); setMode(enrollment ? 'reenrol' : 'enrol'); }}
            >
              {enrollment ? 'Re-enrol' : 'Enrol now'}
            </Button>
          )}
        </div>
      </div>

      {isLoading && (
        <p className="text-[12px] text-fg-subtle mt-3 flex items-center gap-2">
          <InlineSpinner /> Loading your Face ID status…
        </p>
      )}

      {error && (
        <Alert tone="danger" className="mt-3" actions={<Button size="sm" variant="secondary" onClick={() => refetch()}>Retry</Button>}>
          Could not load your Face ID status.
        </Alert>
      )}

      {formError && <Alert tone="danger" className="mt-3">{formError}</Alert>}

      {pending && (
        <Alert tone="warning" title="Pending Verification" className="mt-3">
          Your new Face ID was submitted on {dateTime(request!.submittedAt)} and is waiting for a Super Admin to
          approve it. Your current Face ID is still active and still works at check-in.
        </Alert>
      )}

      {decided?.status === 'APPROVED' && (
        <Alert
          tone="success"
          title="Face ID re-enrolment approved"
          className="mt-3"
          onDismiss={() => setDismissed(decided.id)}
        >
          Your new Face ID is now your active Face ID and is ready to use at check-in.
        </Alert>
      )}

      {decided?.status === 'REJECTED' && (
        <Alert
          tone="danger"
          title="Face ID re-enrolment rejected"
          className="mt-3"
          onDismiss={() => setDismissed(decided.id)}
        >
          <p>Your current Face ID is unchanged and still active.</p>
          {decided.rejectionReason && <p className="mt-1">Reason: {decided.rejectionReason}</p>}
        </Alert>
      )}

      {mode && (
        <FaceCaptureModal
          open
          mode={mode}
          onClose={() => setMode(null)}
          onCaptured={mode === 'enrol' ? enrol : reenrol}
        />
      )}
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
            <MyOfficeStatusCard />
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
