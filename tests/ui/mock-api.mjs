/**
 * Mock API for UI testing.
 *
 * Prisma's engine binaries are firewalled in this sandbox, so the real server
 * cannot run. This stands in for it: correct shapes for the endpoints the shell
 * and every page need on mount, and a permissive fallback for everything else.
 *
 * It is enough to exercise LAYOUT — nav, headers, tables, modals, forms — which
 * is what the reported mobile bug lives in. It is NOT a substitute for
 * integration testing of business logic.
 */

const PORT = 4000;

const ORG = {
  id: 'org1', name: 'Acme Corporation', slug: 'acme',
  plan: 'ENTERPRISE', currency: 'USD', timezone: 'UTC',
  primaryColor: '#4f46e5', logoUrl: null,
};

const USER = {
  id: 'u1', name: 'Alex Morgan', email: 'admin@crmitdesk.com',
  role: 'SUPER_ADMIN', department: 'Operations', orgId: 'org1', org: ORG,
  avatarUrl: null,
};

const users = Array.from({ length: 6 }, (_, i) => ({
  id: `u${i + 1}`, name: ['Alex Morgan','Priya Nair','Sam Okafor','Lena Fischer','Diego Ruiz','Mei Chen'][i],
  // Real UserRole enum values — ADMIN/MANAGER/AGENT were invented and do not
  // exist in prisma/schema.prisma, so any UI that maps roles to labels or
  // permissions was being tested against values it will never see.
  email: `user${i + 1}@acme.test`, role: ['SUPER_ADMIN','CRM_MANAGER','IT_MANAGER','IT_AGENT','SALES_REP','EMPLOYEE'][i],
  isActive: true, department: 'Operations', createdAt: '2026-01-05T10:00:00Z',
}));

const contacts = Array.from({ length: 12 }, (_, i) => ({
  id: `c${i}`, name: `Contact Person ${i + 1}`, email: `contact${i}@client.test`,
  phone: '+1 555 0100', company: `Client Co ${i + 1}`, jobTitle: 'Head of IT',
  createdAt: '2026-02-01T10:00:00Z', lastActivityAt: '2026-08-01T10:00:00Z',
  deals: [], activities: [], tags: [],
}));

const deals = Array.from({ length: 10 }, (_, i) => ({
  id: `d${i}`, title: `Enterprise Licence Renewal ${i + 1}`, value: 25000 + i * 7500,
  stage: ['Prospecting','Qualification','Proposal','Negotiation','Closed Won'][i % 5],
  status: 'OPEN', probability: 40 + i * 3, currency: 'USD',
  contactId: `c${i}`, contact: { id: `c${i}`, name: `Contact Person ${i + 1}` },
  ownerId: 'u1', owner: { id: 'u1', name: 'Alex Morgan' },
  createdAt: '2026-03-01T10:00:00Z', expectedCloseDate: '2026-10-01T10:00:00Z',
  lines: [], customFields: {},
}));

const leads = Array.from({ length: 10 }, (_, i) => ({
  id: `l${i}`, title: `Inbound enquiry ${i + 1}`, name: `Lead ${i + 1}`,
  status: ['NEW','CONTACTED','QUALIFIED','UNQUALIFIED','CONVERTED'][i % 5],
  source: 'WEBSITE', notes: 'Downloaded the pricing sheet.',
  aiScore: i % 3 === 0 ? null : 60 + i, aiScoreReason: i % 3 === 0 ? null : 'Engaged repeatedly.',
  contactId: `c${i}`, contact: { id: `c${i}`, name: `Contact Person ${i + 1}`, email: `contact${i}@client.test` },
  createdAt: '2026-04-01T10:00:00Z', customFields: {},
}));

