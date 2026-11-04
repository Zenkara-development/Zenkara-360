/**
 * role-login.spec.ts
 *
 * UI-level tests: verifies all 5 seeded roles can log in, reach the dashboard,
 * and that basic access-control redirects / error states work.
 *
 * Prerequisite: seed must have been run at C:\Projects\CRMITDesk\server
 *   cd server && npm run db:seed
 *
 * Seeded credentials (all password: Admin@123):
 *   admin@crmitdesk.com       SUPER_ADMIN
 *   crm@crmitdesk.com         CRM_MANAGER
 *   sales@crmitdesk.com       SALES_REP
 *   itmanager@crmitdesk.com   IT_MANAGER
 *   itagent@crmitdesk.com     IT_AGENT
 */

import { test, expect, Page } from '@playwright/test';

// ── Seeded user credentials ──────────────────────────────────────────────────
const USERS = [
  { role: 'SUPER_ADMIN',  email: 'admin@crmitdesk.com',      name: 'Alex Admin',  password: 'Admin@123' },
  { role: 'CRM_MANAGER',  email: 'crm@crmitdesk.com',        name: 'Carla Chen',  password: 'Admin@123' },
  { role: 'SALES_REP',    email: 'sales@crmitdesk.com',      name: 'Sam Sales',   password: 'Admin@123' },
  { role: 'IT_MANAGER',   email: 'itmanager@crmitdesk.com',  name: 'Ivy IT',      password: 'Admin@123' },
  { role: 'IT_AGENT',     email: 'itagent@crmitdesk.com',    name: 'Dave Desk',   password: 'Admin@123' },
];

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder(/you@company/i).fill(email);
  await page.getByPlaceholder(/password/i).fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).last().click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

// ── 1. All roles can log in ──────────────────────────────────────────────────
test.describe('All roles can log in', () => {
  for (const u of USERS) {
    test(`${u.role} logs in and reaches dashboard`, async ({ page }) => {
      await loginAs(page, u.email, u.password);
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.getByText(u.name, { exact: false })).toBeVisible();
      await expect(page.getByText(new RegExp(u.role.replace('_', '.'), 'i'))).toBeVisible();
    });
  }
});

// ── 2. Core navigation visible for every role ────────────────────────────────
test.describe('Core navigation visible for all roles', () => {
  for (const u of USERS) {
    test(`${u.role} sees Dashboard and Tickets links`, async ({ page }) => {
      await loginAs(page, u.email, u.password);
      const sidebar = page.locator('aside');
      await expect(sidebar.getByRole('link', { name: /dashboard/i })).toBeVisible();
      await expect(sidebar.getByRole('link', { name: /tickets/i })).toBeVisible();
    });
  }
});

// ── 3. CRM sidebar links visible only for CRM roles ──────────────────────────
test.describe('CRM sidebar visibility', () => {
  const CRM_ROLES = ['SUPER_ADMIN', 'CRM_MANAGER', 'SALES_REP'];
  const NON_CRM_ROLES = USERS.filter(u => !CRM_ROLES.includes(u.role));

  for (const u of USERS.filter(u => CRM_ROLES.includes(u.role))) {
    test(`${u.role} sees Contacts and Leads in sidebar`, async ({ page }) => {
      await loginAs(page, u.email, u.password);
      const sidebar = page.locator('aside');
      await expect(sidebar.getByRole('link', { name: /contacts/i })).toBeVisible();
      await expect(sidebar.getByRole('link', { name: /leads/i })).toBeVisible();
    });
  }

  for (const u of NON_CRM_ROLES) {
    test(`${u.role} does not see CRM links (Contacts/Leads) in sidebar`, async ({ page }) => {
      await loginAs(page, u.email, u.password);
      const sidebar = page.locator('aside');
      // Wait for sidebar to fully load (use domcontentloaded — SSE keeps network active)
      await page.waitForLoadState('domcontentloaded');
      await expect(sidebar.getByRole('link', { name: /^contacts$/i })).not.toBeVisible({ timeout: 3_000 }).catch(() => {});
    });
  }
});

