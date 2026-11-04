import { useState } from 'react';
import {
  useAiObservability,
  useAiLogs,
  useSetAiBudget,
  useKnowledgeStats,
  useReindexKnowledge,
  useKnowledgeAsk,
  useAiFeedback,
} from '../api/work';
import {
  AiGeneratedTag, AiInfo, AiNote,
  Alert, Badge, Button, Card, Checkbox, EmptyState, FormError, Input, PageBody, PageHeader,
  Select, SkeletonCard, SkeletonStats, SkeletonTable, StatTile, StatusBadge, Tabs, Toolbar,
  AccessDenied,
} from '../shared/components';
import { Brain, Database, RefreshCw, DollarSign, ThumbsUp, ThumbsDown, Search } from 'lucide-react';
import { useFormat } from '../hooks/useFormat';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../shared/permissions';

/**
 * AI governance & observability (§41, §43, §78, §79, §81).
 *
 * This page exists because of a specific problem: before it, an AI call left
 * no trace. You could not answer "what did AI cost us this month", "how often
 * is it wrong", "which fields did it see", or "did a person or the model take
 * that action" — and no CFO renews spend they can't measure.
 */

const STATUS_VARIANT: Record<string, any> = {
  SUCCESS: 'green',
  ERROR: 'red',
  CACHED: 'blue',
  BLOCKED: 'orange',
  BUDGET_EXCEEDED: 'red',
};

/** A titled list panel — "By feature" and "By model" are the same shape. */
function ListPanel({ title, rows, empty }: {
  title: string;
  rows: { key: string; label: string; calls: number; costUsd: number }[];
  empty: string;
}) {
  return (
    <Card padding="none" className="overflow-hidden">
      <p className="px-4 py-2.5 text-[13px] font-semibold text-fg border-b border-line-subtle">{title}</p>
      {rows.length ? (
        rows.map(r => (
          <div key={r.key} className="flex items-center gap-3 px-4 py-2 border-b border-line-subtle last:border-0 hover:bg-surface-hover transition-colors">
            <span className="text-[12.5px] font-mono text-fg flex-1 truncate" title={r.label}>{r.label}</span>
            <span className="text-[12px] text-fg-muted tabular-nums">{r.calls}</span>
            <span className="text-[12px] text-fg-subtle w-16 text-right tabular-nums">${r.costUsd.toFixed(3)}</span>
          </div>
        ))
      ) : (
        <p className="px-4 py-6 text-[12.5px] text-fg-subtle text-center">{empty}</p>
      )}
    </Card>
  );
}

