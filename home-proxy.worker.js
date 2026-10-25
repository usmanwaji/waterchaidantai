/*
  home-proxy.worker.js — Cloudflare Worker รวมข้อมูลหน้าแรก (index.html) ไว้ในคำขอเดียว
  ------------------------------------------------------------------
  เดิมเปิดหน้าแรก 1 ครั้ง เบราว์เซอร์ยิง 20–30 คำขอไป thaiwater / open-meteo / ปภ. / Worker ตัวอื่น ๆ
  แหล่งไหนช้า คนดูก็รอตาม · Worker นี้เก็บผลของแต่ละแหล่งไว้ใน Cache ของศูนย์ Cloudflare
  แล้วตอบรวมเป็น JSON ก้อนเดียว (/home.json)
  ยกเว้น 2 แหล่งที่หน้าเว็บดึงตรงจากเครื่องผู้ใช้แทน (ดูจากหน้าสถานะจริง):
    · ระดับน้ำ thaiwater (public/waterlevel): จำกัดคำขอต่อ IP และ Worker ใช้ IP ร่วมกับคนอื่น → โดน 429 บ่อย
    · พยากรณ์ open-meteo: ตอบ Worker ไม่ทันใน 12 วิ (timeout) ทั้งที่จากเบราว์เซอร์ตอบเร็วและเปิด CORS อยู่แล้ว

  ใช้แผนฟรีได้ทั้งหมด:
    · เก็บใน Cache API (ไม่มีโควตาเขียนแบบ KV ที่ telerid-proxy ใช้ไปเกือบเต็มแล้ว)
      แคชแยกตามศูนย์ แต่คนดูในไทยเข้าศูนย์ BKK เป็นหลัก จึงใช้ชุดเดียวกัน
    · Cron ทุกนาที (ดูวิธีตั้งด้านล่าง) แต่ดึงแต่ละส่วนเฉพาะเมื่อถึงรอบของมัน (PARTS: every / at) นาทีที่ไม่มีอะไรถึงรอบจบทันที
      → คนดูเจอข้อมูลสดในแคชเสมอ ไม่ต้องรอดึง · ต้นทางถูกเรียกเป็นรอบคงที่ไม่ขึ้นกับจำนวนคนดู:
      รายการสถานี ปภ. ทุก 5 นาที · โทรมาตร ชป. + ทิศทางน้ำ ชป. + เรดาร์ทุก 14 นาที · กราฟ ปภ. ชั่วโมงละครั้ง
      X.199 (hyd-app รายชั่วโมง): ยังไม่ได้ค่าของชั่วโมงนี้ครบ ถามทุก 5 นาที · ได้ครบแล้วทุก 30 นาที
      ฝนรายอำเภอทุก 12 ชม. · ฝน 3 วันทุก 22 ชม. · พยากรณ์รายภาควันละครั้ง 14:00 · เกณฑ์ ปภ. ทุกวันที่ 15 ของเดือน
      ส่งคำขอพร้อมกันทีละไม่กี่รายการ (POOL) ไม่ยิงเป็นชุดใหญ่ กัน 429
      Placement มีผลกับ fetch เท่านั้น ไม่มีผลกับ cron → cron เรียก /cron ของตัวเองผ่าน binding SELF
      ให้ไปรันที่ BKK ใช้แคชชุดเดียวกับคนดู (ไม่ได้ผูก SELF cron จะไม่ทำอะไร)
      cron หยุด/ยังไม่ตั้ง → คนดูเป็นคนกระตุ้นให้ดึงใหม่เมื่อเกิน ttl แบบเดิม
    · ตอบโดยต่อข้อความ JSON ที่เก็บไว้เข้าด้วยกันตรง ๆ ไม่แปลงใหม่ทุกคำขอ → CPU ไม่เกิน 10 ms
    · ดึงต้นทางไม่เกิน FETCH_BUDGET ครั้งต่อคำขอ (แผนฟรีจำกัด 50 subrequest) · ไม่พอ → เลื่อนไปคำขอถัดไป

  อายุของแต่ละส่วน (PARTS):
    every  cron ดึงให้เมื่ออายุถึงเท่านี้ · at = ดึงตามเวลาที่กำหนดแทน (วันละครั้ง/เดือนละครั้ง เวลาไทย)
    poll   ข้อมูลรายชั่วโมง: dataAt(j) = เวลาวัดล่าสุดที่มีครบ · ยังไม่ถึงต้นชั่วโมงนี้ → cron ดึงทุก poll แทน every
    ttl  หมดอายุ → คำขอของคนดูสั่งดึงใหม่เอง (ยาวกว่า every → ถ้า cron ทำงาน ไม่ถึงตรงนี้)
         ส่วนที่ใช้ at: คนดูสั่งดึงเองเฉพาะเมื่อเลยเวลาที่กำหนดมาเกิน SCHED_GRACE แล้วยังไม่ได้ดึง (cron พลาด)
    swr  ยังไม่เก่าเกินนี้ → ตอบชุดเดิมทันที แล้วดึงใหม่เบื้องหลัง
         เก่าเกินนี้ → รอผลใหม่ได้ไม่เกิน SOFT_WAIT (ยังไม่มีข้อมูลเลยรอได้ COLD_WAIT) ไม่ทันก็ตอบชุดเดิม
    max  เก่าเกินนี้ไม่ส่ง (d:null) → หน้าเว็บดึงตรงจากต้นทางเองแบบเดิม
  ส่วนที่ตอบด้วยชุดหมดอายุ ติดธง "s":1 → หน้าเว็บขอซ้ำอีกครั้งหลังราว 40 วิ (ตอนนั้นดึงใหม่เสร็จแล้ว)

  path:
    /                 สถานะ: อายุ/ข้อผิดพลาดล่าสุดของแต่ละส่วนในแคชศูนย์นี้ + ผูก Service binding ครบไหม
    /home.json        ทุกส่วน · ?parts=ddpm,rid  เฉพาะบางส่วน
    /cron             ดึงส่วนที่ถึงรอบ cron แล้วรอจนบันทึกเสร็จ (cron เรียกผ่าน SELF · ถึงรอบแล้วเท่านั้นจึงดึง เรียกถี่ก็ไม่เพิ่มภาระ)
  รูปแบบ: {"v":1,"now":ms,"parts":{"ddpm":{"t":เวลาดึง(ms),"s":0|1,"d":<JSON จากต้นทาง>|null}, ...}}
         rid    d = {"base": URL ที่หน้าเว็บใช้ดึง {CODE}.detail.json, "j": stations.json ของแหล่งที่ค่าใหม่กว่า}
         trends d = {"ddpm":{code:[ค่าก่อนหน้า, ค่าล่าสุด]}, "rid":{...}, "ddpmAt"/"ridAt": เวลาคิดแต่ละฝั่ง}  (ทิศทางน้ำ เกณฑ์เดียวกับ index.html)
         thr    d = {code: เกณฑ์ "เฝ้าระวัง" ของ ปภ. (mediumLevelThreshold) | null}

  วิธี deploy:
    1) dash.cloudflare.com → Workers & Pages → Create → Create Worker (ไม่ใช่ Import a repository)
       → ชื่อ home-proxy → Deploy → Edit code → วางไฟล์นี้ → Deploy
       ได้ https://home-proxy.<บัญชี>.workers.dev (index.html ตั้งไว้ที่บัญชี newusmanwaji)
    2) Settings → Bindings → Add binding → Service binding  เพิ่ม 3 ตัว (ชื่อตัวแปรต้องตรง):
         TELERID → telerid-proxy · HYD → hyd-proxy · TMD → tmd-proxy
       Worker เรียก Worker อื่นในบัญชีเดียวกันผ่าน URL workers.dev ไม่ได้ (error 1042) ต้องผ่าน binding
       ไม่ผูก: ส่วน hyd/tmd/nowcast/riskmap ว่าง (หน้าเว็บดึงตรงเอง) · rid ใช้สาขา cam อย่างเดียว
    3) Settings → Bindings → Service binding อีกตัว: SELF → home-proxy (ตัวเอง) · Settings → Trigger events → Cron Triggers: ทุกนาที (นิพจน์ cron อยู่ใน DEPLOY.md)
    4) เปิด https://home-proxy.<บัญชี>.workers.dev/home.json สักครั้ง แล้วเปิด / ดูว่าทุกส่วนมี ageSec และไม่มี lastError
       หลังตั้ง cron สักพัก ช่อง cron ในหน้า / ต้องมี lastRunAgoSec ไม่เกิน ~300 (รอบ ปภ.) และ runsIn เป็น BKK
  ยังไม่ deploy หรือส่วนไหนล่ม → หน้าเว็บดึงส่วนนั้นตรงจากต้นทางแบบเดิมเอง ไม่พัง
  ------------------------------------------------------------------
*/
const PROV = 'นราธิวาส', PROV_CODE = '96';
const TW = 'https://api-v3.thaiwater.net/api/v1/thaiwater30';
const DDPM = 'https://cctv.disaster.go.th/api/v1';   // API เดียวกับที่ ddpm-proxy ส่งต่อ (Worker ไม่ติด CORS จึงเรียกตรง)
const RID_CAM = 'https://raw.githubusercontent.com/usmanwaji/waterchaidantai/cam';
// URL สาธารณะของ Worker อื่น · ใช้เมื่อไม่ได้ผูก binding (มักได้ 1042) และเป็นค่า base ที่ส่งให้หน้าเว็บ
const PUBLIC = {
  TELERID: 'https://telerid-proxy.newusmanwaji.workers.dev',
  HYD: 'https://hyd-proxy.newusmanwaji.workers.dev',
  TMD: 'https://tmd-proxy.newusmanwaji.workers.dev',
};

