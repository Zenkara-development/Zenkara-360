import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Layers, Settings2, Zap, Table2, Kanban, TrendingUp, CalendarPlus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useCustomModules, useCustomModule, useModuleStats } from '../api/customModules';
import { CustomModuleRecordsTab, RecordFormModal } from '../shared/components/CustomModuleRecords';
import { CustomModuleKanban, STAGE_DOT } from '../shared/components/CustomModuleKanban';
import { PageHeader, PageBody, SkeletonTable, EmptyState, Badge, AccessDenied, Button, StatTile } from '../shared/components';
import { useFormat } from '../hooks/useFormat';
import { can } from '../shared/permissions';

/** Bar-segment colors matching STAGE_DOT — one map, both surfaces agree. */
function StageDistribution({ byStage }: { byStage: { key: string; label: string; color?: string; count: number }[] }) {
  const total = byStage.reduce((a, s) => a + s.count, 0);
  if (!total) return null;
  return (
    <div className="rounded-card border border-line-subtle bg-surface p-3">
      <p className="text-[11px] font-semibold text-fg-subtle uppercase tracking-wide mb-2">Pipeline distribution</p>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-sunken" role="img" aria-label="Records per stage">
        {byStage.filter(s => s.count > 0).map(s => (
          <div
            key={s.key}
            className={STAGE_DOT[s.color ?? ''] ?? 'bg-slate-400'}
            style={{ width: `${(s.count / total) * 100}%` }}
            title={`${s.label}: ${s.count}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {byStage.map(s => (
          <span key={s.key} className="inline-flex items-center gap-1 text-[11px] text-fg-muted">
            <span className={`w-1.5 h-1.5 rounded-full ${STAGE_DOT[s.color ?? ''] ?? 'bg-slate-400'}`} aria-hidden />
            {s.label} <span className="font-semibold text-fg tabular-nums">{s.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Nav-linked, records-only view of one custom module — reached via the
 * dynamic per-module sidebar entries AppLayout.tsx injects under "Modules".
 * Deliberately thinner than CustomModulesPage.tsx (the builder): no field
 * editor, no sync config, just the day-to-day "look at / add / edit records"
 * view every staff role can already use as of ALL_STAFF-gated routes on
 * /api/custom-modules/:id/records. Managers get a link back to the full
 * builder for field/sync changes.
 */
export default function CustomModuleViewPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  /* Both reads behind this page are ALL_STAFF. The sidebar never injects these
     links for an EMPLOYEE, but the route is still reachable by URL — and until
     now that meant two guaranteed 403s and a "module not found" screen that
     misdescribed why. */
  const canRead = can.readStaffRecords(user?.role);
  const { data: modules, isLoading: listLoading } = useCustomModules(canRead);
  const found = modules?.find((m: any) => m.slug === slug);
  const { data: module_, isLoading: detailLoading } = useCustomModule(found?.id, canRead);

  // Same roles that get the "Custom Modules" builder link in AppLayout.tsx's
  // NAV_SECTIONS — the manager group, read off the shared capability table
  // rather than a local copy of the role names.
  const canManage = can.manageCustomFields(user?.role);

  /* Board vs table (Phase 2): modules with pipeline stages default to the
     board; stage-less modules only ever see the table. */
  const stages = Array.isArray((module_ as any)?.stages) ? (module_ as any).stages : [];
  const [view, setView] = useState<'board' | 'table' | null>(null);
  const activeView = view ?? (stages.length ? 'board' : 'table');
  const [recordModal, setRecordModal] = useState<null | { record: any | null; stage?: string }>(null);
  // Dashboard row (Phase 5) — totals, weekly inflow, stage mix, value sums.
  const { data: stats } = useModuleStats(found?.id, canRead);
  const { money } = useFormat();

  if (!canRead) return <AccessDenied />;

  if (listLoading || (found && detailLoading)) {
    return (
      <PageBody>
        <SkeletonTable rows={6} />
      </PageBody>
    );
  }

  if (!found || !module_) {
    return (
      <PageBody>
        <EmptyState
          icon={<Layers size={24} />}
          title="Module not found"
          description="This custom module doesn't exist, or has been deleted."
        />
      </PageBody>
    );
  }

  return (
    <div className="h-full flex flex-col animate-slide-up">
      <PageHeader
        title={module_.name}
        subtitle={module_.description || undefined}
        actions={
          <>
            {found.syncConfig?.isActive && (
              <Badge variant="indigo"><Zap size={11} /> Sync enabled</Badge>
            )}
            {stages.length > 0 && (
              <div className="inline-flex rounded-btn border border-line overflow-hidden" role="group" aria-label="View">
                {(['board', 'table'] as const).map(v => (
                  <button
                    key={v} type="button" onClick={() => setView(v)}
                    className={`flex items-center gap-1.5 px-2.5 h-ctl-sm text-xs font-medium transition-colors ${
                      activeView === v ? 'bg-accent text-accent-fg' : 'bg-surface text-fg-muted hover:text-fg hover:bg-surface-hover'
                    }`}
                  >
                    {v === 'board' ? <Kanban size={13} /> : <Table2 size={13} />}
                    {v === 'board' ? 'Board' : 'Table'}
                  </button>
                ))}
              </div>
            )}
            {canManage && (
              // Stays a real <Link> so routing (and cmd-click) keeps working —
              // Button renders a <button> and cannot carry the route.
              <Link
                to={`/custom-modules?module=${module_.id}`}
                className="inline-flex items-center gap-1.5 px-3 h-ctl-sm border border-line rounded-btn text-xs font-medium text-fg bg-surface shadow-ui-sm hover:bg-surface-hover hover:border-line-strong transition-colors"
              >
                <Settings2 size={13} /> Manage fields &amp; sync
              </Link>
            )}
          </>
        }
      />
      <PageBody width="full" className="flex-1 min-h-0 overflow-y-auto">
        {stats && stats.total > 0 && (
          <div className="mb-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatTile label="Records" value={stats.total} icon={<Layers size={15} />} />
              <StatTile label="Added this week" value={stats.createdLast7d} icon={<CalendarPlus size={15} />} />
              {stats.currencySums.slice(0, 2).map(cs => (
                <StatTile key={cs.fieldKey} label={`Total ${cs.label}`} value={money(cs.sum)} icon={<TrendingUp size={15} />} />
              ))}
            </div>
            {stats.byStage.length > 0 && <StageDistribution byStage={stats.byStage} />}
          </div>
        )}
        {activeView === 'board' ? (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setRecordModal({ record: null })} disabled={!module_.fields?.length}>
                Add Record
              </Button>
            </div>
            <CustomModuleKanban
              module_={module_}
              onOpenRecord={r => setRecordModal({ record: r })}
              onAddRecord={stageKey => setRecordModal({ record: null, stage: stageKey })}
            />
          </div>
        ) : (
          <CustomModuleRecordsTab module_={module_} canDelete={canManage} />
        )}
      </PageBody>
      {recordModal && (
        <RecordFormModal
          module_={module_}
          record={recordModal.record}
          initialStage={recordModal.stage}
          onClose={() => setRecordModal(null)}
        />
      )}
    </div>
  );
}