function ObservabilityPanel() {
  const [days, setDays] = useState(30);
  const { user } = useAuth();
  const { data, isLoading } = useAiObservability(days, can.readAiConfig(user?.role));
  const setBudget = useSetAiBudget();
  const [limit, setLimit] = useState('');
  const [hardStop, setHardStop] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4" aria-hidden="true">
        <SkeletonStats count={4} />
        <SkeletonStats count={4} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <SkeletonCard lines={5} />
          <SkeletonCard lines={5} />
        </div>
      </div>
    );
  }
  if (!data) return null;

  const overBudget = data.budget.limitUsd > 0 && data.budget.percentUsed >= 100;
  const nearBudget = data.budget.limitUsd > 0 && data.budget.percentUsed >= 80 && !overBudget;

  return (
    <div className="space-y-4">
      <Toolbar>
        <Select
          className="w-auto"
          aria-label="Date range"
          value={days}
          onChange={e => setDays(Number(e.target.value))}
        >
          {[7, 30, 90, 365].map(d => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </Select>
      </Toolbar>

      {(overBudget || nearBudget) && (
        <Alert tone={overBudget ? 'danger' : 'warning'}>
          {overBudget ? 'Monthly AI budget exhausted' : 'Approaching your monthly AI budget'} — $
          {data.budget.spendUsd.toFixed(2)} of ${data.budget.limitUsd.toFixed(2)} ({data.budget.percentUsed}%).
          {data.budget.hardStop
            ? ' Hard stop is on, so further AI calls are being blocked.'
            : ' Hard stop is off, so calls continue.'}
        </Alert>
      )}

      {/* License token allowance (set by the platform operator) — separate
          from the org's own USD budget above, and always a hard cap. */}
      {(data.budget as any).tokenLimitMonthly > 0 && (
        <Alert tone={(data.budget as any).tokenPercentUsed >= 100 ? 'danger' : (data.budget as any).tokenPercentUsed >= 80 ? 'warning' : 'info'}>
          License token allowance — {((data.budget as any).tokensUsed ?? 0).toLocaleString()} of {((data.budget as any).tokenLimitMonthly ?? 0).toLocaleString()} tokens used this month ({(data.budget as any).tokenPercentUsed}%).
          {(data.budget as any).tokenPercentUsed >= 100
            ? ' The allowance is exhausted — AI calls are blocked until next month or a license change.'
            : ' AI calls stop automatically when the allowance is used up.'}
        </Alert>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="AI calls" value={<span className="tabular-nums">{data.totalCalls.toLocaleString()}</span>} />
        <StatTile
          label="Success rate"
          value={
            <span className={`tabular-nums ${data.successRate >= 95 ? 'text-success' : 'text-warning'}`}>{data.successRate}%</span>
          }
          hint={`${data.errorCount} error${data.errorCount === 1 ? '' : 's'}`}
        />
        <StatTile label="Total cost" value={<span className="tabular-nums">${data.totalCostUsd.toFixed(2)}</span>} hint={`${data.totalTokens.toLocaleString()} tokens`} />
        <StatTile label="Avg latency" value={<span className="tabular-nums">{data.avgLatencyMs} ms</span>} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Actions executed" value={<span className="tabular-nums">{data.actionsExecuted}</span>} hint="AI wrote to a record" />
        <StatTile label="Rated helpful" value={<span className="text-success tabular-nums">{data.feedbackUp}</span>} />
        <StatTile label="Rated unhelpful" value={<span className="text-danger tabular-nums">{data.feedbackDown}</span>} />
        <StatTile
          label="Budget used"
          value={<span className="tabular-nums">{data.budget.limitUsd > 0 ? `${data.budget.percentUsed}%` : 'No limit'}</span>}
          hint={data.budget.limitUsd > 0 ? `of $${data.budget.limitUsd.toFixed(2)}` : 'Set one below'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ListPanel
          title="By feature"
          empty="No AI calls in this period"
          rows={data.byFeature.slice(0, 12).map(f => ({ key: f.feature, label: f.feature, calls: f.calls, costUsd: f.costUsd }))}
        />
        <ListPanel
          title="By model"
          empty="No models used yet"
          rows={data.byModel.map(m => ({ key: m.model, label: m.model, calls: m.calls, costUsd: m.costUsd }))}
        />
      </div>

      <Card>
        <div className="flex items-center gap-1.5 mb-1">
          <DollarSign size={14} className="text-fg-subtle" />
          <p className="text-[13px] font-semibold text-fg">Monthly budget</p>
        </div>
        <p className="text-[12px] text-fg-muted mb-3">
          With hard stop off, hitting the limit only raises an alert — calls keep working. Turn it on to block AI once
          the limit is reached.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            className="w-40"
            aria-label="Limit in USD"
            placeholder="Limit in USD"
            value={limit}
            onChange={e => setLimit(e.target.value)}
          />
          <Checkbox
            label="Hard stop at limit"
            checked={hardStop}
            onChange={e => setHardStop(e.target.checked)}
          />
          <Button
            size="sm"
            disabled={!limit || Number.isNaN(Number(limit))}
            loading={setBudget.isPending}
            onClick={() => setBudget.mutate({ limitUsd: Number(limit), hardStop })}
          >
            Save budget
          </Button>
        </div>
      </Card>
    </div>
  );
}

function LogsPanel() {
  const [status, setStatus] = useState('');
  const { user } = useAuth();
  const { data, isLoading } = useAiLogs({ status: status || undefined }, can.readAiConfig(user?.role));
  const fmt = useFormat();

  return (
    <>
      <Toolbar className="mb-3">
        <Select className="w-auto" aria-label="Status filter" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['SUCCESS', 'ERROR', 'CACHED', 'BUDGET_EXCEEDED'].map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </Toolbar>

      {isLoading ? (
        <SkeletonTable rows={6} />
      ) : !data?.data.length ? (
        <EmptyState
          icon={<Brain />}
          title="No AI activity yet"
          description="Every AI call will be recorded here with its tokens, cost, latency and what it was allowed to see."
        />
      ) : (
        <Card padding="none" className="overflow-hidden">
          {data.data.map(l => (
            <div key={l.id} className="px-4 py-2.5 border-b border-line-subtle last:border-0 hover:bg-surface-hover transition-colors">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge value={l.status} map={STATUS_VARIANT} size="sm" dot />
                <span className="text-[12.5px] font-mono text-fg truncate max-w-[200px]" title={l.feature}>{l.feature}</span>
                <span className="text-[11.5px] text-fg-subtle truncate max-w-[160px]" title={l.model}>{l.model}</span>
                {l.actionExecuted && <Badge variant="purple" size="sm">action: {l.actionName}</Badge>}
                {l.feedback === 'UP' && <ThumbsUp size={11} className="text-success" />}
                {l.feedback === 'DOWN' && <ThumbsDown size={11} className="text-danger" />}
                <span className="ml-auto text-[11px] text-fg-subtle tabular-nums">{fmt.dateTime(l.createdAt)}</span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-[11px] text-fg-subtle flex-wrap tabular-nums">
                <span>{l.totalTokens.toLocaleString()} tokens</span>
                <span>${Number(l.costUsd).toFixed(5)}</span>
                <span>{l.latencyMs} ms</span>
                {l.user && <span>· {l.user.name}</span>}
                {!!l.redactedFields.length && (
                  <span className="text-warning">
                    · {l.redactedFields.length} field(s) withheld: {l.redactedFields.slice(0, 3).join(', ')}
                  </span>
                )}
              </div>
              {l.errorMessage && <FormError className="mt-1">{l.errorMessage}</FormError>}
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

function KnowledgePanel() {
  const { user } = useAuth();
  const { data, isLoading } = useKnowledgeStats(can.readAiConfig(user?.role));
  const reindex = useReindexKnowledge();
  const ask = useKnowledgeAsk();
  const feedback = useAiFeedback();
  const fmt = useFormat();
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof ask.mutateAsync>> | null>(null);
  const [error, setError] = useState('');

  function runAsk() {
    setError('');
    ask.mutate(question, {
      onSuccess: setResult,
      onError: (err: any) => setError(err?.response?.data?.error || 'Could not answer that.'),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[12.5px] text-fg-muted">
          Retrieval filters by your permissions <em>before</em> ranking, so a restricted user never learns a document
          exists.
        </p>
        <span className="inline-flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            icon={<RefreshCw size={13} />}
            loading={reindex.isPending}
            onClick={() => reindex.mutate()}
          >
            Re-index knowledge base
          </Button>
          <AiInfo id="knowledge.index" align="left" />
        </span>
      </div>

      {reindex.data && (
        <Alert tone="success">
          {reindex.data.message} Vector backend: <strong>{reindex.data.vectorBackend}</strong>. Embedding cost: $
          {reindex.data.costUsd.toFixed(4)}.
        </Alert>
      )}
      {reindex.isError && (
        <Alert tone="danger">
          {(reindex.error as any)?.response?.data?.error || 'Re-indexing failed.'}
        </Alert>
      )}

      {isLoading ? (
        <SkeletonStats count={4} />
      ) : data ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="Documents" value={<span className="tabular-nums">{data.documents}</span>} />
          <StatTile label="Chunks" value={<span className="tabular-nums">{data.chunks}</span>} />
          <StatTile label="Vector backend" value={data.vectorBackend} hint={data.vectorBackend === 'pgvector' ? 'ANN search' : 'in-process cosine'} />
          <StatTile label="Last indexed" value={data.lastIndexedAt ? fmt.date(data.lastIndexedAt) : 'Never'} />
        </div>
      ) : null}

      <Card>
        <div className="flex items-center gap-1.5 mb-2">
          <Search size={14} className="text-fg-subtle" />
          <p className="text-[13px] font-semibold text-fg">Ask the knowledge base</p>
        </div>
        <AiNote id="knowledge.ask" className="mb-3" />
        <div className="flex items-center gap-2">
          <Input
            className="flex-1"
            aria-label="Ask the knowledge base"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="e.g. How many days of annual leave do employees get?"
            onKeyDown={e => {
              if (e.key === 'Enter' && question.trim()) runAsk();
            }}
          />
          <Button
            size="sm"
            loading={ask.isPending}
            disabled={!question.trim()}
            onClick={runAsk}
          >
            Ask
          </Button>
        </div>

        {error && <FormError className="mt-2">{error}</FormError>}

        {result && (
          <div className="mt-3 border-t border-line-subtle pt-3 animate-fade-in">
            <AiGeneratedTag className="mb-2" />
            <p className="text-[13px] text-fg whitespace-pre-wrap leading-relaxed">{result.answer}</p>

            {!!result.citations.length && (
              <div className="mt-3">
                <p className="text-[11.5px] font-semibold text-fg-muted mb-1">Sources</p>
                <div className="space-y-1">
                  {result.citations.map((c, i) => (
                    <p key={c.documentId + i} className="text-[11.5px] text-fg-muted">
                      [{i + 1}] {c.title}
                      {c.heading ? ` → ${c.heading}` : ''} · relevance {(c.score * 100).toFixed(0)}%
                    </p>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 mt-3">
              <span className="text-[11.5px] text-fg-subtle tabular-nums">
                Confidence {(result.confidence * 100).toFixed(0)}%
                {result.confidence < 0.4 && ' — human review recommended'}
              </span>
              {result.logId && (
                <>
                  <Button
                    size="xs"
                    variant="secondary"
                    icon={<ThumbsUp size={11} />}
                    onClick={() => feedback.mutate({ logId: result.logId!, feedback: 'UP' })}
                  >
                    Helpful
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    icon={<ThumbsDown size={11} />}
                    onClick={() => feedback.mutate({ logId: result.logId!, feedback: 'DOWN' })}
                  >
                    Not helpful
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

const TABS = [
  { key: 'observability' as const, label: 'Observability', icon: <Brain size={12} /> },
  { key: 'knowledge'     as const, label: 'Knowledge base', icon: <Database size={12} /> },
  { key: 'logs'          as const, label: 'Interaction log', icon: <Search size={12} /> },
];

export default function AIGovernancePage() {
  const [tab, setTab] = useState<'observability' | 'knowledge' | 'logs'>('observability');
  /* All three panels read /knowledge/* endpoints, every one of them
     MANAGERS-only. There is nothing here for anyone else to look at. */
  const { user } = useAuth();
  if (!can.readAiConfig(user?.role)) return <AccessDenied />;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="AI Governance"
        subtitle="What AI cost, whether it worked, what it was allowed to see, and what it did about it."
        below={<Tabs items={TABS} value={tab} onChange={setTab} variant="segmented" aria-label="Governance section" />}
      />

      <div className="flex-1 overflow-auto">
        <PageBody>
          {tab === 'observability' && <ObservabilityPanel />}
          {tab === 'knowledge' && <KnowledgePanel />}
          {tab === 'logs' && <LogsPanel />}
        </PageBody>
      </div>
    </div>
  );
}
