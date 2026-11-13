/**
 * The Standard payslip — redesigned.
 *
 * The eight built-in layouts are shared style configs, but the Standard
 * layout is not a variant of them: it has its own structure (no company
 * letterhead, a five-card attendance row, a boxed net-pay figure, a green
 * PAID stamp) rather than a different set of decorations. So it gets its
 * own renderer, and the layout registry dispatches to it.
 *
 *   renderStandardPayslipHtml()  → the HTML the browser prints (and the
 *                                  template preview shows)
 *   drawStandardPayslip()        → the same document as a PDFKit page
 *
 * Both read the same `PayslipDoc`, so the preview and the PDF agree on the
 * data; the drawing rules below are deliberately identical so they also
 * agree on the layout.
 *
 * ── Dependency direction ────────────────────────────────────────────────────
 *
 * This module imports the *type* of the document from utils/payslipRender.ts
 * and nothing else, so the dependency stays one-way:
 * payslipRender → payslipStandard. The money and date helpers are mirrored
 * rather than imported back, exactly as utils/payslipCustomRender.ts does —
 * a circular import between two renderers is the kind of thing that breaks
 * in a way nobody can reproduce.
 */

import type { PayslipDoc } from './payslipRender';

// ─── Palette ─────────────────────────────────────────────────────────────────

const BLUE = '#2563EB';        // primary
const BLUE_SOFT = '#EFF6FF';   // very light blue — table heads, the net-pay box
const BLUE_EDGE = '#DBEAFE';
const NAVY = '#172554';        // dark navy text
const INK = '#0F172A';         // the strongest text (values)
const SLATE = '#334155';       // labels
const MUTED = '#475569';       // the small uppercase labels
const HAIRLINE = '#E5E7EB';
const HAIRLINE_2 = '#E2E8F0';
const GREEN = '#16A34A';
const GREEN_SOFT = '#DCFCE7';
const GREEN_INK = '#15803D';

// ─── Helpers (mirrored from utils/payslipRender.ts) ─────────────────────────

function money(v: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }).format(v);
  } catch {
    return `${currency} ${Number(v || 0).toFixed(2)}`;
  }
}

