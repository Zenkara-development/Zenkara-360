import { test, expect } from '@playwright/test';
import { login, logout, ADMIN } from '../helpers/auth';

test.describe('Authentication', () => {
  test('redirects unauthenticated user to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('shows validation error on empty form submit', async ({ page }) => {
    await page.goto('/login');
    // The submit button is inside the form; the tab button also says "Sign In"
    // Use the button that submits (type="submit") — click the last "Sign In" in the form
    await page.getByRole('button', { name: /^sign in$/i }).last().click();
    // HTML5 required validation fires — email field should show required error
    const emailInput = page.getByPlaceholder(/you@company/i);
    await expect(emailInput).toBeFocused();
  });

  test('shows error on wrong credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder(/you@company/i).fill('wrong@example.com');
    await page.getByPlaceholder(/password/i).fill('WrongPass123');
    await page.getByRole('button', { name: /^sign in$/i }).last().click();
    // LoginPage sets: 'Invalid email or password. Please try again.'
    await expect(
      page.getByText(/invalid.*email|invalid.*password|wrong.*credentials|incorrect.*password|unauthorized/i).first()
        .or(page.locator('.text-red-500, .text-red-600, .text-red-700, [role="alert"]').first())
    ).toBeVisible({ timeout: 10_000 });
  });

  test('logs in successfully and shows dashboard', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);
    // Sidebar should be visible
    await expect(page.getByText('CRM & IT Desk')).toBeVisible();
  });

  test('logs out and redirects to login', async ({ page }) => {
    await login(page);
    await logout(page);
    await expect(page).toHaveURL(/\/login/);
  });

  test('cannot access protected routes after logout', async ({ page }) => {
    await login(page);
    await logout(page);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('sidebar shows logged-in user name', async ({ page }) => {
    await login(page);
    await expect(page.getByText(ADMIN.name, { exact: false })).toBeVisible();
  });
});
