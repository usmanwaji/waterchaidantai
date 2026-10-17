/*
  hyd-proxy.worker.js — Cloudflare Worker ส่งต่อคำขอไประบบอุทกวิทยา กรมชลประทาน (hyd-app.rid.go.th)
  ------------------------------------------------------------------
  hyd-app.rid.go.th ตัดการเชื่อมต่อจาก IP นอกไทย (เหมือน telerid) → ให้ Worker ที่รันศูนย์ BKK ดึงแทน
  หน้า hydro8h.html (ศูนย์อุทกวิทยาที่ 8 · hydroid 8) ดึงระดับน้ำรายชั่วโมงจาก
    webservice/HDService.svc/GetColModelAllHL       รายชื่อสถานี + ระดับตลิ่งของลุ่มน้ำ (BasinID 24 = ภาคใต้ฝั่งตะวันออกตอนล่าง)
    webservice/getGroupHourlyWaterLevelReportAllHL.ashx   ค่าระดับน้ำ/ปริมาณน้ำรายชั่วโมงของวันที่เลือก (jqGrid)

  path:
    /                               สถานะ: Worker รันศูนย์ไหน (runsIn) และดึง hyd-app ได้หรือไม่
    /stations.json                  สรุปสถานีในนราธิวาส: ระดับน้ำล่าสุด + ตลิ่ง + กราฟ 24 ชม. (แคช 10 นาที · hyd-app ล่มตอบชุดเก่าได้ 6 ชม.)
                                    แคชเกิน 10 นาทีแต่ไม่เกิน 1 ชม. → ตอบชุดเดิมทันทีแล้วดึงใหม่เบื้องหลัง (ไม่ให้คนดูรอ hyd-app 20–30 วิ)
    /hydro8h.html                   = https://hyd-app.rid.go.th/hydro8h.html (path/query อื่นก็ส่งต่อเหมือนกัน)
    /h/<host>/<path>                = https://<host>/<path> · host ต้องเป็นโดเมนย่อยของ rid.go.th เท่านั้น
                                      (เผื่อหน้าเว็บเรียก API จากโดเมนย่อยอื่น เช่น hyd-app-db.rid.go.th)
  รับ GET / POST (ส่ง body และ content-type ต่อให้) · GET ที่ได้ 200 แคชในศูนย์ Cloudflare 5 นาที
  จำกัดเฉพาะ *.rid.go.th → ไม่เป็น open proxy ให้คนอื่นใช้ดึงเว็บอื่น

  วิธี deploy: dash.cloudflare.com → Workers & Pages → Create → Create Worker (ไม่ใช่ Import a repository)
              → ชื่อ hyd-proxy → Deploy → Edit code → วางไฟล์นี้ → Deploy
              ได้ URL https://hyd-proxy.<บัญชี>.workers.dev
  สำคัญ: เปิด Smart Placement (Settings → Runtime → Placement → Smart) เหมือน telerid-proxy
         แล้วเปิดหน้าแรก https://hyd-proxy.<บัญชี>.workers.dev/ ดูว่า hydStatus เป็น 200
         (Smart Placement ต้องมีคำขอเข้ามาสักพักถึงจะย้ายไปรันใกล้ไทย · ถ้ายังไม่ 200 ลองเปิดซ้ำอีกครั้งหลังผ่านไปหลายนาที)
  แชร์ข้ามศูนย์ (ไม่บังคับ): ผูก Workers KV ชื่อ HYD_KV (Settings → Bindings) → ศูนย์ที่ดึงได้เก็บ /stations.json ล่าสุดไว้
         ศูนย์ที่ดึง hyd-app ไม่ได้อ่านจาก KV แทน (เขียนไม่ถี่กว่า 15 นาที/ครั้ง · อยู่ในโควตาฟรี)
  ------------------------------------------------------------------
*/
const DEFAULT_HOST = 'hyd-app.rid.go.th';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const TTL = 300;          // แคช GET 5 นาที
const TIMEOUT = 25000;
const PROVINCE = 'นราธิวาส';
const HYDRO_ID = 8, BASIN_ID = 24;
const TTL_STATIONS = 600;           // สรุปสถานี 10 นาที (สถานีส่งค่ารายชั่วโมง)
const STALE_MAX = 6 * 3600;         // hyd-app ล่มชั่วคราว → ตอบชุดเก่าได้ไม่เกิน 6 ชม.
const SWR_MAX = 3600;               // เกิน TTL_STATIONS แต่ไม่เกินนี้ → ตอบชุดในแคชทันที แล้วดึงใหม่เบื้องหลัง
const SHARE_EVERY = 15 * 60e3;      // เขียน KV ได้ไม่ถี่กว่านี้

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-expose-headers': 'x-upstream, x-colo, x-cache',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), {
  status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timeout')), ms))]);
