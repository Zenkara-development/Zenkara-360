/**
 * Interactive mobile probe. The static sweep only measures the page at rest;
 * "randomly hiding" UI is usually an interaction state — an open dropdown, a
 * sticky header, a popover clipped by an ancestor. This opens things and looks.
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
const PORT = 4179;
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const mock = (await import(new URL('./mock-api.mjs', import.meta.url).href)).default;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return mock(req, res, url);
  let f = path.join(DIST, url.pathname);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
});
await ctx.addInitScript(() => {
  localStorage.setItem('accessToken', 'mock-access-token');
  localStorage.setItem('refreshToken', 'mock-refresh-token');
  localStorage.setItem('user', JSON.stringify({ id:'u1', name:'Alex Morgan', email:'admin@crmitdesk.com', role:'SUPER_ADMIN', orgId:'org1', org:{ id:'org1', name:'Acme Corporation', slug:'acme', plan:'ENTERPRISE' } }));
  localStorage.setItem('ui-theme', 'minimal');
  localStorage.setItem('ui-dark', 'false');
});

const page = await ctx.newPage();
const out = [];
const say = (s) => { console.log(s); out.push(s); };

/** Is `sel` visibly on top at its own centre, and inside the viewport? */
async function probe(name, sel) {
  const r = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { missing: true };
    const b = el.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const clipped = b.right > innerWidth + 1 || b.left < -1 || b.bottom > innerHeight + 1 || b.top < -1;
    // Walk ancestors for an overflow that would clip this element.
    let clipper = null;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflow !== 'visible' && cs.overflow !== '') {
        const pr = p.getBoundingClientRect();
        if (b.right > pr.right + 1 || b.left < pr.left - 1 || b.bottom > pr.bottom + 1) {
          clipper = `${p.tagName.toLowerCase()}.${(p.className || '').toString().split(' ').slice(0,3).join('.')} overflow:${cs.overflow}`;
          break;
        }
      }
    }
    return {
      rect: { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), btm: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) },
      vw: innerWidth, vh: innerHeight,
      onTop: top === el || el.contains(top),
      coveredBy: top && !el.contains(top) ? `${top.tagName.toLowerCase()} z=${getComputedStyle(top).zIndex} "${(top.textContent||'').trim().slice(0,30)}"` : null,
      clipped, clipper,
    };
  }, sel);
  if (r.missing) { say(`  ${name}: NOT FOUND`); return r; }
  const flags = [];
  if (!r.onTop && r.coveredBy) flags.push(`COVERED by ${r.coveredBy}`);
  if (r.clipped) flags.push(`OUTSIDE VIEWPORT (${r.rect.l}..${r.rect.r} of ${r.vw}w, ${r.rect.t}..${r.rect.btm} of ${r.vh}h)`);
  if (r.clipper) flags.push(`CLIPPED by ${r.clipper}`);
  say(`  ${name}: ${flags.length ? '⚠ ' + flags.join(' | ') : 'ok'}  [${r.rect.w}×${r.rect.h} @ ${r.rect.l},${r.rect.t}]`);
  return r;
}

const go = async (route) => {
  await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: 'networkidle', timeout: 20000 }).catch(()=>{});
  await page.waitForTimeout(600);
};

// ── 1. Mobile sidebar ────────────────────────────────────────────────────
say('\n── 1. Mobile navigation drawer ──');
await go('/dashboard');
await page.click('button[aria-label="Open menu"]').catch(()=>say('  hamburger not clickable'));
await page.waitForTimeout(500);
await probe('sidebar drawer', 'aside');
await probe('a nav link', 'aside a[href="/my-work"]');
await page.screenshot({ path: './shots/m-sidebar.png' });
await page.keyboard.press('Escape');
await page.mouse.click(370, 500);
await page.waitForTimeout(400);

// ── 2. PageHeader stickiness + its actions after scrolling ───────────────
say('\n── 2. Sticky PageHeader while scrolled ──');
await go('/crm/deals');
await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 600));
await page.waitForTimeout(400);
await probe('page header', 'main .sticky');
await page.screenshot({ path: './shots/m-scrolled.png' });

// ── 3. A dropdown opened from a row (RowActions, z-[300], fixed) ─────────
say('\n── 3. Row actions menu ──');
await go('/crm/deals');
const rowBtn = await page.$('button[aria-label*="ctions"], button[aria-haspopup]');
if (rowBtn) {
  await rowBtn.click().catch(()=>{});
  await page.waitForTimeout(400);
  await probe('row menu', '.ui-popover');
  await page.screenshot({ path: './shots/m-rowmenu.png' });
} else say('  no row-actions button found');

// ── 4. The AiInfo popover I added ────────────────────────────────────────
say('\n── 4. AI info popover ──');
await go('/itdesk/tickets');
const info = await page.$('button[aria-label^="About "]');
if (info) {
  await info.click().catch(()=>{});
  await page.waitForTimeout(400);
  await probe('AI info popover', '[role="dialog"][aria-label]');
  await page.screenshot({ path: './shots/m-aiinfo.png' });
} else say('  no AiInfo trigger on this page');

// ── 5. A modal ───────────────────────────────────────────────────────────
say('\n── 5. Modal ──');
await go('/crm/contacts');
const addBtn = await page.$('button:has-text("New"), button:has-text("Add"), button:has-text("Create")');
if (addBtn) {
  await addBtn.click().catch(()=>{});
  await page.waitForTimeout(600);
  await probe('modal panel', '[role="dialog"]');
  await page.screenshot({ path: './shots/m-modal.png' });
} else say('  no create button found');

// ── 6. Theme picker (bottom of sidebar, z-[200]) ─────────────────────────
say('\n── 6. Theme picker inside the drawer ──');
await go('/dashboard');
await page.click('button[aria-label="Open menu"]').catch(()=>{});
await page.waitForTimeout(500);
const themeBtn = await page.$('button[aria-label="Appearance settings"]');
if (themeBtn) {
  await themeBtn.click().catch(()=>{});
  await page.waitForTimeout(400);
  await probe('theme panel', '.ui-popover');
  await page.screenshot({ path: './shots/m-theme.png' });
} else say('  theme button not found');

await browser.close();
server.close();
fs.writeFileSync('./probe.txt', out.join('\n'));
console.log('\ndone');
