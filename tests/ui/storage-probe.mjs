/**
 * Shows what the Storage page renders in each of the states an admin can hit,
 * by varying only what GET /api/storage/status returns.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = await import('playwright');

const DIST = path.resolve('../../client/dist');
const PORT = 4183;
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const base = (await import(new URL('./mock-api.mjs', import.meta.url).href)).default;

let scenario = 'not-configured';
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/storage/status') {
    if (scenario === 'forbidden') { res.writeHead(403, {'Content-Type':'application/json'}); return res.end(JSON.stringify({ error: 'Insufficient permissions' })); }
    if (scenario === 'server-error') { res.writeHead(500, {'Content-Type':'application/json'}); return res.end(JSON.stringify({ error: 'Internal server error' })); }
    if (scenario === 'custom-s3-connected') {
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ configured:true, connected:true, provider:'CUSTOM_S3', connectedEmail:null, connectedAt:'2026-08-10T09:00:00Z',
        customS3:{ label:'Cloudflare R2', bucket:'acme-crm-attachments', region:'auto', endpoint:'https://abc123.r2.cloudflarestorage.com', prefix:'crm/' },
        customS3Available:true, hosted:{ available:true, quotaBytes: 50*1024**3, usedBytes:0 } }));
    }
    const configured = scenario === 'configured' || scenario === 'byo-s3';
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({ configured, connected:false, provider:null, connectedEmail:null, connectedAt:null,
      customS3:null, customS3Available:true,
      hosted:{ available: scenario === 'byo-s3', quotaBytes: 50*1024**3, usedBytes:0 } }));
  }
  if (url.pathname.startsWith('/api/')) return base(req, res, url);
  let f = path.join(DIST, url.pathname);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

for (const [name, role] of [['byo-s3','SUPER_ADMIN'], ['custom-s3-connected','SUPER_ADMIN'], ['not-configured','SUPER_ADMIN']]) {
  scenario = name;
  const ctx = await browser.newContext({ viewport: { width: 900, height: 720 } });
  await ctx.addInitScript((r) => {
    localStorage.setItem('accessToken', 'mock');
    localStorage.setItem('refreshToken', 'mock');
    localStorage.setItem('user', JSON.stringify({ id:'u1', name:'SD Admin', email:'sdadmin@acme.test', role:r, orgId:'org1', org:{ id:'org1', name:'Acme', slug:'acme', plan:'ENTERPRISE' } }));
    localStorage.setItem('ui-theme','minimal'); localStorage.setItem('ui-dark','false');
  }, role);
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/storage`, { waitUntil:'networkidle', timeout:20000 }).catch(()=>{});
  await page.waitForTimeout(1800);
  // Open the bring-your-own-S3 form so the probe sees the real fields.
  const open = await page.$('button:has-text("Connect a bucket"), button:has-text("Change bucket")');
  if (open) { await open.click(); await page.waitForTimeout(900); }
  const text = await page.$eval('main', el => el.innerText).catch(()=> '(no main)');
  console.log(`\n══ ${name} (as ${role}) ══\n${text.split('\n').filter(Boolean).slice(0,12).map(l=>'  '+l).join('\n')}`);
  await page.screenshot({ path: `./shots/storage-${name}.png` });
  await ctx.close();
}
await browser.close(); server.close();
