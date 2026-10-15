/*
  ews-proxy.worker.js — Cloudflare Worker ส่งต่อคำขอไประบบเตือนภัยล่วงหน้า กรมทรัพยากรน้ำ (ews.dwr.go.th)
  ------------------------------------------------------------------
  ระบบเตือนภัยล่วงหน้า (EWS) ของ ทน. มีสถานีวัดระดับน้ำในนราธิวาส 7 สถานี (เช่น STN2155 บ้านไอปาโจ · STN2233 ชุมชนยะกัง)
  ที่ thaiwater และระบบโทรมาตร telemetry.dwr.go.th ไม่มีค่าวัด → ค่าสดมีที่ EWS ที่เดียว
  ews.dwr.go.th ตัดการเชื่อมต่อจาก IP นอกไทย · Worker ยังย่อข้อมูลทั้งประเทศ (~3 MB) ให้เหลือเฉพาะนราธิวาส (~3 KB)
  ews1.dwr.go.th (เว็บเดียวกัน อีกเครื่อง) เปิดได้จากทุกที่ ส่วน ews.dwr.go.th เปิดไม่ได้แม้จาก Cloudflare → ใช้ ews1 ก่อน
  ข้อมูลสถานี: POST ews/web-service/stn (action=LoadStation) = ทุกสถานีทั่วประเทศ ~3 MB
    wl = ระดับน้ำล่าสุด (ม. จากศูนย์เสาวัด ไม่ใช่ ม.รทก.) · wl07h = ระดับน้ำเฉลี่ยรายวัน (ตั้งแต่ 07:00)
    status 1 เฝ้าระวัง · 2 เตรียมพร้อม · 3 วิกฤติ · ค่าอื่น (0, 9) หน้าเว็บ EWS แสดงเป็น "สถานะปกติ"
    ไม่มีระดับตลิ่ง · alert_min/alert_max เป็นค่าเดียวกันทุกสถานี (55 / 4 ม.) และหน้าเว็บ EWS เองก็ไม่แสดง จึงไม่ใช้
    graph/wl_graph.php เป็นกราฟค่าเฉลี่ยสะสมรายวัน (จุดสุดท้าย = wl07h) ไม่ใช่ระดับน้ำจริง จึงไม่ใช้

  path:
    /stations.json            สถานีวัดระดับน้ำ EWS ในนราธิวาส (แคช 10 นาที · EWS ล่มตอบชุดเก่าได้ 6 ชม.)
    /                         สถานะ: Worker รันศูนย์ไหน (runsIn) และเปิด ews.dwr.go.th / ews1.dwr.go.th
                              ทั้ง https และ http ได้หรือไม่ (ok: true = มีอย่างน้อยหนึ่งทางที่เปิดได้)
    /<path>?<query>           = https://ews1.dwr.go.th/<path>?<query>   เช่น /ews/index.php
    /h/<host>/<path>          = https://<host>/<path>   host ต้องเป็นโดเมนย่อยของ dwr.go.th เท่านั้น
    /http/<host>/<path>       = http://<host>/<path>    (เผื่อหน้าเก่าที่เปิดได้แค่ http)
  รับ GET / POST (ส่ง body และ content-type ต่อให้) · GET ที่ได้ 200 แคชในศูนย์ Cloudflare 5 นาที
  จำกัดเฉพาะ *.dwr.go.th (redirect ไปโดเมนอื่นก็ไม่ตาม) → ไม่เป็น open proxy ให้คนอื่นใช้ดึงเว็บอื่น

  วิธี deploy: dash.cloudflare.com → Workers & Pages → Create → Create Worker (ไม่ใช่ Import a repository)
              → ชื่อ ews-proxy → Deploy → Edit code → วางไฟล์นี้ → Deploy
              ได้ URL https://ews-proxy.<บัญชี>.workers.dev
  ตรวจ: เปิด https://ews-proxy.<บัญชี>.workers.dev/ ต้องได้ ok เป็น true (ews1 ตอบ 200)
        แล้วเปิด /stations.json ต้องได้รายชื่อสถานี · ไม่ต้องเปิด Smart Placement เพราะ ews1 เปิดได้จากศูนย์ไหนก็ได้
        (ถ้าวันหนึ่ง ews1 ปิดรับ IP นอกไทยเหมือน ews ค่อยเปิด Smart Placement / Placement Hint เป็น BKK)
  ------------------------------------------------------------------
*/
const DEFAULT_HOST = 'ews1.dwr.go.th';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const TTL = 300;          // แคช GET 5 นาที
const TIMEOUT = 25000;
// ทางที่ลองในหน้าสถานะ · ผลค้นหาเว็บพบทั้ง ews และ ews1 และบางหน้าเป็น http
const PROBES = ['https://ews.dwr.go.th/ews/', 'http://ews.dwr.go.th/ews/', 'https://ews1.dwr.go.th/ews/', 'http://ews1.dwr.go.th/ews/'];

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-expose-headers': 'x-upstream, x-colo, x-cache',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), {
  status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timeout')), ms))]);