const MIN = 60, HOUR = 3600;
const FETCH_BUDGET = 40;      // ดึงต้นทางต่อคำขอ (แผนฟรี 50 subrequest · เผื่อ Cache API อีกไม่กี่ครั้ง)
const TIMEOUT = 12000;
const SOFT_WAIT = 2000;       // ส่วนที่เก่าเกิน swr: รอผลใหม่ได้เท่านี้ก่อนตอบชุดเดิม
const COLD_WAIT = 6000;       // ยังไม่มีข้อมูลเลย (เพิ่ง deploy / แคชถูกล้าง)
const RETRY_GAP = 30e3;       // ส่วนเดียวกันสั่งดึงซ้ำใน isolate เดียวกันได้ไม่ถี่กว่านี้
const FAIL_GAP = 3 * 60e3;    // ดึงไม่สำเร็จ (ไม่ใช่ 429) → พักเท่านี้ก่อนลองใหม่ (cron มาทุกนาที ไม่ให้ยิงซ้ำทุกนาที)
const LIMIT_GAP = 5 * 60e3;   // ต้นทางตอบ 429 (จำกัดคำขอต่อ IP ซึ่ง Worker ใช้ IP ร่วมกับคนอื่น) → พักนานขึ้น
const LIMIT_MAX = 60 * 60e3;  // 429 ซ้ำ ๆ: พักเพิ่มเป็นเท่าตัวทุกครั้ง (5 → 10 → 20 … นาที) ไม่เกินนี้
const CRON_SLACK = 30;        // cron ดึงเมื่ออายุ ≥ every − นี้ (วินาที) · cron มาทุกนาที เวลาดึงที่ช้าเล็กน้อยไม่ทำให้เลื่อนไปอีกนาที
const GRAPH_EVERY = 60 * 60;  // กราฟ ปภ. เป็นรายชั่วโมง → ดึงใหม่ชั่วโมงละครั้ง รอบอื่นใช้ค่าทิศทางเดิม
const SCHED_GRACE = 30 * 60;  // ส่วนที่ดึงตามเวลา (at): เลยเวลาเกินนี้แล้วยังไม่ได้ดึง → คนดูสั่งดึงเอง/ติดธงว่าเก่า
const ICT = 7 * 3600e3;
// เวลาที่กำหนดรอบล่าสุดที่ผ่านมาแล้ว (ms) ตามนาฬิกาไทย · วันละครั้งตอน h:00 / เดือนละครั้งวันที่ day 00:00
const dailyAt = (h) => (now) => { const d = new Date(now + ICT); const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h) - ICT; return t > now ? t - 86400e3 : t; };
const monthlyOn = (day) => (now) => { const d = new Date(now + ICT); const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day) - ICT; return t > now ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, day) - ICT : t; };
const POOL = 3;               // คำขอไปต้นทางเดียวกันพร้อมกันได้ไม่เกินนี้ (กราฟ/รายละเอียดรายสถานี) ไม่ยิงเป็นชุดใหญ่
const FRESH_MS = 6 * HOUR * 1000;   // ทิศทางน้ำคิดเฉพาะสถานีที่ส่งค่าใน 6 ชม. (HERO_FRESH_H ใน index.html)
const STORE = 'https://home-proxy.cache/store-v1';
const HOUR_MS = 3600e3;       // เวลาไทย +7 ชม. เต็ม → ต้นชั่วโมงไทยตรงกับต้นชั่วโมง UTC

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), {
  status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timeout')), ms))]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* ทำ fn กับทุกรายการ พร้อมกันไม่เกิน n งาน · งานที่ล้มเหลวข้ามไป คืนรายการข้อผิดพลาด (ผลดูจากสิ่งที่ fn เก็บไว้เอง)
   เจอ 429 เลิกส่งรายการที่เหลือในชุดนั้นทันที (ต้นทางบอกให้หยุดแล้ว ยิงต่อมีแต่ทำให้โดนนานขึ้น) */
async function eachLimit(items, n, fn) {
  const q = [...items], errs = [];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => {
    while (q.length) {
      try { await fn(q.shift()); } catch (e) { errs.push(e); if (/HTTP 429/.test(e?.message)) q.length = 0; }
    }
  }));
  return errs;
}
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
// updatedAt ของ ปภ. เป็นเวลาไทยไม่มีโซน · มีโซนมาแล้วใช้ตามนั้น (เหมือน loadDdpm ใน index.html)
const ddpmTime = (s) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : String(s) + '+07:00').getTime();
const ascii = (s) => String(s).replace(/[^\x20-\x7e]/g, '?').slice(0, 160);   // เก็บใน header ได้เฉพาะ ASCII

