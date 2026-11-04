# E2E Tests — Playwright

## Setup (one-time)

### 1. Install Playwright
```bash
cd CRMITDesk
npm install
npx playwright install chromium
```

### 2. Seed the test admin account
The tests log in as `admin@crmitdesk.com / Admin@123`.

**Option A — Use the register API** (easiest):
```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin User","email":"admin@crmitdesk.com","password":"Admin@123"}'
```
Then open Prisma Studio and set the role to `SUPER_ADMIN`:
```bash
cd server && npx prisma studio
```

**Option B — Run the seed script**:
```bash
cd CRMITDesk
npx ts-node -P server/tsconfig.json tests/helpers/seed-admin.ts
```

---

## Running Tests

Make sure `npm run dev` is running first (both servers must be up).

```bash
# Run all tests (headless)
npm test

# Run with Playwright UI (visual, great for debugging)
npm run test:ui

# Run a single spec file
npx playwright test tests/e2e/auth.spec.ts

# Run tests headed (see the browser)
npx playwright test --headed

# View last HTML report
npm run test:report
```

---

## Test Files

| File | Covers |
|------|--------|
| `auth.spec.ts` | Login, logout, protected routes |
| `contacts.spec.ts` | Contacts CRUD, detail page, activity logging |
| `leads.spec.ts` | Leads CRUD, lead → deal conversion modal |
| `deals.spec.ts` | Pipeline kanban, deal CRUD, comments, reports tab |
| `tickets.spec.ts` | Tickets CRUD, status change, assign, resolve, categories, KB |
| `admin.spec.ts` | User management, global search (⌘K), reports page |
| `workflows.spec.ts` | Automation rules — create/toggle/delete |
| `schedules.spec.ts` | WhatsApp reminders on tickets/deals, `SEND_WHATSAPP` workflow action |
| `ai-actions.spec.ts` | AI Command whitelisted actions — propose/confirm/cancel |

This table isn't exhaustive — see `tests/e2e/` for the full set (AI features, branding, billing, quotes, and more all have their own spec files).

---

## Test Credentials
- Email: `admin@crmitdesk.com`
- Password: `Admin@123`
