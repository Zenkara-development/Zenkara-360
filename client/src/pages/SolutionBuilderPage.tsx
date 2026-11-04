/**
 * AI Solution Builder — platform Phase 3.
 *
 * Describe the business → the SMART model designs the whole workspace →
 * preview every part → one click applies it: the product renames itself
 * (Phase 1 skin), custom modules appear with fields, pipeline boards and
 * cross-module relations (Phase 2), the four core entities are relabeled,
 * and starter automations are created. Nothing writes until Apply.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Rocket, Sparkles, Wand2, Layers, ArrowRight, CheckCircle2, Zap, Link2, Eye, EyeOff, Loader2,
  BookmarkPlus, Trash2, Share2, Package,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  PageHeader, PageBody, Card, Button, Textarea, Badge, Alert, AccessDenied, EmptyState,
  Modal, Field, Input, Toggle, IconButton,
} from '../shared/components';
import { STAGE_DOT } from '../shared/components/CustomModuleKanban';
import { AiInfo } from '../shared/components/AiInfo';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../shared/permissions';

interface BlueprintField { label: string; fieldType: string; options?: string[]; required?: boolean; isPrimary?: boolean; relationTo?: string }
interface BlueprintModule { name: string; icon: string; description?: string; navSection: string; fields: BlueprintField[]; stages?: { key: string; label: string; color?: string }[]; listColumns?: string[] }
interface Blueprint {
  workspace?: { appName?: string; sectionRenames?: Record<string, string>; navRenames?: Record<string, string>; hiddenSections?: string[] };
  labels?: Record<string, { singular: string; plural: string }>;
  modules: BlueprintModule[];
  automations?: { name: string; module: string; event: string; stage?: string; notifyTitle: string; notifyBody: string }[];
}
interface ApplyResult { modules: { id: string; name: string; slug: string }[]; workflowsCreated: number; workspaceApplied: boolean; labelsApplied: boolean }
interface TemplateRow { id: string; name: string; description?: string | null; isShared: boolean; mine: boolean; from: string; moduleCount: number; appName?: string | null }

const EXAMPLES = [
  'We are a residential real estate brokerage with 25 agents. We track property listings from intake to closing, buyer showings with feedback, and vendor jobs like staging and repairs.',
  'We run a car dealership: vehicles in stock move from arrival to delivery, prospects book test drives, and our service bay handles repair jobs on sold cars.',
  'We are a dental clinic group — patients book treatments, treatment plans move from proposal to completed, and we track lab orders sent to external labs.',
];

export default function SolutionBuilderPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [description, setDescription] = useState('');
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [blueprintSource, setBlueprintSource] = useState<string | null>(null); // template name, if loaded from one
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveForm, setSaveForm] = useState({ name: '', description: '', isShared: false });

  const canManage = can.readCrmReports(user?.role);
  const { data: templates } = useQuery({
    queryKey: ['solution-templates'],
    queryFn: () => api.get('/ai/solution/templates').then(r => r.data as TemplateRow[]),
    enabled: canManage,
  });
  const loadTemplate = useMutation({
    mutationFn: (id: string) => api.get(`/ai/solution/templates/${id}`).then(r => r.data as { name: string; blueprint: Blueprint }),
    onSuccess: t => { setBlueprint(t.blueprint); setBlueprintSource(t.name); setResult(null); },
  });
  const saveTemplate = useMutation({
    mutationFn: (body: typeof saveForm) => api.post('/ai/solution/templates', body).then(r => r.data),
    onSuccess: () => { setSaveOpen(false); setSaveForm({ name: '', description: '', isShared: false }); qc.invalidateQueries({ queryKey: ['solution-templates'] }); },
  });
  const deleteTemplate = useMutation({
    mutationFn: (id: string) => api.delete(`/ai/solution/templates/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['solution-templates'] }),
  });

  const generate = useMutation({
    mutationFn: (desc: string) =>
      api.post('/ai/solution/generate', { description: desc }).then(r => r.data.blueprint as Blueprint),
    onSuccess: bp => { setBlueprint(bp); setBlueprintSource(null); setResult(null); },
  });
  const apply = useMutation({
    mutationFn: (bp: Blueprint) => api.post('/ai/solution/apply', { blueprint: bp }).then(r => r.data as ApplyResult),
    onSuccess: r => {
      setResult(r);
      // The whole shell re-skins live: sidebar, labels, modules, automations.
      qc.invalidateQueries({ queryKey: ['workspace-config'] });
      qc.invalidateQueries({ queryKey: ['custom-modules'] });
      qc.invalidateQueries({ queryKey: ['ai-studio-labels'] });
      qc.invalidateQueries({ queryKey: ['workflows'] });
    },
  });

  if (!canManage) return <AccessDenied />;

  const errText = (e: any) => e?.response?.data?.error || 'Something went wrong — try again.';

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="AI Solution Builder"
        subtitle="Describe your business — get a complete, working workspace designed for it in seconds"
      />
      <PageBody>
        <div className="max-w-3xl space-y-5">
          {/* Step 1 — describe */}
          <Card className="space-y-3">
            <div className="flex items-center gap-2">
              <Wand2 size={15} className="text-accent" />
              <h2 className="text-[14px] font-semibold text-fg tracking-tight">What does your business do?</h2>
            </div>
            <Textarea
              aria-label="Business description"
              rows={4}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. We are a car dealership — we track vehicles in stock, test drives, buyers, and after-sales service jobs…"
              maxLength={2000}
            />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={i} type="button" onClick={() => setDescription(ex)}
                  className="text-left text-[11.5px] px-2.5 py-1 rounded-btn border border-line text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors"
                >
                  {ex.slice(0, 58)}…
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <AiInfo id="solution.builder" />
              <Button
                icon={generate.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                disabled={description.trim().length < 10 || generate.isPending}
                onClick={() => generate.mutate(description)}
              >
                {generate.isPending ? 'Designing your workspace…' : blueprint ? 'Regenerate' : 'Design my workspace'}
              </Button>
            </div>
            {generate.isError && <Alert tone="danger">{errText(generate.error)}</Alert>}
          </Card>

          {/* Solution templates (Phase 4) — stamp a saved workspace, or save this one. */}
          <Card className="space-y-3">
            <div className="flex items-center gap-2">
              <Package size={15} className="text-accent" />
              <h2 className="text-[14px] font-semibold text-fg tracking-tight">Solution templates</h2>
              <Button
                size="xs" variant="secondary" icon={<BookmarkPlus size={12} />}
                className="ml-auto"
                onClick={() => setSaveOpen(true)}
              >
                Save this workspace as a template
              </Button>
            </div>
            {!(templates ?? []).length ? (
              <p className="text-[12.5px] text-fg-subtle">
                No templates yet. Configure a workspace (by hand or with the AI builder above), then save it here —
                shared templates can be stamped onto every new client workspace in one click.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(templates ?? []).map(t => (
                  <div key={t.id} className="rounded-card border border-line-subtle bg-surface-sunken/50 p-3 flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[13px] font-semibold text-fg truncate">{t.name}</p>
                      {t.isShared && <Badge variant="indigo"><Share2 size={9} /> Shared</Badge>}
                      {t.mine && (
                        <IconButton
                          label="Delete template" tone="danger" icon={<Trash2 size={13} />}
                          className="ml-auto"
                          onClick={() => { if (confirm(`Delete template "${t.name}"?`)) deleteTemplate.mutate(t.id); }}
                        />
                      )}
                    </div>
                    <p className="text-[11.5px] text-fg-muted line-clamp-2">
                      {t.description || (t.appName ? `Turns the workspace into "${t.appName}".` : 'A saved workspace configuration.')}
                    </p>
                    <div className="flex items-center gap-2 mt-auto pt-1">
                      <span className="text-[11px] text-fg-subtle">{t.moduleCount} module{t.moduleCount === 1 ? '' : 's'} · from {t.from}</span>
                      <Button
                        size="xs" className="ml-auto"
                        icon={loadTemplate.isPending && loadTemplate.variables === t.id ? <Loader2 size={11} className="animate-spin" /> : <Rocket size={11} />}
                        disabled={loadTemplate.isPending}
                        onClick={() => loadTemplate.mutate(t.id)}
                      >
                        Preview &amp; apply
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {(saveTemplate.isError || deleteTemplate.isError) && (
              <Alert tone="danger">{errText(saveTemplate.error || deleteTemplate.error)}</Alert>
            )}
          </Card>

          {/* Step 2 — preview */}
          {blueprint && !result && (
            <>
              <Alert tone="accent" icon={<Eye size={15} />}>
                {blueprintSource
                  ? <>Previewing the <strong>{blueprintSource}</strong> template — nothing has been created yet.
                      Apply it to stamp this whole configuration onto the current workspace.</>
                  : <>This is a <strong>preview</strong> — nothing has been created yet. Review it, regenerate with a
                      sharper description, or apply it as-is. Everything it creates stays editable by hand afterwards.</>}
              </Alert>

              {blueprint.workspace && (
                <Card className="space-y-3">
                  <h3 className="text-[13.5px] font-semibold text-fg tracking-tight flex items-center gap-2">
                    <Rocket size={14} className="text-accent" /> Workspace identity
                  </h3>
                  {blueprint.workspace.appName && (
                    <p className="text-[13px] text-fg">
                      The product becomes <span className="font-semibold">{blueprint.workspace.appName}</span>
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(blueprint.workspace.sectionRenames ?? {}).map(([from, to]) => (
                      <Badge key={from} variant="indigo">{from} <ArrowRight size={10} /> {to}</Badge>
                    ))}
                    {Object.entries(blueprint.workspace.navRenames ?? {}).map(([route, to]) => (
                      <Badge key={route} variant="blue">{route.split('/').pop()} <ArrowRight size={10} /> {to}</Badge>
                    ))}
                    {(blueprint.workspace.hiddenSections ?? []).map(s => (
                      <Badge key={s} variant="gray"><EyeOff size={10} /> {s} hidden</Badge>
                    ))}
                  </div>
                </Card>
              )}

              {blueprint.modules.map(m => (
                <Card key={m.name} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Layers size={14} className="text-accent" />
                    <h3 className="text-[13.5px] font-semibold text-fg tracking-tight">{m.name}</h3>
                    <Badge variant="gray">{m.navSection.replace('_', ' ')}</Badge>
                  </div>
                  {m.description && <p className="text-[12.5px] text-fg-muted">{m.description}</p>}
                  <div className="flex flex-wrap gap-1.5">
                    {m.fields.map(f => (
                      <span key={f.label} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-btn border border-line-subtle bg-surface-sunken/60 text-[11.5px] text-fg">
                        {f.isPrimary && <span className="text-accent font-bold" title="Record title">★</span>}
                        {f.label}
                        <span className="text-fg-subtle">
                          {f.fieldType === 'RELATION' ? <span className="inline-flex items-center gap-0.5"><Link2 size={10} /> {f.relationTo}</span> : f.fieldType.toLowerCase()}
                        </span>
                      </span>
                    ))}
                  </div>
                  {!!m.stages?.length && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <span className="text-[11px] font-medium text-fg-subtle uppercase tracking-wide">Pipeline:</span>
                      {m.stages.map((s, i) => (
                        <span key={s.key} className="inline-flex items-center gap-1 text-[11.5px] text-fg">
                          <span className={`w-1.5 h-1.5 rounded-full ${STAGE_DOT[s.color ?? ''] ?? 'bg-slate-400'}`} />
                          {s.label}{i < m.stages!.length - 1 && <ArrowRight size={10} className="text-fg-subtle/60" />}
                        </span>
                      ))}
                    </div>
                  )}
                </Card>
              ))}

              {!!blueprint.automations?.length && (
                <Card className="space-y-2">
                  <h3 className="text-[13.5px] font-semibold text-fg tracking-tight flex items-center gap-2">
                    <Zap size={14} className="text-amber-500" /> Automations
                  </h3>
                  {blueprint.automations.map(a => (
                    <p key={a.name} className="text-[12.5px] text-fg-muted">
                      <span className="font-medium text-fg">{a.name}</span> — when a {a.module} record
                      {a.event === 'created' ? ' is created' : ` reaches “${a.stage}”`}, notify: “{a.notifyBody}”
                    </p>
                  ))}
                </Card>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setBlueprint(null)}>Discard</Button>
                <Button
                  icon={apply.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  disabled={apply.isPending}
                  onClick={() => apply.mutate(blueprint)}
                >
                  {apply.isPending ? 'Building…' : 'Apply this setup'}
                </Button>
              </div>
              {apply.isError && <Alert tone="danger">{errText(apply.error)}</Alert>}
            </>
          )}

          {/* Step 3 — done */}
          {result && (
            <Card className="space-y-3">
              <EmptyState
                icon={<CheckCircle2 size={26} className="text-success" />}
                title="Your workspace is live"
                description={`${result.modules.length} module${result.modules.length === 1 ? '' : 's'} created` +
                  `${result.workspaceApplied ? ', product reskinned' : ''}` +
                  `${result.labelsApplied ? ', terminology relabeled' : ''}` +
                  `${result.workflowsCreated ? `, ${result.workflowsCreated} automation${result.workflowsCreated === 1 ? '' : 's'} armed` : ''}. ` +
                  'The sidebar has already updated — everything stays editable in Custom Modules and Workspace Settings.'}
              />
              <div className="flex flex-wrap justify-center gap-2">
                {result.modules.map(m => (
                  <Link
                    key={m.id}
                    to={`/modules/${m.slug}`}
                    className="inline-flex items-center gap-1.5 px-3 h-ctl-sm rounded-btn bg-accent text-accent-fg text-xs font-medium hover:bg-accent-hover transition-colors"
                  >
                    <Layers size={12} /> Open {m.name}
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>
      </PageBody>

      {/* Save-as-template modal */}
      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Save workspace as template">
        <form
          className="space-y-4"
          onSubmit={e => { e.preventDefault(); saveTemplate.mutate(saveForm); }}
        >
          <p className="text-[12.5px] text-fg-muted">
            Captures this workspace's current skin, custom modules (fields, pipelines, relations),
            terminology, and notification automations as a reusable blueprint. Records are not included.
          </p>
          <Field label="Template name" required>
            <Input
              aria-label="Template name" required maxLength={80}
              value={saveForm.name}
              onChange={e => setSaveForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Real Estate Brokerage"
            />
          </Field>
          <Field label="Description">
            <Textarea
              aria-label="Template description" rows={2} maxLength={300}
              value={saveForm.description}
              onChange={e => setSaveForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What kind of business is this setup for?"
            />
          </Field>
          <Toggle
            checked={saveForm.isShared}
            onChange={v => setSaveForm(f => ({ ...f, isShared: v }))}
            label="Share across all workspaces"
            hint="Shared templates appear in every organization's Solution Builder — this is how a partner stamps one perfected setup onto each new client workspace."
          />
          {saveTemplate.isError && <Alert tone="danger">{errText(saveTemplate.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" loading={saveTemplate.isPending} disabled={!saveForm.name.trim()}>
              Save template
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