/* ดึงต้นทาง · src = URL หรือ [ชื่อ binding, path] · หักโควตา subrequest ของคำขอนี้ */
async function fetchText(env, src, budget, ms = TIMEOUT) {
  if (budget.left <= 0) throw new Error('subrequest budget used up (deferred)');
  budget.left--;
  const [name, path] = Array.isArray(src) ? src : [];
  const bound = name && env && env[name];
  const label = name ? name + path : src.replace(/\?.*/, '');
  const p = (bound ? bound.fetch('https://' + name.toLowerCase() + path)
                   : fetch(name ? PUBLIC[name] + path : src, { headers: { Accept: 'application/json' } }))
    .then(async (r) => {
      const text = await r.text();
      if (!r.ok) throw new Error(`${label} HTTP ${r.status} ${text.slice(0, 60)}`);
      return { text, cache: r.headers.get('x-cache') };
    });
  return withTimeout(p, ms, label);
}
/* ส่วนที่ดึงจากแหล่งเดียว · ok() ตรวจรูปข้อมูลก่อนเก็บ (ชุดที่ผิดรูปไม่ทับชุดดีที่มีอยู่)
   u = ต้นทางเอง (hyd-proxy) ตอบจากแคชเก่า → ส่วนนี้ถือว่าหมดอายุเร็วขึ้น ดึงซ้ำในรอบถัดไป */
const simple = (src, ok, ms) => async (env, budget) => {
  const r = await fetchText(env, src, budget, ms);
  const j = JSON.parse(r.text);
  if (!ok(j)) throw new Error('unexpected data');
  return { text: r.text, j, u: r.cache === 'REVALIDATING' || r.cache === 'STALE' };
};

