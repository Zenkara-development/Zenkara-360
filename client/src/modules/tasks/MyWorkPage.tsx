import { useState } from 'react';
import {
  useMyWork,
  useCreateTask,
  useUpdateTask,
  useToggleChecklistItem,
  useDecideApproval,
  type Task,
  type PendingApproval,
} from '../../api/work';
import {
  PageHeader, PageBody, Card, StatTile, Button, Modal, Badge, Checkbox,
  Field, Input, Select, Textarea, FormError, EmptyState, SkeletonCard, SkeletonStats,
  priorityVariant,
} from '../../shared/components';
import { CheckSquare, Plus, AlertTriangle, Calendar, Clock, Inbox, Check, X, ChevronRight } from 'lucide-react';
import { useFormat } from '../../hooks/useFormat';

/**
 * "My Work" (§2, §47) — one cross-module queue per person.
 *
 * The organising principle is time, not module: an overdue IT ticket task and
 * an overdue onboarding step belong in the same bucket because they compete
 * for the same hour. Approvals sit alongside because from the user's point of
 * view "someone is waiting on me" is the same kind of obligation as "this is
 * due".
 */

/** Tasks call the top band URGENT where CRM calls it CRITICAL; otherwise the
 *  shared priority map applies unchanged. */
const PRIORITY_VARIANT: Record<string, any> = { ...priorityVariant, URGENT: 'red' };

const STATUS_VARIANT: Record<string, any> = {
  OPEN: 'gray',
  IN_PROGRESS: 'blue',
  BLOCKED: 'red',
  DONE: 'green',
  CANCELLED: 'gray',
};

function TaskRow({ task, onOpen }: { task: Task; onOpen: (t: Task) => void }) {
  const update = useUpdateTask();
  const fmt = useFormat();
  const done = task.status === 'DONE';
  const checklistDone = (task.checklist ?? []).filter(i => i.done).length;
  const checklistTotal = (task.checklist ?? []).length;

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-line-subtle last:border-0 hover:bg-surface-hover transition-colors">
      <Checkbox
        checked={done}
        disabled={update.isPending}
        onChange={() => update.mutate({ id: task.id, status: done ? 'OPEN' : 'DONE' })}
        aria-label={done ? 'Reopen task' : 'Mark task done'}
      />

      {/* Not a Button: this is the row's open-detail hit area, which spans the
          whole title block rather than reading as a control. */}
      <button onClick={() => onOpen(task)} className="flex-1 min-w-0 text-left">
        <p
          className={`text-[13.5px] font-medium truncate ${
            done ? 'line-through text-fg-subtle' : 'text-fg'
          }`}
        >
          {task.title}
        </p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <Badge variant={PRIORITY_VARIANT[task.priority]}>{task.priority}</Badge>
          {task.entityType && (
            <span className="text-[11px] text-fg-subtle">
              {task.entityType.replace(/_/g, ' ').toLowerCase()}
            </span>
          )}
          {checklistTotal > 0 && (
            <span className="text-[11px] text-fg-subtle">
              {checklistDone}/{checklistTotal} done
            </span>
          )}
          {task.dueAt && (
            <span className="text-[11px] text-fg-subtle">{fmt.date(task.dueAt)}</span>
          )}
          {task.assigneeUser && (
            <span className="text-[11px] text-fg-subtle">· {task.assigneeUser.name}</span>
          )}
        </div>
      </button>

      <ChevronRight size={15} className="text-fg-subtle mt-1 shrink-0" />
    </div>
  );
}

function Bucket({
  title,
  icon,
  tone,
  tasks,
  onOpen,
}: {
  title: string;
  icon: React.ReactNode;
  tone: string;
  tasks: Task[];
  onOpen: (t: Task) => void;
}) {
  if (!tasks.length) return null;
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line-subtle">
        <span className={tone}>{icon}</span>
        <h2 className="text-[13px] font-semibold text-fg">{title}</h2>
        <span className="text-[11px] text-fg-subtle tabular-nums">{tasks.length}</span>
      </div>
      <div>
        {tasks.map(t => (
          <TaskRow key={t.id} task={t} onOpen={onOpen} />
        ))}
      </div>
    </Card>
  );
}