const allowedHost = (h) => /^[a-z0-9.-]+$/i.test(h) && (h === 'rid.go.th' || h.toLowerCase().endsWith('.rid.go.th'));

/* แปลง path ของ Worker → URL ปลายทาง */
function upstreamUrl(url) {
  const m = url.pathname.match(/^\/h\/([^/]+)(\/.*)?$/);
  const host = m ? m[1] : DEFAULT_HOST;
  if (!allowedHost(host)) return null;
  const path = m ? (m[2] || '/') : url.pathname;
  return `https://${host}${path}${url.search}`;
}

async function status(request) {
  let runsIn = null;
  try { runsIn = ((await (await withTimeout(fetch('https://www.cloudflare.com/cdn-cgi/trace'), 8000, 'trace')).text()).match(/^colo=(\w+)/m) || [])[1] || null; } catch {}
  const t0 = Date.now();
  const hydStatus = await withTimeout(fetch(`https://${DEFAULT_HOST}/hydro8h.html`, { headers: { 'User-Agent': UA } }), 20000, 'probe')
    .then((r) => r.status, (e) => String(e.message || e));
  return json({
    ok: hydStatus === 200, requestEnteredAt: (request.cf && request.cf.colo) || '', runsIn, hydStatus, ms: Date.now() - t0,
    hint: hydStatus === 200 ? 'hyd-app reachable from here' : `hyd-app not reachable from ${runsIn} - enable Smart Placement (Settings > Runtime > Placement)`,
    use: ['/stations.json', '/hydro8h.html', '/<path>?<query>  (hyd-app.rid.go.th)', '/h/<host>.rid.go.th/<path>'],
  });
}

async function forward(request, ctx, target) {
  const isGet = request.method === 'GET';
  const cache = caches.default;
  const key = new Request(target);
  if (isGet) {
    const hit = await cache.match(key);
    if (hit) { const h = new Headers(hit.headers); h.set('x-cache', 'HIT'); return new Response(hit.body, { status: hit.status, headers: h }); }
  }
  const headers = { 'User-Agent': UA, Accept: request.headers.get('accept') || '*/*', 'Accept-Language': 'th,en;q=0.8', Referer: `https://${new URL(target).host}/` };
  const ct = request.headers.get('content-type');
  if (ct) headers['Content-Type'] = ct;
  const res = await withTimeout(fetch(target, {
    method: request.method, headers, body: isGet ? undefined : await request.arrayBuffer(), redirect: 'follow',
  }), TIMEOUT, 'upstream');
  const body = await res.arrayBuffer();
  const out = new Headers();
  for (const k of ['content-type', 'last-modified', 'etag']) { const v = res.headers.get(k); if (v) out.set(k, v); }
  for (const [k, v] of Object.entries(CORS)) out.set(k, v);
  out.set('x-upstream', String(res.status));
  out.set('x-colo', (request.cf && request.cf.colo) || '');
  out.set('x-cache', 'MISS');
  out.set('cache-control', isGet && res.ok ? `public, max-age=${TTL}` : 'no-store');
  if (isGet && res.ok) ctx.waitUntil(cache.put(key, new Response(body, { status: res.status, headers: out })));
  return new Response(body, { status: res.status, headers: out });
}