/* โทรมาตร ชป.: telerid-proxy (ดึงสด) กับสาขา cam (คอมในไทยส่งขึ้น) ใช้แหล่งที่ค่าวัดใหม่กว่า (เหมือน fetchRid ใน index.html) */
const ridNewest = (j) => (j.stations || []).reduce((m, s) => (s.levelDt && s.levelDt > m ? s.levelDt : m), '');
async function rid(env, budget) {
  const parse = (r) => {
    if (r.status !== 'fulfilled') return null;
    try { const j = JSON.parse(r.value.text); return Array.isArray(j?.stations) && j.stations.length ? { j, text: r.value.text } : null; } catch { return null; }
  };
  const [live, cam] = await Promise.allSettled([
    fetchText(env, ['TELERID', '/stations.json'], budget),
    fetchText(env, `${RID_CAM}/stations.json?t=${Math.floor(Date.now() / 60000)}`, budget),
  ]);
  const L = parse(live), C = parse(cam);
  if (!L && !C) throw new Error('no telerid source: ' + [live, cam].map((r) => r.reason?.message || 'bad data').join(' | '));
  const useLive = L && (!C || ridNewest(L.j) >= ridNewest(C.j));
  const base = useLive ? PUBLIC.TELERID : RID_CAM, pick = useLive ? L : C;
  return { text: `{"base":${JSON.stringify(base)},"j":${pick.text}}`, j: { base, j: pick.j } };
}

/* ทิศทางน้ำ (ค่าราว 1 ชม. ก่อน) · คิดแบบเดียวกับ loadTrends/ridTrends ใน index.html
   ปภ.: 2 ค่าท้ายของกราฟรายชั่วโมง · ชป.: ค่าล่าสุดเทียบค่าล่าสุดที่วัดก่อนนั้นอย่างน้อย 1 ชม. ใน {CODE}.detail.json
   แต่ละฝั่งคิดใหม่ตามรอบของตัวเอง ฝั่งที่ยังไม่ถึงรอบใช้ชุดเดิม (dep.prev):
   ชป.: เมื่อรอบนี้ได้โทรมาตรใหม่ (dep.updated) หรือคิดครั้งล่าสุด (ridAt) นานเกินรอบโทรมาตร
        → ขอ {CODE}.detail.json ทันทีหลัง telerid-proxy เพิ่งสร้างชุดข้อมูล ได้จากชุดนั้นเลย ไม่เปิด WebSocket ซ้ำ
   ปภ.: กราฟรายชั่วโมง ลองดึงครั้งล่าสุด (ddpmAt) เกิน GRAPH_EVERY จึงดึงใหม่ · นับจากเวลาที่ลอง ไม่ใช่เวลาที่สำเร็จ
        → ตอน ปภ. ตอบ 429/ล่ม ก็ลองชั่วโมงละครั้ง ไม่ยิงซ้ำทุกรอบ */
async function trends(env, budget, dep) {
  if (!Array.isArray(dep.ddpm?.data) && !dep.rid?.j) throw new Error('waiting for ddpm/rid station lists');
  const now = Date.now();
  const dd = (dep.ddpm?.data || []).filter((d) => d.isActive !== 0 && !d.deletedAt && num(d.currentWaterLevel) != null
    && d.updatedAt && now - ddpmTime(d.updatedAt) <= FRESH_MS).map((d) => d.code);
  const fromLive = dep.rid?.base === PUBLIC.TELERID;
  const rr = (dep.rid?.j?.stations || []).filter((d) => d.province === PROV && num(d.level) != null && num(d.level) > -9
    && (d.levelDt || d.dt) && now - Date.parse(d.levelDt || d.dt) <= FRESH_MS).map((d) => d.code);
  const prev = dep.prev;
  const graphsFresh = prev?.ddpmAt && now - prev.ddpmAt < (GRAPH_EVERY - CRON_SLACK) * 1000;
  const ridFresh = !dep.updated?.includes('rid') && prev?.ridAt && now - prev.ridAt < (PARTS.rid.every - CRON_SLACK) * 1000;
  // โควตาไม่พอ (มักเป็นรอบแรกที่ดึงทุกส่วนพร้อมกัน): ตัดท้าย สถานีที่เหลือไม่มีลูกศรรอบนี้
  const room = Math.max(0, budget.left);
  const ddUse = graphsFresh ? [] : dd.slice(0, room), rrUse = ridFresh ? [] : rr.slice(0, Math.max(0, room - ddUse.length));
  const out = { ddpm: graphsFresh ? prev.ddpm || {} : {}, rid: ridFresh ? prev.rid || {} : {},
    ddpmAt: graphsFresh ? prev.ddpmAt : null, ridAt: ridFresh ? prev.ridAt : now };
  const minute = Math.floor(now / 60000);
  await Promise.all([
    eachLimit(ddUse, POOL, (code) => fetchText(env, `${DDPM}/water-level/graph?stationCode=${encodeURIComponent(code)}&type=hour&isSimulatorMode=false`, budget).then((r) => {
      const j = JSON.parse(r.text);
      const pts = ((j?.data ?? j)?.datasets?.[0]?.data || []).map((p) => num(p?.y)).filter((v) => v != null);
      if (pts.length >= 2) out.ddpm[code] = [pts[pts.length - 2], pts[pts.length - 1]];
    })),
    eachLimit(rrUse, POOL, (code) => fetchText(env, fromLive ? ['TELERID', `/${encodeURIComponent(code)}.detail.json`]
      : `${RID_CAM}/${encodeURIComponent(code)}.detail.json?t=${minute}`, budget).then((r) => {
      const j = JSON.parse(r.text);
      const t = j?.wl?.t || [], v = j?.wl?.v || [];
      const ok = t.map((x, i) => [x, num(v[i])]).filter(([x, y]) => x && y != null && y > -9);
      if (ok.length < 2) return;
      const [tl, vl] = ok[ok.length - 1];
      const back = ok.filter(([x]) => x <= tl - 3600).pop() || ok[0];
      if (back[0] < tl) out.rid[code] = [back[1], vl];
    })),
  ]);
  if (!graphsFresh) {
    out.ddpmAt = now;   // ถึงรอบแล้ว ลองแล้ว (แม้ไม่มีสถานีให้ดึง) → รอบถัดไปชั่วโมงหน้า
    if (!Object.keys(out.ddpm).length && prev?.ddpm) out.ddpm = prev.ddpm;   // ดึงกราฟรอบนี้ไม่ได้: คงค่าทิศทางเดิม
  }
  if (ddUse.length + rrUse.length && !Object.keys(out.ddpm).length && !Object.keys(out.rid).length) throw new Error('no trend data');
  return { text: JSON.stringify(out), j: out };
}

