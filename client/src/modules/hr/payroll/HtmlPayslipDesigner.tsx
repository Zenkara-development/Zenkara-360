import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Code, Eye, Save, FileDown, RotateCcw, X, Check, Palette, Braces, Users, FileCode2,
} from 'lucide-react';
import {
  Button, Field, Input, Textarea, Alert, Label,
} from '../../../shared/components';
import { CodeEditor, type CodeEditorHandle } from '../../../shared/components/CodeEditor';
import { api } from '../../../api/client';
import { downloadPdfPost } from '../../../api/payslipTemplates';
import { useDepartments, useLocations, useEmployees } from '../../../api/people';
import { useDebounce } from '../../../hooks/useDebounce';
import {
  useCustomStarter, useSaveTemplate,
  type CustomMeta, type CustomPayload, type PayslipTemplate,
} from '../../../api/payslipTemplates';

/**
 * The custom HTML payslip designer.
 *
 * A full-screen editor where an administrator writes the payslip's own
 * HTML and CSS, with a live A4 preview of the result. The preview is
 * rendered by the server from the same markup the PDF is produced from, so
 * what is on screen is what the employee will get.
 *
 * The four tabs cover the four things a payslip needs decided: the markup
 * itself, the branding around it, the data it shows, and who it applies to.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  /** An existing custom template being edited; null starts a new one. */
  template?: PayslipTemplate | null;
  custom: CustomMeta;
  onSaved?: () => void;
}

type Tab = 'html' | 'branding' | 'fields' | 'applies';
type CodeTab = 'html' | 'css';

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT', 'TEMPORARY'];
const human = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());

/** A4 at 96dpi — the size the preview is drawn at. */
const PAGE = { portrait: { w: 794, h: 1123 }, landscape: { w: 1123, h: 794 } };

interface Draft {
  name: string;
  html: string;
  css: string;
  orientation: 'portrait' | 'landscape';
  fontFamily: string;
  companyName: string;
  companyAddress: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  headerTitle: string;
  headerNote: string;
  footerNote: string;
  signatoryName: string;
  signatureLabel: string;
  departmentIds: string[];
  locationIds: string[];
  employmentTypes: string[];
  userIds: string[];
}

const emptyDraft = (): Draft => ({
  name: '', html: '', css: '', orientation: 'portrait', fontFamily: 'Helvetica, Arial, sans-serif',
  companyName: '', companyAddress: '', logoUrl: '', primaryColor: '#1e3a8a', accentColor: '',
  headerTitle: 'Payslip', headerNote: '', footerNote: '', signatoryName: '', signatureLabel: 'Authorized Signatory',
  departmentIds: [], locationIds: [], employmentTypes: [], userIds: [],
});