const allowedHost = (h) => /^[a-z0-9.-]+$/i.test(h) && (h.toLowerCase() === 'dwr.go.th' || h.toLowerCase().endsWith('.dwr.go.th'));

/* แปลง path ของ Worker → URL ปลายทาง */
function upstreamUrl(url) {
  const m = url.pathname.match(/^\/(h|http)\/([^/]+)(\/.*)?$/);
  const scheme = m && m[1] === 'http' ? 'http' : 'https';
  const host = m ? m[2] : DEFAULT_HOST;
  if (!allowedHost(host)) return null;
  const path = m ? (m[3] || '/') : url.pathname;
  return `${scheme}://${host}${path}${url.search}`;
}

async function probe(u) {
  const t0 = Date.now();
  try {
    const r = await withTimeout(fetch(u, { headers: { 'User-Agent': UA }, redirect: 'manual' }), 15000, 'probe');
    if (r.body) r.body.cancel();
    return { url: u, status: r.status, location: r.headers.get('location') || undefined, ms: Date.now() - t0 };
  } catch (e) {
    return { url: u, error: String(e.message || e), ms: Date.now() - t0 };
  }
}

async function status(request) {
  let runsIn = null;
  try { runsIn = ((await (await withTimeout(fetch('https://www.cloudflare.com/cdn-cgi/trace'), 8000, 'trace')).text()).match(/^colo=(\w+)/m) || [])[1] || null; } catch {}
  const probes = await Promise.all(PROBES.map(probe));
  const ok = probes.some((p) => p.status >= 200 && p.status < 400);
  return json({
    ok, requestEnteredAt: (request.cf && request.cf.colo) || '', runsIn, probes,
    hint: ok ? 'ews reachable from here' : `ews not reachable from ${runsIn} - enable Smart Placement (Settings > Runtime > Placement), then reload this page after a few minutes`,
    use: ['/stations.json', '/ews/index.php  (https://ews1.dwr.go.th)', '/h/<host>.dwr.go.th/<path>', '/http/<host>.dwr.go.th/<path>'],
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
  const headers = { 'User-Agent': UA, Accept: request.headers.get('accept') || '*/*', 'Accept-Language': 'th,en;q=0.8', Referer: `${new URL(target).origin}/` };
  const ct = request.headers.get('content-type');
  if (ct) headers['Content-Type'] = ct;
  const res = await withTimeout(fetch(target, {
    method: request.method, headers, body: isGet ? undefined : await request.arrayBuffer(), redirect: 'follow',
  }), TIMEOUT, 'upstream');
  if (res.url && !allowedHost(new URL(res.url).hostname)) {
    if (res.body) res.body.cancel();
    return json({ error: 'redirected outside dwr.go.th', target, final: res.url }, 502);
  }
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
const PROVINCE = 'นราธิวาส';
const STN_HOSTS = ['https://ews1.dwr.go.th', 'https://ews.dwr.go.th'];
const TTL_STATIONS = 600;           // สถานีส่งค่าทุก 15 นาที
const STALE_MAX = 6 * 3600;         // EWS ล่มชั่วคราว → ตอบชุดเก่าได้ไม่เกิน 6 ชม.
const num = (x) => (x == null || x === '' || x === 'N/A' || !isFinite(Number(x)) ? null : Number(x));
// "15/10/69 22:15 น." (พ.ศ. 2 หลัก · เวลาไทย) → ISO UTC
function ewsDate(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2500;
  if (y > 2400) y -= 543;
  return new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1]), Number(m[4]) - 7, Number(m[5]))).toISOString();
}
async function loadStationList() {
  let err;
  for (const host of STN_HOSTS) {
    try {
      const res = await withTimeout(fetch(`${host}/ews/web-service/stn`, {
        method: 'POST', body: 'action=LoadStation',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', Referer: `${host}/ews/` },
      }), 30000, host);
      if (!res.ok) throw new Error(`${host} ${res.status}`);
      const list = await res.json();
      if (!Array.isArray(list) || !list.length) throw new Error(`${host} gave no stations`);
      return { host, list };
    } catch (e) { err = e; }
  }
  throw err;
}
async function buildStations() {
  const { host, list } = await loadStationList();
  const stations = list
    .filter((s) => String(s.province || '').trim() === PROVINCE && String(s.stn_type || '').trim().toUpperCase() === 'WL')
    .map((s) => {
      const level = num(s.wl), avg = num(s.wl07h), st = Number(s.status);
      return {
        code: String(s.stn).trim(), name: String(s.name || '').replace(/\*+\s*$/, '').trim(),
        tambon: String(s.tambon || '').trim(), amphoe: String(s.amphoe || '').trim(), province: PROVINCE,
        dept: String(s.dept || '').trim(), lat: num(s.latitude), lon: num(s.longitude),
        level, dailyAvg: avg, rain15: num(s.rain), rain12h: num(s.rain12h),
        status: st >= 1 && st <= 3 ? st : 0, warnBy: [1, 2, 3].includes(st) ? (s.warn || null) : null,
        at: ewsDate(s.date),
        villages: (s.sub_station || []).map((v) => String(v.name || '').trim()).filter(Boolean),
      };
    })
    .filter((s) => s.lat != null && s.lon != null)
    .sort((a, b) => a.code.localeCompare(b.code));
  if (!stations.length) throw new Error('no stations for ' + PROVINCE);
  const dts = stations.map((x) => x.at).filter(Boolean).sort();
  return { updated: dts[dts.length - 1] || null, fetchedAt: new Date().toISOString(), source: `ews-proxy (${host.replace('https://', '')} web-service/stn)`, total: stations.length, stations };
}
async function stationsJson(ctx) {
  const cache = caches.default, key = new Request('https://ews-proxy.cache/stations.json');
  const hit = await cache.match(key);
  const age = hit ? (Date.now() - Number(hit.headers.get('x-stored') || 0)) / 1000 : Infinity;
  const send = (text, from) => new Response(text, { headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=120', 'x-cache': from } });
  if (hit && age < TTL_STATIONS) return send(await hit.text(), 'HIT');
  try {
    const text = JSON.stringify(await buildStations());
    ctx.waitUntil(cache.put(key, new Response(text, { headers: { 'x-stored': String(Date.now()), 'cache-control': `public, max-age=${STALE_MAX}` } })));
    return send(text, 'MISS');
  } catch (e) {
    if (hit && age < STALE_MAX) return send(await hit.text(), 'STALE');
    return json({ error: String(e.message || e) }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET' && request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/' && !url.search) return status(request);
    if (url.pathname === '/stations.json' && request.method === 'GET') return stationsJson(ctx);
    const target = upstreamUrl(url);
    if (!target) return json({ error: 'host not allowed (only *.dwr.go.th)' }, 403);
    try {
      return await forward(request, ctx, target);
    } catch (e) {
      return json({ error: String(e.message || e), target }, 502);
    }
  },
};
