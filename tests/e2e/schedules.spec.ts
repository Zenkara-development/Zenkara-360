import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { TEST } from '../helpers/seed';

/**
 * Mirrors ScheduleReminderPanel's own `nowLocal()` helper (UTC-sliced
 * datetime-local value) so a value built here always satisfies the input's
 * `min` attribute regardless of the runner's local timezone.
 */
function futureDateTimeLocal(minutesFromNow = 60) {
  const d = new Date(Date.now() + minutesFromNow * 60_000);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

// Distinct from TEST.ticket.title / TEST.deal.title — tickets.spec.ts and
// deals.spec.ts create those, but this file must not depend on those files
// having already run. Spec files execute in alphabetical order by default
// ("schedules.spec.ts" sorts before "tickets.spec.ts"), so relying on
// TEST.ticket.title existing by the time these tests run was a real bug,
// not a flake — it failed on every run, not intermittently. Each describe
// block below creates its own fixture instead.
const SCHEDULE_TICKET_TITLE = 'E2E Schedule Test Ticket';
const SCHEDULE_DEAL_TITLE = 'E2E Schedule Test Deal';

test.describe('Schedules — WhatsApp reminders on Tickets', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Tickets' }).click();
    await page.waitForURL(/\/itdesk\/tickets/);
  });

  test('creates a ticket fixture for reminder tests', async ({ page }) => {
    await page.getByRole('button', { name: /new ticket/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel(/title/i).fill(SCHEDULE_TICKET_TITLE);
    await page.getByLabel(/description/i).fill('Fixture ticket for schedules.spec.ts reminder tests.');
    await page.getByLabel(/priority/i).selectOption('MEDIUM');
    await page.getByRole('button', { name: /submit ticket/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(SCHEDULE_TICKET_TITLE).first()).toBeVisible({ timeout: 8_000 });
  });

  test('schedules a WhatsApp reminder on a ticket', async ({ page }) => {
    await page.getByText(SCHEDULE_TICKET_TITLE).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await expect(dialog.getByText(/WhatsApp Reminders/i)).toBeVisible();
    await dialog.getByRole('button', { name: /schedule a reminder/i }).click();

    await dialog.getByLabel('Due date').fill(futureDateTimeLocal());
    await dialog.getByLabel('Message').fill(TEST.schedule.ticketMessage);
    await dialog.getByLabel('Recipient').selectOption('ASSIGNEE');

    await dialog.getByRole('button', { name: /schedule reminder/i }).click();

    await expect(dialog.getByText(TEST.schedule.ticketMessage)).toBeVisible({ timeout: 8_000 });
    await expect(dialog.getByText('Upcoming')).toBeVisible();
  });

  test('reminder persists after reopening the ticket', async ({ page }) => {
    await page.getByText(SCHEDULE_TICKET_TITLE).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(TEST.schedule.ticketMessage)).toBeVisible({ timeout: 8_000 });
  });

  test('cancels a ticket reminder', async ({ page }) => {
    await page.getByText(SCHEDULE_TICKET_TITLE).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Scope to the schedule item's own card (border-gray-100/rounded-xl) —
    // not just any ancestor div with matching text — so the cancel button,
    // which is a *sibling* of the text-bearing node inside that card, stays
    // within the locator's subtree.
    const row = dialog.locator('div.border-gray-100.rounded-xl').filter({ hasText: TEST.schedule.ticketMessage });
    await expect(row).toBeVisible({ timeout: 8_000 });

    // No native confirm() here — ScheduleReminderPanel's cancel button
    // deletes immediately on click (unlike the workflow rule delete flow).
    await row.locator('button[title="Cancel reminder"]').click();

    await expect(dialog.getByText(TEST.schedule.ticketMessage)).not.toBeVisible({ timeout: 8_000 });
  });
});

test.describe('Schedules — WhatsApp reminders on Deals', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Pipeline' }).click();
    await page.waitForURL(/\/crm\/deals/);
  });

  test('creates a deal fixture for reminder tests', async ({ page }) => {
    await page.getByRole('button', { name: /new deal/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel(/deal title/i).fill(SCHEDULE_DEAL_TITLE);
    await page.getByLabel(/value/i).fill('1000');
    await page.getByRole('button', { name: /create deal/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(SCHEDULE_DEAL_TITLE).first()).toBeVisible({ timeout: 8_000 });
  });

  test('schedules a reminder on a deal with a custom number', async ({ page }) => {
    await page.getByText(SCHEDULE_DEAL_TITLE).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: /schedule a reminder/i }).click();

    await dialog.getByLabel('Due date').fill(futureDateTimeLocal());
    await dialog.getByLabel('Message').fill(TEST.schedule.dealMessage);
    await dialog.getByLabel('Recipient').selectOption('CUSTOM_NUMBER');
    await dialog.getByLabel('Custom number').fill(TEST.schedule.customNumber);

    await dialog.getByRole('button', { name: /schedule reminder/i }).click();

    await expect(dialog.getByText(TEST.schedule.dealMessage)).toBeVisible({ timeout: 8_000 });
  });
});

test.describe('Workflows — SEND_WHATSAPP action', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/workflows');
    await page.waitForURL(/\/workflows/);
  });

  test('creates a workflow rule with a SEND_WHATSAPP action', async ({ page }) => {
    await page.getByRole('button', { name: /new rule|create rule|add workflow/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Rule Name').fill(TEST.whatsappWorkflow.name);

    // Default trigger is a TICKET trigger, so the recipient dropdown that
    // renders for SEND_WHATSAPP will be the TICKET variant (no "Deal's
    // contact" option) — matches ScheduleReminderPanel's own TICKET/DEAL
    // recipient split.
    const actionsSection = dialog.locator('.form-section').filter({ hasText: 'Actions' });
    const typeSelect = actionsSection.locator('select').first();
    await typeSelect.selectOption('SEND_WHATSAPP');

    const recipientSelect = actionsSection.locator('select').nth(1);
    await recipientSelect.selectOption('ASSIGNEE');

    await dialog.getByPlaceholder(/message \(use/i).fill('Reminder: {{title}} needs attention');

    await dialog.getByRole('button', { name: /save rule/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });

    await expect(page.getByText(TEST.whatsappWorkflow.name)).toBeVisible({ timeout: 8_000 });
    const row = page.locator('[data-testid="workflow-rule"]')
      .filter({ hasText: TEST.whatsappWorkflow.name })
      .first();
    await expect(row.getByText(/Send WhatsApp/i)).toBeVisible();
  });

  test('deletes the SEND_WHATSAPP workflow rule', async ({ page }) => {
    const row = page.locator('[data-testid="workflow-rule"]')
      .filter({ hasText: TEST.whatsappWorkflow.name })
      .first();
    await expect(row).toBeVisible();

    page.once('dialog', d => d.accept());
    await row.getByRole('button', { name: /row actions/i }).click();
    await page.getByRole('button', { name: /^delete$/i }).click();

    await expect(page.getByText(TEST.whatsappWorkflow.name)).not.toBeVisible({ timeout: 8_000 });
  });
});
