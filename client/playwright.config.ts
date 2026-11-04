import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config for the lead follow-up / pipeline-stage / custom-module /
 * demo-vertical features. Assumes the app is already running with a
 * *seeded* database — these tests log in as the seeded techcorp demo admin
 * (see server/src/utils/seedDemoData.ts) rather than creating an org from
 * scratch, so run `npm run db:seed` (server) against your test DB first.
 *
 * Local run:
 *   1. server:  npm run dev   (or a deployed API — see E2E_BASE_URL below)
 *   2. client:  npm run dev
 *   3. client:  npm run test:e2e
 *
 * CI / against a deployed environment: set E2E_BASE_URL to the frontend URL
 * and E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD if you're not using the default
 * seeded techcorp credentials.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false, // several tests mutate shared pipeline/lead data — safer sequential
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
