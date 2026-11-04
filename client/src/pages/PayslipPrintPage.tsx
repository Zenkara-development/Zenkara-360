import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Wallet, Printer, FileDown } from 'lucide-react';
import { Button, EmptyState } from '../shared/components';
import { usePayslipHtml, downloadPdf } from '../api/payslipTemplates';

// Authenticated, in-app print view. Since phase 4 the document itself is
// rendered on the server (utils/payslipRender.ts) from the payslip's pinned
// template, so what prints here, what the PDF contains and what the employee
// receives by e-mail are the same layout. This page only adds the toolbar.
// Managers can pass ?templateId= to preview a payslip in another template.
export default function PayslipPrintPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const templateId = params.get('templateId') ?? undefined;
  const { data, isLoading, error } = usePayslipHtml(id, templateId);
  const [busy, setBusy] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-canvas py-8 px-4 sm:py-14" aria-hidden="true">
        <div className="max-w-2xl mx-auto space-y-3">
          <div className="skeleton h-9 w-40 ml-auto" />
          <div className="skeleton h-[560px] w-full rounded-card" />
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <EmptyState icon={<Wallet />} title={(error as any)?.response?.data?.error || 'This payslip could not be found.'} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas py-8 px-4 sm:py-12 print:py-0 print:px-0 print:bg-white">
      <div className="max-w-3xl mx-auto">
        <div className="flex justify-end gap-2 mb-3 no-print print:hidden">
          <Button variant="secondary" icon={<FileDown size={14} />} loading={busy} onClick={async () => { setBusy(true); try { await downloadPdf(`/hr/payroll/payslips/${id}/pdf${templateId ? `?templateId=${templateId}` : ''}`, `payslip-${id}.pdf`); } finally { setBusy(false); } }}>
            Download PDF
          </Button>
          <Button icon={<Printer size={14} />} onClick={() => window.print()}>Print</Button>
        </div>
        <div className="rounded-card shadow-card overflow-hidden bg-white print:shadow-none print:rounded-none" dangerouslySetInnerHTML={{ __html: data.html }} />
      </div>
      <style>{`@media print { @page { margin: 1.4cm; } body { background: white; } }`}</style>
    </div>
  );
}
