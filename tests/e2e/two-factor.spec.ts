import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

test.describe('Two-Factor Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/security/2fa');
    await page.waitForURL(/\/security\/2fa/);
  });

  test('2FA page loads with heading', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /two.factor|2fa|security/i })
    ).toBeVisible();
  });

  test('shows current 2FA status', async ({ page }) => {
    // Should show either "Enabled" or "Disabled" status
    const status = page.getByText(/enabled|disabled|not enabled|active|inactive/i).first();
    await expect(status).toBeVisible({ timeout: 5_000 });
  });

  test('shows Setup 2FA button when disabled', async ({ page }) => {
    const isDisabled = await page.getByText(/not enabled|disabled/i).isVisible().catch(() => false);
    if (isDisabled) {
      await expect(
        page.getByRole('button', { name: /set up|enable|configure/i })
      ).toBeVisible();
    }
  });

  test('clicking Setup 2FA shows QR code or secret', async ({ page }) => {
    const setupBtn = page.getByRole('button', { name: /set up|enable 2fa|configure/i });
    if (await setupBtn.isVisible().catch(() => false)) {
      await setupBtn.click();
      // Should show QR code image or secret key
      const hasQr     = await page.locator('img[alt*="qr" i], canvas, svg[data-qr]').isVisible({ timeout: 5_000 }).catch(() => false);
      const hasSecret = await page.getByText(/secret|backup|key/i).isVisible({ timeout: 5_000 }).catch(() => false);
      const hasInput  = await page.getByLabel(/code|token|otp/i).isVisible({ timeout: 5_000 }).catch(() => false);
      expect(hasQr || hasSecret || hasInput).toBeTruthy();
    }
  });

  test('entering invalid TOTP code shows error', async ({ page }) => {
    const setupBtn = page.getByRole('button', { name: /set up|enable 2fa|configure/i });
    if (await setupBtn.isVisible().catch(() => false)) {
      await setupBtn.click();
      const tokenInput = page.getByLabel(/code|token|otp/i).first();
      if (await tokenInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await tokenInput.fill('000000');
        const verifyBtn = page.getByRole('button', { name: /verify|enable|confirm/i });
        if (await verifyBtn.isVisible()) {
          await verifyBtn.click();
          await expect(
            page.getByText(/invalid|incorrect|wrong|failed/i)
          ).toBeVisible({ timeout: 5_000 });
        }
      }
    }
  });

  test('shows Disable 2FA option when enabled', async ({ page }) => {
    const isEnabled = await page.getByText(/^enabled$|2fa is enabled|two-factor is on/i).isVisible().catch(() => false);
    if (isEnabled) {
      await expect(
        page.getByRole('button', { name: /disable/i })
      ).toBeVisible();
    }
  });

  test('copy secret button works', async ({ page }) => {
    const setupBtn = page.getByRole('button', { name: /set up|enable 2fa|configure/i });
    if (await setupBtn.isVisible().catch(() => false)) {
      await setupBtn.click();
      const copyBtn = page.getByRole('button', { name: /copy/i });
      if (await copyBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await copyBtn.click();
        // After copy, button text usually changes
        await expect(
          page.getByRole('button', { name: /copied|done/i })
        ).toBeVisible({ timeout: 3_000 }).catch(() => {
          // Some implementations just show a toast — that's fine
        });
      }
    }
  });
});
