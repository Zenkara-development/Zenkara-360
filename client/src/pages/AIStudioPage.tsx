import { useState } from 'react';
import {
  Building2, Zap, Code2, Plus, Trash2, Play, Save,
  CheckCircle2, XCircle,
  Pencil, ToggleLeft, ToggleRight, X,
} from 'lucide-react';
import {
  AiGeneratedTag, AiInfo,
  Alert, Badge, Button, Card, EmptyState, Field, IconButton, Input, Modal,
  PageBody, PageHeader, Select, SkeletonCard, Tabs, Textarea, Toolbar,
  AccessDenied,
} from '../shared/components';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../shared/permissions';
import { Link } from 'react-router-dom';
import {
  useBusinessContext, useSaveBusinessContext,
  useCustomFunctions, useCreateFunction, useUpdateFunction, useDeleteFunction, useRunFunction,
  useCustomScripts, useCreateScript, useUpdateScript, useDeleteScript, useValidateScript,
  type CustomAIFunction, type CustomScript, type InputField,
} from '../api/aiStudio';

// ─── Constants ────────────────────────────────────────────────────────────────

const INDUSTRIES = [
  'Healthcare', 'Legal', 'Real Estate', 'Finance & Banking', 'Insurance',
  'Retail & E-commerce', 'Manufacturing', 'Technology', 'Education',
  'Construction', 'Hospitality', 'Non-profit', 'Government', 'Other',
];

const ENTITY_TYPES = ['ticket', 'contact', 'deal', 'lead', 'asset', 'global'];
const TRIGGERS     = ['onLoad', 'onChange', 'onSubmit', 'onValidate', 'onFieldChange'];
const FIELD_TYPES  = ['text', 'number', 'boolean', 'select'] as const;
const OUTPUT_TYPES = ['text', 'json', 'number'] as const;

const TONES = [
  { key: 'professional' as const, label: 'Professional' },
  { key: 'casual'       as const, label: 'Casual' },
  { key: 'technical'    as const, label: 'Technical' },
];

const SCRIPT_TEMPLATE = `// Available: context.entity, context.field, context.user
// context.setValue(fieldName, value)
// context.setError(fieldName, message)
// context.notify(message, type?)
// await context.ai(prompt) — calls AI and returns string

// Example: auto-set priority based on title keywords
if (context.entity.title?.toLowerCase().includes('urgent')) {
  context.setValue('priority', 'HIGH');
  context.notify('Priority set to HIGH based on urgent keyword', 'info');
}
`;

/** A monospace code well. `bg-gray-950 text-gray-100` was a hardcoded dark
    panel that stayed black in light mode and clashed with every theme; the
    sunken surface token gives the same "this is code, not prose" reading
    while following the theme. */
const CODE_SURFACE = 'font-mono !bg-surface-sunken text-fg';

// ─── (removed) Generate Setup ────────────────────────────────────────────────
// Superseded by the AI Solution Builder (/solution-builder), which generates
// terminology plus whole modules, pipelines, the workspace skin and
// automations from one description. Business Context below still feeds every
// AI prompt and still stores the label overrides the Solution Builder writes.

// ─── Tab: Business Context ────────────────────────────────────────────────────

