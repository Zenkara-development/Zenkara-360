import { useState } from 'react';
import { Sparkles, Plus, Play, Trash2, ToggleLeft, ToggleRight, Zap, Bell, Mail, Tag, Route, BarChart3, ChevronDown, ChevronUp, Edit2, Ticket, Target, Handshake, User, CheckCircle2 } from 'lucide-react';
import { useAIRules, useCreateAIRule, useUpdateAIRule, useDeleteAIRule, useRunAIRule, useBulkScoreLeads } from '../api/ai';
import {
  AiGeneratedTag, AiInfo,
  Alert, Badge, Button, Card, Field, FormActions, IconButton, Input, Modal, PageBody, PageHeader,
  SectionHeader, SkeletonCard, Textarea, EmptyState, AccessDenied,
} from '../shared/components';
import { AITypewriter } from '../shared/components/AITypewriter';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../shared/permissions';

const TRIGGERS = [
  { value: 'TICKET_CREATED',       label: 'Ticket Created',        icon: <Ticket size={16} />,       desc: 'Fires when a new support ticket is submitted' },
  { value: 'LEAD_SCORED',          label: 'Lead Scored',           icon: <Target size={16} />,       desc: 'Fires after AI scores a lead' },
  { value: 'DEAL_STAGE_CHANGED',   label: 'Deal Stage Changed',    icon: <Handshake size={16} />,    desc: 'Fires when a deal moves to a new stage' },
  { value: 'CONTACT_UPDATED',      label: 'Contact Updated',       icon: <User size={16} />,         desc: 'Fires when a contact record is updated' },
  { value: 'TICKET_RESOLVED',      label: 'Ticket Resolved',       icon: <CheckCircle2 size={16} />, desc: 'Fires when a ticket is marked resolved' },
  { value: 'MANUAL',               label: 'Manual / On Demand',    icon: <Play size={16} />,         desc: 'Run this rule manually whenever needed' },
];

const ACTIONS = [
  { value: 'TAG',           label: 'Auto-Tag',          icon: <Tag size={16} />,       desc: 'Automatically add tags to the entity' },
  { value: 'ROUTE',         label: 'Smart Route',       icon: <Route size={16} />,     desc: 'Route to the right team or agent' },
  { value: 'EMAIL',         label: 'Generate Email',    icon: <Mail size={16} />,      desc: 'Draft a follow-up or notification email' },
  { value: 'NOTIFY',        label: 'Send Notification', icon: <Bell size={16} />,      desc: 'Alert the team with an AI insight' },
  { value: 'SCORE',         label: 'AI Score',          icon: <BarChart3 size={16} />, desc: 'Calculate a custom AI score' },
  { value: 'SUMMARIZE',     label: 'Summarize',         icon: <Zap size={16} />,       desc: 'Generate a concise AI summary' },
  { value: 'CUSTOM_PROMPT', label: 'Custom Prompt',     icon: <Sparkles size={16} />,  desc: 'Write your own AI instruction' },
];

const PROMPT_TEMPLATES: Record<string, string> = {
  TAG: 'Analyze this support ticket and extract 3-5 relevant keyword tags. Return only a JSON array of lowercase strings.',
  ROUTE: 'Based on this ticket\'s content and priority, determine the best team to handle it: Level 1 Support, Level 2 Technical, Security Team, or Management. Return JSON: {"team": "...", "reason": "1 sentence"}',
  EMAIL: 'Write a professional follow-up email based on this context. Return JSON: {"subject": "...", "body": "..."}',
  NOTIFY: 'Analyze this data and generate a brief, actionable alert for the team. Return JSON: {"title": "short alert", "message": "2 sentences", "priority": "low|medium|high"}',
  SCORE: 'Score the quality/risk/priority of this entity on a scale of 0-100. Return JSON: {"score": number, "grade": "A-F", "reason": "1 sentence"}',
  SUMMARIZE: 'Provide a concise 2-3 sentence summary of this content, highlighting the most important points.',
  CUSTOM_PROMPT: 'You are a helpful CRM assistant. Analyze the provided context and give actionable insights.',
};

/** A selectable option card — the trigger grid and the action grid were the
    same control written twice with different literal hues (indigo vs purple). */
function ChoiceCard({ selected, onClick, icon, title, desc }: {
  selected: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex items-start gap-3 p-3 rounded-card border text-left transition-all ${
        selected ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'
      }`}
    >
      <span className={`mt-0.5 shrink-0 ${selected ? 'text-accent' : 'text-fg-subtle'}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="text-xs text-fg-muted">{desc}</p>
      </div>
    </button>
  );
}

