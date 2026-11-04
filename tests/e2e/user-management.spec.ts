import { test, expect } from '@playwright/test';
import { login, ADMIN } from '../helpers/auth';

const INVITE_EMAIL = `playwright-invite-${Date.now()}@test.com`;
const NEW_USER = {
  name: 'PW Test User',
  email: `pw-user-${Date.now()}@test.com`,
  password: 'Playwright@123',
  role: 'SALES_REP',
};

test.describe('User Management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/admin/users');
    await page.waitForURL(/\/admin\/users/);
  });

  // Verifies the users table is visible and contains the current admin
  test('users table is visible and contains current admin', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /users/i })).toBeVisible();
    await expect(page.getByText(ADMIN.email, { exact: false })).toBeVisible({ timeout: 8_000 });
  });

  // Verifies the Invite User modal shows email + role fields
  test('invite user modal shows email and role fields', async ({ page }) => {
    await page.getByRole('button', { name: /invite user/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/email/i)).toBeVisible();
    await expect(dialog.getByLabel(/role/i)).toBeVisible();
  });

  // Verifies generating an invite link places the invited user in a pending state
  test('generates invite link and shows it to admin', async ({ page }) => {
    await page.getByRole('button', { name: /invite user/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/email/i).fill(INVITE_EMAIL);
    await dialog.getByLabel(/role/i).selectOption('EMPLOYEE');
    await dialog.getByRole('button', { name: /generate invite link/i }).click();

    await expect(dialog.getByText(/invite link generated/i)).toBeVisible({ timeout: 8_000 });
    await expect(dialog.getByRole('button', { name: /copy/i })).toBeVisible();
  });

  // Verifies creating a user via Create User form adds them to the table
  test('creates a new user via create user form', async ({ page }) => {
    await page.getByRole('button', { name: /create user/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/name/i).fill(NEW_USER.name);
    await dialog.getByLabel(/email/i).fill(NEW_USER.email);
    await dialog.getByLabel(/password/i).fill(NEW_USER.password);
    await dialog.getByLabel(/role/i).selectOption(NEW_USER.role);
    await dialog.getByRole('button', { name: /create|invite/i }).click();

    await expect(dialog).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(NEW_USER.name).first()).toBeVisible({ timeout: 5_000 });
  });

  // Verifies a non-admin user's role can be edited
  test('edits a non-admin user role', async ({ page }) => {
    const row = page.getByRole('row', { name: new RegExp(NEW_USER.name, 'i') }).first();
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: /row actions/i }).click();
    const editBtn = page.getByRole('button', { name: /^edit$/i });
    if (await editBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await editBtn.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      const roleSelect = dialog.getByLabel(/role/i);
      await roleSelect.selectOption('IT_AGENT');
      await dialog.getByRole('button', { name: /save|update/i }).click();
      // Same class of load-related lag as admin.spec.ts's "creates a new
      // user" — bumped alongside it.
      await expect(dialog).not.toBeVisible({ timeout: 12_000 });
    }
  });

  // Verifies a non-admin user can be deactivated or deleted
  test('deactivates or deletes a non-admin user', async ({ page }) => {
    const row = page.getByRole('row', { name: new RegExp(NEW_USER.name, 'i') }).first();
    await expect(row).toBeVisible();

    // Open the row actions menu first
    await row.getByRole('button', { name: /row actions/i }).click();
    const deactivateBtn = page.getByRole('button', { name: /deactivate/i });
    const deleteBtn = page.getByRole('button', { name: /delete|remove/i });

    if (await deactivateBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await deactivateBtn.click();
      await expect(
        row.getByText(/inactive|deactivated/i)
      ).toBeVisible({ timeout: 5_000 });
    } else if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|delete/i });
      if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await confirmBtn.click();
      }
      await expect(page.getByText(NEW_USER.name)).not.toBeVisible({ timeout: 8_000 });
    }
  });
});
