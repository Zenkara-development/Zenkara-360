/**
 * Seeds (or re-seeds) the public demo/showcase organizations — one per
 * industry vertical (see VERTICALS below), each with its own slug, its own
 * "Try Demo" login, and data flavored for that industry (account/contact
 * names, pipeline stage names, ticket topics, one example custom module).
 * Re-runnable per vertical: deletes the existing org for that slug (cascade)
 * plus any orphaned seed users, then recreates everything.
 *
 * This is the single source of truth for demo data — used by:
 *   - prisma/seed.ts (the `npm run db:seed` / `prisma db seed` CLI command)
 *   - POST /api/demo/reset (the nightly automated reset, see modules/demo)
 *   - POST /api/auth/demo-login?vertical=<slug> (see auth.controller.ts)
 *
 * Uses the app's shared Prisma client (utils/prisma.ts) rather than creating
 * its own, since this now also runs in-process inside the live server.
 */

import { UserRole, LeadStatus, DealStatus, TicketPriority, TicketStatus, ArticleStatus, ActivityType, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { prisma } from './prisma';

async function hash(plain: string) {
  return bcrypt.hash(plain, 10);
}
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}
function daysAgo(n: number): Date {
  return daysFromNow(-n);
}
/**
 * A contact's date of birth, expressed as "N days from today" so at least
 * one seeded contact per vertical turns 30-something *today* — the
 * DATE_FIELD_REACHED "Birthday Wishes" rule (see buildOrg below) then fires
 * immediately via the workflow's "Run now" test button rather than only
 * ever being demonstrable by waiting for a real birthday to occur.
 */
function birthdayOn(daysFromToday: number, ageYears: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  d.setUTCFullYear(d.getUTCFullYear() - ageYears);
  return d.toISOString();
}

// ─── Vertical content packs ─────────────────────────────────────────────────

interface AccountSeed { name: string; industry: string; website: string; phone: string; address: string }
interface ContactSeed { name: string; email: string; phone: string; jobTitle: string; accountIdx: number; source: string; dateOfBirth?: string }
interface DealSeed { title: string; value: number; stage: string; probability: number; contactIdx: number; accountIdx: number; status: DealStatus; closeDays: number }
interface LeadSeed { contactIdx: number; source: string; status: LeadStatus; notes: string; aiScore: number; aiScoreReason: string; followUps: { type: ActivityType; title: string; body: string; dueDays: number; done: boolean }[] }
interface TicketSeed { title: string; body: string; category: string; priority: TicketPriority; status: TicketStatus }
interface KbSeed { title: string; body: string; category: string }
interface CustomModuleFieldSeed { label: string; fieldKey: string; fieldType: string; options?: string[]; required?: boolean; isPrimary?: boolean }

interface VerticalPreset {
  slug: string;
  orgName: string;
  industry: string;
  primaryColor: string;
  supportEmail: string;
  /** ISO 4217. Omitted = USD, which is what every pre-existing vertical uses. */
  currency?: string;
  /** IANA zone. Omitted = UTC, matching the pre-existing verticals. */
  timezone?: string;
  stages: { label: string; color: string; probability: number; isWon?: boolean; isLost?: boolean }[];
  accounts: AccountSeed[];
  contacts: ContactSeed[];
  deals: DealSeed[];
  leads: LeadSeed[];
  tickets: TicketSeed[];
  kb: KbSeed[];
  customModule: { name: string; icon: string; description: string; fields: CustomModuleFieldSeed[]; records: Record<string, unknown>[] };
  // The vertical-flavored half of the date-driven follow-up automations
  // (see utils/dateAutomation.ts) — built on customModule's own DATE field.
  // Every vertical additionally gets an identical, unconditional "Birthday
  // Wishes" rule against Contact.dateOfBirth — that one needs no per-vertical
  // data, so it isn't part of this preset.
  dateAutomation: { dateField: string; offsetDays: number; name: string; description: string; message: string };
}

const STAGE_COLORS = { p1: '#6366f1', p2: '#8b5cf6', p3: '#f59e0b', won: '#10b981', lost: '#ef4444' };

function stages(labels: [string, string, string, string]) {
  return [
    { label: labels[0], color: STAGE_COLORS.p1, probability: 20 },
    { label: labels[1], color: STAGE_COLORS.p2, probability: 45 },
    { label: labels[2], color: STAGE_COLORS.p3, probability: 70 },
    { label: labels[3], color: '#0ea5e9', probability: 90 },
    { label: 'Closed Won', color: STAGE_COLORS.won, probability: 100, isWon: true },
    { label: 'Closed Lost', color: STAGE_COLORS.lost, probability: 0, isLost: true },
  ];
}

