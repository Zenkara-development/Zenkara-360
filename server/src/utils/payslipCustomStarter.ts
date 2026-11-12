/**
 * The starter template for the custom HTML payslip designer.
 *
 * It is deliberately built out of tables and simple class rules rather than
 * flexbox or grid, because those are the two things the server-side PDF
 * engine cannot reproduce. A designer who starts from this and keeps to
 * tables gets a PDF that matches the preview closely; the designer is told
 * at save time when they step outside that.
 */

export const STARTER_HTML = `<div class="sheet">
  <table class="letterhead">
    <tr>
      <td class="brand">
        <img class="logo" src="{{company.logoUrl}}" alt="" />
        <div class="company">{{company.name}}</div>
        <div class="address">{{company.address}}</div>
      </td>
      <td class="meta">
        <div class="title">PAYSLIP</div>
        <table class="kv">
          <tr><th>Payslip no.</th><td>{{payslip.number}}</td></tr>
          <tr><th>Pay period</th><td>{{payslip.periodLabel}}</td></tr>
          <tr><th>Status</th><td>{{payslip.status}}</td></tr>
          <tr><th>Paid on</th><td>{{payslip.paidAt}}</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <table class="section">
    <tr><th colspan="2">Employee</th></tr>
    <tr><td>Name</td><td>{{employee.name}}</td></tr>
    <tr><td>Employee code</td><td>{{employee.code}}</td></tr>
    <tr><td>Designation</td><td>{{employee.designation}}</td></tr>
    <tr><td>Department</td><td>{{employee.department}}</td></tr>
    <tr><td>Location</td><td>{{employee.location}}</td></tr>
    <tr><td>Date of joining</td><td>{{employee.joiningDate}}</td></tr>
    <tr><td>Work e-mail</td><td>{{employee.email}}</td></tr>
  </table>

  <table class="section">
    <tr><th colspan="2">Attendance</th></tr>
    <tr><td>Working days</td><td>{{days.working}}</td></tr>
    <tr><td>Paid days</td><td>{{days.paid}}</td></tr>
    <tr><td>Present days</td><td>{{days.present}}</td></tr>
    <tr><td>Leave days</td><td>{{days.leave}}</td></tr>
    <tr><td>Loss-of-pay days</td><td>{{days.lop}}</td></tr>
    <tr><td>Overtime hours</td><td>{{days.overtimeHours}}</td></tr>
  </table>

  <table class="section money">
    <tr><th colspan="2">Earnings</th></tr>
    {{#earnings}}
    <tr><td>{{name}}</td><td class="amt">{{amountFormatted}}</td></tr>
    {{/earnings}}
    <tr class="total"><td>Gross earnings</td><td class="amt">{{totals.earningsFormatted}}</td></tr>
  </table>

  <table class="section money">
    <tr><th colspan="2">Deductions</th></tr>
    {{#deductions}}
    <tr><td>{{name}}</td><td class="amt">{{amountFormatted}}</td></tr>
    {{/deductions}}
    <tr class="total"><td>Total deductions</td><td class="amt">{{totals.deductionsFormatted}}</td></tr>
  </table>

  <table class="section money">
    <tr><th colspan="2">Employer contributions</th></tr>
    {{#employerContributions}}
    <tr><td>{{name}}</td><td class="amt">{{amountFormatted}}</td></tr>
    {{/employerContributions}}
    <tr class="total"><td>Total contributions</td><td class="amt">{{totals.employerFormatted}}</td></tr>
  </table>

  <table class="net">
    <tr>
      <td>
        <div class="words">{{netInWords}}</div>
        <div class="paid">Payment status: {{payslip.status}}</div>
      </td>
      <td class="netlabel">Net pay</td>
      <td class="netamount">{{totals.netFormatted}}</td>
    </tr>
  </table>

  <table class="sign">
    <tr>
      <td></td>
      <td class="sigbox">
        <div class="signame">{{brand.signatoryName}}</div>
        <div class="siglabel">{{brand.signatureLabel}}</div>
      </td>
    </tr>
  </table>

  <div class="footer">
    This is a computer-generated payslip and does not require a signature.
  </div>
</div>`;

export const STARTER_CSS = `.sheet { font-family: Helvetica, Arial, sans-serif; font-size: 11px; color: #111827; }
.letterhead { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
.letterhead td { vertical-align: top; padding: 0; }
.letterhead .brand { width: 58%; }
.letterhead .meta { text-align: right; }
.logo { max-width: 90px; margin-bottom: 6px; }
.company { font-size: 15px; font-weight: bold; color: #1e3a8a; }
.address { font-size: 10px; color: #6b7280; }
.title { font-size: 17px; font-weight: bold; letter-spacing: 1px; color: #1e3a8a; margin-bottom: 6px; }
.kv { margin-left: auto; font-size: 10px; }
.kv th { text-align: left; padding: 1px 6px; color: #6b7280; font-weight: normal; }
.kv td { text-align: right; padding: 1px 0; font-weight: bold; }
.section { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
.section th { text-align: left; background: #eef2ff; color: #1e3a8a; font-size: 10px; letter-spacing: 0.6px; padding: 5px 7px; border-bottom: 1px solid #c7d2fe; }
.section td { padding: 4px 7px; border-bottom: 1px solid #f1f5f9; }
.money .amt { text-align: right; }
.money .total td { font-weight: bold; border-top: 1px solid #cbd5e1; border-bottom: none; }
.net { width: 100%; border-collapse: collapse; margin: 6px 0 14px; background: #1e3a8a; color: #ffffff; }
.net td { padding: 9px 10px; }
.net .words { font-size: 9px; opacity: 0.85; }
.net .paid { font-size: 9px; opacity: 0.85; }
.net .netlabel { font-size: 10px; text-align: right; opacity: 0.85; }
.net .netamount { font-size: 17px; font-weight: bold; text-align: right; width: 150px; }
.sign { width: 100%; border-collapse: collapse; margin-top: 26px; }
.sign td { vertical-align: bottom; padding: 0; }
.sigbox { text-align: center; width: 190px; }
.signame { border-top: 1px solid #9ca3af; padding-top: 4px; font-weight: bold; font-size: 10px; }
.siglabel { font-size: 9px; color: #6b7280; }
.footer { margin-top: 14px; text-align: center; font-size: 9px; color: #9ca3af; }`;
