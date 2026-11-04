import { asset } from '../shared/asset';
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { Alert, Button, Card, Spinner } from '../shared/components';

type Status = 'validating' | 'ready' | 'invalid' | 'approved' | 'rejected' | 'already-decided';

interface RequestInfo {
  organizationName: string;
  name: string;
  email: string;
  status: string;
  createdAt: string;
}

const outcomeTones = {
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  neutral: 'bg-surface-sunken text-fg-subtle',
} as const;

/** Terminal state panel — one shape for all five outcomes this page can land on. */
function Outcome({
  tone, icon, title, children, action,
}: {
  tone: keyof typeof outcomeTones;
  icon: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <span className={`w-12 h-12 rounded-full flex items-center justify-center ${outcomeTones[tone]}`}>
        {icon}
      </span>
      <h2 className="font-semibold text-fg tracking-tight">{title}</h2>
      {children && (
        <p className="text-[13px] text-fg-muted leading-relaxed max-w-[320px]">{children}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** One label/value row in the request summary. */
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-fg-muted shrink-0">{label}</span>
      <span
        className="font-medium text-fg text-right min-w-0 truncate"
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Public, token-secured page opened from the "New Organization Signup
 * Request" email — lets the reviewer see who's asking before deciding.
 * Nothing here requires being logged into the app; the random token in the
 * URL is what gates it, same as /accept-invite.
 */
export function OrgApprovalPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();

  const [status, setStatus] = useState<Status>('validating');
  const [info, setInfo] = useState<RequestInfo | null>(null);
  const [error, setError] = useState('');
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    if (!token) { setStatus('invalid'); return; }
    api.get(`/auth/org-signup-info?token=${token}`)
      .then(r => {
        setInfo(r.data);
        if (r.data.status !== 'PENDING') setStatus('already-decided');
        else setStatus('ready');
      })
      .catch(() => setStatus('invalid'));
  }, [token]);

  async function decide(action: 'approve' | 'reject') {
    setDeciding(true);
    setError('');
    try {
      await api.post('/auth/approve-org-signup', { token, action });
      setStatus(action === 'approve' ? 'approved' : 'rejected');
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.response?.data?.error || 'Something went wrong.');
    } finally {
      setDeciding(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
      <Card padding="lg" className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-7">
          <img src={asset("logo.svg")} alt="" className="w-9 h-9" />
          <h1 className="text-xl font-semibold text-fg tracking-tight">CRM &amp; IT Desk</h1>
        </div>

        {status === 'validating' && <Spinner label="Loading request…" compact />}

        {status === 'invalid' && (
          <Outcome tone="danger" icon={<AlertCircle size={26} />} title="Request not found">
            This link is invalid.
          </Outcome>
        )}

        {status === 'already-decided' && (
          <Outcome tone="warning" icon={<AlertCircle size={26} />} title={`Already ${info?.status.toLowerCase()}`}>
            This request was already decided — no action needed.
          </Outcome>
        )}

        {status === 'approved' && (
          <Outcome
            tone="success"
            icon={<CheckCircle size={26} />}
            title="Approved"
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate('/login')}>
                Go to sign in
              </Button>
            }
          >
            <span className="font-medium text-fg">{info?.organizationName}</span> has been created.
            {info?.email && ` ${info.email} has been notified and can now log in.`}
          </Outcome>
        )}

        {status === 'rejected' && (
          <Outcome tone="neutral" icon={<XCircle size={26} />} title="Request rejected">
            No org or user was created.
          </Outcome>
        )}

        {status === 'ready' && info && (
          <>
            <div className="mb-6 text-center">
              <h2 className="text-lg font-semibold text-fg tracking-tight">New signup request</h2>
              <p className="text-[13px] text-fg-muted mt-1">Review before anything is created</p>
            </div>

            <Card tone="sunken" flat padding="md" className="space-y-2.5 mb-6 text-[13px]">
              <DetailRow label="Organization" value={info.organizationName} />
              <DetailRow label="Requested by" value={info.name} />
              <DetailRow label="Email" value={info.email} />
              <DetailRow label="Submitted" value={new Date(info.createdAt).toLocaleString()} />
            </Card>

            {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

            <div className="flex gap-3">
              <Button
                variant="secondary"
                block
                onClick={() => decide('reject')}
                disabled={deciding}
              >
                Reject
              </Button>
              <Button
                block
                loading={deciding}
                onClick={() => decide('approve')}
              >
                {deciding ? 'Approving…' : 'Approve'}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
