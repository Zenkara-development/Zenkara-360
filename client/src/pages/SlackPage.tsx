import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Slack, Trash2, Send } from 'lucide-react';
import {
  PageBody, Card, CardHeader, Field, Input, Checkbox,
  Button, Badge, Alert, SkeletonCard,
} from '../shared/components';

/**
 * Slack's brand aubergine.
 *
 * Third-party brand marks are deliberately exempt from the design-token
 * system: a Slack logo tile has to read as Slack whichever theme the customer
 * picks, so this stays a literal hex rather than becoming `bg-accent`.
 */
const SLACK_BRAND_TILE = 'bg-[#4A154B]';

interface SlackConfig {
  id?: string;
  webhookUrl: string;
  channel: string;
  notifyOnNewTicket: boolean;
  notifyOnCritical: boolean;
  notifyOnSlaBreached: boolean;
  notifyOnDealWon: boolean;
  notifyOnNewLead: boolean;
}

const DEFAULT: SlackConfig = {
  webhookUrl: '',
  channel: '#general',
  notifyOnNewTicket: true,
  notifyOnCritical: true,
  notifyOnSlaBreached: true,
  notifyOnDealWon: false,
  notifyOnNewLead: false,
};

const NOTIFY_OPTIONS = [
  { key: 'notifyOnNewTicket',   label: 'New ticket created',      desc: 'Any priority' },
  { key: 'notifyOnCritical',    label: 'Critical ticket created', desc: 'CRITICAL priority only' },
  { key: 'notifyOnSlaBreached', label: 'SLA is breached',         desc: 'Resolution deadline exceeded' },
  { key: 'notifyOnDealWon',     label: 'Deal is marked Won',      desc: 'CRM pipeline update' },
  { key: 'notifyOnNewLead',     label: 'New lead captured',       desc: 'Lead created in CRM' },
] as const;

export default function SlackPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<SlackConfig>(DEFAULT);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const { data: config, isLoading } = useQuery<SlackConfig | null>({
    queryKey: ['slack-config'],
    queryFn: () => api.get('/slack/config').then(r => r.data),
  });

  useEffect(() => { if (config) setForm(config); }, [config]);

  const save = useMutation({
    mutationFn: (data: SlackConfig) => api.put('/slack/config', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['slack-config'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete('/slack/config'),
    onSuccess: () => {
      setForm(DEFAULT);
      qc.invalidateQueries({ queryKey: ['slack-config'] });
    },
  });

  async function sendTest() {
    setTestResult(null);
    try {
      await api.post('/slack/test');
      setTestResult({ ok: true, msg: 'Test message sent! Check your Slack channel.' });
    } catch (err: any) {
      setTestResult({ ok: false, msg: err.response?.data?.error ?? 'Failed to send test message' });
    }
  }

  const connected = Boolean(config?.webhookUrl);

  function toggle(field: keyof SlackConfig) {
    setForm(prev => ({ ...prev, [field]: !prev[field as keyof SlackConfig] }));
  }

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
        <SkeletonCard lines={5} />
      </PageBody>
    );
  }

  return (
    <PageBody width="narrow">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-card flex items-center justify-center shrink-0 ${SLACK_BRAND_TILE}`}>
          <Slack size={20} className="text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-[18px] font-semibold text-fg leading-tight tracking-tight">Slack Integration</h1>
          <p className="text-[13px] text-fg-muted mt-0.5">Get real-time alerts in Slack for important events</p>
        </div>
        {connected && (
          <Badge variant="green" dot className="ml-auto">Connected</Badge>
        )}
      </div>

      <Card>
        <CardHeader title="Webhook configuration" className="mb-4" />
        <div className="space-y-4">
          <Field
            label="Incoming Webhook URL"
            hint={
              <>
                Create an incoming webhook at{' '}
                <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  api.slack.com/apps
                </a>
              </>
            }
          >
            <Input
              type="url"
              value={form.webhookUrl}
              onChange={e => setForm(p => ({ ...p, webhookUrl: e.target.value }))}
              aria-label="Webhook URL"
              placeholder="https://hooks.slack.com/services/T.../B.../..."
            />
          </Field>
          <Field label="Default channel" hint="Used when an event doesn't specify its own channel.">
            <Input
              type="text"
              value={form.channel}
              onChange={e => setForm(p => ({ ...p, channel: e.target.value }))}
              placeholder="#general"
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Notify me when…" className="mb-4" />
        <div className="space-y-3">
          {NOTIFY_OPTIONS.map(({ key, label, desc }) => (
            <Checkbox
              key={key}
              label={label}
              hint={desc}
              checked={Boolean(form[key as keyof SlackConfig])}
              onChange={() => toggle(key as keyof SlackConfig)}
            />
          ))}
        </div>
      </Card>

      {saved && <Alert tone="success" className="animate-fade-in">Configuration saved.</Alert>}

      {testResult && (
        <Alert tone={testResult.ok ? 'success' : 'danger'}>{testResult.msg}</Alert>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Button
          size="lg"
          className="flex-1"
          onClick={() => save.mutate(form)}
          disabled={!form.webhookUrl}
          loading={save.isPending}
        >
          {save.isPending ? 'Saving…' : connected ? 'Save changes' : 'Connect Slack'}
        </Button>
        {connected && (
          <>
            <Button size="lg" variant="secondary" icon={<Send size={14} />} onClick={sendTest}>
              Test
            </Button>
            <Button
              size="lg"
              variant="danger"
              icon={<Trash2 size={14} />}
              onClick={() => remove.mutate()}
              loading={remove.isPending}
            >
              Disconnect
            </Button>
          </>
        )}
      </div>
    </PageBody>
  );
}
