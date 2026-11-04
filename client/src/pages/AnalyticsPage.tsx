import { useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Download, BarChart2, Clock, Target, DollarSign } from 'lucide-react';
import { useAnalyticsOverview, useTicketAnalytics, useCrmAnalytics } from '../api/analytics';
import {
  Alert, Button, Card, CardHeader, EmptyState, PageBody, PageHeader, Select, StatTile,
} from '../shared/components';
import { AccessDenied } from '../shared/components/AccessDenied';
import { useChartTheme, type ChartTheme } from '../shared/chartTheme';
import { useFormat } from '../hooks/useFormat';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../shared/permissions';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const shortDate = (s: string) => s.slice(5); // MM-DD from YYYY-MM-DD

function downloadCsv(data: any[], filename: string) {
  if (!data.length) return;
  const keys = Object.keys(data[0]);
  const rows = [keys.join(','), ...data.map(r => keys.map(k => String(r[k] ?? '')).join(','))];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, change, prefix = '', suffix = '', icon: Icon }: {
  label: string; value: number | string; change?: number; prefix?: string; suffix?: string; icon: React.ElementType;
}) {
  const isPos = change !== undefined && change > 0;
  const isNeg = change !== undefined && change < 0;
  return (
    <StatTile
      label={label}
      value={<span className="tabular-nums">{`${prefix}${value}${suffix}`}</span>}
      icon={<Icon size={15} />}
      hint={change !== undefined ? (
        <span className={`inline-flex items-center gap-1 font-medium ${isPos ? 'text-success' : isNeg ? 'text-danger' : 'text-fg-subtle'}`}>
          {isPos ? <TrendingUp size={12} /> : isNeg ? <TrendingDown size={12} /> : <Minus size={12} />}
          {isPos ? '+' : ''}{change}% vs prev 30d
        </span>
      ) : undefined}
    />
  );
}

// ─── Chart card ───────────────────────────────────────────────────────────────
// Was a bespoke `bg-surface border rounded-xl p-4 sm:p-5` wrapper with its own
// header row; now the same idea assembled from Card + CardHeader so padding and
// radius follow the theme.

function ChartCard({ title, children, onExport }: { title: string; children: React.ReactNode; onExport?: () => void }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={title}
        className="mb-5"
        actions={onExport && (
          <Button variant="secondary" size="xs" icon={<Download size={11} />} onClick={onExport}>
            Export CSV
          </Button>
        )}
      />
      {children}
    </Card>
  );
}

/** Grid line, themed identically for every cartesian chart on this page. */
function Grid({ t }: { t: ChartTheme }) {
  return <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />;
}

