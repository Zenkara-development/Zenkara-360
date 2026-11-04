import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, AlertCircle, Database } from 'lucide-react';
import { Alert, Button, Input, Select, Field, FormError } from '../../shared/components';
import {
  useS3Presets, useTestCustomS3, useConnectCustomS3,
  type CustomS3Input, type S3Preset,
} from '../../api/storage';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../../shared/permissions';

/**
 * Connect a bucket the customer owns.
 *
 * "S3-compatible" is one protocol with many vendors behind it — AWS S3,
 * Cloudflare R2, Wasabi, Backblaze B2, DigitalOcean Spaces, MinIO — so this
 * one form covers all of them. What differs between them is only the endpoint
 * URL and whether the region matters, which is what the preset list encodes.
 * Picking "Cloudflare R2" and typing an account ID should not require knowing
 * that the endpoint is `https://<id>.r2.cloudflarestorage.com`.
 *
 * The connection is round-tripped (write, read, delete) before anything is
 * saved. A bucket that accepts writes but refuses deletes looks perfect at
 * connect time and fails weeks later, by which point nobody links the two.
 */

interface Props {
  /** True when this org already stores files somewhere — changes the copy. */
  switching: boolean;
  onConnected: (message: string) => void;
}

const EMPTY: CustomS3Input = {
  label: '', bucket: '', region: '', endpoint: '',
  accessKeyId: '', secretAccessKey: '', prefix: '',
};