export const VERTICALS: VerticalPreset[] = [
  {
    slug: 'techcorp', orgName: 'TechCorp Solutions', industry: 'Technology / SaaS', primaryColor: '#4F46E5', supportEmail: 'support@techcorp.io',
    // Keep "Prospecting" / "Proposal" / "Negotiation" as literal stage names —
    // tests/e2e/deals.spec.ts:13-15 asserts these exact strings are visible
    // on the kanban board (this is the org tests/e2e/ logs into; see the
    // domainFor() comment above for the same constraint on login emails).
    stages: stages(['Prospecting', 'Demo Scheduled', 'Proposal', 'Negotiation']),
    accounts: [
      { name: 'Acme Corporation', industry: 'Manufacturing', website: 'https://acme.example.com', phone: '+1-555-0100', address: '123 Main St, Springfield, IL' },
      { name: 'Globex Industries', industry: 'Technology', website: 'https://globex.example.com', phone: '+1-555-0200', address: '456 Silicon Ave, San Francisco, CA' },
      { name: 'Initech Ltd', industry: 'Finance', website: 'https://initech.example.com', phone: '+1-555-0300', address: '789 Wall St, New York, NY' },
    ],
    contacts: [
      { name: 'Alice Whitman', email: 'alice@acme.example.com', phone: '+1-555-1001', jobTitle: 'CTO', accountIdx: 0, source: 'Referral', dateOfBirth: birthdayOn(0, 41) },
      { name: 'Bob Lumbly', email: 'bob@acme.example.com', phone: '+1-555-1002', jobTitle: 'Procurement Manager', accountIdx: 0, source: 'Cold Email', dateOfBirth: birthdayOn(140, 36) },
      { name: 'Carol Simmons', email: 'carol@globex.example.com', phone: '+1-555-2001', jobTitle: 'VP Engineering', accountIdx: 1, source: 'Conference' },
      { name: 'Daniel Park', email: 'daniel@globex.example.com', phone: '+1-555-2002', jobTitle: 'IT Director', accountIdx: 1, source: 'LinkedIn' },
      { name: 'Eva Martinez', email: 'eva@initech.example.com', phone: '+1-555-3001', jobTitle: 'CFO', accountIdx: 2, source: 'Referral' },
      { name: 'Frank Torres', email: 'frank@initech.example.com', phone: '+1-555-3002', jobTitle: 'Operations Lead', accountIdx: 2, source: 'Website' },
    ],
    deals: [
      { title: 'Acme ERP Implementation', value: 85000, stage: 'Negotiation', probability: 70, contactIdx: 0, accountIdx: 0, status: DealStatus.OPEN, closeDays: 45 },
      // Stage must be one of this pipeline's own labels — 'Trial' was not, so
      // this deal previously rendered in no kanban column at all. 45% is the
      // configured probability for 'Demo Scheduled'.
      { title: 'Acme Cloud Migration', value: 42000, stage: 'Demo Scheduled', probability: 45, contactIdx: 1, accountIdx: 0, status: DealStatus.OPEN, closeDays: 20 },
      { title: 'Globex Platform Licence', value: 120000, stage: 'Closed Won', probability: 100, contactIdx: 2, accountIdx: 1, status: DealStatus.WON, closeDays: -10 },
      { title: 'Globex Support Contract', value: 24000, stage: 'Demo Scheduled', probability: 20, contactIdx: 3, accountIdx: 1, status: DealStatus.OPEN, closeDays: 60 },
      { title: 'Initech Analytics Suite', value: 67000, stage: 'Prospecting', probability: 20, contactIdx: 4, accountIdx: 2, status: DealStatus.OPEN, closeDays: 90 },
      { title: 'Initech Data Warehouse', value: 150000, stage: 'Closed Lost', probability: 0, contactIdx: 5, accountIdx: 2, status: DealStatus.LOST, closeDays: -5 },
    ],
    leads: [
      { contactIdx: 0, source: 'Website', status: LeadStatus.QUALIFIED, notes: 'Very interested in ERP module. Requested full demo.', aiScore: 87, aiScoreReason: 'Senior decision-maker, enterprise account', followUps: [
        { type: ActivityType.CALL, title: 'Discovery call', body: 'Walk through current stack and pain points.', dueDays: -8, done: true },
        { type: ActivityType.TASK, title: 'Send case study', body: 'Share Globex case study before next call.', dueDays: 2, done: false },
      ] },
      { contactIdx: 2, source: 'Conference', status: LeadStatus.CONTACTED, notes: 'Met at TechSummit 2024. Wants follow-up call next week.', aiScore: 72, aiScoreReason: 'Engaged at event, large company', followUps: [
        { type: ActivityType.EMAIL, title: 'Send follow-up deck', body: 'Recap of booth conversation + pricing one-pager.', dueDays: -2, done: true },
        { type: ActivityType.CALL, title: 'Follow-up call', body: 'Confirm timeline and stakeholders.', dueDays: 4, done: false },
      ] },
      { contactIdx: 4, source: 'Referral', status: LeadStatus.QUALIFIED, notes: 'Referred by Acme. Budget confirmed at $60K+.', aiScore: 91, aiScoreReason: 'Referral source, confirmed budget', followUps: [
        { type: ActivityType.MEETING, title: 'Budget alignment meeting', body: 'Confirm scope vs. confirmed budget.', dueDays: 3, done: false },
      ] },
      { contactIdx: 5, source: 'Cold Email', status: LeadStatus.NEW, notes: 'Replied with mild interest, wants pricing.', aiScore: 45, aiScoreReason: 'Cold outreach, unconfirmed budget', followUps: [
        { type: ActivityType.EMAIL, title: 'Send pricing sheet', body: 'Standard tiered pricing PDF.', dueDays: 1, done: false },
      ] },
      { contactIdx: 3, source: 'LinkedIn', status: LeadStatus.CONTACTED, notes: 'IT Director, evaluating vendors.', aiScore: 63, aiScoreReason: 'Multiple touchpoints, mid-size company', followUps: [
        { type: ActivityType.CALL, title: 'Vendor comparison call', body: 'Address competitor comparison questions.', dueDays: 5, done: false },
      ] },
    ],
    tickets: [
      { title: 'Laptop not turning on after Windows update', body: 'Dell XPS 15 stopped booting after last night\'s update. Blue screen 0x0000007E.', category: 'Hardware', priority: TicketPriority.HIGH, status: TicketStatus.IN_PROGRESS },
      { title: 'Cannot connect to company VPN', body: 'Authentication failed connecting to VPN from home. Blocking work completely.', category: 'Network & Connectivity', priority: TicketPriority.CRITICAL, status: TicketStatus.OPEN },
      { title: 'Need access to Salesforce sandbox', body: 'Please grant read/write access for testing the new integration.', category: 'Access & Permissions', priority: TicketPriority.MEDIUM, status: TicketStatus.PENDING },
      { title: 'Printer on 3rd floor offline', body: 'HP LaserJet has shown offline since Monday. Multiple users affected.', category: 'Hardware', priority: TicketPriority.MEDIUM, status: TicketStatus.RESOLVED },
      { title: 'Microsoft Teams crashes on startup', body: 'Teams crashes immediately after launching on MacBook Pro M2.', category: 'Software', priority: TicketPriority.HIGH, status: TicketStatus.IN_PROGRESS },
      { title: 'Invoice discrepancy in billing portal', body: 'November invoice shows $4,500 but we were quoted $3,900.', category: 'Billing & Accounts', priority: TicketPriority.CRITICAL, status: TicketStatus.OPEN },
    ],
    kb: [
      { title: 'How to connect to the company VPN', body: 'Open Cisco AnyConnect, enter vpn.techcorp.io, sign in, complete MFA.', category: 'Network & Connectivity' },
      { title: 'Setting up Microsoft 365 on a new device', body: 'Visit office.com, sign in, Install Office.', category: 'Software' },
      { title: 'Common printer issues and fixes', body: 'Offline: Settings > Printers > Use Printer Online. Paper jam: pull in direction of travel only.', category: 'Hardware' },
    ],
    customModule: {
      name: 'API Usage Logs', icon: 'Activity', description: 'Per-customer API call volume synced from the metering service.',
      fields: [
        { label: 'Customer', fieldKey: 'customer', fieldType: 'TEXT', required: true, isPrimary: true },
        { label: 'Plan', fieldKey: 'plan', fieldType: 'DROPDOWN', options: ['Free', 'Pro', 'Enterprise'], required: true },
        { label: 'Calls This Month', fieldKey: 'calls_this_month', fieldType: 'NUMBER', required: true },
        { label: 'Overage Flag', fieldKey: 'overage', fieldType: 'BOOLEAN' },
        { label: 'Contract Renewal Date', fieldKey: 'renewal_date', fieldType: 'DATE' },
      ],
      records: [
        { customer: 'Acme Corporation', plan: 'Enterprise', calls_this_month: 482_311, overage: false, renewal_date: daysFromNow(3).toISOString() },
        { customer: 'Globex Industries', plan: 'Pro', calls_this_month: 91_204, overage: true, renewal_date: daysFromNow(45).toISOString() },
        { customer: 'Initech Ltd', plan: 'Pro', calls_this_month: 12_880, overage: false },
      ],
    },
    dateAutomation: {
      dateField: 'renewal_date', offsetDays: -3,
      name: 'Contract Renewal Reminder',
      description: 'Notifies the CRM manager 3 days before an API customer\'s contract renewal date.',
      message: 'A customer\'s contract renews in 3 days — confirm the renewal or flag churn risk.',
    },
  },
  {
    slug: 'meridian-health', orgName: 'Meridian Health Partners', industry: 'Healthcare', primaryColor: '#0891B2', supportEmail: 'support@meridianhealth.io',
    stages: stages(['Inquiry', 'Needs Assessment', 'Proposal Sent', 'Contract Review']),
    accounts: [
      { name: 'Lakeside Medical Group', industry: 'Multi-specialty Clinic', website: 'https://lakesidemed.example.com', phone: '+1-555-0410', address: '200 Lakeside Dr, Austin, TX' },
      { name: 'Summit Regional Hospital', industry: 'Hospital', website: 'https://summitregional.example.com', phone: '+1-555-0420', address: '88 Summit Rd, Denver, CO' },
      { name: 'Harborview Urgent Care', industry: 'Urgent Care', website: 'https://harborviewuc.example.com', phone: '+1-555-0430', address: '14 Harbor Blvd, Seattle, WA' },
    ],
    contacts: [
      { name: 'Dr. Priya Nair', email: 'priya.nair@lakesidemed.example.com', phone: '+1-555-4101', jobTitle: 'Medical Director', accountIdx: 0, source: 'Referral', dateOfBirth: birthdayOn(0, 47) },
      { name: 'Marcus Webb', email: 'marcus.webb@lakesidemed.example.com', phone: '+1-555-4102', jobTitle: 'Practice Administrator', accountIdx: 0, source: 'Website', dateOfBirth: birthdayOn(95, 33) },
      { name: 'Dr. Elena Ruiz', email: 'elena.ruiz@summitregional.example.com', phone: '+1-555-4201', jobTitle: 'CMIO', accountIdx: 1, source: 'Conference' },
      { name: 'Tom Bradley', email: 'tom.bradley@summitregional.example.com', phone: '+1-555-4202', jobTitle: 'IT Director', accountIdx: 1, source: 'LinkedIn' },
      { name: 'Dr. Aisha Bello', email: 'aisha.bello@harborviewuc.example.com', phone: '+1-555-4301', jobTitle: 'Owner-Physician', accountIdx: 2, source: 'Referral' },
      { name: 'Greg Simms', email: 'greg.simms@harborviewuc.example.com', phone: '+1-555-4302', jobTitle: 'Office Manager', accountIdx: 2, source: 'Cold Call' },
    ],
    deals: [
      { title: 'Lakeside Patient Records Platform', value: 96000, stage: 'Contract Review', probability: 70, contactIdx: 0, accountIdx: 0, status: DealStatus.OPEN, closeDays: 30 },
      { title: 'Lakeside Front-Desk Rollout', value: 21000, stage: 'Proposal Sent', probability: 45, contactIdx: 1, accountIdx: 0, status: DealStatus.OPEN, closeDays: 25 },
      { title: 'Summit Regional Enterprise Deployment', value: 210000, stage: 'Closed Won', probability: 100, contactIdx: 2, accountIdx: 1, status: DealStatus.WON, closeDays: -14 },
      { title: 'Summit Regional Helpdesk Add-on', value: 38000, stage: 'Needs Assessment', probability: 20, contactIdx: 3, accountIdx: 1, status: DealStatus.OPEN, closeDays: 60 },
      { title: 'Harborview Urgent Care Starter Bundle', value: 15500, stage: 'Inquiry', probability: 20, contactIdx: 4, accountIdx: 2, status: DealStatus.OPEN, closeDays: 40 },
      { title: 'Harborview Billing Integration', value: 27000, stage: 'Closed Lost', probability: 0, contactIdx: 5, accountIdx: 2, status: DealStatus.LOST, closeDays: -6 },
    ],
    leads: [
      { contactIdx: 0, source: 'Referral', status: LeadStatus.QUALIFIED, notes: 'Referred by a partner clinic. Wants HIPAA compliance details.', aiScore: 85, aiScoreReason: 'Referral, clinical decision-maker', followUps: [
        { type: ActivityType.CALL, title: 'HIPAA compliance call', body: 'Walk through BAA and audit-log capabilities.', dueDays: -5, done: true },
        { type: ActivityType.TASK, title: 'Send compliance packet', body: 'HIPAA + SOC2 documentation.', dueDays: 2, done: false },
      ] },
      { contactIdx: 2, source: 'Conference', status: LeadStatus.CONTACTED, notes: 'Met at HIMSS. Evaluating for enterprise rollout.', aiScore: 78, aiScoreReason: 'Enterprise account, clinical IT lead', followUps: [
        { type: ActivityType.MEETING, title: 'Technical deep-dive', body: 'EHR integration walkthrough with IT team.', dueDays: 6, done: false },
      ] },
      { contactIdx: 4, source: 'Referral', status: LeadStatus.QUALIFIED, notes: 'Owner-physician, fast decision cycle expected.', aiScore: 80, aiScoreReason: 'Owner-operator, referral source', followUps: [
        { type: ActivityType.CALL, title: 'Pricing discussion', body: 'Confirm starter bundle pricing.', dueDays: 1, done: false },
      ] },
      { contactIdx: 5, source: 'Cold Call', status: LeadStatus.UNQUALIFIED, notes: 'Budget below minimum for this cycle.', aiScore: 22, aiScoreReason: 'Budget constraint', followUps: [] },
      { contactIdx: 1, source: 'Website', status: LeadStatus.NEW, notes: 'Downloaded pricing guide from website.', aiScore: 50, aiScoreReason: 'Inbound, unconfirmed budget', followUps: [
        { type: ActivityType.EMAIL, title: 'Intro email', body: 'Send intro + book discovery call.', dueDays: 1, done: false },
      ] },
    ],
    tickets: [
      { title: 'EHR workstation frozen mid-charting', body: 'Nurse station 3 workstation froze while charting a patient visit. Needs urgent restart support.', category: 'Hardware', priority: TicketPriority.CRITICAL, status: TicketStatus.IN_PROGRESS },
      { title: 'Cannot access patient portal remotely', body: 'VPN authentication failing for on-call physician.', category: 'Network & Connectivity', priority: TicketPriority.HIGH, status: TicketStatus.OPEN },
      { title: 'New nurse needs system access', body: 'New hire starting Monday needs EHR + scheduling access provisioned.', category: 'Access & Permissions', priority: TicketPriority.MEDIUM, status: TicketStatus.PENDING },
      { title: 'Label printer in lab offline', body: 'Specimen label printer showing offline since this morning.', category: 'Hardware', priority: TicketPriority.MEDIUM, status: TicketStatus.RESOLVED },
      { title: 'Scheduling software crashing on check-in', body: 'Front desk app crashes when checking in patients with hyphenated names.', category: 'Software', priority: TicketPriority.HIGH, status: TicketStatus.IN_PROGRESS },
      { title: 'Insurance billing discrepancy', body: 'Claim amount doesn\'t match the pre-authorization on file.', category: 'Billing & Accounts', priority: TicketPriority.CRITICAL, status: TicketStatus.OPEN },
    ],
    kb: [
      { title: 'Resetting an EHR workstation safely', body: 'Hold power 10s, wait 30s, restart. Chart drafts auto-save every 60s.', category: 'Hardware' },
      { title: 'Provisioning access for new clinical staff', body: 'Submit under Access & Permissions with role, department, and supervisor approval.', category: 'Access & Permissions' },
      { title: 'VPN setup for remote/on-call physicians', body: 'Install Cisco AnyConnect, connect to vpn.meridianhealth.io, complete MFA.', category: 'Network & Connectivity' },
    ],
    customModule: {
      name: 'Patient Referrals', icon: 'Stethoscope', description: 'Inbound referrals synced from partner clinics\' referral system.',
      fields: [
        { label: 'Referring Provider', fieldKey: 'referring_provider', fieldType: 'TEXT', required: true, isPrimary: true },
        { label: 'Patient Initials', fieldKey: 'patient_initials', fieldType: 'TEXT', required: true },
        { label: 'Procedure', fieldKey: 'procedure', fieldType: 'TEXT', required: true },
        { label: 'Referral Date', fieldKey: 'referral_date', fieldType: 'DATE' },
      ],
      records: [
        { referring_provider: 'Dr. Sam Okafor', patient_initials: 'J.T.', procedure: 'Cardiology Consult', referral_date: daysAgo(3).toISOString() },
        { referring_provider: 'Dr. Lin Wei', patient_initials: 'M.G.', procedure: 'Physical Therapy Eval', referral_date: daysAgo(1).toISOString() },
      ],
    },
    dateAutomation: {
      dateField: 'referral_date', offsetDays: 3,
      name: 'Referral Follow-up Reminder',
      description: 'Notifies the CRM manager 3 days after a referral is received to confirm the patient scheduled.',
      message: 'It\'s been 3 days since a patient referral came in — confirm they\'ve booked their consult.',
    },
  },
  {
    slug: 'coastal-retail', orgName: 'Coastal Retail Group', industry: 'Retail', primaryColor: '#EA580C', supportEmail: 'support@coastalretail.io',
    stages: stages(['Lead', 'Store Visit', 'Quote Sent', 'PO Received']),
    accounts: [
      { name: 'Brightway Home Goods', industry: 'Home & Garden Retail', website: 'https://brightwayhome.example.com', phone: '+1-555-0510', address: '55 Market St, Portland, OR' },
      { name: 'Northgate Apparel Co.', industry: 'Apparel Retail', website: 'https://northgateapparel.example.com', phone: '+1-555-0520', address: '900 Fashion Ave, Chicago, IL' },
      { name: 'Trailhead Outdoor Supply', industry: 'Outdoor Retail', website: 'https://trailheadsupply.example.com', phone: '+1-555-0530', address: '12 Ridge Rd, Boulder, CO' },
    ],
    contacts: [
      { name: 'Nora Fields', email: 'nora.fields@brightwayhome.example.com', phone: '+1-555-5101', jobTitle: 'Store Operations Manager', accountIdx: 0, source: 'Website', dateOfBirth: birthdayOn(0, 38) },
      { name: 'Owen Patel', email: 'owen.patel@brightwayhome.example.com', phone: '+1-555-5102', jobTitle: 'Buyer', accountIdx: 0, source: 'Trade Show', dateOfBirth: birthdayOn(210, 29) },
      { name: 'Layla Hassan', email: 'layla.hassan@northgateapparel.example.com', phone: '+1-555-5201', jobTitle: 'VP Merchandising', accountIdx: 1, source: 'Referral' },
      { name: 'Chris Doyle', email: 'chris.doyle@northgateapparel.example.com', phone: '+1-555-5202', jobTitle: 'IT Manager', accountIdx: 1, source: 'Cold Email' },
      { name: 'Renee Ford', email: 'renee.ford@trailheadsupply.example.com', phone: '+1-555-5301', jobTitle: 'Owner', accountIdx: 2, source: 'Referral' },
      { name: 'Ivan Petrov', email: 'ivan.petrov@trailheadsupply.example.com', phone: '+1-555-5302', jobTitle: 'Store Manager', accountIdx: 2, source: 'Inbound' },
    ],
    deals: [
      { title: 'Brightway POS Rollout (12 stores)', value: 54000, stage: 'PO Received', probability: 90, contactIdx: 0, accountIdx: 0, status: DealStatus.OPEN, closeDays: 15 },
      { title: 'Brightway Loyalty Program Setup', value: 18000, stage: 'Quote Sent', probability: 45, contactIdx: 1, accountIdx: 0, status: DealStatus.OPEN, closeDays: 25 },
      { title: 'Northgate Omnichannel Platform', value: 132000, stage: 'Closed Won', probability: 100, contactIdx: 2, accountIdx: 1, status: DealStatus.WON, closeDays: -20 },
      { title: 'Northgate Support Renewal', value: 26000, stage: 'Store Visit', probability: 20, contactIdx: 3, accountIdx: 1, status: DealStatus.OPEN, closeDays: 50 },
      { title: 'Trailhead Inventory System', value: 22500, stage: 'Lead', probability: 20, contactIdx: 4, accountIdx: 2, status: DealStatus.OPEN, closeDays: 45 },
      { title: 'Trailhead Seasonal Kiosk Bundle', value: 9800, stage: 'Closed Lost', probability: 0, contactIdx: 5, accountIdx: 2, status: DealStatus.LOST, closeDays: -8 },
    ],
    leads: [
      { contactIdx: 0, source: 'Website', status: LeadStatus.QUALIFIED, notes: 'Requested POS demo for 12-store rollout.', aiScore: 88, aiScoreReason: 'Multi-store operator, budget confirmed', followUps: [
        { type: ActivityType.MEETING, title: 'POS demo', body: 'Live demo with ops team.', dueDays: -6, done: true },
        { type: ActivityType.TASK, title: 'Send rollout timeline', body: 'Draft 12-store phased rollout plan.', dueDays: 2, done: false },
      ] },
      { contactIdx: 2, source: 'Referral', status: LeadStatus.CONTACTED, notes: 'VP Merchandising, evaluating omnichannel vendors.', aiScore: 76, aiScoreReason: 'Senior title, referral source', followUps: [
        { type: ActivityType.CALL, title: 'Vendor eval call', body: 'Address omnichannel integration questions.', dueDays: 3, done: false },
      ] },
      { contactIdx: 4, source: 'Referral', status: LeadStatus.NEW, notes: 'Owner interested in inventory system.', aiScore: 58, aiScoreReason: 'Owner-operator, small chain', followUps: [
        { type: ActivityType.EMAIL, title: 'Send product overview', body: 'Inventory system overview PDF.', dueDays: 1, done: false },
      ] },
      { contactIdx: 5, source: 'Inbound', status: LeadStatus.UNQUALIFIED, notes: 'Seasonal-only need, low budget.', aiScore: 20, aiScoreReason: 'Seasonal, budget too low', followUps: [] },
      { contactIdx: 1, source: 'Trade Show', status: LeadStatus.CONTACTED, notes: 'Met at retail trade show, interested in loyalty add-on.', aiScore: 64, aiScoreReason: 'Trade show engagement, existing customer upsell', followUps: [
        { type: ActivityType.CALL, title: 'Loyalty program pricing call', body: 'Discuss tiers and rollout cost.', dueDays: 4, done: false },
      ] },
    ],
    tickets: [
      { title: 'POS terminal offline at register 3', body: 'Register 3 POS terminal lost connection mid-transaction during Saturday rush.', category: 'Hardware', priority: TicketPriority.CRITICAL, status: TicketStatus.IN_PROGRESS },
      { title: 'Store WiFi dropping during peak hours', body: 'Guest and staff WiFi drops every afternoon around 2-4pm.', category: 'Network & Connectivity', priority: TicketPriority.HIGH, status: TicketStatus.OPEN },
      { title: 'New seasonal staff need POS access', body: '6 seasonal hires starting this week need POS logins provisioned.', category: 'Access & Permissions', priority: TicketPriority.MEDIUM, status: TicketStatus.PENDING },
      { title: 'Receipt printer out of paper sensor stuck', body: 'Printer shows out-of-paper even after reload.', category: 'Hardware', priority: TicketPriority.LOW, status: TicketStatus.RESOLVED },
      { title: 'Inventory app crashing on stock count', body: 'App crashes when scanning more than 200 items in one session.', category: 'Software', priority: TicketPriority.HIGH, status: TicketStatus.IN_PROGRESS },
      { title: 'Vendor invoice does not match PO', body: 'Vendor billed for 500 units, PO was for 450.', category: 'Billing & Accounts', priority: TicketPriority.MEDIUM, status: TicketStatus.OPEN },
    ],
    kb: [
      { title: 'Restarting a frozen POS terminal', body: 'Hold power 8s, wait, restart. Offline transactions auto-sync on reconnect.', category: 'Hardware' },
      { title: 'Provisioning seasonal staff POS access', body: 'Submit under Access & Permissions with start/end date for auto-expiry.', category: 'Access & Permissions' },
      { title: 'Store WiFi troubleshooting checklist', body: 'Check AP load, restart in off-hours, escalate if peak-hour pattern persists.', category: 'Network & Connectivity' },
    ],
    customModule: {
      name: 'Store Inventory Requests', icon: 'Package', description: 'Restock requests synced from the store inventory system.',
      fields: [
        { label: 'Store', fieldKey: 'store', fieldType: 'TEXT', required: true, isPrimary: true },
        { label: 'SKU', fieldKey: 'sku', fieldType: 'TEXT', required: true },
        { label: 'Product Name', fieldKey: 'product_name', fieldType: 'TEXT', required: true },
        { label: 'Quantity Requested', fieldKey: 'quantity_requested', fieldType: 'NUMBER', required: true },
        { label: 'Expected Restock Date', fieldKey: 'expected_restock_date', fieldType: 'DATE' },
      ],
      records: [
        { store: 'Brightway - Downtown', sku: 'BW-1042', product_name: 'Ceramic Planter Set', quantity_requested: 120, expected_restock_date: daysFromNow(2).toISOString() },
        { store: 'Northgate - Mall Outlet', sku: 'NG-3390', product_name: 'Winter Jacket - Navy L', quantity_requested: 60, expected_restock_date: daysFromNow(30).toISOString() },
      ],
    },
    dateAutomation: {
      dateField: 'expected_restock_date', offsetDays: -2,
      name: 'Restock Arrival Reminder',
      description: 'Notifies the CRM manager 2 days before a requested item is expected back in stock.',
      message: 'A requested item restocks in 2 days — line up the waiting customers for outreach.',
    },
  },
  {
    slug: 'summit-financial', orgName: 'Summit Financial Partners', industry: 'Financial Services', primaryColor: '#065F46', supportEmail: 'support@summitfinancial.io',
    stages: stages(['Prospecting', 'Discovery', 'Underwriting', 'Approval']),
    accounts: [
      { name: 'Ridgeline Manufacturing', industry: 'Industrial Manufacturing', website: 'https://ridgelinemfg.example.com', phone: '+1-555-0610', address: '77 Foundry Ln, Pittsburgh, PA' },
      { name: 'Harper & Cole LLP', industry: 'Professional Services', website: 'https://harpercole.example.com', phone: '+1-555-0620', address: '10 Legal Plaza, Boston, MA' },
      { name: 'Vantage Logistics', industry: 'Logistics', website: 'https://vantagelogistics.example.com', phone: '+1-555-0630', address: '333 Freight Way, Memphis, TN' },
    ],
    contacts: [
      { name: 'Diane Cooper', email: 'diane.cooper@ridgelinemfg.example.com', phone: '+1-555-6101', jobTitle: 'CFO', accountIdx: 0, source: 'Referral', dateOfBirth: birthdayOn(0, 52) },
      { name: 'Marcus Lee', email: 'marcus.lee@ridgelinemfg.example.com', phone: '+1-555-6102', jobTitle: 'Controller', accountIdx: 0, source: 'Website', dateOfBirth: birthdayOn(65, 40) },
      { name: 'Sophia Harper', email: 'sophia.harper@harpercole.example.com', phone: '+1-555-6201', jobTitle: 'Managing Partner', accountIdx: 1, source: 'Referral' },
      { name: 'Ben Coleman', email: 'ben.coleman@harpercole.example.com', phone: '+1-555-6202', jobTitle: 'Operations Director', accountIdx: 1, source: 'LinkedIn' },
      { name: 'Rachel Kim', email: 'rachel.kim@vantagelogistics.example.com', phone: '+1-555-6301', jobTitle: 'VP Finance', accountIdx: 2, source: 'Cold Call' },
      { name: 'Tariq Ahmed', email: 'tariq.ahmed@vantagelogistics.example.com', phone: '+1-555-6302', jobTitle: 'IT Director', accountIdx: 2, source: 'Website' },
    ],
    deals: [
      { title: 'Ridgeline Equipment Financing', value: 340000, stage: 'Approval', probability: 90, contactIdx: 0, accountIdx: 0, status: DealStatus.OPEN, closeDays: 12 },
      { title: 'Ridgeline Working Capital Line', value: 150000, stage: 'Underwriting', probability: 70, contactIdx: 1, accountIdx: 0, status: DealStatus.OPEN, closeDays: 25 },
      { title: 'Harper & Cole Practice Loan', value: 220000, stage: 'Closed Won', probability: 100, contactIdx: 2, accountIdx: 1, status: DealStatus.WON, closeDays: -18 },
      { title: 'Harper & Cole Advisory Retainer', value: 48000, stage: 'Discovery', probability: 45, contactIdx: 3, accountIdx: 1, status: DealStatus.OPEN, closeDays: 40 },
      { title: 'Vantage Fleet Financing', value: 410000, stage: 'Prospecting', probability: 20, contactIdx: 4, accountIdx: 2, status: DealStatus.OPEN, closeDays: 70 },
      { title: 'Vantage Trade Credit Line', value: 95000, stage: 'Closed Lost', probability: 0, contactIdx: 5, accountIdx: 2, status: DealStatus.LOST, closeDays: -9 },
    ],
    leads: [
      { contactIdx: 0, source: 'Referral', status: LeadStatus.QUALIFIED, notes: 'CFO referred by existing client, needs equipment financing fast.', aiScore: 90, aiScoreReason: 'Referral, urgent need, confirmed budget', followUps: [
        { type: ActivityType.CALL, title: 'Financing needs call', body: 'Confirm equipment list and timeline.', dueDays: -4, done: true },
        { type: ActivityType.TASK, title: 'Prep underwriting docs', body: 'Request financials for underwriting.', dueDays: 2, done: false },
      ] },
      { contactIdx: 2, source: 'Referral', status: LeadStatus.CONTACTED, notes: 'Managing partner, interested in practice loan.', aiScore: 82, aiScoreReason: 'Referral, decision-maker', followUps: [
        { type: ActivityType.MEETING, title: 'Loan structure meeting', body: 'Present term options.', dueDays: 5, done: false },
      ] },
      { contactIdx: 4, source: 'Cold Call', status: LeadStatus.NEW, notes: 'VP Finance, large fleet financing need.', aiScore: 55, aiScoreReason: 'Large opportunity, unconfirmed timeline', followUps: [
        { type: ActivityType.EMAIL, title: 'Send financing options', body: 'Fleet financing rate sheet.', dueDays: 1, done: false },
      ] },
      { contactIdx: 5, source: 'Website', status: LeadStatus.UNQUALIFIED, notes: 'Credit profile did not meet minimum.', aiScore: 18, aiScoreReason: 'Credit risk', followUps: [] },
      { contactIdx: 1, source: 'Website', status: LeadStatus.CONTACTED, notes: 'Controller researching working capital options.', aiScore: 60, aiScoreReason: 'Mid-level contact, active research', followUps: [
        { type: ActivityType.CALL, title: 'Working capital intro call', body: 'Explain line-of-credit product.', dueDays: 3, done: false },
      ] },
    ],
    tickets: [
      { title: 'Underwriting portal login failure', body: 'Analyst locked out of underwriting portal after password change.', category: 'Access & Permissions', priority: TicketPriority.HIGH, status: TicketStatus.IN_PROGRESS },
      { title: 'Secure document upload failing', body: 'Client financial documents fail to upload, error 413.', category: 'Software', priority: TicketPriority.CRITICAL, status: TicketStatus.OPEN },
      { title: 'New loan officer needs CRM access', body: 'New hire needs CRM + underwriting system access provisioned.', category: 'Access & Permissions', priority: TicketPriority.MEDIUM, status: TicketStatus.PENDING },
      { title: 'Conference room video system down', body: 'Video conferencing not connecting for client calls.', category: 'Hardware', priority: TicketPriority.MEDIUM, status: TicketStatus.RESOLVED },
      { title: 'Risk scoring tool returning errors', body: 'Automated risk scoring throws error on applications over $250K.', category: 'Software', priority: TicketPriority.HIGH, status: TicketStatus.IN_PROGRESS },
      { title: 'Billing statement totals incorrect', body: 'Monthly servicing fee statement totals don\'t match ledger.', category: 'Billing & Accounts', priority: TicketPriority.CRITICAL, status: TicketStatus.OPEN },
    ],
    kb: [
      { title: 'Resetting underwriting portal access', body: 'Submit under Access & Permissions with employee ID for verification.', category: 'Access & Permissions' },
      { title: 'Secure document upload troubleshooting', body: 'Max file size 25MB per doc; split large PDFs before upload.', category: 'Software' },
      { title: 'Provisioning a new loan officer', body: 'Requires compliance sign-off before CRM/underwriting access is granted.', category: 'Access & Permissions' },
    ],
    customModule: {
      name: 'Loan Applications', icon: 'FileText', description: 'Applications synced from the online loan application portal.',
      fields: [
        { label: 'Applicant', fieldKey: 'applicant', fieldType: 'TEXT', required: true, isPrimary: true },
        { label: 'Loan Type', fieldKey: 'loan_type', fieldType: 'DROPDOWN', options: ['Equipment Financing', 'Working Capital', 'Trade Credit', 'Practice Loan'], required: true },
        { label: 'Amount Requested', fieldKey: 'amount_requested', fieldType: 'CURRENCY', required: true },
        { label: 'Credit Score', fieldKey: 'credit_score', fieldType: 'NUMBER' },
        { label: 'Next Review Date', fieldKey: 'next_review_date', fieldType: 'DATE' },
      ],
      records: [
        { applicant: 'Ridgeline Manufacturing', loan_type: 'Equipment Financing', amount_requested: 340000, credit_score: 742, next_review_date: daysFromNow(4).toISOString() },
        { applicant: 'Vantage Logistics', loan_type: 'Trade Credit', amount_requested: 95000, credit_score: 611, next_review_date: daysFromNow(18).toISOString() },
      ],
    },
    dateAutomation: {
      dateField: 'next_review_date', offsetDays: -4,
      name: 'Application Review Reminder',
      description: 'Notifies the CRM manager 4 days before a loan application\'s next underwriting review.',
      message: 'A loan application is due for underwriting review in 4 days.',
    },
  },
  {
    slug: 'ironforge-mfg', orgName: 'IronForge Manufacturing', industry: 'Manufacturing', primaryColor: '#B45309', supportEmail: 'support@ironforgemfg.io',
    stages: stages(['Inquiry', 'RFQ', 'Sample / Prototype', 'PO Negotiation']),
    accounts: [
      { name: 'Delta Auto Components', industry: 'Automotive Supply', website: 'https://deltaautocomp.example.com', phone: '+1-555-0710', address: '4 Assembly Row, Detroit, MI' },
      { name: 'Skyline Aerospace', industry: 'Aerospace', website: 'https://skylineaero.example.com', phone: '+1-555-0720', address: '900 Runway Dr, Wichita, KS' },
      { name: 'Pioneer Appliance Co.', industry: 'Consumer Appliances', website: 'https://pioneerappliance.example.com', phone: '+1-555-0730', address: '210 Plant St, Louisville, KY' },
    ],
    contacts: [
      { name: 'Walter Nash', email: 'walter.nash@deltaautocomp.example.com', phone: '+1-555-7101', jobTitle: 'VP Procurement', accountIdx: 0, source: 'Trade Show', dateOfBirth: birthdayOn(0, 44) },
      { name: 'Julia Byrne', email: 'julia.byrne@deltaautocomp.example.com', phone: '+1-555-7102', jobTitle: 'Quality Manager', accountIdx: 0, source: 'Referral', dateOfBirth: birthdayOn(175, 31) },
      { name: 'Adam Krueger', email: 'adam.krueger@skylineaero.example.com', phone: '+1-555-7201', jobTitle: 'Sourcing Director', accountIdx: 1, source: 'Cold Call' },
      { name: 'Ngozi Adeyemi', email: 'ngozi.adeyemi@skylineaero.example.com', phone: '+1-555-7202', jobTitle: 'Plant IT Manager', accountIdx: 1, source: 'Website' },
      { name: 'Derek Holt', email: 'derek.holt@pioneerappliance.example.com', phone: '+1-555-7301', jobTitle: 'Operations VP', accountIdx: 2, source: 'Referral' },
      { name: 'Melissa Ortiz', email: 'melissa.ortiz@pioneerappliance.example.com', phone: '+1-555-7302', jobTitle: 'Buyer', accountIdx: 2, source: 'Inbound' },
    ],
    deals: [
      { title: 'Delta Auto Stamped Components Contract', value: 275000, stage: 'PO Negotiation', probability: 70, contactIdx: 0, accountIdx: 0, status: DealStatus.OPEN, closeDays: 20 },
      { title: 'Delta Auto Tooling Upgrade', value: 64000, stage: 'RFQ', probability: 45, contactIdx: 1, accountIdx: 0, status: DealStatus.OPEN, closeDays: 35 },
      { title: 'Skyline Aerospace Bracket Supply', value: 410000, stage: 'Closed Won', probability: 100, contactIdx: 2, accountIdx: 1, status: DealStatus.WON, closeDays: -25 },
      { title: 'Skyline Aerospace Prototype Batch', value: 38000, stage: 'Sample / Prototype', probability: 20, contactIdx: 3, accountIdx: 1, status: DealStatus.OPEN, closeDays: 50 },
      { title: 'Pioneer Appliance Housing Parts', value: 118000, stage: 'Inquiry', probability: 20, contactIdx: 4, accountIdx: 2, status: DealStatus.OPEN, closeDays: 65 },
      { title: 'Pioneer Appliance Trial Order', value: 22000, stage: 'Closed Lost', probability: 0, contactIdx: 5, accountIdx: 2, status: DealStatus.LOST, closeDays: -11 },
    ],
    leads: [
      { contactIdx: 0, source: 'Trade Show', status: LeadStatus.QUALIFIED, notes: 'Met at MFG Expo. Needs stamped components RFQ.', aiScore: 86, aiScoreReason: 'Trade show, urgent RFQ', followUps: [
        { type: ActivityType.TASK, title: 'Prepare RFQ response', body: 'Pull pricing for stamped components spec.', dueDays: -3, done: true },
        { type: ActivityType.CALL, title: 'RFQ follow-up call', body: 'Review submitted RFQ and timeline.', dueDays: 2, done: false },
      ] },
      { contactIdx: 2, source: 'Cold Call', status: LeadStatus.CONTACTED, notes: 'Sourcing director, evaluating for aerospace-grade parts.', aiScore: 74, aiScoreReason: 'Enterprise account, sourcing authority', followUps: [
        { type: ActivityType.MEETING, title: 'Capability review meeting', body: 'Present AS9100 certification and capacity.', dueDays: 4, done: false },
      ] },
      { contactIdx: 4, source: 'Referral', status: LeadStatus.NEW, notes: 'Referred by Delta Auto contact.', aiScore: 62, aiScoreReason: 'Referral, unconfirmed volume', followUps: [
        { type: ActivityType.EMAIL, title: 'Send capabilities overview', body: 'Share plant capabilities and cert list.', dueDays: 1, done: false },
      ] },
      { contactIdx: 5, source: 'Inbound', status: LeadStatus.UNQUALIFIED, notes: 'Trial order volume too small for our minimums.', aiScore: 25, aiScoreReason: 'Below minimum order volume', followUps: [] },
      { contactIdx: 1, source: 'Referral', status: LeadStatus.CONTACTED, notes: 'Quality manager, needs cert documentation first.', aiScore: 58, aiScoreReason: 'Quality gatekeeper, mid-priority', followUps: [
        { type: ActivityType.TASK, title: 'Send quality certifications', body: 'ISO 9001 + IATF 16949 docs.', dueDays: 2, done: false },
      ] },
    ],
    tickets: [
      { title: 'CNC machine controller unresponsive', body: 'Line 3 CNC controller frozen mid-run, production halted.', category: 'Hardware', priority: TicketPriority.CRITICAL, status: TicketStatus.IN_PROGRESS },
      { title: 'Plant floor WiFi coverage gap', body: 'New warehouse extension has no WiFi coverage for handheld scanners.', category: 'Network & Connectivity', priority: TicketPriority.HIGH, status: TicketStatus.OPEN },
      { title: 'New quality inspector needs MES access', body: 'New hire needs manufacturing execution system access.', category: 'Access & Permissions', priority: TicketPriority.MEDIUM, status: TicketStatus.PENDING },
      { title: 'Barcode scanner battery not charging', body: 'Handheld scanner #14 shows charging but battery stays at 0%.', category: 'Hardware', priority: TicketPriority.LOW, status: TicketStatus.RESOLVED },
      { title: 'ERP inventory sync lagging', body: 'Inventory counts in ERP are 6+ hours behind shop floor system.', category: 'Software', priority: TicketPriority.HIGH, status: TicketStatus.IN_PROGRESS },
      { title: 'Vendor invoice quantity mismatch', body: 'Raw material invoice quantity doesn\'t match receiving log.', category: 'Billing & Accounts', priority: TicketPriority.MEDIUM, status: TicketStatus.OPEN },
    ],
    kb: [
      { title: 'Restarting a frozen CNC controller', body: 'Follow lockout/tagout procedure before power cycling. Contact IT before restart during a run.', category: 'Hardware' },
      { title: 'Extending WiFi coverage to new floor areas', body: 'Log ticket under Network & Connectivity with area/zone for a site survey.', category: 'Network & Connectivity' },
      { title: 'MES access provisioning for new staff', body: 'Requires supervisor + safety training sign-off before access is granted.', category: 'Access & Permissions' },
    ],
    customModule: {
      name: 'Production Orders', icon: 'Factory', description: 'Shop-floor production orders synced from the MES.',
      fields: [
        { label: 'Order Number', fieldKey: 'order_number', fieldType: 'TEXT', required: true, isPrimary: true },
        { label: 'Part Number', fieldKey: 'part_number', fieldType: 'TEXT', required: true },
        { label: 'Quantity', fieldKey: 'quantity', fieldType: 'NUMBER', required: true },
        { label: 'Due Date', fieldKey: 'due_date', fieldType: 'DATE' },
      ],
      records: [
        { order_number: 'PO-88213', part_number: 'DA-STMP-004', quantity: 12000, due_date: daysFromNow(14).toISOString() },
        { order_number: 'PO-88214', part_number: 'SK-BRKT-019', quantity: 3200, due_date: daysFromNow(21).toISOString() },
      ],
    },
    dateAutomation: {
      dateField: 'due_date', offsetDays: -14,
      name: 'Production Due Reminder',
      description: 'Notifies the CRM manager 14 days before a production order\'s due date.',
      message: 'A production order is due in 2 weeks — confirm the line is on schedule.',
    },
  },
  {
    slug: 'glow-salon-spa', orgName: 'Glow Salon & Spa Collective', industry: 'Salon / Spa', primaryColor: '#DB2777', supportEmail: 'support@glowsalonspa.io',
    stages: stages(['Inquiry', 'Consultation Booked', 'Package Proposed', 'Membership Signed']),
    accounts: [
      { name: 'Glow Downtown', industry: 'Full-Service Salon', website: 'https://glowsalonspa.example.com/downtown', phone: '+1-555-0810', address: '5 Beauty Row, Miami, FL' },
      { name: 'Glow Uptown Spa', industry: 'Day Spa', website: 'https://glowsalonspa.example.com/uptown', phone: '+1-555-0820', address: '210 Wellness Ave, Miami, FL' },
      { name: 'Glow Franchise Partners', industry: 'Franchise Group', website: 'https://glowsalonspa.example.com/franchise', phone: '+1-555-0830', address: '77 Corporate Ct, Orlando, FL' },
    ],
    contacts: [
      { name: 'Stephanie Cruz', email: 'stephanie.cruz@glowdowntown.example.com', phone: '+1-555-8101', jobTitle: 'Salon Owner', accountIdx: 0, source: 'Referral', dateOfBirth: birthdayOn(0, 39) },
      { name: 'Marco Diaz', email: 'marco.diaz@glowdowntown.example.com', phone: '+1-555-8102', jobTitle: 'Front Desk Lead', accountIdx: 0, source: 'Walk-in', dateOfBirth: birthdayOn(260, 27) },
      { name: 'Jenna Wolfe', email: 'jenna.wolfe@glowuptown.example.com', phone: '+1-555-8201', jobTitle: 'Spa Director', accountIdx: 1, source: 'Instagram' },
      { name: 'Paul Nguyen', email: 'paul.nguyen@glowuptown.example.com', phone: '+1-555-8202', jobTitle: 'Operations Lead', accountIdx: 1, source: 'Website' },
      { name: 'Angela Ross', email: 'angela.ross@glowfranchise.example.com', phone: '+1-555-8301', jobTitle: 'Franchise Development Manager', accountIdx: 2, source: 'Referral' },
      { name: 'Devon Blake', email: 'devon.blake@glowfranchise.example.com', phone: '+1-555-8302', jobTitle: 'IT Coordinator', accountIdx: 2, source: 'Cold Email' },
    ],
    deals: [
      { title: 'Glow Downtown Membership Program Launch', value: 18000, stage: 'Membership Signed', probability: 90, contactIdx: 0, accountIdx: 0, status: DealStatus.OPEN, closeDays: 10 },
      { title: 'Glow Downtown Booking System Upgrade', value: 6400, stage: 'Package Proposed', probability: 45, contactIdx: 1, accountIdx: 0, status: DealStatus.OPEN, closeDays: 18 },
      { title: 'Glow Uptown Spa Full Platform', value: 24000, stage: 'Closed Won', probability: 100, contactIdx: 2, accountIdx: 1, status: DealStatus.WON, closeDays: -12 },
      { title: 'Glow Uptown Staff Scheduling Add-on', value: 4200, stage: 'Consultation Booked', probability: 20, contactIdx: 3, accountIdx: 1, status: DealStatus.OPEN, closeDays: 22 },
      { title: 'Glow Franchise Multi-Location Rollout', value: 62000, stage: 'Inquiry', probability: 20, contactIdx: 4, accountIdx: 2, status: DealStatus.OPEN, closeDays: 55 },
      { title: 'Glow Franchise Pilot Location', value: 5200, stage: 'Closed Lost', probability: 0, contactIdx: 5, accountIdx: 2, status: DealStatus.LOST, closeDays: -7 },
    ],
    leads: [
      { contactIdx: 0, source: 'Referral', status: LeadStatus.QUALIFIED, notes: 'Owner referred by another salon client. Wants membership program.', aiScore: 84, aiScoreReason: 'Referral, owner-operator, ready to buy', followUps: [
        { type: ActivityType.CALL, title: 'Membership program call', body: 'Walk through tiered membership setup.', dueDays: -4, done: true },
        { type: ActivityType.TASK, title: 'Send membership contract', body: 'Draft agreement for review.', dueDays: 1, done: false },
      ] },
      { contactIdx: 2, source: 'Instagram', status: LeadStatus.CONTACTED, notes: 'Spa director, found us via Instagram ad.', aiScore: 68, aiScoreReason: 'Inbound, engaged social lead', followUps: [
        { type: ActivityType.MEETING, title: 'Spa platform walkthrough', body: 'Demo booking + POS features.', dueDays: 3, done: false },
      ] },
      { contactIdx: 4, source: 'Referral', status: LeadStatus.NEW, notes: 'Franchise dev manager exploring multi-location rollout.', aiScore: 71, aiScoreReason: 'Franchise-level opportunity', followUps: [
        { type: ActivityType.CALL, title: 'Franchise discovery call', body: 'Understand rollout timeline across locations.', dueDays: 2, done: false },
      ] },
      { contactIdx: 5, source: 'Cold Email', status: LeadStatus.UNQUALIFIED, notes: 'Pilot location decided to stay with current vendor.', aiScore: 15, aiScoreReason: 'Lost to incumbent vendor', followUps: [] },
      { contactIdx: 1, source: 'Walk-in', status: LeadStatus.CONTACTED, notes: 'Front desk lead asking about booking system upgrade.', aiScore: 52, aiScoreReason: 'Operational contact, smaller deal size', followUps: [
        { type: ActivityType.EMAIL, title: 'Send booking system overview', body: 'Feature comparison vs. current system.', dueDays: 2, done: false },
      ] },
    ],
    tickets: [
      { title: 'Booking system down during peak hours', body: 'Online booking widget returning 500 error since this morning, front desk can\'t book.', category: 'Software', priority: TicketPriority.CRITICAL, status: TicketStatus.IN_PROGRESS },
      { title: 'Card reader not connecting at Uptown', body: 'Payment terminal at Glow Uptown won\'t pair with checkout tablet.', category: 'Hardware', priority: TicketPriority.HIGH, status: TicketStatus.OPEN },
      { title: 'New stylist needs scheduling access', body: 'New hire starting Thursday needs calendar + client notes access.', category: 'Access & Permissions', priority: TicketPriority.MEDIUM, status: TicketStatus.PENDING },
      { title: 'Receipt printer jamming', body: 'Front desk printer jams on every third receipt.', category: 'Hardware', priority: TicketPriority.LOW, status: TicketStatus.RESOLVED },
      { title: 'Client app push notifications not sending', body: 'Appointment reminder notifications stopped going out 2 days ago.', category: 'Software', priority: TicketPriority.HIGH, status: TicketStatus.IN_PROGRESS },
      { title: 'Membership billing charged twice', body: 'A member was charged twice for their monthly membership fee.', category: 'Billing & Accounts', priority: TicketPriority.CRITICAL, status: TicketStatus.OPEN },
    ],
    kb: [
      { title: 'Troubleshooting the online booking widget', body: 'Clear widget cache, verify calendar sync, re-embed snippet if still failing.', category: 'Software' },
      { title: 'Pairing a card reader with checkout tablet', body: 'Settings > Payment Devices > Add Reader, hold pairing button 5s.', category: 'Hardware' },
      { title: 'Setting up a new stylist\'s access', body: 'Submit under Access & Permissions with location and role for calendar setup.', category: 'Access & Permissions' },
    ],
    customModule: {
      name: 'Membership Renewals', icon: 'Sparkles', description: 'Upcoming membership renewals synced from the billing system.',
      fields: [
        { label: 'Member Name', fieldKey: 'member_name', fieldType: 'TEXT', required: true, isPrimary: true },
        { label: 'Plan', fieldKey: 'plan', fieldType: 'DROPDOWN', options: ['Essentials', 'Signature', 'VIP Unlimited'], required: true },
        { label: 'Renewal Date', fieldKey: 'renewal_date', fieldType: 'DATE', required: true },
        { label: 'Auto Renew', fieldKey: 'auto_renew', fieldType: 'BOOLEAN' },
      ],
      records: [
        { member_name: 'Priya Shah', plan: 'Signature', renewal_date: daysFromNow(5).toISOString(), auto_renew: true },
        { member_name: 'Kevin Marsh', plan: 'VIP Unlimited', renewal_date: daysFromNow(9).toISOString(), auto_renew: false },
      ],
    },
    // The flagship example for the "salon follow-up" scenario this feature
    // was built for: appointment/service-due reminders, birthday wishes, and
    // personalized win-back offers are all the same DATE_FIELD_REACHED
    // mechanism pointed at different date fields — this one's the renewal
    // date, styled as a personalized renewal offer rather than a bare
    // reminder.
    dateAutomation: {
      dateField: 'renewal_date', offsetDays: -5,
      name: 'Membership Renewal Offer',
      description: 'Notifies the CRM manager 5 days before a member\'s renewal date to send a personalized offer.',
      message: 'A membership renews in 5 days — send a personalized "renew now" offer before they lapse.',
    },
  },
  {
    slug: 'apex-auto-group', orgName: 'Apex Auto Group', industry: 'Automotive Dealers', primaryColor: '#1D4ED8', supportEmail: 'support@apexautogroup.io',
    stages: stages(['Lead', 'Test Drive Scheduled', 'Financing', 'Paperwork']),
    accounts: [
      { name: 'Apex Downtown Motors', industry: 'New Car Dealership', website: 'https://apexautogroup.example.com/downtown', phone: '+1-555-0910', address: '1 Auto Mall Dr, Phoenix, AZ' },
      { name: 'Apex Certified Pre-Owned', industry: 'Used Car Dealership', website: 'https://apexautogroup.example.com/cpo', phone: '+1-555-0920', address: '450 Highway 10, Phoenix, AZ' },
      { name: 'Apex Fleet Sales', industry: 'Fleet / Commercial', website: 'https://apexautogroup.example.com/fleet', phone: '+1-555-0930', address: '88 Industrial Pkwy, Tempe, AZ' },
    ],
    contacts: [
      { name: 'Ray Sullivan', email: 'ray.sullivan@apexdowntown.example.com', phone: '+1-555-9101', jobTitle: 'General Manager', accountIdx: 0, source: 'Referral', dateOfBirth: birthdayOn(0, 49) },
      { name: 'Monica Alvarez', email: 'monica.alvarez@apexdowntown.example.com', phone: '+1-555-9102', jobTitle: 'Sales Manager', accountIdx: 0, source: 'Walk-in', dateOfBirth: birthdayOn(320, 34) },
      { name: 'Terrence Boyd', email: 'terrence.boyd@apexcpo.example.com', phone: '+1-555-9201', jobTitle: 'Lot Manager', accountIdx: 1, source: 'Website' },
      { name: 'Wendy Zhao', email: 'wendy.zhao@apexcpo.example.com', phone: '+1-555-9202', jobTitle: 'Finance Manager', accountIdx: 1, source: 'Inbound' },
      { name: 'Oscar Reyes', email: 'oscar.reyes@apexfleet.example.com', phone: '+1-555-9301', jobTitle: 'Fleet Sales Director', accountIdx: 2, source: 'Cold Call' },
      { name: 'Brianna Foster', email: 'brianna.foster@apexfleet.example.com', phone: '+1-555-9302', jobTitle: 'IT Manager', accountIdx: 2, source: 'LinkedIn' },
    ],
    deals: [
      { title: 'Downtown Q4 Inventory Financing Deal', value: 58000, stage: 'Paperwork', probability: 90, contactIdx: 0, accountIdx: 0, status: DealStatus.OPEN, closeDays: 8 },
      { title: 'Downtown Trade-In Bundle - Sullivan Family', value: 32000, stage: 'Financing', probability: 70, contactIdx: 1, accountIdx: 0, status: DealStatus.OPEN, closeDays: 14 },
      { title: 'CPO Fleet Refresh - 15 Units', value: 410000, stage: 'Closed Won', probability: 100, contactIdx: 2, accountIdx: 1, status: DealStatus.WON, closeDays: -16 },
      { title: 'CPO Certified Warranty Upsell', value: 12500, stage: 'Test Drive Scheduled', probability: 20, contactIdx: 3, accountIdx: 1, status: DealStatus.OPEN, closeDays: 20 },
      { title: 'Apex Fleet Commercial Van Order', value: 275000, stage: 'Lead', probability: 20, contactIdx: 4, accountIdx: 2, status: DealStatus.OPEN, closeDays: 60 },
      { title: 'Apex Fleet Trial Lease', value: 41000, stage: 'Closed Lost', probability: 0, contactIdx: 5, accountIdx: 2, status: DealStatus.LOST, closeDays: -13 },
    ],
    leads: [
      { contactIdx: 0, source: 'Referral', status: LeadStatus.QUALIFIED, notes: 'GM referred by regional office, ready to move on financing.', aiScore: 89, aiScoreReason: 'Referral, decision-maker, urgent timeline', followUps: [
        { type: ActivityType.CALL, title: 'Financing terms call', body: 'Confirm rate and term for inventory financing.', dueDays: -3, done: true },
        { type: ActivityType.TASK, title: 'Prep paperwork packet', body: 'Assemble documents for signing.', dueDays: 1, done: false },
      ] },
      { contactIdx: 2, source: 'Website', status: LeadStatus.CONTACTED, notes: 'Lot manager interested in fleet refresh warranty upsell.', aiScore: 66, aiScoreReason: 'Existing customer, upsell opportunity', followUps: [
        { type: ActivityType.MEETING, title: 'Warranty upsell meeting', body: 'Present extended warranty options.', dueDays: 3, done: false },
      ] },
      { contactIdx: 4, source: 'Cold Call', status: LeadStatus.NEW, notes: 'Fleet sales director evaluating commercial van order.', aiScore: 70, aiScoreReason: 'Large fleet deal, early stage', followUps: [
        { type: ActivityType.EMAIL, title: 'Send fleet pricing sheet', body: 'Commercial van bulk pricing.', dueDays: 1, done: false },
      ] },
      { contactIdx: 5, source: 'LinkedIn', status: LeadStatus.UNQUALIFIED, notes: 'Trial lease fell through, budget reallocated.', aiScore: 20, aiScoreReason: 'Budget reallocated elsewhere', followUps: [] },
      { contactIdx: 1, source: 'Walk-in', status: LeadStatus.CONTACTED, notes: 'Sales manager following up on trade-in bundle.', aiScore: 61, aiScoreReason: 'Active buyer, trade-in dependent', followUps: [
        { type: ActivityType.CALL, title: 'Trade-in appraisal call', body: 'Schedule in-person appraisal.', dueDays: 2, done: false },
      ] },
    ],
    tickets: [
      { title: 'DMS crashed during closing', body: 'Dealer management system crashed while finalizing a sale — customer waiting in F&I office.', category: 'Software', priority: TicketPriority.CRITICAL, status: TicketStatus.IN_PROGRESS },
      { title: 'Showroom WiFi down', body: 'Showroom guest WiFi has been down since opening, customers can\'t browse inventory app.', category: 'Network & Connectivity', priority: TicketPriority.HIGH, status: TicketStatus.OPEN },
      { title: 'New salesperson needs DMS access', body: 'New hire starting today needs DMS + CRM login provisioned.', category: 'Access & Permissions', priority: TicketPriority.MEDIUM, status: TicketStatus.PENDING },
      { title: 'Key fob programmer not working', body: 'Service department key fob programmer stopped recognizing new fobs.', category: 'Hardware', priority: TicketPriority.LOW, status: TicketStatus.RESOLVED },
      { title: 'Credit check integration failing', body: 'F&I credit check integration returning timeout errors on all applications.', category: 'Software', priority: TicketPriority.CRITICAL, status: TicketStatus.IN_PROGRESS },
      { title: 'Finance statement discrepancy', body: 'Monthly floor-plan interest statement doesn\'t match lender records.', category: 'Billing & Accounts', priority: TicketPriority.HIGH, status: TicketStatus.OPEN },
    ],
    kb: [
      { title: 'Recovering from a DMS crash mid-transaction', body: 'Do not restart — open a critical ticket immediately, deals-in-progress are recoverable from the transaction log.', category: 'Software' },
      { title: 'Provisioning DMS + CRM for new sales staff', body: 'Submit under Access & Permissions with manager approval and F&I certification status.', category: 'Access & Permissions' },
      { title: 'Showroom WiFi outage checklist', body: 'Check AP status, restart router, escalate to Critical if guest-facing and unresolved after 15 min.', category: 'Network & Connectivity' },
    ],
    customModule: {
      name: 'Vehicle Trade-Ins', icon: 'Car', description: 'Trade-in appraisals synced from the appraisal tool.',
      fields: [
        { label: 'Customer Name', fieldKey: 'customer_name', fieldType: 'TEXT', required: true, isPrimary: true },
        { label: 'Vehicle VIN', fieldKey: 'vehicle_vin', fieldType: 'TEXT', required: true },
        { label: 'Trade-In Value', fieldKey: 'trade_in_value', fieldType: 'CURRENCY', required: true },
        { label: 'Appraisal Date', fieldKey: 'appraisal_date', fieldType: 'DATE' },
      ],
      records: [
        { customer_name: 'Ray Sullivan', vehicle_vin: '1HGCM82633A004352', trade_in_value: 14200, appraisal_date: daysAgo(2).toISOString() },
        { customer_name: 'Monica Alvarez', vehicle_vin: '5TFEV54178X021458', trade_in_value: 9800, appraisal_date: daysAgo(1).toISOString() },
      ],
    },
    dateAutomation: {
      dateField: 'appraisal_date', offsetDays: 2,
      name: 'Trade-In Follow-up Reminder',
      description: 'Notifies the CRM manager 2 days after a trade-in appraisal to close the deal.',
      message: 'A trade-in was appraised 2 days ago and hasn\'t closed yet — follow up before the offer goes stale.',
    },
  },
  {
    // Priced and dated for the Indian market — real estate is the vertical
    // where "₹1.85 Cr" versus "$220,000" is the difference between a demo that
    // lands and one that reads as a foreign product. Every other vertical stays
    // USD/UTC exactly as before.
    slug: 'zenith-realty', orgName: 'Zenith Realty Partners', industry: 'Real Estate', primaryColor: '#0F766E', supportEmail: 'support@zenithrealty.io',
    currency: 'INR', timezone: 'Asia/Kolkata',
    // A property pipeline is walk-in driven and site-visit gated, which is why
    // it looks nothing like the SaaS one.
    stages: stages(['Enquiry', 'Site Visit Scheduled', 'Negotiation', 'Booking Amount']),
    accounts: [
      { name: 'Aurelia Developers', industry: 'Residential Development', website: 'https://aurelia.example.in', phone: '+91-40-4455-1200', address: 'Jubilee Hills, Hyderabad, Telangana 500033' },
      { name: 'Skyline Infra Projects', industry: 'Commercial Development', website: 'https://skylineinfra.example.in', phone: '+91-40-4455-2300', address: 'HITEC City, Madhapur, Hyderabad 500081' },
      { name: 'Nandan Corporate Housing', industry: 'Corporate Leasing', website: 'https://nandanhousing.example.in', phone: '+91-80-2345-6700', address: 'Whitefield, Bengaluru, Karnataka 560066' },
    ],
    contacts: [
      { name: 'Rohan Mehta', email: 'rohan.mehta@aurelia.example.in', phone: '+91-98490-11201', jobTitle: 'Sales Director', accountIdx: 0, source: 'Referral', dateOfBirth: birthdayOn(0, 44) },
      { name: 'Sneha Reddy', email: 'sneha.reddy@aurelia.example.in', phone: '+91-98490-11202', jobTitle: 'Channel Partner Manager', accountIdx: 0, source: 'Property Portal', dateOfBirth: birthdayOn(120, 35) },
      { name: 'Arjun Nair', email: 'arjun.nair@skylineinfra.example.in', phone: '+91-98490-22301', jobTitle: 'VP Leasing', accountIdx: 1, source: 'Property Expo' },
      { name: 'Kavya Iyer', email: 'kavya.iyer@skylineinfra.example.in', phone: '+91-98490-22302', jobTitle: 'Commercial Leasing Head', accountIdx: 1, source: 'LinkedIn' },
      { name: 'Vikram Desai', email: 'vikram.desai@nandanhousing.example.in', phone: '+91-98860-33401', jobTitle: 'Facilities Head', accountIdx: 2, source: 'Referral' },
      { name: 'Priya Balakrishnan', email: 'priya.b@nandanhousing.example.in', phone: '+91-98860-33402', jobTitle: 'Admin Manager', accountIdx: 2, source: 'Website Enquiry' },
    ],
    deals: [
      { title: 'Aurelia Heights — 3BHK Tower B, Unit 1204', value: 18_500_000, stage: 'Negotiation', probability: 70, contactIdx: 0, accountIdx: 0, status: DealStatus.OPEN, closeDays: 21 },
      { title: 'Aurelia Heights — 2BHK Tower A, Unit 0708', value: 11_200_000, stage: 'Site Visit Scheduled', probability: 45, contactIdx: 1, accountIdx: 0, status: DealStatus.OPEN, closeDays: 35 },
      { title: 'Skyline Tech Park — 12,000 sq ft office lease', value: 42_000_000, stage: 'Closed Won', probability: 100, contactIdx: 2, accountIdx: 1, status: DealStatus.WON, closeDays: -14 },
      { title: 'Skyline Tech Park — 4,500 sq ft co-working floor', value: 9_800_000, stage: 'Enquiry', probability: 20, contactIdx: 3, accountIdx: 1, status: DealStatus.OPEN, closeDays: 75 },
      { title: 'Nandan Whitefield — 24-unit corporate lease renewal', value: 27_600_000, stage: 'Booking Amount', probability: 90, contactIdx: 4, accountIdx: 2, status: DealStatus.OPEN, closeDays: 12 },
      { title: 'Nandan Sarjapur — 4BHK villa, Plot 22', value: 32_000_000, stage: 'Closed Lost', probability: 0, contactIdx: 5, accountIdx: 2, status: DealStatus.LOST, closeDays: -8 },
    ],
    leads: [
      { contactIdx: 0, source: 'Property Portal', status: LeadStatus.QUALIFIED, notes: 'Wants a 3BHK in Tower B, east-facing, above 10th floor. Home loan pre-approved with HDFC.', aiScore: 89, aiScoreReason: 'Loan pre-approved, specific unit preference, site visit already done', followUps: [
        { type: ActivityType.MEETING, title: 'Site visit — Tower B model flat', body: 'Show 1204 and the 1104 alternative. Carry the floor plan and amenity sheet.', dueDays: -6, done: true },
        { type: ActivityType.TASK, title: 'Share cost sheet with stamp duty breakup', body: 'Include registration, GST and corpus fund so there are no surprises at booking.', dueDays: 1, done: false },
      ] },
      { contactIdx: 2, source: 'Property Expo', status: LeadStatus.CONTACTED, notes: 'Met at Hyderabad Property Show. Needs 10,000–15,000 sq ft, wants a fit-out allowance.', aiScore: 76, aiScoreReason: 'Large commercial requirement, decision-maker engaged at event', followUps: [
        { type: ActivityType.EMAIL, title: 'Send commercial floor plates + rent card', body: 'Attach the 8th and 9th floor plates with the current rent per sq ft.', dueDays: -2, done: true },
        { type: ActivityType.CALL, title: 'Discuss fit-out allowance', body: 'Confirm what the developer will absorb versus the tenant.', dueDays: 3, done: false },
      ] },
      { contactIdx: 4, source: 'Referral', status: LeadStatus.QUALIFIED, notes: 'Renewal for 24 units at Whitefield. Wants a 3-year lock-in with a 5% annual escalation.', aiScore: 93, aiScoreReason: 'Existing client, renewal due in 12 days, terms already agreed verbally', followUps: [
        { type: ActivityType.MEETING, title: 'Renewal terms sign-off', body: 'Confirm escalation clause and maintenance responsibility before drafting.', dueDays: 2, done: false },
      ] },
      { contactIdx: 5, source: 'Website Enquiry', status: LeadStatus.NEW, notes: 'Enquired about Sarjapur villas. Budget unclear, first-time buyer.', aiScore: 41, aiScoreReason: 'No budget confirmed, no site visit, single web enquiry', followUps: [
        { type: ActivityType.CALL, title: 'Qualification call', body: 'Establish budget, loan status and possession timeline.', dueDays: 1, done: false },
      ] },
      { contactIdx: 3, source: 'LinkedIn', status: LeadStatus.CONTACTED, notes: 'Evaluating co-working floors across three micro-markets.', aiScore: 58, aiScoreReason: 'Comparing multiple locations, timeline not yet fixed', followUps: [
        { type: ActivityType.EMAIL, title: 'Send micro-market comparison', body: 'HITEC City vs Gachibowli vs Kondapur — rent, occupancy and commute data.', dueDays: 4, done: false },
      ] },
    ],
    tickets: [
      { title: 'Sales team cannot open cost sheets on site tablets', body: 'The iPads at the Aurelia Heights site office fail to open the PDF cost sheets since Monday. Two bookings delayed.', category: 'Hardware', priority: TicketPriority.CRITICAL, status: TicketStatus.OPEN },
      { title: 'Property portal listings not syncing', body: 'New Tower B inventory added on Friday still is not showing on the public listing site. Enquiries have dropped noticeably.', category: 'Software', priority: TicketPriority.HIGH, status: TicketStatus.IN_PROGRESS },
      { title: 'Biometric attendance offline at Gachibowli site office', body: 'The site office biometric device has been unreachable since the power cut. Attendance is being noted on paper.', category: 'Hardware', priority: TicketPriority.MEDIUM, status: TicketStatus.PENDING },
      { title: 'Channel partner needs CRM access', body: 'Onboarding a new channel partner — they need read access to their own leads only, nothing else.', category: 'Access & Permissions', priority: TicketPriority.MEDIUM, status: TicketStatus.RESOLVED },
      { title: 'Booking confirmation emails going to spam', body: 'Buyers report booking confirmations landing in spam. Two customers thought their booking had failed.', category: 'Software', priority: TicketPriority.HIGH, status: TicketStatus.IN_PROGRESS },
      { title: 'Stamp duty figures wrong on generated cost sheet', body: 'The cost sheet template still uses the old Telangana stamp duty rate. Every quote generated this week is understated.', category: 'Billing & Accounts', priority: TicketPriority.CRITICAL, status: TicketStatus.OPEN },
    ],
    kb: [
      { title: 'Generating a buyer cost sheet', body: 'Open the deal, choose Quote > Cost Sheet. The template applies the current Telangana stamp duty and registration rates, GST on the agreement value, and the corpus/maintenance advance. Always regenerate rather than editing an old sheet — rates change.', category: 'Billing & Accounts' },
      { title: 'Site visit checklist for the sales team', body: 'Confirm the visit the evening before. Carry: floor plan, amenity sheet, cost sheet, RERA registration number and the possession timeline. Log the outcome in the CRM the same day — a visit not logged is a visit that never happened at review time.', category: 'Access & Permissions' },
      { title: 'Onboarding a channel partner', body: 'Raise an access request with the partner firm name and RERA agent number. They get access to their own sourced leads only. Access is reviewed every quarter and revoked automatically if the agreement lapses.', category: 'Access & Permissions' },
    ],
    customModule: {
      name: 'Property Inventory', icon: 'Building2', description: 'Live unit-level inventory across active projects, synced from the developer sheets.',
      fields: [
        { label: 'Unit Number', fieldKey: 'unit_number', fieldType: 'TEXT', required: true, isPrimary: true },
        { label: 'Project', fieldKey: 'project', fieldType: 'DROPDOWN', options: ['Aurelia Heights', 'Skyline Tech Park', 'Nandan Sarjapur'], required: true },
        { label: 'Configuration', fieldKey: 'configuration', fieldType: 'DROPDOWN', options: ['2BHK', '3BHK', '4BHK Villa', 'Commercial Floor'], required: true },
        { label: 'Carpet Area (sq ft)', fieldKey: 'carpet_area', fieldType: 'NUMBER', required: true },
        { label: 'Asking Price', fieldKey: 'asking_price', fieldType: 'CURRENCY', required: true },
        { label: 'Status', fieldKey: 'status', fieldType: 'DROPDOWN', options: ['Available', 'Blocked', 'Booked', 'Registered'] },
        { label: 'Possession Date', fieldKey: 'possession_date', fieldType: 'DATE' },
      ],
      records: [
        { unit_number: 'Tower B — 1204', project: 'Aurelia Heights', configuration: '3BHK', carpet_area: 1685, asking_price: 18_500_000, status: 'Blocked', possession_date: daysFromNow(5).toISOString() },
        { unit_number: 'Tower A — 0708', project: 'Aurelia Heights', configuration: '2BHK', carpet_area: 1140, asking_price: 11_200_000, status: 'Available', possession_date: daysFromNow(40).toISOString() },
        { unit_number: 'Floor 8 — East Wing', project: 'Skyline Tech Park', configuration: 'Commercial Floor', carpet_area: 12_000, asking_price: 42_000_000, status: 'Registered' },
        { unit_number: 'Plot 22 — Villa', project: 'Nandan Sarjapur', configuration: '4BHK Villa', carpet_area: 3240, asking_price: 32_000_000, status: 'Available', possession_date: daysFromNow(120).toISOString() },
      ],
    },
    dateAutomation: {
      dateField: 'possession_date', offsetDays: -7,
      name: 'Possession Handover Reminder',
      description: 'Notifies the sales manager 7 days before a unit\'s possession date so handover paperwork and the snag list are ready.',
      message: 'A unit reaches possession in 7 days — confirm the snag list is closed and the handover kit is prepared.',
    },
  },
];

