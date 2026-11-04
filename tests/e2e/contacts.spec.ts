import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

test.describe('Contacts', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Contacts' }).click();
    await page.waitForURL(/\/crm\/contacts$/);
  });

  test('shows contacts page with table or empty state', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
  });

  test('creates a new contact', async ({ page }) => {
    await page.getByRole('button', { name: /new contact/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel(/name/i).fill(TEST.contact.name);
    await page.getByLabel(/email/i).fill(TEST.contact.email);
    await page.getByLabel(/phone/i).fill(TEST.contact.phone);
    await page.getByLabel(/job title/i).fill(TEST.contact.jobTitle);
    await page.getByRole('button', { name: /create contact/i }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByText(TEST.contact.name).first()).toBeVisible();
  });

  test('opens contact detail page by clicking name', async ({ page }) => {
    await expect(page.getByText(TEST.contact.name).first()).toBeVisible();
    await page.getByText(TEST.contact.name).first().click();
    await page.waitForURL(/\/crm\/contacts\/.+/);
    await expect(page.getByRole('heading', { name: TEST.contact.name })).toBeVisible();
  });

  test('contact detail page shows info card with email', async ({ page }) => {
    await page.getByText(TEST.contact.name).first().click();
    await page.waitForURL(/\/crm\/contacts\/.+/);
    await expect(page.getByText(TEST.contact.email)).toBeVisible();
    await expect(page.getByText('Contact Info')).toBeVisible();
  });

  test('logs an activity from contact detail page', async ({ page }) => {
    await page.getByText(TEST.contact.name).first().click();
    await page.waitForURL(/\/crm\/contacts\/.+/);

    // Wait for the detail page to finish loading before interacting
    await expect(page.getByRole('button', { name: /log activity/i })).toBeVisible({ timeout: 8_000 });
    await page.getByRole('button', { name: /log activity/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/subject/i).fill('Follow-up call');
    // Submit button inside the dialog — may say "Log Activity", "Save", or "Submit"
    await dialog.getByRole('button', { name: /log activity|save|submit|add/i }).last().click();

    await expect(dialog).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Follow-up call')).toBeVisible({ timeout: 8_000 });
  });

  test('edits a contact', async ({ page }) => {
    await page.getByText(TEST.contact.name).first().click();
    await page.waitForURL(/\/crm\/contacts\/.+/);

    await page.getByRole('button', { name: /edit/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const nameInput = page.getByLabel(/name/i);
    await nameInput.fill(TEST.contact.name + ' Updated');
    await page.getByRole('button', { name: /save changes/i }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByText(TEST.contact.name + ' Updated')).toBeVisible();

    // Rename back for subsequent tests
    await page.getByRole('button', { name: /edit/i }).click();
    await page.getByLabel(/name/i).fill(TEST.contact.name);
    await page.getByRole('button', { name: /save changes/i }).click();
  });

  test('deletes a contact', async ({ page }) => {
    // Create a temporary contact to delete
    await page.getByRole('button', { name: /new contact/i }).click();
    await page.getByLabel(/name/i).fill('Delete Me Contact');
    await page.getByLabel(/email/i).fill('deleteme@test.com');
    await page.getByRole('button', { name: /create contact/i }).click();
    await expect(page.getByText('Delete Me Contact')).toBeVisible();

    // Delete it — find its row and click the trash icon
    const row = page.getByRole('row', { name: /delete me contact/i });
    await row.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /delete contact/i }).click();

    await expect(page.getByText('Delete Me Contact')).not.toBeVisible({ timeout: 5_000 });
  });
});
