import { useState, FormEvent, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { User, Mail, Briefcase, Lock, CheckCircle2, AlertCircle, Eye, EyeOff, Camera, Link2, CalendarDays, Download, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import {
  PageHeader, PageBody, Card, Tabs, Button, IconButton, Badge, Alert, Avatar,
  Field, Input,
} from '../shared/components';
import { GoogleSignInButton } from '../shared/components/GoogleSignInButton';

/* ── tiny helpers ── */
function Toast({ type, msg, onDismiss }: { type: 'ok' | 'err'; msg: string; onDismiss: () => void }) {
  return (
    <Alert
      tone={type === 'ok' ? 'success' : 'danger'}
      icon={type === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
      onDismiss={onDismiss}
      className="animate-slide-down font-medium"
    >
      {msg}
    </Alert>
  );
}

/* ── Avatar section ── */
function AvatarSection({ user }: { user: { name: string; avatarUrl?: string } }) {
  return (
    <div className="flex items-center gap-5">
      <div className="relative">
        <Avatar name={user.name} src={user.avatarUrl} size="lg" />
        <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-surface shadow border border-line flex items-center justify-center cursor-default" title="Avatar editing via URL below">
          <Camera size={13} className="text-fg-muted" />
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-[17px] font-semibold text-fg tracking-tight truncate" title={user.name}>
          {user.name}
        </p>
        <p className="text-[13px] text-fg-muted mt-0.5">Update your name, email and department below</p>
      </div>
    </div>
  );
}

/* ── Profile form ── */
function ProfileForm() {
  const { user, updateProfile } = useAuth();
  const [form, setForm] = useState({
    name:       user?.name       ?? '',
    email:      user?.email      ?? '',
    department: user?.department ?? '',
    avatarUrl:  user?.avatarUrl  ?? '',
  });
  const [busy, setBusy]   = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setToast(null);
    try {
      await updateProfile(form);
      setToast({ type: 'ok', msg: 'Profile updated successfully!' });
    } catch (err: any) {
      setToast({ type: 'err', msg: err?.response?.data?.error ?? err?.response?.data?.message ?? 'Failed to update profile.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {toast && <Toast type={toast.type} msg={toast.msg} onDismiss={() => setToast(null)} />}

      <Field label="Full name">
        <Input
          icon={<User size={15} />}
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          required minLength={2}
          placeholder="Your full name"
        />
      </Field>

      <Field label="Email address">
        <Input
          type="email"
          icon={<Mail size={15} />}
          value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          required
          placeholder="you@example.com"
        />
      </Field>

      <Field label="Department">
        <Input
          icon={<Briefcase size={15} />}
          value={form.department}
          onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
          placeholder="e.g. Engineering, Sales"
        />
      </Field>

      <Field label="Avatar URL (optional)">
        <Input
          type="url"
          value={form.avatarUrl}
          onChange={e => setForm(f => ({ ...f, avatarUrl: e.target.value }))}
          placeholder="https://..."
        />
      </Field>

      <div className="pt-1">
        <Button type="submit" size="lg" loading={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

/* ── Password form ── */
function PasswordForm() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [show, setShow]   = useState({ current: false, next: false });
  const [busy, setBusy]   = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) {
      setToast({ type: 'err', msg: 'New passwords do not match.' });
      return;
    }
    if (form.newPassword.length < 8) {
      setToast({ type: 'err', msg: 'New password must be at least 8 characters.' });
      return;
    }
    setBusy(true);
    setToast(null);
    try {
      await api.put('/auth/me/password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setToast({ type: 'ok', msg: 'Password changed! Other sessions have been signed out.' });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err: any) {
      setToast({ type: 'err', msg: err?.response?.data?.error ?? err?.response?.data?.message ?? 'Failed to change password.' });
    } finally {
      setBusy(false);
    }
  }

  const mismatch = !!form.confirm && form.confirm !== form.newPassword;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {toast && <Toast type={toast.type} msg={toast.msg} onDismiss={() => setToast(null)} />}

      <Field label="Current password">
        <div className="relative">
          <Input
            type={show.current ? 'text' : 'password'}
            icon={<Lock size={15} />}
            className="pr-10"
            value={form.currentPassword}
            onChange={e => setForm(f => ({ ...f, currentPassword: e.target.value }))}
            required
            placeholder="Your current password"
          />
          <IconButton
            label={show.current ? 'Hide password' : 'Show password'}
            icon={show.current ? <EyeOff size={14} /> : <Eye size={14} />}
            onClick={() => setShow(s => ({ ...s, current: !s.current }))}
            className="absolute right-1.5 top-1/2 -translate-y-1/2"
          />
        </div>
      </Field>

      <Field label="New password">
        <div className="relative">
          <Input
            type={show.next ? 'text' : 'password'}
            icon={<Lock size={15} />}
            className="pr-10"
            value={form.newPassword}
            onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))}
            required minLength={8}
            placeholder="Min 8 characters"
          />
          <IconButton
            label={show.next ? 'Hide password' : 'Show password'}
            icon={show.next ? <EyeOff size={14} /> : <Eye size={14} />}
            onClick={() => setShow(s => ({ ...s, next: !s.next }))}
            className="absolute right-1.5 top-1/2 -translate-y-1/2"
          />
        </div>
      </Field>

      <Field label="Confirm new password" error={mismatch ? "Passwords don't match" : null}>
        <Input
          type="password"
          icon={<Lock size={15} />}
          invalid={mismatch}
          value={form.confirm}
          onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
          required
          placeholder="Re-enter new password"
        />
      </Field>

      <div className="pt-1">
        <Button type="submit" size="lg" loading={busy}>
          {busy ? 'Updating…' : 'Change password'}
        </Button>
      </div>
    </form>
  );
}

/* ── Connections (Google SSO + Calendar sync) ── */
function ConnectionsPanel() {
  const [params] = useSearchParams();
  const [google, setGoogle] = useState<{ configured: boolean; linked: boolean } | null>(null);
  const [calendar, setCalendar] = useState<{ configured: boolean; connected: boolean; connectedEmail: string | null } | null>(null);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [g, c] = await Promise.all([
      api.get('/auth/google/status').then(r => r.data).catch(() => null),
      api.get('/calendar/status').then(r => r.data).catch(() => null),
    ]);
    setGoogle(g); setCalendar(c);
  }

  useEffect(() => {
    refresh();
    const calendarStatus = params.get('calendar');
    if (calendarStatus === 'connected') setToast({ type: 'ok', msg: 'Google Calendar connected!' });
    if (calendarStatus === 'error') setToast({ type: 'err', msg: 'Could not connect Google Calendar. Please try again.' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function linkGoogle(idToken: string) {
    setBusy(true);
    try {
      await api.post('/auth/google/link', { idToken });
      setToast({ type: 'ok', msg: 'Google account linked — you can now sign in with Google.' });
      refresh();
    } catch (err: any) {
      setToast({ type: 'err', msg: err?.response?.data?.error ?? 'Could not link Google account.' });
    } finally { setBusy(false); }
  }

  async function unlinkGoogle() {
    setBusy(true);
    try {
      await api.delete('/auth/google/link');
      setToast({ type: 'ok', msg: 'Google account unlinked.' });
      refresh();
    } catch { setToast({ type: 'err', msg: 'Could not unlink Google account.' }); } finally { setBusy(false); }
  }

  async function connectCalendar() {
    try {
      const { data } = await api.get('/calendar/oauth-url');
      window.location.href = data.url;
    } catch (err: any) {
      setToast({ type: 'err', msg: err?.response?.data?.error ?? 'Calendar sync is not configured on this server.' });
    }
  }

  async function disconnectCalendar() {
    setBusy(true);
    try {
      await api.delete('/calendar/connection');
      setToast({ type: 'ok', msg: 'Calendar disconnected.' });
      refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      {toast && <Toast type={toast.type} msg={toast.msg} onDismiss={() => setToast(null)} />}

      <div>
        <p className="text-[13px] font-semibold text-fg flex items-center gap-2"><Link2 size={15} className="text-accent" /> Google Sign-In</p>
        <p className="text-[11.5px] text-fg-muted mt-1 mb-3">Link your Google account to sign in without a password.</p>
        {!google?.configured ? (
          <p className="text-[11.5px] text-fg-subtle italic">Not set up for this workspace yet — an admin needs to configure Google SSO.</p>
        ) : google.linked ? (
          <div className="flex items-center gap-3">
            <Badge variant="green"><CheckCircle2 size={12} /> Linked</Badge>
            <Button size="xs" variant="ghost" className="!text-danger" disabled={busy} onClick={unlinkGoogle}>Unlink</Button>
          </div>
        ) : (
          <GoogleSignInButton onIdToken={linkGoogle} text="continue_with" />
        )}
      </div>

      <div className="border-t border-line-subtle pt-5">
        <p className="text-[13px] font-semibold text-fg flex items-center gap-2"><CalendarDays size={15} className="text-accent" /> Google Calendar</p>
        <p className="text-[11.5px] text-fg-muted mt-1 mb-3">Sync your open activities and assigned tickets to your Google Calendar.</p>
        {!calendar?.configured ? (
          <p className="text-[11.5px] text-fg-subtle italic">Not set up for this workspace yet — an admin needs to configure calendar sync.</p>
        ) : calendar.connected ? (
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="green">
              <CheckCircle2 size={12} /> Connected{calendar.connectedEmail ? ` (${calendar.connectedEmail})` : ''}
            </Badge>
            <Button size="xs" variant="ghost" className="!text-danger" disabled={busy} onClick={disconnectCalendar}>Disconnect</Button>
          </div>
        ) : (
          <Button size="sm" onClick={connectCalendar}>Connect Google Calendar</Button>
        )}
      </div>
    </div>
  );
}

/* ── Privacy & Data (GDPR) ── */
function PrivacyPanel() {
  const { logout } = useAuth();
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function exportData() {
    try {
      const res = await api.get('/gdpr/export/me');
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'my-data-export.json'; a.click();
      URL.revokeObjectURL(url);
    } catch { setToast({ type: 'err', msg: 'Could not export your data.' }); }
  }

  async function deleteMyData(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/gdpr/delete-request/me', { password, confirm: true });
      logout();
    } catch (err: any) {
      setToast({ type: 'err', msg: err?.response?.data?.error ?? 'Could not process this request.' });
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {toast && <Toast type={toast.type} msg={toast.msg} onDismiss={() => setToast(null)} />}

      <div>
        <p className="text-[13px] font-semibold text-fg flex items-center gap-2"><Download size={15} className="text-accent" /> Export your data</p>
        <p className="text-[11.5px] text-fg-muted mt-1 mb-3">Download a JSON copy of your profile, activities, comments, and tickets/deals you're linked to.</p>
        <Button size="sm" variant="secondary" onClick={exportData}>Download my data</Button>
      </div>

      <div className="border-t border-line-subtle pt-5">
        <p className="text-[13px] font-semibold text-danger flex items-center gap-2"><Trash2 size={15} /> Delete my personal data</p>
        <p className="text-[11.5px] text-fg-muted mt-1 mb-3">
          Removes your name, email and phone from your account and deactivates it. Records you're linked to (tickets, deals, comments) stay for your organization's continuity but no longer show your name. This can't be undone.
        </p>
        {!confirmDelete ? (
          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>Delete my data</Button>
        ) : (
          <form onSubmit={deleteMyData} className="space-y-3 max-w-sm">
            <p className="text-[11.5px] text-fg-muted">Confirm your password to proceed.</p>
            <Input
              type="password" required value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Current password" aria-label="Current password"
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="danger" loading={busy}>
                {busy ? 'Processing…' : 'Confirm deletion'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ── Main page ── */
const TABS = [
  { key: 'profile', label: 'Profile details' },
  { key: 'security', label: 'Security' },
  { key: 'connections', label: 'Connections' },
  { key: 'privacy', label: 'Privacy & Data' },
] as const;

type TabKey = typeof TABS[number]['key'];

export default function ProfilePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>('profile');

  if (!user) return null;

  return (
    <div>
      <PageHeader title="My Profile" subtitle="Manage your personal details and account security" />

      <PageBody width="narrow">
        {/* Avatar hero */}
        <Card>
          <AvatarSection user={user} />
          <div className="mt-4 flex items-center gap-1.5 flex-wrap">
            <span className="text-[11.5px] text-fg-subtle">Role:</span>
            <Badge variant="accent">{user.role?.replace(/_/g, ' ')}</Badge>
            {user.org?.name && (
              <>
                <span className="text-fg-subtle mx-1">·</span>
                <span className="text-[11.5px] text-fg-muted min-w-0 truncate" title={user.org.name}>
                  {user.org.name}
                </span>
              </>
            )}
          </div>
        </Card>

        {/* Tabs */}
        <Tabs
          variant="segmented"
          aria-label="Profile sections"
          value={tab}
          onChange={setTab}
          items={TABS.map(t => ({ key: t.key, label: t.label }))}
        />

        {/* Tab content */}
        <Card padding="lg">
          {tab === 'profile' && (
            <>
              <h2 className="text-[14px] font-semibold text-fg tracking-tight mb-5">Personal information</h2>
              <ProfileForm />
            </>
          )}
          {tab === 'security' && (
            <>
              <h2 className="text-[14px] font-semibold text-fg tracking-tight mb-1">Change password</h2>
              <p className="text-[13px] text-fg-muted mb-5">
                After changing your password, all other active sessions will be signed out.
              </p>
              <PasswordForm />
            </>
          )}
          {tab === 'connections' && (
            <>
              <h2 className="text-[14px] font-semibold text-fg tracking-tight mb-5">Connections</h2>
              <ConnectionsPanel />
            </>
          )}
          {tab === 'privacy' && (
            <>
              <h2 className="text-[14px] font-semibold text-fg tracking-tight mb-5">Privacy &amp; data</h2>
              <PrivacyPanel />
            </>
          )}
        </Card>
      </PageBody>
    </div>
  );
}
