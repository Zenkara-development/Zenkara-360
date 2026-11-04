/**
 * Unit tests for the attachment upload policy and the cleanup wiring.
 *
 * The upload rules are pure functions, so they get real assertions. The
 * cleanup side is mostly Prisma calls, so what is tested here is the thing
 * that actually went wrong before: whether every code path that deletes a
 * record remembers to purge that record's polymorphic children, and whether
 * the single-attachment handlers still gate on the parent record existing.
 * Those are structural facts about the source, and a scan catches the
 * regression a mocked-Prisma test would not — someone adding a fifteenth
 * entity type and forgetting the purge call.
 *
 *     npm run test:unit
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { sanitiseFilename, assertUploadAllowed, MAX_UPLOAD_BYTES, UPLOAD_POLICY } from '../../src/utils/uploadPolicy';

const SRC = path.join(__dirname, '../../src');

/** Strips comments so a scanner never matches an example inside a doc block. */
function code(file: string): string {
  return fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// ─── sanitiseFilename ─────────────────────────────────────────────────────────

test('sanitiseFilename strips directory traversal in both separator styles', () => {
  // The reason this function exists: originalname went straight into the S3
  // object key, under a `${orgId}/` prefix that is the only tenant boundary
  // in the shared bucket.
  assert.equal(sanitiseFilename('../../other-org/secrets.pdf'), 'secrets.pdf');
  assert.equal(sanitiseFilename('..\\..\\other-org\\secrets.pdf'), 'secrets.pdf');
  assert.equal(sanitiseFilename('C:\\Users\\kesava\\Desktop\\quote.docx'), 'quote.docx');
  assert.equal(sanitiseFilename('/etc/passwd.txt'), 'passwd.txt');
});

test('sanitiseFilename removes leading dots so nothing becomes a dotfile or ..', () => {
  assert.equal(sanitiseFilename('...hidden.pdf'), 'hidden.pdf');
  assert.equal(sanitiseFilename('..'), 'file');
  assert.equal(sanitiseFilename('.'), 'file');
});

test('sanitiseFilename strips control characters, including NUL truncation tricks', () => {
  assert.equal(sanitiseFilename('report\u0000.exe.pdf'), 'report.exe.pdf');
  // Removed outright rather than replaced with a space — a CRLF in a name
  // that reaches a Content-Disposition header is a response-splitting attempt,
  // not a typo worth preserving the shape of.
  assert.equal(sanitiseFilename('bad\r\nname.pdf'), 'badname.pdf');
});

test('sanitiseFilename never returns an empty string', () => {
  for (const input of ['', '   ', '///', '\u0000', '...']) {
    assert.ok(sanitiseFilename(input).length > 0, `empty result for ${JSON.stringify(input)}`);
  }
});

test('sanitiseFilename keeps ordinary names, including unicode, intact', () => {
  assert.equal(sanitiseFilename('Q3 réport (final).pdf'), 'Q3 réport (final).pdf');
  assert.equal(sanitiseFilename('invoice-2026-08.xlsx'), 'invoice-2026-08.xlsx');
});

test('sanitiseFilename bounds the length', () => {
  assert.ok(sanitiseFilename('a'.repeat(5000) + '.pdf').length <= 180);
});

// ─── assertUploadAllowed ──────────────────────────────────────────────────────

function rejects(name: string, size?: number): string | null {
  try {
    assertUploadAllowed(name, size);
    return null;
  } catch (err: any) {
    return err.message;
  }
}

test('assertUploadAllowed accepts the formats customers actually attach', () => {
  for (const name of ['brief.pdf', 'sheet.xlsx', 'screenshot.PNG', 'logs.zip', 'call.mp4', 'thread.eml']) {
    assert.equal(rejects(name), null, `${name} should be allowed`);
  }
});

test('assertUploadAllowed blocks executables and script-bearing documents', () => {
  for (const name of ['setup.exe', 'payload.bat', 'shell.sh', 'logo.svg', 'page.html', 'x.php']) {
    assert.notEqual(rejects(name), null, `${name} should be blocked`);
  }
});

test('assertUploadAllowed is not fooled by case or by a double extension', () => {
  assert.notEqual(rejects('invoice.pdf.exe'), null);
  assert.notEqual(rejects('invoice.EXE'), null);
  assert.equal(rejects('invoice.exe.pdf'), null); // last extension wins, and it is a real PDF path
});

test('assertUploadAllowed rejects an extensionless file rather than guessing', () => {
  assert.notEqual(rejects('README'), null);
});

test('assertUploadAllowed enforces the size ceiling only when a size is given', () => {
  assert.equal(rejects('big.pdf'), null, 'fileFilter runs before the size is known');
  assert.equal(rejects('big.pdf', MAX_UPLOAD_BYTES), null);
  assert.notEqual(rejects('big.pdf', MAX_UPLOAD_BYTES + 1), null);
});

test('assertUploadAllowed checks the sanitised name, not the raw one', () => {
  // Without sanitising first, path.extname('evil.pdf\u0000.exe') and the name
  // written to disk could disagree.
  assert.notEqual(rejects('../../x.exe'), null);
});

test('UPLOAD_POLICY exposes what the client needs and nothing else', () => {
  assert.equal(UPLOAD_POLICY.maxBytes, MAX_UPLOAD_BYTES);
  assert.ok(UPLOAD_POLICY.allowedExtensions.includes('.pdf'));
  assert.ok(!UPLOAD_POLICY.allowedExtensions.includes('.exe'));
  assert.ok(!UPLOAD_POLICY.allowedExtensions.includes('.svg'));
  // Every entry must be a usable value for the file input's accept attribute.
  for (const ext of UPLOAD_POLICY.allowedExtensions) {
    assert.match(ext, /^\.[a-z0-9]+$/, `${ext} is not a plain lowercase extension`);
  }
});

// ─── Structural guards ────────────────────────────────────────────────────────

test('the upload route rejects files before buffering them', () => {
  const routes = code(path.join(SRC, 'modules/attachments/attachments.routes.ts'));
  assert.match(routes, /fileFilter/, 'multer must have a fileFilter');
  assert.match(routes, /assertUploadAllowed/, 'the fileFilter must use the shared policy');
  assert.match(routes, /limits:\s*\{\s*fileSize:\s*MAX_UPLOAD_BYTES/, 'the size limit must come from the policy, not a literal');
});

test('single-attachment handlers do not gate on the parent record still existing', () => {
  const controller = code(path.join(SRC, 'modules/attachments/attachments.controller.ts'));

  // The original bug: remove() called assertEntityInOrg() first, so deleting a
  // deal made every file on it permanently undeletable — while it went on
  // counting against the org's storage quota.
  const remove = controller.slice(controller.indexOf('export async function remove'));
  assert.ok(!remove.includes('assertEntityInOrg'), 'remove() must not require the parent record to exist');
  assert.ok(remove.includes('loadForOrg'), 'remove() must still scope the row to the caller org');

  const download = controller.slice(
    controller.indexOf('export async function download'),
    controller.indexOf('export async function remove'),
  );
  assert.ok(!download.includes('assertEntityInOrg'), 'download() must not require the parent record to exist');
  assert.ok(download.includes('loadForOrg'), 'download() must still scope the row to the caller org');

  // list() and upload() are addressed by entityType/entityId, so they must
  // still prove that pair belongs to the caller's org.
  const list = controller.slice(controller.indexOf('export async function list'), controller.indexOf('export async function upload'));
  assert.ok(list.includes('assertEntityInOrg'), 'list() must still check the parent is in-org');
});

test('every record-delete path purges its polymorphic children', () => {
  // One entry per EntityType that a controller can delete directly. If a new
  // entity type gains a delete endpoint, add it here and wire the purge.
  const paths: Array<[string, string]> = [
    ['modules/crm/accounts/accounts.controller.ts', 'ACCOUNT'],
    ['modules/crm/contacts/contacts.controller.ts', 'CONTACT'],
    ['modules/crm/deals/deals.controller.ts', 'DEAL'],
    ['modules/crm/leads/leads.controller.ts', 'LEAD'],
    ['modules/itdesk/assets/assets.controller.ts', 'ASSET'],
    ['modules/itdesk/tickets/tickets.controller.ts', 'TICKET'],
    ['modules/quotes/quotes.controller.ts', 'QUOTE'],
    ['modules/campaigns/campaigns.controller.ts', 'CAMPAIGN'],
    ['modules/invoices/invoices.controller.ts', 'INVOICE'],
    ['modules/changemanagement/changeRequests.controller.ts', 'CHANGE_REQUEST'],
    ['modules/tasks/tasks.controller.ts', 'TASK'],
    ['modules/hr/employees/employees.controller.ts', 'EMPLOYEE'],
    ['modules/hr/org/orgStructure.controller.ts', 'DEPARTMENT'],
  ];

  for (const [rel, entityType] of paths) {
    const src = code(path.join(SRC, rel));
    assert.ok(
      src.includes(`purgeEntityChildren('${entityType}'`),
      `${rel} deletes a ${entityType} without purging its comments/attachments/tasks`,
    );
  }
});

test('the orphan reaper is actually started', () => {
  const index = code(path.join(SRC, 'index.ts'));
  assert.match(index, /startOrphanReaper\(\)/, 'index.ts must start the reaper — controller purges cannot see DB-level cascades');
});

test('an oversized upload is a 413, not a 500', () => {
  const handler = code(path.join(SRC, 'middleware/errorHandler.ts'));
  assert.match(handler, /MulterError/, 'multer errors must be handled explicitly');
  assert.match(handler, /LIMIT_FILE_SIZE/);
  assert.match(handler, /413/);
});

test('the hosted-storage fallback checks a bucket is configured first', () => {
  const storage = code(path.join(SRC, 'utils/storage.ts'));
  const fallback = storage.slice(storage.indexOf('if (!config)'), storage.indexOf("if (config.provider === 'GOOGLE_DRIVE')"));
  // Renamed to isHostedStorageConfigured when the bucket became configurable
  // from the platform console as well as the environment — the guard is the
  // same, the answer just has two possible sources now.
  assert.match(fallback, /isHostedStorageConfigured\(\)/, 'a deploy with no bucket at all must get a 400, not an SDK crash');
});

test('client and server agree on the attachable entity types', () => {
  const server = code(path.join(SRC, 'utils/entityAccess.ts'));
  const serverTypes = [...server.matchAll(/^\s{2}([A-Z_]+):\s*prisma\./gm)].map(m => m[1]).sort();

  const clientFile = path.join(__dirname, '../../../client/src/shared/components/Attachments.tsx');
  if (!fs.existsSync(clientFile)) return; // server-only checkout

  const clientSrc = fs.readFileSync(clientFile, 'utf8');
  const union = clientSrc.slice(
    clientSrc.indexOf('export type AttachmentEntityType'),
    clientSrc.indexOf(';', clientSrc.indexOf('export type AttachmentEntityType')),
  );
  const clientTypes = [...union.matchAll(/'([A-Z_]+)'/g)].map(m => m[1]).sort();

  assert.deepEqual(
    clientTypes,
    serverTypes,
    'the Attachments component would 404 on any type the server supports but it does not list',
  );
});