export const DEFAULT_VERTICAL = 'techcorp';
export const DEMO_VERTICAL_SLUGS = VERTICALS.map(v => v.slug);

// The default vertical (techcorp) keeps the original @crmitdesk.com domain
// rather than the new @<slug>.demo scheme used by the other 6 verticals —
// the large pre-existing Playwright suite under tests/e2e/ (role-login,
// rbac, rbac-ui, security, pagination, refresh-token, and tests/helpers/
// auth.ts's ADMIN constant) hardcodes admin@crmitdesk.com / crm@crmitdesk.com
// / sales@crmitdesk.com / itmanager@crmitdesk.com / itagent@crmitdesk.com for
// this exact org. Changing this domain for techcorp breaks login for that
// entire suite; every other vertical is free to use the new scheme since
// nothing outside the new client/e2e/ specs depends on their emails.
function domainFor(slug: string): string {
  return slug === DEFAULT_VERTICAL ? 'crmitdesk.com' : `${slug}.demo`;
}

// Optional overrides from server/.env so a real deployment never ships the
// published logins above. Order matches seedEmailsFor(): Super Admin, CRM
// Manager, Sales Rep, IT Manager, IT Agent. Read on every call, not at
// import — index.ts runs dotenv.config() only after its imports.
const SEED_EMAIL_VARS = ['SEED_ADMIN_EMAIL', 'SEED_CRM_EMAIL', 'SEED_SALES_EMAIL', 'SEED_ITMANAGER_EMAIL', 'SEED_ITAGENT_EMAIL'] as const;
const DEFAULT_SEED_LOCALS = ['admin', 'crm', 'sales', 'itmanager', 'itagent'];

