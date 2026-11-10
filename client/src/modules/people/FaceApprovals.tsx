import { useState } from 'react';
import { ScanFace, CheckCircle2, XCircle, Maximize2, ShieldCheck, ImageOff } from 'lucide-react';
import {
  Button, Badge, Modal, Alert, DataTable, EmptyState, Field, Textarea, Card, InlineSpinner,
} from '../../shared/components';
import { useFormat } from '../../hooks/useFormat';
import {
  useFaceReenrollmentRequests, useFaceReenrollmentRequest, useDecideFaceReenrollment,
} from '../../api/faceReenrollment';

/**
 * Face Approvals — the Super Admin's queue for Face ID re-enrolment requests.
 *
 * An employee who already has a Face ID cannot replace it themselves; they
 * send a request and this screen is where it gets decided. The reviewer
 * compares the *pictures* — the face that is live today against the face in
 * the request — and approves or rejects.
 *
 * Nothing here is invented: the list comes from the server, and the images
 * are the ones the employee actually captured. Where an image is genuinely
 * missing, the screen says so rather than showing a stand-in.
 */

/** The pending-queue table. */
export function FaceApprovalsTable({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, isLoading, error, refetch } = useFaceReenrollmentRequests(true);
  const { dateTime } = useFormat();
  const requests = data?.data ?? [];

  if (error) {
    return (
      <Alert
        tone="danger"
        title="Could not load Face ID requests"
        actions={<Button size="sm" variant="secondary" onClick={() => refetch()}>Retry</Button>}
      >
        {((error as any)?.response?.data?.error) || 'Something went wrong while loading the approval queue.'}
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <Card padding="lg" className="flex items-center justify-center gap-2 text-[13px] text-fg-subtle">
        <InlineSpinner /> Loading pending Face ID requests…
      </Card>
    );
  }

  if (!requests.length) {
    return (
      <Card padding="none">
        <EmptyState
          icon={<ScanFace />}
          title="No Face ID requests waiting"
          description="When an employee asks to replace their Face ID, the request lands here for a Super Admin to approve or reject."
        />
      </Card>
    );
  }

  return (
    <Card padding="none" className="overflow-hidden">
      <DataTable
        minWidth={900}
        rows={requests}
        rowKey={r => r.id}
        onRowClick={r => onOpen(r.id)}
        columns={[
          {
            key: 'employee',
            header: 'Employee',
            cell: r => (
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-fg truncate">{r.employee.name}</p>
                {r.employee.workEmail && (
                  <p className="text-[12px] text-fg-muted truncate">{r.employee.workEmail}</p>
                )}
              </div>
            ),
          },
          {
            key: 'employeeId',
            header: 'Employee ID',
            cell: r => (
              <span className="tabular-nums">{r.employee.employeeCode || r.employee.employeeId || '—'}</span>
            ),
          },
          { key: 'department', header: 'Department', cell: r => r.employee.department || '—' },
          { key: 'designation', header: 'Designation', cell: r => r.employee.designation || '—' },
          {
            key: 'submitted',
            header: 'Submitted',
            cell: r => <span className="tabular-nums">{dateTime(r.submittedAt)}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            cell: () => <Badge variant="yellow" dot>Pending Verification</Badge>,
          },
          {
            key: 'requestId',
            header: 'Request ID',
            cell: r => (
              <span className="font-mono text-[11.5px] text-fg-subtle truncate max-w-[160px] block" title={r.id}>
                {r.id}
              </span>
            ),
          },
        ]}
      />
    </Card>
  );
}

