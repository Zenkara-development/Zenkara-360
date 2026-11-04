# Verifying the payroll / attendance rebuild (phases 1–4)

Everything below runs against `C:\Projects\CRMITDesk`. Do the setup once, then walk the phases in order — each phase builds on the previous one's data, and the whole walkthrough takes about 30 minutes. Expected results are in **bold** so you can tick them off.

## 0. Setup (once)

```powershell
cd C:\Projects\CRMITDesk
npm install                                  # pulls pdfkit for the server
cd server
npx prisma migrate dev                       # applies the four new migrations
npx prisma generate
cd ..
npm run dev                                  # server :4000 + client :5173
```

`prisma migrate dev` should list, in this order: `20260923090000_configurable_payroll`, `20260923120000_attendance_policy_engine`, `20260923150000_payroll_attendance_mode`, `20260923170000_payslip_templates`. If any of them errors, stop and send me the message — nothing below will work until the schema is in.

Log in as `admin@crmitdesk.com` / `Admin@123` (SUPER_ADMIN). Have one **employee** user handy too (any non-manager) with an Employee record — Phase 2 needs someone to check in as.

### Automated check first (5 minutes)

With the dev servers running, in a second terminal:

```powershell
npx playwright test tests/e2e/payroll-config.spec.ts tests/e2e/attendance-policy.spec.ts tests/e2e/payroll-attendance.spec.ts tests/e2e/payslip-templates.spec.ts
```

**Expected: all green** (one test in `payroll-attendance` and one in `payslip-templates` may report *skipped* if there is no issued payslip yet — that's fine, they'll pass after Phase 3 below). These specs exercise every new API endpoint; the manual steps that follow verify the UI and the business rules on top.

---

## Phase 1 — Salary components, cycles, employee salaries, draft runs

Go to **HR → Payroll**.

