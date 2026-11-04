import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Star, MessageSquare, BarChart2, Inbox } from 'lucide-react';
import { api } from '../api/client';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import {
  Button, Card, CardHeader, EmptyState, PageBody, PageHeader, SkeletonCard, SkeletonStats, StatTile, Tabs,
} from '../shared/components';
import { useChartTheme } from '../shared/chartTheme';
import { useCsatResponses, useCsatStats } from '../api/csat';
import { useFormat } from '../hooks/useFormat';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../shared/permissions';

/**
 * Chart card. This was a local `Card` const shadowing the shared one plus a
 * separate `SectionHeader` with a hand-rolled accent rule; both are now the
 * shared Card + CardHeader so radius, padding and border follow the theme.
 */
function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} subtitle={subtitle} className="mb-4" />
      {children}
    </Card>
  );
}

/** Content-shaped placeholder for a report tab: KPI row + two chart blocks. */
function ReportSkeleton() {
  return (
    <div className="space-y-section" aria-hidden="true">
      <SkeletonStats count={3} />
      <div className="skeleton h-[248px] w-full rounded-card" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="skeleton h-[248px] w-full rounded-card" />
        <div className="skeleton h-[248px] w-full rounded-card" />
      </div>
    </div>
  );
}

/** A metric with a progress bar — StatTile has no bar slot, so it stays bespoke. */
function MeterTile({ label, value, percent, barClass }: {
  label: string; value: React.ReactNode; percent: number; barClass: string;
}) {
  return (
    <Card padding="sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{label}</p>
      <p className="text-[19px] font-semibold text-fg leading-tight tracking-tight mt-1 tabular-nums">{value}</p>
      <div className="mt-3 h-2 bg-surface-sunken rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barClass}`} style={{ width: `${percent}%` }} />
      </div>
    </Card>
  );
}

function StarRow({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} size={13} className={n <= rating ? 'fill-warning text-warning' : 'text-line-strong'} />
      ))}
    </span>
  );
}

const TABS = [
  { key: 'tickets' as const, label: 'IT Desk' },
  { key: 'crm'     as const, label: 'CRM' },
  { key: 'csat'    as const, label: 'Feedback' },
];

