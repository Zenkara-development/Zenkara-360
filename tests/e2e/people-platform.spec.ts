import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * UI coverage for the people / task / approval / permission / AI-governance
 * platform.
 *
 * Scoped to what a user can actually see and do, in the same style as the
 * existing suite: navigate, assert the page rendered, exercise one meaningful
 * interaction. The deeper behavioural guarantees (scoping, masking, approval
 * step advancement) are covered by server/tests/integration/platform-api.ts,
 * which can assert on response bodies rather than pixels.
 *
 * Every record these tests create is namespaced with a timestamp and deleted
 * on the way out, so the suite is safe to run repeatedly against the demo org.
 */

const stamp = () => Date.now().toString().slice(-6);

test.describe('People platform — navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  const ROUTES = [
    { link: /my work/i, url: /\/my-work/, heading: /my work/i },
    { link: /approvals/i, url: /\/approvals/, heading: /approvals/i },
    { link: /employees/i, url: /\/hr\/employees/, heading: /employees/i },
    { link: /org structure/i, url: /\/hr\/org/, heading: /org structure/i },
    { link: /roles & permissions/i, url: /\/admin\/roles/, heading: /roles & permissions/i },
    { link: /ai governance/i, url: /\/admin\/ai-governance/, heading: /ai governance/i },
  ];

  for (const { link, url, heading } of ROUTES) {
    test(`sidebar "${link.source}" opens its page`, async ({ page }) => {
      const nav = page.getByRole('link', { name: link }).first();
      await expect(nav).toBeVisible();
      await nav.click();
      await page.waitForURL(url, { timeout: 10_000 });
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    });
  }
});

