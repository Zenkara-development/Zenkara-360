import { useState } from 'react';
import { CheckSquare, Plus, Trash2, CalendarClock, User as UserIcon } from 'lucide-react';
import {
  useTasks, useCreateTask, useUpdateTask, useDeleteTask, type Task,
} from '../../api/work';
import { useUsers } from '../../api/users';
import { useFormat } from '../../hooks/useFormat';
import {
  Button, IconButton, Input, Select, Badge, Spinner, EmptyState, Checkbox,
  SearchableSelect, FormError, Card, CardHeader,
} from './index';

/**
 * Tasks attached to one record — drop this onto any detail view.
 *
 * `Task` has always carried a polymorphic `entityType` + `entityId` (indexed
 * as `[orgId, entityType, entityId]`) and the API has always supported
 * `GET /tasks?entityType=DEAL&entityId=…`, but nothing in the UI ever used it.
 * Tasks could only be seen in My Work, disconnected from the deal or ticket
 * they were about.
 *
 * Deliberately compact: this sits alongside comments and attachments in a
 * record's sidebar, so it favours a fast add-and-tick loop over the full task
 * editor on the My Work page. Anything richer — subtasks, dependencies,
 * recurrence — is edited there.
 */

const PRIORITY_VARIANT: Record<string, 'gray' | 'blue' | 'orange' | 'red'> = {
  LOW: 'gray', MEDIUM: 'blue', HIGH: 'orange', URGENT: 'red',
};

/** Readable role names for the assignee list. Falls back to the raw enum. */
const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Admin',
  IT_MANAGER: 'IT Manager',
  IT_AGENT: 'Technician',
  CRM_MANAGER: 'CRM Manager',
  SALES_REP: 'Sales',
  EMPLOYEE: 'Employee',
  PLATFORM_ADMIN: 'Platform Admin',
};

/** EntityType values the server accepts. Keep in step with the Prisma enum. */
export type TaskEntityType =
  | 'DEAL' | 'TICKET' | 'CONTACT' | 'LEAD' | 'ACCOUNT' | 'CHANGE_REQUEST'
  | 'QUOTE' | 'ASSET' | 'CAMPAIGN' | 'EMPLOYEE' | 'APPROVAL_REQUEST'
  | 'DEPARTMENT' | 'INVOICE';

export interface RecordTasksProps {
  entityType: TaskEntityType;
  entityId: string;
  /** Wrap in a Card. Turn off when embedding inside an existing panel. */
  framed?: boolean;
  /** Hide completed tasks behind a toggle instead of listing them. */
  collapseDone?: boolean;
  className?: string;
}

