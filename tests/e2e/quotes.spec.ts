import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

test.describe('Quotes', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/quotes');
    await page.waitForURL(/\/quotes/);
  });

  // ── 1. Page heading ───────────────────────────────────────────────────────
  test('quotes page loads with heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /quotes/i })).toBeVisible();
  });

  // ── 2. Create a quote ─────────────────────────────────────────────────────
  // Quotes are rendered as cards (divs), not table rows.
  // QuotesPage.tsx aria-labels: Title, Description, Qty, Price, "Create Quote" button
  test('creates a quote with a line item', async ({ page }) => {
    await page.getByRole('button', { name: /new quote/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Title').fill(TEST.quote.title);
    await dialog.getByLabel('Description').fill(TEST.quote.lineItem.description);
    await dialog.getByLabel('Qty').fill(String(TEST.quote.lineItem.qty));
    await dialog.getByLabel('Price').fill(String(TEST.quote.lineItem.unitPrice));

    await dialog.getByRole('button', { name: /create quote/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(TEST.quote.title)).toBeVisible({ timeout: 8_000 });
  });

  // ── 3. DRAFT badge on card ────────────────────────────────────────────────
  test('created quote appears in the list with DRAFT status', async ({ page }) => {
    // Quotes are card divs with data-testid="quote-card" — NOT table rows
    const quoteCard = page.locator('[data-testid="quote-card"]').filter({
      has: page.locator('h3').filter({ hasText: /^E2E Quote$/ }),
    }).first();
    await expect(quoteCard).toBeVisible({ timeout: 5_000 });
    await expect(quoteCard.getByText('DRAFT')).toBeVisible();
  });

  // ── 4. Total calculation ──────────────────────────────────────────────────
  test('total is calculated correctly', async ({ page }) => {
    const expectedTotal = TEST.quote.lineItem.qty * TEST.quote.lineItem.unitPrice; // 2 × 100 = 200
    const quoteCard = page.locator('[data-testid="quote-card"]').filter({
      has: page.locator('h3').filter({ hasText: /^E2E Quote$/ }),
    }).first();
    await expect(quoteCard).toBeVisible();
    // Total renders as "200.00" inside the card; use .first() since qty and total may both contain "200"
    await expect(quoteCard.getByText(new RegExp(`${expectedTotal}`)).first()).toBeVisible({ timeout: 5_000 });
  });

  // ── 5. Edit title  (MUST run before status changes — edit btn is DRAFT-only) ──
  test('edits the quote title', async ({ page }) => {
    const quoteCard = page.locator('[data-testid="quote-card"]').filter({
      has: page.locator('h3').filter({ hasText: /^E2E Quote$/ }),
    }).first();
    await expect(quoteCard).toBeVisible();

    await quoteCard.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: 'Edit quote' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const titleInput = dialog.getByLabel('Title');
    await titleInput.clear();
    await titleInput.fill(TEST.quote.title + ' Edited');
    await dialog.getByRole('button', { name: /save changes/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(TEST.quote.title + ' Edited')).toBeVisible({ timeout: 8_000 });
  });

  // ── 6. Change status to SENT ──────────────────────────────────────────────
  // "Send" button lives directly on the card — clicking the title does nothing
  test('changes quote status to SENT', async ({ page }) => {
    const editedTitle = TEST.quote.title + ' Edited';
    const quoteCard = page.locator('[data-testid="quote-card"]').filter({
      has: page.locator('h3', { hasText: editedTitle }),
    }).first();
    await expect(quoteCard).toBeVisible();
    await quoteCard.getByRole('button', { name: /^send$/i }).click();
    await expect(quoteCard.getByText('SENT')).toBeVisible({ timeout: 5_000 });
  });

  // ── 7. Change status to ACCEPTED ─────────────────────────────────────────
  // "Accept" button appears on SENT cards directly
  test('changes quote status to ACCEPTED', async ({ page }) => {
    const editedTitle = TEST.quote.title + ' Edited';
    const quoteCard = page.locator('[data-testid="quote-card"]').filter({
      has: page.locator('h3', { hasText: editedTitle }),
    }).first();
    await expect(quoteCard).toBeVisible();
    await quoteCard.getByRole('button', { name: /^accept$/i }).click();
    await expect(quoteCard.getByText('ACCEPTED')).toBeVisible({ timeout: 5_000 });
  });

  // ── 8. Delete ─────────────────────────────────────────────────────────────
  // Delete uses window.confirm() — Playwright's default is to DISMISS (return false),
  // so we must register the dialog handler before clicking.
  test('deletes a quote and verifies removal', async ({ page }) => {
    const editedTitle = TEST.quote.title + ' Edited';
    const quoteCard = page.locator('[data-testid="quote-card"]').filter({
      has: page.locator('h3', { hasText: editedTitle }),
    }).first();
    await expect(quoteCard).toBeVisible();

    page.on('dialog', d => d.accept());
    const rowActionsBtn = quoteCard.getByRole('button', { name: /row actions/i });
    await expect(rowActionsBtn).toBeVisible({ timeout: 8_000 });
    await rowActionsBtn.click();
    await page.getByRole('button', { name: 'Delete quote' }).click();
    await expect(page.getByText(editedTitle)).not.toBeVisible({ timeout: 8_000 });
  });
});
