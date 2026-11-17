// node render.js [timeline.json] [framesDir]
const { chromium } = require('playwright');
const fs = require('fs');
const tlPath = process.argv[2], outDir = process.argv[3] || (__dirname + '/frames');
(async () => {
  const b = await chromium.launch({ args:['--allow-file-access-from-files'] });
  const pg = await b.newPage({ viewport:{width:1080,height:1920} });
  await pg.goto('file://'+__dirname+'/comp.html'); await pg.evaluate(()=>document.fonts.ready);
  if (tlPath) await pg.evaluate(tl => setTimeline(tl), JSON.parse(fs.readFileSync(tlPath, 'utf8')));
  await pg.evaluate(async () => { for (const s of ['shots/index-clean.png','shots/map-v.png','shots/check-v.png','shots/shelter-v.png','shots/alert-v.png']) { const i=new Image(); i.src=s; await i.decode(); } });
  await pg.waitForTimeout(1000);
  const FPS=30, N=Math.round(await pg.evaluate(()=>DUR)*FPS);
  for (let f=0; f<N; f++) {
    await pg.evaluate(async t => { render(t); const imgs=[...document.querySelectorAll('#screen img')].filter(i=>i.src); await Promise.all(imgs.map(i=>i.decode().catch(()=>{}))); }, f/FPS);
    await pg.screenshot({ path:`${outDir}/f${String(f).padStart(4,'0')}.jpg`, type:'jpeg', quality:93 });
    if (f%300===0) console.log(f,'/',N);
  }
  await b.close();
})();
