import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { ShieldCheck, ShieldOff, Copy, CheckCircle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useFormat } from '../hooks/useFormat';
import {
  Alert, Button, Card, FormError, IconButton, Input, Modal, PageBody, PageHeader, SkeletonCard,
} from '../shared/components';

interface TotpStatus { enabled: boolean; setupAt: string | null; }
interface SetupData { secret: string; uri: string; }

/** The numbered step marker used through the setup flow. */
function StepDot({ n }: { n: number }) {
  return (
    <span className="w-6 h-6 shrink-0 bg-accent text-accent-fg rounded-full flex items-center justify-center text-[11px] font-bold">
      {n}
    </span>
  );
}

export default function TwoFactorPage() {
  const { date } = useFormat();
  const qc = useQueryClient();
  const [step, setStep] = useState<'idle' | 'setup' | 'backup'>('idle');
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [token, setToken] = useState('');
  const [disableToken, setDisableToken] = useState('');
  const [showDisable, setShowDisable] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery<TotpStatus>({
    queryKey: ['2fa-status'],
    queryFn: () => api.get('/2fa/status').then(r => r.data),
  });

  const setup = useMutation({
    mutationFn: () => api.post('/2fa/setup').then(r => r.data),
    onSuccess: (data: SetupData) => { setSetupData(data); setStep('setup'); setError(null); },
  });

  const enable = useMutation({
    mutationFn: (t: string) => api.post('/2fa/enable', { token: t }).then(r => r.data),
    onSuccess: (data: { backupCodes: string[] }) => {
      setBackupCodes(data.backupCodes);
      setStep('backup');
      setError(null);
      qc.invalidateQueries({ queryKey: ['2fa-status'] });
    },
    onError: () => setError('Invalid code. Try again.'),
  });

  const disable = useMutation({
    mutationFn: (t: string) => api.post('/2fa/disable', { token: t }).then(r => r.data),
    onSuccess: () => {
      setShowDisable(false);
      setDisableToken('');
      setError(null);
      qc.invalidateQueries({ queryKey: ['2fa-status'] });
    },
    onError: () => setError('Invalid code. Try again.'),
  });

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  function closeDisable() {
    setShowDisable(false);
    setError(null);
  }

  if (isLoading) {
    return (
      <div>
        <PageHeader
          title="Two-factor authentication"
          subtitle="Protect your account with an authenticator app"
        />
        <PageBody width="narrow">
          <SkeletonCard lines={3} />
        </PageBody>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Two-factor authentication"
        subtitle="Protect your account with an authenticator app"
      />

      <PageBody width="narrow">
      {/* Status card */}
      <Alert
        tone={status?.enabled ? 'success' : 'neutral'}
        icon={status?.enabled ? <ShieldCheck size={17} /> : <ShieldOff size={17} />}
        title={`2FA is ${status?.enabled ? 'enabled' : 'disabled'}`}
        actions={
          status?.enabled ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setShowDisable(true); setError(null); }}
            >
              Disable 2FA
            </Button>
          ) : (
            <Button
              size="sm"
              loading={setup.isPending}
              disabled={setup.isPending || step !== 'idle'}
              onClick={() => setup.mutate()}
            >
              {setup.isPending ? 'Setting up…' : 'Enable 2FA'}
            </Button>
          )
        }
      >
        {status?.enabled
          ? (status.setupAt ? `Enabled ${date(status.setupAt)}` : null)
          : 'Your account is not protected with 2FA'}
      </Alert>

      {/* Setup flow */}
      {step === 'setup' && setupData && (
        <Card padding="lg" className="space-y-5 animate-slide-up">
          <div className="flex items-center gap-2.5">
            <StepDot n={1} />
            <p className="text-[13.5px] font-medium text-fg">Scan with your authenticator app</p>
          </div>

          {/* Rendered locally, on purpose.
              This previously pointed at https://api.qrserver.com with the full
              otpauth:// URI in the query string — which handed a third party
              the raw TOTP shared secret, the account email and the issuer, in a
              URL that lands in their access logs. Anyone holding that secret can
              mint valid 2FA codes forever, so it defeats the point of enabling
              2FA at all. It also meant the QR silently failed to render on an
              air-gapped or egress-restricted deployment.
              qrcode.react does the encoding in the browser; the secret never
              leaves the device. */}
          <div className="flex justify-center">
            {/* Deliberately white in every theme — a QR code needs a light quiet zone to scan. */}
            <div className="bg-white border border-line rounded-card p-3 shadow-ui-sm">
              <QRCodeSVG
                value={setupData.uri}
                size={192}
                level="M"
                marginSize={0}
                bgColor="#ffffff"
                fgColor="#0f172a"
                title="Two-factor authentication setup QR code"
              />
            </div>
          </div>

          <div>
            <p className="text-[13px] text-fg-muted mb-2">Or enter the code manually:</p>
            <div className="flex items-center gap-2 bg-surface-sunken border border-line-subtle rounded-card px-3 py-2">
              <code className="flex-1 text-[13px] font-mono text-fg tracking-widest break-all">
                {setupData.secret}
              </code>
              <IconButton
                label={copied === 'secret' ? 'Copied' : 'Copy secret'}
                icon={copied === 'secret'
                  ? <CheckCircle size={14} className="text-success" />
                  : <Copy size={14} />}
                onClick={() => copyText(setupData.secret, 'secret')}
              />
            </div>
          </div>

          <div className="border-t border-line-subtle pt-5">
            <div className="flex items-center gap-2.5 mb-3">
              <StepDot n={2} />
              <p className="text-[13.5px] font-medium text-fg">Enter the 6-digit code</p>
            </div>
            <Input
              className="text-center text-2xl font-mono tracking-[0.5em]"
              placeholder="000000"
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
              invalid={!!error}
              value={token}
              onChange={e => setToken(e.target.value.replace(/\D/g, ''))}
            />
            {error && <FormError className="mt-2">{error}</FormError>}
            <Button
              className="mt-3"
              block
              loading={enable.isPending}
              disabled={token.length !== 6 || enable.isPending}
              onClick={() => enable.mutate(token)}
            >
              {enable.isPending ? 'Verifying…' : 'Verify & enable'}
            </Button>
          </div>
        </Card>
      )}

      {/* Backup codes */}
      {step === 'backup' && backupCodes.length > 0 && (
        <Card padding="lg" className="animate-slide-up">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={19} className="text-success shrink-0" />
            <h3 className="text-[14px] font-semibold text-fg tracking-tight">
              2FA enabled — save your backup codes
            </h3>
          </div>
          <p className="text-[13px] text-fg-muted leading-relaxed mb-4">
            Store these codes somewhere safe. Each can be used once if you lose access to your authenticator.
          </p>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {backupCodes.map((code, i) => (
              <div
                key={i}
                className="bg-surface-sunken border border-line-subtle rounded-card px-3 py-2 font-mono text-[13px] text-center text-fg"
              >
                {code}
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Button
              variant="secondary"
              block
              icon={copied === 'backup'
                ? <CheckCircle size={14} className="text-success" />
                : <Copy size={14} />}
              onClick={() => copyText(backupCodes.join('\n'), 'backup')}
            >
              {copied === 'backup' ? 'Copied!' : 'Copy all codes'}
            </Button>
            <Button variant="ghost" block onClick={() => setStep('idle')}>
              Done
            </Button>
          </div>
        </Card>
      )}

      {/* Disable modal */}
      <Modal
        open={showDisable}
        onClose={closeDisable}
        title="Disable 2FA"
        subtitle="Enter your authenticator code to confirm."
        icon={<ShieldOff size={17} />}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={closeDisable}>Cancel</Button>
            <Button
              variant="danger"
              loading={disable.isPending}
              disabled={disableToken.length !== 6 || disable.isPending}
              onClick={() => disable.mutate(disableToken)}
            >
              {disable.isPending ? 'Disabling…' : 'Disable'}
            </Button>
          </>
        }
      >
        <Input
          className="text-center text-2xl font-mono tracking-[0.5em]"
          placeholder="000000"
          maxLength={6}
          inputMode="numeric"
          autoComplete="one-time-code"
          invalid={!!error}
          value={disableToken}
          onChange={e => setDisableToken(e.target.value.replace(/\D/g, ''))}
        />
        {error && <FormError className="mt-2">{error}</FormError>}
      </Modal>
      </PageBody>
    </div>
  );
}
