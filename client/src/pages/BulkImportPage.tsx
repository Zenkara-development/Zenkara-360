import { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api/client';
import { FileText, CheckCircle, AlertCircle } from 'lucide-react';
import {
  PageHeader, PageBody, Card, Button, Textarea, Alert, StatTile,
  Table, Th, Td,
} from '../shared/components';

interface ImportResult { message: string; created: number; updated?: number; errors: number; total: number; }
interface PreviewResult { rows: Record<string, string>[]; total: number; }

const ENTITY_TYPES = [
  { value: 'contacts', label: 'Contacts', columns: 'name, email, phone, company' },
  { value: 'leads', label: 'Leads', columns: 'name, email, source, phone, company' },
];

export default function BulkImportPage() {
  const [entityType, setEntityType] = useState('contacts');
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const previewMutation = useMutation({
    mutationFn: () => api.post(`/import/${entityType}`, { csv: csvText, preview: true }).then(r => r.data),
    onSuccess: (data) => setPreview(data),
  });

  const importMutation = useMutation({
    mutationFn: () => api.post(`/import/${entityType}`, { csv: csvText, preview: false }).then(r => r.data),
    onSuccess: (data) => { setResult(data); setPreview(null); },
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setCsvText(ev.target?.result as string); setPreview(null); setResult(null); };
    reader.readAsText(file);
  }

  const entity = ENTITY_TYPES.find(e => e.value === entityType)!;

  return (
    <div className="animate-slide-up">
      <PageHeader
        title="Bulk CSV Import"
        subtitle="Import contacts or leads from a CSV file"
      />

      <PageBody width="wide">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Controls */}
          <div className="lg:col-span-1 space-y-4">
            {/* Entity selector */}
            <Card padding="sm">
              <p className="form-label">Import as</p>
              <div className="space-y-2">
                {ENTITY_TYPES.map(e => (
                  <label key={e.value} className="flex items-center gap-2 text-sm cursor-pointer text-fg">
                    <input type="radio" name="entityType" value={e.value} checked={entityType === e.value}
                      onChange={() => { setEntityType(e.value); setPreview(null); setResult(null); }} className="accent-accent" />
                    <span className="font-medium">{e.label}</span>
                  </label>
                ))}
              </div>
            </Card>

            {/* Column reference */}
            <Alert tone="info" title="Expected columns" icon={null}>
              <p className="font-mono">{entity.columns}</p>
              <p className="mt-2">First row must be headers. Email is used for deduplication.</p>
            </Alert>

            {/* File upload */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center gap-2 justify-center px-4 py-3 border-2 border-dashed border-line-strong rounded-card text-sm text-fg-muted cursor-pointer hover:border-accent hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
            >
              <FileText size={16} /> Choose CSV file
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </div>

          {/* Main area */}
          <div className="lg:col-span-2 space-y-4">
            {/* CSV text area */}
            <Card padding="none">
              <div className="px-4 py-3 border-b border-line-subtle flex items-center justify-between">
                <span className="text-sm font-medium text-fg">CSV Content</span>
                {csvText && <span className="text-xs text-fg-subtle tabular-nums">{csvText.split('\n').length - 1} rows</span>}
              </div>
              <div className="p-3">
                <Textarea
                  aria-label="CSV Content"
                  className="h-48 !resize-none text-xs font-mono"
                  placeholder={`name,email,phone,company\nJohn Doe,john@example.com,555-1234,Acme Corp`}
                  value={csvText}
                  onChange={e => { setCsvText(e.target.value); setPreview(null); setResult(null); }}
                />
              </div>
            </Card>

            {/* Action buttons */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                block
                disabled={!csvText}
                loading={previewMutation.isPending}
                onClick={() => previewMutation.mutate()}
              >
                {previewMutation.isPending ? 'Parsing…' : 'Preview (5 rows)'}
              </Button>
              <Button
                block
                disabled={!csvText}
                loading={importMutation.isPending}
                onClick={() => importMutation.mutate()}
              >
                {importMutation.isPending ? 'Importing…' : 'Import All'}
              </Button>
            </div>

            {/* Preview table */}
            {preview && (
              <Card padding="none" className="overflow-hidden">
                <div className="px-4 py-2 border-b border-line-subtle text-sm text-fg-muted font-medium">
                  Preview — showing 5 of {preview.total} rows
                </div>
                <Table>
                  <thead>
                    <tr>
                      {Object.keys(preview.rows[0] ?? {}).map(col => (
                        <Th key={col}>{col}</Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((v, j) => (
                          <Td key={j} className="max-w-xs truncate" title={v}>{v}</Td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            )}

            {/* Result */}
            {result && (
              <Alert
                tone={result.errors === 0 ? 'success' : 'warning'}
                icon={result.errors === 0
                  ? <CheckCircle size={18} className="text-success" />
                  : <AlertCircle size={18} className="text-warning" />}
                title="Import complete"
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                  <StatTile label="Total" value={result.total} />
                  <StatTile label="Created" value={result.created} />
                  <StatTile label="Updated" value={result.updated ?? 0} />
                  <StatTile label="Errors" value={result.errors} />
                </div>
              </Alert>
            )}
          </div>
        </div>
      </PageBody>
    </div>
  );
}
