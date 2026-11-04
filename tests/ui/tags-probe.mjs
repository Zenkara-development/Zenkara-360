/**
 * Verifies the tag strip and its picker actually render and are reachable —
 * on a 390px mobile viewport, where a popover clipped by an ancestor's
 * overflow is the failure mode this codebase has hit before.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = await import('playwright');

const DIST = path.resolve('../../client/dist');
const PORT = 4181;
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

for (const [label, viewport, dark] of [
  ['mobile-light', { width: 390, height: 844 }, 'false'],
  ['desktop-dark', { width: 1280, height: 900 }, 'true'],
]) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  await ctx.addInitScript((d) => {
    localStorage.setItem('accessToken', 'mock-access-token');
    localStorage.setItem('refreshToken', 'mock-refresh-token');
    localStorage.setItem('user', JSON.stringify({ id:'u1', name:'Alex Morgan', email:'admin@crmitdesk.com', role:'SUPER_ADMIN', orgId:'org1', org:{ id:'org1', name:'Acme Corporation', slug:'acme', plan:'ENTERPRISE' } }));
    localStorage.setItem('ui-theme', 'minimal');
    localStorage.setItem('ui-dark', d);
  }, dark);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  console.log(`\n══ ${label} ══`);
  await page.goto(`http://localhost:${PORT}/crm/contacts`, { waitUntil: 'networkidle', timeout: 20000 }).catch(()=>{});
  await page.waitForTimeout(800);

  // Open a contact's detail view.
  const row = await page.$('table tbody tr a, table tbody tr button, table tbody tr td');
  if (row) { await row.click().catch(()=>{}); await page.waitForTimeout(1200); }

  const chips = await page.$$('span:has(> span.truncate)');
  const addBtn = await page.$('button[aria-label="Add a tag"]');
  console.log(`  add-tag trigger: ${addBtn ? 'found' : 'NOT FOUND'}`);

  if (addBtn) {
    const chipText = await page.$$eval('[aria-label^="Remove tag"]', els => els.map(e => e.parentElement.textContent.trim()));
    console.log(`  chips on record: ${JSON.stringify(chipText)}`);

    await addBtn.click();
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const el = document.querySelector('.ui-popover');
      if (!el) return { missing: true };
      const b = el.getBoundingClientRect();
      const top = document.elementFromPoint(b.left + b.width/2, b.top + 20);
      return {
        rect: { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), btm: Math.round(b.bottom) },
        vw: innerWidth, vh: innerHeight,
        onTop: el.contains(top),
        options: [...el.querySelectorAll('button')].map(x => x.textContent.trim()).slice(0, 8),
      };
    });
    if (r.missing) console.log('  picker popover: NOT RENDERED');
    else {
      const overflow = r.rect.l < 0 || r.rect.r > r.vw || r.rect.t < 0 || r.rect.btm > r.vh;
      console.log(`  picker popover: ${r.rect.l}..${r.rect.r} of ${r.vw}w, ${r.rect.t}..${r.rect.btm} of ${r.vh}h ${overflow ? '⚠ OFF-SCREEN' : 'ok'}, onTop=${r.onTop}`);
      console.log(`  options: ${JSON.stringify(r.options)}`);

      // Type a new name and confirm the create affordance appears.
      await page.fill('input[placeholder="Find or create a tag…"]', 'Escalated').catch(()=>{});
      await page.waitForTimeout(400);
      const create = await page.$$eval('.ui-popover button', els => els.map(e => e.textContent.trim()).filter(t => t.startsWith('Create')));
      console.log(`  create affordance: ${JSON.stringify(create)}`);
    }
    await page.screenshot({ path: `./shots/tags-${label}.png`, fullPage: false });
  }
  console.log(`  console errors: ${errors.length ? errors.slice(0,3).join(' | ') : 'none'}`);
  await ctx.close();
}

await browser.close();
server.close();
