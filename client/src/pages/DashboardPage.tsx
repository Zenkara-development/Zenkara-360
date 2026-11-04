import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  Ticket, TrendingUp, Users, Target, AlertCircle,
  CheckCircle, DollarSign, Clock, Sparkles, Send,
  ArrowUpRight, ArrowRight, Plus, BarChart2, FileText,
  UserSquare2, Wallet,
} from 'lucide-react';
import { useDealReports } from '../api/crm';
import { useContacts, useLeads } from '../api/crm';
import { useTicketReports } from '../api/itdesk';
import { useEmployeeStats } from '../api/people';
import { useNLQuery } from '../api/ai';
import {
  AiGeneratedTag, AiInfo, AiNote,
  Alert, Badge, Button, Card, CardHeader, Input, PageBody, Spinner, StatTile,
  PastelStatCard, type PastelTone,
} from '../shared/components';
import { AiInsightsWidget } from '../shared/components/AiInsightsWidget';
import { MeetingNotesModal } from '../shared/components/MeetingNotesModal';
import { useFormat } from '../hooks/useFormat';
import { can } from '../shared/permissions';

type Tone = PastelTone;

function SectionTitle({ label, action, onAction, infoId }: { label: string; action?: string; onAction?: () => void; infoId?: string }) {
  return (
    <div className="flex items-center justify-between mb-3.5">
      <div className="flex items-center gap-2">
        <h2 className="text-[16px] font-bold text-fg tracking-tight">{label}</h2>
        {infoId && <AiInfo id={infoId} />}
      </div>
      {action && onAction && (
        <Button variant="ghost" size="xs" onClick={onAction} iconRight={<ArrowRight size={12} />} className="!text-accent">
          {action}
        </Button>
      )}
    </div>
  );
}

/* Square pastel shortcut — icon chip over a label ("Quick Access"). */
function QuickAction({ label, icon: Icon, tone, onClick }: { label: string; icon: React.ElementType; tone: Tone; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`tile-${tone} tile-surface flex flex-col items-center justify-center gap-2.5 h-[108px] px-2 rounded-card border border-transparent hover:shadow-ui-md hover:-translate-y-0.5 transition-all duration-150`}
    >
      <span className="tile-chip w-11 h-11 rounded-[14px] flex items-center justify-center shadow-ui-sm">
        <Icon size={20} />
      </span>
      <span className="text-[12.5px] font-semibold text-fg text-center leading-tight">{label}</span>
    </button>
  );
}

/* ── "What needs my attention today?" ──────────────────────────────────
   SLA breaches, open tickets and leads awaiting follow-up, each clickable.
   Rendered only when the underlying count is non-zero; when everything is
   clear it collapses to a single quiet all-caught-up line. */
function AttentionItem({ icon: Icon, label, count, tone, onClick }: {
  icon: React.ElementType; label: string; count: number; tone: Tone; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`tile-${tone} group flex items-center gap-3 px-4 py-3.5 rounded-card border border-line bg-surface shadow-ui-sm text-left transition-all hover:shadow-ui-md`}
    >
      <span className="tile-surface tile-text w-10 h-10 rounded-full flex items-center justify-center shrink-0">
        <Icon size={17} />
      </span>
      <span className="min-w-0">
        <span className="block text-[19px] font-bold text-fg leading-none tabular-nums">{count}</span>
        <span className="block text-[12px] text-fg-muted mt-1 truncate">{label}</span>
      </span>
      <ArrowRight size={14} className="ml-auto text-fg-subtle opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  );
}

const PRIORITY_CFG: Record<string, { label: string; bar: string }> = {
  CRITICAL: { label: 'Critical', bar: 'bg-danger' },
  HIGH:     { label: 'High',     bar: 'bg-warning' },
  MEDIUM:   { label: 'Medium',   bar: 'bg-info' },
  LOW:      { label: 'Low',      bar: 'bg-line-strong' },
};

const QUERIES = [
  'How many deals are open?',
  'What is my forecasted revenue?',
  'How many tickets need attention?',
  'Summarise my pipeline.',
];