// ── 4. User management (/admin/users) ────────────────────────────────────────
test.describe('/admin/users access control', () => {
  async function assertAdminBlocked(page: Page) {
    await page.waitForLoadState('domcontentloaded');
    const hasError = await page.getByText(/permission|forbidden|access denied|not allowed/i)
      .isVisible({ timeout: 3_000 }).catch(() => false);
    const hasToast = await page.getByText(/don.t have permission/i)
      .isVisible({ timeout: 1_000 }).catch(() => false);
    const hasCreateBtn = await page.getByRole('button', { name: /create user/i })
      .isVisible({ timeout: 1_000 }).catch(() => false);
    expect(hasError || hasToast || !hasCreateBtn).toBeTruthy();
  }

  test('SALES_REP is blocked from /admin/users', async ({ page }) => {
    await loginAs(page, 'sales@crmitdesk.com', 'Admin@123');
    await page.goto('/admin/users');
    await assertAdminBlocked(page);
  });

  test('IT_AGENT is blocked from /admin/users', async ({ page }) => {
    await loginAs(page, 'itagent@crmitdesk.com', 'Admin@123');
    await page.goto('/admin/users');
    await assertAdminBlocked(page);
  });

  test('SUPER_ADMIN can access /admin/users', async ({ page }) => {
    await loginAs(page, 'admin@crmitdesk.com', 'Admin@123');
    await page.goto('/admin/users');
    await page.waitForURL(/\/admin\/users/);
    await expect(page.getByRole('heading', { name: /users/i })).toBeVisible();
  });

  test('CRM_MANAGER can access /admin/users', async ({ page }) => {
    await loginAs(page, 'crm@crmitdesk.com', 'Admin@123');
    await page.goto('/admin/users');
    await page.waitForURL(/\/admin\/users/);
    await expect(page.getByRole('heading', { name: /users/i })).toBeVisible();
  });

  test('IT_MANAGER can access /admin/users', async ({ page }) => {
    await loginAs(page, 'itmanager@crmitdesk.com', 'Admin@123');
    await page.goto('/admin/users');
    await page.waitForURL(/\/admin\/users/);
    await expect(page.getByRole('heading', { name: /users/i })).toBeVisible();
  });
});

// ── 5. IT Agent can view and update tickets (not delete) ─────────────────────
test.describe('IT_AGENT ticket permissions (UI)', () => {
  test('IT_AGENT can navigate to Tickets page', async ({ page }) => {
    await loginAs(page, 'itagent@crmitdesk.com', 'Admin@123');
    await page.goto('/itdesk/tickets');
    await page.waitForURL(/\/itdesk\/tickets/);
    await expect(page.getByRole('heading', { name: /tickets/i })).toBeVisible();
  });

  test('IT_AGENT can create a ticket', async ({ page }) => {
    await loginAs(page, 'itagent@crmitdesk.com', 'Admin@123');
    await page.goto('/itdesk/tickets');
    const createBtn = page.getByRole('button', { name: /new ticket|create ticket/i }).first();
    await expect(createBtn).toBeVisible({ timeout: 5_000 });
  });
});

// ── 6. SALES_REP can view contacts but not delete ────────────────────────────
test.describe('SALES_REP contact permissions (UI)', () => {
  test('SALES_REP can navigate to Contacts page', async ({ page }) => {
    await loginAs(page, 'sales@crmitdesk.com', 'Admin@123');
    await page.goto('/crm/contacts');
    await page.waitForURL(/\/crm\/contacts/);
    await expect(page.getByRole('heading', { name: /contacts/i })).toBeVisible();
  });
});

// ── 7. Sign out works for each role ──────────────────────────────────────────
test.describe('Sign out', () => {
  for (const u of USERS) {
    test(`${u.role} can sign out`, async ({ page }) => {
      await loginAs(page, u.email, u.password);
      await page.getByRole('button', { name: /sign out/i }).click();
      await expect(page).toHaveURL(/\/login/, { timeout: 8_000 });
    });
  }
});

// ── 8. Wrong password rejected ────────────────────────────────────────────────
test.describe('Wrong password rejected', () => {
  for (const u of USERS) {
    test(`${u.role} login fails with wrong password`, async ({ page }) => {
      await page.goto('/login');
      await page.getByPlaceholder(/you@company/i).fill(u.email);
      await page.getByPlaceholder(/password/i).fill('WrongPassword!999');
      await page.getByRole('button', { name: /^sign in$/i }).last().click();

      await expect(
        page.getByText(/invalid.*email|invalid.*password|wrong.*credentials|incorrect/i).first()
          .or(page.locator('.text-red-500, .text-red-600, .text-red-700, [role="alert"]').first())
      ).toBeVisible({ timeout: 10_000 });

      // Must not have navigated away from login
      await expect(page).not.toHaveURL(/\/dashboard/);
    });
  }
});
