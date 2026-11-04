import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = await import('playwright');
const DIST = path.resolve('/home/claude/qq/client/dist');
const PORT = 4185;
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const base = (await import('file:///home/claude/qq/tests/ui/mock-api.mjs')).default;
const server = http.createServer((req,res)=>{
  const url = new URL(req.url,'http://x');
  if (url.pathname === '/api/storage/status') { res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({configured:true,connected:false,provider:null,connectedEmail:null,connectedAt:null,customS3:null,customS3Available:true,hosted:{available:true,quotaBytes:53687091200,usedBytes:0}})); }
  if (url.pathname === '/api/storage/s3/test') { res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({ ok:false, step:'write', error:'The credentials are valid but not allowed to do that. The key needs s3:PutObject, s3:GetObject and s3:DeleteObject on this bucket.' })); }
  if (url.pathname.startsWith('/api/')) return base(req,res,url);
  let f = path.join(DIST,url.pathname);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()) f = path.join(DIST,'index.html');
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]??'application/octet-stream'}); res.end(fs.readFileSync(f));
});
await new Promise(r=>server.listen(PORT,r));
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport:{width:900,height:1000} });
await ctx.addInitScript(()=>{ localStorage.setItem('accessToken','m'); localStorage.setItem('refreshToken','m');
  localStorage.setItem('user', JSON.stringify({id:'u1',name:'SD Admin',email:'a@b.c',role:'SUPER_ADMIN',orgId:'org1',org:{id:'org1',name:'Acme',slug:'acme',plan:'ENTERPRISE'}}));
  localStorage.setItem('ui-theme','minimal'); localStorage.setItem('ui-dark','true'); });
const page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/storage`,{waitUntil:'networkidle'}).catch(()=>{});
await page.waitForTimeout(1500);
await page.click('button:has-text("Connect a bucket")'); await page.waitForTimeout(600);

await page.selectOption('select', 'CLOUDFLARE_R2'); await page.waitForTimeout(500);
console.log('after R2:', await page.$$eval('form p', els=>els.map(e=>e.innerText.trim()).filter(t=>t.startsWith('Endpoint'))));
await page.fill('input[placeholder="a1b2c3d4e5f6…"]','abc123def456'); await page.waitForTimeout(500);
console.log('with acct id:', await page.$$eval('form p', els=>els.map(e=>e.innerText.trim()).filter(t=>t.startsWith('Endpoint'))));

await page.selectOption('select','WASABI'); await page.waitForTimeout(400);
console.log('wasabi:', await page.$$eval('form p', els=>els.map(e=>e.innerText.trim()).filter(t=>t.startsWith('Endpoint'))));

// Fill enough to enable Test, then trigger a failing test to see the message.
await page.fill('input[placeholder="acme-crm-attachments"]','acme-bucket');
const pw = await page.$$('input[type="password"]');
await page.$$eval('input[autocomplete="off"][spellcheck="false"]', els=>{});
await page.fill('input[spellcheck="false"]','AKIAEXAMPLE');
await pw[0].fill('secret-value');
await page.waitForTimeout(400);
const testBtn = await page.$('button:has-text("Test connection")');
console.log('test enabled:', testBtn ? !(await testBtn.isDisabled()) : 'no button');
if (testBtn && !(await testBtn.isDisabled())) { await testBtn.click(); await page.waitForTimeout(900); }
console.log('result:', await page.$$eval('form span', els=>els.map(e=>e.innerText.trim()).filter(t=>t.includes('Failed')||t.includes('Wrote'))));
await page.screenshot({ path:'/home/claude/qq/tests/ui/shots/storage-r2-form.png' });
console.log('pageerrors:', errs.slice(0,2));
await browser.close(); server.close();
