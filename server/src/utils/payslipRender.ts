/**
 * Payslip document model + the two renderers that share it (phase 4).
 *
 *  - buildPayslipDoc()  turns a Payslip row (+ template, employee, org) into a
 *                       plain, render-ready object: every visibility decision
 *                       is made here, once.
 *  - renderPayslipHtml() self-contained HTML (inline CSS) — used by the in-app
 *                       print view, template previews and the e-mail body.
 *  - renderPayslipPdf()  PDFKit — no headless browser, so it runs anywhere the
 *                       API runs (Render free tier included). Same doc, same
 *                       layout registry, so the PDF and the HTML agree.
 *
 * Eight layouts are expressed as *style configs* rather than eight code paths,
 * so adding a ninth is a registry entry.
 */
import PDFDocument from 'pdfkit';

// ─── Layout registry ─────────────────────────────────────────────────────────

export type LayoutKey = 'STANDARD' | 'MODERN' | 'MINIMAL' | 'DETAILED' | 'COMPACT' | 'CORPORATE' | 'BRANCH' | 'STATEMENT';

export interface LayoutStyle {
  key: LayoutKey;
  name: string;
  description: string;
  /** How the letterhead is drawn */
  header: 'line' | 'band' | 'plain' | 'boxed';
  /** Earnings/deductions side by side or stacked as one statement table */
  columns: 1 | 2;
  /** Font sizing */
  density: 'normal' | 'compact' | 'airy';
  /** Draw table borders around every cell (formal look) */
  bordered: boolean;
  /** Field defaults for a template created with this layout */
  defaults: Partial<Record<FieldKey, boolean>>;
  /** Show the branch/location block prominently in the header */
  branchHeader?: boolean;
  /** Serif body font (PDF: Times) */
  serif?: boolean;
}

export const LAYOUTS: LayoutStyle[] = [
  { key: 'STANDARD',  name: 'Standard',   description: 'Two columns, accent rule under the letterhead. The classic Indian payslip.', header: 'line',  columns: 2, density: 'normal',  bordered: false, defaults: {} },
  { key: 'MODERN',    name: 'Modern',     description: 'Colour band header, rounded summary tiles, generous spacing.',            header: 'band',  columns: 2, density: 'airy',    bordered: false, defaults: { daysSummary: true } },
  { key: 'MINIMAL',   name: 'Minimal',    description: 'Monochrome, thin rules, no logo band — prints well in black and white.',  header: 'plain', columns: 2, density: 'normal',  bordered: false, defaults: { employerContributions: false, amountInWords: false } },
  { key: 'DETAILED',  name: 'Detailed',   description: 'Every employee field, bank + statutory IDs, days summary, CTC contributions, amount in words.', header: 'line', columns: 2, density: 'normal', bordered: false, defaults: { bankDetails: true, statutoryIds: true, employerContributions: true, amountInWords: true, daysSummary: true, joiningDate: true, costCenter: true, ctc: true } },
  { key: 'COMPACT',   name: 'Compact',    description: 'Dense single page for high-volume printing; small type, no extras.',      header: 'line',  columns: 2, density: 'compact', bordered: true,  defaults: { amountInWords: false, employerContributions: false, signature: false } },
  { key: 'CORPORATE', name: 'Corporate',  description: 'Fully boxed tables, serif body, formal signatory block.',                  header: 'boxed', columns: 2, density: 'normal',  bordered: true,  defaults: { amountInWords: true, signature: true }, serif: true },
  { key: 'BRANCH',    name: 'Branch',     description: 'Branch / office address takes the header; ideal for multi-location orgs.', header: 'band',  columns: 2, density: 'normal',  bordered: false, defaults: { location: true, bankDetails: true }, branchHeader: true },
  { key: 'STATEMENT', name: 'Statement',  description: 'One statement-style table: earnings, then deductions, then net — like a bank statement.', header: 'line', columns: 1, density: 'normal', bordered: true, defaults: { amountInWords: true } },
];
export const layoutFor = (key: string | null | undefined): LayoutStyle => LAYOUTS.find(l => l.key === key) ?? LAYOUTS[0];

// ─── Field visibility ────────────────────────────────────────────────────────

export type FieldKey =
  | 'employeeCode' | 'designation' | 'department' | 'location' | 'joiningDate' | 'costCenter' | 'email'
  | 'bankDetails' | 'statutoryIds' | 'daysSummary' | 'employerContributions' | 'ctc' | 'amountInWords' | 'signature' | 'paidStamp' | 'lineBasis';

export const PAYSLIP_FIELDS: { key: FieldKey; label: string; group: 'Employee' | 'Blocks'; default: boolean }[] = [
  { key: 'employeeCode', label: 'Employee code', group: 'Employee', default: true },
  { key: 'designation', label: 'Designation', group: 'Employee', default: true },
  { key: 'department', label: 'Department', group: 'Employee', default: true },
  { key: 'location', label: 'Location / branch', group: 'Employee', default: false },
  { key: 'joiningDate', label: 'Date of joining', group: 'Employee', default: false },
  { key: 'costCenter', label: 'Cost centre', group: 'Employee', default: false },
  { key: 'email', label: 'Work e-mail', group: 'Employee', default: false },
  { key: 'bankDetails', label: 'Bank name + masked account', group: 'Employee', default: false },
  { key: 'statutoryIds', label: 'PAN / UAN / ESI numbers', group: 'Employee', default: false },
  { key: 'daysSummary', label: 'Working / paid / LOP days + overtime', group: 'Blocks', default: true },
  { key: 'employerContributions', label: 'Employer contributions (PF / ESI)', group: 'Blocks', default: false },
  { key: 'ctc', label: 'Annual CTC', group: 'Blocks', default: false },
  { key: 'amountInWords', label: 'Net pay in words', group: 'Blocks', default: true },
  { key: 'signature', label: 'Signature block', group: 'Blocks', default: true },
  { key: 'paidStamp', label: '"PAID" stamp once paid', group: 'Blocks', default: true },
  { key: 'lineBasis', label: 'Show how each line was calculated', group: 'Blocks', default: false },
];

