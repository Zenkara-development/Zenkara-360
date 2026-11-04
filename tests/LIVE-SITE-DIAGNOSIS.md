# Live site: why every API call fails

**Checked:** 15 Aug 2026, against the running deployment.

## Verdict

The backend is fine. The frontend cannot reach it.

**Netlify has no route from `/api/*` to the Render backend**, so every API request
is answered by the SPA catch-all with `index.html`. Axios gets HTML where it
expects JSON and every call in the app fails at once — login included.

This is not caused by the recent work. It has been latent since the frontend
moved from Render's static hosting to Netlify.

## Evidence

| Check | Result |
|---|---|
| `crm-itdesk-server.onrender.com/health` | `{"status":"ok","db":"connected"}` — **healthy** |
| `crm-itdesk-server.onrender.com/api/demo/verticals` | valid JSON, 7 verticals — **working** |
| `app.quantiqsystems.com/api/demo/verticals` | **HTML page** titled "CRM & IT Desk" — broken |
| Netlify deploy summary | *"1 redirect rule processed"* — only the SPA fallback |

Same path, two hosts, two completely different answers. That is the whole bug.

## Why it happens

`src/api/client.ts` calls the API at a relative path:

```ts
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });
```

On Render that worked because `render.yaml` declares the missing half:

```yaml
# frontend service
routes:
  - /api/*  →  crm-itdesk-server     # ← this is what Netlify never had
  - /*      →  /index.html
envVars:
  VITE_API_URL: /api
```

Netlify only ever had `/*  /index.html  200`. So `/api/anything` matched the
catch-all and returned the app shell with HTTP 200 — which is worse than a 404,
because nothing errors loudly. It just silently returns the wrong thing.

The code even warns about this. From `client.ts`:

> *"That only ever worked by accident on Render's own static-site option, which
> has an explicit /api/\* redirect proxy in render.yaml papering over it; any
> other host (Netlify included) sent every request to its own domain instead of
> the API, which doesn't exist there."*

## The fix — already written

`client/public/_redirects`:

```
/api/*  https://crm-itdesk-server.onrender.com/api/:splat  200!
/*      /index.html                                        200
```

**Order matters.** Netlify applies the first matching rule, so the API proxy has
to come before the catch-all. Vite copies `public/` into `dist/`, which is what
Netlify publishes — verified in a local build.

Commit and push, and the Netlify deploy will fix the live site. No backend
change and no environment variable needed.

### Why a proxy rather than pointing `VITE_API_URL` at the backend

Setting `VITE_API_URL=https://crm-itdesk-server.onrender.com/api` also works, but
costs more than it looks:

- every request becomes cross-origin, so `CORS_ORIGIN` on Render must list
  `https://app.quantiqsystems.com` exactly
- **Server-Sent Events break.** `src/hooks/useSSE.ts` uses `EventSource`, which
  cannot send an `Authorization` header cross-origin
- cookie and preflight behaviour become another thing to get right

A same-origin proxy keeps the browser talking to one domain and sidesteps all
three. It is also what Render was already doing, so it restores known-good
behaviour rather than introducing new.

---

## ⚠️ Before you deploy the backend — read this

The live backend is currently running the **old** code. I can tell because
`/api/demo/verticals` returns 7 verticals in the old shape; the new code returns
8 (real estate added) with an `available` field.

Your Render start command is:

```
npx prisma migrate deploy && node dist/index.js
```

That applies migration **files** from `server/prisma/migrations/`. **I did not
create one** — I deliberately left that to `prisma migrate dev` on your machine,
because Prisma generates the SQL by diffing against your real database, which is
safer than SQL I hand-wrote blind.

So if you push the server changes as they stand:

1. `prisma generate` builds a client that expects the new `users.role_id` column
2. `prisma migrate deploy` finds no new migration and applies nothing
3. every `prisma.user.*` query selects `role_id`, which does not exist
4. **login fails, and with it every authenticated request**

That would be a much worse outage than the current one, and the health check
would still report `ok` because the database connects fine.

### Deploy the backend in this order

```bash
cd server
npx prisma migrate dev --name people_platform   # creates the migration file
npx prisma generate
npm run test:unit                                # expect: pass 129

git add prisma/migrations prisma/schema.prisma
git commit -m "Add people platform migration"
git push
```

Confirm `server/prisma/migrations/<timestamp>_people_platform/migration.sql`
exists and is committed **before** pushing. Render will then apply it on start.

### Verify after deploying

```bash
curl https://crm-itdesk-server.onrender.com/health
curl https://crm-itdesk-server.onrender.com/api/demo/status
```

`/api/demo/status` is new — if it 404s, the backend deploy has not gone out yet.
When it does, it reports how many demo verticals are seeded and what to run if
the answer is zero.

Then seed the demo orgs. On Render, the shell for the service:

```bash
npm run db:seed
```

Expect 8 verticals, including `zenith-realty`.

## Suggested order of operations

1. **Push `client/public/_redirects`** → live site works again against the current backend. Lowest risk, fixes the outage now.
2. Generate the migration locally, commit, push the server → backend gets the new features.
3. Seed the demo data → all 8 verticals live.

Step 1 is independent of the other two and safe to do on its own.
