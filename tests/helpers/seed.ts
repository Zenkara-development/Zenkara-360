/**
 * Test data constants — unique enough to find in assertions
 * without conflicting with real data.
 */
export const TEST = {
  contact: {
    name: 'E2E Test Contact',
    email: 'e2e-contact@test.com',
    phone: '555-0100',
    jobTitle: 'QA Engineer',
  },
  lead: {
    name: 'E2E Test Lead',
    email: 'e2e-lead@test.com',
    source: 'Web',
  },
  deal: {
    title: 'E2E Test Deal',
    value: '5000',
  },
  ticket: {
    title: 'E2E Test Ticket',
    body: 'This is an automated test ticket created by Playwright.',
    priority: 'HIGH',
  },
  category: {
    name: 'E2E Test Category',
    description: 'Created by Playwright automation',
  },
  article: {
    title: 'E2E Test Article',
    body: 'This knowledge base article was created by Playwright.',
  },
  user: {
    name: 'E2E Test User',
    email: 'e2e-user@test.com',
    password: 'TestUser@123',
    role: 'SALES_REP',
  },
  asset: {
    name: 'E2E Laptop',
    serialNumber: 'SN-E2E-001',
    assetType: 'Laptop',
    status: 'ACTIVE',
  },
  changeRequest: {
    title: 'E2E Server Upgrade',
    type: 'NORMAL',
    description: 'Playwright test CR',
    riskLevel: 'LOW',
  },
  campaign: {
    name: 'E2E Campaign',
    subject: 'Test Subject',
    body: 'Hello {{name}}',
  },
  quote: {
    title: 'E2E Quote',
    lineItem: { description: 'E2E Service', qty: 2, unitPrice: 100 },
  },
  customField: {
    name: 'e2e_field',
    label: 'E2E Test Field',
    type: 'TEXT',
  },
  workflow: {
    name: 'E2E Workflow',
    trigger: 'ticket.created',
  },
  schedule: {
    ticketMessage: 'E2E Reminder — follow up on ticket',
    dealMessage: 'E2E Reminder — check in on deal',
    customNumber: '+14155559999',
  },
  whatsappWorkflow: {
    // Distinct from TEST.workflow.name so workflows.spec.ts (which creates/
    // deletes 'E2E Workflow') never races with schedules.spec.ts under
    // multiple workers.
    name: 'E2E WhatsApp Workflow',
  },
};
