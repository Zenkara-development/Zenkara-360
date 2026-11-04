/**
 * Guards for the tagging system.
 *
 * The failure this is written against is not a crash — it is a feature that
 * exists on paper and nowhere else. `Tag`, `contact_tags` and `deal_tags`
 * shipped in the first release with a marketing page promising automatic
 * tagging, and for the entire life of the project nothing read them: no
 * route, no component, no query. The only writer was the demo seed. So these
 * tests check wiring as much as logic — that the model exists, the route is
 * mounted, the component is exported and used, and the AI's TAG action writes
 * a tag rather than a sentence about a tag.
 *
 *     npm run test:unit
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const CLIENT = path.join(ROOT, '../client/src');

function read(...p: string[]): string {
  return fs.readFileSync(path.join(...p), 'utf8');
}
function code(...p: string[]): string {
  return read(...p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// ─── Schema ───────────────────────────────────────────────────────────────────

test('RecordTag replaces the two hardcoded join tables', () => {
  const schema = read(ROOT, 'prisma/schema.prisma');

  assert.match(schema, /model RecordTag \{/, 'the polymorphic tag link must exist');
  assert.ok(!/model ContactTag \{/.test(schema), 'contact_tags must be gone, not a second tag system');
  assert.ok(!/model DealTag \{/.test(schema), 'deal_tags must be gone, not a second tag system');

  const model = schema.slice(schema.indexOf('model RecordTag {'));
  const body = model.slice(0, model.indexOf('\n}'));

  assert.match(body, /entityType\s+EntityType/, 'must use the shared EntityType enum, not a free string');
  assert.match(body, /orgId\s+String/, 'orgId must be stored, so the tenant check is not a join');
  assert.match(body, /@@unique\(\[tagId, entityType, entityId\]\)/, 'applying a tag twice must be a no-op');
  assert.match(body, /@@index\(\[orgId, entityType, entityId\]\)/, '"tags on this record" must be indexed');
  assert.match(body, /@@index\(\[orgId, tagId\]\)/, '"records with this tag" must be indexed');
});

test('a backfill exists, because db push would drop the old tables', () => {
  const sql = read(ROOT, 'prisma/backfill-record-tags.sql');
  assert.match(sql, /INSERT INTO "record_tags"[\s\S]*FROM "contact_tags"/, 'contact tags must be copied over');
  assert.match(sql, /INSERT INTO "record_tags"[\s\S]*FROM "deal_tags"/, 'deal tags must be copied over');
  assert.match(sql, /ON CONFLICT/, 'must be safe to run twice');
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/, 'must be one transaction');
});

// ─── API ──────────────────────────────────────────────────────────────────────

test('the tags router is mounted', () => {
  const index = code(SRC, 'index.ts');
  assert.match(index, /app\.use\('\/api\/tags', tagsRouter\)/);
});

test('route order keeps /merge and /:id/records from being read as a record path', () => {
  const routes = code(SRC, 'modules/tags/tags.routes.ts');
  const merge = routes.indexOf("'/merge'");
  const record = routes.indexOf("'/record/:entityType/:entityId'");
  assert.ok(merge > -1 && record > -1);
  assert.ok(merge < record, '/merge must be registered before the two-segment record routes');
});

test('managing the shared library is manager-only; applying a tag is not', () => {
  const routes = code(SRC, 'modules/tags/tags.routes.ts');
  for (const line of routes.split('\n')) {
    if (!line.includes('tagsRouter.')) continue;
    // Renaming, deleting or merging changes what every user in the org sees.
    if (/\.(post|patch|delete)\(/.test(line) && !line.includes('/record/')) {
      assert.match(line, /MANAGERS/, `library mutation must be manager-only: ${line.trim()}`);
    }
    if (line.includes('/record/')) {
      assert.match(line, /ALL_STAFF/, `applying a tag must be open to staff: ${line.trim()}`);
    }
  }
});

test('every per-record tag operation proves the record is in the caller org', () => {
  const controller = code(SRC, 'modules/tags/tags.controller.ts');
  for (const fn of ['listForRecord', 'attach', 'detach']) {
    const start = controller.indexOf(`export async function ${fn}(`);
    assert.ok(start > -1, `${fn} must exist`);
    const body = controller.slice(start, controller.indexOf('\n}', start));
    assert.match(body, /assertEntityInOrg/, `${fn} must not take entityId on trust`);
    assert.match(body, /assertKnownEntityType/, `${fn} must reject unknown entity types`);
  }
});

test('tag names are matched case-insensitively so VIP and vip are one tag', () => {
  const controller = code(SRC, 'modules/tags/tags.controller.ts');
  const matches = controller.match(/mode: 'insensitive'/g) ?? [];
  assert.ok(matches.length >= 3, 'lookup, create-clash and rename-clash all need the insensitive compare');

  // A P2002 on the unique index means someone else created it a moment ago —
  // that is a success for the caller, not a 500.
  assert.match(controller, /P2002/, 'the find-or-create race must be handled');
});

test('deleting a tag in use requires an explicit force', () => {
  const controller = code(SRC, 'modules/tags/tags.controller.ts');
  const body = controller.slice(controller.indexOf('export async function remove('));
  assert.match(body, /force !== 'true'/, 'a tag on N records must not vanish on a misclick');
});

test('merge moves links without violating the unique index', () => {
  const controller = code(SRC, 'modules/tags/tags.controller.ts');
  const body = controller.slice(controller.indexOf('export async function merge('), controller.indexOf('export async function listForRecord('));
  assert.match(body, /skipDuplicates: true/, 'a record carrying both tags would break a straight updateMany');
});

test('list endpoints can filter by tag', () => {
  for (const [rel, entityType] of [
    ['modules/crm/contacts/contacts.controller.ts', 'CONTACT'],
    ['modules/crm/deals/deals.controller.ts', 'DEAL'],
    ['modules/crm/leads/leads.controller.ts', 'LEAD'],
    ['modules/itdesk/tickets/tickets.controller.ts', 'TICKET'],
  ] as const) {
    const src = code(SRC, rel);
    assert.match(src, new RegExp(`tagIdFilter\\(orgId, '${entityType}'`), `${rel} must accept ?tagId=`);
  }
});

// ─── AI ───────────────────────────────────────────────────────────────────────

test('the AI TAG action writes tags, not a comment about tags', () => {
  const rules = code(SRC, 'utils/ai-rules.ts');
  const start = rules.indexOf("case 'TAG': {");
  const body = rules.slice(start, rules.indexOf("case 'ROUTE': {", start));

  assert.match(body, /prisma\.recordTag\.upsert/, 'TAG must create a real tag link');
  assert.ok(
    !/prisma\.comment\.create/.test(body),
    'the old behaviour wrote "[AI tags] a, b, c" into a comment body — a tag you could not filter on',
  );
  // Left unbounded, a model inventing free-text tags fills the org's library
  // with near-duplicates within a week.
  assert.match(body, /NEW_TAG_BUDGET/, 'new-tag creation must be capped per run');
});

// ─── Client ───────────────────────────────────────────────────────────────────

test('the tag strip exists, is exported, and is on real record views', () => {
  if (!fs.existsSync(CLIENT)) return; // server-only checkout

  const barrel = read(CLIENT, 'shared/components/index.ts');
  assert.match(barrel, /export \* from '\.\/RecordTags'/, 'RecordTags must be exported from the barrel');

  const mounted = [
    ['modules/crm/deals/DealsPage.tsx', 'DEAL'],
    ['modules/crm/contacts/ContactDetailPage.tsx', 'CONTACT'],
    ['modules/crm/leads/LeadsPage.tsx', 'LEAD'],
    ['modules/itdesk/tickets/TicketsPage.tsx', 'TICKET'],
    ['modules/itdesk/assets/AssetsPage.tsx', 'ASSET'],
    ['pages/QuotesPage.tsx', 'QUOTE'],
    ['pages/CampaignsPage.tsx', 'CAMPAIGN'],
    ['pages/ChangeRequestsPage.tsx', 'CHANGE_REQUEST'],
  ] as const;

  for (const [rel, entityType] of mounted) {
    const src = read(CLIENT, rel);
    assert.match(
      src,
      new RegExp(`<RecordTags entityType="${entityType}"`),
      `${rel} must render the tag strip — an API with no UI is how tags got lost the first time`,
    );
  }
});

test('the tag picker renders through a portal, like every other popover', () => {
  if (!fs.existsSync(CLIENT)) return;
  const src = read(CLIENT, 'shared/components/RecordTags.tsx');
  // Record headers sit inside modals with overflow:hidden — an absolutely
  // positioned list is clipped there, which is the bug that made pickers
  // "disappear" on mobile.
  assert.match(src, /createPortal/);
  assert.match(src, /useAnchoredPopover/);
});

test('client and server agree on the taggable entity types', () => {
  if (!fs.existsSync(CLIENT)) return;

  const server = code(SRC, 'utils/entityAccess.ts');
  const serverTypes = [...server.matchAll(/^\s{2}([A-Z_]+):\s*prisma\./gm)].map(m => m[1]).sort();

  const api = read(CLIENT, 'api/tags.ts');
  const union = api.slice(api.indexOf('export type TagEntityType'), api.indexOf(';', api.indexOf('export type TagEntityType')));
  const clientTypes = [...union.matchAll(/'([A-Z_]+)'/g)].map(m => m[1]).sort();

  assert.deepEqual(clientTypes, serverTypes);
});