export function resolveFields(layout: LayoutStyle, stored: any): Record<FieldKey, boolean> {
  const out = {} as Record<FieldKey, boolean>;
  for (const f of PAYSLIP_FIELDS) out[f.key] = stored && typeof stored[f.key] === 'boolean' ? stored[f.key] : (layout.defaults[f.key] ?? f.default);
  return out;
}

// ─── Document model ──────────────────────────────────────────────────────────

export interface DocLine { code: string; name: string; amount: number; basis?: string | null }
export interface PayslipDoc {
  layout: LayoutStyle;
  fields: Record<FieldKey, boolean>;
  currency: string;
  locale: string;
  company: { name: string; address: string | null; logoUrl: string | null; branch: string | null; branchAddress: string | null };
  brand: { primary: string; accent: string; title: string; headerNote: string | null; footerNote: string | null; signatureLabel: string; signatoryName: string | null; signatureUrl: string | null; showSignature: boolean };
  payslip: { number: string; periodLabel: string; periodStart: string | null; periodEnd: string | null; status: string; paidAt: string | null; generatedAt: string; cycleName: string | null };
  employee: { name: string; code: string | null; designation: string | null; department: string | null; location: string | null; joiningDate: string | null; costCenter: string | null; email: string | null; bankName: string | null; bankAccountMasked: string | null; bankIfsc: string | null; pan: string | null; uan: string | null; esi: string | null };
  days: { working: number; paid: number; present: number; leave: number; half: number; lop: number; overtimeHours: number } | null;
  earnings: DocLine[];
  reimbursements: DocLine[];
  deductions: DocLine[];
  employerContributions: DocLine[];
  totals: { earnings: number; reimbursements: number; deductions: number; employer: number; net: number; ctcAnnual: number | null };
  netInWords: string;
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const n = (v: any) => (v == null ? 0 : Number(v));
const iso = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const mask = (acct: string | null | undefined) => (acct ? acct.replace(/.(?=.{4})/g, 'X') : null);

export function buildPayslipDoc(input: {
  payslip: any; template: any; employee: any | null; org: { name: string; currency: string };
}): PayslipDoc {
  const { payslip: p, template: t, employee: e, org } = input;
  const layout = layoutFor(t?.layout);
  const fields = resolveFields(layout, t?.showFields);
  const lines: any[] = (p.lines ?? []).slice().sort((a: any, b: any) => a.displayOrder - b.displayOrder);
  const visible = lines.filter(l => l.showOnPayslip !== false);
  const toLine = (l: any): DocLine => ({ code: l.code, name: l.name, amount: n(l.amount), basis: l.basis ?? null });
  const legacy = lines.length === 0;
  const earnings = legacy
    ? [{ code: 'BASIC', name: 'Basic', amount: n(p.basic) }, { code: 'HRA', name: 'HRA', amount: n(p.hra) }, { code: 'ALLOW', name: 'Allowances', amount: n(p.allowances) }].filter(l => l.amount)
    : visible.filter(l => l.category === 'EARNING').map(toLine);
  const deductions = legacy
    ? [{ code: 'PF', name: 'Provident Fund', amount: n(p.pf) }, { code: 'PT', name: 'Professional Tax', amount: n(p.professionalTax) }, { code: 'OTH', name: 'Other Deductions', amount: n(p.otherDeductions) }].filter(l => l.amount)
    : visible.filter(l => l.category === 'DEDUCTION').map(toLine);
  const reimbursements = legacy ? [] : visible.filter(l => l.category === 'REIMBURSEMENT').map(toLine);
  const employerContributions = legacy ? [] : lines.filter(l => l.category === 'EMPLOYER_CONTRIBUTION').map(toLine);
  const totals = {
    earnings: n(p.totalEarnings ?? p.grossPay), reimbursements: n(p.totalReimbursements), deductions: n(p.totalDeductions),
    employer: n(p.employerContributions), net: n(p.netPay), ctcAnnual: p.employeeSalary?.ctcAnnual != null ? n(p.employeeSalary.ctcAnnual) : null,
  };
  const cycle = p.payrollRun?.payrollCycle ?? null;
  const periodLabel = cycle && cycle.frequency !== 'MONTHLY' && p.periodStart && p.periodEnd
    ? `${fmtDate(p.periodStart)} – ${fmtDate(p.periodEnd)}`
    : `${MONTHS[p.month]} ${p.year}`;
  const locName = e?.location?.name ?? null;
  const locAddress = e?.location ? [e.location.addressLine1, e.location.addressLine2, [e.location.city, e.location.state, e.location.postalCode].filter(Boolean).join(' '), e.location.country].filter(Boolean).join('\n') : null;
  return {
    layout, fields, currency: org.currency || 'INR', locale: (org.currency || 'INR') === 'INR' ? 'en-IN' : 'en-US',
    company: { name: t?.companyName || org.name, address: t?.companyAddress ?? null, logoUrl: t?.logoUrl ?? null, branch: locName, branchAddress: locAddress },
    brand: {
      primary: t?.primaryColor || '#2563eb', accent: t?.accentColor || t?.primaryColor || '#2563eb', title: t?.headerTitle || 'Payslip',
      headerNote: t?.headerNote ?? null, footerNote: t?.footerNote ?? null, signatureLabel: t?.signatureLabel || 'Authorized Signatory',
      signatoryName: t?.signatoryName ?? null, signatureUrl: t?.signatureUrl ?? null, showSignature: (t?.showSignature ?? true) && fields.signature,
    },
    payslip: { number: p.payslipNumber, periodLabel, periodStart: iso(p.periodStart), periodEnd: iso(p.periodEnd), status: p.status, paidAt: iso(p.paidAt), generatedAt: iso(p.createdAt) ?? '', cycleName: cycle?.name ?? null },
    employee: {
      name: p.user?.name ?? e?.displayName ?? '', code: e?.employeeCode ?? null, designation: e?.designation ?? null,
      department: e?.department?.name ?? p.user?.department ?? null, location: locName, joiningDate: iso(e?.joiningDate), costCenter: e?.costCenter ?? null,
      email: e?.workEmail ?? p.user?.email ?? null, bankName: e?.bankName ?? null, bankAccountMasked: mask(e?.bankAccountNumber), bankIfsc: e?.bankIfsc ?? null,
      pan: e?.taxId ?? null, uan: e?.socialSecurityId ?? null, esi: e?.nationalId ?? null,
    },
    days: p.paidDays != null ? { working: n(p.workingDays), paid: n(p.paidDays), present: n(p.presentDays), leave: n(p.leaveDays), half: n(p.halfDays), lop: n(p.lopDays), overtimeHours: n(p.overtimeHours) } : null,
    earnings, reimbursements, deductions, employerContributions, totals,
    netInWords: amountInWords(totals.net, org.currency || 'INR'),
  };
}

/** A sample document for template previews when no payslip exists yet. */
export function samplePayslipDoc(template: any, org: { name: string; currency: string }): PayslipDoc {
  const today = new Date(); const m = today.getMonth() || 12; const y = m === 12 ? today.getFullYear() - 1 : today.getFullYear();
  const mk = (code: string, name: string, category: string, amount: number, order: number, basis?: string) => ({ code, name, category, amount, displayOrder: order, showOnPayslip: true, basis });
  const lines = [
    mk('BASIC', 'Basic Salary', 'EARNING', 30000, 10, 'fixed'), mk('HRA', 'House Rent Allowance', 'EARNING', 12000, 20, '40% of BASIC'),
    mk('CONVEYANCE', 'Conveyance Allowance', 'EARNING', 1600, 30, 'fixed'), mk('SPECIAL', 'Special Allowance', 'EARNING', 6400, 40, 'fixed'),
    mk('PF_EMP', 'Provident Fund', 'DEDUCTION', 1800, 100, '12% of BASIC (ceiling 15000)'), mk('PT', 'Professional Tax', 'DEDUCTION', 200, 120, 'slab'),
    mk('LOP', 'Loss of Pay', 'DEDUCTION', 2272.73, 150, '1 day'), mk('PF_EMPLOYER', 'Employer PF', 'EMPLOYER_CONTRIBUTION', 1800, 300),
  ];
  const payslip = {
    payslipNumber: `PAY-${y}-${String(m).padStart(2, '0')}-0001`, month: m, year: y, status: 'PAID', paidAt: new Date(), createdAt: new Date(),
    totalEarnings: 50000, totalReimbursements: 0, totalDeductions: 4272.73, employerContributions: 1800, netPay: 45727.27,
    workingDays: 22, paidDays: 21, presentDays: 20, leaveDays: 1, halfDays: 0, lopDays: 1, overtimeHours: 2.5, lines,
    user: { name: 'Priya Sharma', email: 'priya@example.com', department: 'Engineering' }, employeeSalary: { ctcAnnual: 720000 },
  };
  const employee = { employeeCode: 'EMP-0042', designation: 'Senior Engineer', department: { name: 'Engineering' }, location: { name: 'Hyderabad', addressLine1: 'Plot 12, HITEC City', city: 'Hyderabad', state: 'Telangana', postalCode: '500081', country: 'India' }, joiningDate: new Date(y - 2, 3, 1), costCenter: 'CC-ENG-01', workEmail: 'priya@example.com', bankName: 'HDFC Bank', bankAccountNumber: '50100123456789', bankIfsc: 'HDFC0001234', taxId: 'ABCDE1234F', socialSecurityId: '100987654321', nationalId: null };
  return buildPayslipDoc({ payslip, template, employee, org });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: any) { const x = new Date(d); return x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
export function money(v: number, currency: string, locale: string) {
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }).format(v); }
  catch { return `${currency} ${v.toFixed(2)}`; }
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function sub1000(x: number): string {
  const h = Math.floor(x / 100), r = x % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r < 20) { if (r) parts.push(ONES[r]); } else parts.push(`${TENS[Math.floor(r / 10)]}${r % 10 ? ' ' + ONES[r % 10] : ''}`);
  return parts.join(' ');
}
/** Indian numbering (lakh/crore) for INR, short scale otherwise. */
export function amountInWords(amount: number, currency: string): string {
  const whole = Math.floor(Math.abs(amount)); const paise = Math.round((Math.abs(amount) - whole) * 100);
  const unit = currency === 'INR' ? ['Rupees', 'Paise'] : currency === 'USD' ? ['Dollars', 'Cents'] : currency === 'GBP' ? ['Pounds', 'Pence'] : currency === 'EUR' ? ['Euros', 'Cents'] : [currency, 'Cents'];
  let words: string;
  if (whole === 0) words = 'Zero';
  else if (currency === 'INR') {
    const crore = Math.floor(whole / 1e7), lakh = Math.floor((whole % 1e7) / 1e5), thousand = Math.floor((whole % 1e5) / 1000), rest = whole % 1000;
    words = [crore && `${sub1000(crore)} Crore`, lakh && `${sub1000(lakh)} Lakh`, thousand && `${sub1000(thousand)} Thousand`, rest && sub1000(rest)].filter(Boolean).join(' ');
  } else {
    const scales = ['', 'Thousand', 'Million', 'Billion']; const parts: string[] = []; let x = whole, i = 0;
    while (x > 0) { const c = x % 1000; if (c) parts.unshift(`${sub1000(c)}${scales[i] ? ' ' + scales[i] : ''}`); x = Math.floor(x / 1000); i++; }
    words = parts.join(' ');
  }
  return `${unit[0]} ${words}${paise ? ` and ${sub1000(paise)} ${unit[1]}` : ''} Only`;
}

