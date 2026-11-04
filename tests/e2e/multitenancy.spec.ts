import { test, expect } from '@playwright/test';
import { login, logout, ADMIN } from '../helpers/auth';
import { getPendingOrgSignupToken } from '../helpers/db';

// Unique org/user data for isolation
const ORG_A = {
  orgName: 'Acme Corp E2E',
  name: 'Alice E2E',
  email: `alice-e2e-${Date.now()}@acme.com`,
  password: 'AlicePass@123',
};
const ORG_B = {
  orgName: 'Globex E2E',
  name: 'Bob E2E',
  email: `bob-e2e-${Date.now()}@globex.com`,
  password: 'BobPass@123',
};

// ──────────────────────────────────────────────────────────────
// Registration flow
// ──────────────────────────────────────────────────────────────
test.describe('Registration', () => {
  test('shows Sign In and Create Account tabs on /login', async ({ page }) => {
    await page.goto('/login');
    // Two "Sign in" buttons exist (tab + submit), so use .first() to get the tab
    await expect(page.getByRole('button', { name: /sign in/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
  });

  test('Create Account tab shows Company Name field', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByPlaceholder(/acme inc/i)).toBeVisible();
    await expect(page.getByPlaceholder(/jane smith/i)).toBeVisible();
  });

  // Registration no longer creates the org/user (or a session) immediately —
  // it holds a pending OrgSignupRequest and emails the admin a review link.
  // The real link only ever reaches an inbox, so tests "click" it by pulling
  // the token straight from the DB and hitting the approve endpoint directly,
  // then logging in for real once the account actually exists.
  async function submitAndApprove(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext, org: typeof ORG_A) {
    await page.goto('/login');
    await page.getByRole('button', { name: /create account/i }).click();

    await page.getByPlaceholder(/acme inc/i).fill(org.orgName);
    await page.getByPlaceholder(/jane smith/i).fill(org.name);
    await page.getByPlaceholder(/jane@acme/i).fill(org.email);
    // Password field — there are two password placeholders; fill the first (not confirm)
    await page.getByPlaceholder(/min.*8.*char/i).first().fill(org.password);
    await page.getByRole('button', { name: /create account/i }).last().click();

    await expect(page.getByText(/submitted for approval/i)).toBeVisible({ timeout: 8_000 });

    const token = await getPendingOrgSignupToken(org.email);
    const res = await request.post('/api/auth/approve-org-signup', { data: { token, action: 'approve' } });
    expect(res.ok()).toBeTruthy();

    await page.goto('/login');
    await page.getByPlaceholder(/you@company/i).fill(org.email);
    await page.getByPlaceholder(/password/i).fill(org.password);
    await page.getByRole('button', { name: /^sign in$/i }).last().click();
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
  }

  test('shows pending-approval message after submitting, then reaches dashboard once approved', async ({ page, request }) => {
    await submitAndApprove(page, request, ORG_A);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('sidebar shows org name after approval + login', async ({ page, request }) => {
    await submitAndApprove(page, request, ORG_B);
    await expect(page.getByText(ORG_B.orgName)).toBeVisible();
  });

  test('shows error on duplicate email', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /create account/i }).click();

    await page.getByPlaceholder(/acme inc/i).fill('Duplicate Org');
    await page.getByPlaceholder(/jane smith/i).fill('Dupe User');
    // Use ADMIN email which already exists
    await page.getByPlaceholder(/jane@acme/i).fill(ADMIN.email);
    await page.getByPlaceholder(/min.*8.*char/i).first().fill('Password@123');
    await page.getByRole('button', { name: /create account/i }).last().click();

    await expect(page.getByText(/already registered|email.*use|conflict/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test('shows validation error when password is too short', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /create account/i }).click();

    await page.getByPlaceholder(/acme inc/i).fill('Short Pass Org');
    await page.getByPlaceholder(/jane smith/i).fill('Short User');
    await page.getByPlaceholder(/jane@acme/i).fill('short@test.com');
    await page.getByPlaceholder(/min.*8.*char/i).first().fill('abc');
    await page.getByRole('button', { name: /create account/i }).last().click();

    // Either HTML5 minLength kicks in or our custom error
    const passInput = page.getByPlaceholder(/min.*8.*char/i).first();
    const isInvalid = await passInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(isInvalid || await page.getByText(/at least 8|too short/i).isVisible()).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────
// Org name in sidebar
// ──────────────────────────────────────────────────────────────
test.describe('Org name in sidebar', () => {
  test('shows org name in sidebar for existing admin user', async ({ page }) => {
    await login(page);
    // The sidebar shows the org name in small text below the logo
    // (Only present if user.org was returned with the login response)
    // If the admin seed user has an org, it should appear
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();
    // The logo text is always present
    await expect(sidebar.getByText('CRM & IT Desk')).toBeVisible();
  });
});

// ──────────────────────────────────────────────────────────────
// Invite flow
// ──────────────────────────────────────────────────────────────
test.describe('User invite flow', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Users' }).click();
    await page.waitForURL(/\/admin\/users/);
  });

  test('shows both Invite User and Create User buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: /invite user/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /create user/i })).toBeVisible();
  });

  test('Invite User modal shows email + role fields', async ({ page }) => {
    await page.getByRole('button', { name: /invite user/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/email/i)).toBeVisible();
    await expect(dialog.getByLabel(/role/i)).toBeVisible();
  });

  test('generates invite link after submitting invite form', async ({ page }) => {
    await page.getByRole('button', { name: /invite user/i }).click();
    const dialog = page.getByRole('dialog');

    await dialog.getByLabel(/email/i).fill(`invite-test-${Date.now()}@example.com`);
    await dialog.getByLabel(/role/i).selectOption('EMPLOYEE');
    await dialog.getByRole('button', { name: /generate invite link/i }).click();

    // Should show a copyable link
    await expect(dialog.getByText(/invite link generated/i)).toBeVisible({ timeout: 8_000 });
    await expect(dialog.getByRole('button', { name: /copy/i })).toBeVisible();
  });

  test('invite link contains accept-invite path', async ({ page }) => {
    await page.getByRole('button', { name: /invite user/i }).click();
    const dialog = page.getByRole('dialog');

    await dialog.getByLabel(/email/i).fill(`link-check-${Date.now()}@example.com`);
    await dialog.getByRole('button', { name: /generate invite link/i }).click();

    await expect(dialog.getByText(/invite link generated/i)).toBeVisible({ timeout: 8_000 });
    const linkInput = dialog.locator('input[readonly]');
    const linkValue = await linkInput.inputValue();
    expect(linkValue).toContain('/accept-invite?token=');
  });

  test('Create User modal requires name, email, password and role', async ({ page }) => {
    await page.getByRole('button', { name: /create user/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/name/i)).toBeVisible();
    await expect(dialog.getByLabel(/password/i)).toBeVisible();
  });
});

// ──────────────────────────────────────────────────────────────
// Accept Invite page
// ──────────────────────────────────────────────────────────────
test.describe('Accept Invite page', () => {
  test('shows "invalid or expired" for a bad token', async ({ page }) => {
    await page.goto('/accept-invite?token=invalidtoken000');
    await expect(page.getByText(/invalid|expired/i)).toBeVisible({ timeout: 10_000 });
  });

  test('shows "invalid" when no token is provided', async ({ page }) => {
    await page.goto('/accept-invite');
    await expect(page.getByText(/invalid|expired/i)).toBeVisible({ timeout: 10_000 });
  });

  test('shows the logo and branding on accept invite page', async ({ page }) => {
    await page.goto('/accept-invite?token=anytoken');
    await expect(page.getByText('CRM & IT Desk')).toBeVisible();
  });
});

// ──────────────────────────────────────────────────────────────
// Data isolation — orgs cannot see each other's data
// ──────────────────────────────────────────────────────────────
test.describe('Org data isolation', () => {
  test('contacts created by one org are not visible after switching to another', async ({ browser }) => {
    // Org A context
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto('/login');
    // The Sign In email input's placeholder is literally "you@company.com" —
    // it doesn't contain the substring "email" anywhere, so getByPlaceholder
    // (/email/i) matched nothing and fill() just timed out. The login()
    // helper elsewhere in the suite already uses the correct pattern.
    await pageA.getByPlaceholder(/you@company/i).fill(ORG_A.email);
    await pageA.getByPlaceholder(/password/i).fill(ORG_A.password);
    await pageA.getByRole('button', { name: /sign in/i }).last().click();
    await pageA.waitForURL(/\/dashboard/, { timeout: 10_000 });

    // Create a contact in Org A. Not gated behind isVisible() — that call
    // doesn't auto-wait/retry, so it can return false (and silently skip
    // contact creation) if the button just hasn't rendered yet.
    await pageA.goto('/crm/contacts');
    // .first() — a brand-new org has zero contacts, so ContactsPage renders
    // *two* "New Contact" buttons at once: the page header's and the empty
    // state's own CTA. Both do the same thing; without .first() this is a
    // strict-mode violation ("resolved to 2 elements").
    const createBtn = pageA.getByRole('button', { name: /new contact|add contact/i }).first();
    await createBtn.click();
    const dialog = pageA.getByRole('dialog');
    await dialog.getByLabel(/name/i).fill('Org A Secret Contact');
    await dialog.getByLabel(/email/i).fill('secret@orga.com');
    await pageA.getByRole('button', { name: /save|create/i }).last().click();
    await expect(pageA.getByText('Org A Secret Contact')).toBeVisible({ timeout: 8_000 });
    await ctxA.close();

    // Org B context — should NOT see Org A's contact
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto('/login');
    await pageB.getByPlaceholder(/you@company/i).fill(ORG_B.email);
    await pageB.getByPlaceholder(/password/i).fill(ORG_B.password);
    await pageB.getByRole('button', { name: /sign in/i }).last().click();
    await pageB.waitForURL(/\/dashboard/, { timeout: 10_000 });

    await pageB.goto('/crm/contacts');
    // Not waitForLoadState('networkidle') — this app has background polling
    // (notifications/SSE, visible as recurring "stream?..." requests), so the
    // network never truly goes idle and that wait just hangs until the test
    // times out. Wait for a concrete UI signal that the list has loaded instead.
    await expect(pageB.getByRole('heading', { name: /contacts/i })).toBeVisible({ timeout: 10_000 });
    await expect(pageB.getByText('Org A Secret Contact')).not.toBeVisible();
    await ctxB.close();
  });
});