/* ---------- /stations.json ---------- */
const HYD = `https://${DEFAULT_HOST}/webservice/`;
// hyd-app ตอบช้า/ตัดการเชื่อมต่อเป็นพักๆ → ลองซ้ำ
async function hydPost(path, body, ctype) {
  let err;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await withTimeout(fetch(HYD + path, { method: 'POST', body, headers: { 'User-Agent': UA, 'Content-Type': ctype, Accept: 'application/json', Referer: `https://${DEFAULT_HOST}/hydro8h.html` } }), 12000, path);
      if (res.ok) return await res.json();
      err = new Error(path + ' ' + res.status);
    } catch (e) { err = e; }
  }
  throw err;
}
// วันที่ตามเวลาไทย (พ.ศ.) แบบที่หน้าเว็บส่ง: dd/mm/yyyy
function thaiDay(offsetDays) {
  const d = new Date(Date.now() + 7 * 3600e3 + offsetDays * 86400e3);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
    str: `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear() + 543}` };
}
const num = (x) => (x == null || x === '' || x === '-' || !isFinite(Number(x)) ? null : Number(x));
async function hourlyRows(day) {
  const form = new URLSearchParams({ 'DW[UtokID]': HYDRO_ID, 'DW[BasinID]': BASIN_ID, 'DW[TimeCurrent]': day.str,
    _search: 'false', nd: String(Date.now()), rows: '100', page: '1', sidx: 'indexhourly', sord: 'asc' });
  const j = await hydPost('getGroupHourlyWaterLevelReportAllHL.ashx', form.toString(), 'application/x-www-form-urlencoded; charset=UTF-8');
  // hourlytime "1.00" … "24.00" = ชั่วโมงตามเวลาไทยของวันนั้น ("24.00" = เที่ยงคืนต่อวันถัดไป)
  return (j.rows || []).map((r) => ({ r, unix: (Date.UTC(day.y, day.m - 1, day.d, parseInt(r.hourlytime, 10)) - 7 * 3600e3) / 1000 }));
}
async function buildStations() {
  const today = thaiDay(0), yday = thaiDay(-1);
  const cm = await hydPost('HDService.svc/GetColModelAllHL', JSON.stringify({ hydro: { UtokID: HYDRO_ID, BasinID: BASIN_ID, TimeCurrent: today.str } }), 'application/json; charset=utf-8');
  const head = (k, i) => ((cm[k] || []).find((g) => g.startColumnName === 'wlvalues' + i) || {}).titleText || '';
  const n = cm.NoOfStation || (cm.StationIDList || []).length;
  const [rToday, rYday] = await Promise.allSettled([hourlyRows(today), hourlyRows(yday)]);
  if (rToday.status !== 'fulfilled' && rYday.status !== 'fulfilled') throw rToday.reason;
  const rows = [...(rYday.status === 'fulfilled' ? rYday.value : []), ...(rToday.status === 'fulfilled' ? rToday.value : [])];
  const stations = [];
  for (let i = 1; i <= n; i++) {
    const province = head('groupHeadersStationProvince', i).trim();
    if (!province.includes(PROVINCE)) continue;
    const col = (cm.colModel || []).find((c) => c.name === 'wlvalues' + i) || {};
    const bank = num(((col.label || '').match(/ตลิ่ง\s*(-?[\d.]+)/) || [])[1]);
    const pts = rows.map(({ r, unix }) => ({ t: unix, v: num(r['wlvalues' + i]), q: num(r['qvalues' + i]) })).filter((p) => p.v != null).slice(-24);
    const last = pts[pts.length - 1] || null;
    stations.push({
      code: head('groupHeadersStationCode', i).trim(), name: head('groupHeadersStationDetail', i).trim(),
      amphur: head('groupHeadersStationAmpur', i).trim(), province, stationId: (cm.StationIDList || [])[i - 1] ?? null,
      bank, level: last ? Math.round(last.v * 100) / 100 : null, q: last ? last.q : null,
      levelDt: last ? new Date(last.t * 1000).toISOString() : null,
      wl: { t: pts.map((p) => p.t), v: pts.map((p) => Math.round(p.v * 100) / 100) },
    });
  }
  if (!stations.some((x) => x.level != null)) throw new Error('hyd-app gave no data');
  const dts = stations.map((x) => x.levelDt).filter(Boolean).sort();
  return { updated: dts[dts.length - 1], fetchedAt: new Date().toISOString(), source: 'hyd-proxy (hyd-app.rid.go.th hydro8h)', total: stations.length, stations };
}
const STATIONS_KEY = 'https://hyd-proxy.cache/stations.json';
let revalidateAt = 0;   // เวลาที่สั่งดึงเบื้องหลังรอบล่าสุดใน isolate นี้ · กันคำขอที่เข้ามาระหว่างรอ hyd-app สั่งดึงซ้ำ
/* ดึง hyd-app ใหม่ · คืน { text, saved } โดย saved = งานเก็บลงแคชของศูนย์ (+ KV ถ้าผูกไว้) ให้ผู้เรียกส่งเข้า ctx.waitUntil
   ไม่แชร์ promise ข้ามคำขอ: Workers ไม่ให้คำขอหนึ่งรอ I/O ที่เริ่มจากอีกคำขอ (ค้างได้ถ้าคำขอต้นทางจบก่อน) */