const tickets = Array.from({ length: 12 }, (_, i) => ({
  id: `t${i}`, ticketNumber: 1000 + i, title: `Cannot access shared drive (${i + 1})`,
  body: 'Getting a permission error since this morning.',
  description: 'Getting a permission error since this morning.',
  status: ['OPEN','IN_PROGRESS','PENDING','RESOLVED','CLOSED'][i % 5],
  priority: ['LOW','MEDIUM','HIGH','CRITICAL'][i % 4],
  sentiment: i % 4 === 0 ? 'NEGATIVE' : null,
  categoryId: 'cat1', category: { id: 'cat1', name: 'Access & Permissions' },
  assignedTo: 'u3', assignee: { id: 'u3', name: 'Sam Okafor' },
  contactId: `c${i}`, contact: { id: `c${i}`, name: `Contact Person ${i + 1}` },
  createdAt: '2026-07-01T10:00:00Z', updatedAt: '2026-08-10T10:00:00Z',
  slaBreached: i % 6 === 0, comments: [], attachments: [], customFields: {},
}));

const employees = Array.from({ length: 8 }, (_, i) => ({
  id: `e${i}`, employeeCode: `EMP-${100 + i}`, firstName: ['Alex','Priya','Sam','Lena','Diego','Mei','Tom','Ana'][i],
  lastName: 'Employee', fullName: `${['Alex','Priya','Sam','Lena','Diego','Mei','Tom','Ana'][i]} Employee`,
  name: `${['Alex','Priya','Sam','Lena','Diego','Mei','Tom','Ana'][i]} Employee`,
  email: `emp${i}@acme.test`, status: 'ACTIVE', jobTitle: 'Specialist',
  departmentId: 'dep1', department: { id: 'dep1', name: 'Operations' },
  managerId: null, userId: `u${i + 1}`, joinedAt: '2025-01-15T10:00:00Z', createdAt: '2025-01-15T10:00:00Z',
}));


const MODULE = {
  id: 'mod1', name: 'Property Inventory', slug: 'property-inventory', icon: 'Layers',
  fields: [
    { id: 'f1', label: 'Property', fieldKey: 'property', fieldType: 'TEXT', required: true, position: 0 },
    { id: 'f2', label: 'Location', fieldKey: 'location', fieldType: 'TEXT', required: false, position: 1 },
    { id: 'f3', label: 'Listed',   fieldKey: 'listed',   fieldType: 'BOOLEAN', required: false, position: 2 },
  ],
};
const MODULE_RECORDS = Array.from({ length: 4 }, (_, i) => ({
  id: `rec${i}`, moduleId: 'mod1', source: i === 3 ? 'SYNC' : 'MANUAL',
  data: { property: `Unit ${101 + i}`, location: 'Bengaluru', listed: i % 2 === 0 },
  title: `Unit ${101 + i}`, createdAt: '2026-08-01T10:00:00Z',
}));


let TASKS = [
  { id:'t1', title:'Send revised proposal', status:'OPEN', priority:'HIGH', dueAt:'2026-08-10T00:00:00Z',
    entityType:'DEAL', entityId:'d0', assigneeUserId:'u1', assigneeUser:{id:'u1',name:'Alex Morgan',email:'a@b.c'},
    tags:[], source:'MANUAL', createdAt:'2026-08-01T10:00:00Z' },
  { id:'t2', title:'Confirm budget with finance', status:'OPEN', priority:'MEDIUM', dueAt:null,
    entityType:'DEAL', entityId:'d0', assigneeUserId:null, tags:[], source:'MANUAL', createdAt:'2026-08-02T10:00:00Z' },
  { id:'t3', title:'Book the kickoff call', status:'DONE', priority:'LOW', dueAt:null,
    entityType:'DEAL', entityId:'d0', tags:[], source:'MANUAL', createdAt:'2026-07-20T10:00:00Z' },
];

const paged = (rows) => ({ data: rows, total: rows.length, page: 1, pageSize: rows.length, totalPages: 1 });