function BusinessContextTab() {
  // /ai/studio/context is MANAGERS-only. (/ai/studio/labels, which every staff
  // role needs for relabeled terminology, is a separate ALL_STAFF route and is
  // not gated here.)
  const { user } = useAuth();
  const { data: ctx, isLoading } = useBusinessContext(can.readAiConfig(user?.role));
  const save = useSaveBusinessContext();

  const [form, setForm] = useState<any>(null);
  const [termKey, setTermKey] = useState('');
  const [termVal, setTermVal] = useState('');

  const current = form ?? ctx ?? {};

  function set(key: string, val: any) {
    setForm((p: any) => ({ ...(p ?? ctx ?? {}), [key]: val }));
  }

  function addTerm() {
    if (!termKey.trim()) return;
    set('terminology', { ...current.terminology, [termKey.trim()]: termVal.trim() });
    setTermKey(''); setTermVal('');
  }

  function removeTerm(key: string) {
    const t = { ...(current.terminology ?? {}) };
    delete t[key];
    set('terminology', t);
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-4" aria-hidden="true">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={3} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-sm text-fg-muted flex items-center gap-1 flex-wrap">
        <span>Tell the AI about your business so every AI feature speaks your language and understands your domain.</span>
        <AiInfo id="studio.context" />
      </p>

      {/* Industry */}
      <Field label="Industry">
        <Select
          value={current.industry ?? ''}
          onChange={e => set('industry', e.target.value)}
          placeholder="Select your industry…"
        >
          {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
        </Select>
      </Field>

      {/* Company description */}
      <Field label="Company Description">
        <Textarea
          rows={3}
          value={current.companyDesc ?? ''}
          onChange={e => set('companyDesc', e.target.value)}
          placeholder="Briefly describe what your company does, who your customers are, and your main business goals…"
          className="resize-none"
        />
      </Field>

      {/* Tone */}
      <Field label="AI Response Tone">
        <Tabs
          items={TONES}
          value={(current.tone ?? 'professional') as typeof TONES[number]['key']}
          onChange={t => set('tone', t)}
          variant="segmented"
          aria-label="AI Response Tone"
        />
      </Field>

      {/* Domain Terminology */}
      <Field
        label="Domain Terminology"
        hint={'Teach the AI your company’s specific terms. E.g., "policy" = "insurance coverage", "client" = "patient".'}
      >
        <div className="flex gap-2 mb-2">
          <Input
            className="flex-1"
            aria-label="Term"
            value={termKey}
            onChange={e => setTermKey(e.target.value)}
            placeholder="Term (e.g. patient)"
          />
          <Input
            className="flex-1"
            aria-label="Meaning"
            value={termVal}
            onChange={e => setTermVal(e.target.value)}
            placeholder="Means (e.g. customer with active policy)"
          />
          <Button onClick={addTerm}>Add</Button>
        </div>
        {Object.entries(current.terminology ?? {}).length > 0 && (
          <div className="space-y-1">
            {Object.entries(current.terminology ?? {}).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 bg-surface-sunken rounded-btn px-3 py-1.5 text-sm">
                <span className="font-medium text-fg">{k}</span>
                <span className="text-fg-subtle">→</span>
                <span className="text-fg-muted flex-1">{v as string}</span>
                <IconButton
                  size="xs"
                  tone="danger"
                  label={`Remove ${k}`}
                  onClick={() => removeTerm(k)}
                  icon={<X size={14} />}
                />
              </div>
            ))}
          </div>
        )}
      </Field>

      {/* Extra system context */}
      <Field label="Additional AI Instructions">
        <Textarea
          rows={3}
          value={current.customSystem ?? ''}
          onChange={e => set('customSystem', e.target.value)}
          placeholder="Any extra instructions injected into every AI prompt. E.g., 'Always comply with HIPAA guidelines. Never suggest specific medications.'"
          className="resize-none"
        />
      </Field>

      <Button size="lg" icon={<Save size={16} />} onClick={() => save.mutate(current)} loading={save.isPending}>
        Save Business Context
      </Button>
      {save.isSuccess && (
        <Alert tone="success">Saved — all AI features now use this context.</Alert>
      )}

      {/* The old "Generate Setup" section lived here — the Solution Builder
          replaced it with a far bigger version of the same idea. */}
      <div className="pt-5 mt-5 border-t border-line-subtle">
        <Alert tone="info">
          Want AI to design terminology, custom modules, pipelines and automations from your business
          description? That moved to the{' '}
          <Link to="/solution-builder" className="font-medium text-accent hover:underline">AI Solution Builder</Link>
          {' '}— it reads the context you save here.
        </Alert>
      </div>
    </div>
  );
}

// ─── Tab: Custom AI Functions ─────────────────────────────────────────────────

const EMPTY_FN: Partial<CustomAIFunction> = {
  name: '', description: '', systemPrompt: '', inputSchema: [], outputType: 'text', isActive: true,
};

