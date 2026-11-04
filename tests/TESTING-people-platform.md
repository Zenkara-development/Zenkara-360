# Testing the people / task / approval / permission / RAG platform

Four layers, cheapest and fastest first. Each one catches a different class of
bug, so run them in order — if layer 1 fails there is no point running layer 4.

| Layer | Command | Needs | Time |
|---|---|---|---|
| 1. Compile | `npm run build` (server) · `npm run build` (client) | nothing | ~20s |
| 2. Unit | `npm run test:unit` (server) | nothing | ~5s |
| 3. API integration | `npm run test:api` (server) | running server + DB | ~15s |
| 4. UI end-to-end | `npx playwright test people-platform` | server + client + DB | ~2min |
| 5. Manual | checklist at the bottom | a browser | ~15min |

---

## Layer 1 — Does it compile?

```bash
cd server && npx tsc --noEmit      # expect: no output
cd ../client && npx tsc --noEmit   # expect: no output
cd ../client && npm run build      # expect: "✓ built in …"
```

Already verified during the build: **0 errors on both sides**, and the client
produces a working production bundle. Re-run after `prisma generate` on your
machine, since the generated client types will be real rather than mine.

## Layer 2 — Unit tests (no database, no server)

```bash
cd server
npm run test:unit
```

**51 assertions, currently all passing.** These cover the logic where a bug is
silent rather than loud — a broken controller throws a 500 you notice in a
minute, but a broken `scopedWhere()` quietly returns *more rows than it should*
and nobody finds out until a customer sees another team's salaries.

What's asserted:

- **Permission scoping** — `ALL` adds no filter; `NONE` returns an
  *unsatisfiable* filter rather than an empty one (fails closed); `OWN`/`TEAM`/
  `DEPARTMENT` build the right `where` fragments; `DEPARTMENT` on a resource
  with no department column narrows to the reporting tree instead of silently
  widening to everything.
- **The default-open contract** — an unknown permission key resolves to `ALL`,
  which is what stops an unmigrated controller from suddenly 403-ing.
- **Field redaction** — `MASKED` keeps only the last 4 characters, `HIDDEN`
  deletes the key rather than blanking it, masked numbers become `null` instead
  of a misleading string, rules don't bleed across resources, and arrays are
  handled element-wise.
- **The echo-back attack** — `stripUnwritableFields` proves you can't read a
  record (bank number comes back masked), PATCH the whole object back, and
  overwrite the real account number with `••••9012`.
- **Approval conditions** — every operator, AND-not-OR semantics, and the exact
  "HR approves above 5 days" rule the backfill creates (7 → yes, 5 → no).
- **RAG chunking** — overlap between adjacent chunks (so a fact on a boundary
  stays findable), markdown headings captured for citations, oversized
  paragraphs split rather than emitted whole.

These run with no database and no generated Prisma client — `tests/unit/
stub-prisma.js` removes that dependency — so they work on a fresh clone and in
CI before any migration has run.

## Layer 3 — API integration (needs a running server)

```bash
# terminal 1
cd server && npm run dev

# terminal 2
cd server && npm run test:api
```

**~45 checks** against real HTTP and a real database. This is what proves the
migration applied, the six routers are mounted, and the engines behave when
given actual rows rather than fixtures.

Configuration — all optional:

```bash
API_URL=http://localhost:4000/api \
ADMIN_EMAIL=admin@crmitdesk.com ADMIN_PASSWORD=Admin@123 \
EMPLOYEE_EMAIL=sales@crmitdesk.com EMPLOYEE_PASSWORD=Admin@123 \
npm run test:api
```

**Set `EMPLOYEE_EMAIL`.** Without a second, less-privileged login the suite
skips the checks that actually prove the permission engine bites — that a
non-admin sees masked account numbers, can't create employees, and can't read
the role catalogue. Those are the tests worth having.

It cleans up everything it creates and is read-only against your existing data.

Highlights of what it asserts end-to-end:

- an employee is created **without a login** and reads back with `user: null`
- sensitive fields survive the encrypt → store → decrypt round trip
- a reporting loop (`managerId = self`) is rejected with a 400
- a department holding employees can't be deleted
- a `FINISH_TO_START` dependency blocks task completion, then *releases* once
  the blocker is done — both directions, because a guard that never releases is
  just as broken as one that never blocks
- an approval request advances to `APPROVED` and refuses a second decision
- a request with **no matching policy auto-approves** rather than hanging, which
  is the behaviour that keeps the engine opt-in
- creating a role more senior than yourself is refused (no privilege escalation)
- a built-in role can't be deleted
- an unauthenticated request gets a 401

## Layer 4 — UI end-to-end

```bash
# from the repo root, with server + client running
npx playwright test people-platform
npx playwright test people-platform --headed   # watch it
npx playwright test people-platform --ui       # step through
```

30 tests across 8 groups in `tests/e2e/people-platform.spec.ts`, written in the
same style as your existing suite and using the same `helpers/auth.ts` login.
Covers navigation to all six new pages, creating a task/employee/department/
team/location/policy through the UI, the org-chart toggle, the permission
editor, the AI governance tiles, and two negative cases (a `SALES_REP` does not
see the Roles & Permissions link, but can still reach My Work).

Records are timestamp-namespaced, so it's safe to run repeatedly.

---

## Layer 5 — Manual checklist

The things a human should look at once. Roughly 15 minutes.

### Before anything

