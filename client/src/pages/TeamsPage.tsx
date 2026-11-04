import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Trash2, Send, MessageSquare } from 'lucide-react';
import {
  PageBody, Card, Field, Input, Checkbox, Button, Badge, Alert, SkeletonCard,
} from '../shared/components';

/**
 * Microsoft Teams brand purple.
 *
 * Third-party brand marks are deliberately exempt from the design-token
 * system: the Teams tile and its primary connect button have to read as Teams
 * whichever theme the customer picks, so these stay literal hexes rather than
 * becoming `bg-accent`.
 */
const TEAMS_BRAND = {
  tile: 'bg-[#464eb8]',
  solid: 'bg-[#464eb8] hover:bg-[#3d44a0] text-white',
  /** `#8b91d6` is the lightened mark used where the purple sits on a dark surface. */
  outline: 'border-[#464eb8] text-[#464eb8] dark:text-[#8b91d6]',
};

interface TeamsConfig {
  id?: string;
  webhookUrl: string;
  notifyOnNewTicket: boolean;
  notifyOnDealWon: boolean;
  notifyOnNewLead: boolean;
}

const DEFAULT: TeamsConfig = {
  webhookUrl: '',
  notifyOnNewTicket: true,
  notifyOnDealWon: false,
  notifyOnNewLead: false,
};

const NOTIFY_OPTIONS = [
  { key: 'notifyOnNewTicket', label: 'New support tickets' },
  { key: 'notifyOnDealWon',   label: 'Deals marked as Won' },
  { key: 'notifyOnNewLead',   label: 'New leads created' },
] as const;

export default function TeamsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<TeamsConfig>(DEFAULT);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const { data: config, isLoading } = useQuery<TeamsConfig | null>({
    queryKey: ['teams-config'],
    queryFn: () => api.get('/teams').then(r => r.data).catch(() => null),
  });

  useEffect(() => { if (config) setForm(config); }, [config]);

  const save = useMutation({
    mutationFn: (body: TeamsConfig) => api.post('/teams', body).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams-config'] }),
  });

  const disconnect = useMutation({
    mutationFn: () => api.delete('/teams'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teams-config'] }); setForm(DEFAULT); },
  });

  async function testWebhook() {
    try {
      await api.post('/teams/test');
      setTestResult({ ok: true, msg: 'Test message sent to Teams!' });
    } catch {
      setTestResult({ ok: false, msg: 'Failed to send test message. Check your webhook URL.' });
    }
  }

  const isConnected = !!(config?.webhookUrl);

  if (isLoading) {
    return (
      <PageBody width="narrow">
        <div className="flex items-center gap-3" aria-hidden="true">
          <div className="skeleton w-10 h-10 rounded-card shrink-0" />
          <div className="space-y-2">
            <div className="skeleton h-4 w-44" />
            <div className="skeleton h-3 w-64" />
          </div>
        </div>
        <SkeletonCard lines={4} />
        <SkeletonCard lines={3} />
      </PageBody>
    );
  }

  return (
    <PageBody width="narrow">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-card flex items-center justify-center shrink-0 ${TEAMS_BRAND.tile}`}>
          <MessageSquare size={20} className="text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-[18px] font-semibold text-fg leading-tight tracking-tight">Microsoft Teams</h1>
          <p className="text-[13px] text-fg-muted mt-0.5">Send automated alerts to a Teams channel via Incoming Webhook</p>
        </div>
        {isConnected && <Badge variant="green" dot className="ml-auto">Connected</Badge>}
      </div>

      <Alert tone="info" title="Setup instructions" icon={null}>
        <ol className="list-decimal list-inside space-y-1">
          <li>In Teams, go to the channel &rarr; More options &rarr; Connectors</li>
          <li>Find <strong>Incoming Webhook</strong> and click Configure</li>
          <li>Give it a name, optionally upload an icon, and click Create</li>
          <li>Copy the webhook URL and paste it below</li>
        </ol>
      </Alert>

      <Card className="space-y-5">
        <Field label="Webhook URL">
          <Input
            aria-label="Webhook URL"
            placeholder="https://outlook.office.com/webhook/..."
            value={form.webhookUrl}
            onChange={e => setForm(f => ({ ...f, webhookUrl: e.target.value }))}
          />
        </Field>

        <div>
          <p className="text-[13px] font-medium text-fg mb-2">Send notifications for</p>
          <div className="space-y-2">
            {NOTIFY_OPTIONS.map(({ key, label }) => (
              <Checkbox
                key={key}
                label={label}
                checked={(form as any)[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
              />
            ))}
          </div>
        </div>

        {testResult && <Alert tone={testResult.ok ? 'success' : 'danger'}>{testResult.msg}</Alert>}

        <div className="flex gap-3 flex-wrap">
          {isConnected && (
            <>
              <Button
                variant="secondary"
                className={TEAMS_BRAND.outline}
                icon={<Send size={14} />}
                onClick={testWebhook}
              >
                Test
              </Button>
              <Button
                variant="danger"
                icon={<Trash2 size={14} />}
                onClick={() => { if (confirm('Disconnect Teams?')) disconnect.mutate(); }}
              >
                Disconnect
              </Button>
            </>
          )}
          {/* Brand-coloured primary: this is the "connect to Teams" action. */}
          <Button
            className={`ml-auto ${TEAMS_BRAND.solid}`}
            disabled={!form.webhookUrl}
            loading={save.isPending}
            onClick={() => save.mutate(form)}
          >
            {save.isPending ? 'Saving…' : isConnected ? 'Save changes' : 'Connect Teams'}
          </Button>
        </div>
      </Card>
    </PageBody>
  );
}