/**
 * A configured email for another vertical: emails are unique, so the vertical
 * goes into a plus-tag — you@x.com → you+meridian-health@x.com, you+crm@x.com
 * → you+crm-meridian-health@x.com. Gmail and most providers deliver plus
 * addresses to the same inbox.
 */
function tagForVertical(email: string, slug: string): string {
  if (slug === DEFAULT_VERTICAL) return email;
  const [local, domain] = email.split('@');
  return local.includes('+') ? `${local}-${slug}@${domain}` : `${local}+${slug}@${domain}`;
}

function seedEmailsFor(slug: string): string[] {
  return SEED_EMAIL_VARS.map((key, i) => {
    const configured = process.env[key]?.trim().toLowerCase();
    return configured ? tagForVertical(configured, slug) : `${DEFAULT_SEED_LOCALS[i]}@${domainFor(slug)}`;
  });
}

/** Password for every seeded login — SEED_PASSWORD from server/.env, else the published demo default. */
function seedPassword(): string {
  return process.env.SEED_PASSWORD || 'Admin@123';
}

/** The email the "Try Demo" button logs in as for a given vertical — Super Admin so nothing looks locked during a walkthrough. */
export function loginEmailFor(slug: string): string {
  return seedEmailsFor(slug)[0];
}

// ─── Generator ──────────────────────────────────────────────────────────────


