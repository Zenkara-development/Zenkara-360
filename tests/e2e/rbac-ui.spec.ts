/**
 * rbac-ui.spec.ts — Role-Based Access Control (UI-level)
 *
 * rbac.spec.ts already verifies the backend enforces 403s per role at the API
 * level. This file verifies the *sidebar* actually hides nav items the
 * current role isn't permitted to use, rather than showing every link to
 * every role and relying solely on the API to block the click-through.
 *
 * The allowed/blocked lists below mirror the `roles` arrays on each nav item
 * in client/src/shared/layouts/AppLayout.tsx, which in turn mirror the
 * backend's requireRole() groups (see server/src/middleware/authenticate.ts
 * and rbac.spec.ts).
 *
 * Seeded credentials (all password: Admin@123):
 *   admin@crmitdesk.com       SUPER_ADMIN
 *   crm@crmitdesk.com         CRM_MANAGER
 *   sales@crmitdesk.com       SALES_REP
 *   itmanager@crmitdesk.com   IT_MANAGER
 *   itagent@crmitdesk.com     IT_AGENT
 */

import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

const CREDS = {
  SUPER_ADMIN: { email: 'admin@crmitdesk.com',     password: 'Admin@123' },
  IT_MANAGER:  { email: 'itmanager@crmitdesk.com', password: 'Admin@123' },
  CRM_MANAGER: { email: 'crm@crmitdesk.com',       password: 'Admin@123' },
  IT_AGENT:    { email: 'itagent@crmitdesk.com',   password: 'Admin@123' },
  SALES_REP:   { email: 'sales@crmitdesk.com',     password: 'Admin@123' },
} as const;

type Role = keyof typeof CREDS;

const NAV_VISIBILITY: Record<Role, { allowed: string[]; blocked: string[] }> = {
  SUPER_ADMIN: {
    allowed: [
      'Dashboard', 'Inbox', 'Automation', 'Portal', 'AI Builder', 'AI Studio',
      'Contacts', 'Leads', 'Pipeline', 'Quotes', 'Campaigns',
      'Tickets', 'Categories', 'Knowledge Base', 'Assets', 'Changes',
      'Users', 'Analytics', 'Reports', 'Import CSV', 'Custom Fields', 'Branding', 'Audit Log', 'API Keys',
      'Slack', 'Teams', 'Billing', '2FA Security',
    ],
    blocked: [],
  },
  IT_MANAGER: {
    allowed: [
      'Dashboard', 'Inbox', 'Automation', 'Portal', 'AI Builder', 'AI Studio',
      'Tickets', 'Categories', 'Knowledge Base', 'Assets', 'Changes',
      'Users', 'Analytics', 'Reports', 'Custom Fields', 'Branding', 'Audit Log',
      'Slack', 'Teams', '2FA Security',
    ],
    blocked: ['Contacts', 'Leads', 'Pipeline', 'Quotes', 'Campaigns', 'Import CSV', 'API Keys', 'Billing'],
  },
  CRM_MANAGER: {
    allowed: [
      'Dashboard', 'Inbox', 'Automation', 'AI Builder', 'AI Studio',
      'Contacts', 'Leads', 'Pipeline', 'Quotes', 'Campaigns',
      'Tickets', 'Categories', 'Knowledge Base',
      'Users', 'Analytics', 'Reports', 'Import CSV', 'Custom Fields', 'Branding', 'Audit Log', '2FA Security',
    ],
    blocked: ['Portal', 'Assets', 'Changes', 'API Keys', 'Slack', 'Teams', 'Billing'],
  },
  IT_AGENT: {
    allowed: [
      'Dashboard', 'Inbox', 'Tickets', 'Categories', 'Knowledge Base', 'Assets', 'Changes',
      'Custom Fields', 'Branding', '2FA Security',
    ],
    blocked: [
      'Automation', 'Portal', 'AI Builder', 'AI Studio',
      'Contacts', 'Leads', 'Pipeline', 'Quotes', 'Campaigns',
      'Users', 'Analytics', 'Reports', 'Import CSV', 'Audit Log', 'API Keys',
      'Slack', 'Teams', 'Billing',
    ],
  },
  SALES_REP: {
    allowed: [
      'Dashboard', 'Inbox', 'Contacts', 'Leads', 'Pipeline', 'Quotes', 'Campaigns',
      'Tickets', 'Categories', 'Knowledge Base', 'Custom Fields', 'Branding', '2FA Security',
    ],
    blocked: [
      'Automation', 'Portal', 'AI Builder', 'AI Studio',
      'Assets', 'Changes',
      'Users', 'Analytics', 'Reports', 'Import CSV', 'Audit Log', 'API Keys',
      'Slack', 'Teams', 'Billing',
    ],
  },
};

test.describe('RBAC — Sidebar visibility per role', () => {
  for (const role of Object.keys(CREDS) as Role[]) {
    test(`${role} sees only permitted nav items`, async ({ page }) => {
      const { email, password } = CREDS[role];
      await login(page, email, password);

      const sidebar = page.locator('aside');
      await expect(sidebar).toBeVisible();

      for (const label of NAV_VISIBILITY[role].allowed) {
        await expect(
          sidebar.getByRole('link', { name: label, exact: true }),
          `${role} should see "${label}" in the sidebar`
        ).toBeVisible();
      }
      for (const label of NAV_VISIBILITY[role].blocked) {
        await expect(
          sidebar.getByRole('link', { name: label, exact: true }),
          `${role} should NOT see "${label}" in the sidebar`
        ).not.toBeVisible();
      }
    });
  }
});
