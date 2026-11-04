# Changelog

Recent changes and enhancements to the CRM & IT Desk platform, newest first. This file is written for anyone picking up the project — what changed, why, and what (if anything) you need to do before it works.

## Action required

Before testing or deploying anything below, run the pending migration:

```bash
cd server
npx prisma migrate dev --name add_schedules_and_whatsapp
```

This adds the `schedules` table and the `phone` / `notify_number` columns described below. Nothing in this changelog works until it's applied.

---

## Payslip templates — eight layouts, field visibility, per-department/branch assignment, server-side PDF and e-mail (phase 4 of the payroll/attendance rebuild)

**Action required:** `npm install` (adds `pdfkit` to the server) and `cd server && npx prisma migrate dev && npx prisma generate` (migration `20260923170000_payslip_templates`: `payslip_templates` becomes many-per-org with `name`, `layout`, `is_default`, `is_active`, `accent_color`, `header_title`, `header_note`, `signatory_name`, `signature_url`, `show_fields`, `applicability`; `payslips` gains `template_id` and `emailed_at`). Your existing letterhead becomes the "Default" template — nothing changes until you add more.

**Templates** (Payroll → Templates). Create as many as you need. Each has a **layout** — Standard, Modern (colour band), Minimal (mono, prints well in B&W), Detailed (every field, bank + statutory IDs, employer contributions), Compact (dense, boxed), Corporate (serif, fully boxed), Branch (office address in the header), Statement (one earnings/deductions table) — plus colours, logo, company name/address, document title, header and footer notes, and a signature block (label, signatory name, optional signature image). **Fields** tab: tick which employee details print (code, designation, department, location, joining date, cost centre, e-mail, masked bank account, PAN/UAN/ESI) and which sections show (days summary, employer contributions, annual CTC, net pay in words, signature, PAID stamp, calculation basis under each line); defaults follow the layout. **Applies to** tab: assign by department, location/branch and employment type — an employee gets the first template that matches all of its chosen groups, otherwise the default. A live preview on sample data updates as you type; "Open sample PDF" shows the real PDF. Duplicate, make default, deactivate; a template used by issued payslips is deactivated instead of deleted.