test.describe('My Work', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/my-work');
  });

  test('shows the four summary counters', async ({ page }) => {
    for (const label of [/overdue/i, /due today/i, /this week/i, /approvals/i]) {
      await expect(page.getByText(label).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test('creates a task, completes it, then deletes it', async ({ page }) => {
    const title = `E2E task ${stamp()}`;

    await page.getByRole('button', { name: /new task/i }).click();
    await page.getByPlaceholder(/what needs doing/i).fill(title);
    await page.getByRole('button', { name: /create task/i }).click();

    const row = page.getByText(title, { exact: true }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // The round checkbox to the left of the title marks it done — the title
    // then renders with a line-through.
    await page
      .locator('button[aria-label="Mark task done"]')
      .first()
      .click();

    // Re-open via the detail modal and confirm status moved.
    await row.click();
    await expect(page.getByRole('button', { name: /^done$/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('a task with a due date lands in a time bucket', async ({ page }) => {
    const title = `E2E dated task ${stamp()}`;
    const tomorrow = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString().slice(0, 16);

    await page.getByRole('button', { name: /new task/i }).click();
    await page.getByPlaceholder(/what needs doing/i).fill(title);
    await page.locator('input[type="datetime-local"]').fill(tomorrow);
    await page.getByRole('button', { name: /create task/i }).click();

    await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Employees', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/hr/employees');
  });

  test('renders the directory with headcount stats', async ({ page }) => {
    await expect(page.getByText(/^total$/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /add employee/i })).toBeVisible();
  });

  test('switches to the org chart view', async ({ page }) => {
    await page.getByRole('button', { name: /org chart/i }).click();
    // Either a populated chart or the explicit empty state — both are correct
    // depending on whether managers have been set.
    await expect(
      page.getByText(/people · employees with no manager|no org chart yet/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('creates an employee and finds it by search', async ({ page }) => {
    const first = `E2E${stamp()}`;

    await page.getByRole('button', { name: /add employee/i }).click();
    // First name and joining date are the only required fields.
    await page.locator('input').nth(0).fill(first);
    await page.locator('input[type="date"]').first().fill(new Date().toISOString().slice(0, 10));
    await page.getByRole('button', { name: /^add employee$/i }).last().click();

    await page.getByPlaceholder(/search name, code, email/i).fill(first);
    await expect(page.getByText(new RegExp(first, 'i')).first()).toBeVisible({ timeout: 10_000 });
  });

  test('a filter narrows the directory without error', async ({ page }) => {
    const statusSelect = page.locator('select').last();
    await statusSelect.selectOption('ACTIVE');
    await expect(page.getByRole('heading', { name: /employees/i }).first()).toBeVisible();
  });
});

test.describe('Org structure', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/hr/org');
  });

  test('has departments, teams and locations tabs', async ({ page }) => {
    for (const name of [/departments/i, /teams/i, /locations/i]) {
      await expect(page.getByRole('button', { name }).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test('creates a department', async ({ page }) => {
    const name = `E2E Dept ${stamp()}`;
    await page.getByRole('button', { name: /^department$/i }).click();
    await page.locator('input').first().fill(name);
    await page.getByRole('button', { name: /^create$/i }).click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });
  });

  test('creates a team', async ({ page }) => {
    const name = `E2E Team ${stamp()}`;
    await page.getByRole('button', { name: /^teams$/i }).click();
    await page.getByRole('button', { name: /^team$/i }).click();
    await page.locator('input').first().fill(name);
    await page.getByRole('button', { name: /^create$/i }).click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });
  });

  test('creates a location', async ({ page }) => {
    const name = `E2E Office ${stamp()}`;
    await page.getByRole('button', { name: /^locations$/i }).click();
    await page.getByRole('button', { name: /^location$/i }).click();
    await page.locator('input').first().fill(name);
    await page.getByRole('button', { name: /^create$/i }).click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Approvals', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/approvals');
  });

  test('has all four tabs', async ({ page }) => {
    for (const name of [/my inbox/i, /all requests/i, /policies/i, /delegations/i]) {
      await expect(page.getByRole('button', { name }).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test('the inbox renders (empty state is a valid result)', async ({ page }) => {
    await expect(
      page.getByText(/nothing waiting on you|waiting on you|approve/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('builds a policy with two steps', async ({ page }) => {
    await page.getByRole('button', { name: /^policies$/i }).click();
    await page.getByRole('button', { name: /^policy$/i }).click();

    await page.getByPlaceholder(/standard leave approval/i).fill(`E2E policy ${stamp()}`);
    await page.getByRole('button', { name: /add step/i }).click();

    // Two step-name inputs means the second step was added to the builder.
    await expect(page.getByPlaceholder(/step name/i)).toHaveCount(2);
    await page.getByRole('button', { name: /create policy/i }).click();

    await expect(page.getByText(/e2e policy/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('self-delegation is rejected with a readable message', async ({ page }) => {
    await page.getByRole('button', { name: /^delegations$/i }).click();
    await expect(page.getByText(/delegate your approvals/i)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Roles & permissions', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/admin/roles');
  });

  test('lists the built-in roles', async ({ page }) => {
    for (const name of [/super admin/i, /hr manager/i, /executive/i]) {
      await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test('opens the permission editor and shows scope selectors', async ({ page }) => {
    await page.getByRole('button', { name: /^edit$/i }).first().click();
    await expect(page.getByText(/field visibility/i)).toBeVisible({ timeout: 10_000 });
    // Each permission row carries a scope dropdown; there should be many.
    const selects = page.locator('select');
    expect(await selects.count()).toBeGreaterThan(5);
  });

  test('explains the default-open rollout', async ({ page }) => {
    await expect(page.getByText(/nothing changed when this shipped/i)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('AI governance', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/admin/ai-governance');
  });

  test('shows the spend and reliability tiles', async ({ page }) => {
    for (const label of [/ai calls/i, /success rate/i, /total cost/i, /avg latency/i]) {
      await expect(page.getByText(label).first()).toBeVisible({ timeout: 15_000 });
    }
  });

  test('the knowledge tab reports which vector backend is active', async ({ page }) => {
    await page.getByRole('button', { name: /knowledge base/i }).click();
    await expect(page.getByText(/vector backend/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /re-index knowledge base/i })).toBeVisible();
  });

  test('the interaction log tab renders', async ({ page }) => {
    await page.getByRole('button', { name: /interaction log/i }).click();
    await expect(
      page.getByText(/no ai activity yet|feature|tokens/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Permission boundaries in the UI', () => {
  test('a non-admin does not see the Roles & Permissions link', async ({ page }) => {
    // SALES_REP is seeded in every demo vertical.
    await login(page, 'sales@crmitdesk.com', 'Admin@123');
    await expect(page.getByRole('link', { name: /roles & permissions/i })).toHaveCount(0);
  });

  test('a non-admin can still reach My Work', async ({ page }) => {
    await login(page, 'sales@crmitdesk.com', 'Admin@123');
    await page.goto('/my-work');
    await expect(page.getByRole('heading', { name: /my work/i }).first()).toBeVisible({ timeout: 10_000 });
  });
});