// ─── HTML renderer ───────────────────────────────────────────────────────────

const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export function renderPayslipHtml(doc: PayslipDoc, opts: { embed?: boolean } = {}): string {
  const { layout: L, fields: F, brand: B } = doc;
  const fm = (v: number) => money(v, doc.currency, doc.locale);
  const fs = L.density === 'compact' ? 11 : L.density === 'airy' ? 13 : 12;
  const pad = L.density === 'compact' ? 4 : L.density === 'airy' ? 8 : 6;
  const font = L.serif ? "Georgia, 'Times New Roman', serif" : "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const border = L.bordered ? `border:1px solid #d1d5db;` : '';
  const mono = L.header === 'plain';
  const primary = mono ? '#111827' : B.primary;
  const accent = mono ? '#374151' : B.accent;

  const detail = (label: string, value: string | null | undefined) => value ? `<div class="kv"><span class="k">${esc(label)}</span><span class="v">${esc(value)}</span></div>` : '';
  const employeeBlock = [
    detail('Employee', doc.employee.name),
    F.employeeCode && detail('Employee code', doc.employee.code),
    F.designation && detail('Designation', doc.employee.designation),
    F.department && detail('Department', doc.employee.department),
    F.location && detail('Location', doc.employee.location),
    F.joiningDate && detail('Date of joining', doc.employee.joiningDate && fmtDate(doc.employee.joiningDate)),
    F.costCenter && detail('Cost centre', doc.employee.costCenter),
    F.email && detail('E-mail', doc.employee.email),
    F.bankDetails && detail('Bank', [doc.employee.bankName, doc.employee.bankAccountMasked].filter(Boolean).join(' · ')),
    F.bankDetails && detail('IFSC', doc.employee.bankIfsc),
    F.statutoryIds && detail('PAN', doc.employee.pan),
    F.statutoryIds && detail('UAN', doc.employee.uan),
    F.statutoryIds && detail('ESI No.', doc.employee.esi),
    F.ctc && doc.totals.ctcAnnual != null && detail('Annual CTC', fm(doc.totals.ctcAnnual)),
  ].filter(Boolean).join('');
  const periodBlock = [
    detail('Pay period', doc.payslip.periodLabel),
    detail('Payslip no.', doc.payslip.number),
    doc.payslip.cycleName && detail('Cycle', doc.payslip.cycleName),
    detail('Status', doc.payslip.status === 'PAID' ? `Paid${doc.payslip.paidAt ? ' on ' + fmtDate(doc.payslip.paidAt) : ''}` : 'Generated'),
  ].filter(Boolean).join('');

  const row = (l: DocLine, cls = '') => `<tr class="${cls}"><td>${esc(l.name)}${F.lineBasis && l.basis ? `<div class="basis">${esc(l.basis)}</div>` : ''}</td><td class="amt">${fm(l.amount)}</td></tr>`;
  const totalRow = (label: string, v: number) => `<tr class="total"><td>${esc(label)}</td><td class="amt">${fm(v)}</td></tr>`;
  const earnTable = `<table class="lines"><thead><tr><th>Earnings</th><th class="amt">Amount</th></tr></thead><tbody>${doc.earnings.map(l => row(l)).join('')}${doc.reimbursements.map(l => row(l)).join('')}${totalRow('Gross earnings', doc.totals.earnings + doc.totals.reimbursements)}</tbody></table>`;
  const dedTable = `<table class="lines"><thead><tr><th>Deductions</th><th class="amt">Amount</th></tr></thead><tbody>${doc.deductions.length ? doc.deductions.map(l => row(l)).join('') : '<tr><td class="muted">None</td><td></td></tr>'}${totalRow('Total deductions', doc.totals.deductions)}</tbody></table>`;
  const statementTable = `<table class="lines"><thead><tr><th>Description</th><th class="amt">Earnings</th><th class="amt">Deductions</th></tr></thead><tbody>
    ${doc.earnings.concat(doc.reimbursements).map(l => `<tr><td>${esc(l.name)}${F.lineBasis && l.basis ? `<div class="basis">${esc(l.basis)}</div>` : ''}</td><td class="amt">${fm(l.amount)}</td><td class="amt"></td></tr>`).join('')}
    ${doc.deductions.map(l => `<tr><td>${esc(l.name)}${F.lineBasis && l.basis ? `<div class="basis">${esc(l.basis)}</div>` : ''}</td><td class="amt"></td><td class="amt">${fm(l.amount)}</td></tr>`).join('')}
    <tr class="total"><td>Totals</td><td class="amt">${fm(doc.totals.earnings + doc.totals.reimbursements)}</td><td class="amt">${fm(doc.totals.deductions)}</td></tr>
  </tbody></table>`;
  const employerTable = F.employerContributions && doc.employerContributions.length ? `<table class="lines sub"><thead><tr><th>Employer contributions (not part of net pay)</th><th class="amt">Amount</th></tr></thead><tbody>${doc.employerContributions.map(l => row(l)).join('')}${totalRow('Total', doc.totals.employer)}</tbody></table>` : '';
  const daysBlock = F.daysSummary && doc.days ? `<div class="days">
    <div><span>Working days</span><b>${doc.days.working}</b></div><div><span>Paid days</span><b>${doc.days.paid}</b></div>
    ${doc.days.leave ? `<div><span>Leave</span><b>${doc.days.leave}</b></div>` : ''}${doc.days.half ? `<div><span>Half days</span><b>${doc.days.half}</b></div>` : ''}
    ${doc.days.lop ? `<div><span>Loss of pay</span><b class="neg">${doc.days.lop}</b></div>` : ''}${doc.days.overtimeHours ? `<div><span>Overtime</span><b>${doc.days.overtimeHours} h</b></div>` : ''}
  </div>` : '';

  const headerInner = `
    <div class="brand">
      ${doc.company.logoUrl && !mono ? `<img src="${esc(doc.company.logoUrl)}" alt="" class="logo">` : ''}
      <div>
        <div class="co">${esc(doc.company.name)}</div>
        ${L.branchHeader && doc.company.branch ? `<div class="branch">${esc(doc.company.branch)} branch</div>` : ''}
        ${L.branchHeader && doc.company.branchAddress ? `<div class="addr">${esc(doc.company.branchAddress)}</div>` : doc.company.address ? `<div class="addr">${esc(doc.company.address)}</div>` : ''}
      </div>
    </div>
    <div class="title">
      <div class="t">${esc(B.title)}</div>
      <div class="p">${esc(doc.payslip.periodLabel)}</div>
      <div class="n">${esc(doc.payslip.number)}</div>
    </div>`;

  const css = `
    .ps{font-family:${font};font-size:${fs}px;color:#111827;background:#fff;max-width:760px;margin:0 auto;position:relative}
    .ps *{box-sizing:border-box}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:${pad * 3}px ${pad * 4}px}
    .hd.line{border-bottom:2px solid ${primary}} .hd.plain{border-bottom:1px solid #111827}
    .hd.band{background:${primary};color:#fff;border-radius:${L.density === 'airy' ? 10 : 0}px ${L.density === 'airy' ? 10 : 0}px 0 0}
    .hd.band .t,.hd.band .co,.hd.band .p,.hd.band .n,.hd.band .addr,.hd.band .branch{color:#fff}
    .hd.boxed{border:2px solid ${primary};border-bottom-width:2px}
    .brand{display:flex;gap:12px;align-items:center} .logo{width:44px;height:44px;object-fit:contain;border-radius:6px;background:#fff}
    .co{font-size:${fs + 6}px;font-weight:700} .branch{font-weight:600;margin-top:2px;color:${accent}} .addr{white-space:pre-line;font-size:${fs - 1}px;color:#6b7280;margin-top:2px}
    .title{text-align:right} .t{font-size:${fs + 4}px;font-weight:700;color:${primary};letter-spacing:.02em;text-transform:uppercase} .p{margin-top:2px} .n{font-family:ui-monospace,Menlo,monospace;font-size:${fs - 1}px;color:#6b7280}
    .note{padding:${pad}px ${pad * 4}px;font-size:${fs - 1}px;color:#4b5563;background:#f9fafb;border-bottom:1px solid #e5e7eb}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:${pad * 2}px ${pad * 4}px;padding:${pad * 2}px ${pad * 4}px;border-bottom:1px solid #e5e7eb;${L.header === 'boxed' ? `border-left:2px solid ${primary};border-right:2px solid ${primary};` : ''}}
    .kv{display:flex;gap:8px;padding:2px 0;${L.bordered ? 'border-bottom:1px dotted #e5e7eb;' : ''}} .k{color:#6b7280;min-width:110px} .v{font-weight:500}
    .body{padding:${pad * 2}px ${pad * 4}px;${L.header === 'boxed' ? `border:2px solid ${primary};border-top:0;` : ''}}
    .days{display:flex;flex-wrap:wrap;gap:${pad}px;margin-bottom:${pad * 2}px}
    .days div{display:flex;flex-direction:column;padding:${pad}px ${pad * 2}px;background:${L.density === 'airy' ? '#f3f4f6' : '#fff'};border:1px solid #e5e7eb;border-radius:${L.density === 'airy' ? 8 : 3}px;min-width:88px}
    .days span{font-size:${fs - 2}px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em} .days b{font-size:${fs + 2}px} .neg{color:#b91c1c}
    .cols{display:grid;grid-template-columns:${L.columns === 2 ? '1fr 1fr' : '1fr'};gap:${pad * 3}px}
    table.lines{width:100%;border-collapse:collapse;${border}} .lines th{text-align:left;font-size:${fs - 2}px;text-transform:uppercase;letter-spacing:.05em;color:${accent};padding:${pad}px ${L.bordered ? pad : 0}px;border-bottom:1px solid ${L.bordered ? '#d1d5db' : primary};${L.bordered ? 'background:#f9fafb;' : ''}}
    .lines td{padding:${pad}px ${L.bordered ? pad : 0}px;${L.bordered ? 'border:1px solid #d1d5db;' : 'border-bottom:1px solid #f3f4f6;'}vertical-align:top} .amt{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    .lines tr.total td{font-weight:700;border-top:1px solid #9ca3af;border-bottom:0;${L.bordered ? 'background:#f9fafb;' : ''}} .basis{font-size:${fs - 3}px;color:#9ca3af} .muted{color:#9ca3af}
    .sub{margin-top:${pad * 2}px} .sub th{color:#6b7280}
    .net{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-top:${pad * 3}px;padding-top:${pad * 2}px;border-top:2px solid ${primary}}
    .net .lbl{font-size:${fs - 1}px;color:#6b7280} .net .val{font-size:${fs + 12}px;font-weight:700;color:${primary};font-variant-numeric:tabular-nums}
    .net.band{background:${primary};color:#fff;border-radius:${L.density === 'airy' ? 8 : 0}px;padding:${pad * 2}px ${pad * 3}px;border-top:0} .net.band .lbl,.net.band .val{color:#fff} .net.band .words{color:#dbeafe}
    .words{font-size:${fs - 1}px;color:#4b5563;font-style:italic;margin-top:${pad}px}
    .sig{margin-top:${pad * 6}px;display:flex;justify-content:flex-end} .sig .sigbox{text-align:center;min-width:180px;border-top:1px ${L.serif ? 'solid #111827' : 'dashed #9ca3af'};padding-top:${pad}px;font-size:${fs - 1}px;color:#4b5563}
    .sig img{height:40px;display:block;margin:0 auto 4px} .sig b{display:block;color:#111827}
    .foot{margin-top:${pad * 4}px;text-align:center;font-size:${fs - 2}px;color:#9ca3af;white-space:pre-line}
    .stamp{display:inline-block;transform:rotate(-12deg);border:3px solid #16a34a;color:#16a34a;font-weight:800;font-size:20px;letter-spacing:.2em;padding:3px 14px;border-radius:6px;opacity:.8;margin:8px 0 0 12px}
    .sig{align-items:flex-end}
    @media print{.ps{max-width:none} @page{margin:1.4cm}}`;

  const stamp = F.paidStamp && doc.payslip.status === 'PAID' ? '<div class="stamp">PAID</div>' : '';
  const body = `<div class="ps">
    <div class="hd ${L.header}">${headerInner}</div>
    ${B.headerNote ? `<div class="note">${esc(B.headerNote)}</div>` : ''}
    <div class="meta"><div>${employeeBlock}</div><div>${periodBlock}</div></div>
    <div class="body">
      ${daysBlock}
      ${L.columns === 2 ? `<div class="cols"><div>${earnTable}</div><div>${dedTable}</div></div>` : statementTable}
      ${employerTable}
      <div class="net ${L.header === 'band' ? 'band' : ''}"><div><div class="lbl">Net pay</div>${F.amountInWords ? `<div class="words">${esc(doc.netInWords)}</div>` : ''}</div><div class="val">${fm(doc.totals.net)}</div></div>
      ${B.showSignature ? `<div class="sig" style="justify-content:space-between"><span>${stamp}</span><div class="sigbox">${B.signatureUrl ? `<img src="${esc(B.signatureUrl)}" alt="">` : ''}${B.signatoryName ? `<b>${esc(B.signatoryName)}</b>` : ''}${esc(B.signatureLabel)}</div></div>` : stamp}
      ${B.footerNote ? `<div class="foot">${esc(B.footerNote)}</div>` : ''}
    </div>
  </div>`;
  if (opts.embed) return `<style>${css}</style>${body}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.payslip.number)}</title><style>body{margin:0;padding:24px;background:#f3f4f6}@media print{body{padding:0;background:#fff}}${css}</style></head><body>${body}</body></html>`;
}