function FunctionEditor({ fn, onClose }: { fn: Partial<CustomAIFunction>; onClose: () => void }) {
  const [form, setForm]       = useState({ ...EMPTY_FN, ...fn });
  const [newField, setNewField] = useState<Partial<InputField>>({ name: '', type: 'text', label: '', required: false });
  const [testInputs, setTestInputs] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState('');
  const [testing, setTesting] = useState(false);

  const createFn = useCreateFunction();
  const updateFn = useUpdateFunction();
  const runFn    = useRunFunction();

  function set(k: string, v: any) { setForm(p => ({ ...p, [k]: v })); }

  function addField() {
    if (!newField.name || !newField.label) return;
    set('inputSchema', [...(form.inputSchema ?? []), { ...newField }]);
    setNewField({ name: '', type: 'text', label: '', required: false });
  }

  function removeField(idx: number) {
    set('inputSchema', (form.inputSchema ?? []).filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (fn.id) await updateFn.mutateAsync({ id: fn.id, ...form });
    else       await createFn.mutateAsync(form);
    onClose();
  }

  async function handleTest() {
    if (!fn.id) return;
    setTesting(true);
    setTestResult('');
    try {
      const r = await runFn.mutateAsync({ id: fn.id, inputs: testInputs });
      setTestResult(typeof r.output === 'string' ? r.output : JSON.stringify(r.output, null, 2));
    } catch {
      setTestResult('Error running function.');
    } finally {
      setTesting(false);
    }
  }

  const isSaving = createFn.isPending || updateFn.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={fn.id ? 'Edit Function' : 'New Custom AI Function'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            loading={isSaving}
            disabled={!form.name || !form.systemPrompt}
          >
            {isSaving ? 'Saving…' : fn.id ? 'Save Changes' : 'Create Function'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Function Name" required>
          <Input
            value={form.name ?? ''}
            onChange={e => set('name', e.target.value)}
            placeholder="e.g. Classify Patient Urgency"
          />
        </Field>
        <Field label="Description">
          <Input
            value={form.description ?? ''}
            onChange={e => set('description', e.target.value)}
            placeholder="What does this function do?"
          />
        </Field>
        <Field label="System Prompt" required>
          <Textarea
            rows={5}
            value={form.systemPrompt ?? ''}
            onChange={e => set('systemPrompt', e.target.value)}
            placeholder="You are a helpful assistant specializing in… Analyze the provided inputs and return…"
            className="resize-none font-mono"
          />
        </Field>
        <Field label="Output Type" className="sm:w-1/2">
          <Select value={form.outputType ?? 'text'} onChange={e => set('outputType', e.target.value)}>
            {OUTPUT_TYPES.map(t => <option key={t}>{t}</option>)}
          </Select>
        </Field>

        {/* Input Schema */}
        <Field label="Input Fields">
          {(form.inputSchema ?? []).map((f, i) => (
            <div key={i} className="flex items-center gap-2 mb-1 bg-surface-sunken rounded-btn px-3 py-1.5 text-sm">
              <span className="font-medium text-fg w-24 truncate">{f.label}</span>
              <span className="text-fg-subtle text-xs font-mono">{f.name}</span>
              <Badge variant="gray" size="sm">{f.type}</Badge>
              {f.required && <Badge variant="red" size="sm">required</Badge>}
              <IconButton
                size="xs"
                tone="danger"
                className="ml-auto"
                label={`Remove ${f.label}`}
                onClick={() => removeField(i)}
                icon={<X size={12} />}
              />
            </div>
          ))}
          <div className="flex gap-2 mt-2">
            <Input
              inputSize="sm"
              className="w-28 font-mono"
              aria-label="Field name"
              value={newField.name ?? ''}
              onChange={e => setNewField(p => ({ ...p, name: e.target.value }))}
              placeholder="field_name"
            />
            <Input
              inputSize="sm"
              className="flex-1"
              aria-label="Field label"
              value={newField.label ?? ''}
              onChange={e => setNewField(p => ({ ...p, label: e.target.value }))}
              placeholder="Label"
            />
            <Select
              selectSize="sm"
              className="w-24"
              aria-label="Field type"
              value={newField.type ?? 'text'}
              onChange={e => setNewField(p => ({ ...p, type: e.target.value as any }))}
            >
              {FIELD_TYPES.map(t => <option key={t}>{t}</option>)}
            </Select>
            <Button size="sm" onClick={addField}>Add</Button>
          </div>
        </Field>

        {/* Test panel */}
        {fn.id && (
          <Card padding="sm" tone="sunken" flat className="border-dashed">
            <p className="text-xs font-medium text-fg-muted mb-3">Test this function</p>
            {(form.inputSchema ?? []).map(f => (
              <Field key={f.name} label={f.label} className="mb-2">
                <Input
                  inputSize="sm"
                  value={testInputs[f.name] ?? ''}
                  onChange={e => setTestInputs(p => ({ ...p, [f.name]: e.target.value }))}
                />
              </Field>
            ))}
            {!form.inputSchema?.length && (
              <Input
                inputSize="sm"
                className="mb-2"
                aria-label="Test input text"
                value={testInputs['text'] ?? ''}
                onChange={e => setTestInputs({ text: e.target.value })}
                placeholder="Enter test input text…"
              />
            )}
            <Button size="sm" icon={<Play size={13} />} onClick={handleTest} loading={testing}>
              Run Test
            </Button>
            {testResult && (
              <div className="mt-3">
                <AiGeneratedTag className="mb-1.5" />
                <pre className="rounded-btn p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap border border-line bg-surface text-fg">
                  {testResult}
                </pre>
              </div>
            )}
          </Card>
        )}
      </div>
    </Modal>
  );
}

function FunctionsTab() {
  const { user } = useAuth();
  const { data: fns = [], isLoading } = useCustomFunctions(can.readAiConfig(user?.role));
  const deleteFn = useDeleteFunction();
  const updateFn = useUpdateFunction();
  const [editing, setEditing] = useState<Partial<CustomAIFunction> | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-3" aria-hidden="true">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </div>
    );
  }

  return (
    <div>
      <Toolbar
        className="mb-4"
        right={
          <Button icon={<Plus size={15} />} onClick={() => setEditing(EMPTY_FN)}>
            New Function
          </Button>
        }
      >
        <p className="text-sm text-fg-muted flex items-center gap-1">
          Build reusable AI functions your team can call across the product.
          <AiInfo id="studio.function" />
        </p>
      </Toolbar>

      {fns.length === 0 ? (
        <EmptyState
          icon={<Zap />}
          title="No custom functions yet"
          description="Create your first AI function to get started."
          action={{ label: 'New Function', onClick: () => setEditing(EMPTY_FN) }}
        />
      ) : (
        <div className="space-y-3">
          {fns.map(fn => (
            <Card key={fn.id} data-testid="ai-function-card" padding="sm" className={fn.isActive ? '' : 'opacity-60'}>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-btn bg-accent-soft flex items-center justify-center flex-shrink-0">
                  <Zap size={15} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-fg text-sm">{fn.name}</span>
                    <Badge variant="gray" size="sm">{fn.outputType}</Badge>
                    {fn.runCount > 0 && (
                      <span className="text-xs text-fg-subtle tabular-nums">{fn.runCount} runs</span>
                    )}
                  </div>
                  {fn.description && <p className="text-xs text-fg-muted">{fn.description}</p>}
                  {fn.inputSchema?.length > 0 && (
                    <p className="text-xs text-fg-subtle mt-1">
                      Inputs: {fn.inputSchema.map(f => f.label).join(', ')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <IconButton
                    label={fn.isActive ? 'Disable' : 'Enable'}
                    tone="accent"
                    onClick={() => updateFn.mutate({ id: fn.id, isActive: !fn.isActive })}
                    icon={fn.isActive ? <ToggleRight size={18} className="text-accent" /> : <ToggleLeft size={18} />}
                  />
                  <IconButton label="Edit function" tone="accent" onClick={() => setEditing(fn)} icon={<Pencil size={15} />} />
                  <IconButton
                    label="Delete function"
                    tone="danger"
                    onClick={() => { if (window.confirm('Delete this function?')) deleteFn.mutate(fn.id); }}
                    icon={<Trash2 size={15} />}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && <FunctionEditor fn={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ─── Tab: Custom Scripts ──────────────────────────────────────────────────────

const EMPTY_SCRIPT: Partial<CustomScript> = {
  name: '', description: '', entityType: 'ticket', trigger: 'onLoad',
  script: SCRIPT_TEMPLATE, isActive: true,
};

function ScriptEditor({ script, onClose }: { script: Partial<CustomScript>; onClose: () => void }) {
  const [form, setForm] = useState({ ...EMPTY_SCRIPT, ...script });
  const [validation, setValidation] = useState<{ valid: boolean; error?: string } | null>(null);

  const createScript = useCreateScript();
  const updateScript = useUpdateScript();
  const validate     = useValidateScript();

  function set(k: string, v: any) { setForm(p => ({ ...p, [k]: v })); }

  async function handleValidate() {
    const r = await validate.mutateAsync(form.script ?? '');
    setValidation(r);
  }

  async function handleSave() {
    if (script.id) await updateScript.mutateAsync({ id: script.id, ...form });
    else           await createScript.mutateAsync(form);
    onClose();
  }

  const isSaving = createScript.isPending || updateScript.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={script.id ? 'Edit Script' : 'New Custom Script'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={isSaving} disabled={!form.name || !form.script}>
            {isSaving ? 'Saving…' : script.id ? 'Save Changes' : 'Create Script'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Script Name" required>
          <Input
            value={form.name ?? ''}
            onChange={e => set('name', e.target.value)}
            placeholder="e.g. Auto-set priority from keywords"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Entity Type">
            <Select value={form.entityType ?? 'ticket'} onChange={e => set('entityType', e.target.value)} className="capitalize">
              {ENTITY_TYPES.map(t => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Trigger">
            <Select value={form.trigger ?? 'onLoad'} onChange={e => set('trigger', e.target.value)}>
              {TRIGGERS.map(t => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          {form.trigger === 'onFieldChange' && (
            <Field label={<>Field Target <span className="text-fg-subtle">(leave blank for all fields)</span></>}>
              <Input
                value={form.fieldTarget ?? ''}
                onChange={e => set('fieldTarget', e.target.value)}
                placeholder="e.g. priority"
                className="font-mono"
              />
            </Field>
          )}
        </div>

        <Field label="Description">
          <Input
            value={form.description ?? ''}
            onChange={e => set('description', e.target.value)}
            placeholder="What does this script do?"
          />
        </Field>

        {/* Code editor */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="form-label !mb-0">Script <span className="text-fg-subtle">(JavaScript)</span></label>
            <Button
              variant="ghost"
              size="xs"
              icon={<CheckCircle2 size={12} />}
              onClick={handleValidate}
              loading={validate.isPending}
              className="!text-accent"
            >
              Validate syntax
            </Button>
          </div>
          <Textarea
            rows={14}
            value={form.script ?? ''}
            onChange={e => { set('script', e.target.value); setValidation(null); }}
            aria-label="Script (JavaScript)"
            className={CODE_SURFACE}
            spellCheck={false}
          />
          {validation && (
            <div className={`mt-1.5 flex items-center gap-1.5 text-xs ${validation.valid ? 'text-success' : 'text-danger'}`}>
              {validation.valid
                ? <><CheckCircle2 size={13} /> Syntax OK — script is valid</>
                : <><XCircle size={13} /> {validation.error}</>
              }
            </div>
          )}
        </div>

        {/* Context reference */}
        <details className="text-xs text-fg-muted">
          <summary className="cursor-pointer font-medium text-fg-muted hover:text-fg">Available context API</summary>
          <pre className="mt-2 bg-surface-sunken border border-line-subtle rounded-btn p-3 text-xs overflow-x-auto font-mono text-fg">{`context.entity          // current form data (object)
context.field           // { name, value } — only on onFieldChange
context.user            // { id, name, role }
context.setValue(field, value)   // set a form field
context.setError(field, message) // show validation error
context.notify(msg, type?)       // toast: info|success|warning|error
await context.ai(prompt)         // call AI, returns string`}</pre>
        </details>
      </div>
    </Modal>
  );
}

function ScriptsTab() {
  const { user } = useAuth();
  const { data: scripts = [], isLoading } = useCustomScripts(undefined, undefined, can.readAiConfig(user?.role));
  const deleteScript = useDeleteScript();
  const updateScript = useUpdateScript();
  const [editing, setEditing] = useState<Partial<CustomScript> | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-3" aria-hidden="true">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </div>
    );
  }

  return (
    <div>
      <Toolbar
        className="mb-4"
        right={
          <Button icon={<Plus size={15} />} onClick={() => setEditing(EMPTY_SCRIPT)}>
            New Script
          </Button>
        }
      >
        <p className="text-sm text-fg-muted">
          Write JavaScript that runs on form events — auto-fill fields, validate inputs, call AI, or show notifications.
        </p>
      </Toolbar>

      {scripts.length === 0 ? (
        <EmptyState
          icon={<Code2 />}
          title="No custom scripts yet"
          description="Create scripts to automate form behaviour across your CRM & IT Desk forms."
          action={{ label: 'New Script', onClick: () => setEditing(EMPTY_SCRIPT) }}
        />
      ) : (
        <div className="space-y-3">
          {scripts.map(s => (
            <Card key={s.id} data-testid="ai-script-card" padding="sm" className={s.isActive ? '' : 'opacity-60'}>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-btn bg-success-soft flex items-center justify-center flex-shrink-0">
                  <Code2 size={15} className="text-success" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="font-semibold text-fg text-sm">{s.name}</span>
                    <Badge variant="green" size="sm" className="capitalize">{s.entityType}</Badge>
                    <Badge variant="blue" size="sm">{s.trigger}</Badge>
                    {s.fieldTarget && (
                      <Badge variant="gray" size="sm" className="font-mono">.{s.fieldTarget}</Badge>
                    )}
                  </div>
                  {s.description && <p className="text-xs text-fg-muted">{s.description}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <IconButton
                    label={s.isActive ? 'Disable' : 'Enable'}
                    tone="accent"
                    onClick={() => updateScript.mutate({ id: s.id, isActive: !s.isActive })}
                    icon={s.isActive ? <ToggleRight size={18} className="text-accent" /> : <ToggleLeft size={18} />}
                  />
                  <IconButton label="Edit script" tone="accent" onClick={() => setEditing(s)} icon={<Pencil size={15} />} />
                  <IconButton
                    label="Delete script"
                    tone="danger"
                    onClick={() => { if (window.confirm('Delete this script?')) deleteScript.mutate(s.id); }}
                    icon={<Trash2 size={15} />}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && <ScriptEditor script={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'context'   as const, label: 'Business Context', icon: <Building2 size={15} /> },
  { key: 'functions' as const, label: 'Custom Functions',  icon: <Zap size={15} /> },
  { key: 'scripts'   as const, label: 'Custom Scripts',    icon: <Code2 size={15} /> },
];

type TabId = typeof TABS[number]['key'];

export default function AIStudioPage() {
  const [tab, setTab] = useState<TabId>('context');
  /* Context, functions and scripts are all MANAGERS-only reads, and so is every
     write behind the editors here — the whole page is unusable for anyone else. */
  const { user } = useAuth();
  if (!can.readAiConfig(user?.role)) return <AccessDenied />;

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="AI Studio"
        subtitle="Configure your AI to match your domain, build custom functions, and automate forms"
        below={<Tabs items={TABS} value={tab} onChange={setTab} variant="segmented" fill aria-label="AI Studio section" />}
      />

      <PageBody width="narrow">
        {tab === 'context'   && <BusinessContextTab />}
        {tab === 'functions' && <FunctionsTab />}
        {tab === 'scripts'   && <ScriptsTab />}
      </PageBody>
    </div>
  );
}
