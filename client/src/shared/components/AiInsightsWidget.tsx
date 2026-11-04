import { Sparkles, CheckCircle, RefreshCw } from 'lucide-react';
import { useAiInsights } from '../../api/ai';
import { AiNote } from './AiInfo';
import { Alert, type AlertTone } from './Alert';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card, CardHeader } from './Card';
import { EmptyState } from './EmptyState';

type InsightType = 'warning' | 'success' | 'info' | string;

/* One tinted panel per insight. This used to be two parallel switch functions
   (an icon colour and a `bg-*-50 dark:bg-*-500/10 border-*-100 …` string) that
   had to be kept in step by hand — Alert already owns that pairing. */
function insightTone(type: InsightType): AlertTone {
  if (type === 'warning') return 'warning';
  if (type === 'success') return 'success';
  return 'info';
}

function SkeletonCard() {
  return (
    <div className="border border-line-subtle rounded-card p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-4 h-4 rounded-full bg-surface-sunken flex-shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <div className="h-3 bg-surface-sunken rounded w-2/3" />
          <div className="h-2 bg-surface-sunken rounded w-full" />
          <div className="h-2 bg-surface-sunken rounded w-3/4" />
        </div>
      </div>
    </div>
  );
}

export function AiInsightsWidget() {
  const insights = useAiInsights();

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="px-5 py-4 border-b border-line-subtle">
        <CardHeader
          title="AI Insights"
          icon={<Sparkles size={15} className="text-accent" />}
          actions={
            <>
              <Badge variant="accent" size="sm">Live</Badge>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => insights.mutate()}
                disabled={insights.isPending}
                icon={<RefreshCw size={12} className={insights.isPending ? 'animate-spin' : ''} />}
              >
                Refresh
              </Button>
            </>
          }
        />
      </div>

      <div className="p-5 space-y-3">
        <AiNote id="dashboard.insights" />

        {/* Nothing runs on mount — this is a mutation, deliberately, so a
            dashboard visit never spends AI budget on its own. Say so, and make
            Refresh the call to action, rather than leaving a skeleton that
            implies a load is already in flight. */}
        {insights.isIdle && (
          <div className="text-center py-6 space-y-2">
            <p className="text-sm text-fg-muted">
              Insights are generated on request, so they are not loaded automatically.
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => insights.mutate()}
              icon={<RefreshCw size={13} />}
            >
              Refresh to generate insights
            </Button>
          </div>
        )}

        {insights.isPending && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {insights.isError && (
          <div className="text-center py-6 text-sm text-fg-subtle">
            Failed to load insights.{' '}
            <Button variant="ghost" size="xs" onClick={() => insights.mutate()} className="!text-accent underline">
              Retry
            </Button>
          </div>
        )}

        {insights.data && insights.data.insights.length === 0 && (
          <EmptyState
            compact
            icon={<CheckCircle />}
            title="All clear — no critical insights"
            description="Your CRM and IT Desk look healthy right now."
          />
        )}

        {insights.data?.insights.map((insight: { type: string; title: string; description: string; action?: string }, i: number) => (
          <Alert key={i} tone={insightTone(insight.type)} title={insight.title}>
            <p className="leading-relaxed">{insight.description}</p>
            {insight.action && (
              <p className="text-xs font-medium mt-2 text-accent">{insight.action}</p>
            )}
          </Alert>
        ))}
      </div>
    </Card>
  );
}