/**
 * The HR half of a demo org: departments, a location, employee records for each
 * seeded login, a real reporting line, and one staff member with no login at
 * all — the case the old User-only model could not represent, and the quickest
 * way to show why Employee is a separate entity.
 *
 * Extracted from buildOrg so a failure here is catchable and non-fatal: the
 * demo's essential output is working logins and a populated pipeline.
 */
async function buildPeople(
  org: { id: string },
  preset: VerticalPreset,
  users: { admin: { id: string; email: string }; crmMgr: { id: string; email: string }; salesRep: { id: string; email: string }; itMgr: { id: string; email: string }; itAgent: { id: string; email: string } }
) {
  const { admin, crmMgr, salesRep, itMgr, itAgent } = users;
  const [deptOps, deptSales, deptIt] = await Promise.all([
    prisma.department.create({ data: { orgId: org.id, name: 'Operations', code: 'OPS' } }),
    prisma.department.create({ data: { orgId: org.id, name: 'Sales', code: 'SALES' } }),
    prisma.department.create({ data: { orgId: org.id, name: 'IT', code: 'IT' } }),
  ]);

  const hq = await prisma.location.create({
    data: { orgId: org.id, name: `${preset.orgName} HQ`, type: 'HEAD_OFFICE', city: 'Hyderabad', country: 'India' },
  });

  // Admin first — everyone else reports into them, so their id is needed below.
  const empAdmin = await prisma.employee.create({
    data: {
      orgId: org.id, userId: admin.id, employeeCode: 'EMP-0001',
      firstName: 'Alex', lastName: 'Admin', displayName: 'Alex Admin',
      workEmail: admin.email, designation: 'Chief Operating Officer',
      departmentId: deptOps.id, locationId: hq.id,
      joiningDate: daysAgo(1200), employmentType: 'FULL_TIME', employmentStatus: 'ACTIVE',
    },
  });

  const [empCrmMgr, empItMgr] = await Promise.all([
    prisma.employee.create({
      data: {
        orgId: org.id, userId: crmMgr.id, employeeCode: 'EMP-0002',
        firstName: 'Carla', lastName: 'Chen', displayName: 'Carla Chen',
        workEmail: crmMgr.email, designation: 'Head of Sales',
        departmentId: deptSales.id, locationId: hq.id, managerId: empAdmin.id,
        joiningDate: daysAgo(900), employmentType: 'FULL_TIME', employmentStatus: 'ACTIVE',
      },
    }),
    prisma.employee.create({
      data: {
        orgId: org.id, userId: itMgr.id, employeeCode: 'EMP-0003',
        firstName: 'Ivy', lastName: 'IT', displayName: 'Ivy IT',
        workEmail: itMgr.email, designation: 'IT Manager',
        departmentId: deptIt.id, locationId: hq.id, managerId: empAdmin.id,
        joiningDate: daysAgo(820), employmentType: 'FULL_TIME', employmentStatus: 'ACTIVE',
      },
    }),
  ]);

  await Promise.all([
    prisma.employee.create({
      data: {
        orgId: org.id, userId: salesRep.id, employeeCode: 'EMP-0004',
        firstName: 'Sam', lastName: 'Sales', displayName: 'Sam Sales',
        workEmail: salesRep.email, designation: 'Account Executive',
        departmentId: deptSales.id, locationId: hq.id, managerId: empCrmMgr.id,
        joiningDate: daysAgo(400), employmentType: 'FULL_TIME', employmentStatus: 'ACTIVE',
      },
    }),
    prisma.employee.create({
      data: {
        orgId: org.id, userId: itAgent.id, employeeCode: 'EMP-0005',
        firstName: 'Dave', lastName: 'Desk', displayName: 'Dave Desk',
        workEmail: itAgent.email, designation: 'Support Technician',
        departmentId: deptIt.id, locationId: hq.id, managerId: empItMgr.id,
        joiningDate: daysAgo(210), employmentType: 'FULL_TIME', employmentStatus: 'PROBATION',
      },
    }),
    // A staff member with no login at all — the case the old User-only model
    // could not represent, and the quickest way to show why the split exists.
    prisma.employee.create({
      data: {
        orgId: org.id, employeeCode: 'EMP-0006',
        firstName: 'Ravi', lastName: 'Kumar', displayName: 'Ravi Kumar',
        designation: 'Facilities Coordinator',
        departmentId: deptOps.id, locationId: hq.id, managerId: empAdmin.id,
        joiningDate: daysAgo(150), employmentType: 'CONTRACT', employmentStatus: 'ACTIVE',
      },
    }),
  ]);

  await prisma.department.update({ where: { id: deptOps.id }, data: { headId: empAdmin.id } });
  await prisma.department.update({ where: { id: deptSales.id }, data: { headId: empCrmMgr.id } });
  await prisma.department.update({ where: { id: deptIt.id }, data: { headId: empItMgr.id } });
}

/**
 * Confirms the people-platform tables exist before any org is torn down.
 *
 * buildOrg() deletes the existing org *before* rebuilding it, so anything that
 * throws mid-rebuild leaves no org at all — which takes the demo logins with
 * it. That is exactly what happens if the seed runs before
 * `prisma migrate dev` has created the Employee/Department/Location tables.
 *
 * Checking here turns a destructive half-failure into a clear message with
 * nothing lost.
 */
let peoplePlatformReady: boolean | null = null;

async function checkPeoplePlatform(): Promise<boolean> {
  if (peoplePlatformReady !== null) return peoplePlatformReady;
  try {
    // Cheapest possible probe: fails with P2021 if the table isn't there.
    await prisma.employee.findFirst({ select: { id: true } });
    peoplePlatformReady = true;
  } catch {
    peoplePlatformReady = false;
    console.warn(
      '[seed] The Employee/Department tables are missing — run `npx prisma migrate dev` first.\n' +
      '       Seeding will continue and produce a complete CRM/IT Desk demo, but the HR\n' +
      '       module (employees, org chart, departments) will be empty for these orgs.'
    );
  }
  return peoplePlatformReady;
}

