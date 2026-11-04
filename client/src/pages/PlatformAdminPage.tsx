import { useEffect, useState } from 'react';
import { Building2, Users as UsersIcon, CheckCircle2, XCircle, AlertTriangle, LogOut, HardDrive, Pencil, Check, Mail, MessageCircle, Settings as SettingsIcon, Tags, RotateCcw } from 'lucide-react';
import {
  usePlatformOrgs,
  usePlatformOrg,
  useUpdatePlatformOrg,
  useUpdatePlatformSubscription,
  useUpdatePlatformBranding,
  usePlatformSettings,
  useTestPlatformStorage,
  useUpdatePlatformSettings,
  usePlatformPricing,
  useUpdatePlatformPricing,
  useResetPlatformPricing,
  type PricingConfig,
  type PricingUpdate,
  type PlatformOrgDetail,
  type PlatformOrgSummary,
  type SendCounts,
  type PlatformSecretStatus,
  type PlatformSettingsUpdate,
} from '../api/platformAdmin';
import {
  PageHeader, PageBody, Card, StatTile, Modal, Button, IconButton, Badge, Checkbox, Toggle,
  Field, Input, Select, DataTable, EmptyState, Alert, SkeletonCard, SkeletonStats, SkeletonTable,
  type Column,
} from '../shared/components';
import { useAuth } from '../contexts/AuthContext';

const GB = 1024 * 1024 * 1024;
const gbLabel = (bytes: number) => `${(bytes / GB).toFixed(bytes < GB ? 2 : 1)}GB`;

/** One plan → one colour, matching BillingPage so "Pro" reads the same everywhere. */
const PLAN_BADGE: Record<string, 'gray' | 'purple' | 'blue' | 'yellow'> = {
  FREE: 'gray', PRO: 'purple', ENTERPRISE: 'blue', CUSTOM: 'yellow',
};

