// Screenshot naraflood.com pages for the promo clip.
// node shoot.js   (env LEAFLET_DIST = path to leaflet/dist when unpkg.com is blocked, BLANK_TILE = png for map tiles)
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'shots');
const LD = process.env.LEAFLET_DIST, TILE = process.env.BLANK_TILE;
const HIDE = `#btnSos,[id^="install"],[class^="install"],[id*="btnLine"],[class*="line-fab"]{display:none!important}`;
const only = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], viewport:{width:390,height:853}, deviceScaleFactor: 3, locale:'th-TH',
    geolocation:{latitude:6.4255,longitude:101.8253}, permissions:['geolocation'] });
  if (LD) await ctx.route('**/unpkg.com/leaflet@1.9.4/dist/**', r => r.fulfill({ path: path.join(LD, r.request().url().split('/dist/')[1].split('?')[0]) }));
  if (TILE) await ctx.route(/tile|arcgisonline|openstreetmap|longdo|cartocdn/, r => r.request().resourceType()==='image' ? r.fulfill({ path: TILE }) : r.continue());
  const open = async (u, wait=15000) => { const pg = await ctx.newPage();
    try { await pg.goto('https://naraflood.com/'+u, { waitUntil:'domcontentloaded', timeout:60000 }); } catch(e) { console.log(u, e.message.slice(0,60)); }
    await pg.waitForTimeout(wait); return pg; };
  const want = n => !only.length || only.includes(n);

  if (want('index')) {   // full page with every fixed element removed, plus section offsets
    const pg = await open('', 20000);
    await pg.evaluate(() => { for (const el of document.querySelectorAll('body *')) if (getComputedStyle(el).position==='fixed') el.setAttribute('data-fx','1'); });
    await pg.addStyleTag({ content: '[data-fx]{display:none!important}' }); await pg.waitForTimeout(800);
    const secs = await pg.evaluate(() => [...document.querySelectorAll('h1,h2,h3')].map(h => ({ t: h.textContent.trim().slice(0,60), y: Math.round(h.getBoundingClientRect().top + scrollY) })));
    fs.writeFileSync(path.join(OUT,'index-sections.json'), JSON.stringify(secs, null, 1));
    await pg.screenshot({ path: path.join(OUT,'index-clean.png'), fullPage: true }); console.log('index ok'); await pg.close();
  }
  for (const n of ['map','forecast','check','history','repeat','shelter','route','alert']) {
    if (!want(n)) continue;
    const pg = await open(n + '.html', n==='check' ? 4000 : 18000);
    if (n==='check') { await pg.getByText('ใช้ตำแหน่งของฉัน').click(); await pg.waitForTimeout(12000); await pg.evaluate(()=>scrollTo(0,0)); await pg.waitForTimeout(800); }
    await pg.addStyleTag({ content: HIDE }); await pg.waitForTimeout(400);
    await pg.screenshot({ path: path.join(OUT, n + '-v.png') });
    const txt = await pg.evaluate(() => document.body.innerText.slice(0, 1500));
    fs.writeFileSync(path.join(OUT, n + '-text.txt'), txt); console.log(n, 'ok'); await pg.close();
  }
  if (want('sos')) {   // the SOS / help sheet opened from the home page
    const pg = await open('', 8000);
    await pg.click('#btnSos').catch(e => console.log('sos click', e.message.slice(0,60)));
    await pg.waitForTimeout(2500);
    await pg.screenshot({ path: path.join(OUT, 'sos-v.png') });
    fs.writeFileSync(path.join(OUT, 'sos-text.txt'), await pg.evaluate(() => document.body.innerText.slice(-1500))); console.log('sos ok'); await pg.close();
  }
  await b.close();
})();