/* เกณฑ์ "เฝ้าระวัง" ของ ปภ. มีเฉพาะในรายละเอียดรายสถานี · แทบไม่เปลี่ยน เก็บนาน
   โควตาไม่พอดึงครบทุกสถานีในรอบนี้ → เลื่อนไปคำขอถัดไปทั้งชุด (ไม่เก็บครึ่ง ๆ กลาง ๆ) */
async function thresholds(env, budget, dep) {
  // ยังไม่มีรายชื่อสถานี ปภ. → ไม่เก็บชุดว่าง (ไม่งั้นค้างเป็นค่าว่างไปทั้ง ttl 12 ชม.)
  if (!Array.isArray(dep.ddpm?.data)) throw new Error('waiting for ddpm station list');
  const codes = (dep.ddpm?.data || []).filter((d) => d.isActive !== 0 && !d.deletedAt).map((d) => d.code);
  if (codes.length > budget.left) throw new Error('subrequest budget used up (deferred)');
  const out = {};
  const errs = await eachLimit(codes, POOL, (c) => fetchText(env, `${DDPM}/stations/${encodeURIComponent(c)}`, budget)
    .then((x) => { out[c] = num(JSON.parse(x.text)?.waterThreshold?.mediumLevelThreshold); }));
  // ล้มเหลวทั้งชุด: ส่งข้อผิดพลาดจริงต่อ (เช่น HTTP 429) ให้ due() พักตามชนิดของมัน
  if (codes.length && !Object.keys(out).length) throw errs[0] || new Error('no ddpm station detail');
  return { text: JSON.stringify(out), j: out };
}

/* X.199 ฯลฯ (hyd-proxy): เวลาวัดล่าสุดที่สถานีที่ยังส่งค่าอยู่ (เงียบไม่เกิน 6 ชม. จากสถานีที่ใหม่สุด) มีครบทุกสถานี
   กฎเดียวกับ completeAt ใน hyd-proxy · ไม่มีค่าเลย = 0 */
function hydComplete(j) {
  const ts = (j.stations || []).map((x) => Date.parse(x.levelDt)).filter((t) => t > 0);
  if (!ts.length) return 0;
  const newest = Math.max(...ts);
  return Math.min(...ts.filter((t) => newest - t < FRESH_MS));
}

/* every/ttl/swr/max เป็นวินาที · at = ดึงตามเวลาที่กำหนด (ใช้แทน every/ttl) · after = ส่วนที่ต้องใช้ข้อมูลก่อน (ถ้ากำลังดึงใหม่ รอผลนั้น)
   trends ไม่มี every: cron คิดต่อจากรอบที่ได้โทรมาตร ชป. ใหม่ หรือเมื่อกราฟ ปภ. ถึงชั่วโมง (ดู cronRun) */
const PARTS = {
  ddpm:    { every: 5 * MIN,   ttl: 8 * MIN,   swr: 20 * MIN,  max: 6 * HOUR,   get: simple(`${DDPM}/stations?provCode=${PROV_CODE}&limit=100`, (j) => Array.isArray(j?.data)) },
  rid:     { every: 14 * MIN,  ttl: 20 * MIN,  swr: 40 * MIN,  max: 6 * HOUR,   get: rid },
  hyd:     { every: 30 * MIN,  poll: 5 * MIN, dataAt: hydComplete, label: 'every 5 min until this hour is in, then 30 min',
             ttl: 40 * MIN,  swr: 90 * MIN,  max: 6 * HOUR,   get: simple(['HYD', '/stations.json'], (j) => Array.isArray(j?.stations), 28000) },   // hyd-proxy ที่ไม่มีแคชรอ hyd-app ~25 วิ
  rain3d:  { every: 22 * HOUR, ttl: 24 * HOUR, swr: 30 * HOUR, max: 48 * HOUR,  get: simple(`${TW}/provinces/rain3d?province_code=${PROV_CODE}`, (j) => Array.isArray(j?.data)) },
  tmd:     { at: dailyAt(14), label: 'daily 14:00 ICT', swr: 48 * HOUR, max: 48 * HOUR, get: simple(['TMD', '/region7days'], (j) => !!j?.WeatherForecast7DaysByRegion) },
  nowcast: { every: 14 * MIN,  ttl: 20 * MIN,  swr: 30 * MIN,  max: 1 * HOUR,   get: simple(['TMD', '/nowcast'], (j) => Array.isArray(j?.frames) && j.frames.length) },
  riskmap: { every: 12 * HOUR, ttl: 14 * HOUR, swr: 18 * HOUR, max: 36 * HOUR,  get: simple(['TMD', '/riskmap'], (j) => Array.isArray(j?.districts) && j.districts.length) },
  trends:  { ttl: 20 * MIN,    swr: 40 * MIN,  max: 6 * HOUR,  get: trends, after: ['ddpm', 'rid'] },
  thr:     { at: monthlyOn(15), label: 'monthly on the 15th 00:00 ICT', swr: 45 * 24 * HOUR, max: 45 * 24 * HOUR, get: thresholds, after: ['ddpm'] },
};