/** Content-shaped placeholder while a chart's data loads — no layout jump. */
function ChartSkeleton() {
  return <div className="skeleton w-full rounded-card" style={{ height: 220 }} aria-hidden="true" />;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AnalyticsPage() {
  const { symbol } = useFormat();
  const t = useChartTheme();
  const fmt = (n: number) => n >= 1000 ? `${symbol}${(n / 1000).toFixed(1)}k` : `${symbol}${n}`;
  const [days, setDays] = useState(30);

  /* Each of the three analytics feeds is guarded by a *different* role group,
     so this page is not all-or-nothing: /analytics/overview is MANAGERS,
     /analytics/tickets is IT_MANAGERS and /analytics/crm is CRM_MANAGERS. Firing
     all three meant an IT_MANAGER was refused the CRM chart and a CRM_MANAGER the
     ticket chart every time either of them opened this page. Ask for the feeds
     this role covers and render only those charts. */
  const { user } = useAuth();
  const role = user?.role;
  const showOverview = can.readAnalytics(role);
  const showTickets  = can.readTicketReports(role);
  const showCrm      = can.readCrmReports(role);

  const { data: overview } = useAnalyticsOverview(showOverview);
  const { data: tickets, isLoading: ticketsLoading } = useTicketAnalytics(days, showTickets);
  const { data: crm, isLoading: crmLoading } = useCrmAnalytics(days, showCrm);

  const volumeData = tickets?.volume.labels.map((label, i) => ({
    date: shortDate(label),
    Created: tickets.volume.created[i],
    Resolved: tickets.volume.resolved[i],
  })) || [];

  const forecastData = (() => {
    if (!tickets) return [];
    const last7 = tickets.volume.labels.slice(-7).map((label, i) => ({
      date: shortDate(label), Actual: tickets.volume.created[tickets.volume.labels.length - 7 + i], Forecast: undefined as undefined | number,
    }));
    const futureDates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() + i + 1);
      return d.toISOString().slice(5, 10);
    });
    const future = futureDates.map((date, i) => ({ date, Actual: undefined as undefined | number, Forecast: tickets.volume.forecast[i] }));
    return [...last7, ...future];
  })();

  const statusData = tickets?.byStatus.map(s => ({ name: s.status.replace('_', ' '), value: s.count })) || [];
  const priorityData = tickets?.byPriority.map(p => ({ name: p.priority, value: p.count })) || [];
  const pipelineData = crm?.deals.pipeline.map(p => ({ stage: p.stage, Count: p.count, Value: p.value })) || [];
  const leadStatusData = crm?.leads.byStatus.map(l => ({ name: l.status, value: l.count })) || [];

  const revenueData = crm?.deals.revenue.labels.map((label, i) => ({
    date: shortDate(label),
    Revenue: crm.deals.revenue.values[i],
  })) || [];

  /* Nothing on this page is readable by an agent, rep or employee, so show the
     refusal once rather than a screen of permanently empty charts. */
  if (!showOverview && !showTickets && !showCrm) return <AccessDenied />;

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Analytics"
        subtitle="Performance metrics, trends, and forecasts."
        actions={
          <Select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            aria-label="Date range"
            className="w-auto"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </Select>
        }
      />

      <PageBody>
        {/* KPI row — /analytics/overview is MANAGERS-only */}
        {showOverview && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Open Tickets" value={overview?.tickets.current ?? '—'} change={overview?.tickets.change} icon={BarChart2} />
          <KpiCard label="New Leads" value={overview?.leads.current ?? '—'} change={overview?.leads.change} icon={Target} />
          <KpiCard label="Revenue Won" value={overview?.revenue.current ? fmt(overview.revenue.current) : '—'} change={overview?.revenue.change} icon={DollarSign} />
          <KpiCard label="Avg Resolution" value={overview?.avgResolutionHours != null ? `${overview.avgResolutionHours}h` : '—'} icon={Clock} />
        </div>
        )}

        {/* SLA + win rate badges */}
        {(tickets?.slaCompliance != null || crm?.deals.winRate != null) && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {tickets?.slaCompliance != null && (
              <Alert
                tone={tickets.slaCompliance >= 90 ? 'success' : tickets.slaCompliance >= 70 ? 'warning' : 'danger'}
                icon={null}
              >
                SLA Compliance: <strong>{tickets.slaCompliance}%</strong>
              </Alert>
            )}
            {crm?.deals.winRate != null && (
              <Alert tone="accent" icon={null}>
                Deal Win Rate: <strong>{crm.deals.winRate}%</strong>
              </Alert>
            )}
            {crm?.leads.conversionRate != null && (
              <Alert tone="info" icon={null}>
                Lead Conversion: <strong>{crm.leads.conversionRate}%</strong>
              </Alert>
            )}
          </div>
        )}

        {/* Charts grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Ticket charts — /analytics/tickets is IT_MANAGERS-only, so a
              CRM_MANAGER never sees (or asks for) these. */}
          {showTickets && (<>
          {/* Ticket volume */}
          <ChartCard title="Ticket Volume (Created vs. Resolved)"
            onExport={() => downloadCsv(volumeData, 'ticket_volume.csv')}>
            {ticketsLoading ? <ChartSkeleton /> : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={volumeData}>
                  <Grid t={t} />
                  <XAxis dataKey="date" tick={t.tick(10)} stroke={t.axis} />
                  <YAxis tick={t.tick(10)} stroke={t.axis} />
                  <Tooltip {...t.tooltip} cursor={t.lineCursor} />
                  <Legend {...t.legend} />
                  <Area type="monotone" dataKey="Created" stroke={t.series[0]} fill={t.fade(t.series[0], 0.18)} strokeWidth={2} />
                  <Area type="monotone" dataKey="Resolved" stroke={t.series[2]} fill={t.fade(t.series[2], 0.18)} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Forecast */}
          <ChartCard title="7-Day Ticket Forecast">
            {ticketsLoading ? <ChartSkeleton /> : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={forecastData}>
                  <Grid t={t} />
                  <XAxis dataKey="date" tick={t.tick(10)} stroke={t.axis} />
                  <YAxis tick={t.tick(10)} stroke={t.axis} />
                  <Tooltip {...t.tooltip} cursor={t.lineCursor} />
                  <Legend {...t.legend} />
                  <Line type="monotone" dataKey="Actual" stroke={t.series[0]} strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="Forecast" stroke={t.series[1]} strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Ticket status donut */}
          <ChartCard title="Tickets by Status" onExport={() => downloadCsv(statusData, 'ticket_status.csv')}>
            {ticketsLoading ? <ChartSkeleton /> : statusData.length === 0 ? (
              <EmptyState compact icon={<BarChart2 />} title="No data yet" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={e => `${e.name} (${e.value})`} labelLine={false}>
                    {statusData.map(s => <Cell key={s.name} fill={t.statusColor(s.name)} />)}
                  </Pie>
                  <Tooltip {...t.tooltip} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Priority bar */}
          <ChartCard title="Tickets by Priority" onExport={() => downloadCsv(priorityData, 'ticket_priority.csv')}>
            {ticketsLoading ? <ChartSkeleton /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={priorityData}>
                  <Grid t={t} />
                  <XAxis dataKey="name" tick={t.tick(11)} stroke={t.axis} />
                  <YAxis tick={t.tick(10)} stroke={t.axis} />
                  <Tooltip {...t.tooltip} cursor={t.barCursor} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {priorityData.map(p => <Cell key={p.name} fill={t.priorityColor(p.name)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
          </>)}

          {/* CRM charts — /analytics/crm is CRM_MANAGERS-only, so an IT_MANAGER
              never sees (or asks for) these. */}
          {showCrm && (<>
          {/* Deal pipeline */}
          <ChartCard title="Deal Pipeline by Stage" onExport={() => downloadCsv(pipelineData, 'deal_pipeline.csv')}>
            {crmLoading ? <ChartSkeleton /> : pipelineData.length === 0 ? (
              <EmptyState compact icon={<Target />} title="No open deals" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={pipelineData} layout="vertical">
                  <Grid t={t} />
                  <XAxis type="number" tick={t.tick(10)} stroke={t.axis} />
                  <YAxis dataKey="stage" type="category" tick={t.tick(10)} width={90} stroke={t.axis} />
                  <Tooltip {...t.tooltip} cursor={t.barCursor} formatter={(v: any, name: string) => name === 'Value' ? fmt(Number(v)) : v} />
                  <Legend {...t.legend} />
                  <Bar dataKey="Count" fill={t.series[0]} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Won revenue over time */}
          <ChartCard title="Won Deal Revenue" onExport={() => downloadCsv(revenueData, 'revenue.csv')}>
            {crmLoading ? <ChartSkeleton /> : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={revenueData}>
                  <Grid t={t} />
                  <XAxis dataKey="date" tick={t.tick(10)} stroke={t.axis} />
                  <YAxis tickFormatter={v => `${symbol}${v}`} tick={t.tick(10)} stroke={t.axis} />
                  <Tooltip {...t.tooltip} cursor={t.lineCursor} formatter={(v: any) => fmt(Number(v))} />
                  <Area type="monotone" dataKey="Revenue" stroke={t.series[2]} fill={t.fade(t.series[2], 0.18)} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Lead status */}
          <ChartCard title="Lead Status Distribution" onExport={() => downloadCsv(leadStatusData, 'lead_status.csv')}>
            {crmLoading ? <ChartSkeleton /> : leadStatusData.length === 0 ? (
              <EmptyState compact icon={<Target />} title="No leads yet" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={leadStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={e => `${e.name} (${e.value})`}>
                    {leadStatusData.map((_, i) => <Cell key={i} fill={t.series[i % t.series.length]} />)}
                  </Pie>
                  <Tooltip {...t.tooltip} />
                  <Legend {...t.legend} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
          </>)}

          {/* Tickets by category — ticket feed again, so gated with it */}
          {showTickets && tickets?.byCategory && tickets.byCategory.length > 0 && (
            <ChartCard title="Tickets by Category" onExport={() => downloadCsv(tickets.byCategory, 'ticket_category.csv')}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={tickets.byCategory}>
                  <Grid t={t} />
                  <XAxis dataKey="category" tick={t.tick(10)} stroke={t.axis} />
                  <YAxis tick={t.tick(10)} stroke={t.axis} />
                  <Tooltip {...t.tooltip} cursor={t.barCursor} />
                  <Bar dataKey="count" fill={t.series[4]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      </PageBody>
    </div>
  );
}
