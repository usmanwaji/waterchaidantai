// node render.js timeline.json framesDir   (timeline = scenes.json entries with t0/t1, written by build_vo.py)
// node render.js timeline.json framesDir --preview t1 t2 ...   -> PNG stills only
const { chromium } = require('playwright');
const fs = require('fs');
const [tlPath, outDir, flag, ...times] = process.argv.slice(2);
(async () => {
  const tl = JSON.parse(fs.readFileSync(tlPath, 'utf8'));
  const b = await chromium.launch({ args:['--allow-file-access-from-files'] });
  const pg = await b.newPage({ viewport:{width:1080,height:1920} });
  await pg.goto('file://'+__dirname+'/comp.html'); await pg.evaluate(()=>document.fonts.ready);
  await pg.evaluate(tl => setTimeline(tl), tl);
  const imgs = [...new Set(tl.flatMap(s => [s.img, s.img2]).filter(Boolean))];
  await pg.evaluate(async imgs => { for (const s of imgs) { const i=new Image(); i.src=s; await i.decode(); } }, imgs);
  await pg.waitForTimeout(800);
  const shot = async (t, path, type) => {
    await pg.evaluate(async t => { render(t); await Promise.all([...document.querySelectorAll('.view img')].filter(i=>i.src).map(i=>i.decode().catch(()=>{}))); }, t);
    await pg.screenshot({ path, type, ...(type==='jpeg'?{quality:93}:{}) });
  };
  if (flag === '--preview') { for (const t of times) await shot(+t, `${outDir}/prev-${t}.png`, 'png'); }
  else {
    const N = Math.round(await pg.evaluate(()=>DUR)*30);
    for (let f=0; f<N; f++) { await shot(f/30, `${outDir}/f${String(f).padStart(4,'0')}.jpg`, 'jpeg'); if (f%600===0) console.log(f,'/',N); }
  }
  await b.close();
})();