/* ---------- ที่เก็บ: Cache API รายการเดียว ----------
   body = ข้อความของทุกส่วนต่อกัน · header x-meta = {ส่วน: {t เวลาดึง, o ตำแหน่ง, n ความยาว, u ต้นทางตอบชุดเก่า, h เวลาวัดที่มีครบ (dataAt),
          e/et ข้อผิดพลาดล่าสุด, k จำนวนครั้งที่โดน 429 ติดกัน}, _cron: ผลรอบ cron ล่าสุด}
   รายการเดียว = อ่าน/เขียนครั้งเดียวต่อคำขอ ประหยัด subrequest · ตัดส่วนที่ต้องการด้วย substr ไม่ต้องแปลง JSON */
async function readStore() {
  const hit = await caches.default.match(STORE);
  if (!hit) return { meta: {}, body: '' };
  let meta = {};
  try { meta = JSON.parse(hit.headers.get('x-meta') || '{}'); } catch {}
  return { meta, body: await hit.text() };
}
const storedText = (store, p) => { const m = store.meta[p]; return m && m.n ? store.body.substr(m.o, m.n) : null; };
function storedJson(store, p) { try { const t = storedText(store, p); return t ? JSON.parse(t) : null; } catch { return null; } }
async function saveStore(fresh, cron) {
  const cur = await readStore();   // อ่านล่าสุดอีกรอบ เผื่อคำขออื่นเพิ่งเขียนส่วนอื่นไป
  const meta = {};
  let body = '';
  for (const p of Object.keys(PARTS)) {
    const f = fresh[p], old = cur.meta[p];
    const useNew = f && f.text != null && (!old || !old.t || f.t >= old.t);
    const text = useNew ? f.text : storedText(cur, p);
    const m = useNew ? { t: f.t } : { t: old?.t || 0 };
    if (useNew ? f.u : old?.u) m.u = 1;
    const h = useNew ? f.h : old?.h;
    if (h) m.h = h;
    if (f && f.e) {
      m.e = ascii(f.e); m.et = f.t;
      if (/HTTP 429/.test(f.e)) m.k = (old?.k || 0) + 1;
    } else if (!useNew && old?.e) { m.e = old.e; m.et = old.et; if (old.k) m.k = old.k; }
    if (text != null) { m.o = body.length; m.n = text.length; body += text; }
    meta[p] = m;
  }
  const c = cron || cur.meta._cron;
  if (c) meta._cron = c;
  await caches.default.put(STORE, new Response(body, { headers: {
    'content-type': 'text/plain; charset=utf-8', 'x-meta': JSON.stringify(meta), 'cache-control': 'public, max-age=604800' } }));
}