/** Exact-path handlers. Checked before the pattern table. */
const ROUTES = {
  'POST /auth/login':   () => ({ user: USER, access: 'mock-access-token', refresh: 'mock-refresh-token' }),
  'POST /auth/refresh': () => ({ access: 'mock-access-token', refresh: 'mock-refresh-token' }),
  'GET /auth/me':       () => USER,
  'POST /auth/demo-login': () => ({ user: USER, access: 'mock-access-token', refresh: 'mock-refresh-token' }),

  // A BARE ARRAY, matching server/src/modules/core/users/users.routes.ts.
  // This used to return paged(users), and that lie hid a real bug: a caller
  // reading `usersData?.data` looked correct against the mock and rendered an
  // empty dropdown against the real API. A mock that is wrong about a shape is
  // worse than no mock.
  'GET /users':      () => users,
  'GET /tasks':      () => paged(TASKS),
  'GET /contacts':   () => paged(contacts),
  'GET /crm/contacts': () => paged(contacts),
  'GET /crm/deals': () => paged(deals),
  'GET /crm/leads': () => paged(leads),
  'GET /itdesk/tickets': () => paged(tickets),
  'GET /deals':      () => paged(deals),
  'GET /leads':      () => paged(leads),
  'GET /tickets':    () => paged(tickets),
  'GET /hr/employees': () => paged(employees),
  'GET /people':     () => paged(employees.map(e => ({ ...e, hasLogin: true, roleName: 'Employee' }))),

  'GET /dashboard/stats': () => ({
    openTickets: 14, totalContacts: 12, openDeals: 10, pipelineValue: 412000,
    wonDeals: 4, lostDeals: 2, winRate: 62, forecastRevenue: 268000,
    slaBreached: 2, newLeads: 5, employees: 8, pendingApprovals: 3,
  }),
  'GET /demo/verticals': () => ([
    { slug: 'acme-corp', orgName: 'Acme Corporation', industry: 'Technology', primaryColor: '#4f46e5', currency: 'USD', available: true },
    { slug: 'zenith-realty', orgName: 'Zenith Realty', industry: 'Real Estate', primaryColor: '#ea580c', currency: 'INR', available: true },
  ]),
  'GET /demo/status': () => ({ seeded: 8, total: 8, peoplePlatformMigrated: true }),
  'GET /notifications': () => paged([]),
  'GET /notifications/unread-count': () => ({ count: 3 }),
  'GET /search': () => ({ results: [], aiPowered: false }),
  'GET /ai/actions': () => ([]),
  'GET /knowledge/stats': () => ({ documents: 24, chunks: 310, vectorBackend: 'pgvector', lastIndexedAt: '2026-08-15T10:00:00Z' }),
  'GET /knowledge/ai/observability': () => ({
    calls: 142, successRate: 0.98, totalTokens: 210400, totalCostUsd: 1.84, avgLatencyMs: 940,
    actionsExecuted: 0, ratedHelpful: 12, ratedUnhelpful: 1,
    byFeature: [{ feature: 'rag.answer', calls: 80, costUsd: 1.2 }],
    byModel: [{ model: 'llama-3.3-70b-versatile', calls: 80, costUsd: 1.2 }],
    budget: { limitUsd: 50, spendUsd: 1.84, hardStop: false },
  }),
  'GET /org/labels': () => ({}),
  'GET /custom-fields': () => ([]),
  // Value lookups are arrays, not paged envelopes.
  'GET /templates/replies': () => ([]),
  'GET /crm/accounts': () => paged([]),
  'GET /custom-modules': () => ([MODULE]),
  'GET /custom-modules/mod1': () => MODULE,
  'GET /custom-modules/mod1/records': () => paged(MODULE_RECORDS),
};

/** Endpoints whose natural empty value is an object, not a list. */
const OBJECT_ENDPOINTS = [
  /^\/org\b/, /^\/billing/, /^\/branding/, /^\/storage/, /^\/platform\//,
  /^\/hr\/payroll\/template/, /^\/ai\/studio\/context/, /^\/totp/, /^\/settings/,
];

