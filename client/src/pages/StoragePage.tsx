import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, ExternalLink, Unplug, Cloud, ArrowRightLeft, Database } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useStorageStatus, useStorageUsage, useConnectGoogleDrive, useConnectHostedStorage, useDisconnectStorage } from '../api/storage';
import { Alert, Badge, Button, Card, PageBody, PageHeader, SkeletonCard } from '../shared/components';
import { addToast } from '../shared/components/toastStore';
import { CustomS3Form } from './storage/CustomS3Form';
import { can } from '../shared/permissions';

function formatGB(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(bytes > 0 && bytes < 1024 * 1024 * 1024 ? 2 : 0);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const ENTITY_LABELS: Record<string, string> = {
  TICKET: 'Tickets', CONTACT: 'Contacts', DEAL: 'Deals', LEAD: 'Leads', ACCOUNT: 'Accounts',
  CHANGE_REQUEST: 'Change requests', QUOTE: 'Quotes', ASSET: 'Assets', CAMPAIGN: 'Campaigns',
  EMPLOYEE: 'Employees', TASK: 'Tasks', APPROVAL_REQUEST: 'Approvals', DEPARTMENT: 'Departments', INVOICE: 'Invoices',
};
const PROVIDER_LABELS: Record<string, string> = {
  HOSTED_S3: 'Hosted storage (counts toward quota)', GOOGLE_DRIVE: 'Your Google Drive', CUSTOM_S3: 'Your S3 bucket',
};

/**
 * The storage calculator: what the org's files actually occupy, split by
 * record type and by provider, with quota headroom and a "roughly N more
 * typical files fit" projection based on this org's own average file size.
 */
function StorageCalculator() {
  const { data: usage } = useStorageUsage();
  if (!usage) return null;

  const pct = usage.quotaBytes > 0 ? Math.min(100, (usage.hostedUsedBytes / usage.quotaBytes) * 100) : 0;
  const barColor = pct > 90 ? 'bg-danger' : pct > 70 ? 'bg-warning' : 'bg-accent';

  return (
    <Card className="mt-4 space-y-4 animate-fade-in">
      <div>
        <h3 className="text-sm font-semibold text-fg flex items-center gap-1.5"><Database size={14} /> Storage calculator</h3>
        <p className="text-xs text-fg-subtle mt-0.5">
          {usage.totalFiles} file{usage.totalFiles === 1 ? '' : 's'} attached across your records · {formatSize(usage.totalBytes)} total
          {usage.avgFileBytes > 0 && <> · average file {formatSize(usage.avgFileBytes)}</>}
        </p>
      </div>

      {usage.quotaBytes > 0 && (
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-fg-muted">Hosted quota</span>
            <span className="text-fg tabular-nums">{formatSize(usage.hostedUsedBytes)} / {formatSize(usage.quotaBytes)}</span>
          </div>
          <div className="h-2 rounded-full bg-surface-sunken overflow-hidden">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-fg-subtle mt-1.5">
            {formatSize(usage.remainingBytes)} remaining
            {usage.estRemainingFiles !== null && <> — room for roughly <strong className="text-fg">{usage.estRemainingFiles.toLocaleString()}</strong> more files of your typical size</>}
            . Files on your own Google Drive or S3 bucket never count toward this quota.
          </p>
        </div>
      )}

      {usage.byEntity.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-1.5">Where the space goes</p>
          <div className="space-y-1">
            {usage.byEntity.map(e => (
              <div key={e.entityType} className="flex items-center justify-between text-xs">
                <span className="text-fg-muted">{ENTITY_LABELS[e.entityType] ?? e.entityType} <span className="text-fg-subtle">· {e.files} file{e.files === 1 ? '' : 's'}</span></span>
                <span className="text-fg tabular-nums">{formatSize(e.bytes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {usage.byProvider.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-1.5">By storage location</p>
          <div className="space-y-1">
            {usage.byProvider.map(p => (
              <div key={p.provider} className="flex items-center justify-between text-xs">
                <span className="text-fg-muted">{PROVIDER_LABELS[p.provider] ?? p.provider}</span>
                <span className="text-fg tabular-nums">{formatSize(p.bytes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-fg-subtle border-t border-line-subtle pt-3">
        Org data: {usage.records.contacts} contacts · {usage.records.tickets} tickets · {usage.records.deals} deals · {usage.records.leads} leads.
        Record data itself lives in the database and does not count toward file storage.
      </p>
    </Card>
  );
}

export default function StoragePage() {
  const { user } = useAuth();
  // Connecting or changing a provider is SUPER_ADMIN-only, matching the guards
  // on /storage/google/connect and /storage/s3/*.
  const isOwner = can.manageStorage(user?.role);
  const [searchParams, setSearchParams] = useSearchParams();
  const [s3Open, setS3Open] = useState(false);
  // GET /storage/status is MANAGERS-only (SUPER_ADMIN, IT_MANAGER,
  // CRM_MANAGER). Anyone else reaches this page — there is no route guard —
  // and used to get a 403, which left `status` undefined and made every card
  // below fall into its `!status?.configured` branch: the page told them Google
  // Drive was "not set up on this deployment (missing GOOGLE_CLIENT_ID/SECRET)"
  // when the real answer was that they were not allowed to ask. Two very
  // different problems that looked identical. Now the answer is known up front,
  // so the explanation renders immediately and no request goes out.
  const canReadStatus = can.readStorage(user?.role);
  const { data: status, isLoading, error, refetch } = useStorageStatus(canReadStatus);
  const forbidden = !canReadStatus || (error as any)?.response?.status === 403;
  const connect = useConnectGoogleDrive();
  const connectHosted = useConnectHostedStorage();
  const disconnect = useDisconnectStorage();
  const hostedQuotaBytes = status?.hosted?.quotaBytes ?? 0;

  // The OAuth callback (storage.controller.ts) redirects the browser straight
  // back to this page with ?connected=1 or ?error=... — surface it once,
  // then strip the query param so a refresh doesn't re-show the same toast.
  useEffect(() => {
    if (searchParams.get('connected')) {
      addToast('Google Drive connected. Attachments will now upload there.', 'success');
      setSearchParams({}, { replace: true });
    } else if (searchParams.get('error')) {
      addToast(`Couldn't connect Google Drive: ${searchParams.get('error')}`, 'error', 10000);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return (
    <div>
      <PageHeader
        title="Storage"
        subtitle="Connect where file attachments on records get uploaded."
      />

      <PageBody width="narrow">
      {isLoading ? (
        <SkeletonCard lines={6} />
      ) : forbidden ? (
        <Alert tone="warning" title="Your role can’t view storage settings">
          Storage is visible to Super Admin, IT Manager and CRM Manager, and only a Super Admin
          can connect or change a provider. You are signed in as <strong>{user?.role?.replace(/_/g, ' ').toLowerCase()}</strong>.
        </Alert>
      ) : error ? (
        <Alert
          tone="danger"
          title="Couldn’t load storage settings"
          actions={<Button size="sm" variant="secondary" onClick={() => refetch()}>Try again</Button>}
        >
          {(error as any)?.response?.data?.error || (error as any)?.message || 'The server did not respond.'}
        </Alert>
      ) : (
        <Card className="space-y-5 animate-fade-in">
          {status?.connected && (
            <div className="space-y-4">
              {status.provider === 'CUSTOM_S3' ? (
                <>
                  <Alert
                    tone="success"
                    icon={<CheckCircle size={16} />}
                    title={`${status.customS3?.label || 'Your own S3 bucket'} connected`}
                  >
                    <span className="block truncate" title={status.customS3?.bucket ?? undefined}>
                      {status.customS3?.bucket}
                      {status.customS3?.prefix ? `/${status.customS3.prefix.replace(/\/$/, '')}` : ''}
                      {status.customS3?.region ? ` · ${status.customS3.region}` : ''}
                    </span>
                  </Alert>
                  <p className="text-[13px] text-fg-muted leading-relaxed">
                    Attachments are written to your own bucket
                    {status.customS3?.endpoint ? <> at <code className="text-xs font-mono">{status.customS3.endpoint}</code></> : ''}.
                    Nothing is stored on our infrastructure, and no plan quota applies.
                  </p>
                </>
              ) : status.provider === 'GOOGLE_DRIVE' ? (
                <>
                  <Alert tone="success" icon={<CheckCircle size={16} />} title="Google Drive connected">
                    {status.connectedEmail}
                  </Alert>
                  <p className="text-[13px] text-fg-muted leading-relaxed">
                    Every attachment uploaded on a record is saved to a "CRMITdesk Evolved Attachments" folder in this Drive account.
                  </p>
                </>
              ) : (
                <>
                  <Alert tone="success" icon={<CheckCircle size={16} />} title="Hosted storage connected">
                    Attachments are stored on our infrastructure.
                  </Alert>
                  <div>
                    <div className="flex justify-between text-[11.5px] text-fg-muted mb-1 tabular-nums">
                      <span>{formatGB(status.hosted?.usedBytes ?? 0)} GB used</span>
                      <span>{formatGB(status.hosted?.quotaBytes ?? 0)} GB quota</span>
                    </div>
                    <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${hostedQuotaBytes > 0 && (status.hosted?.usedBytes ?? 0) / hostedQuotaBytes > 0.9 ? 'bg-danger' : 'bg-accent'}`}
                        style={{ width: `${hostedQuotaBytes > 0 ? Math.min(100, ((status.hosted?.usedBytes ?? 0) / hostedQuotaBytes) * 100) : 100}%` }}
                      />
                    </div>
                  </div>
                </>
              )}
              {isOwner ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    icon={<Unplug size={14} />}
                    loading={disconnect.isPending}
                    onClick={() => {
                      if (confirm('Disconnect storage? Existing attachments already uploaded stay where they are until deleted individually — new uploads will fail until a storage provider is reconnected.')) {
                        disconnect.mutate();
                      }
                    }}
                  >
                    Disconnect
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-fg-subtle">Only the org owner (Super Admin) can change storage settings.</p>
              )}
            </div>
          )}

          {/* Options to connect or switch — shown even when already connected, so switching provider doesn't require disconnecting first */}
          <div className={status?.connected ? 'pt-5 border-t border-line-subtle' : ''}>
            {status?.connected && (
              <p className="text-[11px] font-semibold text-fg-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <ArrowRightLeft size={12} /> Switch provider
              </p>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              {/* Google Drive (bring-your-own) */}
              <Card padding="sm" flat className="!p-4">
                <p className="text-[13px] font-semibold text-fg mb-1">Your own Google Drive</p>
                <p className="text-xs text-fg-muted mb-3 leading-relaxed">Free on every plan — no storage limit from us, since it's your own account.</p>
                {!status?.configured ? (
                  <Alert tone="warning">
                    Not available on this deployment yet — whoever runs this server needs to add Google OAuth credentials (<code>GOOGLE_CLIENT_ID</code> / <code>GOOGLE_CLIENT_SECRET</code>) and restart it.
                  </Alert>
                ) : !isOwner ? (
                  <p className="text-xs text-fg-subtle">Only the org owner can connect this.</p>
                ) : status?.provider === 'GOOGLE_DRIVE' ? (
                  <Badge variant="green" dot>Currently active</Badge>
                ) : (
                  <Button size="sm" icon={<ExternalLink size={13} />} loading={connect.isPending} onClick={() => connect.mutate()}>
                    Connect Google Drive
                  </Button>
                )}
              </Card>

              {/* Bring-your-own S3-compatible bucket. Always offerable — it
                  needs nothing configured on this deployment, no OAuth app and
                  no shared bucket, which makes it the one option that works on
                  every install. */}
              <Card padding="sm" flat className="!p-4 sm:col-span-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-fg mb-1 flex items-center gap-1.5">
                      <Database size={14} className="text-fg-muted" /> Your own S3-compatible storage
                    </p>
                    <p className="text-xs text-fg-muted leading-relaxed">
                      Amazon S3, Cloudflare R2, Wasabi, Backblaze B2, DigitalOcean Spaces or MinIO.
                      Your bucket, your region, your bill.
                    </p>
                  </div>
                  {status?.provider === 'CUSTOM_S3' && (
                    <Badge variant="green" dot className="shrink-0">Currently active</Badge>
                  )}
                </div>

                {!isOwner ? (
                  <p className="text-xs text-fg-subtle mt-3">Only the org owner can connect this.</p>
                ) : !s3Open ? (
                  <Button size="sm" variant="secondary" className="mt-3" icon={<Database size={13} />} onClick={() => setS3Open(true)}>
                    {status?.provider === 'CUSTOM_S3' ? 'Change bucket' : 'Connect a bucket'}
                  </Button>
                ) : (
                  <div className="mt-4 pt-4 border-t border-line-subtle animate-fade-in">
                    <CustomS3Form
                      switching={!!status?.connected}
                      onConnected={(message) => { setS3Open(false); addToast(message, 'success'); }}
                    />
                    <Button variant="ghost" size="xs" className="mt-3" onClick={() => setS3Open(false)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </Card>

              {/* Our hosted storage */}
              <Card padding="sm" flat className="!p-4">
                <p className="text-[13px] font-semibold text-fg mb-1 flex items-center gap-1.5"><Cloud size={14} className="text-fg-muted" /> Our hosted storage</p>
                <p className="text-xs text-fg-muted mb-3 leading-relaxed">
                  {hostedQuotaBytes > 0
                    ? `Included with your plan: ${formatGB(hostedQuotaBytes)}GB, no Google account needed.`
                    : "Not included on your current plan — upgrade to Pro (5GB) or Enterprise (50GB)."}
                </p>
                {!status?.hosted?.available ? (
                  <Alert tone="warning">
                    Not available on this deployment yet — whoever runs this server needs to configure a storage bucket (<code>S3_BUCKET</code> and keys) and restart it.
                  </Alert>
                ) : hostedQuotaBytes === 0 ? (
                  <Link to="/billing" className="text-xs font-medium text-accent hover:underline">Upgrade plan →</Link>
                ) : !isOwner ? (
                  <p className="text-xs text-fg-subtle">Only the org owner can connect this.</p>
                ) : status?.provider === 'HOSTED_S3' ? (
                  <Badge variant="green" dot>Currently active</Badge>
                ) : (
                  <Button size="sm" icon={<Cloud size={13} />} loading={connectHosted.isPending} onClick={() => connectHosted.mutate(undefined, {
                    onSuccess: () => addToast('Hosted storage connected. New attachments will upload here.', 'success'),
                    onError: (err: any) => addToast(err?.response?.data?.error || 'Failed to connect hosted storage', 'error'),
                  })}>
                    Use hosted storage
                  </Button>
                )}
              </Card>
            </div>
          </div>

          {!status?.connected && (
            <p className="text-xs text-fg-subtle">No storage is connected yet — uploading an attachment to any record will show an error until you connect one above.</p>
          )}
        </Card>
      )}

      {/* ── Storage calculator ── */}
      {!isLoading && !forbidden && !error && <StorageCalculator />}
      </PageBody>
    </div>
  );
}
