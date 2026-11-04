/**
 * Workspace Settings — Phase 1 of the platform play.
 *
 * The "invisible CRM" control panel: rename the product, rename any nav
 * section or item, and hide whole areas this org doesn't need. What's saved
 * here is what every teammate's sidebar renders — a dealership can look like
 * "DealerTrack Pro" with a Service section, and never see HR or Campaigns.
 * Purely presentational: hiding a link never blocks the route or API.
 */
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Eye, EyeOff, RotateCcw, SlidersHorizontal } from 'lucide-react';
import {
  PageHeader, PageBody, Card, Button, Field, Input, Toggle, Alert,
} from '../shared/components';
import { NAV_SECTIONS } from '../shared/layouts/AppLayout';
import { useWorkspaceConfig, useSaveWorkspaceConfig, type WorkspaceConfig } from '../api/workspace';

/** Links that must never be hideable/renamable away — the escape hatch. */
const PROTECTED_ROUTES = new Set(['/workspace', '/dashboard']);

type Draft = Required<Pick<WorkspaceConfig, 'navRenames' | 'sectionRenames'>> & {
  appName: string;
  hiddenRoutes: Set<string>;
  hiddenSections: Set<string>;
};

const emptyDraft = (): Draft => ({
  appName: '', navRenames: {}, sectionRenames: {}, hiddenRoutes: new Set(), hiddenSections: new Set(),
});

function fromConfig(c: WorkspaceConfig | null): Draft {
  return {
    appName: c?.appName ?? '',
    navRenames: { ...(c?.navRenames ?? {}) },
    sectionRenames: { ...(c?.sectionRenames ?? {}) },
    hiddenRoutes: new Set(c?.hiddenRoutes ?? []),
    hiddenSections: new Set(c?.hiddenSections ?? []),
  };
}

export default function WorkspaceSettingsPage() {
  const { data: config, isLoading } = useWorkspaceConfig();
  const save = useSaveWorkspaceConfig();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setDraft(fromConfig(config ?? null)); }, [config]);

  const sections = useMemo(
    () => NAV_SECTIONS.map(s => ({
      label: s.label,
      items: s.items.filter(i => !PROTECTED_ROUTES.has(i.to)),
    })).filter(s => s.items.length > 0),
    [],
  );

  function setRename(route: string, value: string) {
    setDraft(d => {
      const navRenames = { ...d.navRenames };
      if (value.trim()) navRenames[route] = value; else delete navRenames[route];
      return { ...d, navRenames };
    });
  }
  function setSectionRename(label: string, value: string) {
    setDraft(d => {
      const sectionRenames = { ...d.sectionRenames };
      if (value.trim()) sectionRenames[label] = value; else delete sectionRenames[label];
      return { ...d, sectionRenames };
    });
  }
  function toggleRoute(route: string) {
    setDraft(d => {
      const hiddenRoutes = new Set(d.hiddenRoutes);
      hiddenRoutes.has(route) ? hiddenRoutes.delete(route) : hiddenRoutes.add(route);
      return { ...d, hiddenRoutes };
    });
  }
  function toggleSection(label: string) {
    setDraft(d => {
      const hiddenSections = new Set(d.hiddenSections);
      hiddenSections.has(label) ? hiddenSections.delete(label) : hiddenSections.add(label);
      return { ...d, hiddenSections };
    });
  }

  async function onSave() {
    const clean = (r: Record<string, string>) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    await save.mutateAsync({
      appName: draft.appName.trim() || undefined,
      navRenames: clean(draft.navRenames),
      sectionRenames: clean(draft.sectionRenames),
      hiddenRoutes: [...draft.hiddenRoutes],
      hiddenSections: [...draft.hiddenSections],
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div>
      <PageHeader
        title="Workspace Settings"
        subtitle="Make this product yours — rename anything, hide what your team doesn't use"
        actions={
          <div className="flex items-center gap-2">
            {saved && (
              <span className="flex items-center gap-1 text-[12.5px] font-medium text-success">
                <CheckCircle size={14} /> Saved — everyone sees it now
              </span>
            )}
            <Button variant="secondary" icon={<RotateCcw size={13} />} onClick={() => setDraft(emptyDraft())}>
              Reset all
            </Button>
            <Button onClick={onSave} disabled={save.isPending || isLoading}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        }
      />
      <PageBody>
        <div className="max-w-3xl space-y-5">
          <Alert tone="info">
            Renames and hidden sections apply to <strong>everyone in this organization</strong> — the
            sidebar, page titles, and browser tab all follow. Hiding a link only removes it from
            navigation; it never blocks access or deletes data, and you can bring anything back here.
          </Alert>

          <Card className="space-y-4">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={15} className="text-accent" />
              <h2 className="text-[14px] font-semibold text-fg tracking-tight">Workspace identity</h2>
            </div>
            <Field label="Product name" hint='Shown in the sidebar header and browser tab. Leave blank for "CRM & IT Desk".'>
              <Input
                value={draft.appName}
                onChange={e => setDraft(d => ({ ...d, appName: e.target.value }))}
                placeholder="e.g. DealerTrack Pro"
                maxLength={40}
              />
            </Field>
          </Card>

          {sections.map(section => {
            const sectionHidden = !!section.label && draft.hiddenSections.has(section.label);
            return (
              <Card key={section.label ?? '__top'} className="space-y-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-[14px] font-semibold text-fg tracking-tight shrink-0">
                    {section.label ?? 'General'}
                  </h2>
                  {section.label && (
                    <>
                      <Input
                        value={draft.sectionRenames[section.label] ?? ''}
                        onChange={e => setSectionRename(section.label!, e.target.value)}
                        placeholder={`Rename "${section.label}"…`}
                        maxLength={30}
                        className="!h-8 max-w-[220px] text-[12.5px]"
                      />
                      <span className="ml-auto flex items-center gap-2 text-[12.5px] text-fg-muted select-none">
                        {sectionHidden
                          ? <span className="flex items-center gap-1 text-warning font-medium"><EyeOff size={13} /> Hidden</span>
                          : <span className="flex items-center gap-1"><Eye size={13} /> Visible</span>}
                        <Toggle checked={!sectionHidden} onChange={() => toggleSection(section.label!)} />
                      </span>
                    </>
                  )}
                </div>
                <div className={`divide-y divide-line-subtle rounded-card border border-line-subtle ${sectionHidden ? 'opacity-45' : ''}`}>
                  {section.items.map(item => {
                    const Icon = item.icon;
                    const hidden = draft.hiddenRoutes.has(item.to);
                    return (
                      <div key={item.to} className="flex items-center gap-3 px-3 py-2">
                        <Icon size={14} className={`shrink-0 ${item.tint ?? 'text-fg-subtle'}`} />
                        <span className="text-[13px] text-fg w-36 shrink-0 truncate">{item.label}</span>
                        <Input
                          value={draft.navRenames[item.to] ?? ''}
                          onChange={e => setRename(item.to, e.target.value)}
                          placeholder={`Rename "${item.label}"…`}
                          maxLength={30}
                          className="!h-8 flex-1 text-[12.5px]"
                        />
                        <Toggle checked={!hidden} onChange={() => toggleRoute(item.to)} />
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      </PageBody>
    </div>
  );
}