function UsageBar({ label, usedBytes, quotaBytes, colorClass }: { label: string; usedBytes: number; quotaBytes: number; colorClass: string }) {
  const pct = quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 100;
  return (
    <div className="flex flex-col gap-1 min-w-[120px]">
      <span className="inline-flex items-center gap-1 text-xs font-medium text-fg tabular-nums">
        <HardDrive size={12} className={colorClass} /> {label} · {gbLabel(usedBytes)} / {gbLabel(quotaBytes)}
      </span>
      <div className="h-1.5 w-full bg-surface-sunken rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Storage provider label + (for hosted S3, explicit or auto-fallback) quota/usage bar — used in both the table row and the detail panel. */
function StorageBadge({ provider, quotaBytes, usedBytes, connectedEmail }: { provider: 'GOOGLE_DRIVE' | 'HOSTED_S3' | null; quotaBytes: number; usedBytes: number; connectedEmail?: string | null }) {
  if (provider === 'GOOGLE_DRIVE') {
    return (
      <Badge variant="blue">
        <HardDrive size={12} /> Own Google Drive{connectedEmail ? ` (${connectedEmail})` : ''}
      </Badge>
    );
  }
  if (provider === 'HOSTED_S3') {
    return <UsageBar label="Hosted S3" usedBytes={usedBytes} quotaBytes={quotaBytes} colorClass="text-accent" />;
  }
  // No StorageConfig row — but storage.ts auto-falls-back unconnected orgs
  // straight to our hosted S3, so there may still be real usage here.
  if (usedBytes > 0) {
    return <UsageBar label="Platform default" usedBytes={usedBytes} quotaBytes={quotaBytes} colorClass="text-fg-muted" />;
  }
  return quotaBytes > 0
    ? <span className="text-xs text-fg-muted">Not connected · uses platform default ({gbLabel(quotaBytes)} quota) automatically</span>
    : <span className="text-xs text-fg-muted">Not connected · plan has no hosted quota</span>;
}

/** Compact "how many sends went through our infrastructure" badge for the orgs table. */
function PlatformSendBadge({ sendCounts }: { sendCounts: SendCounts }) {
  const platformTotal = sendCounts.email.platform + sendCounts.whatsapp.platform;
  if (platformTotal === 0) return <span className="text-xs text-fg-subtle">—</span>;
  return (
    <span className="inline-flex items-center gap-2.5 text-xs text-fg">
      {sendCounts.email.platform > 0 && (
        <span className="inline-flex items-center gap-1" title={`${sendCounts.email.platform} emails sent via the platform`}>
          <Mail size={12} className="text-fg-subtle" />{sendCounts.email.platform}
        </span>
      )}
      {sendCounts.whatsapp.platform > 0 && (
        <span className="inline-flex items-center gap-1" title={`${sendCounts.whatsapp.platform} WhatsApp messages sent via the platform`}>
          <MessageCircle size={12} className="text-fg-subtle" />{sendCounts.whatsapp.platform}
        </span>
      )}
    </span>
  );
}

/** Section heading inside the detail/settings panels. */
function PanelHeading({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h3 className="text-xs font-semibold text-fg-muted uppercase inline-flex items-center gap-1">{children}</h3>
      {actions}
    </div>
  );
}

/** Full own-vs-platform-vs-total breakdown for the detail panel. */
function SendCountsSection({ sendCounts }: { sendCounts: SendCounts }) {
  return (
    <section>
      <PanelHeading>Sending activity (all time)</PanelHeading>
      <Card tone="sunken" padding="sm" flat className="text-sm space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-fg-muted inline-flex items-center gap-1"><Mail size={12} /> Email</span>
          <span className="font-medium text-fg">{sendCounts.email.own} own · {sendCounts.email.platform} via us · {sendCounts.email.total} total</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-fg-muted inline-flex items-center gap-1"><MessageCircle size={12} /> WhatsApp</span>
          <span className="font-medium text-fg">{sendCounts.whatsapp.own} own · {sendCounts.whatsapp.platform} via us · {sendCounts.whatsapp.total} total</span>
        </div>
      </Card>
    </section>
  );
}

function ConnectionBadge({ connected, label }: { connected: boolean; label: string }) {
  return (
    <Badge variant={connected ? 'green' : 'gray'}>
      {connected ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
      {label}
    </Badge>
  );
}

/** Small inline field-edit control: click the pencil to reveal Save/Cancel, shared by all sections below. */
function SectionEditToggle({ editing, onEdit, onCancel, onSave, saving }: { editing: boolean; onEdit: () => void; onCancel: () => void; onSave: () => void; saving: boolean }) {
  if (!editing) {
    return <IconButton size="xs" label="Edit" icon={<Pencil size={12} />} onClick={onEdit} />;
  }
  return (
    <div className="flex items-center gap-1">
      <Button size="xs" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
      <Button size="xs" icon={<Check size={12} />} loading={saving} onClick={onSave}>Save</Button>
    </div>
  );
}

/** Org display name — the one field on Organization itself (PATCH /platform/orgs/:id). */
function OrgNameEditor({ org }: { org: PlatformOrgDetail }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(org.name);
  const mutation = useUpdatePlatformOrg();

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[16px] font-semibold text-fg tracking-tight truncate">{org.branding?.companyName || org.name}</div>
          <div className="text-[12.5px] text-fg-muted font-mono truncate" title={org.slug}>{org.slug}</div>
        </div>
        <IconButton
          label="Edit org name"
          icon={<Pencil size={13} />}
          className="mt-1"
          onClick={() => { setName(org.name); setEditing(true); }}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label="Organization name"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Organization name"
      />
      <SectionEditToggle
        editing
        onEdit={() => {}}
        onCancel={() => setEditing(false)}
        saving={mutation.isPending}
        onSave={() => mutation.mutate({ id: org.id, name }, { onSuccess: () => setEditing(false) })}
      />
    </div>
  );
}

/** License / plan section — plan/seats/status/renewal-cancel toggle (PATCH /platform/orgs/:id/subscription). */
function SubscriptionEditor({ org }: { org: PlatformOrgDetail }) {
  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState(org.subscription?.plan ?? org.plan);
  const [seats, setSeats] = useState(org.subscription?.seats ?? 5);
  const [status, setStatus] = useState(org.subscription?.status ?? 'active');
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(org.subscription?.cancelAtPeriodEnd ?? false);
  // License limits set here beat plan defaults. Kept as strings in the form
  // so an emptied input round-trips as null ("no override") rather than 0.
  const [storageOverrideGb, setStorageOverrideGb] = useState<string>(
    (org.subscription as any)?.storageQuotaOverrideGb != null ? String((org.subscription as any).storageQuotaOverrideGb) : ''
  );
  const [aiTokenLimit, setAiTokenLimit] = useState<string>(
    (org.subscription as any)?.aiTokenLimitMonthly != null ? String((org.subscription as any).aiTokenLimitMonthly) : ''
  );
  const mutation = useUpdatePlatformSubscription();

  const startEdit = () => {
    setPlan(org.subscription?.plan ?? org.plan);
    setSeats(org.subscription?.seats ?? 5);
    setStatus(org.subscription?.status ?? 'active');
    setCancelAtPeriodEnd(org.subscription?.cancelAtPeriodEnd ?? false);
    setStorageOverrideGb((org.subscription as any)?.storageQuotaOverrideGb != null ? String((org.subscription as any).storageQuotaOverrideGb) : '');
    setAiTokenLimit((org.subscription as any)?.aiTokenLimitMonthly != null ? String((org.subscription as any).aiTokenLimitMonthly) : '');
    setEditing(true);
  };

  return (
    <section>
      <PanelHeading
        actions={
          <SectionEditToggle
            editing={editing}
            onEdit={startEdit}
            onCancel={() => setEditing(false)}
            saving={mutation.isPending}
            onSave={() => mutation.mutate({
              id: org.id, plan: plan as 'FREE' | 'PRO' | 'ENTERPRISE' | 'CUSTOM', seats, status, cancelAtPeriodEnd,
              storageQuotaOverrideGb: storageOverrideGb.trim() === '' ? null : Number(storageOverrideGb),
              aiTokenLimitMonthly: aiTokenLimit.trim() === '' ? null : Number(aiTokenLimit),
            } as any, { onSuccess: () => setEditing(false) })}
          />
        }
      >
        License / plan
      </PanelHeading>
      {editing ? (
        <Card tone="sunken" padding="sm" flat className="space-y-3">
          <Field label="Plan">
            <Select
              value={plan}
              onChange={e => setPlan(e.target.value)}
              options={[
                { value: 'FREE', label: 'FREE' },
                { value: 'PRO', label: 'PRO' },
                { value: 'ENTERPRISE', label: 'ENTERPRISE' },
                { value: 'CUSTOM', label: 'CUSTOM (self-serve licence — modules/seats set at checkout)' },
              ]}
            />
          </Field>
          <Field label="Seats">
            <Input type="number" min={1} value={seats} onChange={e => setSeats(Number(e.target.value))} />
          </Field>
          <Field label="Status">
            <Input value={status} onChange={e => setStatus(e.target.value)} />
          </Field>
          <Checkbox
            label="Cancel at period end"
            checked={cancelAtPeriodEnd}
            onChange={e => setCancelAtPeriodEnd(e.target.checked)}
          />
          <Field label="Storage quota override (GB)" hint="Blank = plan default. 0 removes hosted storage for this org entirely.">
            <Input type="number" min={0} placeholder="plan default" value={storageOverrideGb}
              onChange={e => setStorageOverrideGb(e.target.value)} />
          </Field>
          <Field label="AI tokens / month" hint="Blank = unlimited. Hard cap — AI calls are refused once the org uses this many tokens in a month.">
            <Input type="number" min={0} placeholder="unlimited" value={aiTokenLimit}
              onChange={e => setAiTokenLimit(e.target.value)} />
          </Field>
        </Card>
      ) : (
        <Card tone="sunken" padding="sm" flat className="text-sm space-y-1">
          <div className="flex justify-between items-center"><span className="text-fg-muted">Plan</span><Badge variant={PLAN_BADGE[org.subscription?.plan ?? org.plan] ?? 'gray'}>{org.subscription?.plan ?? org.plan}</Badge></div>
          <div className="flex justify-between"><span className="text-fg-muted">Status</span><span className="font-medium text-fg">{org.subscription?.status ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-fg-muted">Seats</span><span className="font-medium text-fg tabular-nums">{org.subscription?.seats ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-fg-muted">Renews</span><span className="font-medium text-fg tabular-nums">{org.subscription?.currentPeriodEnd ? new Date(org.subscription.currentPeriodEnd).toLocaleDateString() : '—'}{org.subscription?.cancelAtPeriodEnd ? ' (cancelling)' : ''}</span></div>
          <div className="flex justify-between gap-3"><span className="text-fg-muted shrink-0">Stripe customer</span><span className="font-mono text-xs text-fg-muted truncate" title={org.subscription?.stripeCustomerId ?? undefined}>{org.subscription?.stripeCustomerId ?? 'not connected'}</span></div>
          <div className="flex justify-between"><span className="text-fg-muted">Storage quota</span><span className="font-medium text-fg tabular-nums">{(org.subscription as any)?.storageQuotaOverrideGb != null ? `${(org.subscription as any).storageQuotaOverrideGb} GB (override)` : 'plan default'}</span></div>
          <div className="flex justify-between"><span className="text-fg-muted">AI tokens / month</span><span className="font-medium text-fg tabular-nums">{(org.subscription as any)?.aiTokenLimitMonthly != null ? (org.subscription as any).aiTokenLimitMonthly.toLocaleString() : 'unlimited'}</span></div>
          {(org as any).aiUsage && (
            <div className="flex justify-between"><span className="text-fg-muted">AI tokens used (month)</span><span className="font-medium text-fg tabular-nums">{((org as any).aiUsage.tokensUsedThisMonth ?? 0).toLocaleString()}{(org as any).aiUsage.tokenLimitMonthly ? ` / ${(org as any).aiUsage.tokenLimitMonthly.toLocaleString()}` : ''}</span></div>
          )}
        </Card>
      )}
    </section>
  );
}

/** Branding section — companyName/supportEmail/primaryColor (PATCH /platform/orgs/:id/branding). */
function BrandingEditor({ org }: { org: PlatformOrgDetail }) {
  const [editing, setEditing] = useState(false);
  const [companyName, setCompanyName] = useState(org.branding?.companyName ?? '');
  const [supportEmail, setSupportEmail] = useState(org.branding?.supportEmail ?? '');
  const [primaryColor, setPrimaryColor] = useState(org.branding?.primaryColor ?? '#2563eb');
  const mutation = useUpdatePlatformBranding();

  const startEdit = () => {
    setCompanyName(org.branding?.companyName ?? '');
    setSupportEmail(org.branding?.supportEmail ?? '');
    setPrimaryColor(org.branding?.primaryColor ?? '#2563eb');
    setEditing(true);
  };

  return (
    <section>
      <PanelHeading
        actions={
          <SectionEditToggle
            editing={editing}
            onEdit={startEdit}
            onCancel={() => setEditing(false)}
            saving={mutation.isPending}
            onSave={() => mutation.mutate(
              { id: org.id, companyName: companyName || undefined, supportEmail: supportEmail || null, primaryColor },
              { onSuccess: () => setEditing(false) },
            )}
          />
        }
      >
        Branding
      </PanelHeading>
      {editing ? (
        <Card tone="sunken" padding="sm" flat className="space-y-3">
          <Field label="Company name">
            <Input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder={org.name} />
          </Field>
          <Field label="Support email">
            <Input type="email" value={supportEmail} onChange={e => setSupportEmail(e.target.value)} placeholder="support@…" />
          </Field>
          <Field label="Primary color">
            {/* A native colour swatch keeps its own sizing rather than the
                shared text-input geometry. */}
            <input
              type="color"
              aria-label="Primary color"
              className="w-10 h-7 p-0.5 border border-line rounded-input"
              value={primaryColor}
              onChange={e => setPrimaryColor(e.target.value)}
            />
          </Field>
        </Card>
      ) : (
        <Card tone="sunken" padding="sm" flat className="text-sm space-y-1">
          <div className="flex justify-between"><span className="text-fg-muted">Company name</span><span className="font-medium text-fg">{org.branding?.companyName ?? '—'}</span></div>
          <div className="flex justify-between"><span className="text-fg-muted">Support email</span><span className="font-medium text-fg">{org.branding?.supportEmail ?? '—'}</span></div>
          <div className="flex items-center justify-between"><span className="text-fg-muted">Primary color</span><span className="flex items-center gap-1.5 text-fg"><span className="w-3 h-3 rounded-full border border-line" style={{ background: org.branding?.primaryColor }} />{org.branding?.primaryColor ?? '—'}</span></div>
        </Card>
      )}
    </section>
  );
}

function SecretFieldStatus({ status }: { status: PlatformSecretStatus }) {
  if (!status.configured) return <span className="text-fg-subtle">Not configured</span>;
  return (
    <span className="text-success inline-flex items-center gap-1">
      <CheckCircle2 size={11} /> Configured ({status.source === 'database' ? 'set here' : 'from env var'})
    </span>
  );
}

interface SettingsFormState {
  resendFrom: string; smtpHost: string; smtpPort: string; smtpUser: string; smtpFrom: string;
  twilioAccountSid: string; twilioFromNumber: string;
  resendApiKey: string; smtpPass: string; twilioAuthToken: string;
  s3Bucket: string; s3Region: string; s3Endpoint: string;
  s3AccessKeyId: string; s3SecretAccessKey: string;
}

/**
 * The platform-wide email/WhatsApp *fallback* config — the account used to
 * send on behalf of an org that hasn't connected its own (Tier 1
 * white-label mailer, Twilio WhatsApp fallback). Previously only settable
 * via Render env vars; this panel writes straight to the PlatformSettings
 * DB row, which takes effect immediately, no redeploy.
 */
function PlatformSettingsPanel({ onClose }: { onClose: () => void }) {
  const { data: settings, isLoading } = usePlatformSettings();
  const mutation = useUpdatePlatformSettings();
  const [form, setForm] = useState<SettingsFormState | null>(null);

  useEffect(() => {
    if (!settings) return;
    setForm({
      resendFrom: settings.resendFrom ?? '',
      smtpHost: settings.smtpHost ?? '',
      smtpPort: settings.smtpPort != null ? String(settings.smtpPort) : '',
      smtpUser: settings.smtpUser ?? '',
      smtpFrom: settings.smtpFrom ?? '',
      twilioAccountSid: settings.twilioAccountSid ?? '',
      twilioFromNumber: settings.twilioFromNumber ?? '',
      resendApiKey: '',
      smtpPass: '',
      twilioAuthToken: '',
      s3Bucket: settings.s3Bucket ?? '',
      s3Region: settings.s3Region ?? '',
      s3Endpoint: settings.s3Endpoint ?? '',
      s3AccessKeyId: '',
      s3SecretAccessKey: '',
    });
  }, [settings]);

  const set = (key: keyof SettingsFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => (f ? { ...f, [key]: e.target.value } : f));

  const save = () => {
    if (!form) return;
    const payload: PlatformSettingsUpdate = {
      resendFrom: form.resendFrom,
      smtpHost: form.smtpHost,
      smtpPort: form.smtpPort === '' ? null : Number(form.smtpPort),
      smtpUser: form.smtpUser,
      smtpFrom: form.smtpFrom,
      twilioAccountSid: form.twilioAccountSid,
      twilioFromNumber: form.twilioFromNumber,
      s3Bucket: form.s3Bucket,
      s3Region: form.s3Region,
      s3Endpoint: form.s3Endpoint,
    };
    if (form.resendApiKey) payload.resendApiKey = form.resendApiKey;
    if (form.smtpPass) payload.smtpPass = form.smtpPass;
    if (form.twilioAuthToken) payload.twilioAuthToken = form.twilioAuthToken;
    // Secrets are write-only: an empty box means "leave whatever is stored
    // alone", not "clear it". Clearing is the explicit button next to each.
    if (form.s3AccessKeyId) payload.s3AccessKeyId = form.s3AccessKeyId;
    if (form.s3SecretAccessKey) payload.s3SecretAccessKey = form.s3SecretAccessKey;
    mutation.mutate(payload, {
      onSuccess: () => setForm(f => (f ? { ...f, resendApiKey: '', smtpPass: '', twilioAuthToken: '', s3AccessKeyId: '', s3SecretAccessKey: '' } : f)),
    });
  };

  const clearSecret = (field: 'resendApiKey' | 'smtpPass' | 'twilioAuthToken' | 's3AccessKeyId' | 's3SecretAccessKey') => {
    mutation.mutate({ [field]: '' } as PlatformSettingsUpdate);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Platform settings"
      subtitle="The shared sending account used when an org hasn't connected its own. Changes here take effect immediately — no redeploy needed. Leave a field blank to keep using its Render env var."
      icon={<SettingsIcon size={16} />}
      size="lg"
      footer={
        settings && form ? (
          <>
            <span className="mr-auto text-xs text-fg-subtle">
              {settings.updatedAt ? `Last saved ${new Date(settings.updatedAt).toLocaleString()}` : 'Never saved — using env vars only'}
            </span>
            <Button icon={<Check size={14} />} loading={mutation.isPending} onClick={save}>
              Save changes
            </Button>
          </>
        ) : undefined
      }
    >
      {isLoading || !settings || !form ? (
        <div className="space-y-4" aria-hidden="true">
          <SkeletonCard lines={5} />
          <SkeletonCard lines={4} />
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <PanelHeading><Mail size={12} /> Email fallback</PanelHeading>
            <Card tone="sunken" padding="sm" flat className="space-y-3">
              <Field label="Resend API key" hint={<SecretFieldStatus status={settings.resendApiKey} />}>
                <div className="flex gap-1.5">
                  <Input type="password" placeholder={settings.resendApiKey.configured ? '•••••••••• (leave blank to keep)' : 're_...'} value={form.resendApiKey} onChange={set('resendApiKey')} />
                  {settings.resendApiKey.source === 'database' && (
                    <Button size="sm" variant="ghost" onClick={() => clearSecret('resendApiKey')}>Clear</Button>
                  )}
                </div>
              </Field>
              <Field label='Resend "From" address'>
                <Input value={form.resendFrom} onChange={set('resendFrom')} placeholder="Name <noreply@yourdomain.com>" />
              </Field>
              <div className="border-t border-line pt-2 text-xs text-fg-subtle">SMTP fallback (used only if no Resend key is configured)</div>
              <Field label="SMTP host">
                <Input value={form.smtpHost} onChange={set('smtpHost')} placeholder="smtp.gmail.com" />
              </Field>
              <Field label="SMTP port">
                <Input type="number" value={form.smtpPort} onChange={set('smtpPort')} placeholder="587" />
              </Field>
              <Field label="SMTP user">
                <Input value={form.smtpUser} onChange={set('smtpUser')} />
              </Field>
              <Field label="SMTP password" hint={<SecretFieldStatus status={settings.smtpPass} />}>
                <div className="flex gap-1.5">
                  <Input type="password" placeholder={settings.smtpPass.configured ? '•••••••••• (leave blank to keep)' : ''} value={form.smtpPass} onChange={set('smtpPass')} />
                  {settings.smtpPass.source === 'database' && (
                    <Button size="sm" variant="ghost" onClick={() => clearSecret('smtpPass')}>Clear</Button>
                  )}
                </div>
              </Field>
              <Field label='SMTP "From" address'>
                <Input value={form.smtpFrom} onChange={set('smtpFrom')} />
              </Field>
            </Card>
          </section>

          <section>
            <PanelHeading><MessageCircle size={12} /> WhatsApp fallback (Twilio)</PanelHeading>
            <Card tone="sunken" padding="sm" flat className="space-y-3">
              <Field label="Account SID">
                <Input value={form.twilioAccountSid} onChange={set('twilioAccountSid')} placeholder="AC..." />
              </Field>
              <Field label="Auth token" hint={<SecretFieldStatus status={settings.twilioAuthToken} />}>
                <div className="flex gap-1.5">
                  <Input type="password" placeholder={settings.twilioAuthToken.configured ? '•••••••••• (leave blank to keep)' : ''} value={form.twilioAuthToken} onChange={set('twilioAuthToken')} />
                  {settings.twilioAuthToken.source === 'database' && (
                    <Button size="sm" variant="ghost" onClick={() => clearSecret('twilioAuthToken')}>Clear</Button>
                  )}
                </div>
              </Field>
              <Field label="From number">
                <Input value={form.twilioFromNumber} onChange={set('twilioFromNumber')} placeholder="whatsapp:+1415..." />
              </Field>
            </Card>
          </section>

          <section>
            <PanelHeading><HardDrive size={12} /> Hosted attachment storage</PanelHeading>
            <Card tone="sunken" padding="sm" flat className="space-y-3">
              <p className="text-xs text-fg-muted">
                The shared bucket behind “Our hosted storage” — where attachments land for any
                paying org that hasn’t connected a Google Drive or a bucket of their own. Any
                S3-compatible service works (S3, R2, Wasabi, B2, Spaces, MinIO).
              </p>

              <Alert
                tone={settings.hostedStorageReady ? 'success' : 'warning'}
                icon={settings.hostedStorageReady ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
              >
                {settings.hostedStorageReady ? (
                  <>Live: <strong>{settings.effectiveStorage.bucket}</strong>
                  {settings.effectiveStorage.region ? ` · ${settings.effectiveStorage.region}` : ''}
                  {settings.effectiveStorage.endpoint ? <> · <code className="font-mono">{settings.effectiveStorage.endpoint}</code></> : ' · AWS S3'}</>
                ) : (
                  'Not configured. Orgs on Pro and Enterprise cannot use hosted storage until a bucket and credentials are set — they can still connect their own Google Drive or S3 bucket.'
                )}
              </Alert>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Bucket">
                  <Input value={form.s3Bucket} onChange={set('s3Bucket')} placeholder="crmitdesk-attachments" />
                </Field>
                <Field label="Region">
                  <Input value={form.s3Region} onChange={set('s3Region')} placeholder="auto" />
                </Field>
              </div>
              <Field label="Endpoint" hint="Leave blank for Amazon S3. Required for R2, Wasabi, B2, Spaces and MinIO.">
                <Input value={form.s3Endpoint} onChange={set('s3Endpoint')} placeholder="https://<account>.r2.cloudflarestorage.com" />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Access key ID" hint={<SecretFieldStatus status={settings.s3AccessKeyId} />}>
                  <div className="flex gap-1.5">
                    <Input type="password" placeholder={settings.s3AccessKeyId.configured ? '•••••••••• (leave blank to keep)' : ''} value={form.s3AccessKeyId} onChange={set('s3AccessKeyId')} />
                    {settings.s3AccessKeyId.source === 'database' && (
                      <Button size="sm" variant="ghost" onClick={() => clearSecret('s3AccessKeyId')}>Clear</Button>
                    )}
                  </div>
                </Field>
                <Field label="Secret access key" hint={<SecretFieldStatus status={settings.s3SecretAccessKey} />}>
                  <div className="flex gap-1.5">
                    <Input type="password" placeholder={settings.s3SecretAccessKey.configured ? '•••••••••• (leave blank to keep)' : ''} value={form.s3SecretAccessKey} onChange={set('s3SecretAccessKey')} />
                    {settings.s3SecretAccessKey.source === 'database' && (
                      <Button size="sm" variant="ghost" onClick={() => clearSecret('s3SecretAccessKey')}>Clear</Button>
                    )}
                  </div>
                </Field>
              </div>

              <StorageTestButton form={form} />

              <p className="text-[11px] text-fg-subtle">
                Changing the bucket does not move attachments already stored in the old one — they
                stay where they are and become unreachable from here. Migrate first if there are any.
              </p>
            </Card>
          </section>
        </div>
      )}
    </Modal>
  );
}

/**
 * Round-trips a probe object (write → read → delete) against whatever hosted
 * storage would use right now, with any unsaved form values layered on top.
 *
 * Worth a button of its own because the three failure modes — wrong bucket,
 * wrong region, insufficient IAM permissions — are indistinguishable until
 * someone actually tries an upload, and by then it is a customer hitting it.
 */
function StorageTestButton({ form }: { form: SettingsFormState }) {
  const test = useTestPlatformStorage();
  const result = test.data;

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="secondary"
        loading={test.isPending}
        icon={<HardDrive size={13} />}
        onClick={() => test.mutate({
          // Only send what was typed; the server fills the rest from what is
          // live, so testing after changing one field does not require
          // re-entering the secret key.
          bucket: form.s3Bucket || undefined,
          region: form.s3Region || undefined,
          endpoint: form.s3Endpoint || undefined,
          accessKeyId: form.s3AccessKeyId || undefined,
          secretAccessKey: form.s3SecretAccessKey || undefined,
        })}
      >
        Test connection
      </Button>
      {result && (
        <Alert
          tone={result.ok ? 'success' : 'danger'}
          icon={result.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          className="animate-fade-in"
        >
          {result.ok
            ? <>Wrote, read back and deleted a test object in <strong>{result.bucket}</strong>.</>
            : <>Failed{result.step ? ` on ${result.step}` : ''}. {result.error}</>}
        </Alert>
      )}
    </div>
  );
}

function OrgDetailPanel({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const { data: org, isLoading } = usePlatformOrg(orgId);

  return (
    <Modal
      open
      onClose={onClose}
      title="Organization detail"
      icon={<Building2 size={16} />}
      size="lg"
    >
      {isLoading || !org ? (
        <div className="space-y-4" aria-hidden="true">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={5} />
          <SkeletonCard lines={4} />
        </div>
      ) : (
        <div className="space-y-6">
          <OrgNameEditor org={org} />

          <SubscriptionEditor org={org} />

          <section>
            <PanelHeading>Email sending</PanelHeading>
            <Card tone="sunken" padding="sm" flat className="text-sm space-y-1">
              {org.emailAccount ? (
                <>
                  <div className="flex justify-between"><span className="text-fg-muted">Account</span><span className="font-medium text-fg">{org.emailAccount.email}</span></div>
                  <div className="flex justify-between"><span className="text-fg-muted">SMTP host</span><span className="font-medium text-fg">{org.emailAccount.smtpHost}:{org.emailAccount.smtpPort}</span></div>
                  <div className="flex justify-between"><span className="text-fg-muted">Last sync</span><span className="font-medium text-fg">{org.emailAccount.lastSyncAt ? new Date(org.emailAccount.lastSyncAt).toLocaleString() : 'never'}</span></div>
                </>
              ) : (
                <div className="text-fg-muted">No org-owned SMTP connected — sends through the platform mailer instead, branded with this org's name/logo (Tier 1 white-label).</div>
              )}
            </Card>
          </section>

          <section>
            <PanelHeading>WhatsApp sending</PanelHeading>
            <Card tone="sunken" padding="sm" flat className="text-sm space-y-1">
              {org.whatsAppConfig ? (
                <>
                  <div className="flex justify-between"><span className="text-fg-muted">Sender number</span><span className="font-medium text-fg">{org.whatsAppConfig.phoneNumber}</span></div>
                  <div className="flex justify-between"><span className="text-fg-muted">Notify number</span><span className="font-medium text-fg">{org.whatsAppConfig.notifyNumber ?? 'same as sender'}</span></div>
                  <div className="flex justify-between"><span className="text-fg-muted">Connected</span><span className="font-medium text-fg">{new Date(org.whatsAppConfig.createdAt).toLocaleDateString()}</span></div>
                </>
              ) : (
                <div className="text-fg-muted">No WhatsApp number connected — sends through the platform's own Twilio number instead, when one is configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER).</div>
              )}
            </Card>
          </section>

          <SendCountsSection sendCounts={org.sendCounts} />

          <section>
            <PanelHeading>Attachment storage license</PanelHeading>
            <Card tone="sunken" padding="sm" flat className="text-sm space-y-2">
              <StorageBadge
                provider={org.storageConfig?.provider ?? null}
                quotaBytes={org.storageLicense.quotaBytes}
                usedBytes={org.storageLicense.usedBytes}
                connectedEmail={org.storageConfig?.connectedEmail}
              />
              {org.storageConfig?.provider === 'HOSTED_S3' && (
                <div className="flex justify-between text-xs text-fg-muted"><span>Last updated</span><span>{new Date(org.storageConfig.updatedAt).toLocaleDateString()}</span></div>
              )}
              {!org.storageConfig && (
                <p className="text-xs text-fg-muted">No storage connected yet — org can bring their own Google Drive for free, or use {gbLabel(org.storageLicense.quotaBytes)} of hosted storage included in their plan{org.storageLicense.quotaBytes === 0 ? ' once they upgrade' : ''}.</p>
              )}
            </Card>
          </section>

          <BrandingEditor org={org} />

          <section>
            <PanelHeading>Usage</PanelHeading>
            <div className="grid grid-cols-3 gap-2">
              <StatTile tone="sunken" label="Users" value={org.users.length} />
              <StatTile tone="sunken" label="Contacts" value={org._count.contacts} />
              <StatTile tone="sunken" label="Tickets" value={org._count.tickets} />
            </div>
          </section>

          <section>
            <PanelHeading>Staff</PanelHeading>
            <Card padding="none" flat className="divide-y divide-line-subtle overflow-hidden">
              {org.users.map(u => (
                <div key={u.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium text-fg">{u.name}</div>
                    <div className="text-xs text-fg-muted">{u.email}</div>
                  </div>
                  <span className="text-xs text-fg-muted">{u.role}{!u.isActive && ' · inactive'}</span>
                </div>
              ))}
            </Card>
          </section>
        </div>
      )}
    </Modal>
  );
}

export function PlatformAdminPage() {
  const { data: orgs, isLoading } = usePlatformOrgs();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const { logout, user } = useAuth();

  const columns: Column<PlatformOrgSummary>[] = [
    {
      key: 'org',
      header: 'Organization',
      cell: org => (
        <>
          <div className="font-medium text-fg truncate max-w-[220px]" title={org.branding?.companyName || org.name}>
            {org.branding?.companyName || org.name}
          </div>
          <div className="text-xs text-fg-muted font-mono truncate max-w-[220px]" title={org.slug}>{org.slug}</div>
        </>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      cell: org => (
        <div className="flex items-center gap-1 flex-wrap">
          <Badge variant={PLAN_BADGE[org.subscription?.plan ?? org.plan] ?? 'gray'}>{org.subscription?.plan ?? org.plan}</Badge>
          {org.subscription?.status && org.subscription.status !== 'active' && (
            <Badge variant="yellow">{org.subscription.status}</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'users',
      header: 'Users',
      cell: org => (
        <span className="inline-flex items-center gap-1 text-fg tabular-nums">
          <UsersIcon size={13} className="text-fg-subtle" />{org.counts.users}
        </span>
      ),
    },
    {
      key: 'email',
      header: 'Email sending',
      hideBelow: 'md',
      cell: org => <ConnectionBadge connected={org.emailSending.connected} label={org.emailSending.connected ? 'Connected' : 'Platform fallback'} />,
    },
    {
      key: 'whatsapp',
      header: 'WhatsApp sending',
      hideBelow: 'lg',
      cell: org => org.whatsappSending.connected
        ? <ConnectionBadge connected label={org.whatsappSending.phoneNumber ?? 'Connected'} />
        : <ConnectionBadge connected={false} label="Not connected" />,
    },
    {
      key: 'storage',
      header: 'Attachment storage',
      hideBelow: 'md',
      cell: org => (
        <StorageBadge
          provider={org.storageLicense.provider}
          quotaBytes={org.storageLicense.quotaBytes}
          usedBytes={org.storageLicense.usedBytes}
          connectedEmail={org.storageLicense.connectedEmail}
        />
      ),
    },
    { key: 'sent', header: 'Sent via us', hideBelow: 'lg', cell: org => <PlatformSendBadge sendCounts={org.sendCounts} /> },
    {
      key: 'created',
      header: 'Created',
      muted: true,
      hideBelow: 'lg',
      cell: org => <span className="tabular-nums">{new Date(org.createdAt).toLocaleDateString()}</span>,
    },
  ];

  return (
    <div className="min-h-screen bg-canvas">
      <PageHeader
        title="Platform Admin"
        subtitle={`${user?.email} · cross-org license & sending overview`}
        actions={
          <>
            <Button variant="ghost" icon={<Tags size={14} />} onClick={() => setPricingOpen(true)}>
              Pricing
            </Button>
            <Button variant="ghost" icon={<SettingsIcon size={14} />} onClick={() => setSettingsOpen(true)}>
              Platform settings
            </Button>
            <Button variant="ghost" icon={<LogOut size={14} />} onClick={logout}>
              Sign out
            </Button>
          </>
        }
      />

      <PageBody>
        {isLoading ? (
          <div className="space-y-4" aria-hidden="true">
            <SkeletonStats count={4} />
            <SkeletonTable rows={6} />
          </div>
        ) : (
          <>
            {!!orgs?.length && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-in">
                <StatTile
                  icon={<Building2 size={16} />}
                  label="Organizations"
                  value={<span className="tabular-nums">{orgs.length}</span>}
                />
                <StatTile
                  icon={<UsersIcon size={16} />}
                  label="Total users"
                  value={<span className="tabular-nums">{orgs.reduce((n, o) => n + o.counts.users, 0)}</span>}
                />
                <StatTile
                  icon={<Mail size={16} />}
                  label="Own email connected"
                  value={<span className="tabular-nums">{orgs.filter(o => o.emailSending.connected).length} / {orgs.length}</span>}
                />
                <StatTile
                  icon={<HardDrive size={16} />}
                  label="Hosted storage used"
                  value={<span className="tabular-nums">{gbLabel(orgs.reduce((n, o) => n + o.storageLicense.usedBytes, 0))}</span>}
                />
              </div>
            )}
            <Card padding="none" className="animate-fade-in">
              <DataTable
                columns={columns}
                rows={orgs ?? []}
                rowKey={org => org.id}
                minWidth={900}
                onRowClick={org => setSelectedId(org.id)}
                empty={
                  <EmptyState
                    icon={<Building2 />}
                    title="No organizations yet"
                    description="Organizations appear here as soon as a customer signs up. Configure the platform sending and storage fallbacks so their first send works."
                    action={{ label: 'Platform settings', onClick: () => setSettingsOpen(true) }}
                  />
                }
              />
            </Card>
          </>
        )}
      </PageBody>

      {selectedId && <OrgDetailPanel key={selectedId} orgId={selectedId} onClose={() => setSelectedId(null)} />}
      {settingsOpen && <PlatformSettingsPanel onClose={() => setSettingsOpen(false)} />}
      {pricingOpen && <PricingPanel onClose={() => setPricingOpen(false)} />}
    </div>
  );
}

// ─── Pricing panel ───────────────────────────────────────────────────────────
//
// The platform operator decides what every plan and custom-licence module
// costs. A customer org's SUPER_ADMIN only ever buys at these prices.

const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

type PricingForm = {
  baseSeatPrice: string;       // dollars
  proPrice: string;            // dollars / month
  enterprisePrice: string;     // dollars / month
  customStorageGb: string;
  yearlyMonthsCharged: string;
  gracePeriodDays: string;
  minSeats: string;
  maxSeats: string;
  tiers: { minSeats: string; discountPct: string }[];
  modules: { key: string; name: string; description: string; price: string; enabled: boolean }[];
};

function toForm(cfg: PricingConfig): PricingForm {
  return {
    baseSeatPrice: (cfg.baseSeatPriceCents / 100).toString(),
    proPrice: String(cfg.planPrices.PRO),
    enterprisePrice: String(cfg.planPrices.ENTERPRISE),
    customStorageGb: String(cfg.customStorageGb),
    yearlyMonthsCharged: String(cfg.yearlyMonthsCharged),
    gracePeriodDays: String(cfg.gracePeriodDays),
    minSeats: String(cfg.minSeats),
    maxSeats: String(cfg.maxSeats),
    tiers: [...cfg.volumeTiers].sort((a, b) => a.minSeats - b.minSeats).map(t => ({ minSeats: String(t.minSeats), discountPct: String(t.discountPct) })),
    modules: cfg.modules.map(m => ({ key: m.key, name: m.name, description: m.description, price: (m.pricePerSeatCents / 100).toString(), enabled: m.enabled })),
  };
}

const toCents = (dollars: string) => Math.round((Number(dollars) || 0) * 100);

function PricingPanel({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = usePlatformPricing();
  const save = useUpdatePlatformPricing();
  const reset = useResetPlatformPricing();
  const [form, setForm] = useState<PricingForm | null>(null);

  useEffect(() => { if (data) setForm(toForm(data.effective)); }, [data]);

  const setField = (key: keyof Omit<PricingForm, 'tiers' | 'modules'>) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => (f ? { ...f, [key]: e.target.value } : f));
  const setModule = (key: string, patch: Partial<PricingForm['modules'][number]>) =>
    setForm(f => (f ? { ...f, modules: f.modules.map(m => (m.key === key ? { ...m, ...patch } : m)) } : f));
  const setTier = (i: number, patch: Partial<PricingForm['tiers'][number]>) =>
    setForm(f => (f ? { ...f, tiers: f.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) } : f));

  const submit = () => {
    if (!form) return;
    const payload: PricingUpdate = {
      baseSeatPriceCents: toCents(form.baseSeatPrice),
      planPrices: { PRO: Number(form.proPrice) || 0, ENTERPRISE: Number(form.enterprisePrice) || 0 },
      customStorageGb: Math.round(Number(form.customStorageGb) || 0),
      yearlyMonthsCharged: Number(form.yearlyMonthsCharged) || 12,
      gracePeriodDays: Math.round(Number(form.gracePeriodDays) || 0),
      minSeats: Math.max(1, Math.round(Number(form.minSeats) || 1)),
      maxSeats: Math.max(1, Math.round(Number(form.maxSeats) || 1)),
      volumeTiers: form.tiers
        .map(t => ({ minSeats: Math.round(Number(t.minSeats) || 0), discountPct: Number(t.discountPct) || 0 }))
        .filter(t => t.minSeats >= 1),
      modules: form.modules.map(m => ({ key: m.key, name: m.name.trim() || undefined, description: m.description, pricePerSeatCents: toCents(m.price), enabled: m.enabled })),
    };
    save.mutate(payload);
  };

  // Worked example so a price change is immediately legible: 10 seats, monthly, every enabled module.
  const example = (() => {
    if (!form) return null;
    const seats = 10;
    const perSeat = toCents(form.baseSeatPrice) + form.modules.filter(m => m.enabled).reduce((s, m) => s + toCents(m.price), 0);
    return { seats, perSeat, monthly: perSeat * seats, yearly: Math.round(perSeat * (Number(form.yearlyMonthsCharged) || 12)) * seats };
  })();

  return (
    <Modal
      open
      onClose={onClose}
      title="Licence pricing"
      subtitle="What every plan and custom-licence module costs. Applies to all organisations the moment you save — customer admins buy at these prices and never see this screen."
      icon={<Tags size={16} />}
      size="xl"
      footer={
        data && form ? (
          <>
            <span className="mr-auto text-xs text-fg-subtle">
              {data.hasOverride && data.updatedAt ? `Custom pricing · last saved ${new Date(data.updatedAt).toLocaleString()}` : 'Using code / env defaults'}
            </span>
            {data.hasOverride && (
              <Button variant="ghost" icon={<RotateCcw size={14} />} loading={reset.isPending} onClick={() => reset.mutate()}>
                Reset to defaults
              </Button>
            )}
            <Button icon={<Check size={14} />} loading={save.isPending} onClick={submit}>
              Save pricing
            </Button>
          </>
        ) : undefined
      }
    >
      {isLoading || !data || !form ? (
        <div className="space-y-4" aria-hidden="true"><SkeletonCard lines={5} /><SkeletonCard lines={6} /></div>
      ) : (
        <div className="space-y-6">
          <section>
            <PanelHeading>Fixed plans (flat monthly price)</PanelHeading>
            <Card tone="sunken" padding="sm" flat className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Pro — $ / month" hint={`Default $${data.defaults.planPrices.PRO} · 25 billable seats`}>
                <Input type="number" min={0} step="1" value={form.proPrice} onChange={setField('proPrice')} />
              </Field>
              <Field label="Enterprise — $ / month" hint={`Default $${data.defaults.planPrices.ENTERPRISE} · unlimited seats`}>
                <Input type="number" min={0} step="1" value={form.enterprisePrice} onChange={setField('enterprisePrice')} />
              </Field>
            </Card>
            <p className="text-[11.5px] text-fg-subtle mt-2">If <code>STRIPE_PRO_PRICE_ID</code> / <code>STRIPE_ENTERPRISE_PRICE_ID</code> are set, Stripe's own monthly Price wins for monthly checkouts — keep them in sync or leave those env vars empty so these numbers are used everywhere.</p>
          </section>

          <section>
            <PanelHeading>Custom licence — per seat / month</PanelHeading>
            <Card tone="sunken" padding="sm" flat className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Platform base — $ / seat / month" hint={`Default ${usd(data.defaults.baseSeatPriceCents)}. Always charged; covers CRM + IT Desk core.`}>
                  <Input type="number" min={0} step="0.5" value={form.baseSeatPrice} onChange={setField('baseSeatPrice')} />
                </Field>
                <Field label="Min seats"><Input type="number" min={1} value={form.minSeats} onChange={setField('minSeats')} /></Field>
                <Field label="Max seats"><Input type="number" min={1} value={form.maxSeats} onChange={setField('maxSeats')} /></Field>
              </div>

              <div className="border-t border-line pt-3">
                <p className="text-[11.5px] font-medium text-fg-muted mb-2">Module add-ons — $ / seat / month. Switch a module off to stop selling it (orgs that already have it keep it).</p>
                <div className="space-y-2">
                  {form.modules.map(m => (
                    <div key={m.key} className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_110px_auto] gap-2 items-center" data-testid={`pricing-module-${m.key}`}>
                      <Input aria-label={`${m.key} name`} value={m.name} onChange={e => setModule(m.key, { name: e.target.value })} />
                      <Input aria-label={`${m.key} description`} className="hidden sm:block" value={m.description} onChange={e => setModule(m.key, { description: e.target.value })} />
                      <Input aria-label={`${m.key} price`} type="number" min={0} step="0.5" value={m.price} onChange={e => setModule(m.key, { price: e.target.value })} />
                      <Toggle checked={m.enabled} onChange={v => setModule(m.key, { enabled: v })} label="" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-line pt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Hosted storage module — GB included" hint={`Default ${data.defaults.customStorageGb} GB`}>
                  <Input type="number" min={0} value={form.customStorageGb} onChange={setField('customStorageGb')} />
                </Field>
                <Field label="Yearly billing — months charged" hint={`Default ${data.defaults.yearlyMonthsCharged} (= ${Math.round((12 - data.defaults.yearlyMonthsCharged) / 12 * 100)}% off)`}>
                  <Input type="number" min={1} max={12} step="0.5" value={form.yearlyMonthsCharged} onChange={setField('yearlyMonthsCharged')} />
                </Field>
                <Field label="Payment-failure grace — days" hint={`Default ${data.defaults.gracePeriodDays}. Paid features stay on this long after a failed payment.`}>
                  <Input type="number" min={0} max={365} value={form.gracePeriodDays} onChange={setField('gracePeriodDays')} />
                </Field>
              </div>

              <div className="border-t border-line pt-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11.5px] font-medium text-fg-muted">Volume discounts (applied to the whole custom licence)</p>
                  <Button size="xs" variant="ghost" onClick={() => setForm(f => (f ? { ...f, tiers: [...f.tiers, { minSeats: '', discountPct: '' }] } : f))}>Add tier</Button>
                </div>
                <div className="space-y-2">
                  {form.tiers.length === 0 && <p className="text-[11.5px] text-fg-subtle">No volume discounts.</p>}
                  {form.tiers.map((t, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                      <Input aria-label="Tier minimum seats" type="number" min={1} placeholder="From N seats" value={t.minSeats} onChange={e => setTier(i, { minSeats: e.target.value })} />
                      <Input aria-label="Tier discount percent" type="number" min={0} max={90} placeholder="% off" value={t.discountPct} onChange={e => setTier(i, { discountPct: e.target.value })} />
                      <Button size="xs" variant="ghost" onClick={() => setForm(f => (f ? { ...f, tiers: f.tiers.filter((_, j) => j !== i) } : f))}>Remove</Button>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </section>

          {example && (
            <Alert tone="info" title="Worked example">
              A custom licence with every enabled module for {example.seats} seats: {usd(example.perSeat)}/seat/month → <strong>{usd(example.monthly)}/month</strong>, or <strong>{usd(example.yearly)}/year</strong> billed yearly (before volume discounts).
            </Alert>
          )}
        </div>
      )}
    </Modal>
  );
}