const startedAt = {};   // ส่วนที่กำลังดึงอยู่ใน isolate นี้ (เวลาเริ่ม) · ไม่แชร์ promise ข้ามคำขอ (Workers ไม่ให้รอ I/O ของคำขออื่น)
const ageSec = (m, now) => (m && m.t ? (now - m.t) / 1000 : Infinity);
// หมดอายุสำหรับคนดู (ใช้ทั้งสั่งดึงเองและติดธง s) · ส่วนที่ใช้ at: เลยเวลาที่กำหนดเกิน SCHED_GRACE แล้วยังไม่ได้ดึง
function expired(p, m, now) {
  const def = PARTS[p];
  if (!m?.t) return true;
  if (def.at) { const b = def.at(now); return m.t < b && now - b > SCHED_GRACE * 1000; }
  return ageSec(m, now) > def.ttl;
}
// ถึงรอบ cron · trends ไม่มีรอบของตัวเอง (cronRun สั่งต่อจากโทรมาตร/กราฟ ปภ.) ยกเว้นยังไม่มีข้อมูลเลย
function cronDue(p, m, now) {
  const def = PARTS[p];
  if (!m?.t) return true;
  if (def.at) return m.t < def.at(now);
  // ข้อมูลรายชั่วโมงที่ยังไม่มีค่าของชั่วโมงนี้ → ถามถี่ขึ้นจนกว่าจะได้
  if (def.poll && !(m.h >= Math.floor(now / HOUR_MS) * HOUR_MS)) return ageSec(m, now) >= def.poll - CRON_SLACK;
  return def.every ? ageSec(m, now) >= def.every - CRON_SLACK : false;
}
// cron = ถึงรอบ cron · ไม่ใช่ = หมดอายุสำหรับคนดู
function due(store, p, now, cron) {
  const m = store.meta[p], age = ageSec(m, now);
  // เพิ่งล้มเหลว ไม่ยิงถี่ใส่ต้นทาง · 429 ติดกันพักนานขึ้นเป็นเท่าตัว
  const gap = /HTTP 429/.test(m?.e) ? Math.min(LIMIT_GAP * 2 ** ((m.k || 1) - 1), LIMIT_MAX) : FAIL_GAP;
  if (m?.et && now - m.et < gap) return false;
  if (m?.u && age > RETRY_GAP / 1000) return true;
  return cron ? cronDue(p, m, now) : expired(p, m, now);
}
/* ดึงส่วนที่หมดอายุพร้อมกัน · fresh ได้ผลทีละส่วนเมื่อเสร็จ (คำตอบหยิบเฉพาะที่เสร็จทันไปใช้) · runs = promise รายส่วน */
function refresh(env, store, parts) {
  const budget = { left: FETCH_BUDGET };
  const fresh = {}, runs = {};
  const run = (p) => runs[p] || (runs[p] = (async () => {
    const dep = { prev: storedJson(store, p), updated: [] };   // ชุดเดิมของส่วนนี้เอง · updated = ส่วนที่พึ่งซึ่งได้ข้อมูลใหม่รอบนี้
    for (const d of PARTS[p].after || []) {
      if (parts.includes(d)) await run(d).catch(() => {});
      dep[d] = fresh[d]?.j ?? storedJson(store, d);
      if (fresh[d]?.text != null) dep.updated.push(d);
    }
    try {
      const r = await PARTS[p].get(env, budget, dep);
      fresh[p] = { t: Date.now(), ...r };
      if (PARTS[p].dataAt) fresh[p].h = PARTS[p].dataAt(r.j);
    } catch (e) {
      fresh[p] = { t: Date.now(), e: String(e?.message || e) };
      throw e;
    } finally {
      delete startedAt[p];   // เสร็จแล้ว · ล้มเหลวกันยิงถี่ด้วย et ใน meta แทน
    }
  })());
  return { fresh, runs, done: Promise.allSettled(parts.map(run)).then(() => fresh) };
}

/* ต่อคำตอบจากข้อความที่เก็บไว้ (และที่เพิ่งดึงเสร็จ) ตรง ๆ */
function bundle(store, fresh, want, now) {
  return '{"v":1,"now":' + now + ',"parts":{' + want.map((p) => {
    const f = fresh[p]?.text != null ? fresh[p] : null;
    const text = f ? f.text : storedText(store, p);
    const m = f || store.meta[p] || {};
    const age = ageSec(m, now);
    const usable = text != null && age <= PARTS[p].max;
    const s = !usable || expired(p, m, now) || m.u ? 1 : 0;
    return JSON.stringify(p) + ':{"t":' + (m.t || 0) + ',"s":' + s + ',"d":' + (usable ? text : 'null') + '}';
  }).join(',') + '}}';
}

