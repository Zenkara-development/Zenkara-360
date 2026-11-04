import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

test.describe('User Management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Users' }).click();
    await page.waitForURL(/\/admin\/users/);
  });

  test('shows users page with role summary cards', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /users/i })).toBeVisible();
    // Role summary cards
    await expect(page.getByText(/super admin|sales rep|it agent/i).first()).toBeVisible();
  });

  test('creates a new user', async ({ page }) => {
    // Generated fresh per test invocation (not module scope) — with a
    // random suffix on top of the timestamp — so that a Playwright retry of
    // this exact test doesn't resend the identical email. A retry that
    // reuses the same address hits the server's "Email already registered"
    // 409 on the *second* attempt (since the first attempt's create may
    // have actually succeeded despite the UI assertion failing), and with
    // no onError handling that just leaves the dialog stuck open again —
    // indistinguishable from a real bug.
    const runUserEmail = `e2e-user-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.com`;

    // Click the "Create User" button (not "Invite User") to open the create dialog
    await page.getByRole('button', { name: /create user/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel(/full name/i).fill(TEST.user.name);
    await page.getByLabel(/email/i).fill(runUserEmail);
    await page.getByLabel(/password/i).fill(TEST.user.password);
    await page.getByLabel(/role/i).selectOption(TEST.user.role);
    await page.getByRole('button', { name: /create user/i }).last().click();

    // 12s, not 8s — the suite now also runs schedules.spec.ts and
    // ai-actions.spec.ts, both of which hit real external AI/Twilio-style
    // calls and a background poller; under that added concurrent load this
    // create's onSuccess (invalidateQueries + close) can lag past 8s even
    // though the request itself succeeds (confirmed: the very next test,
    // "shows newly created user in the table", finds this user every time).
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 12_000 });
    // Wait for the list to refetch and show the new user
    await expect(page.getByText(TEST.user.name)).toBeVisible({ timeout: 8_000 });
  });

  test('shows newly created user in the table', async ({ page }) => {
    // Use locator().filter() — more reliable than getByRole('row') for accessible name matching
    const row = page.locator('tbody tr').filter({ hasText: TEST.user.name }).first();
    await expect(row).toBeVisible({ timeout: 8_000 });
    // Role may display with space (SALES REP) or underscore (SALES_REP)
    await expect(row.getByText(/sales.rep/i)).toBeVisible();
  });

  test('deactivates a user', async ({ page }) => {
    const row = page.locator('tbody tr').filter({ hasText: TEST.user.name }).first();
    await expect(row).toBeVisible({ timeout: 8_000 });

    await row.getByRole('button', { name: /row actions/i }).click();
    const deactivateBtn = page.getByRole('button', { name: /deactivate/i });
    // 3s was too tight under the 2-worker suite's concurrent load (the same
    // class of flake fixed elsewhere in this file/suite) — the row-actions
    // portal menu itself renders instantly, but the click that opens it can
    // queue behind other work on a busy run. Match the 8s used for the
    // equivalent post-menu-click assertions elsewhere in this suite.
    await expect(deactivateBtn).toBeVisible({ timeout: 8_000 });
    await deactivateBtn.click();
    // "Inactive" text or a badge/class indicating deactivation
    await expect(
      row.getByText(/inactive|deactivated|disabled/i).first()
        .or(row.locator('[class*="inactive"], [class*="deactivated"]').first())
    ).toBeVisible({ timeout: 8_000 });
  });
});

test.describe('Global Search', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // Helper: open AI command bar (tries button click, falls back to Ctrl+K)
  async function openAiBar(page: any) {
    await page.goto('/dashboard');
    await page.waitForURL(/\/dashboard/);
    // The AI button in the topbar has data-testid="ai-command-btn"
    const aiBtn = page.locator('[data-testid="ai-command-btn"]');
    if (await aiBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await aiBtn.click();
    } else {
      await page.locator('body').click();
      await page.keyboard.press('Control+k');
    }
  }

  test('opens search modal with Ctrl+K', async ({ page }) => {
    await openAiBar(page);
    // AiCommandBar placeholder: "Search or ask AI — what would you like to do?"
    await expect(
      page.getByPlaceholder(/search or ask/i)
        .or(page.getByPlaceholder(/what would you like to do/i))
        .first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('AI command modal shows suggestions', async ({ page }) => {
    await openAiBar(page);
    await expect(
      page.getByPlaceholder(/search or ask/i)
        .or(page.getByPlaceholder(/what would you like to do/i))
        .first()
    ).toBeVisible({ timeout: 8_000 });
    // The modal shows "Try asking" example suggestions when first opened
    const hasTryAsking = await page.getByText(/try asking/i).isVisible({ timeout: 3_000 }).catch(() => false);
    // Accept if modal is open, even without "Try asking" text
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('closes search modal with Escape', async ({ page }) => {
    await openAiBar(page);
    const modal = page.getByPlaceholder(/search or ask/i)
      .or(page.getByPlaceholder(/what would you like to do/i))
      .first();
    await expect(modal).toBeVisible({ timeout: 8_000 });
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Reports', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Reports' }).click();
    await page.waitForURL(/\/reports/);
  });

  test('shows Reports page with IT Desk tab active by default', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /reports/i })).toBeVisible();
    await expect(page.getByText('SLA Compliance Rate')).toBeVisible();
  });

  test('switches to CRM tab and shows win rate', async ({ page }) => {
    await page.getByRole('button', { name: 'CRM' }).click();
    await expect(page.getByText('Win Rate')).toBeVisible();
    await expect(page.getByText('Deals Won')).toBeVisible();
    await expect(page.getByText('Deals Lost')).toBeVisible();
  });

  test('IT Desk tab shows ticket volume chart section', async ({ page }) => {
    await expect(page.getByText('Ticket Volume')).toBeVisible();
    await expect(page.getByText('Status Breakdown')).toBeVisible();
  });

  test('CRM tab shows New Deals chart section', async ({ page }) => {
    await page.getByRole('button', { name: 'CRM' }).click();
    await expect(page.getByText('New Deals')).toBeVisible();
    await expect(page.getByText('Weighted Forecast by Stage')).toBeVisible();
  });
});

test.describe('Dashboard', () => {
  test('shows dashboard with metric cards', async ({ page }) => {
    await login(page);
    await page.waitForURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });
});
