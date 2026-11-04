import { Page, expect } from '@playwright/test';

/** Seeded techcorp admin — see server/src/utils/seedDemoData.ts loginEmailFor('techcorp'). */
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@techcorp.demo';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'Admin@123';

/** Logs in via the real login form (not the demo-login shortcut) and waits for the dashboard to load. */
export async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill(ADMIN_EMAIL);
  await page.getByPlaceholder('Enter your password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}
