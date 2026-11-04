import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Carries the calling org and user down to `utils/ai.ts`'s `chat()`.
 *
 * The gateway (`utils/aiGateway.ts`) needs an `orgId` to check a budget, pick
 * the org's own provider key, and write an `AiInteractionLog` row. The ~26
 * legacy AI helpers in `utils/ai.ts` never received one: they take a domain
 * object (a lead, a ticket) and nothing else, and they are called from ~30
 * controller handlers. Threading `orgId` through by hand would mean changing
 * every signature and every call site — a large, error-prone diff whose only
 * purpose is to move one string.
 *
 * AsyncLocalStorage carries it implicitly instead. One middleware opens a
 * store per request; anything downstream in that async chain can read it,
 * however deep. That is exactly the shape of this problem.
 *
 * The trade-off worth knowing: work that escapes the request's async context —
 * a `setTimeout`, a queue worker, a cron job — sees an empty store. `chat()`
 * treats that as "no context" and falls back to calling the provider directly,
 * so a background job still works; it just is not logged or budgeted. Those
 * call sites should pass an explicit context via `runWithAiContext` instead.
 */

export interface AiRequestContext {
  orgId: string;
  userId?: string | null;
}

const storage = new AsyncLocalStorage<AiRequestContext>();

/** Run `fn` with an AI context attached. Used by middleware and by jobs. */
export function runWithAiContext<T>(ctx: AiRequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The current context, or null outside a request. */
export function getAiContext(): AiRequestContext | null {
  return storage.getStore() ?? null;
}

/**
 * Express middleware. Mount AFTER whatever populates `req.user`, so the org is
 * known; mounting it earlier silently yields a null context and every AI call
 * quietly falls back to the ungoverned path.
 */
export function aiContextMiddleware(req: any, _res: any, next: any) {
  const user = req.user;
  if (!user?.orgId) return next();
  runWithAiContext({ orgId: user.orgId, userId: user.id ?? null }, next);
}
