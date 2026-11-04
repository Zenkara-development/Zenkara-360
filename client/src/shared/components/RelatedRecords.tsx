/**
 * RelatedRecords — the universal "everything under this record" panel.
 *
 * One component for every record detail surface: give it an entityType
 * (CONTACT | ACCOUNT | DEAL | TICKET) and an id, and it renders every group
 * the universal related endpoint returns — core CRM/desk records linked by
 * foreign key, and custom-module records whose RELATION field points at this
 * record. Groups render only when they have records, so an empty panel
 * disappears entirely.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Link2, ChevronRight } from 'lucide-react';
import { api } from '../../api/client';
import { Card, CardHeader, Badge } from './index';

export interface RelatedGroup {
  key: string; label: string; route: string;
  records: { id: string; title: string; subtitle?: string; badge?: string }[];
}

export function useRelatedForEntity(entityType: string, entityId?: string, enabled = true) {
  return useQuery({
    queryKey: ['related', entityType, entityId],
    queryFn: () => api.get(`/related/${entityType}/${entityId}`).then(r => r.data as { groups: RelatedGroup[] }),
    enabled: !!entityId && enabled,
    staleTime: 30_000,
  });
}

/** A record row links to its own detail page when one exists (contacts,
 *  custom-module pages); otherwise the row links to the group's list page. */
function recordHref(group: RelatedGroup, recordId: string): string {
  if (group.key === 'contacts' || group.key === 'contact') return `/crm/contacts/${recordId}`;
  if (group.key.startsWith('module:')) return group.route;
  return group.route;
}

export function RelatedRecords({ entityType, entityId, exclude = [], embedded = false }: {
  entityType: 'CONTACT' | 'ACCOUNT' | 'DEAL' | 'TICKET';
  entityId?: string;
  /** Group keys the host page already renders its own way (e.g. 'deals'). */
  exclude?: string[];
  /** true = render bare sections (host provides the Card). */
  embedded?: boolean;
}) {
  const { data } = useRelatedForEntity(entityType, entityId);
  const groups = (data?.groups ?? []).filter(g => !exclude.includes(g.key));
  if (!groups.length) return null;

  const body = (
    <div className="space-y-4">
      {groups.map(g => (
        <div key={g.key}>
          <div className="flex items-center gap-2 mb-1.5">
            <p className="text-[11px] font-semibold text-fg-subtle uppercase tracking-wide">{g.label}</p>
            <Badge variant="gray">{g.records.length}</Badge>
            <Link to={g.route} className="ml-auto text-[11px] text-accent hover:underline inline-flex items-center gap-0.5">
              View all <ChevronRight size={11} />
            </Link>
          </div>
          <div className="divide-y divide-line-subtle rounded-card border border-line-subtle overflow-hidden">
            {g.records.slice(0, 6).map(r => (
              <Link
                key={r.id}
                to={recordHref(g, r.id)}
                className="flex items-center gap-2 px-3 py-2 bg-surface hover:bg-surface-hover transition-colors"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-fg truncate">{r.title}</span>
                  {r.subtitle && <span className="block text-[11px] text-fg-subtle truncate">{r.subtitle}</span>}
                </span>
                {r.badge && <Badge variant="blue">{r.badge}</Badge>}
              </Link>
            ))}
            {g.records.length > 6 && (
              <Link to={g.route} className="block px-3 py-1.5 text-[11.5px] text-fg-subtle hover:text-fg bg-surface-sunken/50">
                + {g.records.length - 6} more…
              </Link>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  if (embedded) return body;
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Link2 size={15} className="text-accent" /> Related records</span>}
        className="mb-4"
      />
      {body}
    </Card>
  );
}
