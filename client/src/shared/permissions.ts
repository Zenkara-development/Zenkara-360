/**
 * Client-side mirror of the server's role groups.
 *
 * These MUST stay identical to server/src/middleware/authenticate.ts. They are
 * duplicated rather than fetched because the client needs them synchronously,
 * before the first render, to decide whether a query is even worth firing.
 *
 * This is a UX layer, never a security boundary — the server re-checks every
 * request with requireRole(). The point here is that the client should not ask
 * questions it already knows it isn't allowed to ask: a request that is certain
 * to 403 is a wasted round-trip, a red line in the network tab, and (before the
 * interceptor fix) a "You don't have permission" toast the user never provoked.
 *
 * The audit that motivated this found every role except SUPER_ADMIN firing
 * forbidden reads on the dashboard alone at login — 4 for IT_AGENT and EMPLOYEE,
 * 3 for IT_MANAGER, 2 for SALES_REP, 1 for CRM_MANAGER — plus, for EMPLOYEE,
 * one on every single page from the sidebar's custom-modules lookup.
 */

export type Role =
  | 'SUPER_ADMIN'
  | 'IT_MANAGER'
  | 'CRM_MANAGER'
  | 'IT_AGENT'
  | 'SALES_REP'
  | 'EMPLOYEE'
  | 'PLATFORM_ADMIN';

/** Org owner only. */
export const ADMIN = ['SUPER_ADMIN'] as const;
/** All three manager-level roles. */
export const MANAGERS = ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER'] as const;
/** IT-side managers. */
export const IT_MANAGERS = ['SUPER_ADMIN', 'IT_MANAGER'] as const;
/** CRM-side managers. */
export const CRM_MANAGERS = ['SUPER_ADMIN', 'CRM_MANAGER'] as const;
/** IT workers: agents + their managers. */
export const IT_STAFF = ['SUPER_ADMIN', 'IT_MANAGER', 'IT_AGENT'] as const;
/** CRM workers: reps + their managers. */
export const CRM_STAFF = ['SUPER_ADMIN', 'CRM_MANAGER', 'SALES_REP'] as const;
/** Every role except EMPLOYEE. */
export const ALL_STAFF = ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER', 'IT_AGENT', 'SALES_REP'] as const;
/** Every authenticated org role. */
export const ALL_USERS = ['SUPER_ADMIN', 'IT_MANAGER', 'CRM_MANAGER', 'IT_AGENT', 'SALES_REP', 'EMPLOYEE'] as const;

/** Is `role` in `group`? Undefined role (still loading) is treated as "no". */
export function inGroup(role: string | undefined | null, group: readonly string[]): boolean {
  return !!role && group.includes(role);
}

/**
 * Named capabilities, each one corresponding to a real guard on the server.
 * Pages should read these rather than hand-rolling `role === 'SUPER_ADMIN' ||
 * role === 'IT_MANAGER'` comparisons, which is how the two sides drifted apart
 * in the first place.
 *
 * Naming follows the endpoint being protected, so a reader can check it against
 * the route file without guessing.
 */
export const can = {
  /* ── CRM ── */
  readCrm:            (r?: string | null) => inGroup(r, CRM_STAFF),        // /crm/contacts|leads|deals|accounts|pipelines
  readCrmReports:     (r?: string | null) => inGroup(r, CRM_MANAGERS),     // /crm/deals/reports, /analytics/crm
  readQuotesInvoices: (r?: string | null) => inGroup(r, CRM_STAFF),        // /quotes, /invoices
  readCampaigns:      (r?: string | null) => inGroup(r, CRM_STAFF),        // /campaigns

  /* ── IT Desk ── */
  readTicketReports:  (r?: string | null) => inGroup(r, IT_MANAGERS),      // /itdesk/tickets/reports, /analytics/tickets
  readAssets:         (r?: string | null) => inGroup(r, IT_STAFF),         // /itdesk/assets
  readSla:            (r?: string | null) => inGroup(r, IT_STAFF),         // /itdesk/sla-policies
  readChangeRequests: (r?: string | null) => inGroup(r, IT_STAFF),         // /change-requests
  editTickets:        (r?: string | null) => inGroup(r, IT_STAFF),         // PATCH /itdesk/tickets/:id
  assignTickets:      (r?: string | null) => inGroup(r, IT_MANAGERS),      // PATCH /itdesk/tickets/:id/assign

  /* ── Shared record furniture (staff-only on the server) ── */
  readStaffRecords:   (r?: string | null) => inGroup(r, ALL_STAFF),        // /tags, /schedules, /comments, /attachments,
                                                                          // /templates/*, /custom-modules, /ai/actions,
                                                                          // /custom-fields/values, /inbox/conversations

  /* ── HR ── */
  readHrAdmin:        (r?: string | null) => inGroup(r, MANAGERS),         // /hr/attendance (all), /hr/payroll/runs|structures
  approveLeave:       (r?: string | null) => inGroup(r, MANAGERS),         // /hr/leave/requests/:id/approve|reject
  manageOrgStructure: (r?: string | null) => inGroup(r, MANAGERS),         // POST/PATCH /hr/org/*
  managePeople:       (r?: string | null) => inGroup(r, MANAGERS),         // POST /people, grant/revoke login

  /* ── Admin / platform config ── */
  readAdmin:          (r?: string | null) => inGroup(r, MANAGERS),         // /admin/users, /audit-logs, /jobs, /permissions/*
  readAnalytics:      (r?: string | null) => inGroup(r, MANAGERS),         // /analytics/overview
  readCsat:           (r?: string | null) => inGroup(r, IT_MANAGERS),      // /csat, /csat/stats
  readPortalUsers:    (r?: string | null) => inGroup(r, IT_MANAGERS),      // /portal-users
  readInboxSettings:  (r?: string | null) => inGroup(r, IT_MANAGERS),      // /inbox/settings
  readWorkflows:      (r?: string | null) => inGroup(r, MANAGERS),         // /workflows
  readAiConfig:       (r?: string | null) => inGroup(r, MANAGERS),         // /ai/rules, /ai/studio/*, /knowledge/*
  readStorage:        (r?: string | null) => inGroup(r, MANAGERS),         // /storage/status
  manageStorage:      (r?: string | null) => inGroup(r, ADMIN),            // /storage/google/connect, /storage/s3/*
  readBilling:        (r?: string | null) => inGroup(r, ADMIN),            // /billing/subscription
  readApiKeys:        (r?: string | null) => inGroup(r, ADMIN),            // /api-keys
  manageBranding:     (r?: string | null) => inGroup(r, MANAGERS),         // PUT /branding
  manageTemplates:    (r?: string | null) => inGroup(r, ALL_STAFF),        // /templates/*
  manageCustomFields: (r?: string | null) => inGroup(r, MANAGERS),         // POST/PATCH/DELETE /custom-fields
  readApprovalPolicies: (r?: string | null) => inGroup(r, MANAGERS),       // /approvals/policies
  readRoles:          (r?: string | null) => inGroup(r, MANAGERS),         // /permissions/roles, /permissions/catalog
};