export function HtmlPayslipDesigner({ open, onClose, template, custom, onSaved }: Props) {
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [tab, setTab] = useState<Tab>('html');
  const [codeTab, setCodeTab] = useState<CodeTab>('html');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewError, setPreviewError] = useState('');
  const editorRef = useRef<CodeEditorHandle>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);

  const { data: starter } = useCustomStarter(open);
  const { data: departments } = useDepartments();
  const { data: locations } = useLocations();
  const { data: employees } = useEmployees({ limit: '200' });
  const [employeeQuery, setEmployeeQuery] = useState('');
  const save = useSaveTemplate();

  // Start from the existing template, or from the starter template.
  useEffect(() => {
    if (!open) return;
    const t = template as any;
    const payload = t?.showFields?._custom;
    setDraft({
      ...emptyDraft(),
      name: t?.name ?? '',
      html: payload?.html ?? '',
      css: payload?.css ?? '',
      orientation: payload?.orientation === 'landscape' ? 'landscape' : 'portrait',
      fontFamily: payload?.fontFamily ?? 'Helvetica, Arial, sans-serif',
      companyName: t?.companyName ?? '',
      companyAddress: t?.companyAddress ?? '',
      logoUrl: t?.logoUrl ?? '',
      primaryColor: t?.primaryColor ?? '#1e3a8a',
      accentColor: t?.accentColor ?? '',
      headerTitle: t?.headerTitle ?? 'Payslip',
      headerNote: t?.headerNote ?? '',
      footerNote: t?.footerNote ?? '',
      signatoryName: t?.signatoryName ?? '',
      signatureLabel: t?.signatureLabel ?? 'Authorized Signatory',
      departmentIds: t?.applicability?.departmentIds ?? [],
      locationIds: t?.applicability?.locationIds ?? [],
      employmentTypes: t?.applicability?.employmentTypes ?? [],
      userIds: t?.applicability?.userIds ?? [],
    });
    setTab('html');
    setCodeTab('html');
    setNotice(null);
  }, [open, template]);

  // Load the starter template once it arrives, for a brand-new template.
  const loadedStarter = useRef(false);
  useEffect(() => {
    if (!open || !starter || template || loadedStarter.current) return;
    loadedStarter.current = true;
    setDraft(d => ({ ...d, html: starter.html, css: starter.css }));
  }, [open, starter, template]);

  const payload = useMemo<CustomPayload>(() => ({
    html: draft.html,
    css: draft.css,
    orientation: draft.orientation,
    fontFamily: draft.fontFamily,
  }), [draft.html, draft.css, draft.orientation, draft.fontFamily]);

  // The live preview: the server renders the draft with real payslip data.
  const debouncedPayload = useDebounce(payload, 500);
  useEffect(() => {
    if (!open) return;
    // Nothing to preview yet — an empty document is not an error.
    if (!debouncedPayload.html.trim()) { setPreviewHtml(''); setPreviewError(''); return; }
    let cancelled = false;
    api.post('/hr/payroll/templates/preview', {
      name: draft.name || 'Untitled',
      layout: 'CUSTOM_HTML',
      custom: debouncedPayload,
      ...brandingFields(draft),
    })
      .then(r => {
        if (cancelled) return;
        setPreviewHtml(r.data?.html ?? '');
        setPreviewError('');
      })
      .catch(e => {
        if (cancelled) return;
        setPreviewError(e?.response?.data?.error || 'The preview could not be rendered.');
      });
    return () => { cancelled = true; };
  }, [open, debouncedPayload, draft.name, draft.companyName, draft.companyAddress, draft.logoUrl,
      draft.primaryColor, draft.accentColor, draft.headerTitle, draft.headerNote, draft.footerNote,
      draft.signatoryName, draft.signatureLabel]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }));

  function applyStarter() {
    if (!starter) return;
    setDraft(d => ({ ...d, html: starter.html, css: starter.css }));
    setNotice({ tone: 'success', text: 'Starter template loaded. Your changes since the last save are replaced.' });
  }

  function insertVariable(key: string) {
    const snippet = key.startsWith('#') ? `{{#${key.slice(1)}}}…{{/${key.slice(1)}}}` : `{{${key}}}`;
    editorRef.current?.insert(snippet);
    setCodeTab('html');
    setTab('html');
  }

  async function downloadSample(openPdf: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      await downloadPdfPost(
        '/hr/payroll/templates/preview?format=pdf',
        { name: draft.name || 'Sample', layout: 'CUSTOM_HTML', custom: payload, ...brandingFields(draft) },
        `${(draft.name || 'payslip').replace(/\s+/g, '-').toLowerCase()}-sample.pdf`,
        openPdf,
      );
      setNotice({ tone: 'success', text: openPdf ? 'PDF opened in a new tab.' : 'Sample PDF downloaded.' });
    } catch (e: any) {
      setNotice({ tone: 'danger', text: e?.response?.data?.error || 'The PDF could not be generated.' });
    } finally {
      setBusy(false);
    }
  }

  async function persist(closeAfter: boolean) {
    if (!draft.name.trim()) {
      setNotice({ tone: 'danger', text: 'Give the template a name before saving.' });
      setTab('html');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await save.mutateAsync({
        id: template?.id,
        name: draft.name.trim(),
        layout: 'CUSTOM_HTML',
        isDefault: false,
        isActive: true,
        companyName: draft.companyName || null,
        companyAddress: draft.companyAddress || null,
        logoUrl: draft.logoUrl || null,
        primaryColor: draft.primaryColor,
        accentColor: draft.accentColor || null,
        headerTitle: draft.headerTitle,
        headerNote: draft.headerNote || null,
        footerNote: draft.footerNote || null,
        showSignature: true,
        signatureLabel: draft.signatureLabel,
        signatoryName: draft.signatoryName || null,
        signatureUrl: null,
        showFields: {},
        custom: payload,
        applicability: {
          departmentIds: draft.departmentIds,
          locationIds: draft.locationIds,
          employmentTypes: draft.employmentTypes,
          userIds: draft.userIds,
        },
      } as any);
      setNotice({ tone: 'success', text: closeAfter ? 'Template created.' : 'Draft saved.' });
      onSaved?.();
      if (closeAfter) onClose();
    } catch (e: any) {
      setNotice({ tone: 'danger', text: e?.response?.data?.error || 'The template could not be saved.' });
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const page = PAGE[draft.orientation];
  const htmlChars = draft.html.length;
  const cssChars = draft.css.length;
  const overHtml = htmlChars > custom.maxHtmlChars;
  const overCss = cssChars > custom.maxCssChars;

  return (
    <div className="fixed inset-0 z-[60] bg-surface flex flex-col" role="dialog" aria-label="HTML payslip designer">
      {/* header */}
      <div className="flex items-center gap-3 px-5 h-14 border-b border-line shrink-0">
        <FileCode2 size={18} className="text-accent" />
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-fg truncate">
            {template ? `Edit payslip template · ${template.name}` : 'Start from HTML'}
          </h2>
          <p className="text-[11.5px] text-fg-subtle">Write the payslip yourself — HTML, CSS, branding, data and who it applies to.</p>
        </div>
        <span className="ml-auto" />
        <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={onClose}>Cancel</Button>
      </div>

      {/* body */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden">
        {/* editor side */}
        <div className="flex flex-col overflow-hidden border-r border-line">
          <div className="flex gap-1 px-5 pt-3 border-b border-line-subtle">
            {([
              ['html', 'HTML', <Code key="a" size={13} />],
              ['branding', 'Branding', <Palette key="b" size={13} />],
              ['fields', 'Fields', <Braces key="c" size={13} />],
              ['applies', 'Applies To', <Users key="d" size={13} />],
            ] as const).map(([key, label, icon]) => (
              <button
                key={key}
                type="button"
                data-testid={`designer-tab-${key}`}
                onClick={() => setTab(key)}
                className={`px-3 py-2 text-[12.5px] font-medium border-b-2 -mb-px inline-flex items-center gap-1.5 ${tab === key ? 'border-accent text-fg' : 'border-transparent text-fg-subtle hover:text-fg'}`}
              >
                {icon}{label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {notice && <Alert tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}

            {tab === 'html' && (
              <>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {(['html', 'css'] as const).map(t => (
                      <button
                        key={t}
                        type="button"
                        data-testid={`designer-code-${t}`}
                        onClick={() => setCodeTab(t)}
                        className={`px-2.5 py-1 rounded-btn text-[11.5px] font-medium ${codeTab === t ? 'bg-accent-soft text-accent-soft-fg' : 'text-fg-subtle hover:text-fg'}`}
                      >
                        {t === 'html' ? 'HTML' : 'CSS'}
                      </button>
                    ))}
                  </div>
                  <span className="ml-auto" />
                  <Button size="sm" variant="ghost" data-testid="designer-starter" icon={<RotateCcw size={12} />} onClick={applyStarter} disabled={!starter}>
          Starter template
        </Button>
                </div>

                {codeTab === 'html' ? (
                  <>
                    <CodeEditor
                      ref={editorRef}
                      language="html"
                      value={draft.html}
                      onChange={v => set('html', v)}
                      height={340}
                      ariaLabel="Payslip HTML"
                      placeholder="<div class=&quot;letterhead&quot;>…</div>"
                    />
                    <p className="text-[11.5px] text-fg-subtle tabular-nums">
                      {htmlChars.toLocaleString()} / {custom.maxHtmlChars.toLocaleString()} characters
                      {overHtml && <span className="text-danger"> — over the limit</span>}
                    </p>
                  </>
                ) : (
                  <>
                    <CodeEditor
                      language="css"
                      value={draft.css}
                      onChange={v => set('css', v)}
                      height={340}
                      ariaLabel="Payslip CSS"
                      placeholder=".letterhead { … }"
                    />
                    <p className="text-[11.5px] text-fg-subtle tabular-nums">
                      {cssChars.toLocaleString()} / {custom.maxCssChars.toLocaleString()} characters
                      {overCss && <span className="text-danger"> — over the limit</span>}
                    </p>
                  </>
                )}

                <Alert tone="info" title="How the data reaches your markup">
                  <p className="mb-1">Write <code className="font-mono">{'{{employee.name}}'}</code> for a value and
                    <code className="font-mono">{'{{#earnings}}…{{/earnings}}'}</code> to repeat a block for every
                    line. The Fields tab lists them all — click one to drop it where your cursor is.</p>
                  <p>The server checks the markup before it is saved, and the PDF is generated from this same markup,
                    so the preview and the payslip agree.</p>
                </Alert>
              </>
            )}

            {tab === 'branding' && (
              <>
                <Field label="Template name" required>
                  <Input value={draft.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Head office payslip" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Primary colour">
                    <div className="flex items-center gap-2">
                      <input type="color" value={draft.primaryColor} onChange={e => set('primaryColor', e.target.value)} className="w-9 h-9 rounded-input border border-line cursor-pointer shrink-0" />
                      <Input value={draft.primaryColor} onChange={e => set('primaryColor', e.target.value)} />
                    </div>
                  </Field>
                  <Field label="Accent colour" hint="Blank = primary">
                    <div className="flex items-center gap-2">
                      <input type="color" value={draft.accentColor || draft.primaryColor} onChange={e => set('accentColor', e.target.value)} className="w-9 h-9 rounded-input border border-line cursor-pointer shrink-0" />
                      <Input value={draft.accentColor} onChange={e => set('accentColor', e.target.value)} placeholder="optional" />
                    </div>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Page orientation">
                    <select
                      value={draft.orientation}
                      onChange={e => set('orientation', e.target.value as 'portrait' | 'landscape')}
                      className="w-full h-ctl rounded-input border border-line bg-surface px-3 text-[13px] text-fg"
                    >
                      <option value="portrait">A4 portrait</option>
                      <option value="landscape">A4 landscape</option>
                    </select>
                  </Field>
                  <Field label="Font family" hint="Used by the preview and the PDF">
                    <Input value={draft.fontFamily} onChange={e => set('fontFamily', e.target.value)} placeholder="Helvetica, Arial, sans-serif" />
                  </Field>
                </div>
                <Field label="Company name" hint="Blank = your organisation name">
                  <Input value={draft.companyName} onChange={e => set('companyName', e.target.value)} />
                </Field>
                <Field label="Company address">
                  <Textarea rows={2} value={draft.companyAddress} onChange={e => set('companyAddress', e.target.value)} />
                </Field>
                <Field label="Logo URL" hint="An image URL, or leave blank">
                  <Input value={draft.logoUrl} onChange={e => set('logoUrl', e.target.value)} placeholder="https://…" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Document title">
                    <Input value={draft.headerTitle} onChange={e => set('headerTitle', e.target.value)} />
                  </Field>
                  <Field label="Signatory name">
                    <Input value={draft.signatoryName} onChange={e => set('signatoryName', e.target.value)} placeholder="e.g. R. Menon" />
                  </Field>
                </div>
                <Field label="Header note">
                  <Input value={draft.headerNote} onChange={e => set('headerNote', e.target.value)} placeholder="Confidential — for the employee only" />
                </Field>
                <Field label="Footer note">
                  <Textarea rows={2} value={draft.footerNote} onChange={e => set('footerNote', e.target.value)} />
                </Field>
              </>
            )}

            {tab === 'fields' && (
              <>
                <p className="text-[12px] text-fg-subtle">Click a field to insert it into the HTML where your cursor is.</p>
                {(['Employee', 'Payslip', 'Attendance', 'Totals', 'Company', 'Blocks'] as const).map(group => {
                  const vars = custom.variables.filter(v => v.group === group);
                  if (!vars.length) return null;
                  return (
                    <div key={group}>
                      <Label className="mb-1.5">{group}</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {vars.map(v => (
                          <button
                            key={v.key}
                            type="button"
                            title={v.hint || v.key}
                            onClick={() => insertVariable(v.key)}
                            className="text-left px-2.5 py-1.5 rounded-btn border border-line-subtle hover:border-line-strong hover:bg-surface-hover"
                          >
                            <span className="block text-[12px] text-fg">{v.label}</span>
                            <span className="block font-mono text-[10.5px] text-fg-subtle truncate">{`{{${v.key}}}`}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {tab === 'applies' && (
              <>
                <p className="text-[12px] text-fg-subtle">
                  An employee gets this template when they match <strong>every</strong> group you pick. A blank group
                  means "any". Leave everything blank to keep it unassigned — it will then only be used when it is the
                  default.
                </p>
                <Field label="Departments">
                  <Chips items={departments?.data?.map(d => ({ id: d.id, label: d.name })) ?? []} selected={draft.departmentIds}
                    onToggle={id => set('departmentIds', draft.departmentIds.includes(id) ? draft.departmentIds.filter(x => x !== id) : [...draft.departmentIds, id])}
                    empty="No departments yet" />
                </Field>
                <Field label="Locations / branches">
                  <Chips items={locations?.data?.map(l => ({ id: l.id, label: l.name })) ?? []} selected={draft.locationIds}
                    onToggle={id => set('locationIds', draft.locationIds.includes(id) ? draft.locationIds.filter(x => x !== id) : [...draft.locationIds, id])}
                    empty="No locations yet" />
                </Field>
                <Field label="Employment types">
                  <Chips items={EMPLOYMENT_TYPES.map(t => ({ id: t, label: human(t) }))} selected={draft.employmentTypes}
                    onToggle={id => set('employmentTypes', draft.employmentTypes.includes(id) ? draft.employmentTypes.filter(x => x !== id) : [...draft.employmentTypes, id])}
                    empty="No employment types yet" />
                </Field>
                <Field label="Specific employees" hint="Pin the template to named people — they get it even if no group matches.">
                  <Input
                    value={employeeQuery}
                    onChange={e => setEmployeeQuery(e.target.value)}
                    placeholder="Search employees…"
                    className="mb-2"
                    aria-label="Search employees"
                  />
                  <Chips
                    items={(employees?.data ?? [])
                      .filter(e => !employeeQuery || (e.displayName + ' ' + e.employeeCode).toLowerCase().indexOf(employeeQuery.toLowerCase()) !== -1)
                      .map(e => ({ id: e.userId ?? '', label: e.displayName }))}
                    selected={draft.userIds}
                    onToggle={id => set('userIds', draft.userIds.includes(id) ? draft.userIds.filter(x => x !== id) : [...draft.userIds, id])}
                    empty="No employees yet"
                  />
                </Field>
              </>
            )}
          </div>
        </div>

        {/* preview side */}
        <div className="flex flex-col overflow-hidden bg-surface-sunken">
          <div className="flex items-center justify-between px-5 py-3 border-b border-line-subtle shrink-0">
            <span className="text-[12.5px] font-medium text-fg">Live preview</span>
            <span className="text-[11.5px] text-fg-subtle">
              A4 {draft.orientation} · {page.w}×{page.h}
            </span>
          </div>
          <div className="flex-1 overflow-auto p-5 flex justify-center">
            {previewError ? (
              <div className="w-full max-w-lg">
                <Alert tone="danger" title="The preview could not be rendered">
                  {previewError}
                </Alert>
              </div>
            ) : (
              <div
                className="bg-white shadow-lg origin-top shrink-0"
                style={{ width: page.w, height: page.h, transform: 'scale(var(--preview-scale, 0.62))' }}
              >
                <iframe
                  ref={previewRef}
                  title="Payslip preview"
                  className="w-full h-full border-0 bg-white"
                  sandbox=""
                  srcDoc={previewHtml || '<!doctype html><html><body style="font-family:sans-serif;color:#9ca3af;padding:40px">Loading the preview…</body></html>'}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="flex items-center gap-2 px-5 h-16 border-t border-line shrink-0">
        <Button size="sm" variant="ghost" data-testid="designer-download-pdf" icon={<FileDown size={14} />} loading={busy} onClick={() => downloadSample(false)}>
          Download sample PDF
        </Button>
        <Button size="sm" variant="ghost" data-testid="designer-preview-pdf" icon={<Eye size={14} />} loading={busy} onClick={() => downloadSample(true)}>
          Preview PDF
        </Button>
        <span className="ml-auto" />
        <Button size="sm" variant="secondary" data-testid="designer-save-draft" icon={<Save size={14} />} loading={busy} onClick={() => persist(false)}>
          Save draft
        </Button>
        <Button size="sm" data-testid="designer-create" icon={<Check size={14} />} loading={busy} onClick={() => persist(true)}>
          {template ? 'Save template' : 'Create template'}
        </Button>
      </div>
    </div>
  );
}

/** The branding fields the server needs alongside the custom markup. */
function brandingFields(d: Draft) {
  return {
    companyName: d.companyName || null,
    companyAddress: d.companyAddress || null,
    logoUrl: d.logoUrl || null,
    primaryColor: d.primaryColor,
    accentColor: d.accentColor || null,
    headerTitle: d.headerTitle,
    headerNote: d.headerNote || null,
    footerNote: d.footerNote || null,
    signatoryName: d.signatoryName || null,
    signatureLabel: d.signatureLabel,
  };
}

function Chips({ items, selected, onToggle, empty }: {
  items: { id: string; label: string }[]; selected: string[]; onToggle: (id: string) => void; empty?: string;
}) {
  if (!items.length) return <p className="text-xs text-fg-subtle">{empty ?? 'Nothing to choose from'}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(i => (
        <Button key={i.id} size="xs" variant={selected.includes(i.id) ? 'primary' : 'secondary'} onClick={() => onToggle(i.id)}>
          {i.label}
        </Button>
      ))}
    </div>
  );
}