function RuleCard({ rule, onEdit, onDelete, onToggle }: any) {
  const [expanded, setExpanded] = useState(false);
  const [testOutput, setTestOutput] = useState('');
  const [testInput, setTestInput] = useState('');
  const [testing, setTesting] = useState(false);
  const runRule = useRunAIRule();

  const trigger = TRIGGERS.find(t => t.value === rule.trigger);
  const action = ACTIONS.find(a => a.value === rule.action);

  async function handleTest() {
    setTesting(true);
    setTestOutput('');
    try {
      const result = await runRule.mutateAsync({ id: rule.id, inputText: testInput || undefined });
      setTestOutput(result.result);
    } catch {
      setTestOutput('Error running rule. Check your AI configuration.');
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card padding="none" className={rule.isActive ? '' : 'border-dashed opacity-70'}>
      <div className="flex items-center gap-4 p-4">
        <div className="w-10 h-10 rounded-card bg-accent-soft text-accent-soft-fg flex items-center justify-center flex-shrink-0">
          {trigger?.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-fg">{rule.name}</span>
            <Badge variant={rule.isActive ? 'green' : 'gray'}>{rule.isActive ? 'Active' : 'Disabled'}</Badge>
          </div>
          <p className="text-xs text-fg-muted mt-0.5">
            <span className="text-accent">{trigger?.label}</span>
            <span className="mx-1">→</span>
            <span className="text-accent">{action?.label}</span>
            {rule.runCount > 0 && <span className="ml-2 text-fg-subtle tabular-nums">· ran {rule.runCount}×</span>}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <IconButton
            label={rule.isActive ? 'Disable' : 'Enable'}
            tone="accent"
            onClick={() => onToggle(rule)}
            icon={rule.isActive ? <ToggleRight size={22} className="text-accent" /> : <ToggleLeft size={22} />}
          />
          <IconButton label="Edit rule" onClick={() => onEdit(rule)} icon={<Edit2 size={14} />} />
          <IconButton label="Delete rule" tone="danger" onClick={() => onDelete(rule.id)} icon={<Trash2 size={14} />} />
          <IconButton
            label={expanded ? 'Collapse' : 'Expand'}
            onClick={() => setExpanded(e => !e)}
            icon={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-line-subtle p-4 space-y-4">
          {rule.description && <p className="text-sm text-fg-muted">{rule.description}</p>}

          {rule.customPrompt && (
            <div>
              <p className="text-xs font-medium text-fg-muted mb-1.5">AI Prompt</p>
              <div className="bg-surface-sunken rounded-btn p-3 text-xs font-mono text-fg whitespace-pre-wrap">
                {rule.customPrompt}
              </div>
            </div>
          )}

          <Field label={<span className="inline-flex items-center gap-1">Test this rule <AiInfo id="builder.rule" /></span>}>
            <Textarea
              value={testInput}
              onChange={e => setTestInput(e.target.value)}
              placeholder="Paste some sample text to test with (e.g. a ticket description, deal notes)..."
              rows={3}
              className="resize-none"
            />
            <Button size="sm" icon={<Play size={13} />} onClick={handleTest} loading={testing} className="mt-2">
              Run Test
            </Button>
          </Field>

          {testOutput && (
            <div className="animate-fade-in">
              <div className="flex items-center gap-2 mb-1.5">
                <p className="text-xs font-medium text-fg-muted flex items-center gap-1">
                  <Sparkles size={11} className="text-accent" /> AI Output
                </p>
                <AiGeneratedTag />
              </div>
              <Alert tone="accent" icon={null}>
                <AITypewriter text={testOutput} speed={12} showIcon={false} />
              </Alert>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function RuleForm({ initial, onClose }: { initial?: any; onClose: () => void }) {
  const createRule = useCreateAIRule();
  const updateRule = useUpdateAIRule();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    trigger: initial?.trigger ?? 'TICKET_CREATED',
    action: initial?.action ?? 'SUMMARIZE',
    customPrompt: initial?.customPrompt ?? '',
    isActive: initial?.isActive ?? true,
  });
  const f = (k: string) => (e: any) => setForm(p => ({ ...p, [k]: e.target.value }));

  function handleActionChange(action: string) {
    setForm(p => ({
      ...p,
      action,
      customPrompt: p.customPrompt || PROMPT_TEMPLATES[action] || '',
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (initial?.id) await updateRule.mutateAsync({ id: initial.id, ...form });
    else await createRule.mutateAsync(form);
    onClose();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field label="Rule Name" required>
        <Input required value={form.name} onChange={f('name')} placeholder="e.g. Auto-tag billing tickets" />
      </Field>

      <Field label="Description">
        <Input value={form.description} onChange={f('description')} placeholder="What does this rule do?" />
      </Field>

      <Field label="When this happens (Trigger)">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TRIGGERS.map(t => (
            <ChoiceCard
              key={t.value}
              selected={form.trigger === t.value}
              onClick={() => setForm(p => ({ ...p, trigger: t.value }))}
              icon={t.icon}
              title={t.label}
              desc={t.desc}
            />
          ))}
        </div>
      </Field>

      <Field label="Then do this (Action)">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ACTIONS.map(a => (
            <ChoiceCard
              key={a.value}
              selected={form.action === a.value}
              onClick={() => handleActionChange(a.value)}
              icon={a.icon}
              title={a.label}
              desc={a.desc}
            />
          ))}
        </div>
      </Field>

      <Field
        label={<>AI Prompt <span className="text-xs text-fg-subtle font-normal ml-2">Tell the AI exactly what to do</span></>}
        hint="The AI will receive the full entity data automatically. Just describe what output you want."
      >
        <Textarea
          value={form.customPrompt}
          onChange={f('customPrompt')}
          rows={5}
          placeholder="Describe what AI should do with the entity data..."
          className="resize-none font-mono text-xs"
        />
      </Field>

      <FormActions className="pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={createRule.isPending || updateRule.isPending}>
          {initial?.id ? 'Save Changes' : 'Create Rule'}
        </Button>
      </FormActions>
    </form>
  );
}

export function AIFeaturePage() {
  /* Every rule on this page comes from /ai/rules, which is MANAGERS-only — as
     are the create/update/delete/run endpoints behind each control on it. Anyone
     else arriving by URL got an empty list and buttons that could only fail. */
  const { user } = useAuth();
  const canReadAiConfig = can.readAiConfig(user?.role);
  const { data: rules, isLoading } = useAIRules(canReadAiConfig);
  const deleteRule = useDeleteAIRule();
  const updateRule = useUpdateAIRule();
  const bulkScore = useBulkScoreLeads();
  const [modal, setModal] = useState<null | 'create' | any>(null);
  const [bulkResult, setBulkResult] = useState<any>(null);

  async function handleBulkScore() {
    const result = await bulkScore.mutateAsync();
    setBulkResult(result);
  }

  if (!canReadAiConfig) return <AccessDenied />;

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="AI Feature Builder"
        subtitle="Create custom AI automations that run on your data — no code required."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<BarChart3 size={15} />}
              onClick={handleBulkScore}
              loading={bulkScore.isPending}
            >
              Score All Leads
            </Button>
            <AiInfo id="lead.bulkScore" align="left" className="-ml-1" />
            <Button icon={<Plus size={15} />} onClick={() => setModal('create')}>
              New Rule
            </Button>
          </>
        }
      />

      <PageBody width="narrow">
        {/* Bulk score result */}
        {bulkResult && (
          <Alert tone="success" title="Bulk scoring complete!" icon={<Sparkles size={18} />}>
            {bulkResult.scored} leads scored by AI.
          </Alert>
        )}

        {/* Quick actions */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: <Tag size={16} />, title: 'Auto-Tag Tickets', desc: 'AI extracts tags from ticket content automatically', trigger: 'TICKET_CREATED', action: 'TAG' },
            { icon: <Mail size={16} />, title: 'Smart Follow-ups', desc: 'Generate follow-up emails when deals change stages', trigger: 'DEAL_STAGE_CHANGED', action: 'EMAIL' },
            { icon: <Bell size={16} />, title: 'SLA Alerts', desc: 'Get AI-generated alerts when tickets age too long', trigger: 'TICKET_CREATED', action: 'NOTIFY' },
          ].map(t => (
            <Card
              key={t.title}
              padding="sm"
              interactive
              onClick={() => setModal({ preset: t })}
              className="flex gap-3 text-left group"
            >
              <span className="shrink-0 w-9 h-9 rounded-card bg-accent-soft text-accent-soft-fg flex items-center justify-center">
                {t.icon}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg group-hover:text-accent transition-colors">{t.title}</p>
                <p className="text-xs text-fg-muted mt-0.5 leading-relaxed">{t.desc}</p>
                <p className="text-xs text-accent mt-2 font-medium">Use template →</p>
              </div>
            </Card>
          ))}
        </div>

        {/* Rules list */}
        <div>
          <SectionHeader
            title={<>Your Rules {rules?.length ? <span className="text-fg-subtle font-normal">({rules.length})</span> : null}</>}
            className="mb-3"
          />

          {isLoading ? (
            <div className="space-y-3" aria-hidden="true">
              <SkeletonCard lines={2} />
              <SkeletonCard lines={2} />
              <SkeletonCard lines={2} />
            </div>
          ) : !rules?.length ? (
            <EmptyState
              icon={<Sparkles size={24} />}
              title="No AI rules yet"
              description="Create your first rule to automate AI actions on your CRM data."
              action={{ label: 'Create First Rule', onClick: () => setModal('create') }}
            />
          ) : (
            <div className="space-y-3">
              {rules.map((rule: any) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onEdit={setModal}
                  onDelete={(id: string) => deleteRule.mutate(id)}
                  onToggle={(r: any) => updateRule.mutate({ id: r.id, isActive: !r.isActive })}
                  onRun={(r: any) => setModal({ ...r, _run: true })}
                />
              ))}
            </div>
          )}
        </div>
      </PageBody>

      {/* Create/Edit Modal */}
      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal === 'create' ? 'Create AI Rule' : modal?.id ? 'Edit Rule' : modal?.preset ? `Use Template: ${modal.preset.title}` : 'New Rule'}
        size="lg"
      >
        {modal && (
          <RuleForm
            initial={modal?.id ? modal : modal?.preset ? { trigger: modal.preset.trigger, action: modal.preset.action, customPrompt: PROMPT_TEMPLATES[modal.preset.action] } : undefined}
            onClose={() => setModal(null)}
          />
        )}
      </Modal>
    </div>
  );
}
