/**
 * WebFormsPage — Admin → Web Forms.
 *
 * Managers create public web-to-lead / web-to-ticket forms here, flip them
 * active/inactive, and grab the public link or an iframe embed snippet to
 * drop on the org's own website. Submissions become real Leads/Tickets and
 * run the same workflows (department routing, AI auto-assign, notifications)
 * as in-app records — pair a form with an AI Auto-Assign rule and inbound
 * requests route themselves.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PanelTop, Plus, Link2, Code2, Trash2, CheckCircle2,
  ExternalLink, MousePointerClick, KeyRound, RefreshCw,
  Plug, ChevronDown, ChevronUp, Copy,
} from 'lucide-react';
import { api } from '../api/client';
import {
  Alert, Badge, Button, Card, EmptyState, Field, Input, Modal,
  PageBody, PageHeader, Select, Textarea, Toggle,
} from '../shared/components';
import { addToast } from '../shared/components/toastStore';

interface WebForm {
  id: string;
  name: string;
  type: 'LEAD' | 'TICKET';
  title: string | null;
  intro: string | null;
  isActive: boolean;
  intakeToken: string | null;
  submissionCount: number;
  lastSubmissionAt: string | null;
  createdAt: string;
}

export default function WebFormsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ name: '', type: 'LEAD' as 'LEAD' | 'TICKET', title: '', intro: '' });
  const [copied, setCopied] = useState<string | null>(null);
  const [integrationsFor, setIntegrationsFor] = useState<string | null>(null);

  const { data: forms, isLoading } = useQuery<WebForm[]>({
    queryKey: ['web-forms'],
    queryFn: async () => (await api.get('/web-forms')).data,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['web-forms'] });

  const createMut = useMutation({
    mutationFn: async () =>
      (await api.post('/web-forms', {
        name: draft.name,
        type: draft.type,
        title: draft.title.trim() || undefined,
        intro: draft.intro.trim() || undefined,
      })).data,
    onSuccess: () => {
      invalidate();
      setShowCreate(false);
      setDraft({ name: '', type: 'LEAD', title: '', intro: '' });
      addToast('Form created — copy its link or embed code below', 'success');
    },
    onError: (e: any) => addToast(e?.response?.data?.error || 'Could not create form', 'error'),
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) =>
      (await api.patch(`/web-forms/${id}`, { isActive })).data,
    onSuccess: invalidate,
    onError: (e: any) => addToast(e?.response?.data?.error || 'Update failed', 'error'),
  });

  const rotateMut = useMutation({
    mutationFn: async (id: string) => (await api.post(`/web-forms/${id}/rotate-token`)).data,
    onSuccess: () => { invalidate(); addToast('New intake token issued — update your integrations', 'success'); },
    onError: (e: any) => addToast(e?.response?.data?.error || 'Could not rotate token', 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/web-forms/${id}`)).data,
    onSuccess: () => { invalidate(); addToast('Form deleted', 'success'); },
    onError: (e: any) => addToast(e?.response?.data?.error || 'Delete failed', 'error'),
  });

  const publicUrl = (id: string) => `${window.location.origin}/form/${id}`;
  const embedSnippet = (id: string) =>
    `<iframe src="${publicUrl(id)}" style="width:100%;max-width:560px;height:640px;border:0;border-radius:12px" title="Contact form"></iframe>`;

  // The public submit endpoint as an absolute URL — what Google Apps Script,
  // Zoho webhooks and Zapier must POST to. VITE_API_URL is absolute in
  // production (API and client are different Render services); the '/api'
  // fallback is dev, where origin-relative works.
  const rawApi: string = (import.meta as any).env?.VITE_API_URL || '/api';
  const apiBase = rawApi.startsWith('http') ? rawApi : `${window.location.origin}${rawApi}`;
  const submitUrl = (id: string) => `${apiBase.replace(/\/$/, '')}/public/forms/${id}/submit`;

  const appsScript = (form: WebForm) => `// ── CRMITdesk bridge for Google Forms ─────────────────────────────
// Form menu (⋮) → Apps Script → paste this → Triggers → Add Trigger:
// function onFormSubmit, event source "From form", type "On form submit".
const ENDPOINT = '${submitUrl(form.id)}';
const INTAKE_TOKEN = '${form.intakeToken ?? ''}';

// Map YOUR Google Form question titles (left) to CRMITdesk fields (right).
// Edit the left side to match your questions exactly.
const QUESTION_MAP = {
  'Your name':        'name',     // required
  'Email address':    'email',    // required
  'Phone number':     'phone',
  'Company':          'company',${form.type === 'TICKET' ? `
  'Subject':          'subject',` : ''}
  'How can we help?': 'message',
};

function onFormSubmit(e) {
  const payload = {};
  e.response.getItemResponses().forEach(function (ir) {
    const field = QUESTION_MAP[ir.getItem().getTitle()];
    if (field) payload[field] = String(ir.getResponse());
  });
  if (!payload.name || !payload.email) return;
  UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-intake-token': INTAKE_TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}`;

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1800);
    } catch {
      addToast('Could not copy — select the link text and copy manually', 'error');
    }
  }

  return (
    <div>
      <PageHeader
        title="Web Forms"
        subtitle="Public forms you can embed on your website — submissions become leads or tickets automatically"
        actions={
          <Button icon={<Plus size={14} />} onClick={() => setShowCreate(true)}>
            New form
          </Button>
        }
      />
      <PageBody>
        <div className="max-w-3xl space-y-5">
          <Alert tone="info">
            Each form has a public link that works <strong>without login</strong> — share it directly
            or embed it on your site with the iframe snippet. Pair it with an{' '}
            <strong>AI Auto-Assign</strong> workflow rule (Workflows → On lead/ticket created) and
            every submission is routed to the right department and person automatically.
          </Alert>

          {isLoading ? (
            <p className="text-sm text-fg-muted py-6 text-center">Loading…</p>
          ) : !forms?.length ? (
            <Card>
              <EmptyState
                icon={<MousePointerClick size={22} />}
                title="No web forms yet"
                description="Create a lead form for your website's contact page, or a ticket form for a customer support portal."
                action={{ label: 'Create your first form', onClick: () => setShowCreate(true) }}
              />
            </Card>
          ) : (
            <div className="space-y-4">
              {forms.map(form => (
                <Card key={form.id} className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <PanelTop size={15} className="text-fg-subtle shrink-0" />
                        <span className="text-[14.5px] font-semibold text-fg">{form.name}</span>
                        <Badge variant={form.type === 'LEAD' ? 'blue' : 'purple'}>
                          {form.type === 'LEAD' ? 'Lead form' : 'Ticket form'}
                        </Badge>
                        {!form.isActive && <Badge variant="gray">Inactive</Badge>}
                      </div>
                      <p className="text-[12.5px] text-fg-muted mt-1">
                        {form.submissionCount} submission{form.submissionCount === 1 ? '' : 's'}
                        {form.lastSubmissionAt && ` · last ${new Date(form.lastSubmissionAt).toLocaleString()}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Toggle
                        label={form.isActive ? 'Active' : 'Off'}
                        checked={form.isActive}
                        onChange={(v: boolean) => toggleMut.mutate({ id: form.id, isActive: v })}
                      />
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => {
                          if (window.confirm(`Delete "${form.name}"? Its public link will stop working.`)) {
                            deleteMut.mutate(form.id);
                          }
                        }}
                      >
                        <Trash2 size={14} className="text-danger" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary" size="sm"
                      icon={copied === `link-${form.id}` ? <CheckCircle2 size={13} className="text-success" /> : <Link2 size={13} />}
                      onClick={() => copyText(`link-${form.id}`, publicUrl(form.id))}
                    >
                      {copied === `link-${form.id}` ? 'Copied' : 'Copy link'}
                    </Button>
                    <Button
                      variant="secondary" size="sm"
                      icon={copied === `embed-${form.id}` ? <CheckCircle2 size={13} className="text-success" /> : <Code2 size={13} />}
                      onClick={() => copyText(`embed-${form.id}`, embedSnippet(form.id))}
                    >
                      {copied === `embed-${form.id}` ? 'Copied' : 'Copy embed code'}
                    </Button>
                    <a
                      href={publicUrl(form.id)} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium text-fg-muted hover:text-fg hover:bg-surface-sunken transition-colors"
                    >
                      <ExternalLink size={13} /> Preview
                    </a>
                    <Button
                      variant="secondary" size="sm"
                      icon={<Plug size={13} />}
                      onClick={() => setIntegrationsFor(v => (v === form.id ? null : form.id))}
                    >
                      Connect other products {integrationsFor === form.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </Button>
                  </div>
                  <code className="block text-[11.5px] text-fg-subtle bg-surface-sunken rounded-md px-2.5 py-1.5 truncate">
                    {publicUrl(form.id)}
                  </code>
                  {/* Webhook intake — for Zoho webhooks / Google Apps Script /
                      Zapier. The token lifts the per-IP rate limit for
                      server-to-server traffic and proves the caller is yours. */}
                  {form.intakeToken && (
                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-line-subtle">
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-fg-muted">
                        <KeyRound size={13} /> Webhook intake token
                      </span>
                      <code className="text-[11.5px] text-fg-subtle bg-surface-sunken rounded px-2 py-0.5">
                        {form.intakeToken.slice(0, 12)}…
                      </code>
                      <Button
                        variant="secondary" size="xs"
                        icon={copied === `tok-${form.id}` ? <CheckCircle2 size={12} className="text-success" /> : <Link2 size={12} />}
                        onClick={() => copyText(`tok-${form.id}`, form.intakeToken!)}
                      >
                        {copied === `tok-${form.id}` ? 'Copied' : 'Copy token'}
                      </Button>
                      <Button
                        variant="ghost" size="xs"
                        icon={<RefreshCw size={12} />}
                        onClick={() => {
                          if (window.confirm('Issue a new token? Integrations using the current one will lose the rate-limit bypass until updated.')) {
                            rotateMut.mutate(form.id);
                          }
                        }}
                      >
                        Rotate
                      </Button>
                      <span className="text-[11px] text-fg-subtle">
                        Send as <code>x-intake-token</code> header from Zoho / Google Forms / Zapier
                      </span>
                    </div>
                  )}

                  {/* ── Integration steps: connect Google Forms / Zoho / Zapier ── */}
                  {integrationsFor === form.id && (
                    <div className="mt-1 rounded-xl border border-line bg-surface-sunken/50 p-4 space-y-5 text-[13px] text-fg">
                      <p className="text-[12.5px] text-fg-muted">
                        Any form product that can send an HTTP POST after a submission can create{' '}
                        {form.type === 'LEAD' ? 'leads' : 'tickets'} here. All of them POST to this endpoint
                        with the intake token above as an <code>x-intake-token</code> header:
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="text-[11.5px] bg-surface border border-line rounded px-2 py-1 truncate max-w-full">
                          {submitUrl(form.id)}
                        </code>
                        <Button
                          variant="secondary" size="xs"
                          icon={copied === `api-${form.id}` ? <CheckCircle2 size={12} className="text-success" /> : <Copy size={12} />}
                          onClick={() => copyText(`api-${form.id}`, submitUrl(form.id))}
                        >
                          {copied === `api-${form.id}` ? 'Copied' : 'Copy endpoint'}
                        </Button>
                      </div>
                      <p className="text-[12px] text-fg-subtle">
                        Fields: <code>name</code> (required), <code>email</code> (required), <code>phone</code>,{' '}
                        <code>company</code>{form.type === 'TICKET' && <>, <code>subject</code></>}, <code>message</code> — sent as JSON.
                      </p>

                      <div>
                        <p className="font-semibold mb-1.5">Google Forms</p>
                        <ol className="list-decimal ml-5 space-y-1 text-[12.5px] text-fg-muted">
                          <li>Open your Google Form → ⋮ menu → <strong>Apps Script</strong>.</li>
                          <li>Delete the sample code and paste the script below — the endpoint and token are already filled in for this form.</li>
                          <li>Edit <code>QUESTION_MAP</code> so the left side matches your Google Form question titles exactly.</li>
                          <li>Click <strong>Triggers</strong> (clock icon) → <strong>Add Trigger</strong> → function <code>onFormSubmit</code>, event source <em>From form</em>, event type <em>On form submit</em> → Save and approve the permission prompt.</li>
                          <li>Submit a test response — it appears here within seconds.</li>
                        </ol>
                        <Button
                          className="mt-2"
                          variant="secondary" size="xs"
                          icon={copied === `gas-${form.id}` ? <CheckCircle2 size={12} className="text-success" /> : <Code2 size={12} />}
                          onClick={() => copyText(`gas-${form.id}`, appsScript(form))}
                        >
                          {copied === `gas-${form.id}` ? 'Copied' : 'Copy ready-made Apps Script'}
                        </Button>
                      </div>

                      <div>
                        <p className="font-semibold mb-1.5">Zoho Forms (no code)</p>
                        <ol className="list-decimal ml-5 space-y-1 text-[12.5px] text-fg-muted">
                          <li>Open your form in Zoho Forms → <strong>Integrations</strong> → <strong>Webhooks</strong>.</li>
                          <li>Webhook URL: the endpoint above. Method: <strong>POST</strong>. Format: <strong>JSON</strong>.</li>
                          <li>Add a header <code>x-intake-token</code> with the token above.</li>
                          <li>Map your Zoho fields to parameter names <code>name</code>, <code>email</code>, <code>phone</code>, <code>company</code>{form.type === 'TICKET' && <>, <code>subject</code></>}, <code>message</code>.</li>
                          <li>Save and submit a test entry. (Typeform, Jotform and Tally work the same way via their Webhooks settings.)</li>
                        </ol>
                      </div>

                      <div>
                        <p className="font-semibold mb-1.5">Zapier / Make / n8n</p>
                        <ol className="list-decimal ml-5 space-y-1 text-[12.5px] text-fg-muted">
                          <li>Trigger: "New form response" from your form tool.</li>
                          <li>Action: <strong>Webhooks → POST</strong> to the endpoint above, payload type JSON.</li>
                          <li>Header <code>x-intake-token</code>: the token above. Map <code>name</code> and <code>email</code> (plus any other fields) from the trigger.</li>
                        </ol>
                      </div>

                      <Alert tone="warning">
                        Never put the intake token in website code — anything in a web page is public.
                        For your own website, embed this form with the iframe snippet instead; the token
                        is only for server-side senders like Apps Script, Zoho and Zapier. If it ever
                        leaks, press <strong>Rotate</strong> above.
                      </Alert>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </PageBody>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New web form">
        <form onSubmit={e => { e.preventDefault(); createMut.mutate(); }} className="space-y-4">
          <Field label="Form name" required hint="Internal name — visitors never see this">
            <Input
              required
              value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder="Website contact form"
            />
          </Field>
          <Field label="Submissions become">
            <Select
              value={draft.type}
              onChange={e => setDraft(d => ({ ...d, type: e.target.value as 'LEAD' | 'TICKET' }))}
              options={[
                { value: 'LEAD', label: 'Leads (sales inquiry form)' },
                { value: 'TICKET', label: 'Tickets (support request form)' },
              ]}
            />
          </Field>
          <Field label="Public title" hint="Shown as the form heading (optional)">
            <Input
              value={draft.title}
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              placeholder={draft.type === 'LEAD' ? 'Contact our sales team' : 'Submit a support request'}
            />
          </Field>
          <Field label="Intro text">
            <Textarea
              value={draft.intro}
              onChange={e => setDraft(d => ({ ...d, intro: e.target.value }))}
              placeholder="Tell us a bit about what you need and we'll get back within one business day."
              rows={2}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" disabled={!draft.name.trim() || createMut.isPending}>
              {createMut.isPending ? 'Creating…' : 'Create form'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