async function homeJson(request, env, ctx) {
  const q = new URL(request.url).searchParams.get('parts');
  const want = q ? [...new Set(q.split(','))].filter((p) => PARTS[p]) : Object.keys(PARTS);
  const store = await readStore();
  const now = Date.now();
  const need = [];
  const add = (p) => {
    if (need.includes(p) || !due(store, p, now) || now - (startedAt[p] || 0) < RETRY_GAP) return;
    need.push(p);
    (PARTS[p].after || []).forEach(add);   // ส่วนที่ต้องใช้ก็หมดอายุ → ดึงใหม่ก่อน
  };
  want.forEach(add);
  let fresh = {};
  if (need.length) {
    need.forEach((p) => { startedAt[p] = now; });
    const r = refresh(env, store, need);
    fresh = r.fresh;
    // ส่วนที่ขอและเก่าเกิน swr (หรือยังไม่มีเลย / ต้นทางเพิ่งตอบชุดเก่ามา) → รอผลใหม่สักครู่ · ที่เหลือตอบชุดเดิมทันที
    const late = want.filter((p) => need.includes(p) && (ageSec(store.meta[p], now) > PARTS[p].swr || store.meta[p]?.u));
    if (late.length) {
      const cold = late.some((p) => storedText(store, p) == null);
      await Promise.race([Promise.allSettled(late.map((p) => r.runs[p])), sleep(cold ? COLD_WAIT : SOFT_WAIT)]);
    }
    // บันทึกส่วนที่เสร็จแล้วก่อน แล้วค่อยบันทึกส่วนที่เหลือเมื่อเสร็จครบ · ถ้ารอให้ครบก่อนค่อยบันทึกทีเดียว
    // แหล่งที่ช้ามาก (hyd-app ~30 วิ) อาจทำให้งานเบื้องหลังถูกตัดเกินเวลา (waitUntil ได้ 30 วิ) ผลที่ได้มาแล้วหายหมด
    const early = Object.keys(fresh).length ? saveStore({ ...fresh }).catch(() => {}) : Promise.resolve();
    ctx.waitUntil(early.then(() => r.done).then(saveStore).catch(() => {}));
  }
  return new Response(bundle(store, fresh, want, Date.now()), {
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

/* รอบ cron: ดึงทุกส่วนที่ถึงรอบ (every) แล้วรอจนบันทึกเสร็จ · เรียกจาก scheduled() ผ่าน SELF จึงรันที่ BKK ตาม Placement
   runsIn จาก cdn-cgi/trace บอกว่ารันศูนย์ไหนจริง (คำขอผ่าน binding ไม่มี request.cf) */
async function cronRun(env) {
  const store = await readStore();
  const now = Date.now();
  const need = [];
  const add = (p) => {
    if (need.includes(p) || !due(store, p, now, true) || now - (startedAt[p] || 0) < RETRY_GAP) return;
    need.push(p);
    (PARTS[p].after || []).forEach(add);
  };
  Object.keys(PARTS).forEach(add);
  // ทิศทางน้ำคิดต่อเมื่อรอบนี้ได้โทรมาตร ชป. ใหม่ หรือกราฟ ปภ. ถึงชั่วโมง (builder เลือกคิดเฉพาะฝั่งที่ถึงรอบ)
  const tr = storedJson(store, 'trends');
  const graphsDue = !tr?.ddpmAt || now - tr.ddpmAt >= (GRAPH_EVERY - CRON_SLACK) * 1000;
  const tm = store.meta.trends;
  const trendsWait = (tm?.et && now - tm.et < FAIL_GAP) || now - (startedAt.trends || 0) < RETRY_GAP;
  if (!need.includes('trends') && !trendsWait && (need.includes('rid') || graphsDue)) need.push('trends');
  // นาทีที่ไม่มีอะไรถึงรอบ: จบทันที ไม่ถามศูนย์ ไม่เขียนแคช (cron มาทุกนาที)
  if (!need.length) return json({ at: now, refreshed: 0 });
  need.forEach((p) => { startedAt[p] = now; });
  const [fresh, runsIn] = await Promise.all([
    refresh(env, store, need).done,
    withTimeout(fetch('https://www.cloudflare.com/cdn-cgi/trace').then((r) => r.text()), 5000, 'trace')
      .then((t) => (t.match(/^colo=(\w+)/m) || [])[1] || '', () => ''),
  ]);
  const failed = need.filter((p) => fresh[p]?.text == null);
  const info = { at: now, ms: Date.now() - now, runsIn, refreshed: need.length, failed };
  await saveStore(fresh, info);
  return json(info);
}

async function status(request, env) {
  const store = await readStore(), now = Date.now();
  const parts = {};
  for (const p of Object.keys(PARTS)) {
    const m = store.meta[p] || {};
    const def = PARTS[p];
    parts[p] = { ageSec: m.t ? Math.round((now - m.t) / 1000) : null,
      refresh: def.label || (def.every ? `every ${def.every >= HOUR ? def.every / HOUR + ' h' : def.every / MIN + ' min'}` : 'after rid (14 min) / DDPM graphs hourly'),
      ...(PARTS[p].dataAt ? { dataAt: m.h ? new Date(m.h).toISOString() : null } : {}),   // เวลาวัดล่าสุดที่มีครบ
      sizeKB: Math.round((m.n || 0) / 102.4) / 10,
      late: expired(p, m, now),   // เกินรอบแล้วยังไม่ได้ดึงใหม่ (เกณฑ์เดียวกับธง s ที่หน้าเว็บเห็น)
      upstreamStale: !!m.u, lastError: m.e || null, lastErrorAgoSec: m.et ? Math.round((now - m.et) / 1000) : null };
  }
  const bindings = Object.fromEntries(Object.keys(PUBLIC).map((n) => [n, !!(env && env[n])]));
  bindings.SELF = !!(env && env.SELF);
  const missing = Object.keys(bindings).filter((n) => !bindings[n]);
  const c = store.meta._cron;
  return json({
    colo: (request.cf && request.cf.colo) || '', bindings,
    hint: missing.length ? `add Service bindings (Settings > Bindings): ${missing.map((n) => `${n} -> ${n === 'SELF' ? 'home-proxy (itself, for cron)' : PUBLIC[n].replace(/^https:\/\/|\..*$/g, '')}`).join(', ')}` : 'all bindings set',
    cron: c ? { lastRunAgoSec: Math.round((now - c.at) / 1000), runsIn: c.runsIn, tookMs: c.ms, refreshed: c.refreshed, failed: c.failed }
      : 'no cron run seen in this cache yet (needs SELF binding + Cron Trigger * * * * *)',
    note: 'cache is per Cloudflare data center: this shows the one serving you',
    use: ['/home.json', '/home.json?parts=rid,trends', '/cron'],
    parts,
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: CORS });
    const path = new URL(request.url).pathname;
    try {
      if (path === '/') return await status(request, env);
      if (path === '/home.json') return await homeJson(request, env, ctx);
      if (path === '/cron') return await cronRun(env);
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 500);
    }
  },
  // Cron Trigger (ทุกนาที * * * * *): Placement ไม่มีผลกับ scheduled → เรียก /cron ของตัวเองผ่าน SELF ให้ fetch ไปรันที่ BKK
  // ไม่ได้ผูก SELF: ไม่ทำอะไร (ดึงจากศูนย์อื่นจะเติมแคชผิดที่ เปลืองต้นทางเปล่า ๆ)
  async scheduled(event, env, ctx) {
    if (env && env.SELF) ctx.waitUntil(env.SELF.fetch('https://home-proxy/cron').then((r) => r.text()).catch(() => {}));
  },
};