function send(res, code, body) {
  const json = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

const hits = [];


export default function handle(req, res, url) {
  const path = url.pathname.replace(/^\/api/, '') || '/';
  const key = `${req.method} ${path}`;
  hits.push(key);
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (path === '/health') return send(res, 200, { ok: true });

  const exact = ROUTES[key];
  if (exact) return send(res, 200, exact());

  const m = path.match(/^\/(?:crm\/|itdesk\/)?(deals|tickets|contacts|leads|users|hr\/employees|people)\/([\w-]+)$/);
  if (m && req.method === 'GET') {
    const pool = { deals, tickets, contacts, leads, users, 'hr/employees': employees, people: employees }[m[1]] || [];
    const found = pool.find(r => r.id === m[2]) || pool[0];
    if (found) return send(res, 200, found);
  }

  if (path === '/storage/s3/presets') {
    return send(res, 200, { presets: [
      { id:'AWS_S3', label:'Amazon S3', endpointTemplate:null, defaultRegion:'us-east-1', forcePathStyle:false, regionRequired:true, help:'Region must match the bucket. No endpoint needed.' },
      { id:'CLOUDFLARE_R2', label:'Cloudflare R2', endpointTemplate:'https://{accountId}.r2.cloudflarestorage.com', defaultRegion:'auto', forcePathStyle:true, regionRequired:false, help:'Find the account ID in the R2 dashboard URL. Region is always "auto".' },
      { id:'WASABI', label:'Wasabi', endpointTemplate:'https://s3.{region}.wasabisys.com', defaultRegion:'us-east-1', forcePathStyle:true, regionRequired:true, help:'The region appears in the endpoint, so it must be correct.' },
      { id:'BACKBLAZE_B2', label:'Backblaze B2', endpointTemplate:'https://s3.{region}.backblazeb2.com', defaultRegion:'us-west-004', forcePathStyle:true, regionRequired:true, help:'Use an application key, not the master key.' },
      { id:'DO_SPACES', label:'DigitalOcean Spaces', endpointTemplate:'https://{region}.digitaloceanspaces.com', defaultRegion:'nyc3', forcePathStyle:false, regionRequired:true, help:'Region is the datacentre code, e.g. nyc3.' },
      { id:'MINIO', label:'MinIO / self-hosted', endpointTemplate:null, defaultRegion:'us-east-1', forcePathStyle:true, regionRequired:false, help:'Enter the full URL of your MinIO server.' },
      { id:'OTHER', label:'Other S3-compatible', endpointTemplate:null, defaultRegion:'auto', forcePathStyle:true, regionRequired:false, help:'Any gateway that speaks the S3 API.' },
    ] });
  }

  if (path === '/attachments/policy') {
    return send(res, 200, { maxBytes: 25 * 1024 * 1024, allowedExtensions: ['.pdf', '.png', '.xlsx', '.zip'] });
  }

  // Tags: a library, plus whatever is currently on a record. Enough to
  // exercise the chip strip and the find-or-create picker.
  if (path === '/tags') {
    return send(res, 200, {
      data: [
        { id: 't1', name: 'VIP',         color: '#F59E0B', module: 'ALL', usageCount: 4 },
        { id: 't2', name: 'Churn Risk',  color: '#EF4444', module: 'ALL', usageCount: 2 },
        { id: 't3', name: 'Key Account', color: '#6366F1', module: 'ALL', usageCount: 7 },
        { id: 't4', name: 'Renewal',     color: '#10B981', module: 'ALL', usageCount: 1 },
      ],
      total: 4,
    });
  }
  if (/^\/tags\/record\//.test(path) && req.method === 'GET') {
    return send(res, 200, [
      { id: 't1', name: 'VIP',        color: '#F59E0B', appliedAt: '2026-08-01T10:00:00Z' },
      { id: 't2', name: 'Churn Risk', color: '#EF4444', appliedAt: '2026-08-02T10:00:00Z' },
    ]);
  }

  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    let raw = '';
    req.on('data', c => (raw += c));
    return req.on('end', () => {
      let parsed = {};
      try { parsed = raw ? JSON.parse(raw) : {}; } catch {}
      send(res, 200, { id: `new-${Date.now()}`, ...parsed, success: true });
    });
  }
  if (req.method === 'DELETE') return send(res, 200, { success: true });
  if (/^\/custom-fields\/values\//.test(path) || /^\/comments\//.test(path) || /^\/attachments\//.test(path)) return send(res, 200, []);
  if (OBJECT_ENDPOINTS.some(re => re.test(path))) return send(res, 200, {});
  return send(res, 200, { data: [], total: 0, page: 1, pageSize: 25, totalPages: 0 });
}