async function buildOrg(preset: VerticalPreset) {
  const seedEmails = seedEmailsFor(preset.slug);
  // Probe BEFORE the destructive delete below, never after.
  const hasPeoplePlatform = await checkPeoplePlatform();

  const existing = await prisma.organization.findUnique({ where: { slug: preset.slug } });
  if (existing) {
    await prisma.organization.delete({ where: { id: existing.id } });
    await prisma.user.deleteMany({ where: { email: { in: seedEmails } } });
  }

  const org = await prisma.organization.create({ data: { name: preset.orgName, slug: preset.slug, currency: preset.currency ?? 'USD', timezone: preset.timezone ?? 'UTC' } });

  const passwordHash = await hash(seedPassword());
  const [admin, crmMgr, salesRep, itMgr, itAgent] = await Promise.all([
    prisma.user.create({ data: { orgId: org.id, name: 'Alex Admin', email: seedEmails[0], passwordHash, role: UserRole.SUPER_ADMIN, department: 'Operations' } }),
    // 'Carla Chen' (not a made-up name) — tests/e2e/role-login.spec.ts,
    // rbac.spec.ts and rbac-ui.spec.ts all assert this exact display name for
    // the CRM_MANAGER seed user.
    prisma.user.create({ data: { orgId: org.id, name: 'Carla Chen', email: seedEmails[1], passwordHash, role: UserRole.CRM_MANAGER, department: 'Sales' } }),
    prisma.user.create({ data: { orgId: org.id, name: 'Sam Sales', email: seedEmails[2], passwordHash, role: UserRole.SALES_REP, department: 'Sales' } }),
    prisma.user.create({ data: { orgId: org.id, name: 'Ivy IT', email: seedEmails[3], passwordHash, role: UserRole.IT_MANAGER, department: 'IT' } }),
    prisma.user.create({ data: { orgId: org.id, name: 'Dave Desk', email: seedEmails[4], passwordHash, role: UserRole.IT_AGENT, department: 'IT' } }),
  ]);

  // ── People platform ────────────────────────────────────────────────────────
  // Every seeded login is also a person: departments, employee records and a
  // real reporting line. Without this a demo org shows five users and an empty
  // HR module, and the org chart — one of the more persuasive screens — has
  // nothing to draw.
  //
  // Deliberately best-effort. The demo's job is working logins and a populated
  // CRM/IT Desk; the HR layer is a bonus on top. If anything here fails the org
  // still finishes building, rather than a missing column costing you every
  // demo account.
  if (hasPeoplePlatform) {
    try {
      await buildPeople(org, preset, { admin, crmMgr, salesRep, itMgr, itAgent });
    } catch (err) {
      console.error(`[seed] ${preset.slug}: HR data skipped — ${(err as Error).message}`);
    }
  }

  await prisma.orgBranding.create({ data: { orgId: org.id, primaryColor: preset.primaryColor, supportEmail: preset.supportEmail, portalTitle: `${preset.orgName} Support`, portalWelcome: 'Welcome! Submit and track your requests here.' } });

  await prisma.subscription.create({ data: { orgId: org.id, plan: 'ENTERPRISE', status: 'active', seats: 999, currentPeriodEnd: daysFromNow(30) } });

  const [tagVip, tagHot, tagEnterprise, tagUrgent] = await Promise.all([
    prisma.tag.create({ data: { orgId: org.id, name: 'VIP', color: '#F59E0B', module: 'CRM' } }),
    prisma.tag.create({ data: { orgId: org.id, name: 'Hot Lead', color: '#EF4444', module: 'CRM' } }),
    prisma.tag.create({ data: { orgId: org.id, name: 'Key Account', color: '#6366F1', module: 'CRM' } }),
    prisma.tag.create({ data: { orgId: org.id, name: 'Urgent', color: '#DC2626', module: 'ITDESK' } }),
  ]);

  const accounts = await Promise.all(preset.accounts.map((a, i) =>
    prisma.account.create({ data: { orgId: org.id, name: a.name, industry: a.industry, website: a.website, phone: a.phone, address: a.address, ownerId: i % 2 === 0 ? crmMgr.id : salesRep.id } })
  ));

  const contacts = await Promise.all(preset.contacts.map(c =>
    prisma.contact.create({ data: { orgId: org.id, ownerId: c.accountIdx % 2 === 0 ? crmMgr.id : salesRep.id, name: c.name, email: c.email, phone: c.phone, jobTitle: c.jobTitle, accountId: accounts[c.accountIdx].id, source: c.source, dateOfBirth: c.dateOfBirth ? new Date(c.dateOfBirth) : undefined } })
  ));
  // Tags are polymorphic now (record_tags), so the same call shape works for
  // a ticket or an asset — the demo just happens to tag contacts and a deal.
  await prisma.recordTag.createMany({
    data: [
      { orgId: org.id, tagId: tagVip.id,        entityType: 'CONTACT', entityId: contacts[0].id },
      { orgId: org.id, tagId: tagEnterprise.id, entityType: 'CONTACT', entityId: contacts[0].id },
      { orgId: org.id, tagId: tagEnterprise.id, entityType: 'CONTACT', entityId: contacts[2].id },
    ],
  });

  const pipeline = await prisma.pipeline.create({ data: { orgId: org.id, name: `${preset.industry} Pipeline`, isDefault: true, stages: preset.stages as any } });

  const deals = await Promise.all(preset.deals.map(d =>
    prisma.deal.create({ data: { orgId: org.id, pipelineId: pipeline.id, title: d.title, value: d.value, stage: d.stage, probability: d.probability, contactId: contacts[d.contactIdx].id, accountId: accounts[d.accountIdx].id, assignedTo: d.contactIdx % 2 === 0 ? salesRep.id : crmMgr.id, status: d.status, closeDate: daysFromNow(d.closeDays) } })
  ));
  await Promise.all(deals.slice(0, 2).map((deal, i) =>
    prisma.dealHistory.create({ data: { dealId: deal.id, toStage: deal.stage, changedBy: salesRep.id, changedAt: daysAgo(15 - i * 5) } })
  ));
  await prisma.recordTag.create({ data: { orgId: org.id, tagId: tagVip.id, entityType: 'DEAL', entityId: deals[2].id } });

  // LEADS + follow-up activities — the "leads only convert, no follow-up"
  // gap this whole feature closes: every lead here gets 1-2 scheduled
  // activities (call/email/task/meeting), some already done, some pending.
  const leads = await Promise.all(preset.leads.map(l =>
    prisma.lead.create({ data: { orgId: org.id, contactId: contacts[l.contactIdx].id, source: l.source, status: l.status, assignedTo: l.contactIdx % 2 === 0 ? salesRep.id : crmMgr.id, notes: l.notes, aiScore: l.aiScore, aiScoreReason: l.aiScoreReason } })
  ));
  await Promise.all(preset.leads.flatMap((l, li) => l.followUps.map(f =>
    prisma.activity.create({ data: { orgId: org.id, type: f.type, title: f.title, body: f.body, leadId: leads[li].id, contactId: contacts[l.contactIdx].id, createdBy: li % 2 === 0 ? salesRep.id : crmMgr.id, dueAt: daysFromNow(f.dueDays), done: f.done } })
  )));
  // A couple of deal-side activities too, same as before.
  await Promise.all([
    prisma.activity.create({ data: { orgId: org.id, type: ActivityType.CALL, title: 'Discovery call', body: 'Initial discovery and needs assessment.', contactId: contacts[0].id, dealId: deals[0].id, createdBy: salesRep.id, dueAt: daysAgo(8), done: true } }),
    prisma.activity.create({ data: { orgId: org.id, type: ActivityType.MEETING, title: 'Quarterly business review', body: 'Present YTD value and roadmap.', contactId: contacts[4].id, createdBy: admin.id, dueAt: daysFromNow(7), done: false } }),
  ]);

  const [slaStandard, slaPremium, slaCritical] = await Promise.all([
    prisma.slaPolicy.create({ data: { orgId: org.id, name: 'Standard SLA', responseHours: 8, resolutionHours: 48 } }),
    prisma.slaPolicy.create({ data: { orgId: org.id, name: 'Premium SLA', responseHours: 4, resolutionHours: 24 } }),
    prisma.slaPolicy.create({ data: { orgId: org.id, name: 'Critical Response SLA', responseHours: 1, resolutionHours: 4 } }),
  ]);
  const categoryNames = ['Hardware', 'Software', 'Network & Connectivity', 'Access & Permissions', 'Billing & Accounts'];
  const categoryPolicies = [slaStandard, slaStandard, slaPremium, slaPremium, slaCritical];
  const categories: Record<string, { id: string }> = {};
  for (let i = 0; i < categoryNames.length; i++) {
    categories[categoryNames[i]] = await prisma.category.create({ data: { orgId: org.id, name: categoryNames[i], slaPolicyId: categoryPolicies[i].id } });
  }

  const tickets = await Promise.all(preset.tickets.map((t, i) =>
    prisma.ticket.create({ data: { orgId: org.id, title: t.title, body: t.body, categoryId: categories[t.category]?.id, priority: t.priority, status: t.status, requesterId: i % 2 === 0 ? admin.id : salesRep.id, assignedTo: i % 2 === 0 ? itAgent.id : itMgr.id, sentiment: t.priority === TicketPriority.CRITICAL ? 'NEGATIVE' : 'NEUTRAL', slaDueAt: daysFromNow(2), createdAt: daysAgo(i + 1) } })
  ));
  await prisma.ticketHistory.create({ data: { ticketId: tickets[0].id, fromStatus: TicketStatus.OPEN, toStatus: tickets[0].status, changedBy: itAgent.id } });

  await Promise.all([
    prisma.comment.create({ data: { authorId: itAgent.id, entityType: 'TICKET', entityId: tickets[0].id, body: 'Investigating now — will update shortly.', createdAt: daysAgo(1) } }),
    prisma.comment.create({ data: { authorId: salesRep.id, entityType: 'DEAL', entityId: deals[0].id, body: 'Great call today, moving forward with next steps.', createdAt: daysAgo(3) } }),
  ]);

  await prisma.timeEntry.create({ data: { orgId: org.id, ticketId: tickets[0].id, userId: itAgent.id, description: 'Initial diagnosis and remote troubleshooting', minutes: 45, loggedAt: daysAgo(1) } });

  const assets = await Promise.all([
    prisma.asset.create({ data: { orgId: org.id, name: `${admin.name}'s Laptop`, type: 'Laptop', serialNumber: `SN-${preset.slug.toUpperCase()}-001`, assignedTo: admin.id, status: 'active', purchaseDate: daysAgo(365) } }),
    prisma.asset.create({ data: { orgId: org.id, name: `${itAgent.name}'s Workstation`, type: 'Desktop', serialNumber: `SN-${preset.slug.toUpperCase()}-002`, assignedTo: itAgent.id, status: 'active', purchaseDate: daysAgo(200) } }),
    prisma.asset.create({ data: { orgId: org.id, name: 'Shared Printer', type: 'Printer', serialNumber: `SN-${preset.slug.toUpperCase()}-003`, status: 'maintenance', purchaseDate: daysAgo(730) } }),
  ]);
  await prisma.ticketAsset.create({ data: { ticketId: tickets[0].id, assetId: assets[0].id } });

  await prisma.csatResponse.create({ data: { orgId: org.id, ticketId: tickets[0].id, rating: 5, comment: 'Fast, friendly support!' } });

  await Promise.all(preset.kb.map(k =>
    prisma.knowledgeArticle.create({ data: { orgId: org.id, authorId: itMgr.id, title: k.title, body: k.body, categoryId: categories[k.category]?.id, status: ArticleStatus.PUBLISHED, publishedAt: daysAgo(20) } })
  ));

  // Workflow rules — one per newly-wired trigger, so every automation added
  // in this feature set is visible and running in the demo, not just in code.
  await Promise.all([
    prisma.workflowRule.create({ data: { orgId: org.id, name: 'Notify manager when a deal enters the final stage', description: `Fires when a deal moves to "${preset.stages[3].label}" — the last stage before Won.`, trigger: 'DEAL_STAGE_CHANGED', conditions: [{ field: 'stage', operator: 'eq', value: preset.stages[3].label }], actions: [{ type: 'CREATE_NOTIFICATION', params: { title: 'Deal nearing close', body: `{{title}} just moved to ${preset.stages[3].label}`, recipientType: 'ASSIGNEE' } }], isActive: true, runCount: 0 } }),
    prisma.workflowRule.create({ data: { orgId: org.id, name: 'Score new leads automatically', description: 'Runs AI scoring the moment a lead is created.', trigger: 'LEAD_CREATED', conditions: [], actions: [{ type: 'SCORE_LEAD', params: {} }], isActive: true, runCount: 0 } }),
    prisma.workflowRule.create({ data: { orgId: org.id, name: 'Notify on completed follow-up', description: 'Notifies the CRM manager whenever a lead follow-up activity is marked done.', trigger: 'LEAD_ACTIVITY_COMPLETED', conditions: [], actions: [{ type: 'CREATE_NOTIFICATION', params: { title: 'Follow-up completed', body: 'A lead follow-up was just marked done', userId: crmMgr.id } }], isActive: true, runCount: 0 } }),
    prisma.workflowRule.create({ data: { orgId: org.id, name: 'Auto-assign critical tickets to IT Manager', description: 'When a critical ticket is created, assign it to the IT manager.', trigger: 'TICKET_CREATED', conditions: [{ field: 'priority', operator: 'eq', value: 'CRITICAL' }], actions: [{ type: 'ASSIGN_TO', params: { userId: itMgr.id } }], isActive: true, runCount: 3 } }),
    // Feedback survey — previously a hardcoded 5s-after-resolve setTimeout
    // in tickets.controller.ts; now a normal, editable/disable-able rule
    // (see workflow-engine.ts's SEND_CSAT_SURVEY case) so every org can
    // condition or turn off customer feedback requests without a code change.
    prisma.workflowRule.create({ data: { orgId: org.id, name: 'Send Feedback Survey', description: 'Emails the requester a 1-5 star feedback request whenever their ticket is marked Resolved.', trigger: 'TICKET_STATUS_CHANGED', conditions: [{ field: 'status', operator: 'eq', value: 'RESOLVED' }], actions: [{ type: 'SEND_CSAT_SURVEY', params: {} }], isActive: true, runCount: 0 } }),
    // Date-driven follow-ups (see utils/dateAutomation.ts) — the "salon
    // CRM" style automations: birthday wishes here (identical across every
    // vertical, since it only depends on Contact.dateOfBirth), plus one
    // vertical-flavored reminder built on the custom module below.
    prisma.workflowRule.create({ data: {
      orgId: org.id, name: 'Birthday Wishes', description: 'Sends a birthday email and notifies the CRM manager whenever a contact\'s birthday comes around.',
      trigger: 'DATE_FIELD_REACHED',
      dateConfig: { entityType: 'CONTACT', dateField: 'dateOfBirth', offsetDays: 0, recurrence: 'YEARLY' },
      conditions: [],
      actions: [
        { type: 'SEND_EMAIL', params: { to: '{{email}}', subject: `Happy Birthday from ${preset.orgName}!`, body: `Hi {{name}},\n\nWishing you a wonderful birthday from all of us at ${preset.orgName}! As a thank-you, enjoy 10% off your next visit.\n\nWarmly,\nThe ${preset.orgName} Team` } },
        { type: 'CREATE_NOTIFICATION', params: { title: 'Contact birthday today', body: 'A birthday email just went out to {{name}} — a nice moment to check in personally.', userId: crmMgr.id } },
      ],
      isActive: true, runCount: 0,
    } }),
    // The vertical-specific reminder (built on the custom module's own DATE
    // field) is created further down, once the module itself exists — see
    // "moduleFields" below.
  ]);

  await Promise.all([
    prisma.portalUser.create({ data: { orgId: org.id, name: contacts[0].name, email: `portal.${contacts[0].email}`, isActive: true, lastLoginAt: daysAgo(1) } }),
    prisma.portalUser.create({ data: { orgId: org.id, name: contacts[2].name, email: `portal.${contacts[2].email}`, isActive: true, lastLoginAt: daysAgo(3) } }),
  ]);

  await prisma.campaign.create({ data: { orgId: org.id, name: 'Quarterly Product Update', subject: `What's new at ${preset.orgName}`, body: `Dear {{name}},\n\nHere's what's new this quarter...\n\nBest,\nThe ${preset.orgName} Team`, targetType: 'LEADS', status: 'SENT', sentAt: daysAgo(7), sentCount: 128 } });

  await Promise.all([
    prisma.changeRequest.create({ data: { orgId: org.id, title: 'Upgrade network switches', description: 'Replace floor-level switches to support growing workload.', type: 'NORMAL', priority: 'HIGH', status: 'APPROVED', requestedBy: itMgr.id, assignedTo: itAgent.id, plannedStart: daysFromNow(5), plannedEnd: daysFromNow(6), approvedBy: admin.id, approvedAt: daysAgo(2) } }),
  ]);

  await prisma.customField.create({ data: { orgId: org.id, entityType: 'DEAL', label: 'Contract Type', fieldKey: 'contract_type', fieldType: 'SELECT', options: ['Annual', 'Multi-year', 'Monthly', 'One-time'], position: 1 } });

  await prisma.quote.create({ data: { orgId: org.id, dealId: deals[0].id, title: `Q-${preset.slug.toUpperCase()}-001`, status: 'SENT', notes: 'Valid for 30 days.', validUntil: daysFromNow(30), createdBy: salesRep.id, lines: { create: [{ description: `${preset.orgName} Enterprise Licence`, quantity: 1, unitPrice: Number(deals[0].value), discount: 0 }] } } });

  const conv = await prisma.conversation.create({ data: { orgId: org.id, channel: 'EMAIL', contactName: contacts[0].name, contactEmail: contacts[0].email, subject: `Re: ${deals[0].title}`, status: 'OPEN', assignedTo: salesRep.id, lastMessageAt: daysAgo(1), unreadCount: 1 } });
  await prisma.message.create({ data: { conversationId: conv.id, direction: 'INBOUND', fromAddress: contacts[0].email!, toAddress: preset.supportEmail, body: 'Thanks for the call today — sending over our questions shortly.', sentAt: daysAgo(1) } });

  await Promise.all([
    prisma.notification.create({ data: { orgId: org.id, userId: itAgent.id, type: 'ASSIGNMENT', title: 'Ticket assigned to you', body: tickets[0].title, entityType: 'TICKET', entityId: tickets[0].id } }),
    prisma.notification.create({ data: { orgId: org.id, userId: salesRep.id, type: 'STATUS_CHANGE', title: 'Deal update', body: `${deals[0].title} was updated`, entityType: 'DEAL', entityId: deals[0].id } }),
  ]);

  await Promise.all([
    prisma.auditLog.create({ data: { userId: admin.id, action: 'USER_CREATED', entityType: 'User', entityId: salesRep.id, changes: { name: salesRep.name }, createdAt: daysAgo(30) } }),
    prisma.auditLog.create({ data: { userId: salesRep.id, action: 'DEAL_CREATED', entityType: 'Deal', entityId: deals[0].id, changes: { title: deals[0].title }, createdAt: daysAgo(20) } }),
  ]);

  await Promise.all([
    prisma.aICustomRule.create({ data: { orgId: org.id, name: 'Auto-Tag Billing Tickets', description: 'Tag any ticket mentioning invoices or billing.', trigger: 'TICKET_CREATED', action: 'TAG', customPrompt: 'If it mentions billing, invoice, payment, or charges, return tag "billing".', isActive: true, runCount: 0 } }),
    prisma.aICustomRule.create({ data: { orgId: org.id, name: 'Smart Lead Follow-up', description: 'Generate a personalised follow-up email for high-scoring leads.', trigger: 'LEAD_SCORED', action: 'EMAIL', customPrompt: 'Generate a warm professional follow-up email for {{contact_name}}. Under 150 words.', isActive: true, runCount: 0 } }),
  ]);

  // Custom module — demonstrates the no-code object builder + shows a
  // couple of pre-loaded records as if a first sync had already run.
  const module_ = await prisma.customModule.create({ data: { orgId: org.id, name: preset.customModule.name, slug: preset.customModule.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), icon: preset.customModule.icon, description: preset.customModule.description, createdBy: admin.id } });
  const moduleFields = await Promise.all(preset.customModule.fields.map((f, i) =>
    prisma.customModuleField.create({ data: { moduleId: module_.id, label: f.label, fieldKey: f.fieldKey, fieldType: f.fieldType, options: f.options, required: f.required ?? false, isPrimary: f.isPrimary ?? false, position: i } })
  ));
  await Promise.all(preset.customModule.records.map(r =>
    prisma.customModuleRecord.create({ data: { moduleId: module_.id, orgId: org.id, data: r as Prisma.InputJsonValue, source: 'MANUAL', createdBy: admin.id } })
  ));
  void moduleFields;

  // The vertical-flavored half of the date-driven follow-up automations —
  // needs module_.id, so it's created here rather than alongside "Birthday
  // Wishes" further up. See preset.dateAutomation's doc comment.
  await prisma.workflowRule.create({ data: {
    orgId: org.id, name: preset.dateAutomation.name, description: preset.dateAutomation.description,
    trigger: 'DATE_FIELD_REACHED',
    dateConfig: { entityType: 'CUSTOM_MODULE', moduleId: module_.id, dateField: preset.dateAutomation.dateField, offsetDays: preset.dateAutomation.offsetDays, recurrence: 'ONCE' },
    conditions: [],
    actions: [{ type: 'CREATE_NOTIFICATION', params: { title: preset.dateAutomation.name, body: preset.dateAutomation.message, userId: crmMgr.id } }],
    isActive: true, runCount: 0,
  } });

  // ── AI showcase layer ──────────────────────────────────────────────────────
  // Bulk, purpose-built records so every AI feature has visible material in a
  // demo — duplicate clusters for the duplicate detector, a long thread for
  // summarisation, a resolved thread for KB generation, a scoring ladder for
  // leads, stale deals for pipeline health, an inactive account for churn
  // risk, and 90 days of ticket/deal history so the analytics charts have a
  // real shape. Best-effort: a failure here must never cost the demo org.
  try {
    await buildAiShowcase({ org, admin, crmMgr, salesRep, itMgr, itAgent, categories, pipeline, preset, accounts, contacts });
  } catch (err) {
    console.error(`[seed] ${preset.slug}: AI showcase layer skipped — ${(err as Error).message}`);
  }

  console.log(`[seed] ${preset.orgName} (${preset.slug}) seeded — login as ${loginEmailFor(preset.slug)}${process.env.SEED_PASSWORD ? ' (SEED_PASSWORD)' : ' / Admin@123'}`);
  return org;
}

