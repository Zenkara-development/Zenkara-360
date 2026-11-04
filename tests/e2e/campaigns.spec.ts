import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

test.describe('Campaigns', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/campaigns');
    await page.waitForURL(/\/campaigns/);
  });

  test('campaigns page loads with heading', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /campaigns/i })
    ).toBeVisible();
  });

  test('creates a new campaign', async ({ page }) => {
    await page.getByRole('button', { name: /new campaign|create campaign/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/name/i).fill(TEST.campaign.name);
    await dialog.getByLabel(/subject/i).fill(TEST.campaign.subject);
    await dialog.getByLabel(/body/i).fill(TEST.campaign.body);

    await dialog.getByRole('button', { name: /create campaign/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(TEST.campaign.name)).toBeVisible({ timeout: 8_000 });
  });

  test('campaign appears in DRAFT status', async ({ page }) => {
    // Campaigns use card layout, not table rows
    const card = page.locator('[data-testid="campaign-card"]').filter({
      hasText: TEST.campaign.name,
    }).first();
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card.getByText(/draft/i)).toBeVisible();
  });

  test('send button is visible on DRAFT campaign', async ({ page }) => {
    // Only verify the send button is visible — do NOT click it.
    // Sending changes status to SENT which hides the delete button,
    // breaking the subsequent delete test.
    const card = page.locator('[data-testid="campaign-card"]').filter({
      hasText: TEST.campaign.name,
    }).first();
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: /^send$/i })).toBeVisible();
  });

  test('deletes a campaign and verifies removal', async ({ page }) => {
    const card = page.locator('[data-testid="campaign-card"]').filter({
      hasText: TEST.campaign.name,
    }).first();
    await expect(card).toBeVisible();

    page.on('dialog', d => d.accept());
    await card.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /delete campaign/i }).click();

    await expect(page.getByText(TEST.campaign.name)).not.toBeVisible({ timeout: 8_000 });
  });
});