function AIQueryBar() {
  const [question, setQuestion] = useState('');
  const nlQuery = useNLQuery();

  async function ask(q: string) {
    if (!q.trim()) return;
    setQuestion(q);
    try { await nlQuery.mutateAsync(q); } catch { /* handled via nlQuery.error */ }
  }

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="px-5 py-4 border-b border-line-subtle">
        <CardHeader
          title="Ask AI about your data"
          icon={<Sparkles size={15} className="text-accent" />}
          actions={<Badge variant="accent" size="sm">Beta</Badge>}
        />
      </div>
      <div className="p-5 space-y-4">
        <AiNote id="dashboard.query" />
        <div className="flex gap-2">
          <Input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && ask(question)}
            placeholder="e.g. How many tickets are SLA-breached today?"
            aria-label="Ask AI about your data"
            className="flex-1"
          />
          <Button
            onClick={() => ask(question)}
            disabled={!question.trim()}
            loading={nlQuery.isPending}
            icon={<Send size={13} />}
          >
            Ask
          </Button>
        </div>
        {!nlQuery.data && !nlQuery.isPending && (
          <div className="flex flex-wrap gap-2">
            {QUERIES.map(q => (
              <Button key={q} variant="secondary" size="xs" onClick={() => ask(q)} className="!rounded-badge">
                {q}
              </Button>
            ))}
          </div>
        )}
        {nlQuery.isPending && (
          <div className="flex items-center gap-2 text-sm text-accent animate-pulse py-1">
            <Sparkles size={13} /> Thinking...
          </div>
        )}
        {nlQuery.isError && (
          <Alert
            tone="danger"
            actions={<Button variant="ghost" size="xs" onClick={() => nlQuery.reset()}>Dismiss</Button>}
          >
            {(nlQuery.error as any)?.response?.data?.error || 'AI request failed.'}
          </Alert>
        )}
        {nlQuery.data && (
          <div className="space-y-1.5">
            <AiGeneratedTag />
            <Alert tone="accent" title="AI Answer">
              <p className="leading-relaxed">{nlQuery.data.answer}</p>
              <Button
                variant="ghost"
                size="xs"
                className="mt-2 -ml-2.5"
                onClick={() => { nlQuery.reset(); setQuestion(''); }}
              >
                Ask another
              </Button>
            </Alert>
          </div>
        )}
      </div>
    </Card>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { money, timezone } = useFormat();
  const navigate = useNavigate();
  const [meetingNotesOpen, setMeetingNotesOpen] = useState(false);
  /* Which halves of this dashboard is this person allowed to see?
     The CRM and IT Desk report endpoints are manager-scoped, and the
     contact/lead lists are CRM-staff-scoped. Firing them regardless meant
     every role except SUPER_ADMIN hit a wall of refusals the moment they
     logged in — four for IT_AGENT and EMPLOYEE, three for IT_MANAGER, two for
     SALES_REP, one for CRM_MANAGER. Asking only for what this role can read
     means each person's dashboard is simply the part of it that applies to
     them. */
  const role = user?.role;
  const showCrm    = can.readCrm(role);
  const showCrmKpis = can.readCrmReports(role);
  const showItDesk = can.readTicketReports(role);

  const { data: dealReports, isLoading: dealsLoading } = useDealReports(showCrmKpis);
  const { data: contacts } = useContacts(undefined, showCrm);
  const { data: leads } = useLeads(undefined, showCrm);
  const { data: ticketReports, isLoading: ticketsLoading } = useTicketReports(showItDesk);
  /* GET /hr/employees/stats is open to every signed-in user. */
  const { data: employeeStats } = useEmployeeStats();

  /* POST /ai/query and POST /ai/insights are both MANAGERS-only. */
  const showAiPanels = can.readAnalytics(role);

  /* Only offer shortcuts the user can actually follow. */
  const quickActions = [
    { label: 'Attendance',    icon: Clock,        tone: 'blue'   as Tone, to: '/hr/attendance',  show: true },
    { label: 'HR Management', icon: UserSquare2,  tone: 'purple' as Tone, to: '/people',         show: true },
    { label: 'Tickets',       icon: Ticket,       tone: 'orange' as Tone, to: '/itdesk/tickets', show: true },
    { label: 'My Work',       icon: CheckCircle,  tone: 'green'  as Tone, to: '/my-work',        show: true },
    { label: 'Payslips',      icon: Wallet,       tone: 'pink'   as Tone, to: '/hr/payroll',     show: true },
    { label: 'New Contact',   icon: Users,        tone: 'teal'   as Tone, to: '/crm/contacts',   show: showCrm },
    { label: 'New Lead',      icon: Target,       tone: 'orange' as Tone, to: '/crm/leads',      show: showCrm },
    { label: 'New Deal',      icon: TrendingUp,   tone: 'green'  as Tone, to: '/crm/deals',      show: showCrm },
    { label: 'Reports',       icon: BarChart2,    tone: 'blue'   as Tone, to: '/reports',        show: can.readAdmin(role) },
    { label: 'Import CSV',    icon: ArrowUpRight, tone: 'slate'  as Tone, to: '/import',         show: can.readCrmReports(role) },
  ].filter(a => a.show);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const today = new Intl.DateTimeFormat(undefined, { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());

  const totalOpenDeals = dealReports?.funnel?.reduce((s: number, f: any) => s + f.count, 0);
  const activeLeads = leads?.filter((l: any) => !['CONVERTED', 'UNQUALIFIED'].includes(l.status)).length;
  const totalPriority = ticketReports?.byPriority?.reduce((s: number, b: any) => s + (b._count || 0), 0) || 1;

  const overview = [
    { key: 'emp',   label: 'Employees',    value: employeeStats?.total ?? '--', icon: Users, tone: 'blue' as Tone, to: '/people', show: true },
    { key: 'deals', label: 'Open Deals',   value: dealsLoading ? '…' : (totalOpenDeals ?? '--'), icon: TrendingUp, tone: 'green' as Tone, to: '/crm/deals', show: showCrmKpis },
    { key: 'tix',   label: 'Tickets',      value: ticketsLoading ? '…' : (ticketReports?.open ?? '--'), icon: Ticket, tone: 'orange' as Tone, to: '/itdesk/tickets', show: showItDesk },
    { key: 'leads', label: 'Active Leads', value: activeLeads ?? '--', icon: Target, tone: 'purple' as Tone, to: '/crm/leads', show: showCrm },
  ].filter(o => o.show);

  /* The rest of what the CRM and IT Desk sections used to show, minus the
     numbers the overview row already carries. */
  const snapshot = [
    { key: 'forecast', label: 'Forecast Revenue', value: dealReports?.forecast != null ? money(dealReports.forecast) : '--', icon: DollarSign, to: '/crm/deals', show: showCrmKpis },
    { key: 'contacts', label: 'Contacts',     value: contacts?.length ?? '--',   icon: Users,       to: '/crm/contacts',   show: showCrm },
    { key: 'progress', label: 'In Progress',  value: ticketReports?.inProgress,  icon: Clock,       to: '/itdesk/tickets', show: showItDesk },
    { key: 'sla',      label: 'SLA Breached', value: ticketReports?.slaBreached, icon: AlertCircle, to: '/itdesk/tickets', show: showItDesk },
    { key: 'resolved', label: 'Resolved',     value: ticketReports?.resolved,    icon: CheckCircle, to: '/itdesk/tickets', show: showItDesk },
  ].filter(t => t.show);
  const showPriority = showItDesk && ticketReports?.byPriority?.length > 0;
  const snapshotLoading = (dealsLoading && showCrmKpis) || (ticketsLoading && showItDesk);

  return (
    <div className="animate-slide-up">
      <PageBody>
        {/* Welcome */}
        <section className="relative overflow-hidden rounded-card bg-surface border border-line shadow-ui-sm px-6 py-6 sm:px-8 sm:py-7">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="text-[20px] sm:text-[23px] font-extrabold text-fg tracking-tight">
                People <span className="text-accent">+</span> Projects <span className="text-accent">+</span> Performance
              </p>
              <p className="text-[13.5px] text-fg-muted mt-1">All your work, team and project management in one place.</p>
              <h1 className="mt-5 text-[28px] sm:text-[32px] font-extrabold text-fg tracking-tight leading-tight">{greeting}!</h1>
              <p className="text-[14px] text-fg-muted mt-1">Here's your business overview for today · {today}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button icon={<Plus size={14} />} onClick={() => navigate('/itdesk/tickets')}>
              Ticket
            </Button>
            <Button variant="secondary" icon={<Plus size={14} />} onClick={() => navigate('/crm/contacts')}>
              Contact
            </Button>
            <Button variant="secondary" icon={<FileText size={14} />} onClick={() => setMeetingNotesOpen(true)}>
              Parse Meeting Notes
            </Button>
            <AiInfo id="meeting.notes" align="left" className="-ml-1" />
          </div>
        </section>

        {/* Overview */}
        {overview.length > 0 && (
          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${overview.length >= 4 ? 'xl:grid-cols-4' : overview.length === 3 ? 'xl:grid-cols-3' : ''}`}>
            {overview.map(o => (
              <PastelStatCard key={o.key} label={o.label} value={o.value} icon={o.icon} tone={o.tone} onClick={() => navigate(o.to)} />
            ))}
          </div>
        )}

        {/* Quick Access */}
        {quickActions.length > 0 && (
          <Card className="!p-5 sm:!p-6">
            <SectionTitle label="Quick Access" />
            <div className="grid grid-cols-2 min-[480px]:grid-cols-3 md:grid-cols-5 gap-3">
              {quickActions.map(a => (
                <QuickAction key={a.label} label={a.label} icon={a.icon} tone={a.tone} onClick={() => navigate(a.to)} />
              ))}
            </div>
          </Card>
        )}

        {/* Needs attention */}
        {!ticketsLoading && ticketReports && (
          (() => {
            const attention = [
              { key: 'sla', count: ticketReports.slaBreached ?? 0, label: 'SLA-breached tickets', icon: AlertCircle, tone: 'red' as Tone, to: '/itdesk/tickets' },
              { key: 'open', count: ticketReports.open ?? 0, label: 'Open tickets awaiting action', icon: Ticket, tone: 'blue' as Tone, to: '/itdesk/tickets' },
              { key: 'leads', count: activeLeads ?? 0, label: 'Leads awaiting follow-up', icon: Target, tone: 'orange' as Tone, to: '/crm/leads' },
            ].filter(a => a.count > 0);
            return attention.length ? (
              <section>
                <SectionTitle label="Needs Attention" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {attention.map(a => (
                    <AttentionItem key={a.key} icon={a.icon} label={a.label} count={a.count} tone={a.tone} onClick={() => navigate(a.to)} />
                  ))}
                </div>
              </section>
            ) : (
              <div className="flex items-center gap-2 text-[13px] text-fg-muted">
                <CheckCircle size={14} className="text-success" /> All caught up — nothing needs your attention right now.
              </div>
            );
          })()
        )}

        {/* Business snapshot — the remaining CRM and IT Desk figures */}
        {(snapshot.length > 0 || showPriority) && (
          <section>
            <SectionTitle
              label="Business Snapshot"
              action={showItDesk ? 'View tickets' : showCrm ? 'View pipeline' : undefined}
              onAction={() => navigate(showItDesk ? '/itdesk/tickets' : '/crm/deals')}
            />
            {snapshotLoading ? (
              <div className="h-32 flex items-center"><Spinner label="Loading..." /></div>
            ) : (
              <div className={`grid grid-cols-1 gap-4 ${showPriority ? 'lg:grid-cols-3' : ''}`}>
                <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${showPriority ? 'lg:col-span-2' : 'lg:grid-cols-3 xl:grid-cols-5'}`}>
                  {snapshot.map(t => (
                    <StatTile key={t.key} label={t.label} value={t.value ?? '--'} icon={<t.icon size={18} />} onClick={() => navigate(t.to)} />
                  ))}
                </div>
                {showPriority && (
                  <Card>
                    <p className="text-[14px] font-bold text-fg mb-4">Tickets by Priority</p>
                    <div className="space-y-3">
                      {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(p => {
                        const entry = ticketReports.byPriority.find((b: any) => b.priority === p);
                        const count = entry?._count ?? 0;
                        const pct = Math.round((count / totalPriority) * 100);
                        const cfg = PRIORITY_CFG[p];
                        return (
                          <div key={p}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-medium text-fg-muted">{cfg.label}</span>
                              <span className="text-xs font-bold text-fg tabular-nums">{count}</span>
                            </div>
                            <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${cfg.bar} transition-all`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                )}
              </div>
            )}
          </section>
        )}

        {/* AI query — posts to a MANAGERS-only endpoint, so only managers see it. */}
        {showAiPanels && <AIQueryBar />}

        {/* AI Insights */}
        {showAiPanels && (
          <section className="w-full">
            <SectionTitle label="AI Insights" infoId="dashboard.insights" />
            <AiInsightsWidget />
          </section>
        )}
      </PageBody>

      <MeetingNotesModal open={meetingNotesOpen} onClose={() => setMeetingNotesOpen(false)} />
    </div>
  );
}
