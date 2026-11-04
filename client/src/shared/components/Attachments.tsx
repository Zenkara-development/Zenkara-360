import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { Paperclip, Download, Trash2, Upload, FileText, Image, FileArchive, File as FileIcon, Eye } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { IconButton, Spinner, FormError } from './index';
import { can } from '../permissions';

/** Must stay in step with the server's EntityType enum + entityAccess.ENTITY_MODEL. */
export type AttachmentEntityType =
  | 'DEAL' | 'TICKET' | 'CONTACT' | 'LEAD' | 'ACCOUNT'
  | 'CHANGE_REQUEST' | 'QUOTE' | 'ASSET' | 'CAMPAIGN'
  | 'EMPLOYEE' | 'TASK' | 'APPROVAL_REQUEST' | 'DEPARTMENT' | 'INVOICE';

interface AttachmentsProps {
  entityType: AttachmentEntityType;
  entityId: string;
}

interface UploadPolicy {
  maxBytes: number;
  allowedExtensions: string[];
}

/** Used until GET /attachments/policy answers — matches the server's defaults. */
const FALLBACK_POLICY: UploadPolicy = { maxBytes: 25 * 1024 * 1024, allowedExtensions: [] };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(mimeType: string) {
  if (mimeType.startsWith('image/')) return Image;
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return FileArchive;
  if (mimeType.includes('pdf') || mimeType.includes('text') || mimeType.includes('document')) return FileText;
  return FileIcon;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/** Types a browser can render directly in a tab — these get a View action
 *  alongside Download; everything else (zip, docx, …) downloads only. */
function isViewable(mimeType: string): boolean {
  return (
    mimeType.startsWith('image/') ||
    mimeType === 'application/pdf' ||
    mimeType.startsWith('text/') ||
    mimeType.startsWith('video/') ||
    mimeType.startsWith('audio/')
  );
}

/**
 * Checks a file against the same rules the server enforces, so a 25MB video
 * is rejected instantly instead of after a two-minute upload that ends in a
 * 413. Returns null when the file is fine.
 *
 * This is a courtesy, not a control — uploadPolicy.ts on the server is the
 * one that decides.
 */
function rejectionReason(file: File, policy: UploadPolicy): string | null {
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (file.size > policy.maxBytes) {
    return `"${file.name}" is ${formatSize(file.size)} — the limit is ${formatSize(policy.maxBytes)}.`;
  }
  const ext = extensionOf(file.name);
  if (!ext) return `"${file.name}" has no file extension, so we cannot tell what it is.`;
  if (policy.allowedExtensions.length && !policy.allowedExtensions.includes(ext)) {
    return `${ext} files cannot be attached.`;
  }
  return null;
}

export function Attachments({ entityType, entityId }: AttachmentsProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ['attachments', entityType, entityId];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  // Which row is mid-download/delete, so one file's spinner is not every file's.
  const [busyId, setBusyId] = useState<string | null>(null);

  /* Every /attachments/* route is ALL_STAFF on the server, and this panel is
     embedded in record views an EMPLOYEE legitimately opens (their own
     ticket). Listing, the policy lookup, upload and download are all refused
     for them, so nothing is asked for and the panel is left out. */
  const canReadAttachments = can.readStaffRecords(user?.role);

  const { data: attachments = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get(`/attachments/${entityType}/${entityId}`).then(r => r.data),
    enabled: !!entityId && canReadAttachments,
  });

  // Fetched rather than hardcoded so the picker's accept list and the error
  // messages can never drift from what the server will actually take.
  const { data: policy = FALLBACK_POLICY } = useQuery<UploadPolicy>({
    queryKey: ['attachment-policy'],
    // Normalised rather than trusted. A server that predates this endpoint
    // returns the attachment list handler's `[]`, and a proxy in front of the
    // API can return an HTML error page with a 200 — either way, reading
    // `.allowedExtensions.length` off it takes down the whole record view.
    queryFn: () => api.get('/attachments/policy').then(r => {
      const d = r.data;
      return {
        maxBytes: typeof d?.maxBytes === 'number' && d.maxBytes > 0 ? d.maxBytes : FALLBACK_POLICY.maxBytes,
        allowedExtensions: Array.isArray(d?.allowedExtensions) ? d.allowedExtensions : [],
      };
    }),
    staleTime: 60 * 60 * 1000,
    retry: false,
    enabled: canReadAttachments,
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.post(`/attachments/${entityType}/${entityId}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then(r => r.data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setError(''); },
    onError: (err: any) => setError(err?.response?.data?.error || 'Upload failed'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/attachments/${id}`).then(r => r.data),
    onMutate: (id: string) => { setBusyId(id); setError(''); },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    // Deleting can fail for real reasons — the org's Drive connection changed
    // since the file was uploaded, or someone else's file. Silence here meant
    // the row simply stayed put with no explanation.
    onError: (err: any) => setError(err?.response?.data?.error || 'Could not delete that file.'),
    onSettled: () => setBusyId(null),
  });

  async function download(a: any) {
    setBusyId(a.id);
    setError('');
    try {
      const res = await api.get(`/attachments/${a.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = a.fileName;
      // Firefox ignores click() on a detached anchor, and revoking the URL in
      // the same tick can cancel the download before it starts.
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err: any) {
      // The error body arrives as a Blob because of responseType, so the usual
      // err.response.data.error is a Blob, not a string — read it back.
      let message = 'Could not download that file.';
      const body = err?.response?.data;
      if (body instanceof Blob) {
        try { message = JSON.parse(await body.text())?.error || message; } catch { /* keep default */ }
      } else if (body?.error) {
        message = body.error;
      }
      setError(message);
    } finally {
      setBusyId(null);
    }
  }

  /** Opens the file in a new tab for in-browser viewing (images, PDFs, text,
   *  audio/video). The tab must be opened synchronously — before the awaited
   *  fetch — or popup blockers kill it; its location is then pointed at the
   *  authenticated blob once the bytes arrive. */
  async function view(a: any) {
    const tab = window.open('', '_blank');
    if (tab) tab.document.write('Loading ' + a.fileName.replace(/[<>&]/g, '') + '…');
    setBusyId(a.id);
    setError('');
    try {
      const res = await api.get(`/attachments/${a.id}/download`, { responseType: 'blob' });
      // Re-wrap so the blob's type is the attachment's real mime type — that
      // is what makes the browser render it instead of downloading it.
      const blob = new Blob([res.data], { type: a.mimeType });
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.open(url, '_blank'); // popup was blocked; try direct
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      if (tab) tab.close();
      let message = 'Could not open that file.';
      const body = err?.response?.data;
      if (body instanceof Blob) {
        try { message = JSON.parse(await body.text())?.error || message; } catch { /* keep default */ }
      } else if (body?.error) {
        message = body.error;
      }
      setError(message);
    } finally {
      setBusyId(null);
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const rejected: string[] = [];
    const accepted: File[] = [];
    for (const f of Array.from(files)) {
      const reason = rejectionReason(f, policy);
      if (reason) rejected.push(reason);
      else accepted.push(f);
    }
    setError(rejected.join(' '));
    accepted.forEach(f => upload.mutate(f));
  }

  const maxLabel = formatSize(policy.maxBytes);

  // After every hook, never before one.
  if (!canReadAttachments) return null;

  return (
    <div className="border-t border-line pt-4 mt-4">
      <h3 className="text-sm font-semibold text-fg mb-3 flex items-center gap-1.5">
        <Paperclip size={14} /> Attachments ({attachments.length})
      </h3>

      <FormError>{error}</FormError>

      <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
        {isLoading ? (
          <Spinner compact />
        ) : attachments.length === 0 ? (
          <p className="text-xs text-fg-subtle text-center py-3">No files attached yet.</p>
        ) : (
          attachments.map((a: any) => {
            const Icon = iconFor(a.mimeType);
            const canDelete = a.uploader?.id === user?.id || user?.role === 'SUPER_ADMIN';
            const busy = busyId === a.id;
            return (
              <div key={a.id} className="flex items-center gap-2 group bg-surface-sunken rounded-card px-3 py-2">
                <Icon size={16} className="text-fg-subtle flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-fg truncate" title={a.fileName}>{a.fileName}</p>
                  <p className="text-xs text-fg-subtle">
                    {formatSize(a.fileSize)} · {a.uploader?.name} · {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                  </p>
                </div>
                {isViewable(a.mimeType) && (
                  <IconButton
                    label={`View ${a.fileName}`}
                    icon={<Eye size={14} />}
                    size="xs"
                    disabled={busy}
                    onClick={() => view(a)}
                  />
                )}
                <IconButton
                  label={`Download ${a.fileName}`}
                  icon={<Download size={14} />}
                  size="xs"
                  disabled={busy}
                  onClick={() => download(a)}
                />
                {canDelete && (
                  <IconButton
                    label={`Delete ${a.fileName}`}
                    icon={<Trash2 size={14} />}
                    tone="danger"
                    size="xs"
                    revealOnRowHover
                    disabled={busy}
                    onClick={() => remove.mutate(a.id)}
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => fileInputRef.current?.click()}
        className={`flex items-center justify-center gap-2 border-2 border-dashed rounded-card py-3 cursor-pointer transition-colors ${
          dragOver ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-line hover:border-line-strong'
        }`}
      >
        <Upload size={14} className="text-fg-subtle" />
        <span className="text-xs text-fg-muted">
          {upload.isPending ? 'Uploading…' : `Click or drag a file to attach (max ${maxLabel})`}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          // Filters the OS picker to what the server accepts. Drag-and-drop
          // bypasses this, which is why rejectionReason() runs on every path.
          accept={policy.allowedExtensions.length ? policy.allowedExtensions.join(',') : undefined}
          onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>
    </div>
  );
}
