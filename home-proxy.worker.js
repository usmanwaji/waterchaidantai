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
    · ไม่ใช้ Cron (Cron รันศูนย์ไหนก็ได้ เติมแคชของ BKK ไม่ได้) → ดึงใหม่เมื่อมีคนเปิดเว็บและส่วนนั้นหมดอายุ
      กลางคืนไม่มีคนดูก็ไม่ดึงให้เปลือง
    · ตอบโดยต่อข้อความ JSON ที่เก็บไว้เข้าด้วยกันตรง ๆ ไม่แปลงใหม่ทุกคำขอ → CPU ไม่เกิน 10 ms
    · ดึงต้นทางไม่เกิน FETCH_BUDGET ครั้งต่อคำขอ (แผนฟรีจำกัด 50 subrequest) · ไม่พอ → เลื่อนไปคำขอถัดไป

  อายุของแต่ละส่วน (PARTS):
    ttl  หมดอายุ → ดึงใหม่
    swr  ยังไม่เก่าเกินนี้ → ตอบชุดเดิมทันที แล้วดึงใหม่เบื้องหลัง
         เก่าเกินนี้ → รอผลใหม่ได้ไม่เกิน SOFT_WAIT (ยังไม่มีข้อมูลเลยรอได้ COLD_WAIT) ไม่ทันก็ตอบชุดเดิม
    max  เก่าเกินนี้ไม่ส่ง (d:null) → หน้าเว็บดึงตรงจากต้นทางเองแบบเดิม
  ส่วนที่ตอบด้วยชุดหมดอายุ ติดธง "s":1 → หน้าเว็บขอซ้ำอีกครั้งหลังราว 40 วิ (ตอนนั้นดึงใหม่เสร็จแล้ว)

  path:
    /                 สถานะ: อายุ/ข้อผิดพลาดล่าสุดของแต่ละส่วนในแคชศูนย์นี้ + ผูก Service binding ครบไหม
    /home.json        ทุกส่วน · ?parts=ddpm,rid  เฉพาะบางส่วน
  รูปแบบ: {"v":1,"now":ms,"parts":{"ddpm":{"t":เวลาดึง(ms),"s":0|1,"d":<JSON จากต้นทาง>|null}, ...}}
         rid    d = {"base": URL ที่หน้าเว็บใช้ดึง {CODE}.detail.json, "j": stations.json ของแหล่งที่ค่าใหม่กว่า}
         trends d = {"ddpm":{code:[ค่าก่อนหน้า, ค่าล่าสุด]}, "rid":{...}}  (ทิศทางน้ำ เกณฑ์เดียวกับ index.html)
         thr    d = {code: เกณฑ์ "เฝ้าระวัง" ของ ปภ. (mediumLevelThreshold) | null}

  วิธี deploy:
    1) dash.cloudflare.com → Workers & Pages → Create → Create Worker (ไม่ใช่ Import a repository)
       → ชื่อ home-proxy → Deploy → Edit code → วางไฟล์นี้ → Deploy
       ได้ https://home-proxy.<บัญชี>.workers.dev (index.html ตั้งไว้ที่บัญชี newusmanwaji)
    2) Settings → Bindings → Add binding → Service binding  เพิ่ม 3 ตัว (ชื่อตัวแปรต้องตรง):
         TELERID → telerid-proxy · HYD → hyd-proxy · TMD → tmd-proxy
       Worker เรียก Worker อื่นในบัญชีเดียวกันผ่าน URL workers.dev ไม่ได้ (error 1042) ต้องผ่าน binding
       ไม่ผูก: ส่วน hyd/tmd/nowcast/riskmap ว่าง (หน้าเว็บดึงตรงเอง) · rid ใช้สาขา cam อย่างเดียว
    3) เปิด https://home-proxy.<บัญชี>.workers.dev/home.json สักครั้ง แล้วเปิด / ดูว่าทุกส่วนมี ageSec และไม่มี lastError
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
const LIMIT_GAP = 5 * 60e3;   // ต้นทางตอบ 429 (จำกัดคำขอต่อ IP ซึ่ง Worker ใช้ IP ร่วมกับคนอื่น) → พักนานขึ้น
const FRESH_MS = 6 * HOUR * 1000;   // ทิศทางน้ำคิดเฉพาะสถานีที่ส่งค่าใน 6 ชม. (HERO_FRESH_H ใน index.html)
const STORE = 'https://home-proxy.cache/store-v1';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), {
  status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timeout')), ms))]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
   ปภ.: 2 ค่าท้ายของกราฟรายชั่วโมง · ชป.: ค่าล่าสุดเทียบค่าล่าสุดที่วัดก่อนนั้นอย่างน้อย 1 ชม. ใน {CODE}.detail.json */
async function trends(env, budget, dep) {
  if (!Array.isArray(dep.ddpm?.data) && !dep.rid?.j) throw new Error('waiting for ddpm/rid station lists');
  const now = Date.now();
  const dd = (dep.ddpm?.data || []).filter((d) => d.isActive !== 0 && !d.deletedAt && num(d.currentWaterLevel) != null
    && d.updatedAt && now - ddpmTime(d.updatedAt) <= FRESH_MS).map((d) => d.code);
  const fromLive = dep.rid?.base === PUBLIC.TELERID;
  const rr = (dep.rid?.j?.stations || []).filter((d) => d.province === PROV && num(d.level) != null && num(d.level) > -9
    && (d.levelDt || d.dt) && now - Date.parse(d.levelDt || d.dt) <= FRESH_MS).map((d) => d.code);
  // โควตาไม่พอ (มักเป็นรอบแรกที่ดึงทุกส่วนพร้อมกัน): ตัดท้าย สถานีที่เหลือไม่มีลูกศรรอบนี้
  const room = Math.max(0, budget.left);
  const ddUse = dd.slice(0, room), rrUse = rr.slice(0, Math.max(0, room - ddUse.length));
  const out = { ddpm: {}, rid: {} };
  const minute = Math.floor(now / 60000);
  await Promise.allSettled([
    ...ddUse.map((code) => fetchText(env, `${DDPM}/water-level/graph?stationCode=${encodeURIComponent(code)}&type=hour&isSimulatorMode=false`, budget).then((r) => {
      const j = JSON.parse(r.text);
      const pts = ((j?.data ?? j)?.datasets?.[0]?.data || []).map((p) => num(p?.y)).filter((v) => v != null);
      if (pts.length >= 2) out.ddpm[code] = [pts[pts.length - 2], pts[pts.length - 1]];
    })),
    ...rrUse.map((code) => fetchText(env, fromLive ? ['TELERID', `/${encodeURIComponent(code)}.detail.json`]
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
  const r = await Promise.allSettled(codes.map((c) => fetchText(env, `${DDPM}/stations/${encodeURIComponent(c)}`, budget)
    .then((x) => { out[c] = num(JSON.parse(x.text)?.waterThreshold?.mediumLevelThreshold); })));
  if (codes.length && !r.some((x) => x.status === 'fulfilled')) throw new Error('no ddpm station detail');
  return { text: JSON.stringify(out), j: out };
}

/* ttl/swr/max เป็นวินาที · after = ส่วนที่ต้องใช้ข้อมูลก่อน (ถ้ากำลังดึงใหม่ รอผลนั้น) */
const PARTS = {
  ddpm:    { ttl: 2 * MIN,   swr: 15 * MIN, max: 6 * HOUR,  get: simple(`${DDPM}/stations?provCode=${PROV_CODE}&limit=100`, (j) => Array.isArray(j?.data)) },
  rid:     { ttl: 1 * MIN,   swr: 10 * MIN, max: 6 * HOUR,  get: rid },
  hyd:     { ttl: 5 * MIN,   swr: 60 * MIN, max: 6 * HOUR,  get: simple(['HYD', '/stations.json'], (j) => Array.isArray(j?.stations), 25000) },
  rain3d:  { ttl: 30 * MIN,  swr: 3 * HOUR, max: 12 * HOUR, get: simple(`${TW}/provinces/rain3d?province_code=${PROV_CODE}`, (j) => Array.isArray(j?.data)) },
  tmd:     { ttl: 30 * MIN,  swr: 6 * HOUR, max: 24 * HOUR, get: simple(['TMD', '/region7days'], (j) => !!j?.WeatherForecast7DaysByRegion) },
  nowcast: { ttl: 4 * MIN,   swr: 15 * MIN, max: 1 * HOUR,  get: simple(['TMD', '/nowcast'], (j) => Array.isArray(j?.frames) && j.frames.length) },
  riskmap: { ttl: 30 * MIN,  swr: 6 * HOUR, max: 24 * HOUR, get: simple(['TMD', '/riskmap'], (j) => Array.isArray(j?.districts) && j.districts.length) },
  trends:  { ttl: 5 * MIN,   swr: 30 * MIN, max: 6 * HOUR,  get: trends, after: ['ddpm', 'rid'] },
  thr:     { ttl: 12 * HOUR, swr: 7 * 24 * HOUR, max: 7 * 24 * HOUR, get: thresholds, after: ['ddpm'] },
};

/* ---------- ที่เก็บ: Cache API รายการเดียว ----------
   body = ข้อความของทุกส่วนต่อกัน · header x-meta = {ส่วน: {t เวลาดึง, o ตำแหน่ง, n ความยาว, u ต้นทางตอบชุดเก่า, e/et ข้อผิดพลาดล่าสุด}}
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
async function saveStore(fresh) {
  const cur = await readStore();   // อ่านล่าสุดอีกรอบ เผื่อคำขออื่นเพิ่งเขียนส่วนอื่นไป
  const meta = {};
  let body = '';
  for (const p of Object.keys(PARTS)) {
    const f = fresh[p], old = cur.meta[p];
    const useNew = f && f.text != null && (!old || !old.t || f.t >= old.t);
    const text = useNew ? f.text : storedText(cur, p);
    const m = useNew ? { t: f.t } : { t: old?.t || 0 };
    if (useNew ? f.u : old?.u) m.u = 1;
    if (f && f.e) { m.e = ascii(f.e); m.et = f.t; } else if (!useNew && old?.e) { m.e = old.e; m.et = old.et; }
    if (text != null) { m.o = body.length; m.n = text.length; body += text; }
    meta[p] = m;
  }
  await caches.default.put(STORE, new Response(body, { headers: {
    'content-type': 'text/plain; charset=utf-8', 'x-meta': JSON.stringify(meta), 'cache-control': 'public, max-age=604800' } }));
}

const startedAt = {};   // ส่วนที่กำลังดึงอยู่ใน isolate นี้ (เวลาเริ่ม) · ไม่แชร์ promise ข้ามคำขอ (Workers ไม่ให้รอ I/O ของคำขออื่น)
const ageSec = (m, now) => (m && m.t ? (now - m.t) / 1000 : Infinity);
function due(store, p, now) {
  const m = store.meta[p], age = ageSec(m, now);
  if (m?.et && now - m.et < (/HTTP 429/.test(m.e) ? LIMIT_GAP : RETRY_GAP)) return false;   // เพิ่งล้มเหลว ไม่ยิงถี่ใส่ต้นทาง
  return age > PARTS[p].ttl || (m?.u && age > RETRY_GAP / 1000);
}
/* ดึงส่วนที่หมดอายุพร้อมกัน · fresh ได้ผลทีละส่วนเมื่อเสร็จ (คำตอบหยิบเฉพาะที่เสร็จทันไปใช้) · runs = promise รายส่วน */
function refresh(env, store, parts) {
  const budget = { left: FETCH_BUDGET };
  const fresh = {}, runs = {};
  const run = (p) => runs[p] || (runs[p] = (async () => {
    const dep = {};
    for (const d of PARTS[p].after || []) {
      if (parts.includes(d)) await run(d).catch(() => {});
      dep[d] = fresh[d]?.j ?? storedJson(store, d);
    }
    try {
      fresh[p] = { t: Date.now(), ...(await PARTS[p].get(env, budget, dep)) };
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
    const s = !usable || age > PARTS[p].ttl || m.u ? 1 : 0;
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

async function status(request, env) {
  const store = await readStore(), now = Date.now();
  const parts = {};
  for (const p of Object.keys(PARTS)) {
    const m = store.meta[p] || {};
    parts[p] = { ageSec: m.t ? Math.round((now - m.t) / 1000) : null, ttlSec: PARTS[p].ttl, sizeKB: Math.round((m.n || 0) / 102.4) / 10,
      upstreamStale: !!m.u, lastError: m.e || null, lastErrorAgoSec: m.et ? Math.round((now - m.et) / 1000) : null };
  }
  const bindings = Object.fromEntries(Object.keys(PUBLIC).map((n) => [n, !!(env && env[n])]));
  const missing = Object.keys(bindings).filter((n) => !bindings[n]);
  return json({
    colo: (request.cf && request.cf.colo) || '', bindings,
    hint: missing.length ? `add Service bindings (Settings > Bindings): ${missing.map((n) => `${n} -> ${PUBLIC[n].replace(/^https:\/\/|\..*$/g, '')}`).join(', ')}` : 'all bindings set',
    note: 'cache is per Cloudflare data center: this shows the one serving you',
    use: ['/home.json', '/home.json?parts=rid,trends'],
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
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 500);
    }
  },
};
