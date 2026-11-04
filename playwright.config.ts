import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  globalSetup: './tests/global-setup.ts',
  testDir: './tests/e2e',
  // fullyParallel stays false: within one file, tests still run in the
  // guaranteed order Playwright picks them up in. Several files rely on that
  // (e.g. knowledge-base.spec.ts creates → edits → deletes the same article
  // across sequential tests). Cross-file fixture name collisions were audited
  // and fixed (see tests/global-setup.ts comments), so different *files* can
  // now safely run concurrently across workers.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // A single local retry absorbs the dev-stack cold-start / ts-node-dev
  // respawn flake (server not fully up when the first requests of a run
  // land — see global-setup.ts's waitForUrl) without masking real app bugs,
  // since a genuine bug fails again on retry and still gets reported.
  retries: process.env.CI ? 2 : 1,
  // 2 workers locally: the dev stack (Vite + API server + Postgres, all on
  // one machine) couldn't keep up with 4 — pages were timing out on load
  // during the test run itself, not because of app bugs. Raise this back up
  // only if you've confirmed the dev servers can actually serve that much
  // concurrent traffic (e.g. a production build instead of Vite's dev/HMR
  // server, and a larger Postgres connection pool).
  workers: process.env.CI ? 4 : 2,
  reporter: [['html', { outputFolder: 'tests/playwright-report' }], ['line']],

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Expect the dev servers to already be running via `npm run dev`
  // To auto-start them, uncomment the webServer block below:
  // webServer: [
  //   { command: 'npm run dev --workspace=server', url: 'http://localhost:4000/health', reuseExistingServer: true },
  //   { command: 'npm run dev --workspace=client', url: 'http://localhost:5173', reuseExistingServer: true },
  // ],
});