function ApprovalCard({ approval }: { approval: PendingApproval }) {
  const decide = useDecideApproval();
  const fmt = useFormat();
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);
  const [error, setError] = useState('');

  const act = (decision: 'APPROVED' | 'REJECTED') => {
    setError('');
    decide.mutate(
      { id: approval.requestId, decision, comment: comment || undefined },
      {
        onError: (err: any) =>
          setError(err?.response?.data?.error || 'Could not record that decision.'),
      }
    );
  };

  return (
    <div className="px-4 py-3 border-b border-line-subtle last:border-0">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-fg truncate">{approval.title}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="yellow">{approval.stepName}</Badge>
            <span className="text-[11px] text-fg-subtle">
              from {approval.requester.name}
            </span>
            {approval.amount != null && (
              <span className="text-[11px] font-medium text-fg-muted tabular-nums">
                {fmt.money(approval.amount)}
              </span>
            )}
            {approval.expiresAt && (
              <span className="text-[11px] text-warning">
                expires {fmt.date(approval.expiresAt)}
              </span>
            )}
          </div>
          {approval.description && (
            <p className="text-[12px] text-fg-muted mt-1.5 line-clamp-2">
              {approval.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="xs" variant="secondary" onClick={() => setShowComment(v => !v)}>
            Note
          </Button>
          <Button size="xs" variant="danger" icon={<X size={12} />} onClick={() => act('REJECTED')} loading={decide.isPending}>
            Reject
          </Button>
          <Button size="xs" icon={<Check size={12} />} onClick={() => act('APPROVED')} loading={decide.isPending}>
            Approve
          </Button>
        </div>
      </div>

      {showComment && (
        <Input
          inputSize="sm"
          className="mt-2"
          value={comment}
          onChange={e => setComment(e.target.value)}
          aria-label="Comment"
          placeholder="Add a comment (optional) — shown to the requester"
        />
      )}
      {error && <FormError className="mt-1.5">{error}</FormError>}
    </div>
  );
}

function TaskDetailModal({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const update = useUpdateTask();
  const toggle = useToggleChecklistItem();
  const fmt = useFormat();
  // Which status button was clicked. One shared `update.isPending` put a
  // spinner on all four at once. Declared above the early return so the hook
  // order stays stable when `task` is null.
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  if (!task) return null;

  return (
    <Modal open={!!task} onClose={onClose} title={task.title} icon={<CheckSquare size={16} />} size="lg">
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={STATUS_VARIANT[task.status]}>{task.status.replace('_', ' ')}</Badge>
          <Badge variant={PRIORITY_VARIANT[task.priority]}>{task.priority}</Badge>
          {task.source !== 'MANUAL' && <Badge variant="purple">{task.source.toLowerCase()}</Badge>}
        </div>

        {task.description && (
          <p className="text-[13px] text-fg-muted whitespace-pre-wrap">{task.description}</p>
        )}

        <div className="grid grid-cols-2 gap-3 text-[12.5px]">
          <div>
            <p className="text-fg-subtle">Due</p>
            <p className="text-fg">{task.dueAt ? fmt.dateTime(task.dueAt) : '—'}</p>
          </div>
          <div>
            <p className="text-fg-subtle">Assigned to</p>
            <p className="text-fg">
              {task.assigneeUser?.name ?? task.assigneeEmployee?.displayName ?? 'Unassigned'}
            </p>
          </div>
        </div>

        {!!task.checklist?.length && (
          <div>
            <p className="text-[12px] font-semibold text-fg-muted mb-2">Checklist</p>
            <div className="space-y-1.5">
              {task.checklist.map(item => (
                <Checkbox
                  key={item.id}
                  checked={item.done}
                  onChange={e => toggle.mutate({ id: task.id, itemId: item.id, done: e.target.checked })}
                  label={
                    <span className={item.done ? 'line-through text-fg-subtle' : 'text-fg'}>
                      {item.text}
                    </span>
                  }
                />
              ))}
            </div>
          </div>
        )}

        {!!task.dependsOn?.length && (
          <div>
            <p className="text-[12px] font-semibold text-fg-muted mb-2">Blocked by</p>
            <div className="space-y-1">
              {task.dependsOn.map(d => (
                <div key={d.dependsOn.id} className="flex items-center gap-2 text-[12.5px]">
                  <Badge variant={STATUS_VARIANT[d.dependsOn.status]}>{d.dependsOn.status}</Badge>
                  <span className="text-fg">{d.dependsOn.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          {(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE'] as const).map(s => (
            <Button
              key={s}
              size="xs"
              variant={task.status === s ? 'primary' : 'secondary'}
              onClick={() => { setPendingStatus(s); update.mutate({ id: task.id, status: s }, { onSettled: () => setPendingStatus(null) }); }}
              loading={pendingStatus === s}
              disabled={!!pendingStatus}
            >
              {s.replace('_', ' ')}
            </Button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function NewTaskModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateTask();
  const [form, setForm] = useState({ title: '', description: '', priority: 'MEDIUM', dueAt: '' });
  const [error, setError] = useState('');

  const submit = () => {
    setError('');
    create.mutate(
      {
        title: form.title,
        description: form.description || undefined,
        priority: form.priority as Task['priority'],
        dueAt: form.dueAt || undefined,
      },
      {
        onSuccess: () => {
          setForm({ title: '', description: '', priority: 'MEDIUM', dueAt: '' });
          onClose();
        },
        onError: (err: any) => setError(err?.response?.data?.error || 'Could not create that task.'),
      }
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New task"
      icon={<CheckSquare size={16} />}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={!form.title.trim()}>
            Create task
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Title">
          <Input
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="What needs doing?"
          />
        </Field>
        <Field label="Details">
          <Textarea
            rows={3}
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority">
            <Select
              value={form.priority}
              onChange={e => setForm({ ...form, priority: e.target.value })}
              options={['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map(p => ({ value: p, label: p }))}
            />
          </Field>
          <Field label="Due">
            <Input
              type="datetime-local"
              value={form.dueAt}
              onChange={e => setForm({ ...form, dueAt: e.target.value })}
            />
          </Field>
        </div>
        <FormError>{error}</FormError>
      </div>
    </Modal>
  );
}

export default function MyWorkPage() {
  const { data, isLoading } = useMyWork();
  const [newOpen, setNewOpen] = useState(false);
  const [detail, setDetail] = useState<Task | null>(null);

  const empty =
    !isLoading &&
    data &&
    !data.overdue.length &&
    !data.today.length &&
    !data.thisWeek.length &&
    !data.later.length &&
    !data.noDate.length &&
    !data.approvals.length;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="My Work"
        subtitle="Everything assigned to you across CRM, IT Desk and HR — plus anything waiting on your approval."
        actions={
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setNewOpen(true)}>
            New task
          </Button>
        }
      />

      <div className="flex-1 overflow-auto">
        <PageBody>
          {isLoading && (
            <div className="space-y-4" aria-hidden="true">
              <SkeletonStats />
              <SkeletonCard lines={4} />
              <SkeletonCard lines={3} />
            </div>
          )}

          {data && !isLoading && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Overdue', value: data.counts.overdue, tone: 'text-danger' },
                  { label: 'Due today', value: data.counts.today, tone: 'text-warning' },
                  { label: 'This week', value: data.counts.thisWeek, tone: 'text-info' },
                  { label: 'Approvals', value: data.counts.approvals, tone: 'text-accent' },
                ].map(s => (
                  <StatTile
                    key={s.label}
                    label={s.label}
                    value={<span className={`tabular-nums ${s.tone}`}>{s.value}</span>}
                  />
                ))}
              </div>

              {!!data.approvals.length && (
                <Card padding="none" className="overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line-subtle">
                    <Inbox size={14} className="text-accent" />
                    <h2 className="text-[13px] font-semibold text-fg">Waiting on you</h2>
                    <span className="text-[11px] text-fg-subtle">{data.approvals.length}</span>
                  </div>
                  {data.approvals.map(a => (
                    <ApprovalCard key={a.stepId} approval={a} />
                  ))}
                </Card>
              )}

              <Bucket title="Overdue" icon={<AlertTriangle size={14} />} tone="text-danger" tasks={data.overdue} onOpen={setDetail} />
              <Bucket title="Today" icon={<Clock size={14} />} tone="text-warning" tasks={data.today} onOpen={setDetail} />
              <Bucket title="This week" icon={<Calendar size={14} />} tone="text-info" tasks={data.thisWeek} onOpen={setDetail} />
              <Bucket title="Later" icon={<Calendar size={14} />} tone="text-fg-subtle" tasks={data.later} onOpen={setDetail} />
              <Bucket title="No date" icon={<CheckSquare size={14} />} tone="text-fg-subtle" tasks={data.noDate} onOpen={setDetail} />
            </>
          )}

          {empty && (
            <EmptyState
              icon={<CheckSquare />}
              title="Nothing on your plate"
              description="Tasks assigned to you and approvals waiting on you will appear here."
              action={{ label: 'Create a task', onClick: () => setNewOpen(true) }}
            />
          )}
        </PageBody>
      </div>

      <NewTaskModal open={newOpen} onClose={() => setNewOpen(false)} />
      <TaskDetailModal task={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