export function RecordTasks({
  entityType,
  entityId,
  framed = true,
  collapseDone = true,
  className = '',
}: RecordTasksProps) {
  const fmt = useFormat();
  const { data, isLoading } = useTasks({ entityType, entityId });
  const { data: usersData } = useUsers();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [error, setError] = useState('');
  const [showDone, setShowDone] = useState(!collapseDone);
  // Which row is mid-save, so ticking one task does not spin every checkbox.
  const [busyId, setBusyId] = useState<string | null>(null);

  const tasks: Task[] = data?.data ?? [];
  const open = tasks.filter(t => t.status !== 'DONE' && t.status !== 'CANCELLED');
  const done = tasks.filter(t => t.status === 'DONE' || t.status === 'CANCELLED');
  const visible = showDone ? [...open, ...done] : open;

  /**
   * `GET /users` returns a bare array, not a `{ data }` envelope — this read
   * `usersData?.data`, which is `undefined` against an array, so the assignee
   * list was silently always empty. useUsers() is now typed as OrgUser[] so
   * the mistake is a compile error rather than an empty dropdown.
   *
   * The role is appended because the common case is picking a technician out
   * of a list that also contains sales and admin staff, and two people can
   * share a first name.
   */
  const userOptions = (usersData ?? []).map(u => ({
    value: u.id,
    label: u.role ? `${u.name} · ${ROLE_LABEL[u.role] ?? u.role.replace(/_/g, ' ').toLowerCase()}` : u.name,
  }));

  function resetForm() {
    setTitle(''); setDueAt(''); setAssignee(''); setPriority('MEDIUM'); setError('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setError('');
    try {
      await createTask.mutateAsync({
        title: title.trim(),
        // This is the whole point of the component: the new task is filed
        // against the record you are looking at.
        entityType,
        entityId,
        dueAt: dueAt || null,
        assigneeUserId: assignee || null,
        priority: priority as Task['priority'],
      });
      resetForm();
      setAdding(false);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Could not add that task.');
    }
  }

  async function toggle(t: Task) {
    setBusyId(t.id);
    setError('');
    try {
      await updateTask.mutateAsync({ id: t.id, status: t.status === 'DONE' ? 'OPEN' : 'DONE' });
    } catch (err: any) {
      // A FINISH_TO_START dependency can legitimately block completion, and
      // the server explains which task is in the way — worth showing.
      setError(err?.response?.data?.error || 'Could not update that task.');
    } finally {
      setBusyId(null);
    }
  }

  const body = (
    <div className="space-y-3">
      {!framed && (
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13.5px] font-semibold text-fg flex items-center gap-1.5">
            <CheckSquare size={14} className="text-fg-muted" />
            Tasks {open.length > 0 && <span className="text-fg-muted font-normal">({open.length})</span>}
          </h3>
          {!adding && (
            <Button size="xs" variant="secondary" icon={<Plus size={12} />} onClick={() => setAdding(true)}>
              Add
            </Button>
          )}
        </div>
      )}

      <FormError>{error}</FormError>

      {adding && (
        <form onSubmit={submit} className="rounded-card border border-line bg-surface-sunken p-3 space-y-2.5">
          <Input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What needs doing?"
            aria-label="Task title"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              type="date"
              value={dueAt}
              onChange={e => setDueAt(e.target.value)}
              aria-label="Due date"
              inputSize="sm"
            />
            <Select
              selectSize="sm"
              value={priority}
              onChange={e => setPriority(e.target.value)}
              aria-label="Priority"
              options={[
                { value: 'LOW', label: 'Low' },
                { value: 'MEDIUM', label: 'Medium' },
                { value: 'HIGH', label: 'High' },
                { value: 'URGENT', label: 'Urgent' },
              ]}
            />
            <SearchableSelect
              ariaLabel="Assign to"
              value={assignee}
              onChange={setAssignee}
              options={userOptions}
              placeholder="Assign to…"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button size="xs" variant="ghost" onClick={() => { setAdding(false); resetForm(); }}>
              Cancel
            </Button>
            <Button size="xs" type="submit" loading={createTask.isPending} disabled={!title.trim()}>
              Add task
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <Spinner compact />
      ) : visible.length === 0 ? (
        <EmptyState
          compact
          icon={<CheckSquare size={20} />}
          title="No tasks yet"
          description="Add one to track follow-up work on this record."
          action={adding ? undefined : { label: 'Add a task', onClick: () => setAdding(true) }}
        />
      ) : (
        <ul className="divide-y divide-line-subtle">
          {visible.map(t => {
            const isDone = t.status === 'DONE' || t.status === 'CANCELLED';
            const overdue = !isDone && t.dueAt && new Date(t.dueAt) < new Date();
            return (
              <li key={t.id} className="group flex items-start gap-2.5 py-2.5">
                <Checkbox
                  checked={isDone}
                  disabled={busyId === t.id}
                  onChange={() => toggle(t)}
                  aria-label={isDone ? `Reopen ${t.title}` : `Complete ${t.title}`}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-[13px] leading-snug ${isDone ? 'line-through text-fg-subtle' : 'text-fg'}`}>
                    {t.title}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    {t.priority !== 'MEDIUM' && (
                      <Badge size="sm" variant={PRIORITY_VARIANT[t.priority] ?? 'gray'}>
                        {t.priority.toLowerCase()}
                      </Badge>
                    )}
                    {t.dueAt && (
                      <span className={`text-[11px] inline-flex items-center gap-1 ${overdue ? 'text-danger font-medium' : 'text-fg-muted'}`}>
                        <CalendarClock size={10} />
                        {fmt.date(t.dueAt)}{overdue ? ' · overdue' : ''}
                      </span>
                    )}
                    {t.assigneeUser?.name && (
                      <span className="text-[11px] text-fg-muted inline-flex items-center gap-1">
                        <UserIcon size={10} />
                        {t.assigneeUser.name}
                      </span>
                    )}
                  </div>
                </div>
                <IconButton
                  label={`Delete ${t.title}`}
                  icon={<Trash2 size={13} />}
                  tone="danger"
                  size="xs"
                  revealOnRowHover
                  onClick={() => deleteTask.mutate(t.id)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {collapseDone && done.length > 0 && (
        <button
          type="button"
          onClick={() => setShowDone(v => !v)}
          className="text-[12px] text-fg-muted hover:text-fg transition-colors"
        >
          {showDone ? 'Hide' : 'Show'} {done.length} completed
        </button>
      )}
    </div>
  );

  if (!framed) return <div className={className}>{body}</div>;

  return (
    <Card className={className}>
      <CardHeader
        title="Tasks"
        icon={<CheckSquare size={14} />}
        subtitle={open.length ? `${open.length} open` : 'Nothing outstanding'}
        actions={
          !adding && (
            <Button size="xs" variant="secondary" icon={<Plus size={12} />} onClick={() => setAdding(true)}>
              Add
            </Button>
          )
        }
      />
      <div className="mt-3">{body}</div>
    </Card>
  );
}
