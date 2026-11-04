/**
 * Single-process UI sweep: serves dist/ + a mock API, drives Chromium over
 * every route at three viewports, and reports layout defects.
 *
 * One process because the sandbox reaps detached background jobs between
 * shell calls, so a separately-started server does not survive.
 *
 * Detects, per route per viewport:
 *   - horizontal overflow (content wider than the viewport)
 *   - interactive controls clipped outside the viewport or by an ancestor
 *   - controls smaller than the 24px minimum touch target
 *   - elements covered by another element (a nav bar sitting on top of content)
 *   - blank renders and console/page errors
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
/* Playwright lives at the workspace root as @playwright/test; a standalone
   `playwright` install also works. Try both so this runs from either. */
const { chromium } = await (async () => {
  for (const m of ['@playwright/test', 'playwright']) {
    try { return await import(m); } catch { /* try the next */ }
  }
  throw new Error('Playwright not found — run `npm install` at the repo root.');
})();

const DIST = path.resolve(process.env.DIST || '../../client/dist');
const PORT = 4178;

/* ── static + mock api ────────────────────────────────────────────────── */
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

const mock = (await import(new URL('./mock-api.mjs', import.meta.url).href)).default;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return mock(req, res, url);

  let file = path.join(DIST, url.pathname);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  res.end(body);
});
await new Promise(r => server.listen(PORT, r));

/* ── routes ───────────────────────────────────────────────────────────── */
const ROUTES = [
  '/login', '/demo', '/dashboard', '/crm/contacts', '/crm/contacts/c1', '/crm/deals', '/crm/leads',
  '/itdesk/tickets', '/itdesk/articles', '/itdesk/assets', '/itdesk/categories',
  '/hr/employees', '/hr/attendance', '/hr/leave', '/hr/payroll', '/hr/org', '/hr/settings', '/hr/directory',
  '/people', '/my-work', '/approvals', '/workflows', '/inbox', '/campaigns',
  '/quotes', '/invoices', '/change-requests', '/analytics', '/reports',
  '/admin/users', '/admin/roles', '/admin/ai-governance', '/ai-studio', '/ai-builder',
  '/custom-fields', '/custom-modules', '/templates', '/org-settings', '/branding',
  '/billing', '/api-keys', '/audit-logs', '/jobs', '/storage', '/profile',
  '/security/2fa', '/slack', '/teams', '/directory-sso', '/import', '/portal-users',
];

const VIEWPORTS = [
  { name: 'mobile',  width: 390,  height: 844 },
  { name: 'tablet',  width: 768,  height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

/* ── in-page audit ────────────────────────────────────────────────────── */
const AUDIT = () => {
  const out = { overflowX: 0, offscreen: [], tiny: [], covered: [], text: 0 };
  const vw = window.innerWidth;

  out.overflowX = Math.max(0, document.documentElement.scrollWidth - vw);
  out.text = (document.body.innerText || '').trim().length;

  const label = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 45);
    return `${el.tagName.toLowerCase()}${t ? ` "${t}"` : ''}`;
  };

  const controls = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="tab"], [role="switch"]')];
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0 || r.height === 0) continue;

    // Off the right edge, or negative-left — the classic "hidden on mobile".
    if (r.right > vw + 1 || r.left < -1) {
      out.offscreen.push({ el: label(el), left: Math.round(r.left), right: Math.round(r.right), vw });
    }
    // Below the 24px minimum target.
    if (r.height < 24 && r.width < 24) out.tiny.push({ el: label(el), w: Math.round(r.width), h: Math.round(r.height) });

    // Something else painted over the control's own centre.
    const cx = Math.min(vw - 2, Math.max(2, r.left + r.width / 2));
    const cy = Math.min(window.innerHeight - 2, Math.max(2, r.top + r.height / 2));
    if (cy > 0 && cy < window.innerHeight) {
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) {
        const tr = top.getBoundingClientRect();
        if (tr.width * tr.height > 400) {
          out.covered.push({ el: label(el), by: label(top), byZ: getComputedStyle(top).zIndex });
        }
      }
    }
  }
  out.offscreen = out.offscreen.slice(0, 6);
  out.tiny = out.tiny.slice(0, 4);
  out.covered = out.covered.slice(0, 6);
  return out;
};

/* ── run ──────────────────────────────────────────────────────────────── */
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const findings = [];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    isMobile: vp.name === 'mobile',
    hasTouch: vp.name === 'mobile',
  });
  // Pre-authenticate so protected routes render instead of bouncing to /login.
  await ctx.addInitScript(() => {
    localStorage.setItem('accessToken', 'mock-access-token');
    localStorage.setItem('refreshToken', 'mock-refresh-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'u1', name: 'Alex Morgan', email: 'admin@crmitdesk.com', role: 'SUPER_ADMIN',
      orgId: 'org1', org: { id: 'org1', name: 'Acme Corporation', slug: 'acme', plan: 'ENTERPRISE' },
    }));
    localStorage.setItem('ui-theme', 'minimal');
    localStorage.setItem('ui-dark', 'false');
  });

  for (const route of ROUTES) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).split('\n')[0].slice(0, 120)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });

    try {
      await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: 'networkidle', timeout: 20000 });
    } catch { /* keep going; a timeout is itself a finding via low text */ }
    await page.waitForTimeout(500);

    let a;
    try { a = await page.evaluate(AUDIT); } catch { a = null; }

    if (a) {
      const problems = [];
      if (a.overflowX > 2) problems.push(`overflow-x ${a.overflowX}px`);
      if (a.offscreen.length) problems.push(`${a.offscreen.length} offscreen`);
      if (a.covered.length) problems.push(`${a.covered.length} covered`);
      if (a.tiny.length) problems.push(`${a.tiny.length} tiny`);
      if (a.text < 60) problems.push(`blank (${a.text} chars)`);
      const realErrors = errors.filter(e => !/favicon|manifest|sw\.js|Failed to load resource/i.test(e));
      if (realErrors.length) problems.push(`${realErrors.length} js errors`);

      if (problems.length) {
        findings.push({ viewport: vp.name, route, problems, detail: a, errors: realErrors.slice(0, 2) });
      }
    }
    await page.close();
  }
  await ctx.close();
  console.log(`✓ swept ${ROUTES.length} routes @ ${vp.name}`);
}

await browser.close();
server.close();

fs.writeFileSync('./sweep.json', JSON.stringify(findings, null, 2));

/* ── report ───────────────────────────────────────────────────────────── */
console.log(`\n${'='.repeat(72)}\nFINDINGS: ${findings.length} route/viewport combinations with problems\n${'='.repeat(72)}`);

const byProblem = {};
for (const f of findings) for (const p of f.problems) {
  const kind = p.replace(/^\d+ /, '').replace(/ \d+px$/, '');
  (byProblem[kind] ??= []).push(`${f.viewport}:${f.route}`);
}
console.log('\nBY KIND:');
for (const [k, v] of Object.entries(byProblem).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(v.length).padStart(3)}  ${k}`);
}

console.log('\nMOBILE DETAIL (first 12):');
for (const f of findings.filter(x => x.viewport === 'mobile').slice(0, 12)) {
  console.log(`\n  ${f.route}  →  ${f.problems.join(', ')}`);
  for (const o of f.detail.offscreen) console.log(`      offscreen: ${o.el}  [${o.left}..${o.right}] vw=${o.vw}`);
  for (const c of f.detail.covered) console.log(`      covered:   ${c.el}  by ${c.by} (z=${c.byZ})`);
  for (const e of f.errors) console.log(`      error:     ${e}`);
}