1. **Salary Components** tab. **Expected: ~15 components seeded** — BASIC, HRA, CONVEYANCE, …, OVERTIME, PF_EMP, ESI_EMP, PT, TDS, LOP, REIMB, PF_EMPLOYER, ESI_EMPLOYER. Open **PF_EMP**: it is statutory with rate 12 % and ceiling 15 000. Open **HRA**: 40 % of BASIC.
2. Click **Add component** → code `TEST_ALLOW`, name "Test Allowance", earning, formula `BASIC * 0.1`, prorate on. Save. Now edit it and change the formula to `NOPE * 2` and save. **Expected: rejected with "unknown NOPE"** (the safe evaluator validates references).
3. **Cycles** tab. **Expected: one default "Monthly" cycle.** Add a weekly cycle (start weekday Monday) — it saves.
4. **Employee Salaries** tab → **Add salary** → pick your employee, cycle Monthly, BASIC 30 000, CTC 7 20 000. The **live preview on the right** should show: HRA 12 000, PF_EMP 1 800 (ceiling applied), PT 200, TEST_ALLOW 3 000, net a little over 43 000. Type `2` in the **"What if LOP days"** box. **Expected: a Loss of Pay deduction line appears** (≈ 4 100 for 22 working days) and net drops; earnings stay at full amounts (that's the LOP convention — disable the LOP component and the same what-if would prorate earnings instead).
5. Save. Edit the salary again and change BASIC to 32 000, save. **Expected: a new revision** — the list still shows one row with the new effective date.
6. Delete `TEST_ALLOW` from Components (keep the data clean for later steps).

## Phase 2 — Attendance policies, register, leave admin

**HR → HR Settings**:

7. **Attendance policies** section. **Expected: "Standard (9:00 – 18:00)" default group exists.** Open it: grace 10 min, late bands 60 → Late / 180 → Half day / beyond → Absent, min full day 480 min, weekly offs Sat + Sun, 3 lates allowed per month, every 3 further lates = half day. Change grace to **15** and save.
8. Click **New policy group** → name "Night shift", shift 21:00–06:00, applicability: pick a department. Save. **Expected: it appears with the department chip**; the default keeps everyone else.
9. **Holidays** section → add a holiday on a **weekday later this month** (call it "Test holiday"). **Expected: listed under the current year.**
10. **Leave types** section → open Casual Leave (or any) → tick **Allow half day**, set carry-forward on with max 5 days, save.

**HR → Attendance**, as the employee user (separate browser / incognito):

11. Check in at, say, 09:30 (if the policy requires face/location you can temporarily relax that in HR Settings → Attendance rules, or just use the admin correction in step 13). Check out later. Scroll down on **My Attendance**: **Expected: a "Monthly register" card** showing today as **L** (late, 09:30 is > 15 min grace) or **P**, Saturdays/Sundays as **O**, the test holiday as **H**, past weekdays without punches as **A**.

Back as admin, **HR → Attendance → Register** tab:

12. **Expected: one row per employee, a cell per day, summary columns Paid/Work, LOP, Late, OT.** Hover a cell — the tooltip shows status and worked time. Past absent days count as LOP in the summary.
13. Click a past **A** day for your employee → **Correct day**: status *Work from home*, reason "Verifying correction". Save. **Expected: the cell turns W with a small dot** (manual), and the row's LOP drops by 1.
14. Click the same cell → **Reset to computed**. **Expected: back to A, dot gone.** Click the history icon at the end of the row: **Expected: two audit entries** (MARK/CORRECT and RESET) with your reason and name.
15. Click another **A** day → **Convert to leave** tab → pick the leave type, *Half day*, reason. **Expected: cell becomes ½**, and under **HR → Leave → Approvals → History** there is an APPROVED 0.5-day request created by you.

**HR → Leave → Employees** tab:

16. Pick the employee. **Expected: balance tiles** show quota, and *used* includes the 0.5 from step 15. Click **Adjust balance** → +2 days, reason "Comp off". **Expected: the tile's total goes up by 2 and a green "+2 adjusted" badge appears.**
17. **Apply on behalf** → full day next Monday, "Approve immediately" ticked. **Expected: request appears APPROVED.** Then click **Cancel leave** on it with a reason. **Expected: status CANCELLED, balance restored.** Go back to the Register — next Monday shows as **A**/future again rather than LV.
18. As the employee, **Apply for leave** → tick **Half day**, first half, pick a date. **Expected: request shows "0.5 days · first half"** and the manager sees it in Approvals with **Modify** available.

## Phase 3 — Payroll consumes attendance

**HR → Payroll → Payroll Runs → Run Payroll**:

19. Cycle Monthly, date = any day **this month**, *Paid days come from* = **Attendance register**. Calculate draft. **Expected: the review opens with a yellow banner** "This period is not over yet — N future days assumed paid…".
20. Select your employee in the table. **Expected: an "Attendance basis" card** in the side panel: Working / Paid / LOP / OT tiles, the status breakdown (Present, Late, Absent, Half day, Holiday, Week off…), late count, and "N manually corrected days" if you left any corrections. The **LOP line** in the payslip equals `gross ÷ working days × LOP days`; the **Paid days** column reads e.g. `17.5/22`.
21. Go to Register, correct one more absent day to Present with a reason, come back and press **Recalculate**. **Expected: LOP drops by one day and net pay goes up** — attendance corrections flow through without re-running.
22. **Discard draft.** Run payroll again for **last month** (a finished period), attendance mode. **Expected: no yellow banner**, real LOP for last month's absences (every weekday without punches). If that is too harsh for test data, discard and re-run with *Calendar — pay every day*: **Expected: a blue "Calendar mode" note, LOP 0, Paid = all days.**
23. Adjust one line (e.g. REIMB to 500) → **Finalise & issue payslips**. **Expected: status PROCESSED**, payslips visible to the employee under **My Payslips**, and the print view lists half days / overtime when present.

## Phase 4 — Payslip templates, PDF, e-mail

**HR → Payroll → Templates**:

24. **Expected: one template "Default" (Standard layout)**, carrying your old letterhead settings if you had any.
25. **New template** → name "Corporate HO", layout **Corporate**, primary colour anything, company name/address, header title "Salary Statement", signatory name, and on the **Fields** tab tick *Bank name + masked account* and *Net pay in words*. **Expected: the live preview on the right updates within half a second of each change** and shows the boxed serif layout, "SALARY STATEMENT", a masked account like `XXXXXXXXXX6789` and "Rupees … Only".
26. **Applies to** tab → pick the department your employee is in. Save. **Expected: the card shows the department badge.** Click the **PDF icon** on the card: **Expected: a sample PDF opens in a new tab** in that layout.
27. Try to delete **Default**: **Expected: refused** ("make another template the default first"). **Duplicate** "Corporate HO" then delete the copy: **Expected: deleted** (it had no payslips).
28. Now run payroll for a different past period and finalise (Phase 3 steps 22–23). Open the run → the employee's row → **Print view**. **Expected: the payslip renders in "Corporate HO"** (their department matched) while an employee in another department gets **Default**. Click **Download PDF**: **Expected: a PDF with the same layout**, file named after the payslip number, "PAID" stamp absent until marked paid.
29. Edit "Corporate HO" and change the colour to red. Reopen the *already issued* payslip: **Expected: it is still the old colour** — issued payslips are pinned to the template as it was at finalise time. Run and finalise a new period: **Expected: that one is red.**
30. In the run review, click **All payslips (PDF)**. **Expected: one PDF, one page per employee.** Click **E-mail payslips**. If SMTP/Resend is configured: **Expected: "N e-mailed" and the row icons turn green**; the employee receives a mail with the PDF attached. If mail is not configured the server logs `[Email skipped — no Resend key or SMTP configured]` and the UI still reports success (delivery is queued/skipped, not failed) — check the server console.
31. As the employee, **My Payslips** → open one → **Download PDF**. **Expected: works for the employee's own payslip only**; hitting another user's payslip id in the URL gives 403.

---

## If something fails

Send me (a) the step number, (b) what you saw instead, and (c) for API-side errors the line from the server console. The Playwright run in step 0 pinpoints most backend problems on its own: `npm run test:report` opens the HTML report with the failing request and response.

## Known limits (not bugs)

- PDFs print "Rs." instead of ₹ (PDFKit's built-in fonts lack the glyph); the HTML print view shows ₹. A bundled font fixes this if you want it.
- Attendance mode marks every past weekday without punches as Absent → LOP. For orgs that have not tracked attendance yet, use Calendar mode until the register is populated.
- Face verification on the web needs HTTPS and the nginx fix from earlier (camera prompt never appears over plain HTTP).