function fmtDate(d: any): string {
  const x = new Date(d);
  return x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** The symbol shown next to an amount in the HTML document. */
const SYMBOLS: Record<string, string> = { INR: '₹', USD: '$', GBP: '£', EUR: '€', AED: 'د.إ', JPY: '¥' };
const symbolFor = (currency: string) => SYMBOLS[currency] ?? currency;

/** 'FINALISED' → 'Finalised'. */
function humanStatus(status: string): string {
  const s = String(status || '').replace(/_/g, ' ').toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/** The five attendance figures, always in the same order. */
function attendanceCards(doc: PayslipDoc): { label: string; value: string }[] {
  const d = doc.days;
  if (!d) return [];
  return [
    { label: 'Working days', value: String(d.working) },
    { label: 'Paid days', value: String(d.paid) },
    { label: 'Leave', value: String(d.leave) },
    { label: 'Loss of pay', value: String(d.lop) },
    { label: 'Overtime', value: `${Number(d.overtimeHours || 0).toFixed(1)} h` },
  ];
}

// ─── HTML document ──────────────────────────────────────────────────────────

export function renderStandardPayslipHtml(doc: PayslipDoc, opts: { embed?: boolean } = {}): string {
  const { fields: F, brand: B } = doc;
  const sym = symbolFor(doc.currency);
  const fm = (v: number) => money(v, doc.currency, doc.locale);

  // ── Employee column (the four the design calls for, then whatever the
  //    administrator has additionally switched on for this template) ──
  const row = (label: string, value: string | null | undefined) =>
    value ? `<div class="row"><span class="k">${esc(label)}</span><span class="v">${esc(value)}</span></div>` : '';
  const employeeRows = [
    row('Employee', doc.employee.name),
    F.employeeCode && row('Employee code', doc.employee.code),
    F.designation && row('Designation', doc.employee.designation),
    F.department && row('Department', doc.employee.department),
    F.location && row('Location', doc.employee.location),
    F.joiningDate && row('Date of joining', doc.employee.joiningDate && fmtDate(doc.employee.joiningDate)),
    F.costCenter && row('Cost centre', doc.employee.costCenter),
    F.email && row('E-mail', doc.employee.email),
    F.bankDetails && row('Bank', [doc.employee.bankName, doc.employee.bankAccountMasked].filter(Boolean).join(' · ') || null),
    F.bankDetails && row('IFSC', doc.employee.bankIfsc),
    F.statutoryIds && row('PAN', doc.employee.pan),
    F.statutoryIds && row('UAN', doc.employee.uan),
    F.statutoryIds && row('ESI No.', doc.employee.esi),
    F.ctc && doc.totals.ctcAnnual != null && row('Annual CTC', fm(doc.totals.ctcAnnual)),
  ].filter(Boolean).join('');

  const paid = doc.payslip.status === 'PAID';
  const statusText = paid
    ? (doc.payslip.paidAt ? `Paid on ${fmtDate(doc.payslip.paidAt)}` : 'Paid')
    : humanStatus(doc.payslip.status);
  const periodRows = [
    row('Pay period', doc.payslip.periodLabel),
    row('Payslip no.', doc.payslip.number),
    doc.payslip.cycleName && row('Cycle', doc.payslip.cycleName),
  ].filter(Boolean).join('');

  // ── Earnings / deductions ──
  const lineRow = (l: { name: string; amount: number; basis?: string | null }) =>
    `<tr><td>${esc(l.name)}${F.lineBasis && l.basis ? `<div class="basis">${esc(l.basis)}</div>` : ''}</td><td class="amt">${fm(l.amount)}</td></tr>`;
  const earnLines = doc.earnings.concat(doc.reimbursements);
  const earnTable = `<table class="lines">
      <thead><tr><th>Earnings</th><th class="amt">Amount (${esc(sym)})</th></tr></thead>
      <tbody>
        ${earnLines.length ? earnLines.map(lineRow).join('') : '<tr><td class="muted">No earnings</td><td class="amt"></td></tr>'}
        <tr class="total"><td>Gross Earnings</td><td class="amt">${fm(doc.totals.earnings + doc.totals.reimbursements)}</td></tr>
      </tbody></table>`;
  const dedTable = `<table class="lines">
      <thead><tr><th>Deductions</th><th class="amt">Amount (${esc(sym)})</th></tr></thead>
      <tbody>
        ${doc.deductions.length ? doc.deductions.map(lineRow).join('') : '<tr><td class="muted">No deductions</td><td class="amt"></td></tr>'}
        <tr class="total"><td>Total Deductions</td><td class="amt">${fm(doc.totals.deductions)}</td></tr>
      </tbody></table>`;

  // ── Attendance cards ──
  const cards = F.daysSummary && doc.days
    ? `<div class="cards">${attendanceCards(doc).map(c =>
        `<div class="card"><span class="lbl">${esc(c.label)}</span><span class="val">${esc(c.value)}</span></div>`).join('')}</div>`
    : '';

  const stamp = F.paidStamp && paid ? '<div class="stamp">PAID</div>' : '';
  const signature = B.showSignature
    ? `<div class="sig">${B.signatureUrl ? `<img src="${esc(B.signatureUrl)}" alt="">` : ''}<div class="sigline"></div>${B.signatoryName ? `<div class="signame">${esc(B.signatoryName)}</div>` : ''}<div class="siglabel">${esc(B.signatureLabel)}</div></div>`
    : '';

  const css = `
    .ps{font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.45;color:${NAVY};background:#fff;max-width:760px;margin:0 auto}
    .ps *{box-sizing:border-box}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding:26px 32px 16px}
    .hd .hdl{font-size:21px;font-weight:700;color:${NAVY};letter-spacing:-.01em}
    .hd .hdr{text-align:right}
    .hd .t{font-size:21px;font-weight:800;color:${BLUE};letter-spacing:.05em}
    .hd .p{font-size:12px;color:${NAVY};margin-top:2px}
    .hd .n{font-size:12px;font-weight:700;color:${BLUE};font-variant-numeric:tabular-nums;letter-spacing:.02em}
    .sep{height:3px;background:${BLUE};margin:0 32px}
    .sep.soft{height:1px;background:${HAIRLINE};margin:20px 32px}
    .sep.strong{height:2px;background:${BLUE};margin:26px 32px 0}
    .info{display:flex;padding:20px 32px 0;align-items:stretch}
    .info .col{flex:1 1 0;min-width:0}
    .info .vsep{width:1px;background:${HAIRLINE};margin:2px 26px}
    .row{display:flex;gap:14px;align-items:baseline;padding:5px 0}
    .row .k{flex:0 0 112px;color:${SLATE}}
    .row .v{font-weight:700;color:${INK};overflow-wrap:anywhere}
    .pill{display:inline-block;background:${GREEN_SOFT};color:${GREEN_INK};border-radius:999px;padding:3px 12px;font-weight:700;font-size:11px}
    .pill.open{background:#F1F5F9;color:${MUTED}}
    .cards{display:flex;flex-wrap:wrap;gap:10px;padding:0 32px;margin:20px 0 4px}
    .card{flex:1 1 118px;min-width:118px;border:1px solid ${HAIRLINE_2};border-radius:8px;padding:9px 6px;text-align:center;background:#fff}
    .card .lbl{display:block;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .card .val{display:block;font-size:16px;font-weight:700;color:${INK};margin-top:2px}
    .tables{display:flex;gap:16px;padding:24px 32px 0;align-items:flex-start}
    table.lines{flex:1 1 0;width:50%;border-collapse:collapse;table-layout:fixed;min-width:0}
    .lines th{background:${BLUE_SOFT};color:${BLUE};text-align:left;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:8px 10px;border:1px solid ${BLUE_EDGE}}
    .lines th.amt{text-align:right}
    .lines td{padding:7px 10px;border-bottom:1px solid ${HAIRLINE};color:${INK};font-size:12px;overflow-wrap:anywhere}
    .lines td.amt{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    .lines tr.total td{background:${BLUE_SOFT};font-weight:700;border-top:1px solid #BFDBFE;border-bottom:1px solid #BFDBFE}
    .lines .basis{font-size:9.5px;color:#94A3B8}
    .lines .muted{color:#94A3B8}
    .net{display:flex;align-items:center;gap:26px;padding:18px 32px 0;flex-wrap:wrap}
    .net .netl{flex:1 1 auto;min-width:0}
    .net .lbl{font-size:17px;font-weight:700;color:${INK}}
    .net .words{font-style:italic;color:${SLATE};font-size:12px;margin-top:4px}
    .net .vsep{width:1px;background:${HAIRLINE};align-self:stretch;min-height:42px}
    .net .box{background:${BLUE_SOFT};border-radius:10px;padding:12px 20px;text-align:center;flex:0 0 auto}
    .net .amt{font-size:25px;font-weight:800;color:${BLUE};font-variant-numeric:tabular-nums;white-space:nowrap}
    .foot{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding:26px 32px 28px}
    .stamp{border:3px solid ${GREEN};color:${GREEN};border-radius:8px;padding:6px 16px;font-size:18px;font-weight:800;letter-spacing:.14em;transform:rotate(-8deg);opacity:.92}
    .sig{text-align:center;min-width:190px;margin-left:auto}
    .sig img{height:36px;display:block;margin:0 auto 4px}
    .sig .sigline{border-top:2px dotted #94A3B8;margin-bottom:6px}
    .sig .signame{font-weight:700;color:${INK}}
    .sig .siglabel{font-size:11.5px;color:${SLATE}}
    .foot-note{margin-top:14px;text-align:center;font-size:10.5px;color:#94A3B8;white-space:pre-line}
    /* The in-app preview is narrower than the printed page. Rather than
       crushing the columns, the document stacks them below that width. */
    @media (max-width:620px){
      .hd,.info,.cards,.tables,.net,.foot{padding-left:18px;padding-right:18px}
      .sep,.sep.soft,.sep.strong{margin-left:18px;margin-right:18px}
      .info{flex-direction:column}
      .info .vsep{display:none}
      .row .k{flex-basis:104px}
      .tables{flex-direction:column}
      table.lines{width:100%}
      .net .vsep{display:none}
    }
    @media print{.ps{max-width:none} @page{margin:12mm} body{background:#fff}}`;

  const body = `<div class="ps">
    <div class="hd">
      <div class="hdl">${esc(doc.layout.name)} Template</div>
      <div class="hdr">
        <div class="t">${esc(B.title).toUpperCase()}</div>
        <div class="p">${esc(doc.payslip.periodLabel)}</div>
        <div class="n">${esc(doc.payslip.number)}</div>
      </div>
    </div>
    <div class="sep"></div>
    <div class="info">
      <div class="col">${employeeRows}</div>
      <div class="vsep"></div>
      <div class="col">${periodRows}<div class="row"><span class="k">Status</span><span class="v"><span class="pill${paid ? '' : ' open'}">${esc(statusText)}</span></span></div></div>
    </div>
    <div class="sep soft"></div>
    ${cards}
    <div class="tables">${earnTable}${dedTable}</div>
    <div class="sep strong"></div>
    <div class="net">
      <div class="netl">
        <div class="lbl">Net Pay</div>
        ${F.amountInWords ? `<div class="words">${esc(doc.netInWords)}</div>` : ''}
      </div>
      <div class="vsep"></div>
      <div class="box"><span class="amt">${esc(fm(doc.totals.net))}</span></div>
    </div>
    <div class="foot">
      ${stamp}
      ${signature}
    </div>
    ${B.footerNote ? `<div class="foot-note">${esc(B.footerNote)}</div>` : ''}
  </div>`;

  if (opts.embed) return `<style>${css}</style>${body}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.payslip.number)}</title><style>body{margin:0;padding:24px;background:#f3f4f6}@media print{body{padding:0;background:#fff}}${css}</style></head><body>${body}</body></html>`;
}

// ─── PDF document ───────────────────────────────────────────────────────────

/**
 * The same document, drawn with PDFKit.
 *
 * PDFKit's standard fonts use WinAnsi encoding, which has no rupee sign, so
 * amounts are written the way the rest of the application writes them —
 * "Rs. 45,727.27" — and the column heading carries the currency code
 * instead of a symbol. (The HTML document shows the real symbol.)
 */
export function drawStandardPayslip(pdf: PDFKit.PDFDocument, doc: PayslipDoc) {
  const { fields: F, brand: B } = doc;
  const left = pdf.page.margins.left;
  const right = pdf.page.width - pdf.page.margins.right;
  const width = right - left;
  const bottom = pdf.page.height - pdf.page.margins.bottom;
  const reg = 'Helvetica', bold = 'Helvetica-Bold', ital = 'Helvetica-Oblique';
  const fm = (v: number) => money(v, doc.currency, doc.locale).replace(/ /g, ' ').replace(/^₹/, 'Rs. ').replace(/^€/, 'EUR ').replace(/^£/, 'GBP ');

  let y = pdf.page.margins.top;
  /** Set when the last block was pushed onto a fresh page. */
  let pageBroken = false;

  /** Starts a new page when the next block would not fit. */
  const need = (h: number) => {
    if (y + h > bottom) { pdf.addPage(); y = pdf.page.margins.top; pageBroken = true; }
  };
  const line = (color: string, w: number) => {
    pdf.save().lineWidth(w).strokeColor(color).moveTo(left, y).lineTo(right, y).stroke().restore();
  };

  // ── Header ──
  pdf.font(bold).fontSize(16).fillColor(NAVY).text(`${doc.layout.name} Template`, left, y, { width: width * 0.55 });
  pdf.font(bold).fontSize(16).fillColor(BLUE).text(B.title.toUpperCase(), left, y, { width, align: 'right' });
  pdf.font(reg).fontSize(9.5).fillColor(NAVY).text(doc.payslip.periodLabel, left, y + 21, { width, align: 'right' });
  pdf.font(bold).fontSize(9.5).fillColor(BLUE).text(doc.payslip.number, left, y + 33, { width, align: 'right' });
  y += 50;
  line(BLUE, 2.4);
  y += 16;

  // ── Employee / payroll details, two columns with a divider ──
  const colW = (width - 34) / 2;
  const divX = left + colW + 17;
  const infoTop = y;
  let colY = { l: y, r: y };
  const kv = (side: 'l' | 'r', label: string, value: string | null | undefined) => {
    if (!value) return;
    const x = side === 'l' ? left : left + colW + 34;
    const w = side === 'l' ? colW : colW - 8;
    pdf.font(reg).fontSize(8.5).fillColor(SLATE).text(label, x, colY[side], { width: 92 });
    pdf.font(bold).fontSize(9).fillColor(INK).text(value, x + 96, colY[side], { width: Math.max(40, w - 96) });
    colY[side] = Math.max(pdf.y, colY[side] + 12) + 2;
  };
  kv('l', 'Employee', doc.employee.name);
  if (F.employeeCode) kv('l', 'Employee code', doc.employee.code);
  if (F.designation) kv('l', 'Designation', doc.employee.designation);
  if (F.department) kv('l', 'Department', doc.employee.department);
  if (F.location) kv('l', 'Location', doc.employee.location);
  if (F.joiningDate) kv('l', 'Date of joining', doc.employee.joiningDate && fmtDate(doc.employee.joiningDate));
  if (F.costCenter) kv('l', 'Cost centre', doc.employee.costCenter);
  if (F.email) kv('l', 'E-mail', doc.employee.email);
  if (F.bankDetails) {
    kv('l', 'Bank', [doc.employee.bankName, doc.employee.bankAccountMasked].filter(Boolean).join(' · ') || null);
    kv('l', 'IFSC', doc.employee.bankIfsc);
  }
  if (F.statutoryIds) { kv('l', 'PAN', doc.employee.pan); kv('l', 'UAN', doc.employee.uan); kv('l', 'ESI No.', doc.employee.esi); }
  if (F.ctc && doc.totals.ctcAnnual != null) kv('l', 'Annual CTC', fm(doc.totals.ctcAnnual));
  kv('r', 'Pay period', doc.payslip.periodLabel);
  kv('r', 'Payslip no.', doc.payslip.number);
  if (doc.payslip.cycleName) kv('r', 'Cycle', doc.payslip.cycleName);

  // Status — a pill, green once the payslip is paid.
  const paid = doc.payslip.status === 'PAID';
  const statusText = paid
    ? (doc.payslip.paidAt ? `Paid on ${fmtDate(doc.payslip.paidAt)}` : 'Paid')
    : humanStatus(doc.payslip.status);
  {
    const x = left + colW + 34;
    const font = pdf.font(reg).fontSize(8.5);
    const tw = font.widthOfString(statusText) + 16;
    const th = 14;
    pdf.font(reg).fontSize(8.5).fillColor(SLATE).text('Status', x, colY.r, { width: 92 });
    pdf.save().fillColor(paid ? GREEN_SOFT : '#F1F5F9').roundedRect(x + 96, colY.r - 1, tw, th, 7).fill().restore();
    pdf.font(bold).fontSize(7.5).fillColor(paid ? GREEN_INK : MUTED).text(statusText, x + 96, colY.r + 2.5, { width: tw, align: 'center' });
    colY.r = Math.max(colY.r + th + 3, colY.r + 12);
  }

  // The vertical divider between the two columns.
  {
    const top = infoTop;
    const h = Math.max(colY.l, colY.r) - top;
    pdf.save().lineWidth(0.6).strokeColor(HAIRLINE).moveTo(divX, top).lineTo(divX, top + h).stroke().restore();
  }
  y = Math.max(colY.l, colY.r) + 14;
  pdf.save().lineWidth(0.6).strokeColor(HAIRLINE).moveTo(left, y).lineTo(right, y).stroke().restore();
  y += 16;

  // ── Attendance cards ──
  if (F.daysSummary && doc.days) {
    const cards = attendanceCards(doc);
    const gap = 8;
    const cw = (width - gap * (cards.length - 1)) / cards.length;
    const ch = 32;
    need(ch);
    cards.forEach((c, i) => {
      const cx = left + i * (cw + gap);
      pdf.save().lineWidth(0.6).strokeColor(HAIRLINE_2).fillColor('#FFFFFF').roundedRect(cx, y, cw, ch, 5).fillAndStroke().restore();
      pdf.font(bold).fontSize(6).fillColor(MUTED).text(c.label.toUpperCase(), cx + 3, y + 6, { width: cw - 6, align: 'center', characterSpacing: 0.3 });
      pdf.font(bold).fontSize(11.5).fillColor(INK).text(c.value, cx + 3, y + 16, { width: cw - 6, align: 'center' });
    });
    y += ch + 18;
  }

  // ── Earnings and deductions, side by side ──
  const earnLines = doc.earnings.concat(doc.reimbursements);
  const columns: { x: number; w: number; title: string; lines: { name: string; amount: string; basis?: string | null }[]; totalLabel: string; total: string }[] = [
    {
      x: left, w: (width - 16) / 2, title: 'Earnings',
      lines: earnLines.map(l => ({ name: l.name, amount: fm(l.amount), basis: l.basis })),
      totalLabel: 'Gross Earnings', total: fm(doc.totals.earnings + doc.totals.reimbursements),
    },
    {
      x: left + (width - 16) / 2 + 16, w: (width - 16) / 2, title: 'Deductions',
      lines: doc.deductions.map(l => ({ name: l.name, amount: fm(l.amount), basis: l.basis })),
      totalLabel: 'Total Deductions', total: fm(doc.totals.deductions),
    },
  ];

  const headH = 17, rowH = 14;
  /** Drawn at an explicit y — the two tables share one cursor, so each
   *  column must be drawn at the same height as its neighbour. */
  const drawHead = (c: typeof columns[0], at: number) => {
    pdf.save().fillColor(BLUE_SOFT).rect(c.x, at, c.w, headH).fill().restore();
    pdf.save().lineWidth(0.6).strokeColor(BLUE_EDGE).rect(c.x, at, c.w, headH).stroke().restore();
    pdf.font(bold).fontSize(8).fillColor(BLUE).text(c.title.toUpperCase(), c.x + 6, at + 5, { width: c.w * 0.55, characterSpacing: 0.4 });
    pdf.font(bold).fontSize(8).fillColor(BLUE).text(`AMOUNT (${doc.currency})`, c.x, at + 5, { width: c.w - 6, align: 'right', characterSpacing: 0.4 });
  };
  const drawRow = (c: typeof columns[0], at: number, name: string, amount: string, isTotal: boolean, basis?: string | null) => {
    const h = rowH + (F.lineBasis && basis ? 9 : 0);
    if (isTotal) { pdf.save().fillColor(BLUE_SOFT).rect(c.x, at, c.w, h).fill().restore(); }
    pdf.font(isTotal ? bold : reg).fontSize(8.5).fillColor(INK).text(name, c.x + 6, at + 4, { width: c.w * 0.58 });
    if (F.lineBasis && basis) pdf.font(reg).fontSize(6.5).fillColor('#94A3B8').text(basis, c.x + 6, at + 13, { width: c.w * 0.58 });
    pdf.font(isTotal ? bold : reg).fontSize(8.5).fillColor(INK).text(amount, c.x, at + 4, { width: c.w - 6, align: 'right' });
    pdf.save().lineWidth(isTotal ? 0.6 : 0.5).strokeColor(isTotal ? '#BFDBFE' : HAIRLINE);
    pdf.moveTo(c.x, at + h).lineTo(c.x + c.w, at + h).stroke().restore();
    return h;
  };

  // Both tables advance together, so they stay side by side on every page.
  const maxRows = Math.max(columns[0].lines.length + 1, columns[1].lines.length + 1);
  for (let i = 0; i < maxRows; i++) {
    need(headH + rowH * 2);
    if (i === 0 || pageBroken) {
      columns.forEach(c => drawHead(c, y));
      y += headH;
    }
    pageBroken = false;
    let h = rowH;
    columns.forEach(c => {
      const line = i < c.lines.length ? c.lines[i] : (i === c.lines.length ? { name: c.totalLabel, amount: c.total, basis: null } : null);
      if (!line) return;
      const rowH2 = drawRow(c, y, line.name, line.amount, i === c.lines.length, line.basis);
      if (rowH2 > h) h = rowH2;
    });
    y += h;
  }
  y += 18;

  // ── Net pay ──
  need(56);
  line(BLUE, 2);
  y += 14;
  pdf.font(bold).fontSize(13).fillColor(INK).text('Net Pay', left, y, { width: width * 0.5 });
  if (F.amountInWords) {
    pdf.font(ital).fontSize(8.5).fillColor(SLATE).text(doc.netInWords, left, y + 18, { width: width * 0.52 });
  }
  // The amount sits in a light blue box on the right.
  const amountText = fm(doc.totals.net);
  const boxW = Math.max(150, pdf.font(bold).fontSize(15).widthOfString(amountText) + 32);
  const boxH = 34;
  const boxX = right - boxW;
  pdf.save().fillColor(BLUE_SOFT).roundedRect(boxX, y - 4, boxW, boxH, 6).fill().restore();
  pdf.font(bold).fontSize(15).fillColor(BLUE).text(amountText, boxX, y + 4, { width: boxW, align: 'center' });
  // The vertical divider between the label and the amount.
  pdf.save().lineWidth(0.6).strokeColor(HAIRLINE).moveTo(boxX - 18, y - 2).lineTo(boxX - 18, y + 26).stroke().restore();
  y += Math.max(boxH, 34) + 16;

  // ── PAID stamp and signature ──
  need(56);
  if (F.paidStamp && paid) {
    const sw = 78, sh = 26;
    pdf.save().rotate(-8, { origin: [left + sw / 2, y + sh / 2] })
      .lineWidth(2).strokeColor(GREEN).roundedRect(left, y, sw, sh, 5).stroke()
      .font(bold).fontSize(13).fillColor(GREEN).text('PAID', left, y + 7, { width: sw, align: 'center', characterSpacing: 3 })
      .restore();
  }
  if (B.showSignature) {
    const sigW = 150;
    const sx = right - sigW;
    const sy = y + 20;
    pdf.save().lineWidth(0.8).strokeColor('#94A3B8').dash(2, { space: 2 }).moveTo(sx, sy).lineTo(sx + sigW, sy).stroke().restore();
    if (B.signatoryName) {
      pdf.font(bold).fontSize(9).fillColor(INK).text(B.signatoryName, sx, sy + 4, { width: sigW, align: 'center' });
      pdf.font(reg).fontSize(8.5).fillColor(SLATE).text(B.signatureLabel, sx, pdf.y + 1, { width: sigW, align: 'center' });
    } else {
      pdf.font(reg).fontSize(8.5).fillColor(SLATE).text(B.signatureLabel, sx, sy + 4, { width: sigW, align: 'center' });
    }
  }
  y += 44;
  if (B.footerNote) pdf.font(reg).fontSize(7.5).fillColor('#94A3B8').text(B.footerNote, left, y, { width, align: 'center' });
}
