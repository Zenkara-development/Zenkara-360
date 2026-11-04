/**
 * CustomModuleKanban — the pipeline board a custom module gets once its
 * admin defines stages (Phase 2 of the platform play). Native HTML5 drag &
 * drop (no new dependency): drag a card to another column to move it, which
 * PATCHes /records/:id/stage and fires CUSTOM_RECORD_STAGE_CHANGED
 * automations server-side. Optimistic: the card jumps immediately and snaps
 * back on failure.
 */
import { useMemo, useState } from 'react';
import { GripVertical, Plus } from 'lucide-react';
import { useModuleRecordsFull, useSetRecordStage } from '../../api/customModules';
import { Spinner, EmptyState, Badge } from './index';
import { Layers } from 'lucide-react';

export interface ModuleStage { key: string; label: string; color?: string }

/** Named stage colors → theme-safe classes (dot + column top accent). */
export const STAGE_DOT: Record<string, string> = {
  slate: 'bg-slate-400', blue: 'bg-blue-500', cyan: 'bg-cyan-500', teal: 'bg-teal-500',
  emerald: 'bg-emerald-500', amber: 'bg-amber-500', orange: 'bg-orange-500',
  rose: 'bg-rose-500', violet: 'bg-violet-500', indigo: 'bg-indigo-500',
};

export function CustomModuleKanban({ module_, onOpenRecord, onAddRecord }: {
  module_: any;
  onOpenRecord: (record: any) => void;
  /** Called with the stage key so "+" on a column pre-selects it. */
  onAddRecord?: (stageKey: string) => void;
}) {
  const stages: ModuleStage[] = Array.isArray(module_.stages) ? module_.stages : [];
  const { data, isLoading } = useModuleRecordsFull(module_.id);
  const setStage = useSetRecordStage();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  // Optimistic stage overrides — cleared when the refetched rows agree.
  const [moved, setMoved] = useState<Record<string, string>>({});

  const fields = module_.fields ?? [];
  const primary = fields.find((f: any) => f.isPrimary) ?? fields[0];
  // Two compact detail lines per card: first non-primary listColumns (or fields).
  const detailKeys: string[] = (Array.isArray(module_.listColumns) && module_.listColumns.length
    ? module_.listColumns : fields.map((f: any) => f.fieldKey))
    .filter((k: string) => k !== primary?.fieldKey)
    .slice(0, 2);
  const fieldByKey = useMemo(() => Object.fromEntries(fields.map((f: any) => [f.fieldKey, f])), [fields]);

  const buckets = useMemo(() => {
    const map: Record<string, any[]> = Object.fromEntries(stages.map(s => [s.key, []]));
    for (const r of data?.rows ?? []) {
      const stage = moved[r.id] ?? r.stage;
      const key = stage && map[stage] ? stage : stages[0]?.key;
      if (key) map[key].push(r);
    }
    return map;
  }, [data?.rows, stages, moved]);

  function renderValue(r: any, key: string): string {
    const f = fieldByKey[key];
    const v = r.data?.[key];
    if (v === null || v === undefined || v === '') return '';
    if (!f) return String(v);
    if (f.fieldType === 'RELATION') return data?.relationTitles?.[String(v)] ?? '';
    if (f.fieldType === 'BOOLEAN') return v ? `${f.label}: yes` : `${f.label}: no`;
    if (f.fieldType === 'DATE') return String(v).slice(0, 10);
    if (f.fieldType === 'CURRENCY') return Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
    return String(v);
  }

  async function drop(stageKey: string) {
    const id = dragId;
    setDragId(null); setOverStage(null);
    if (!id) return;
    const row = (data?.rows ?? []).find(r => r.id === id);
    if (!row || (moved[id] ?? row.stage) === stageKey) return;
    setMoved(m => ({ ...m, [id]: stageKey }));
    try {
      await setStage.mutateAsync({ moduleId: module_.id, recordId: id, stage: stageKey });
    } catch {
      setMoved(m => { const { [id]: _gone, ...rest } = m; return rest; });
    }
  }

  if (!stages.length) return null;
  if (isLoading) return <Spinner />;
  if (!(data?.rows ?? []).length) {
    return <EmptyState icon={<Layers size={22} />} title="No records yet" description="Add a record and it will appear on the board." />;
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 items-start">
      {stages.map(s => {
        const rows = buckets[s.key] ?? [];
        const isOver = overStage === s.key && dragId;
        return (
          <div
            key={s.key}
            onDragOver={e => { e.preventDefault(); setOverStage(s.key); }}
            onDragLeave={() => setOverStage(prev => (prev === s.key ? null : prev))}
            onDrop={e => { e.preventDefault(); drop(s.key); }}
            className={`w-64 shrink-0 rounded-card border bg-surface-sunken/60 transition-colors ${
              isOver ? 'border-accent bg-accent-soft/40' : 'border-line-subtle'
            }`}
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-line-subtle">
              <span className={`w-2 h-2 rounded-full ${STAGE_DOT[s.color ?? ''] ?? 'bg-slate-400'}`} aria-hidden />
              <p className="text-[12px] font-semibold text-fg tracking-tight truncate">{s.label}</p>
              <Badge variant="gray">{rows.length}</Badge>
              {onAddRecord && (
                <button
                  type="button" aria-label={`Add record in ${s.label}`}
                  onClick={() => onAddRecord(s.key)}
                  className="ml-auto p-0.5 rounded text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors"
                >
                  <Plus size={13} />
                </button>
              )}
            </div>
            <div className="p-2 space-y-2 min-h-[80px]">
              {rows.map(r => (
                <div
                  key={r.id}
                  draggable
                  onDragStart={() => setDragId(r.id)}
                  onDragEnd={() => { setDragId(null); setOverStage(null); }}
                  onClick={() => onOpenRecord(r)}
                  className={`group rounded-btn border border-line bg-surface px-2.5 py-2 shadow-ui-sm cursor-grab
                              hover:border-line-strong hover:shadow-ui transition-all ${dragId === r.id ? 'opacity-40' : ''}`}
                >
                  <div className="flex items-start gap-1.5">
                    <GripVertical size={12} className="mt-0.5 shrink-0 text-fg-subtle/50 group-hover:text-fg-subtle" />
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-medium text-fg leading-snug break-words">{r.title ?? r.id}</p>
                      {detailKeys.map(k => {
                        const text = renderValue(r, k);
                        return text ? <p key={k} className="text-[11px] text-fg-muted truncate">{text}</p> : null;
                      })}
                    </div>
                  </div>
                </div>
              ))}
              {!rows.length && (
                <p className="text-[11px] text-fg-subtle/70 text-center py-3 select-none">
                  {isOver ? 'Drop here' : '—'}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