**Rendering** now happens on the server (`server/src/utils/payslipRender.ts`): one document model, one HTML renderer (in-app print view, previews, e-mail) and one **PDFKit** renderer (no headless browser, runs on Render's free tier) that share the same layout registry. When a run is **finalised, each payslip is pinned to the template that applied to that employee**, so editing a template later never restyles issued documents. Net pay in words uses Indian numbering (lakh/crore) for INR. Amounts follow the org currency.

**Download and send**: every payslip has *Download PDF* (employees too); the run review has *All payslips (PDF)* — one file, a page per employee — and *E-mail payslips*, which sends each employee their PDF (skips ones already sent; per-payslip re-send from the row). The mailer now supports attachments on Resend, platform SMTP and org SMTP. The print page (`/hr/payroll/payslips/:id/print`) renders the server HTML; managers can append `?templateId=` to preview a payslip in another template.

Endpoints under `/api/hr/payroll`: `templates` (GET/POST), `templates/preview` (POST, unsaved draft), `templates/:id` (PUT/DELETE), `templates/:id/preview[?payslipId&format=pdf]`, `templates/:id/duplicate`, `payslips/:id/html[?embed=1&templateId]`, `payslips/:id/pdf`, `payslips/:id/email`, `runs/:id/pdf`, `runs/:id/email`. Legacy `GET/PUT template` now read/edit the default template. e2e: `tests/e2e/payslip-templates.spec.ts`.

---

## Payroll runs now use the attendance register (phase 3 of the payroll/attendance rebuild)

**Action required:** `cd server && npx prisma migrate dev && npx prisma generate` (migration `20260923150000_payroll_attendance_mode` adds `payroll_runs.attendance_mode`).

Running payroll now reads each employee's period from the attendance policy engine instead of paying every calendar day: working days (period minus weekly offs and holidays), paid days, LOP days (absences, unpaid leave, half days, late-count conversions, manual corrections), paid leave and overtime hours all come from `payrollSummary()` in `attendanceRegister.ts`. The **Run payroll** dialog has a "Paid days come from" choice — *Attendance register* (default) or *Calendar — pay every day* for orgs not tracking attendance yet — and the mode is stored on the run. If a run is started before the period ends, days after today are assumed paid, counted, and flagged in the review so you recalculate before finalising.

The **review screen** shows LOP days per run, marks payslips with projected days, and the side panel shows an *Attendance basis* card for the selected employee: working / paid / LOP / OT hours, the day-status breakdown (Present, Late, WFH, Half day, Leave, Unpaid leave, Absent, Holiday, Week off), late arrivals and any conversion, future days assumed paid and manual corrections included. Every payslip stores this in `attendanceSummary` (JSON) alongside the day counts, and the print view lists half days and overtime hours. **Recalculate** re-reads attendance, so an HR correction in the register flows into the draft with one click.

`POST /hr/payroll/preview` accepts `attendance: false` to ignore the register (the salary editor's preview uses this so it stays a pure structure preview; "what-if LOP" still works) and returns `attendance` (policy group, byStatus, lateCount, lateConversion, futureDaysAssumedPaid, manualCorrections). `POST /hr/payroll/runs` accepts `attendanceMode`. e2e: `tests/e2e/payroll-attendance.spec.ts`.

---

## Attendance policy engine, admin attendance register and leave control (phase 2 of the payroll/attendance rebuild)

**Action required:** `cd server && npx prisma migrate dev && npx prisma generate`. Migration `20260923120000_attendance_policy_engine` adds `attendance_policy_groups`, `holidays`, `attendance_days`, `attendance_audits`, `leave_balance_adjustments`, and extends `leave_types` / `leave_requests` (half days, carry-forward, cancellation fields). Existing check-in/out records are untouched; day statuses are computed from them on demand.

**Attendance policies** (HR Settings → Attendance policies). One or more policy groups per org, each with: shift start/end and timezone; grace minutes; **late bands** (e.g. up to 60 min late → Late, up to 180 → Half day, beyond → Absent); minimum worked minutes for a full day / half day; early-departure grace and whether leaving early costs a half day; overtime start (minutes after shift end) and minimum OT block; **late conversion** (N lates allowed per month, every further M lates = a half day / a LOP day / nothing); weekly offs; and what to assume when someone forgets to check out. Groups apply by department, location, employment type or named users; the most specific group wins and the default group covers everyone else. A "Standard (9:00 – 18:00)" default is seeded the first time the org touches attendance.

**Holidays** (HR Settings → Holidays): per year, optionally scoped to office locations, optional holidays flagged. Holidays and weekly offs are never counted as absent or LOP.

**Attendance register** (Attendance → Register, managers). A month grid of employee × day with computed statuses — Present, Late, Half day, Absent, Leave, Unpaid leave, WFH, Holiday, Week off, LOP — plus per-row paid days / working days, LOP days (including late conversion), late count and OT hours. Clicking a day opens a correction modal: set the status, edit check-in/check-out times, add a note the employee sees, and a **mandatory reason** that goes to the audit trail. Manual corrections are marked with a dot, always win over the computed value, and can be reset to computed. A day can also be **converted to leave** (full or half) straight from the grid, which creates an approved request and updates the balance. "Change history" shows every correction, leave change and reset for that employee with before/after and who did it. Employees see their own monthly register and their applicable policy on the Attendance page.

**Leave admin** (Leave → Employees, managers): pick an employee, see balances for any year (quota + carry-forward + adjustments − used; unlimited types show usage only), **apply on their behalf** (auto-approved by default, or routed to approval), **adjust balances** with a reason (e.g. comp-off), **modify** a pending or approved request (type, dates, half day) with a change reason, and **cancel approved leave** — the balance is restored and attendance for those days is recomputed. Everyone can now apply **half-day leave** (first/second half) where the leave type allows it. Leave types gained carry-forward (max days, expiry months), half-day and unlimited flags.

Endpoints: `/api/hr/attendance/policy-groups` (GET/POST/PUT/DELETE), `my-policy`, `holidays` (GET/POST/PUT/DELETE, `POST holidays/bulk`), `GET register?month=YYYY-MM[&userId][&includeEmployees=1]`, `GET summary`, `POST days`, `DELETE days/:userId/:date`, `GET audit`; `/api/hr/leave/balance?userId&year`, `POST balances/adjust`, `POST requests/on-behalf`, `PATCH requests/:id`, `POST requests/:id/admin-cancel`, `POST convert`. Engine: `server/src/utils/attendanceEngine.ts` (pure, unit-testable), `attendanceRegister.ts` (DB glue; `periodSummary()` is what phase 3 payroll will consume). e2e: `tests/e2e/attendance-policy.spec.ts`.

---

## Configurable payroll — salary components, payroll cycles, draft runs (phase 1 of the payroll/attendance rebuild)

**Action required:** `cd server && npx prisma migrate dev && npx prisma generate`. The migration (`20260923090000_configurable_payroll`) copies every active legacy salary structure into the new `employee_salaries` table and adds component lines to existing payslips, so nothing already generated changes.

**Salary components** (Payroll → Salary Components). The fixed basic/HRA/allowances/PF/PT/other columns are replaced by a per-org catalogue: each component has a code (usable in formulas), category (earning, deduction, reimbursement, employer contribution), a calculation — fixed amount, percentage of another component / gross / CTC, or a formula (`min(BASIC * 0.12, 1800)`, `if(GROSS_EARNINGS > 21000, 0, …)`; safe evaluator, no `eval`) — flags for proration, taxability and payslip visibility, a display order, and applicability by department, location, employment type or designation. **Statutory presets for India** ship with editable rules: PF employee/employer (rate, wage ceiling, on-full-basic), ESI employee/employer (rate, threshold), Professional Tax (monthly slabs, per-state slabs via `stateSlabs`), TDS (per-employee amount). A default catalogue is seeded per org on first use. `LOP` is a component too: active → earnings shown in full with a Loss of Pay deduction; disabled → earnings prorated by paid days (never both).

**Payroll cycles** (Payroll → Cycles): monthly (calendar month), weekly / bi-weekly (start weekday, anchor), custom (N days from an anchor). Each employee's salary is assigned to a cycle, so weekly contractors and monthly staff run separately.

**Employee salaries** (Payroll → Employee Salaries): per-employee values per component (amount, percent, formula, or off), annual CTC, cycle, effective date; a **live preview** of the resulting payslip with a "what if LOP days" box. Saving creates a revision; past payslips keep the old one.

**Payroll runs are now draft → review → finalise**: Run Payroll calculates a DRAFT for a cycle's period; the review screen shows every payslip's lines with the basis of each figure ("12% of BASIC (ceiling 15000)"), lets a manager adjust any line (totals re-derive, adjustments survive Recalculate), discard the draft, or finalise to issue payslips. Employees never see drafts. Payslips store `PayslipLine` rows plus period, paid/working/LOP days (phase 2/3 will feed these from attendance; today every calendar day counts as paid) and the legacy totals for older views. The print view lists earnings and deductions from the lines.

New endpoints under `/api/hr/payroll`: `components` (GET/POST/PATCH/DELETE, `PATCH components/reorder`), `cycles` (GET/POST/PUT), `employee-salaries` (GET/GET :userId/POST/DELETE), `POST preview`, `POST runs/:id/recalculate`, `PATCH runs/:id/payslips/:payslipId`, `POST runs/:id/finalize`, `DELETE runs/:id`. Engine: `server/src/utils/payrollEngine.ts`, `payrollFormula.ts`. e2e: `tests/e2e/payroll-config.spec.ts`.

Coming next: attendance policy engine (timings, grace, late bands, half-day/LOP rules, holidays, shifts, admin corrections with audit) feeding payroll; then payslip templates (8 layouts, field visibility, per-department assignment, server-side PDF).

---

## Attendance — configurable verification rules (location / network / face, AND / OR) + face verification

**Action required:** `cd server && npx prisma migrate dev && npx prisma generate` (adds `attendance_policies`, `face_enrollments`, `attendance_location_pings` and new columns on `attendance_records`), and `npm install` (adds `@vladmandic/face-api`, `leaflet`, `react-leaflet`). Model weights (~6.5 MB) ship in `client/public/models/face`.

**Rules.** Each org now decides, separately for check-in and check-out, which of the three signals are required — **location** (GPS geofence), **office network** (IP allowlist; skipped when no office has one) and **face** — whether they combine as **All (AND)** or **Any (OR)**, and whether a failure **blocks** the action or is only recorded (`AttendancePolicy.checkInRule` / `checkOutRule`, evaluated by `utils/attendanceRules.ts`). Defaults reproduce the previous behaviour: check-in = location AND network, blocked on failure; check-out = same signals, record-only. The overall outcome is stored as `checkInPassed` / `checkOutPassed` and drives the "Verified" badge. **HR Settings → Check-in / check-out verification** has the editor; the Attendance page shows the active rule under the buttons and only asks for location when the rule uses it.

**Auto check-out on leaving the office.** HR Settings → *Check out automatically when someone leaves the office* (default off). While the app is open, `useAttendanceHeartbeat` (mounted in the app shell, so it works from any page) posts the user's location to `POST /hr/attendance/heartbeat` every minute during an open session. The server tracks `lastSeenAt/Lat/Lng/Inside` and `outsideSince` on the record; once the person has been outside every office radius for *Outside for (minutes)* (default 5), the session is closed at the moment they were first seen outside, with `checkOutSource = AUTO_GEOFENCE`. GPS fixes with accuracy worse than 250 m are ignored so a blip can't trigger it, and the user gets a warning toast with the countdown the first time a ping lands outside. A server sweep every minute (`utils/attendanceAutoCheckout.ts`) finishes the check-out even if the tab was closed right after they walked out. Optional *Close silent sessions after N minutes* (`heartbeatTimeoutMinutes`, default 0 = off) closes sessions whose pings stopped (app closed / phone off) at the last ping, as `AUTO_TIMEOUT`. Browsers can't report location with the app closed, so this relies on the app (or installed PWA) staying open; manual Check Out still works as before and records `checkOutSource = SELF`. Session chips show ⤴ / ⏱ for automatic check-outs.

**Live location for managers.** HR Settings → *Let managers see live locations while people are checked in* (default off) adds a **Live map** tab to Attendance for managers: an OpenStreetMap view with every office geofence drawn, a marker per checked-in employee (green = inside an office radius, amber = away, grey = no fix in the last 3 minutes), a side list with distance-to-nearest-office and check-in time, a **Locate now** button that asks that person's open app for a fresh fix over SSE (`attendance:locate`), and, on selecting someone, their trail for any day (pings joined as a line, with a date picker). Each heartbeat is stored as an `AttendanceLocationPing` only while a session is open and sharing is on; rows older than *Keep location history for N days* (default 30) are purged hourly. Employees see "your location is shared with managers while you're checked in" on their Attendance page. New endpoints: `GET /hr/attendance/live`, `GET /hr/attendance/trail/:userId?date=`, `POST /hr/attendance/locate/:userId` (managers; 403 while sharing is off). Client adds `leaflet` + `react-leaflet` (lazy-loaded, ~48 KB gz, only on the map tab).

**Closed-app behaviour (PWA).** No browser lets a web app read GPS while it is closed — not Chrome on Android, not Safari on iOS — and service workers have no Geolocation API, so a PWA cannot silently track a closed app; that needs a native shell (see below). What the PWA now does instead: (1) the heartbeat hook also runs `watchPosition`, so a backgrounded-but-open app keeps forwarding fixes where the platform allows it; (2) coming back to the foreground sends a fix immediately; (3) **push nudges** — the minute-sweep sends a push notification ("location update needed", collapsed by tag) to anyone checked in whose last fix is older than *Push a reminder when location is stale for N minutes* (default 10), repeating at most every *N minutes* (default 30), but only when they have no live app connection; (4) **Locate now** falls back to a push when the person's app isn't connected, and the service worker relays `attendance:locate` pushes to any open tab so it answers without a tap, showing a notification only if nothing is in the foreground. So a closed app produces a tap-to-update notification rather than an error, the live map marks the person grey ("no recent fix") in the meantime, and auto check-out falls back to the silent-session timeout if enabled. Needs `VAPID_*` configured and the person to have allowed notifications (Settings → Notifications). For true always-on background location, wrap the same client in Capacitor with a background-geolocation plugin posting to the same `/hr/attendance/heartbeat` endpoint — no server changes required.

**Face verification.** The same panel sets the match strictness (default 0.5; 0.6 is the model's conventional limit), whether the selfie is kept as evidence, and lists/resets enrolments. Face can be used on check-out as well as check-in. Employees enrol themselves from the Attendance page (3 webcam samples, auto-captured when a single face is held steady) — they're prompted the first time they check in — and can re-enrol or remove their Face ID there.

How it works: the browser runs the face-recognition model (`client/src/shared/face.ts`, loaded lazily so nothing else pays for it) and sends a 128-number face signature; the server (`utils/faceVerification.ts`) stores only signatures at enrolment and compares by euclidean distance at check-in, rejecting an enforced action with 403 on a mismatch, 428 `FACE_NOT_ENROLLED` / `FACE_REQUIRED` when a face is needed but missing (the client then enrols or captures and retries), and 400 for implausible data. Under an OR rule, location or network passing carries the action even without a face. Photos are never used for matching; a small JPEG is kept on the attendance record only when the policy says so. Location/network checks still run first, so an off-site attempt never touches biometric data. Verified check-ins show a "Face" badge in history. This protects against buddy punching from a colleague's phone, not against a deliberately modified client — for that, a server-side provider (e.g. AWS Rekognition) could be added behind the same endpoints.

New endpoints under `/api/hr/attendance`: `POST /heartbeat`, `GET/PATCH /policy`, `POST /face/enrol`, `DELETE /face/me`, `GET /face`, `DELETE /face/:userId`. `POST /check-in` and `POST /check-out` accept `faceDescriptor` and `selfie`. e2e: `tests/e2e/attendance-face.spec.ts`.

---

## Custom licensing, per-seat checkout, and payment-state enforcement

**Action required:** run the migration and regenerate the client — `cd server && npx prisma migrate dev && npx prisma generate`. In the Stripe dashboard, add `invoice.paid`, `invoice.payment_failed` and `customer.subscription.created` to the webhook endpoint's events. `STRIPE_PRO_PRICE_ID` / `STRIPE_ENTERPRISE_PRICE_ID` are now optional (yearly and custom licences are priced dynamically with `price_data`); if set they must be flat monthly Prices.

**Single source of truth for the plan.** `Organization.plan` is gone — every reader now goes through `Subscription` (the platform-admin console mirrored the two, and older code paths could drift). `Subscription` gains `interval`, `features[]`, `amountCents`, `graceUntil` and `lastPaymentFailedAt`.

**Payment state is honoured.** `utils/licensing.ts` now exposes `getEffectiveLicense(orgId)` and every gate (seats, `requireFeature`, hosted-storage quota) reads through it. `active`/`trialing` → full entitlements; `past_due` → full entitlements until `graceUntil` (set by `invoice.payment_failed`, default 7 days via `LICENSE_GRACE_PERIOD_DAYS`), then Free-plan entitlements; `canceled`/`unpaid` → Free immediately; an `active` row whose `currentPeriodEnd` is stale past the grace window → Free. Consistent with the grandfathering rules in the licensing spec, nothing existing is removed — the org simply can't add beyond Free limits until it pays. `GET /api/billing/entitlements` (any signed-in user) exposes this; the app shell shows a grace/lapsed strip and the Billing page shows the detail.

**Custom licence (self-serve).** New **Billing → Build your licence** page (`/billing/custom`): pick billable seats, monthly/yearly, and any of the gated modules (advanced AI, workflow automation, customer portal, advanced analytics, custom branding, hosted storage). Price = per-seat base (`LICENSE_BASE_SEAT_PRICE_CENTS`, default $8) + per-seat add-on per module, 10% off at 51+ seats / 20% at 201+, yearly = 10 months (`LICENSE_YEARLY_MONTHS_CHARGED`). Module prices live in `server/src/utils/pricing.ts`. Checkout creates a per-seat Stripe subscription (`quantity = seats`), and the webhook writes `plan = CUSTOM`, `seats`, `features`, `interval` onto the row; seat changes made in the Stripe portal sync back via `customer.subscription.updated`. A CUSTOM licence with `hosted_storage` gets `LICENSE_CUSTOM_STORAGE_GB` (default 10 GB). The platform-admin licence editor can also set plan `CUSTOM` and `features` directly for negotiated deals.

**Who sets the prices: the platform operator.** New **Platform Admin → Pricing** panel (`GET/PUT/DELETE /api/platform/pricing`, PLATFORM_ADMIN only) edits the Pro/Enterprise monthly price, the custom-licence base seat price, every module's per-seat add-on (and whether it's for sale), hosted-storage GB, yearly months charged, volume tiers, seat bounds and the grace period. Stored as JSON on `PlatformSettings.pricing`, layered over the code/env defaults in `utils/pricing.ts`, and live for every org within 30 seconds. A customer org's SUPER_ADMIN only buys at these prices.

**Yearly billing for Pro / Enterprise.** The Billing page has a monthly/yearly toggle; `POST /api/billing/checkout` accepts `interval`.

New endpoints: `GET /api/billing/pricing`, `GET /api/billing/entitlements`, `POST /api/billing/quote`, `POST /api/billing/custom-checkout`. New e2e spec: `tests/e2e/custom-license.spec.ts`.

---

## AI Command — whitelisted action execution

The AI command bar (`Ctrl/Cmd+K` or the "AI" button in the topbar) could previously only parse a request into a prefilled create/update form for five entity types — the user still had to open and submit that form themselves. It can now, for a fixed whitelist of actions, actually perform the action after the user confirms.

**How it works:** the model never runs arbitrary code or queries — it can only select one action by name from an explicit server-side registry, and every handler re-validates the caller's role and org scope itself before doing anything, regardless of what the model proposed. Nothing executes without an explicit "Confirm & Run" click.

**Actions available today** (`server/src/utils/ai-actions.ts`):
- Move a deal to a different pipeline stage
- Change a ticket's status
- Schedule a WhatsApp reminder on a ticket or deal
- Send a WhatsApp message immediately
- Add a note/comment to a ticket, deal, or contact
- Score a lead
- Toggle a workflow rule on/off

**New endpoints:** `POST /api/ai/actions/plan` (parses the command, proposes an action — no mutation) and `POST /api/ai/actions/execute` (re-checks role/org/schema, runs it, writes to the audit log tagged `viaAI: true` with the original command text).

**Existing behavior is untouched:** if the command matches one of the original 5 create/update intents (ticket/contact/lead/deal/article), the command bar behaves exactly as before. The new action registry is only tried as a fallback when that legacy parser doesn't recognize the request.

**Files:** `server/src/utils/ai-actions.ts` (new), `server/src/utils/ai.ts` (`planAiAction`), `server/src/modules/ai/ai.controller.ts` / `ai.routes.ts`, `client/src/api/ai.ts`, `client/src/shared/components/AiCommandBar.tsx`, `tests/e2e/ai-actions.spec.ts` (new).

## Fix — Workflow rule editor: action row layout

The action-type dropdown in the workflow rule editor (Workflows → New/Edit Rule → Actions) was rendering almost full-width and squeezing the action's own parameter fields (recipient dropdown, message box) down to an unusable sliver. Root cause: the shared `.ui-input` CSS class sets `width: 100%`, which — combined with `flex-shrink-0` inside the row's flex layout — let the type select claim nearly the whole row. Fixed by giving the action-type select and the two condition selects (field/operator) explicit fixed widths, so the parameter editor's `flex-1` sibling gets its fair share of space. (`client/src/modules/workflows/WorkflowsPage.tsx`)

## Schedules & WhatsApp notifications (Deals + Tickets)

Deals and tickets can now have WhatsApp reminders scheduled against them — one-time or recurring (daily/weekly) — and workflow automation rules can send a WhatsApp message as an action, in addition to the existing set of actions (assign, set priority/status, email, webhook, note).

**Recipient is configurable per reminder/rule:** the deal's linked contact, the assigned rep/agent, a custom phone number, or the org's default WhatsApp number — matching how the feature was scoped (both the recipient and whether it's schedule-driven or event-driven are configurable, not fixed).

**New data:**
- `Schedule` model — one-time or recurring reminders tied to a ticket or deal
- `User.phone` — needed to resolve the "assigned rep/agent" recipient option
- `WhatsAppConfig.notifyNumber` — the org's default outbound number

**New backend:** `server/src/utils/whatsapp.ts` (Twilio send), `server/src/utils/notification-recipient.ts` (shared recipient resolution used by both the poller and the workflow action), `server/src/modules/schedules/*` (CRUD API), `server/src/utils/scheduler.ts` (60-second poller that sends due reminders and re-schedules recurring ones), a new `SEND_WHATSAPP` case in the workflow engine.

**New frontend:** a "WhatsApp Reminders" panel on both the ticket and deal detail views (schedule, view status, cancel), a notification-number field in Inbox → WhatsApp settings, a `SEND_WHATSAPP` action option in the Workflows rule editor, and a Phone field on the Create/Edit User form.

**Tests:** `tests/e2e/schedules.spec.ts` (new) — schedule/cancel a reminder on a ticket and a deal (including the custom-number recipient path), create/verify/delete a workflow rule using `SEND_WHATSAPP`. `tests/global-setup.ts` extended to clean up `Schedule` rows and the new workflow-rule fixture between runs.

---

## Test suite stabilization (33 → 0 failing e2e tests)

A prior pass took the Playwright suite from 33 failures down to 0, mostly root-caused to test data never being cleaned up between runs rather than actual app bugs:

- **`tests/global-setup.ts`** — added a health-check poll before cleanup (dev servers weren't always up yet when the first test fired), and broadened cleanup to cover custom fields and all four template types (Record/Reply/Email/Quote), which previously had *no* cleanup at all despite unique-constraint fields — a single leftover row from any earlier failed run could break every subsequent run's create step on that name.
- **`playwright.config.ts`** — enabled 1 local retry (2 in CI) to absorb dev-stack cold-start flake without masking real bugs.
- **RBAC fix** — AI Builder and AI Studio sidebar links were visible to roles that shouldn't have access; restricted to `SUPER_ADMIN` / `IT_MANAGER` / `CRM_MANAGER`.
- **Branding save fix** — an empty `supportEmail`/`logoUrl`/`faviconUrl` string was failing `z.string().email()` validation even though the field was meant to be optional (zod's `.optional()` only skips `undefined`, not `''`); fixed with an empty-string-to-undefined preprocessor, since applied to every new form schema written since (schedules, WhatsApp notify number, user phone).
- **Retry-safety fixes** — a couple of specs used hardcoded fixture names/emails that collided with themselves on Playwright's automatic retry; switched to per-invocation unique values.
- Various heading-assertion timeout bumps and locator-scoping fixes for strict-mode violations caused by accumulated test data.

## `recordTemplate` migration

Added the `RecordTemplate` model and ran the initial Prisma migration (`add_record_template`) to fix a runtime error where `recordTemplate` wasn't recognized on the generated Prisma client.