// ─── PDF renderer (PDFKit) ───────────────────────────────────────────────────

function hex(c: string) { return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#2563eb'; }

export async function renderPayslipPdf(doc: PayslipDoc, into?: PDFKit.PDFDocument): Promise<Buffer> {
  const own = !into;
  const pdf = into ?? new PDFDocument({ size: 'A4', margin: 40, info: { Title: doc.payslip.number, Author: doc.company.name } });
  const chunks: Buffer[] = [];
  if (own) pdf.on('data', c => chunks.push(c));
  drawPayslip(pdf, doc);
  if (!own) return Buffer.alloc(0);
  return new Promise(resolve => { pdf.on('end', () => resolve(Buffer.concat(chunks))); pdf.end(); });
}

/** One PDF with a page per payslip (bulk download for a run). */
export async function renderPayslipBundlePdf(docs: PayslipDoc[]): Promise<Buffer> {
  const pdf = new PDFDocument({ size: 'A4', margin: 40, autoFirstPage: false, info: { Title: 'Payslips' } });
  const chunks: Buffer[] = [];
  pdf.on('data', c => chunks.push(c));
  for (const d of docs) { pdf.addPage(); drawPayslip(pdf, d); }
  return new Promise(resolve => { pdf.on('end', () => resolve(Buffer.concat(chunks))); pdf.end(); });
}

function drawPayslip(pdf: PDFKit.PDFDocument, doc: PayslipDoc) {
  const { layout: L, fields: F, brand: B } = doc;
  const mono = L.header === 'plain';
  const primary = mono ? '#111827' : hex(B.primary);
  const accent = mono ? '#374151' : hex(B.accent);
  const fs = L.density === 'compact' ? 8.5 : L.density === 'airy' ? 10 : 9.5;
  const reg = L.serif ? 'Times-Roman' : 'Helvetica', bold = L.serif ? 'Times-Bold' : 'Helvetica-Bold';
  const fm = (v: number) => money(v, doc.currency, doc.locale).replace(/ /g, ' ').replace(/^₹/, 'Rs. ').replace(/^€/, 'EUR ').replace(/^£/, 'GBP ');
  const left = pdf.page.margins.left, right = pdf.page.width - pdf.page.margins.right, width = right - left;
  let y = pdf.page.margins.top;
  const gap = L.density === 'compact' ? 3 : L.density === 'airy' ? 7 : 5;

  // Header
  const headerH = L.header === 'band' ? 64 : 58;
  if (L.header === 'band') pdf.save().rect(left, y, width, headerH).fill(primary).restore();
  if (L.header === 'boxed') pdf.save().lineWidth(1.5).strokeColor(primary).rect(left, y, width, headerH).stroke().restore();
  const textColor = L.header === 'band' ? '#ffffff' : '#111827';
  const subColor = L.header === 'band' ? '#e5e7eb' : '#6b7280';
  const hx = left + 12;
  pdf.font(bold).fontSize(fs + 6).fillColor(textColor).text(doc.company.name, hx, y + 12, { width: width * 0.6 });
  let hy = pdf.y;
  if (L.branchHeader && doc.company.branch) { pdf.font(bold).fontSize(fs).fillColor(L.header === 'band' ? '#ffffff' : accent).text(`${doc.company.branch} branch`, hx, hy, { width: width * 0.6 }); hy = pdf.y; }
  const addr = L.branchHeader && doc.company.branchAddress ? doc.company.branchAddress : doc.company.address;
  if (addr) pdf.font(reg).fontSize(fs - 1).fillColor(subColor).text(addr.replace(/\n/g, ', '), hx, hy, { width: width * 0.6 });
  pdf.font(bold).fontSize(fs + 4).fillColor(L.header === 'band' ? '#ffffff' : primary).text(B.title.toUpperCase(), left, y + 12, { width: width - 12, align: 'right' });
  pdf.font(reg).fontSize(fs).fillColor(textColor).text(doc.payslip.periodLabel, left, pdf.y + 1, { width: width - 12, align: 'right' });
  pdf.font('Courier').fontSize(fs - 1).fillColor(subColor).text(doc.payslip.number, left, pdf.y + 1, { width: width - 12, align: 'right' });
  y += headerH;
  if (L.header === 'line') { pdf.save().lineWidth(1.5).strokeColor(primary).moveTo(left, y).lineTo(right, y).stroke().restore(); }
  if (L.header === 'plain') { pdf.save().lineWidth(0.8).strokeColor('#111827').moveTo(left, y).lineTo(right, y).stroke().restore(); }
  y += gap * 2;

  if (B.headerNote) { pdf.font(reg).fontSize(fs - 1).fillColor('#4b5563').text(B.headerNote, left, y, { width }); y = pdf.y + gap; }

  // Employee / period details, two columns
  const kv = (col: { x: number; w: number }, label: string, value: string | null | undefined) => {
    if (!value) return;
    pdf.font(reg).fontSize(fs).fillColor('#6b7280').text(label, col.x, colY[col.x], { width: 95, continued: false });
    pdf.font(bold).fontSize(fs).fillColor('#111827').text(value, col.x + 98, colY[col.x], { width: col.w - 98 });
    colY[col.x] = Math.max(pdf.y, colY[col.x] + fs + 4) + 1;
  };
  const c1 = { x: left + (L.header === 'boxed' ? 8 : 0), w: width / 2 - 10 }, c2 = { x: left + width / 2 + 6, w: width / 2 - 14 };
  const colY: Record<number, number> = { [c1.x]: y, [c2.x]: y };
  kv(c1, 'Employee', doc.employee.name);
  if (F.employeeCode) kv(c1, 'Employee code', doc.employee.code);
  if (F.designation) kv(c1, 'Designation', doc.employee.designation);
  if (F.department) kv(c1, 'Department', doc.employee.department);
  if (F.location) kv(c1, 'Location', doc.employee.location);
  if (F.joiningDate) kv(c1, 'Date of joining', doc.employee.joiningDate && fmtDate(doc.employee.joiningDate));
  if (F.costCenter) kv(c1, 'Cost centre', doc.employee.costCenter);
  if (F.email) kv(c1, 'E-mail', doc.employee.email);
  if (F.bankDetails) { kv(c1, 'Bank', [doc.employee.bankName, doc.employee.bankAccountMasked].filter(Boolean).join(' · ') || null); kv(c1, 'IFSC', doc.employee.bankIfsc); }
  if (F.statutoryIds) { kv(c1, 'PAN', doc.employee.pan); kv(c1, 'UAN', doc.employee.uan); kv(c1, 'ESI No.', doc.employee.esi); }
  if (F.ctc && doc.totals.ctcAnnual != null) kv(c1, 'Annual CTC', fm(doc.totals.ctcAnnual));
  kv(c2, 'Pay period', doc.payslip.periodLabel);
  kv(c2, 'Payslip no.', doc.payslip.number);
  if (doc.payslip.cycleName) kv(c2, 'Cycle', doc.payslip.cycleName);
  kv(c2, 'Status', doc.payslip.status === 'PAID' ? `Paid${doc.payslip.paidAt ? ' on ' + fmtDate(doc.payslip.paidAt) : ''}` : 'Generated');
  y = Math.max(colY[c1.x], colY[c2.x]) + gap;
  pdf.save().lineWidth(0.5).strokeColor('#e5e7eb').moveTo(left, y).lineTo(right, y).stroke().restore();
  y += gap * 2;

  // Days summary
  if (F.daysSummary && doc.days) {
    const tiles = [['Working days', String(doc.days.working)], ['Paid days', String(doc.days.paid)]];
    if (doc.days.leave) tiles.push(['Leave', String(doc.days.leave)]);
    if (doc.days.half) tiles.push(['Half days', String(doc.days.half)]);
    if (doc.days.lop) tiles.push(['Loss of pay', String(doc.days.lop)]);
    if (doc.days.overtimeHours) tiles.push(['Overtime', `${doc.days.overtimeHours} h`]);
    const tw = 84, th = 30; let tx = left;
    for (const [l, v] of tiles) {
      pdf.save().lineWidth(0.5).strokeColor('#e5e7eb').fillColor(L.density === 'airy' ? '#f3f4f6' : '#ffffff').roundedRect(tx, y, tw - 6, th, L.density === 'airy' ? 5 : 2).fillAndStroke().restore();
      pdf.font(reg).fontSize(fs - 2.5).fillColor('#6b7280').text(l.toUpperCase(), tx + 6, y + 5, { width: tw - 12 });
      pdf.font(bold).fontSize(fs + 2).fillColor(l === 'Loss of pay' ? '#b91c1c' : '#111827').text(v, tx + 6, y + 14, { width: tw - 12 });
      tx += tw;
    }
    y += th + gap * 2;
  }

  // Line tables
  const rowH = fs + (L.density === 'compact' ? 5 : 8);
  const table = (x: number, w: number, title: string, lines: DocLine[], totalLabel: string, total: number, emptyText?: string) => {
    let ty = y;
    // header
    if (L.bordered) pdf.save().fillColor('#f9fafb').rect(x, ty, w, rowH).fill().restore();
    pdf.font(bold).fontSize(fs - 1.5).fillColor(accent).text(title.toUpperCase(), x + 4, ty + 5, { width: w * 0.6, characterSpacing: 0.5 });
    pdf.text('AMOUNT', x, ty + 5, { width: w - 4, align: 'right' });
    pdf.save().lineWidth(L.bordered ? 0.5 : 1).strokeColor(L.bordered ? '#d1d5db' : primary).moveTo(x, ty + rowH).lineTo(x + w, ty + rowH).stroke().restore();
    if (L.bordered) pdf.save().lineWidth(0.5).strokeColor('#d1d5db').rect(x, ty, w, rowH).stroke().restore();
    ty += rowH;
    const draw = (name: string, amount: string, isTotal = false, basis?: string | null) => {
      const h = rowH + (F.lineBasis && basis ? fs : 0);
      if (isTotal && L.bordered) pdf.save().fillColor('#f9fafb').rect(x, ty, w, h).fill().restore();
      pdf.font(isTotal ? bold : reg).fontSize(fs).fillColor('#111827').text(name, x + 4, ty + 4, { width: w * 0.65 });
      if (F.lineBasis && basis) pdf.font(reg).fontSize(fs - 2.5).fillColor('#9ca3af').text(basis, x + 4, ty + 4 + fs + 1, { width: w * 0.65 });
      pdf.font(isTotal ? bold : reg).fontSize(fs).fillColor('#111827').text(amount, x, ty + 4, { width: w - 4, align: 'right' });
      pdf.save().lineWidth(0.5).strokeColor(isTotal ? '#9ca3af' : L.bordered ? '#d1d5db' : '#f3f4f6');
      if (L.bordered) pdf.rect(x, ty, w, h).stroke(); else pdf.moveTo(x, ty + h).lineTo(x + w, ty + h).stroke();
      pdf.restore();
      ty += h;
    };
    if (!lines.length && emptyText) draw(emptyText, '');
    for (const l of lines) draw(l.name, fm(l.amount), false, l.basis);
    draw(totalLabel, fm(total), true);
    return ty;
  };
  if (L.columns === 2) {
    const w = (width - 14) / 2;
    const y1 = table(left, w, 'Earnings', doc.earnings.concat(doc.reimbursements), 'Gross earnings', doc.totals.earnings + doc.totals.reimbursements);
    const y2 = table(left + w + 14, w, 'Deductions', doc.deductions, 'Total deductions', doc.totals.deductions, 'None');
    y = Math.max(y1, y2) + gap * 2;
  } else {
    // statement: single table with two amount columns
    let ty = y; const w = width; const cw = 110;
    if (L.bordered) pdf.save().fillColor('#f9fafb').rect(left, ty, w, rowH).fill().restore();
    pdf.font(bold).fontSize(fs - 1.5).fillColor(accent).text('DESCRIPTION', left + 4, ty + 5).text('EARNINGS', right - cw * 2, ty + 5, { width: cw - 4, align: 'right' }).text('DEDUCTIONS', right - cw, ty + 5, { width: cw - 4, align: 'right' });
    pdf.save().lineWidth(0.5).strokeColor('#d1d5db').rect(left, ty, w, rowH).stroke().restore();
    ty += rowH;
    const line = (name: string, e: string, d: string, isTotal = false) => {
      if (isTotal) pdf.save().fillColor('#f9fafb').rect(left, ty, w, rowH).fill().restore();
      pdf.font(isTotal ? bold : reg).fontSize(fs).fillColor('#111827').text(name, left + 4, ty + 4, { width: w - cw * 2 - 8 });
      pdf.text(e, right - cw * 2, ty + 4, { width: cw - 4, align: 'right' }).text(d, right - cw, ty + 4, { width: cw - 4, align: 'right' });
      pdf.save().lineWidth(0.5).strokeColor('#d1d5db').rect(left, ty, w, rowH).stroke().restore();
      ty += rowH;
    };
    for (const l of doc.earnings.concat(doc.reimbursements)) line(l.name, fm(l.amount), '');
    for (const l of doc.deductions) line(l.name, '', fm(l.amount));
    line('Totals', fm(doc.totals.earnings + doc.totals.reimbursements), fm(doc.totals.deductions), true);
    y = ty + gap * 2;
  }
  if (F.employerContributions && doc.employerContributions.length) {
    y = table(left, width, 'Employer contributions (not part of net pay)', doc.employerContributions, 'Total', doc.totals.employer) + gap * 2;
  }

  // Net pay
  const netH = 44;
  if (L.header === 'band') pdf.save().fillColor(primary).roundedRect(left, y, width, netH, L.density === 'airy' ? 5 : 0).fill().restore();
  else pdf.save().lineWidth(1.5).strokeColor(primary).moveTo(left, y).lineTo(right, y).stroke().restore();
  const nc = L.header === 'band' ? '#ffffff' : primary;
  pdf.font(reg).fontSize(fs - 1).fillColor(L.header === 'band' ? '#e5e7eb' : '#6b7280').text('Net pay', left + 8, y + 8);
  if (F.amountInWords) pdf.font(L.serif ? 'Times-Italic' : 'Helvetica-Oblique').fontSize(fs - 1).fillColor(L.header === 'band' ? '#ffffff' : '#4b5563').text(doc.netInWords, left + 8, y + 22, { width: width * 0.62 });
  pdf.font(bold).fontSize(fs + 10).fillColor(nc).text(fm(doc.totals.net), left, y + 10, { width: width - 8, align: 'right' });
  y += netH + gap * 3;

  // PAID stamp sits bottom-left, opposite the signature, where nothing else prints
  if (F.paidStamp && doc.payslip.status === 'PAID') {
    pdf.save().rotate(-12, { origin: [left + 70, y + 30] }).lineWidth(2).strokeColor('#16a34a').roundedRect(left + 20, y + 15, 100, 30, 4).stroke()
      .font('Helvetica-Bold').fontSize(16).fillColor('#16a34a').text('PAID', left + 20, y + 22, { width: 100, align: 'center', characterSpacing: 4 }).restore();
  }

  // Signature
  if (B.showSignature) {
    const sx = right - 190, sw = 190;
    let sy = y + 22;
    pdf.save().lineWidth(0.6).strokeColor(L.serif ? '#111827' : '#9ca3af');
    if (!L.serif) pdf.dash(3, { space: 2 });
    pdf.moveTo(sx, sy).lineTo(sx + sw, sy).stroke().restore();
    sy += 4;
    if (B.signatoryName) { pdf.font(bold).fontSize(fs).fillColor('#111827').text(B.signatoryName, sx, sy, { width: sw, align: 'center' }); sy = pdf.y; }
    pdf.font(reg).fontSize(fs - 1).fillColor('#4b5563').text(B.signatureLabel, sx, sy, { width: sw, align: 'center' });
    y = pdf.y + gap * 2;
  }
  if (B.footerNote) pdf.font(reg).fontSize(fs - 2).fillColor('#9ca3af').text(B.footerNote, left, y + gap * 2, { width, align: 'center' });
}
