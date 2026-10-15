/*
  ews-proxy.worker.js — Cloudflare Worker ส่งต่อคำขอไประบบเตือนภัยล่วงหน้า กรมทรัพยากรน้ำ (ews.dwr.go.th)
  ------------------------------------------------------------------
  ews.dwr.go.th ตัดการเชื่อมต่อจาก IP นอกไทยตั้งแต่ขั้น TLS handshake (เหมือน telerid / hyd-app)
  → ให้ Worker ที่รันศูนย์ BKK ดึงแทน (ต้องเปิด Smart Placement)
  สถานีระดับน้ำ EWS ในนราธิวาสที่หน้าแผนที่ยังไม่มี: STN2155 บ้านไอปาโจ (อ.สุคิริน) · STN2233 ชุมชนยะกัง (อ.เมือง)
  (ระบบโทรมาตร telemetry.dwr.go.th มีทะเบียน STN2155 แต่ไม่มีค่าวัด · ไม่มี STN2233 เลย → ค่าสดมีที่ EWS ที่เดียว)

  รุ่นนี้เป็นขั้นที่ 1: ส่งต่อคำขออย่างเดียว ไว้สำรวจว่า EWS เผยแพร่ระดับน้ำรายสถานีที่หน้าไหน/รูปแบบใด
  ขั้นถัดไปจะเพิ่ม /stations.json สรุปเฉพาะสถานีในนราธิวาสให้หน้าแผนที่ใช้

  path:
    /                         สถานะ: Worker รันศูนย์ไหน (runsIn) และเปิด ews.dwr.go.th / ews1.dwr.go.th
                              ทั้ง https และ http ได้หรือไม่ (ok: true = มีอย่างน้อยหนึ่งทางที่เปิดได้)
    /<path>?<query>           = https://ews.dwr.go.th/<path>?<query>   เช่น /ews/index.php
    /h/<host>/<path>          = https://<host>/<path>   host ต้องเป็นโดเมนย่อยของ dwr.go.th เท่านั้น
    /http/<host>/<path>       = http://<host>/<path>    (เผื่อหน้าเก่าที่เปิดได้แค่ http)
  รับ GET / POST (ส่ง body และ content-type ต่อให้) · GET ที่ได้ 200 แคชในศูนย์ Cloudflare 5 นาที
  จำกัดเฉพาะ *.dwr.go.th (redirect ไปโดเมนอื่นก็ไม่ตาม) → ไม่เป็น open proxy ให้คนอื่นใช้ดึงเว็บอื่น

  วิธี deploy: dash.cloudflare.com → Workers & Pages → Create → Create Worker (ไม่ใช่ Import a repository)
              → ชื่อ ews-proxy → Deploy → Edit code → วางไฟล์นี้ → Deploy
              ได้ URL https://ews-proxy.<บัญชี>.workers.dev
  สำคัญ: เปิด Smart Placement (Settings → Runtime → Placement → Smart) เหมือน hyd-proxy / telerid-proxy
         แล้วเปิดหน้าแรก https://ews-proxy.<บัญชี>.workers.dev/ ดูว่า ok เป็น true และ runsIn เป็น BKK
         (Smart Placement ต้องมีคำขอเข้ามาสักพักถึงจะย้ายไปรันใกล้ไทย · ถ้ายังไม่ได้ ลองเปิดซ้ำหลังผ่านไปหลายนาที)
  ------------------------------------------------------------------
*/
const DEFAULT_HOST = 'ews.dwr.go.th';
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
    use: ['/ews/index.php  (https://ews.dwr.go.th)', '/h/<host>.dwr.go.th/<path>', '/http/<host>.dwr.go.th/<path>'],
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

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET' && request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/' && !url.search) return status(request);
    const target = upstreamUrl(url);
    if (!target) return json({ error: 'host not allowed (only *.dwr.go.th)' }, 403);
    try {
      return await forward(request, ctx, target);
    } catch (e) {
      return json({ error: String(e.message || e), target }, 502);
    }
  },
};
