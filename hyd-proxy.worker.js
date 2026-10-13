/*
  hyd-proxy.worker.js — Cloudflare Worker ส่งต่อคำขอไประบบอุทกวิทยา กรมชลประทาน (hyd-app.rid.go.th)
  ------------------------------------------------------------------
  hyd-app.rid.go.th ตัดการเชื่อมต่อจาก IP นอกไทย (เหมือน telerid) → ให้ Worker ที่รันศูนย์ BKK ดึงแทน
  ตอนนี้เป็นตัวส่งต่อแบบตรงๆ ไว้ใช้สำรวจว่าหน้า hydro8h.html ดึงข้อมูลจาก API ไหน
  เมื่อรู้รูปแบบข้อมูลแล้วจะเพิ่ม path สรุปสถานีนราธิวาส (เช่น /stations.json) ให้หน้าแผนที่ใช้

  path:
    /                               สถานะ: Worker รันศูนย์ไหน (runsIn) และดึง hyd-app ได้หรือไม่
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
  ------------------------------------------------------------------
*/
const DEFAULT_HOST = 'hyd-app.rid.go.th';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const TTL = 300;          // แคช GET 5 นาที
const TIMEOUT = 25000;

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
    use: ['/hydro8h.html', '/<path>?<query>  (hyd-app.rid.go.th)', '/h/<host>.rid.go.th/<path>'],
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

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET' && request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/' && !url.search) return status(request);
    const target = upstreamUrl(url);
    if (!target) return json({ error: 'host not allowed (only *.rid.go.th)' }, 403);
    try {
      return await forward(request, ctx, target);
    } catch (e) {
      return json({ error: String(e.message || e), target }, 502);
    }
  },
};
