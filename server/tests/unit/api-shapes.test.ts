/**
 * Response-shape agreement between the API and its callers.
 *
 * The bug this exists for: `GET /users` returns a bare array while every
 * paginated endpoint returns a `{ data, total }` envelope. A caller wrote
 * `usersData?.data ?? []` — perfectly reasonable-looking, and `undefined ?? []`
 * against an array — so the task assignee dropdown rendered with zero options,
 * no error, no console warning. It was invisible until someone tried to assign
 * a task.
 *
 * Worse, the UI mock in tests/ui returned a *paged* envelope for that route, so
 * browser testing agreed with the broken code. A mock that lies about a shape
 * is worse than no mock, and that is what these tests pin.
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
const UI = path.join(ROOT, '../tests/ui');

function read(...p: string[]): string { return fs.readFileSync(path.join(...p), 'utf8'); }

test('GET /users still returns a bare array', () => {
  const routes = read(SRC, 'modules/core/users/users.routes.ts');
  // If this ever becomes paginated, useUsers() normalises either way — but the
  // mock and this test both need to move with it.
  assert.match(routes, /res\.json\(users\)/, 'GET /users is expected to return the array directly');
  assert.ok(!/paginate\(/.test(routes), 'if /users becomes paginated, update useUsers, the UI mock and this test together');
});

test('useUsers is typed as an array, so `.data` on it cannot compile', () => {
  if (!fs.existsSync(CLIENT)) return;
  const hook = read(CLIENT, 'api/users.ts');
  assert.match(hook, /useQuery<OrgUser\[\]>/, 'the array type is what turns this class of bug into a compile error');
  // Belt and braces: normalise whatever arrives, so a future envelope does not
  // silently empty every assignee dropdown in the product.
  assert.match(hook, /Array\.isArray\(d\)/, 'the queryFn must normalise the response shape');
});

test('no caller reads .data off the users list', () => {
  if (!fs.existsSync(CLIENT)) return;
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      // Comments stripped first. Without this the scanner matches the doc
      // comment in RecordTasks.tsx that *describes* the old bug — the same
      // trap a previous codemod in this repo fell into.
      const src = fs.readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (!/useUsers\(\)/.test(src)) continue;
      // Match `<whatever useUsers was destructured to>?.data` / `.data`.
      const alias = src.match(/const\s*\{\s*data:\s*(\w+)\s*\}\s*=\s*useUsers\(\)/)?.[1];
      if (alias && new RegExp(`\\b${alias}\\s*\\??\\.data\\b`).test(src)) {
        offenders.push(path.relative(CLIENT, full));
      }
    }
  };
  walk(CLIENT);
  assert.deepEqual(offenders, [], `these treat the users array as an envelope: ${offenders.join(', ')}`);
});

test('the UI mock agrees with the real /users shape', () => {
  if (!fs.existsSync(UI)) return;
  const mock = read(UI, 'mock-api.mjs');
  const line = mock.split('\n').find(l => l.includes("'GET /users'"));
  assert.ok(line, 'the mock must define GET /users');
  assert.ok(
    !/paged\(/.test(line!),
    'the mock returned paged(users) while the API returns a bare array — that disagreement hid a real bug from browser testing',
  );
});

test('the UI mock uses real UserRole values', () => {
  if (!fs.existsSync(UI)) return;
  const schema = read(ROOT, 'prisma/schema.prisma');
  const block = schema.slice(schema.indexOf('enum UserRole {'), schema.indexOf('}', schema.indexOf('enum UserRole {')));
  const real = new Set([...block.matchAll(/^\s{2}([A-Z_]+)$/gm)].map(m => m[1]));

  const mock = read(UI, 'mock-api.mjs');
  const roleLine = mock.split('\n').find(l => l.includes('role:') && l.includes('SUPER_ADMIN'));
  assert.ok(roleLine, 'the mock must seed user roles');
  const used = [...roleLine!.matchAll(/'([A-Z_]+)'/g)].map(m => m[1]);
  const invented = used.filter(r => !real.has(r));
  // Inventing roles means any UI that maps a role to a label or a permission
  // gets tested against values it will never actually receive.
  assert.deepEqual(invented, [], `roles not in the UserRole enum: ${invented.join(', ')}`);
});