/** A grid of captured samples; clicking one opens the full-size preview. */
function SampleGrid({
  images,
  emptyLabel,
  onEnlarge,
}: {
  images: string[];
  emptyLabel: string;
  onEnlarge: (src: string) => void;
}) {
  const [broken, setBroken] = useState<Record<number, boolean>>({});
  if (!images.length) {
    return (
      <div className="rounded-card border border-dashed border-line-strong bg-surface-sunken p-5 text-center">
        <ScanFace size={20} className="mx-auto text-fg-subtle mb-2" />
        <p className="text-[12.5px] text-fg-muted">{emptyLabel}</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {images.map((src, i) => (
        <button
          key={i}
          type="button"
          onClick={() => !broken[i] && onEnlarge(src)}
          disabled={broken[i]}
          className="group relative block rounded-card overflow-hidden border border-line bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          aria-label={broken[i] ? `Sample ${i + 1} is unavailable` : `Enlarge sample ${i + 1}`}
        >
          {broken[i] ? (
            <span className="flex aspect-square w-full flex-col items-center justify-center gap-1 p-2 text-center">
              <ImageOff size={16} className="text-fg-subtle" />
              <span className="text-[10.5px] text-fg-subtle">Image unavailable</span>
            </span>
          ) : (
            <img
              src={src}
              alt={`Sample ${i + 1}`}
              data-testid={`face-sample-${i + 1}`}
              onError={() => setBroken(b => ({ ...b, [i]: true }))}
              className="w-full aspect-square object-cover -scale-x-100"
            />
          )}
          <span className="absolute bottom-1 right-1 rounded bg-black/55 text-white p-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Maximize2 size={12} />
          </span>
          <span className="absolute bottom-0 left-0 right-0 bg-black/55 text-white text-[10.5px] py-0.5">
            Sample {i + 1}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Face ID Re-enrollment Review.
 *
 * Old samples (live today) on the left, new samples (in the request) on the
 * right on desktop, stacked on a narrow screen. The reviewer decides by
 * looking; the app does not pretend an automatic comparison proves identity.
 */
export function FaceReenrollmentReviewModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { date, dateTime } = useFormat();
  const { data, isLoading, error } = useFaceReenrollmentRequest(id);
  const decide = useDecideFaceReenrollment();
  const [confirming, setConfirming] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState('');
  const [enlarged, setEnlarged] = useState<string | null>(null);

  const e = data?.employee;
  const currentImages = data?.current?.sampleImages?.length
    ? data.current.sampleImages
    : data?.current?.referenceSelfie
      ? [data.current.referenceSelfie]
      : [];
  const currentCount = currentImages.length;
  const newImages = data?.submitted?.sampleImages ?? [];

  async function run(decision: 'approve' | 'reject') {
    setActionError('');
    try {
      await decide.mutateAsync({ id, decision, reason: decision === 'reject' ? reason : undefined });
      setConfirming(null);
      onClose();
    } catch (err: any) {
      setActionError(err?.response?.data?.error || err?.message || 'Could not record that decision.');
    }
  }

  const footer = !data ? undefined : !data.canAct ? (
    <Button variant="secondary" onClick={onClose}>Close</Button>
  ) : confirming ? (
    <>
      <Button variant="ghost" onClick={() => { setConfirming(null); setActionError(''); }} disabled={decide.isPending}>
        Cancel
      </Button>
      <Button
        variant={confirming === 'approve' ? 'primary' : 'danger'}
        icon={confirming === 'approve' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
        loading={decide.isPending}
        onClick={() => run(confirming)}
      >
        {confirming === 'approve' ? 'Yes, approve it' : 'Yes, reject it'}
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={onClose}>Close</Button>
      <Button variant="danger" icon={<XCircle size={14} />} onClick={() => { setActionError(''); setConfirming('reject'); }}>
        Reject
      </Button>
      <Button icon={<CheckCircle2 size={14} />} onClick={() => { setActionError(''); setConfirming('approve'); }}>
        Approve
      </Button>
    </>
  );

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="Face ID Re-enrollment Review"
        subtitle="Compare the employee's current Face ID with the new one they submitted."
        icon={<ShieldCheck size={16} />}
        size="xl"
        footer={footer}
      >
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-fg-subtle">
            <InlineSpinner /> Loading the request…
          </div>
        )}

        {error && (
          <Alert tone="danger" title="Could not load this request">
            {((error as any)?.response?.data?.error) || 'Something went wrong while loading the request.'}
          </Alert>
        )}

        {data && (
          <div className="space-y-5">
            {actionError && <Alert tone="danger">{actionError}</Alert>}

            {!data.canAct && (
              <Alert tone="info">
                This request was already {data.status.toLowerCase()}
                {data.decidedAt ? ` on ${dateTime(data.decidedAt)}` : ''}. It can no longer be decided.
              </Alert>
            )}

            {/* ── Employee details ───────────────────────────────────── */}
            <section>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-fg-subtle mb-2">Employee details</h3>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5">
                {([
                  ['Employee name', e?.name],
                  ['Employee ID', e?.employeeCode || e?.employeeId],
                  ['Department', e?.department],
                  ['Work email', e?.workEmail],
                  ['Designation', e?.designation],
                  ['Request ID', data.id],
                  ['Submitted', dateTime(data.submittedAt)],
                  ['Request status', data.status === 'PENDING' ? 'Pending Verification' : data.status],
                ] as const).map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-[11px] uppercase tracking-wide text-fg-subtle">{label}</dt>
                    <dd className="text-[13px] text-fg break-words">{value || '—'}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {/* ── Old vs new ─────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <section>
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-fg-subtle mb-1">
                  Old face samples — currently active
                </h3>
                <p className="text-[11.5px] text-fg-subtle mb-2">
                  {data.current
                    ? `Enrolled ${date(data.current.enrolledAt)} · ${
                        currentCount === 1
                          ? 'only the reference image is available'
                          : `${currentCount} stored images`
                      }`
                    : 'No active Face ID is on file for this employee.'}
                </p>
                <SampleGrid
                  images={currentImages}
                  emptyLabel="No reference image is available for the current Face ID — this enrolment was created before sample images were stored."
                  onEnlarge={setEnlarged}
                />
              </section>

              <section>
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-fg-subtle mb-1">
                  New face samples — pending verification
                </h3>
                <p className="text-[11.5px] text-fg-subtle mb-2">
                  {newImages.length
                    ? `${newImages.length} submitted image${newImages.length === 1 ? '' : 's'}`
                    : 'No images were submitted with this request.'}
                </p>
                <SampleGrid
                  images={newImages}
                  emptyLabel="This request carries no sample images — only a numeric face signature was submitted."
                  onEnlarge={setEnlarged}
                />
              </section>
            </div>

            {/* ── Confirmation / reason ───────────────────────────────── */}
            {confirming === 'reject' && (
              <Alert tone="warning" title="Reject this request?">
                <p className="mb-2">
                  The employee's current Face ID stays exactly as it is — nothing is removed or overwritten.
                </p>
                <Field label="Reason (optional)" hint="Shown to the employee so they know what to fix.">
                  <Textarea
                    rows={2}
                    value={reason}
                    maxLength={500}
                    onChange={e => setReason(e.target.value)}
                    placeholder="e.g. The photo is too dark to compare against the current Face ID."
                  />
                </Field>
              </Alert>
            )}

            {confirming === 'approve' && (
              <Alert tone="warning" title="Approve this request?">
                The employee's current Face ID is retired and the submitted one becomes their active Face ID. This
                happens in a single transaction — if it cannot be applied, nothing changes.
              </Alert>
            )}
          </div>
        )}
      </Modal>

      {/* Full-size preview of a clicked sample. */}
      {enlarged && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70"
          role="dialog"
          aria-label="Face sample preview"
          onClick={() => setEnlarged(null)}
        >
          <img
            src={enlarged}
            alt="Face sample preview"
            className="max-h-[85vh] max-w-[85vw] rounded-card border border-line object-contain -scale-x-100"
          />
          <button
            type="button"
            onClick={() => setEnlarged(null)}
            className="absolute top-4 right-4 rounded-btn bg-black/60 text-white px-3 py-1.5 text-[12.5px]"
          >
            Close
          </button>
        </div>
      )}
    </>
  );
}