async function refreshStations(env) {
  const body = await buildStations();
  const text = JSON.stringify(body);
  const kv = env && env.HYD_KV;
  const saved = Promise.all([
    caches.default.put(STATIONS_KEY, new Response(text, { headers: { 'x-stored': String(Date.now()), 'cache-control': `public, max-age=${STALE_MAX}` } })),
    kv && (async () => {
      const m = (await kv.getWithMetadata('stations', { type: 'stream' }).then((r) => { if (r.value) r.value.cancel(); return r.metadata; }).catch(() => null)) || null;
      if (!m || m.u !== body.updated || Date.now() - m.t > SHARE_EVERY) await kv.put('stations', text, { metadata: { t: Date.now(), u: body.updated }, expirationTtl: STALE_MAX * 2 });
    })(),
  ]).catch(() => {});
  return { text, saved };
}
async function stationsJson(env, ctx) {
  const hit = await caches.default.match(STATIONS_KEY);
  const age = hit ? (Date.now() - Number(hit.headers.get('x-stored') || 0)) / 1000 : Infinity;
  const send = (text, from) => new Response(text, { headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=120', 'x-cache': from } });
  if (hit && age < TTL_STATIONS) return send(await hit.text(), 'HIT');
  // hyd-app ตอบช้า ดึงครบชุดราว 20–30 วิ · เดิมคนแรกหลังแคชหมดต้องรอทั้งหมดนี้ (หน้าแรกค้างตาม)
  // ชุดในแคชยังไม่เก่าเกิน SWR_MAX → ตอบทันที แล้วดึงใหม่เบื้องหลัง คนถัดไปได้ชุดใหม่
  if (hit && age < SWR_MAX) {
    if (Date.now() - revalidateAt > 60e3) {
      revalidateAt = Date.now();
      ctx.waitUntil(refreshStations(env).then((r) => r.saved).catch(() => {}));
    }
    return send(await hit.text(), 'REVALIDATING');
  }
  try {
    const { text, saved } = await refreshStations(env);
    ctx.waitUntil(saved);
    return send(text, 'MISS');
  } catch (e) {
    if (hit && age < STALE_MAX) return send(await hit.text(), 'STALE');
    const kv = env && env.HYD_KV;
    if (kv) {
      const r = await kv.getWithMetadata('stations').catch(() => null);
      if (r && r.value && r.metadata && Date.now() - r.metadata.t < STALE_MAX * 1000) return send(r.value, 'KV');
    }
    return json({ error: String(e.message || e) }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET' && request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/' && !url.search) return status(request);
    if (url.pathname === '/stations.json' && request.method === 'GET') return stationsJson(env, ctx);
    const target = upstreamUrl(url);
    if (!target) return json({ error: 'host not allowed (only *.rid.go.th)' }, 403);
    try {
      return await forward(request, ctx, target);
    } catch (e) {
      return json({ error: String(e.message || e), target }, 502);
    }
  },
};