- [ ] `npx prisma migrate dev --name people_platform` completed without error
- [ ] `npx prisma generate` ran
- [ ] `npm run backfill -- --dry-run` printed a sensible plan
- [ ] `npm run backfill` completed
- [ ] Server started with `[permissions] catalog and built-in roles are up to date` in the log
- [ ] Server log shows either `[rag] pgvector detected` or `[rag] pgvector not available — using in-process cosine fallback`. Both are fine.

### Regression — the part that matters most

The whole rollout is meant to change nothing for existing users. Verify that
before looking at anything new.

- [ ] Log in as each of the five seeded roles — all still work
- [ ] `admin@crmitdesk.com` → Deals, Tickets, Leads, Contacts all load as before
- [ ] `sales@crmitdesk.com` → still sees the same CRM pages, no new 403s
- [ ] `itagent@crmitdesk.com` → ticket queue unchanged
- [ ] Existing Leave and Attendance pages behave exactly as before
- [ ] Run the pre-existing e2e suite: `npx playwright test --grep-invert people-platform` — should be unchanged from before this work

### Gap 1 & 2 — People

- [ ] **HR → Employees** lists everyone the backfill created
- [ ] Employee codes look like `EMP-0001`, sequential, no gaps or duplicates
- [ ] Open an employee — department populated from their old `User.department` string
- [ ] Set a **reporting manager** on 3–4 employees
- [ ] **Org chart** tab now shows the hierarchy you just built
- [ ] Add an employee with **no login** — it saves, and shows an orange "No login" badge
- [ ] Try to delete an employee who has direct reports → refused with a clear message
- [ ] **HR → Org Structure** → create a department, nest a child under it, confirm the tree renders
- [ ] Create a team, add two members
- [ ] Create a location

### Gap 3 — Tasks and approvals

- [ ] **My Work** loads and the four counters are present
- [ ] Create a task with a due date **in the past** → appears under *Overdue* in red
- [ ] Create one due today → appears under *Today*
- [ ] Add a checklist, tick an item, reopen the task — the tick persisted
- [ ] **Approvals → Policies** → create a policy for `LEAVE_REQUEST`, step 1 = "Requester's manager"
- [ ] Confirm the backfill's default leave policy is already there
- [ ] **Approvals → My inbox** loads (empty is correct until something is raised)
- [ ] Set up a delegation, confirm it appears, revoke it

### Gap 4 — Permissions (do this carefully)

- [ ] **Administration → Roles & Permissions** lists **nine** roles
- [ ] `HR_MANAGER`, `FINANCE`, `EXECUTIVE` are present — these are the three personas the audit found missing
- [ ] Open `SALES_REP` → Edit. Every CRM permission should read `ALL`, matching pre-existing behaviour
- [ ] **The real test:** change `crm.deal.read` from `ALL` to `OWN`, save. Log in as `sales@crmitdesk.com` and confirm the Deals list now shows only their own deals. **Then set it back to `ALL`.**
- [ ] Open any role → scroll to *Field visibility* → the HR sensitive fields are listed as `MASKED`
- [ ] As a non-admin, open an employee record → bank/tax fields show `••••` or are absent
- [ ] As `admin`, the same record shows them in full
- [ ] Try creating a role with rank `-1` → refused

### Gap 5 — RAG and AI governance

- [ ] **Administration → AI Governance** → Observability tiles render
- [ ] Set a monthly budget of `$50`, reload, it persisted
- [ ] **Knowledge base** tab → click *Re-index knowledge base*
  - With `OPENAI_API_KEY` set: reports how many articles were indexed
  - Without it: fails with an explicit "no embedding provider" message, not a silent no-op
- [ ] Ask a question the knowledge base can answer → answer comes back **with numbered sources**
- [ ] Ask something it can't → returns *"I could not find this in the available company information"* rather than making something up
- [ ] Click 👍/👎 → **Interaction log** tab shows the rating against that call
- [ ] The interaction log shows tokens, cost and latency per call
- [ ] If any field was withheld, the log row says so

---

## Known gaps in this test coverage

Being straight about what is *not* covered, so nothing is assumed safe:

- **The migration itself is untested.** I could not run Prisma migrations here —
  its engine binaries are firewalled in this sandbox. `prisma migrate dev`
  generates the SQL on your machine by diffing against your real database, which
  is safer than a hand-written migration, but the first run is the first time
  that SQL executes. **Take a database backup first**, and run it against a copy
  if you have one.
- **The backfill is dry-run-tested only** in the sense that the script has a
  `--dry-run` mode; it has not been executed against real data.
- **Multi-step approval flows** (parallel mode, delegation actually redirecting
  an approval, expiry sweeping) are unit-tested at the condition level and
  smoke-tested for the sequential single-step path, but a full 3-step parallel
  approval with a delegated approver is not yet covered end-to-end.
- **pgvector path.** The in-process cosine fallback is unit-tested; the
  `<=>` ANN query only runs when the extension is installed, and has not been
  executed.
- **Encryption at rest** is verified by round trip (write → read → matches), not
  by inspecting the ciphertext in the database. Worth one manual `SELECT
  bank_account_number FROM employees LIMIT 1` to confirm it is not plaintext.

## Fastest possible confidence check

If you want one command that tells you whether this is fundamentally sound:

```bash
cd server && npm run test:unit && npm run build
```

Five seconds, no setup, and it exercises the permission and redaction logic that
carries the most risk.
