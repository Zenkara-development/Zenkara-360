import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runWithAiContext, getAiContext } from '../../src/utils/aiContext';

/**
 * Guards the wiring that puts every AI call under governance.
 *
 * These are deliberately structural rather than behavioural: exercising
 * `complete()` for real needs a database and a provider, but the two things
 * that silently rot are (a) the async context that carries orgId, and (b) the
 * feature labels, which live in two files that must agree.
 */

const SRC = path.resolve(__dirname, '../../src');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');

// ── async context ────────────────────────────────────────────────────────

test('no AI context outside a request', () => {
  assert.equal(getAiContext(), null);
});

test('AI context is visible to nested async work', async () => {
  const seen = await runWithAiContext({ orgId: 'org-1', userId: 'u-1' }, async () => {
    // A promise boundary is the whole point: this is what a controller →
    // helper → chat() chain looks like, and plain module state would not
    // survive concurrent requests here.
    await new Promise(r => setImmediate(r));
    return getAiContext();
  });
  assert.deepEqual(seen, { orgId: 'org-1', userId: 'u-1' });
});

test('concurrent contexts do not leak into each other', async () => {
  const [a, b] = await Promise.all([
    runWithAiContext({ orgId: 'org-A' }, async () => {
      await new Promise(r => setTimeout(r, 12));
      return getAiContext()?.orgId;
    }),
    runWithAiContext({ orgId: 'org-B' }, async () => {
      return getAiContext()?.orgId;
    }),
  ]);
  assert.equal(a, 'org-A');
  assert.equal(b, 'org-B');
});

// ── every AI call is governed ────────────────────────────────────────────

test('utils/ai.ts routes through the gateway', () => {
  const s = read('utils/ai.ts');
  assert.match(s, /from '\.\/aiGateway'/, 'ai.ts must import the gateway');
  assert.match(s, /getAiContext\(\)/, 'ai.ts must read the request context');
});

test('every chat() call carries a governance feature label', () => {
  // Strip comments first — prose mentioning "chat()" is not a call site.
  const s = read('utils/ai.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const unlabelled: number[] = [];
  const re = /\bchat\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    // skip the declaration itself
    if (s.slice(Math.max(0, m.index - 25), m.index + 12).includes('async function chat(')) continue;
    const end = s.indexOf(');', m.index);
    if (!s.slice(m.index, end).includes('feature:')) {
      unlabelled.push(s.slice(0, m.index).split('\n').length);
    }
  }
  assert.deepEqual(unlabelled, [], `chat() calls without a feature label, at lines: ${unlabelled}`);
});

test('no AI stack bypasses the gateway', () => {
  // utils/ai.ts keeps ONE direct call: the documented fallback for work that
  // runs outside a request (cron, queue workers). Anything else reintroduces
  // an ungoverned path, which is what this whole change removed.
  const files = ['utils/ai.ts', 'modules/ai/aiStudio.controller.ts', 'modules/ai/ai.controller.ts'];
  const counts = files.map(f => [f, (read(f).match(/chat\.completions\.create/g) ?? []).length] as const);
  const offenders = counts.filter(([f, n]) => n > (f === 'utils/ai.ts' ? 1 : 0));
  assert.deepEqual(offenders, [], `direct provider calls found: ${JSON.stringify(offenders)}`);
});

// ── the two catalogues must agree ────────────────────────────────────────

test('server feature labels exist in the client AI catalogue', () => {
  const server = read('utils/ai.ts');
  const catalogue = fs.readFileSync(
    path.resolve(__dirname, '../../../client/src/shared/ai/aiFeatures.ts'), 'utf8',
  );

  const known = new Set([...catalogue.matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]));
  assert.ok(known.size > 20, 'client catalogue looks empty — did the path change?');

  const used = new Set(
    [...server.matchAll(/feature:\s*'([^']+)'/g)].map(m => m[1]),
  );

  // A label the dashboard groups by, with no catalogue entry, means the AI
  // Governance page shows a feature users have no explanation for.
  const orphans = [...used].filter(f => !known.has(f) && f !== 'legacy.unlabelled');
  assert.deepEqual(orphans, [], `feature labels missing from client/src/shared/ai/aiFeatures.ts: ${orphans}`);
});