export function ReportsPage() {
  const { money, symbol, date } = useFormat();
  const t = useChartTheme();
  const [tab, setTab] = useState<'tickets' | 'crm' | 'csat'>('tickets');
  const [csatPage, setCsatPage] = useState(1);

  /* /csat and /csat/stats are IT_MANAGERS-only, but the Feedback tab was offered
     to everyone who could open this page — a CRM_MANAGER selecting it fired two
     requests that could only be refused. Drop the tab for roles that can't read
     it, and keep the capability in the queries' `enabled` so a stale `tab`
     value can't fire them either. */
  const { user } = useAuth();
  const showCsat = can.readCsat(user?.role);
  const tabs = TABS.filter(x => x.key !== 'csat' || showCsat);

  const { data: ticketData, isLoading: ticketsLoading } = useQuery({
    queryKey: ['reports-tickets'],
    queryFn: () => api.get('/reports/tickets').then(r => r.data),
    enabled: tab === 'tickets',
  });

  const { data: crmData, isLoading: crmLoading } = useQuery({
    queryKey: ['reports-crm'],
    queryFn: () => api.get('/reports/crm').then(r => r.data),
    enabled: tab === 'crm',
  });

  const { data: csatStats, isLoading: csatStatsLoading } = useCsatStats(showCsat && tab === 'csat');
  const { data: csatResponses, isLoading: csatResponsesLoading } = useCsatResponses(csatPage, showCsat && tab === 'csat');

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Reports & Analytics"
        subtitle="Last 30 days"
        below={<Tabs items={tabs} value={tab} onChange={setTab} variant="segmented" aria-label="Report area" />}
      />

      <PageBody>
        {tab === 'tickets' && (
          ticketsLoading ? <ReportSkeleton /> : (
            <div className="space-y-section">
              {/* KPI row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <MeterTile
                  label="SLA Compliance Rate"
                  value={`${ticketData?.slaCompliance ?? '—'}%`}
                  percent={ticketData?.slaCompliance || 0}
                  barClass="bg-accent"
                />
                <StatTile
                  label="Total Resolved"
                  value={ticketData?.statusBreakdown?.find((s: any) => s.status === 'RESOLVED')?._count ?? 0}
                />
                <StatTile
                  label="Currently Open"
                  value={ticketData?.statusBreakdown?.find((s: any) => s.status === 'OPEN')?._count ?? 0}
                />
              </div>

              {/* Ticket volume */}
              <ChartCard title="Ticket Volume" subtitle="New tickets created per day (last 30 days)">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={ticketData?.volume || []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <XAxis dataKey="date" tick={t.tick(10)} stroke={t.axis} tickFormatter={(v: string) => v.slice(5)} />
                    <YAxis tick={t.tick(10)} stroke={t.axis} allowDecimals={false} />
                    <Tooltip {...t.tooltip} cursor={t.lineCursor} labelFormatter={(v: string) => `Date: ${v}`} />
                    <Line type="monotone" dataKey="count" stroke={t.series[0]} strokeWidth={2} dot={false} name="Tickets" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Avg resolution time */}
                <ChartCard title="Avg Resolution Time by Priority" subtitle="Hours to resolve">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={ticketData?.resolutionTime || []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <XAxis dataKey="priority" tick={t.tick(11)} stroke={t.axis} />
                      <YAxis tick={t.tick(11)} stroke={t.axis} unit="h" />
                      <Tooltip {...t.tooltip} cursor={t.barCursor} formatter={(v: any) => [`${v}h`, 'Avg Time']} />
                      <Bar dataKey="avgHours" radius={[4,4,0,0]}>
                        {(ticketData?.resolutionTime || []).map((e: any) => (
                          <Cell key={e.priority} fill={t.priorityColor(e.priority)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                {/* Status breakdown pie */}
                <ChartCard title="Status Breakdown" subtitle="Current ticket distribution">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={ticketData?.statusBreakdown || []} dataKey="_count" nameKey="status" cx="50%" cy="50%" outerRadius={75} label={({ status, _count }: { status: string; _count: number }) => `${status}: ${_count}`} labelLine={false} fontSize={10}>
                        {/* Colour follows the status, not the row's position — a
                            filter that drops one status must not repaint the rest. */}
                        {(ticketData?.statusBreakdown || []).map((s: any, i: number) => (
                          <Cell key={i} fill={t.statusColor(s.status)} />
                        ))}
                      </Pie>
                      <Tooltip {...t.tooltip} formatter={(v: any, name: any) => [v, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
            </div>
          )
        )}

        {tab === 'crm' && (
          crmLoading ? <ReportSkeleton /> : (
            <div className="space-y-section">
              {/* KPI row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <MeterTile
                  label="Win Rate"
                  value={`${crmData?.winRate ?? '—'}%`}
                  percent={crmData?.winRate || 0}
                  barClass="bg-success"
                />
                <StatTile label="Deals Won" value={crmData?.won ?? '—'} />
                <StatTile label="Deals Lost" value={crmData?.lost ?? '—'} />
              </div>

              {/* Deal volume */}
              <ChartCard title="New Deals" subtitle="Deals created per day (last 30 days)">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={crmData?.dealVolume || []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <XAxis dataKey="date" tick={t.tick(10)} stroke={t.axis} tickFormatter={(v: string) => v.slice(5)} />
                    <YAxis tick={t.tick(10)} stroke={t.axis} allowDecimals={false} />
                    <Tooltip {...t.tooltip} cursor={t.barCursor} labelFormatter={(v: string) => `Date: ${v}`} />
                    <Bar dataKey="count" fill={t.series[0]} radius={[4,4,0,0]} name="Deals" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Forecast by stage */}
                <ChartCard title="Weighted Forecast by Stage" subtitle={`Probability-adjusted revenue (${symbol})`}>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={crmData?.forecastByStage || []} layout="vertical" margin={{ top: 4, right: 16, left: 60, bottom: 0 }}>
                      <XAxis type="number" tick={t.tick(10)} stroke={t.axis} tickFormatter={(v: number) => `${symbol}${(v/1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="stage" tick={t.tick(11)} stroke={t.axis} width={60} />
                      <Tooltip {...t.tooltip} cursor={t.barCursor} formatter={(v: any) => [money(Number(v)), 'Weighted']} />
                      <Bar dataKey="weighted" fill={t.series[4]} radius={[0,4,4,0]} name="Weighted Forecast" />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                {/* Top contacts by deal value */}
                <ChartCard title="Top Contacts by Pipeline Value">
                  {crmData?.contactsByValue?.length === 0 ? (
                    <EmptyState compact icon={<BarChart2 />} title="No deal data yet" />
                  ) : (
                    <div className="space-y-3 mt-2">
                      {(crmData?.contactsByValue || []).map((c: any, i: number) => (
                        <div key={c.name} className="flex items-center gap-3">
                          <div className="w-6 h-6 rounded-full bg-accent-soft text-accent-soft-fg text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between text-sm mb-1">
                              <span className="font-medium text-fg truncate">{c.name}</span>
                              <span className="text-success font-semibold ml-2">{money(c.value)}</span>
                            </div>
                            <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                              <div className="h-full bg-accent rounded-full" style={{ width: `${(c.value / (crmData.contactsByValue[0]?.value || 1)) * 100}%` }} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ChartCard>
              </div>
            </div>
          )
        )}

        {tab === 'csat' && showCsat && (
          csatStatsLoading ? <ReportSkeleton /> : (
            <div className="space-y-section">
              {/* KPI row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatTile
                  label="Average Rating"
                  value={<>{csatStats?.avg ?? '—'}<span className="text-[13px] text-fg-subtle">/5</span></>}
                  hint={typeof csatStats?.avg === 'number' ? <StarRow rating={Math.round(csatStats.avg)} /> : undefined}
                />
                <StatTile label="Satisfied (4-5 stars)" value={`${csatStats?.satisfactionRate ?? '—'}%`} />
                <StatTile label="Total Responses" value={csatStats?.total ?? 0} />
              </div>

              {/* Rating distribution */}
              <ChartCard title="Rating Distribution" subtitle="How many responses landed at each star rating">
                {!csatStats?.total ? (
                  <EmptyState compact icon={<Star />} title="No feedback submitted yet" />
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={[...(csatStats?.dist || [])].reverse()} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <XAxis dataKey="rating" tick={t.tick(11)} stroke={t.axis} tickFormatter={(v: number) => `${v}★`} />
                      <YAxis tick={t.tick(11)} stroke={t.axis} allowDecimals={false} />
                      <Tooltip {...t.tooltip} cursor={t.barCursor} formatter={(v: any) => [v, 'Responses']} labelFormatter={(v: number) => `${v} star${v === 1 ? '' : 's'}`} />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {[...(csatStats?.dist || [])].reverse().map((d: any) => (
                          <Cell key={d.rating} fill={t.ratingColor(d.rating)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>

              {/* Recent responses */}
              <ChartCard title="Recent Feedback" subtitle="Star rating + optional comment left by the ticket requester">
                {csatResponsesLoading ? <SkeletonCard lines={4} /> : !csatResponses?.data.length ? (
                  <EmptyState compact icon={<Inbox />} title="No feedback submitted yet" />
                ) : (
                  <div className="space-y-3">
                    {csatResponses.data.map(r => (
                      <div key={r.id} className="flex items-start gap-3 p-3 rounded-card bg-surface-sunken">
                        <StarRow rating={r.rating} />
                        <div className="flex-1 min-w-0">
                          {r.ticket && (
                            <Link to="/itdesk/tickets" className="text-sm font-medium text-fg hover:text-accent hover:underline truncate block">
                              {r.ticket.title}
                            </Link>
                          )}
                          {r.comment && (
                            <p className="text-xs text-fg-muted mt-1 flex items-start gap-1"><MessageSquare size={12} className="mt-0.5 flex-shrink-0" />{r.comment}</p>
                          )}
                        </div>
                        <span className="text-xs text-fg-subtle flex-shrink-0">{date(r.submittedAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {csatResponses && csatResponses.total > csatResponses.limit && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-line-subtle">
                    <Button variant="ghost" size="xs" disabled={csatPage <= 1} onClick={() => setCsatPage(p => p - 1)}>Previous</Button>
                    <span className="text-xs text-fg-subtle tabular-nums">Page {csatResponses.page} of {Math.ceil(csatResponses.total / csatResponses.limit)}</span>
                    <Button variant="ghost" size="xs" disabled={csatPage >= Math.ceil(csatResponses.total / csatResponses.limit)} onClick={() => setCsatPage(p => p + 1)}>Next</Button>
                  </div>
                )}
              </ChartCard>
            </div>
          )
        )}
      </PageBody>
    </div>
  );
}
