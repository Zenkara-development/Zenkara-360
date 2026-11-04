import { Page } from '@playwright/test';

/** Credentials for the seeded SUPER_ADMIN account */
export const ADMIN = {
  email: 'admin@crmitdesk.com',
  password: 'Admin@123',
  name: 'Alex Admin',
};

/**
 * Log in via the UI and wait for the dashboard to appear.
 * Reuse across every test that needs an authenticated session.
 */
export async function login(page: Page, email = ADMIN.email, password = ADMIN.password) {
  await page.goto('/login');
  // The login page now has tabs — "Sign In" tab is active by default
  // Fill the login form fields (placeholders updated)
  await page.getByPlaceholder(/you@company/i).fill(email);
  await page.getByPlaceholder(/password/i).fill(password);
  // Click the submit button (last "Sign In" button — the tab btn comes first)
  await page.getByRole('button', { name: /^sign in$/i }).last().click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: /sign out/i }).click();
  await page.waitForURL(/\/login/);
}