export function CustomS3Form({ switching, onConnected }: Props) {
  // GET /storage/s3/presets is SUPER_ADMIN-only, same as the connect endpoints
  // this form posts to. StoragePage only renders the form for the owner, but the
  // capability travels with the query so the component is safe wherever it lands.
  const { user } = useAuth();
  const { data: presetData } = useS3Presets(can.manageStorage(user?.role));
  const presets = presetData?.presets ?? [];

  const [presetId, setPresetId] = useState('AWS_S3');
  const [accountId, setAccountId] = useState('');   // R2 only
  const [form, setForm] = useState<CustomS3Input>(EMPTY);
  const [manualEndpoint, setManualEndpoint] = useState(false);
  const [error, setError] = useState('');

  const test = useTestCustomS3();
  const connect = useConnectCustomS3();

  const preset: S3Preset | undefined = useMemo(
    () => presets.find(p => p.id === presetId),
    [presets, presetId],
  );

  // Region defaults follow the preset, but only until the user types their
  // own — overwriting a region someone deliberately entered because they
  // changed vendor in the dropdown would be worse than a stale default.
  const [regionTouched, setRegionTouched] = useState(false);
  useEffect(() => {
    if (preset && !regionTouched) setForm(f => ({ ...f, region: preset.defaultRegion }));
  }, [preset, regionTouched]);

  /** The endpoint we will actually send — derived unless the user overrode it. */
  const endpoint = useMemo(() => {
    if (manualEndpoint || !preset?.endpointTemplate) return form.endpoint ?? '';
    return preset.endpointTemplate
      .replace('{accountId}', accountId.trim())
      .replace('{region}', (form.region || preset.defaultRegion).trim());
  }, [manualEndpoint, preset, accountId, form.endpoint, form.region]);

  const needsAccountId = !manualEndpoint && preset?.endpointTemplate?.includes('{accountId}');
  const needsManualEndpoint = manualEndpoint || (preset && !preset.endpointTemplate && preset.id !== 'AWS_S3');

  const payload: CustomS3Input = {
    ...form,
    label: form.label || preset?.label,
    endpoint: endpoint || undefined,
    region: form.region || preset?.defaultRegion,
    forcePathStyle: preset?.forcePathStyle,
  };

  const complete = !!(payload.bucket && payload.accessKeyId && payload.secretAccessKey
    && (!needsAccountId || accountId.trim())
    && (!needsManualEndpoint || endpoint));

  function set<K extends keyof CustomS3Input>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      if (key === 'region') setRegionTouched(true);
      setForm(f => ({ ...f, [key]: e.target.value }));
    };
  }

  // Any edit invalidates a previous green tick — otherwise someone tests, then
  // changes the bucket, and connects on the strength of a stale pass.
  useEffect(() => { test.reset(); }, [form, accountId, presetId, manualEndpoint]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const res = await connect.mutateAsync(payload);
      onConnected(res.message ?? 'Storage connected.');
      setForm(EMPTY);
      setAccountId('');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not connect that bucket.');
    }
  }

  const result = test.data;

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-fg-muted leading-relaxed">
        Your bucket, your region, your retention rules — and your bill. We store only the
        access keys, encrypted. {switching && 'Files already uploaded elsewhere stay where they are.'}
      </p>

      <div className="form-section">
        <p className="form-section-title">Service &amp; bucket</p>
        <div className="space-y-3">
          <Field label="Service" hint={preset?.help}>
            <Select
              value={presetId}
              onChange={e => { setPresetId(e.target.value); setManualEndpoint(false); setRegionTouched(false); }}
              options={presets.map(p => ({ value: p.id, label: p.label }))}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Bucket name">
              <Input value={form.bucket} onChange={set('bucket')} placeholder="acme-crm-attachments" autoComplete="off" />
            </Field>
            <Field label={preset?.regionRequired ? 'Region' : 'Region (optional)'}>
              <Input value={form.region} onChange={set('region')} placeholder={preset?.defaultRegion} autoComplete="off" />
            </Field>
          </div>

          {needsAccountId && (
            <Field label="Cloudflare account ID">
              <Input value={accountId} onChange={e => setAccountId(e.target.value)} placeholder="a1b2c3d4e5f6…" autoComplete="off" />
            </Field>
          )}

          {needsManualEndpoint && (
            <Field label="Endpoint URL">
              <Input
                value={form.endpoint}
                onChange={set('endpoint')}
                placeholder="https://s3.example.com:9000"
                autoComplete="off"
                className="font-mono"
              />
            </Field>
          )}

          {!needsManualEndpoint && endpoint && (
            <p className="text-[11px] text-fg-subtle min-w-0">
              Endpoint: <code className="text-fg-muted font-mono" title={endpoint}>{endpoint}</code>
              {' · '}
              <button type="button" className="underline hover:text-fg transition-colors" onClick={() => { setManualEndpoint(true); setForm(f => ({ ...f, endpoint })); }}>
                enter manually
              </button>
            </p>
          )}
        </div>
      </div>

      <div className="form-section">
        <p className="form-section-title">Credentials</p>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Access key ID">
              <Input value={form.accessKeyId} onChange={set('accessKeyId')} autoComplete="off" spellCheck={false} className="font-mono" />
            </Field>
            <Field label="Secret access key">
              <Input type="password" value={form.secretAccessKey} onChange={set('secretAccessKey')} autoComplete="new-password" />
            </Field>
          </div>

          <details className="text-[11px] text-fg-subtle">
            <summary className="cursor-pointer hover:text-fg-muted transition-colors">Permissions this key needs</summary>
            <p className="mt-1.5 leading-relaxed">
              <code>s3:PutObject</code>, <code>s3:GetObject</code> and <code>s3:DeleteObject</code> on
              this bucket. Nothing else — no listing, no bucket administration. Delete is required so
              removing an attachment in CRMITdesk actually removes the file rather than leaving it to
              accrue storage cost.
            </p>
          </details>
        </div>
      </div>

      <div className="form-section">
        <p className="form-section-title">Options</p>
        <Field label="Folder prefix (optional)" hint="Store everything under a folder inside the bucket, e.g. crm/">
          <Input value={form.prefix} onChange={set('prefix')} placeholder="crm/" autoComplete="off" className="font-mono" />
        </Field>
      </div>

      <FormError>{error}</FormError>

      {result && (
        <Alert
          tone={result.ok ? 'success' : 'danger'}
          icon={result.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          className="animate-fade-in"
        >
          {result.ok
            ? 'Wrote, read back and deleted a test file successfully.'
            : <>Failed on <strong>{result.step}</strong>. {result.error}</>}
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-[11px] text-fg-subtle mr-auto">
          Connecting tests the bucket first — it is never saved untested.
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!complete || test.isPending}
          loading={test.isPending}
          icon={<Database size={13} />}
          onClick={() => test.mutate(payload)}
        >
          {test.isPending ? 'Testing…' : 'Test connection'}
        </Button>
        <Button type="submit" size="sm" disabled={!complete} loading={connect.isPending}>
          {switching ? 'Switch to this bucket' : 'Connect bucket'}
        </Button>
      </div>
    </form>
  );
}
