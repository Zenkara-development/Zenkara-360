/**
 * Preload that stubs @prisma/client for the pure-logic unit tests.
 *
 * The functions under test (scopedWhere, redact, conditionsMatch, chunkText…)
 * never touch the database — but they live in modules that import
 * utils/prisma, which constructs a PrismaClient at import time. Prisma then
 * resolves its native query engine asynchronously, and if the engine is
 * missing or mismatched (a fresh clone before `prisma generate`, a CI image on
 * a different libc) that rejection surfaces *after* the tests finish and fails
 * the run even though every assertion passed.
 *
 * Stubbing the module removes the dependency entirely, which is the honest
 * position for a unit test: these assertions are about logic, not storage.
 * Integration coverage of the query paths lives in tests/integration.
 *
 * Usage:  node --test --require ./tests/unit/stub-prisma.js --require ts-node/register tests/unit/*.test.ts
 */
const Module = require('module');
const originalResolve = Module._resolveFilename;

const handler = {
  get: (target, prop) => {
    if (prop === 'then') return undefined; // never look thenable to await
    if (!(prop in target)) {
      target[prop] = new Proxy({}, handler);
    }
    return target[prop];
  },
  apply: () => new Proxy({}, handler),
};

class PrismaClient {
  constructor() {
    return new Proxy({}, handler);
  }
}

// Prisma also exports every schema enum as a runtime object (UserRole.ADMIN
// etc.). Modules under test reference those at import time, so an unknown
// export resolves to a self-describing enum whose members return their own
// name — enough for any code that only compares or stores the value.
function enumProxy(name) {
  return new Proxy(
    {},
    {
      get: (_t, member) => (typeof member === 'string' ? member : undefined),
      has: () => true,
    }
  );
}

const known = {
  PrismaClient,
  Prisma: { InputJsonValue: undefined, sql: () => ({}), raw: () => ({}) },
};

const stub = new Proxy(known, {
  get: (target, prop) => {
    if (prop in target) return target[prop];
    if (typeof prop !== 'string') return undefined;
    // Module interop probes these; answering with an enum would break require().
    if (prop === '__esModule' || prop === 'default' || prop === 'then') return undefined;
    target[prop] = enumProxy(prop);
    return target[prop];
  },
  has: () => true,
});

Module._resolveFilename = function (request, ...rest) {
  if (request === '@prisma/client') return '@prisma/client__stub';
  return originalResolve.call(this, request, ...rest);
};

require.cache['@prisma/client__stub'] = {
  id: '@prisma/client__stub',
  filename: '@prisma/client__stub',
  loaded: true,
  exports: stub,
};