// ─── AI showcase layer ────────────────────────────────────────────────────────
// Everything in here exists to make one specific AI feature demonstrable.
// The "why this record exists" comments are the demo script.

async function buildAiShowcase(ctx: {
  org: { id: string }; admin: { id: string }; crmMgr: { id: string }; salesRep: { id: string };
  itMgr: { id: string }; itAgent: { id: string };
  categories: Record<string, { id: string }>; pipeline: { id: string };
  preset: VerticalPreset; accounts: { id: string }[]; contacts: { id: string; name: string | null; email: string | null }[];
}) {
  const { org, admin, crmMgr, salesRep, itMgr, itAgent, categories, pipeline, preset } = ctx;
  const orgId = org.id;
  const cat = (n: string) => categories[n]?.id;
  const hourAgo = (h: number) => new Date(Date.now() - h * 3600_000);
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000);

  // ── 1. Duplicate-detector clusters (AI: ticket.duplicate) ─────────────────
  // Three families of OPEN tickets phrased differently but describing the
  // same problem. Typing a fourth variation into "New Ticket" makes the
  // duplicate warning fire with high confidence.
  const dupClusters: { category: string; priority: TicketPriority; titles: [string, string][] }[] = [
    { category: 'Network & Connectivity', priority: TicketPriority.HIGH, titles: [
      ['VPN disconnects every few minutes', 'Working from home, the VPN drops roughly every 10 minutes and I have to reconnect manually.'],
      ['VPN connection keeps dropping on my laptop', 'Since Monday the VPN tunnel dies whenever my laptop sleeps or switches networks.'],
      ['Cannot stay connected to the VPN from home office', 'The client connects fine but disconnects after a short while. Ethernet and Wi-Fi both affected.'],
    ]},
    { category: 'Software', priority: TicketPriority.MEDIUM, titles: [
      ['Outlook stopped syncing new emails', 'Outlook shows "Trying to connect…" and no new mail arrives since this morning. Webmail works fine.'],
      ['Emails not coming through in Outlook desktop', 'Colleagues say they sent me mail but nothing lands in the desktop client. Phone gets them instantly.'],
    ]},
    { category: 'Access & Permissions', priority: TicketPriority.MEDIUM, titles: [
      ['Locked out of my account after password change', 'Changed my password yesterday, now every login says "account locked". Need access urgently.'],
      ['Account keeps locking after the password reset', 'Reset via the portal, but I get locked out again within the hour — probably an old session retrying.'],
    ]},
  ];
  for (const c of dupClusters) {
    // Sequential — modest batches keep pooled Neon connections happy.
    for (const [title, body] of c.titles) {
      await prisma.ticket.create({ data: {
        orgId, title, body, categoryId: cat(c.category), priority: c.priority,
        status: TicketStatus.OPEN, requesterId: salesRep.id, assignedTo: itAgent.id,
        sentiment: 'NEUTRAL', slaDueAt: daysFromNow(1), createdAt: daysAgo(Math.ceil(Math.random() * 0) + 2),
      }});
    }
  }

  // ── 2. The "story" ticket (AI: thread summary + resolution estimate) ──────
  // One long, realistic investigation thread. "Summarize" compresses nine
  // messages into four lines — the single most convincing AI moment on a
  // busy ticket.
  const story = await prisma.ticket.create({ data: {
    orgId, title: 'CRM dashboard extremely slow every morning 9-10am',
    body: 'Every weekday between 9 and 10am the dashboard takes 30+ seconds to load and sometimes times out entirely. Fine the rest of the day. Whole sales team affected.',
    categoryId: cat('Software'), priority: TicketPriority.HIGH, status: TicketStatus.IN_PROGRESS,
    requesterId: crmMgr.id, assignedTo: itMgr.id, sentiment: 'NEGATIVE', slaDueAt: hoursFromNow(6), createdAt: daysAgo(4),
  }});
  const storyThread: [string, string][] = [
    [itMgr.id,  'Acknowledged — the 9-10am window suggests load-related. Pulling APM traces for that period now.'],
    [crmMgr.id, 'Thanks. To add: exports also fail during that window with a 504 error. Team is starting the day 30 minutes late because of this.'],
    [itMgr.id,  'Traces show the reporting queries pinning the database CPU at 97% between 8:55 and 10:05. Overnight aggregation job appears to still be running into business hours.'],
    [itAgent.id, 'Confirmed — the nightly aggregation job started taking 4+ hours after the last data import doubled row counts. It used to finish by 6am.'],
    [itMgr.id,  'Two-part plan: (1) move the aggregation window to 2am and add an index on report_events(org_id, created_at); (2) longer term, move aggregation to a read replica.'],
    [crmMgr.id, 'Whatever gets us usable dashboards by tomorrow morning works for me.'],
    [itAgent.id, 'Index created in staging — aggregation runtime dropped from 4h10m to 38 minutes. Rolling to production tonight with the 2am schedule.'],
    [itMgr.id,  'Production change applied at 01:50. Will monitor tomorrow between 9 and 10 before we call it fixed.'],
    [crmMgr.id, 'This morning: dashboard loaded in under 3 seconds at 9:15. Huge improvement — keep it monitored this week please.'],
  ];
  for (let i = 0; i < storyThread.length; i++) {
    await prisma.comment.create({ data: { authorId: storyThread[i][0], entityType: 'TICKET', entityId: story.id, body: storyThread[i][1], createdAt: hourAgo((storyThread.length - i) * 7) } });
  }

  // ── 3. Resolved ticket with a clean fix thread (AI: KB article generator) ─
  // "Generate KB Article" on this one produces a genuinely publishable
  // article, because the thread already contains symptoms, cause, and fix.
  const kbSource = await prisma.ticket.create({ data: {
    orgId, title: 'Shared drive not mounting after the latest OS update',
    body: 'After last night\'s OS update my shared S: drive no longer appears. "Network path not found" when I try to map it manually.',
    categoryId: cat('Network & Connectivity'), priority: TicketPriority.MEDIUM, status: TicketStatus.RESOLVED,
    requesterId: admin.id, assignedTo: itAgent.id, sentiment: 'NEUTRAL', slaDueAt: daysAgo(1), createdAt: daysAgo(6), resolvedAt: daysAgo(5),
  }});
  const kbThread: [string, string][] = [
    [itAgent.id, 'The update resets SMB protocol settings. Can you run "winver" and tell me the build number?'],
    [admin.id,   'Build 26100.2033.'],
    [itAgent.id, 'That build disables SMB1 and resets credential caching. Fix: (1) open Credential Manager and remove the stale entry for the file server; (2) reconnect with net use S: \\\\fileserver\\shared /persistent:yes; (3) re-enter domain credentials when prompted.'],
    [admin.id,   'Followed all three steps — drive is back and survives a reboot. Thank you!'],
    [itAgent.id, 'Resolving. Note for the team: expect a wave of these after each OS rollout wave — the fix takes two minutes per user.'],
  ];
  for (let i = 0; i < kbThread.length; i++) {
    await prisma.comment.create({ data: { authorId: kbThread[i][0], entityType: 'TICKET', entityId: kbSource.id, body: kbThread[i][1], createdAt: daysAgo(6 - i * 0.1) } });
  }

  // ── 4. Sentiment + SLA-risk spread (AI: ticket.sentiment / ticket.slaRisk) ─
  const moodTickets: { title: string; body: string; sentiment: string; priority: TicketPriority; status: TicketStatus; category: string; slaInH: number }[] = [
    { title: 'THIRD time reporting this — laptop still overheating', body: 'This is the third ticket about the same laptop. It shuts down mid-presentation. Completely unacceptable — I need a replacement TODAY, not another troubleshooting call.', sentiment: 'NEGATIVE', priority: TicketPriority.CRITICAL, status: TicketStatus.OPEN, category: 'Hardware', slaInH: 2 },
    { title: 'Still waiting a week for software approval', body: 'Requested the design software licence a week ago. Every day of delay pushes the client deliverable. Extremely frustrated with how long this takes.', sentiment: 'NEGATIVE', priority: TicketPriority.HIGH, status: TicketStatus.OPEN, category: 'Software', slaInH: -3 },
    { title: 'Projector in the main meeting room flickering', body: 'Not urgent, but the projector flickers every few minutes. A client demo runs there Thursday, would be good to fix before then.', sentiment: 'NEUTRAL', priority: TicketPriority.LOW, status: TicketStatus.OPEN, category: 'Hardware', slaInH: 70 },
    { title: 'Thanks for the fast headset replacement!', body: 'New headset arrived the next morning and works perfectly. Just wanted to say the turnaround was brilliant — thank you.', sentiment: 'POSITIVE', priority: TicketPriority.LOW, status: TicketStatus.RESOLVED, category: 'Hardware', slaInH: -30 },
    { title: 'Access request for the finance reporting folder', body: 'Starting the quarterly close next week — please grant read access to the finance reporting folder for me and my two analysts.', sentiment: 'NEUTRAL', priority: TicketPriority.MEDIUM, status: TicketStatus.IN_PROGRESS, category: 'Access & Permissions', slaInH: 20 },
    { title: 'Guest Wi-Fi drops during client meetings', body: 'Guests keep losing Wi-Fi in the boardroom. Slightly embarrassing in front of clients — can we look at coverage there?', sentiment: 'NEGATIVE', priority: TicketPriority.MEDIUM, status: TicketStatus.OPEN, category: 'Network & Connectivity', slaInH: 30 },
  ];
  for (const t of moodTickets) {
    await prisma.ticket.create({ data: {
      orgId, title: t.title, body: t.body, categoryId: cat(t.category), priority: t.priority,
      status: t.status, requesterId: crmMgr.id, assignedTo: t.priority === TicketPriority.CRITICAL ? itMgr.id : itAgent.id,
      sentiment: t.sentiment, slaDueAt: hoursFromNow(t.slaInH), createdAt: daysAgo(1),
      resolvedAt: t.status === TicketStatus.RESOLVED ? hourAgo(20) : undefined,
    }});
  }

  // ── 5. Ninety days of closed history (analytics + NL query + CSAT) ────────
  // Volume/aging charts need a backlog with shape: heavier recent weeks, a
  // mix of categories, real resolution times, and CSAT ratings that average
  // believably (mostly 4-5 with a few stinkers).
  const historyTitles = [
    ['Monitor flickering at dock', 'Hardware'], ['Password reset for new starter', 'Access & Permissions'],
    ['Slack notifications delayed', 'Software'], ['Printer out of toner - floor 2', 'Hardware'],
    ['New keyboard request', 'Hardware'], ['Cannot open shared calendar', 'Software'],
    ['Wi-Fi weak in east wing', 'Network & Connectivity'], ['Billing portal login fails', 'Billing & Accounts'],
    ['Laptop battery draining fast', 'Hardware'], ['Excel crashing on large files', 'Software'],
    ['Badge reader not working', 'Access & Permissions'], ['Invoice PDF export blank', 'Billing & Accounts'],
    ['Second monitor not detected', 'Hardware'], ['Teams mic not working', 'Software'],
    ['Duplicate charge on subscription', 'Billing & Accounts'], ['Onboarding accounts for 3 hires', 'Access & Permissions'],
    ['Server room temperature alert', 'Hardware'], ['CRM export missing columns', 'Software'],
  ] as const;
  const closedTickets: { id: string }[] = [];
  for (let i = 0; i < historyTitles.length; i++) {
    const created = daysAgo(4 + Math.round(i * 4.7));           // spread across ~90 days
    const resolveHours = 3 + ((i * 7) % 46);                    // varied resolution times
    const t = await prisma.ticket.create({ data: {
      orgId, title: historyTitles[i][0], body: `${historyTitles[i][0]} — resolved by the IT desk.`,
      categoryId: cat(historyTitles[i][1]), priority: [TicketPriority.LOW, TicketPriority.MEDIUM, TicketPriority.MEDIUM, TicketPriority.HIGH][i % 4],
      status: i % 3 === 0 ? TicketStatus.CLOSED : TicketStatus.RESOLVED,
      requesterId: [admin.id, crmMgr.id, salesRep.id][i % 3], assignedTo: i % 2 ? itAgent.id : itMgr.id,
      sentiment: 'NEUTRAL', createdAt: created,
      slaDueAt: new Date(created.getTime() + 48 * 3600_000),
      resolvedAt: new Date(created.getTime() + resolveHours * 3600_000),
      closedAt: i % 3 === 0 ? new Date(created.getTime() + (resolveHours + 24) * 3600_000) : undefined,
    }});
    closedTickets.push(t);
  }
  const csatRatings = [5, 5, 4, 5, 3, 5, 4, 2, 5, 4];
  for (let i = 0; i < csatRatings.length; i++) {
    await prisma.csatResponse.create({ data: {
      orgId, ticketId: closedTickets[i].id, rating: csatRatings[i],
      comment: csatRatings[i] >= 4 ? 'Quick and clear, thanks!' : csatRatings[i] === 3 ? 'Solved, but took longer than expected.' : 'Had to chase twice before anyone replied.',
    }});
  }

  // ── 6. Knowledge base depth (AI: reply suggestions + KB deflection) ───────
  // Enough published coverage that (a) typing a new request surfaces a
  // relevant "might already be solved" card and (b) the reply-suggestion AI
  // has real material to ground its answer in.
  const kbArticles: { title: string; body: string; category: string }[] = [
    { title: 'Fixing VPN connections that keep dropping', category: 'Network & Connectivity',
      body: '## Symptoms\nVPN connects but drops every few minutes, especially after sleep or a network switch.\n\n## Fix\n1. Update the VPN client to the latest version from the software portal.\n2. In the client settings, disable "IPv6 tunneling" (known conflict with home routers).\n3. Windows: Power Options → Network adapter → disable "Allow the computer to turn off this device".\n4. If on Wi-Fi, forget and re-join the network to refresh DNS.\n\n## Still dropping?\nCollect the client log (Help → Export logs) and attach it to your ticket.' },
    { title: 'Outlook not syncing — the 5-minute fix', category: 'Software',
      body: '## Quick checks\n1. Bottom bar says "Working Offline"? Send/Receive tab → toggle Work Offline off.\n2. File → Account Settings → Repair. Completes in ~2 minutes and fixes most sync stalls.\n3. Still stuck: close Outlook, delete the .ost cache file (File → Account Settings → Data Files shows its path) and restart Outlook — it rebuilds automatically.\n\nWebmail always shows the true state of your mailbox while the desktop client rebuilds.' },
    { title: 'Account locked out — how to self-recover', category: 'Access & Permissions',
      body: 'After a password change, saved sessions on phones and other devices retry the OLD password and re-lock the account.\n\n1. Update the saved password on every signed-in device (especially mobile mail).\n2. Wait 15 minutes — lockouts clear automatically.\n3. Use the self-service portal ("Forgot password") rather than asking IT — it is faster and audited.\n\nIf you get locked again within the hour, some device is still retrying: turn each device\'s Wi-Fi off one at a time to find it.' },
    { title: 'Mapping a shared network drive (and making it stick)', category: 'Network & Connectivity',
      body: '1. Remove stale credentials: Credential Manager → Windows Credentials → remove the file-server entry.\n2. Map with persistence: `net use S: \\\\fileserver\\shared /persistent:yes`.\n3. Re-enter your domain credentials when prompted and tick "Remember me".\n\nOS updates can reset SMB settings — if a drive vanishes after an update, repeat steps 1-2.' },
    { title: 'Setting up multi-factor authentication (MFA)', category: 'Access & Permissions',
      body: '1. Install the authenticator app from your phone\'s store.\n2. Visit the security portal → "Set up MFA" and scan the QR code.\n3. Store the backup codes somewhere safe (password manager, not a sticky note).\n\nLost phone? The service desk can issue a temporary bypass code after identity verification — allow 15 minutes.' },
    { title: 'Requesting new software or licences', category: 'Software',
      body: '1. Check the software portal first — most common tools are pre-approved for self-install.\n2. Anything else: raise a ticket in "Software" with the business justification and cost centre.\n3. Approval SLA: 2 business days for pre-vetted vendors, up to 5 for new vendors (security review).\n\nTip: licence renewals are automatic; you only need a ticket for NEW software.' },
    { title: 'Laptop running hot or battery draining fast', category: 'Hardware',
      body: '1. Reboot weekly — uptime over 7 days is the top cause of runaway background processes.\n2. Check Task Manager for a single app pinning CPU; browser tabs with video are the usual suspect.\n3. Use the official charger — third-party USB-C chargers throttle charging and run hot.\n4. If the fan is loud even when idle after these steps, book a hardware check; dust cleaning takes one business day.' },
    { title: 'Guest Wi-Fi: getting visitors online', category: 'Network & Connectivity',
      body: 'Network: **Guest** · Password: rotates monthly, shown on the reception screen.\n\nGuests accept the terms page and get 8 hours of access. For all-day events, request an event code one day ahead — it supports up to 50 devices and skips the terms page.' },
  ];
  for (const k of kbArticles) {
    await prisma.knowledgeArticle.create({ data: { orgId, authorId: itMgr.id, title: k.title, body: k.body, categoryId: cat(k.category), status: ArticleStatus.PUBLISHED, publishedAt: daysAgo(15) } });
  }

  // ── 7. CRM side: accounts & contacts to host the ladder ───────────────────
  const showAccounts = await Promise.all([
    ['Northwind Logistics', 'Transportation', 'https://northwind.example.com'],
    ['Meridian Retail Group', 'Retail', 'https://meridian.example.com'],       // ← churn-risk account
    ['Apex Financial Services', 'Finance', 'https://apexfs.example.com'],
    ['BlueSky Healthcare', 'Healthcare', 'https://bluesky.example.com'],
    ['Vertex Manufacturing', 'Manufacturing', 'https://vertexmfg.example.com'],
    ['Luna Media Labs', 'Media', 'https://lunamedia.example.com'],
  ].map(([name, industry, website], i) =>
    prisma.account.create({ data: { orgId, name, industry, website, phone: `+1-555-09${10 + i}`, address: `${100 + i * 7} Commerce Park`, ownerId: i % 2 ? salesRep.id : crmMgr.id } })
  ));
  const personas: [string, string, string, number][] = [
    // name, jobTitle, source, accountIdx — titles/sources chosen so the AI
    // scoring ladder below has real signals to cite.
    ['Priya Raman', 'Chief Technology Officer', 'Referral', 0],
    ['Marcus Webb', 'VP of Operations', 'Webinar', 2],
    ['Elena Sokolova', 'Head of IT', 'Website', 3],
    ['Tom Barrett', 'Procurement Lead', 'Trade Show', 4],
    ['Aisha Khan', 'Operations Manager', 'Webinar', 0],
    ['Diego Fuentes', 'IT Administrator', 'Website', 4],
    ['Grace Liu', 'Office Manager', 'Cold Call', 5],
    ['Ryan Novak', 'Student', 'Website', 5],
    ['Fatima Al-Sayed', 'Director of Customer Success', 'Referral', 3],
    ['Ben Carter', 'Intern', 'Website', 1],
    ['Sofia Marino', 'CFO', 'Event', 2],
    ['Jack Reilly', 'Facilities Coordinator', 'Cold Call', 1],
  ];
  const showContacts = await Promise.all(personas.map(([name, jobTitle, source, accIdx], i) =>
    prisma.contact.create({ data: {
      orgId, ownerId: i % 2 ? salesRep.id : crmMgr.id, name,
      email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@${['northwind','meridian','apexfs','bluesky','vertexmfg','lunamedia'][accIdx]}.example.com`,
      phone: `+1-555-2${100 + i}`, jobTitle, accountId: showAccounts[accIdx].id, source,
    }})
  ));

  // ── 8. Lead scoring ladder (AI: lead.score) ───────────────────────────────
  // Pre-scored hot/warm/cold rows show the spread at a glance; the two
  // UNSCORED leads are the live-demo material — hit "Score" on Priya (every
  // buying signal present) and on Ryan (none) and let the contrast talk.
  const leadRows: { c: number; status: LeadStatus; notes: string; score: number | null; reason: string | null }[] = [
    { c: 0, status: LeadStatus.QUALIFIED, score: null, reason: null,
      notes: 'CTO, came via customer referral. Evaluating platforms for a 200-seat rollout, budget approved this quarter, asked for security docs and a technical deep-dive next week. Current contract with competitor expires in 6 weeks.' },
    { c: 7, status: LeadStatus.NEW, score: null, reason: null,
      notes: 'Downloaded one whitepaper. University email address, no company, no phone. No reply to two follow-up emails over three weeks.' },
    { c: 1, status: LeadStatus.QUALIFIED, score: 91, reason: 'VP-level decision maker, attended product webinar, confirmed budget and Q4 timeline, competitor contract ending.',
      notes: 'VP Ops. Asked detailed integration questions on the webinar. Wants a pilot for one region before global rollout.' },
    { c: 8, status: LeadStatus.QUALIFIED, score: 84, reason: 'Director-level referral with an active project and named stakeholders; timeline dependent on budget cycle.',
      notes: 'Referred by an existing customer. Building the business case for replacing their current helpdesk in Q1.' },
    { c: 10, status: LeadStatus.CONTACTED, score: 76, reason: 'CFO engaged at an event; strong authority but early-stage discovery, no confirmed budget yet.',
      notes: 'Met at the finance-sector event. Interested in consolidating three tools into one; asked for a TCO comparison.' },
    { c: 2, status: LeadStatus.CONTACTED, score: 68, reason: 'Head of IT actively comparing vendors; mid-size opportunity, timeline unclear.',
      notes: 'Running a spreadsheet comparison of four vendors. We are shortlisted; demo scheduled.' },
    { c: 3, status: LeadStatus.CONTACTED, score: 55, reason: 'Procurement contact without technical sponsor; interest is price-driven at this stage.',
      notes: 'Asked only about per-seat pricing and discount tiers. No technical evaluation started.' },
    { c: 5, status: LeadStatus.NEW, score: 42, reason: 'IT admin researching options; no budget authority, no stated timeline.',
      notes: 'Signed up for the newsletter, asked one question about API limits.' },
    { c: 6, status: LeadStatus.NEW, score: 31, reason: 'Cold-call contact, small office, exploring casually; no decision authority identified.',
      notes: 'Polite but non-committal on the call. Asked to be contacted again "sometime next year".' },
    { c: 9, status: LeadStatus.UNQUALIFIED, score: 12, reason: 'Intern doing market research; no purchase intent.',
      notes: 'Collecting information for a college assignment on CRM tools.' },
  ];
  const showLeads: { id: string }[] = [];
  for (const l of leadRows) {
    showLeads.push(await prisma.lead.create({ data: {
      orgId, contactId: showContacts[l.c].id, source: personas[l.c][2], status: l.status,
      assignedTo: l.c % 2 ? salesRep.id : crmMgr.id, notes: l.notes, aiScore: l.score, aiScoreReason: l.reason,
    }}));
  }

  // ── 9. Deals: momentum vs. stalls (AI: win probability + pipeline health) ─
  const S = preset.stages.map(s => s.label);
  const dealRows: { title: string; value: number; stage: string; prob: number; c: number; a: number; closeDays: number; status: DealStatus; staleDays?: number }[] = [
    // Healthy movers — recent history entries below give them momentum.
    { title: 'Northwind fleet-ops platform (200 seats)', value: 96000, stage: S[3], prob: 85, c: 0, a: 0, closeDays: 14, status: DealStatus.OPEN },
    { title: 'Apex FS service-desk consolidation', value: 64000, stage: S[2], prob: 65, c: 10, a: 2, closeDays: 30, status: DealStatus.OPEN },
    { title: 'BlueSky patient-support pilot', value: 28000, stage: S[1], prob: 45, c: 2, a: 3, closeDays: 45, status: DealStatus.OPEN },
    { title: 'Vertex plant-floor asset tracking', value: 41000, stage: S[1], prob: 40, c: 3, a: 4, closeDays: 40, status: DealStatus.OPEN },
    // Stalls — mid-stage, close date already past, last movement 45+ days
    // ago. Pipeline-health calls these out by name.
    { title: 'Meridian store-ops rollout', value: 52000, stage: S[2], prob: 60, c: 11, a: 1, closeDays: -12, status: DealStatus.OPEN, staleDays: 48 },
    { title: 'Luna Media production tracker', value: 18000, stage: S[1], prob: 45, c: 6, a: 5, closeDays: -20, status: DealStatus.OPEN, staleDays: 55 },
    { title: 'Northwind depot expansion phase 2', value: 33000, stage: S[0], prob: 20, c: 4, a: 0, closeDays: -5, status: DealStatus.OPEN, staleDays: 62 },
    // Closed history for the win-rate and revenue charts.
    { title: 'Apex FS compliance module', value: 22000, stage: 'Closed Won', prob: 100, c: 10, a: 2, closeDays: -25, status: DealStatus.WON },
    { title: 'BlueSky clinic onboarding', value: 17500, stage: 'Closed Won', prob: 100, c: 2, a: 3, closeDays: -40, status: DealStatus.WON },
    { title: 'Vertex warehouse pilot', value: 12000, stage: 'Closed Won', prob: 100, c: 5, a: 4, closeDays: -60, status: DealStatus.WON },
    { title: 'Meridian loyalty integration', value: 26000, stage: 'Closed Lost', prob: 0, c: 11, a: 1, closeDays: -35, status: DealStatus.LOST },
    { title: 'Luna Media archive migration', value: 9000, stage: 'Closed Lost', prob: 0, c: 6, a: 5, closeDays: -50, status: DealStatus.LOST },
  ];
  for (const d of dealRows) {
    const deal = await prisma.deal.create({ data: {
      orgId, pipelineId: pipeline.id, title: d.title, value: d.value, stage: d.stage, probability: d.prob,
      contactId: showContacts[d.c].id, accountId: showAccounts[d.a].id,
      assignedTo: d.c % 2 ? crmMgr.id : salesRep.id, status: d.status, closeDate: daysFromNow(d.closeDays),
      createdAt: daysAgo(d.staleDays ?? 30),
    }});
    // History: stalled deals last moved 45+ days ago; healthy ones this week.
    await prisma.dealHistory.create({ data: { dealId: deal.id, toStage: d.stage, changedBy: salesRep.id, changedAt: daysAgo(d.staleDays ?? (d.status === DealStatus.OPEN ? 3 : 30)) } });
  }

  // ── 10. Activity texture (AI: follow-up drafts + churn risk) ──────────────
  // Recent touches on the healthy accounts; Meridian (index 1) deliberately
  // gets NOTHING newer than 60 days — that silence is what churn-risk flags.
  const acts: { type: ActivityType; title: string; c: number; due: number; done: boolean }[] = [
    { type: ActivityType.CALL,    title: 'Security review call',            c: 0,  due: -2, done: true },
    { type: ActivityType.MEETING, title: 'Technical deep-dive',             c: 0,  due: 5,  done: false },
    { type: ActivityType.EMAIL,   title: 'Send TCO comparison',             c: 10, due: -1, done: true },
    { type: ActivityType.MEETING, title: 'Pilot scoping workshop',          c: 2,  due: 3,  done: false },
    { type: ActivityType.CALL,    title: 'Procurement pricing call',        c: 3,  due: -4, done: true },
    { type: ActivityType.TASK,    title: 'Prepare integration one-pager',   c: 8,  due: 2,  done: false },
    { type: ActivityType.EMAIL,   title: 'Webinar follow-up sequence',      c: 4,  due: -6, done: true },
    // Meridian's most recent touch — two months old, on purpose.
    { type: ActivityType.CALL,    title: 'Quarterly check-in (missed)',     c: 11, due: -63, done: false },
    { type: ActivityType.EMAIL,   title: 'Renewal reminder',                c: 11, due: -70, done: true },
  ];
  for (const a of acts) {
    await prisma.activity.create({ data: {
      orgId, type: a.type, title: a.title, body: a.title,
      contactId: showContacts[a.c].id, createdBy: a.c % 2 ? salesRep.id : crmMgr.id,
      dueAt: daysFromNow(a.due), done: a.done, createdAt: a.due < 0 ? daysFromNow(a.due) : daysAgo(1),
    }});
  }

  // ── 11. Finance texture (invoices for dashboards + NL queries) ────────────
  const invoiceRows: { title: string; amount: number; status: string; dueDays: number; paidDaysAgo?: number }[] = [
    { title: 'Apex FS compliance module — annual licence', amount: 22000, status: 'PAID', dueDays: -20, paidDaysAgo: 22 },
    { title: 'BlueSky clinic onboarding — implementation', amount: 17500, status: 'PAID', dueDays: -35, paidDaysAgo: 33 },
    { title: 'Vertex warehouse pilot — phase 1', amount: 12000, status: 'PAID', dueDays: -55, paidDaysAgo: 52 },
    { title: 'Northwind fleet-ops — deposit', amount: 24000, status: 'SENT', dueDays: 12 },
    { title: 'Luna Media retainer — August', amount: 4500, status: 'SENT', dueDays: 6 },
    { title: 'Meridian store-ops consulting', amount: 8800, status: 'OVERDUE', dueDays: -18 },
    { title: 'Meridian data migration — final', amount: 6200, status: 'OVERDUE', dueDays: -32 },
    { title: 'BlueSky expansion — draft estimate', amount: 31000, status: 'DRAFT', dueDays: 30 },
  ];
  for (let i = 0; i < invoiceRows.length; i++) {
    const inv = invoiceRows[i];
    await prisma.invoice.create({ data: {
      orgId, invoiceNumber: `INV-9${String(i + 1).padStart(3, '0')}`, title: inv.title, status: inv.status,
      issueDate: daysAgo(Math.max(5, -inv.dueDays + 15)), dueDate: daysFromNow(inv.dueDays),
      paidAt: inv.paidDaysAgo ? daysAgo(inv.paidDaysAgo) : undefined, createdBy: crmMgr.id,
      lines: { create: [{ description: inv.title, quantity: 1, unitPrice: inv.amount, discount: 0 }] },
    }});
  }

  // ── 12. Inbox texture (shared inbox demo) ─────────────────────────────────
  const inboxRows: { name: string; email: string; subject: string; body: string; hoursAgo: number }[] = [
    { name: personas[11][0], email: 'jack.reilly@meridian.example.com', subject: 'Frustrated — still no update on our rollout', body: 'It has been three weeks since anyone from your side contacted us about the store-ops rollout. If this is how the project phase goes, we need to rethink the renewal.', hoursAgo: 5 },
    { name: personas[0][0], email: 'priya.raman@northwind.example.com', subject: 'Security documentation received — next steps', body: 'Thanks for the SOC2 pack, our security team is satisfied. Can we lock in the technical deep-dive for Tuesday? Bringing our head of infrastructure.', hoursAgo: 26 },
    { name: personas[6][0], email: 'grace.liu@lunamedia.example.com', subject: 'Question about per-seat pricing', body: 'Quick one: does the per-seat price include the customer portal, or is that licensed separately?', hoursAgo: 50 },
  ];
  for (const m of inboxRows) {
    const conv = await prisma.conversation.create({ data: {
      orgId, channel: 'EMAIL', contactName: m.name, contactEmail: m.email, subject: m.subject,
      status: 'OPEN', assignedTo: salesRep.id, lastMessageAt: hourAgo(m.hoursAgo), unreadCount: 1,
    }});
    await prisma.message.create({ data: { conversationId: conv.id, direction: 'INBOUND', fromAddress: m.email, toAddress: preset.supportEmail, body: m.body, sentAt: hourAgo(m.hoursAgo) } });
  }

  console.log(`[seed] ${preset.slug}: AI showcase layer added (${dupClusters.reduce((n, c) => n + c.titles.length, 0) + moodTickets.length + historyTitles.length + 2} tickets, ${kbArticles.length} KB articles, ${leadRows.length} leads, ${dealRows.length} deals, ${invoiceRows.length} invoices)`);
}

/** Seeds a single vertical (default: the original tech/SaaS demo org). Re-runnable. */
export async function seedDemoOrg(vertical: string = DEFAULT_VERTICAL) {
  const preset = VERTICALS.find(v => v.slug === vertical);
  if (!preset) throw new Error(`Unknown demo vertical "${vertical}". Valid: ${DEMO_VERTICAL_SLUGS.join(', ')}`);
  return buildOrg(preset);
}

/** Seeds every vertical — used by the nightly reset job and the initial `db:seed` run. */
export async function seedAllDemoOrgs() {
  const results = [];
  for (const preset of VERTICALS) {
    results.push(await buildOrg(preset));
  }
  return results;
}

/**
 * Seeds only the verticals that don't exist yet.
 *
 * The important property here is that it is **non-destructive**: buildOrg()
 * deletes an org before rebuilding it, so a full reseed would tear down seven
 * working demo workspaces to fix the one that is missing. This touches nothing
 * that already exists, which is what makes it safe to expose to an ordinary
 * admin rather than only to a secret-holding CI job.
 *
 * That distinction matters in practice: adding a new vertical to VERTICALS
 * (as real estate was) leaves every deployed environment one org short until
 * something creates it, and on a host without shell access `npm run db:seed`
 * is not an option.
 */
export async function seedMissingDemoOrgs(): Promise<{ created: string[]; alreadyPresent: string[] }> {
  const existing = await prisma.organization.findMany({
    where: { slug: { in: DEMO_VERTICAL_SLUGS } },
    select: { slug: true },
  });
  const present = new Set(existing.map(o => o.slug));

  const created: string[] = [];
  for (const preset of VERTICALS) {
    if (present.has(preset.slug)) continue;
    await buildOrg(preset);
    created.push(preset.slug);
  }

  return { created, alreadyPresent: [...present] };
}

// ─── Back-compat exports (previous single-vertical API) ───────────────────────
export const DEMO_ORG_SLUG = DEFAULT_VERTICAL;
/** Functions, not constants: SEED_* / DEMO_LOGIN_EMAIL come from .env, loaded after import. */
export const demoSeedEmails = () => seedEmailsFor(DEFAULT_VERTICAL);
export const demoLoginEmail = () => process.env.DEMO_LOGIN_EMAIL || loginEmailFor(DEFAULT_VERTICAL);
