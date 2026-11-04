import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = await import('playwright');
const DIST = path.resolve('/home/claude/qq/client/dist');
const PORT = 4187;
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const base = (await import('file:///home/claude/qq/tests/ui/mock-api.mjs')).default;
const server = http.createServer((req,res)=>{
  const url = new URL(req.url,'http://x');
  if (url.pathname.startsWith('/api/')) return base(req,res,url);
  let f = path.join(DIST,url.pathname);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()) f = path.join(DIST,'index.html');
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]??'application/octet-stream'}); res.end(fs.readFileSync(f));
});
await new Promise(r=>server.listen(PORT,r));
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport:{width:1000,height:950} });
await ctx.addInitScript(()=>{ localStorage.setItem('accessToken','m'); localStorage.setItem('refreshToken','m');
  localStorage.setItem('user', JSON.stringify({id:'u1',name:'SD Admin',email:'a@b.c',role:'SUPER_ADMIN',orgId:'org1',org:{id:'org1',name:'Acme',slug:'acme',plan:'ENTERPRISE'}}));
  localStorage.setItem('ui-theme','minimal'); localStorage.setItem('ui-dark','false'); });
const page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/crm/contacts`,{waitUntil:'networkidle'}).catch(()=>{});
await page.waitForTimeout(1200);
const row = await page.$('table tbody tr td');
if (row) { await row.click(); await page.waitForTimeout(1500); }

// Open the task add form
// The Tasks card's own Add button, scoped to that card so we don't hit
// "Add Activity" or "Log Activity" elsewhere on the page.
const clicked = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('div')];
  const card = cards.find(d => /Tasks/.test(d.querySelector('h3,h2,p')?.textContent ?? '') && d.querySelector('button'));
  const btn = [...(card?.querySelectorAll('button') ?? [])].find(b => /^Add$/i.test(b.textContent.trim()));
  if (btn) { btn.click(); return true; }
  // Fall back to the empty-state call to action.
  const cta = [...document.querySelectorAll('button')].find(b => /Add a task/i.test(b.textContent));
  if (cta) { cta.click(); return true; }
  return false;
});
console.log('opened task form:', clicked);
await page.waitForTimeout(900);

// Read the hidden native <select> SearchableSelect renders for a11y/tests —
// its <option> list is exactly what the dropdown will show.
const opts = await page.evaluate(() => {
  const sel = document.querySelector('select[aria-label="Assign to"]');
  if (!sel) return null;
  return [...sel.options].map(o => o.textContent.trim());
});
if (opts === null) console.log('assignee control: NOT FOUND');
else {
  console.log('assignee options:', opts.length, '(first is the placeholder)');
  console.log(JSON.stringify(opts, null, 0));
}
await page.screenshot({ path:'/home/claude/qq/tests/ui/shots/task-assignee.png' });
console.log('pageerrors:', errs.slice(0,2));
await browser.close(); server.close();
