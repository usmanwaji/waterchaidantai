/*
  telerid-proxy.worker.js — Cloudflare Worker ดึงโทรมาตร ชป. (telerid.rid.go.th) ของนราธิวาส แทนคอมในไทย
  ------------------------------------------------------------------
  ทดสอบแล้ว (telerid-test.worker.js): Worker ที่รันศูนย์ BKK อ่าน REST + WebSocket ของ telerid ได้
  (telerid อยู่หลัง Cloudflare เหมือนกัน) · คนดูในไทยเรียก Worker → รันที่ BKK → ดึงได้
  คนดูจากศูนย์อื่นที่ถูกบล็อก → Worker ตอบ 502 → หน้าเว็บใช้ข้อมูลจากคอม (สาขา cam) แทนอัตโนมัติ

  ให้ path แบบเดียวกับสาขา cam ที่ telerid-scraper ส่งขึ้น (หน้าเว็บสลับแหล่งได้ทันที):
    /stations.json          ระดับน้ำทุกสถานีในนราธิวาส (แคช 2 นาที)
    /{CODE}.detail.json     กราฟระดับน้ำ/ฝน 48 ชม. + ภาพตัดลำน้ำ (แคช 5 นาที)
    /{CODE}.jpg             ภาพกล้องล่าสุด (แคช 5 นาที)
  แคชอยู่ในศูนย์ Cloudflare แต่ละแห่ง → คนดูกี่คนก็ตาม telerid โดนเรียกราว 1 รอบ / 2 นาที เท่ากับตอนใช้คอม

  แชร์ข้อมูลข้ามศูนย์ (Workers KV · ผูกชื่อ TELERID_KV ใน Settings → Bindings):
    ศูนย์ที่ดึง telerid ได้ (BKK) เก็บชุดล่าสุดลง KV: สถานี + กราฟทุกสถานี (key "bundle") + ภาพกล้อง (key "img:CODE")
    ศูนย์ที่ดึงไม่ได้ (HKG/SIN …) จำไว้ 10 นาทีว่าดึงไม่ได้ แล้วอ่านจาก KV ทันที (ไม่ต้องรอ telerid หมดเวลา)
    เขียนเฉพาะเมื่อมีค่าใหม่หรือทุก 15 นาที · ภาพละไม่เกิน 1 ครั้ง / 30 นาที → ไม่เกินราว 700 ครั้ง/วัน (ฟรี 1,000)
    Cron (Settings → Triggers → Cron Triggers: ทุก 5 นาที) ให้ลองดึงเองทุก 5 นาที เผื่อไม่มีใครเปิดเว็บผ่าน BKK

  วิธี deploy: dash.cloudflare.com → Workers & Pages → Create → Create Worker (ไม่ใช่ Import a repository)
              → ชื่อ telerid-proxy → Deploy → Edit code → วางไฟล์นี้ → Deploy
              ได้ URL https://telerid-proxy.<บัญชี>.workers.dev (map.js / index.html ตั้งไว้ที่บัญชี newusmanwaji)
  ทดสอบ: เปิด https://telerid-proxy.<บัญชี>.workers.dev/stations.json จากเน็ตไทย
  สำคัญ: ต้องเปิด Smart Placement (Settings → Runtime → Placement → Smart) ให้ Worker ย้ายไปรันใกล้ telerid (ไทย)
         ไม่งั้นคนที่เน็ตวิ่งผ่านศูนย์ฮ่องกง/สิงคโปร์ จะได้ 522 (telerid ไม่รับการเชื่อมต่อจากนอกไทย)
         เช็กว่ารันที่ไหน: เปิดหน้าแรก https://telerid-proxy.<บัญชี>.workers.dev/ ดูค่า runsIn
  ------------------------------------------------------------------
*/
const BASE = 'https://telerid.rid.go.th';
const PROVINCE = 'นราธิวาส';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const TTL_LIST = 6 * 3600;     // รายชื่อสถานี (แทบไม่เปลี่ยน)
const TTL_STATIONS = 120;      // ระดับน้ำทุกสถานี
const TTL_DETAIL = 300;        // กราฟ/ภาพตัด
const TTL_IMAGE = 300;         // ภาพกล้อง
const STALE_MAX = 6 * 3600;    // telerid ล่มชั่วคราว → ตอบชุดเก่าได้ไม่เกิน 6 ชม.
const N_POINTS = 192;          // กราฟ ~48 ชม. (15 นาที/จุด) เท่ากับ scraper
const DOWN_TTL = 600;          // ศูนย์นี้ดึง telerid ไม่ได้ → ใช้ KV ไป 10 นาทีโดยไม่ลองใหม่
const SHARE_EVERY = 15 * 60e3; // เขียนชุดเดิมซ้ำลง KV ได้ไม่ถี่กว่านี้
const IMG_EVERY = 30 * 60e3;   // ภาพกล้องต่อสถานี เขียนลง KV ได้ไม่ถี่กว่านี้
const IMG_MAX = 10;            // ภาพต่อรอบ (35 WebSocket + 10 ภาพ + รายชื่อ < 50 การเรียกของแพ็กเกจฟรี)

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS' };
const json = (obj, status = 200, maxAge = 60) => new Response(JSON.stringify(obj), {
  status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${maxAge}` } });
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timeout')), ms))]);
const cacheKey = (name) => new Request('https://telerid-proxy.cache/' + encodeURIComponent(name));

/* แคชในศูนย์ Cloudflare: เก็บพร้อมเวลาเก็บ (x-stored) เพื่อเช็กความสดเอง และใช้ชุดเก่าได้ตอน telerid ล่ม */
async function cached(ctx, name, ttl, build) {
  const cache = caches.default;
  const hit = await cache.match(cacheKey(name));
  const age = hit ? (Date.now() - Number(hit.headers.get('x-stored') || 0)) / 1000 : Infinity;
  if (hit && age < ttl) return hit;
  try {
    const fresh = await build();   // Response
    if (fresh.ok) {
      const body = await fresh.arrayBuffer();
      const headers = new Headers(fresh.headers);
      headers.set('x-stored', String(Date.now()));
      headers.set('cache-control', `public, max-age=${STALE_MAX}`);   // ให้แคชเก็บไว้นานพอใช้เป็นชุดสำรอง
      ctx.waitUntil(cache.put(cacheKey(name), new Response(body, { headers })));
      const out = new Headers(fresh.headers);
      return new Response(body, { status: 200, headers: out });
    }
    if (hit && age < STALE_MAX) return hit;
    return fresh;
  } catch (e) {
    if (hit && age < STALE_MAX) return hit;
    throw e;
  }
}

/* รายชื่อสถานีของจังหวัด (REST สาธารณะ) */
/* ศูนย์นี้ดึง telerid ไม่ได้ (เช่น 522 จากฮ่องกง) → จำไว้ DOWN_TTL วินาที */
async function isDown() {
  const h = await caches.default.match(cacheKey('down'));
  return !!h && (Date.now() - Number(h.headers.get('x-stored') || 0)) / 1000 < DOWN_TTL;
}
function markDown(ctx) {
  ctx.waitUntil(caches.default.put(cacheKey('down'), new Response('1', { headers: { 'cache-control': `public, max-age=${DOWN_TTL}`, 'x-stored': String(Date.now()) } })));
}
/* ชุดที่แชร์ไว้ใน KV (ไม่เกิน STALE_MAX) */
async function sharedBundle(env) {
  const kv = env && env.TELERID_KV;
  if (!kv) return null;
  const b = await kv.get('bundle', { type: 'json', cacheTtl: 60 });
  return b && Date.now() - b.storedAt < STALE_MAX * 1000 ? b : null;
}

async function stationList(ctx) {
  const r = await cached(ctx, 'list', TTL_LIST, async () => {
    const res = await withTimeout(fetch(BASE + '/restapi/main/station_list/', { headers: { 'User-Agent': UA, Accept: 'application/json' } }), 12000, 'station_list');
    if (!res.ok) return new Response('station_list ' + res.status, { status: 502 });
    const j = await res.json();
    const rows = (j.results || j || []).filter((s) => String(s.province_name || '').includes(PROVINCE)).map((s) => ({
      id: s.id, code: s.code, name: s.name, basin: s.basin_name || '', amphur: s.amphur_name || '', province: s.province_name || '',
      lat: s.geom && s.geom.coordinates ? s.geom.coordinates[1] : null,
      lon: s.geom && s.geom.coordinates ? s.geom.coordinates[0] : null,
    }));
    if (!rows.length) return new Response('no stations', { status: 502 });
    return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/* ข้อความแรกจาก WebSocket ของสถานี = ข้อมูลเต็ม (ระดับน้ำ, กราฟ, กล้อง, ภาพตัด) */
async function stationWs(id) {
  const res = await withTimeout(fetch(BASE + '/ws/station/' + id + '/', { headers: { Upgrade: 'websocket', 'User-Agent': UA, Origin: BASE } }), 15000, 'ws connect');
  const ws = res.webSocket;
  if (!ws) throw new Error('no websocket (' + res.status + ')');
  ws.accept();
  try {
    const data = await withTimeout(new Promise((resolve, reject) => {
      ws.addEventListener('message', (e) => resolve(e.data));
      ws.addEventListener('error', () => reject(new Error('ws error')));
      ws.addEventListener('close', () => reject(new Error('ws closed')));
    }), 15000, 'ws message');
    return JSON.parse(JSON.parse(data).message);
  } finally { try { ws.close(); } catch {} }
}

const iso = (unix) => (unix ? new Date(unix * 1000).toISOString() : null);
function summarize(s, st) {
  const v = (st && st.values) || {};
  const cams = v.cctv ? Object.values(v.cctv) : [];
  const cam = cams[0] || null;
  const level = v.water_level && v.water_level.value != null ? v.water_level.value : null;
  const levelUnix = v.water_level ? v.water_level.unixtime : null;
  const critical = st ? st.water_level_critical ?? null : null;
  const wlg = v.water_level_graph ? Object.values(v.water_level_graph)[0] : null;
  return {
    code: s.code, name: s.name, basin: s.basin, amphur: s.amphur, province: s.province, lat: s.lat, lon: s.lon,
    level, bank: critical, warning: st ? st.water_level_warning ?? null : null, critical,
    hasImage: !!(cam && cam.path), hasDetail: !!((wlg && Array.isArray(wlg.value) && wlg.value.length) || (Array.isArray(st && st.cross_section) && st.cross_section[0])),
    cams: cams.length, levelDt: iso(levelUnix),
    dt: cam && cam.unixtime ? iso(cam.unixtime) : iso(levelUnix),
    _cam: cam ? { path: String(cam.path || ''), unixtime: cam.unixtime || null } : null,
  };
}
function detail(s, st) {
  const v = st.values || {};
  const r2 = (x, k) => (x == null ? null : Math.round(x * k) / k);
  const wlg = v.water_level_graph ? Object.values(v.water_level_graph)[0] : null;
  const rg = v.rain_graph;
  const cs = Array.isArray(st.cross_section) ? st.cross_section[0] : null;
  return {
    code: s.code, name: s.name,
    level: v.water_level && v.water_level.value != null ? v.water_level.value : null,
    levelUnix: v.water_level ? v.water_level.unixtime : null,
    warning: st.water_level_warning ?? null, critical: st.water_level_critical ?? null,
    wl: wlg && Array.isArray(wlg.value) && Array.isArray(wlg.time) ? { t: wlg.time.slice(-N_POINTS), v: wlg.value.slice(-N_POINTS).map((x) => r2(x, 100)) } : null,
    rain: rg && Array.isArray(rg.value) && Array.isArray(rg.time) ? { t: rg.time.slice(-N_POINTS), v: rg.value.slice(-N_POINTS).map((x) => r2(x, 10)) } : null,
    cross: cs && Array.isArray(cs.distance) && Array.isArray(cs.high)
      ? { distance: cs.distance, high: cs.high, ground: cs.ground ?? null, warning: cs.warning ?? null, critical: cs.critical ?? null, zerogate: cs.zerogate ?? null } : null,
    updated: new Date().toISOString(),
  };
}

/* ระดับน้ำทุกสถานี (WebSocket พร้อมกัน · ฟรีแพลนจำกัด 50 การเรียกต่อครั้ง: 35 สถานี + รายชื่อ = พอ) */
async function buildStations(ctx, env, colo) {
  const list = await stationList(ctx);
  const results = await Promise.allSettled(list.map((s) => stationWs(s.id)));
  const stations = list.map((s, i) => summarize(s, results[i].status === 'fulfilled' ? results[i].value : null));
  const ok = stations.filter((x) => x.level != null || x.hasImage).length;
  if (!ok) return new Response('telerid gave no data', { status: 502 });   // ไม่ทับชุดดีด้วยชุดว่าง
  const camIndex = {};
  stations.forEach((x) => { if (x._cam) camIndex[x.code] = x._cam; delete x._cam; });
  ctx.waitUntil(caches.default.put(cacheKey('cams'), new Response(JSON.stringify(camIndex), {
    headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${STALE_MAX}`, 'x-stored': String(Date.now()) } })));
  const details = {};
  list.forEach((s, i) => { if (results[i].status === 'fulfilled' && stations[i].hasDetail) details[s.code] = detail(s, results[i].value); });
  const levelDts = stations.map((x) => x.levelDt).filter(Boolean).sort();
  const body = {
    // updated = เวลาวัดล่าสุดของสถานีที่ส่งค่า (เปลี่ยนเฉพาะเมื่อมีค่าใหม่ → หน้าเว็บไม่ต้องวาดใหม่ทุก 2 นาที)
    updated: levelDts.length ? levelDts[levelDts.length - 1] : new Date().toISOString(),
    fetchedAt: new Date().toISOString(), source: 'telerid-proxy',
    total: stations.length, withImage: stations.filter((x) => x.hasImage).length,
    withDetail: stations.filter((x) => x.hasDetail).length, stations,
  };
  ctx.waitUntil(share(env, body, details, camIndex, colo).catch(() => {}));
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8' } });
}

/* เก็บชุดล่าสุดลง KV ให้ศูนย์อื่นใช้ (เขียนเท่าที่จำเป็น ให้อยู่ในโควตาฟรี) */
async function share(env, body, details, camIndex, colo) {
  const kv = env && env.TELERID_KV;
  if (!kv) return;
  const now = Date.now();
  let meta = null;
  try { const r = await kv.getWithMetadata('bundle', { type: 'stream' }); meta = r.metadata; if (r.value) await r.value.cancel(); } catch {}
  if (meta && meta.u === body.updated && now - meta.t < SHARE_EVERY) return;   // ไม่มีค่าใหม่ และเพิ่งเขียนไป
  const img = (meta && meta.img) || {};
  let n = 0;
  for (const [code, cam] of Object.entries(camIndex)) {
    if (!cam.path || n >= IMG_MAX) continue;
    const prev = img[code];
    if (prev && (prev[0] === cam.unixtime || now - prev[1] < IMG_EVERY)) continue;
    n++;
    try {
      const res = await withTimeout(fetch(BASE + '/restapi/main/camera/' + cam.path.replace(/^\/+/, ''), { headers: { 'User-Agent': UA } }), 15000, 'camera');
      const ct = (res.headers.get('content-type') || '').split(';')[0];
      if (!res.ok || !/image/.test(ct)) continue;
      await kv.put('img:' + code, await res.arrayBuffer(), { metadata: { ct } });
      img[code] = [cam.unixtime, now];
    } catch {}
  }
  await kv.put('bundle', JSON.stringify({ storedAt: now, colo: colo || '', stations: body, details }), { metadata: { u: body.updated, t: now, img } });
}

async function stationsJson(ctx, env, colo) {
  if (!(await isDown())) {
    try {
      const r = await cached(ctx, 'stations', TTL_STATIONS, () => buildStations(ctx, env, colo));
      if (r.ok) return r;
    } catch {}
    markDown(ctx);
  }
  const b = await sharedBundle(env);
  if (!b) throw new Error('telerid not reachable from this location and no shared copy yet');
  return new Response(JSON.stringify({ ...b.stations, via: 'shared', sharedFrom: b.colo, sharedAt: new Date(b.storedAt).toISOString() }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } });
}

async function findStation(ctx, code) {
  const list = await stationList(ctx);
  return list.find((s) => s.code === code) || null;
}

async function detailJson(ctx, env, code) {
  if (!(await isDown())) {
    try {
      const s = await findStation(ctx, code);
      if (!s) return new Response('unknown station', { status: 404 });
      const r = await cached(ctx, 'detail:' + code, TTL_DETAIL, async () =>
        new Response(JSON.stringify(detail(s, await stationWs(s.id))), { headers: { 'content-type': 'application/json; charset=utf-8' } }));
      if (r.ok) return r;
    } catch {}
    markDown(ctx);
  }
  const b = await sharedBundle(env);
  const d = b && b.details && b.details[code];
  if (!d) return new Response('no detail', { status: 404 });
  return new Response(JSON.stringify(d), { headers: { 'content-type': 'application/json; charset=utf-8' } });
}

async function cameraJpg(ctx, env, code) {
  if (!(await isDown())) {
    try {
      const r = await cameraLive(ctx, code);
      if (r.ok || r.status === 404) return r;   // 404 = สถานีไม่มีกล้อง (ไม่ใช่ดึงไม่ได้)
    } catch {}
    markDown(ctx);
  }
  const kv = env && env.TELERID_KV;
  const got = kv ? await kv.getWithMetadata('img:' + code, { type: 'arrayBuffer', cacheTtl: 300 }) : null;
  if (!got || !got.value) return new Response('no image', { status: 404 });
  return new Response(got.value, { headers: { 'content-type': (got.metadata && got.metadata.ct) || 'image/jpeg' } });
}

async function cameraLive(ctx, code) {
  return cached(ctx, 'img:' + code, TTL_IMAGE, async () => {
    // path ภาพจากรอบ stations ล่าสุด · ไม่มีจึงถาม WebSocket ของสถานีนั้นเอง
    let cam = null;
    const idx = await caches.default.match(cacheKey('cams'));
    if (idx) cam = (await idx.json())[code] || null;
    if (!cam) {
      const s = await findStation(ctx, code);
      if (!s) return new Response('unknown station', { status: 404 });
      const st = await stationWs(s.id);
      const cams = st.values && st.values.cctv ? Object.values(st.values.cctv) : [];
      cam = cams[0] ? { path: String(cams[0].path || '') } : null;
    }
    if (!cam || !cam.path) return new Response('no camera', { status: 404 });
    const res = await withTimeout(fetch(BASE + '/restapi/main/camera/' + cam.path.replace(/^\/+/, ''), { headers: { 'User-Agent': UA } }), 20000, 'camera');
    const ct = (res.headers.get('content-type') || '').split(';')[0];
    if (!res.ok || !/image/.test(ct)) return new Response('camera ' + res.status, { status: 502 });
    return new Response(res.body, { headers: { 'content-type': ct } });
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: CORS });
    const path = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''));
    const colo = (request.cf && request.cf.colo) || '';   // ศูนย์ที่รับคำขอ (อาจไม่ใช่ที่โค้ดรัน ถ้าเปิด Smart Placement)
    try {
      let res;
      if (path === '') {
        // ศูนย์ที่โค้ดรันจริง (ขาออก) · ต้องเป็น BKK ถึงจะดึง telerid ได้
        let runsIn = null;
        try { runsIn = ((await (await withTimeout(fetch('https://www.cloudflare.com/cdn-cgi/trace'), 8000, 'trace')).text()).match(/^colo=(\w+)/m) || [])[1] || null; } catch {}
        const probe = await withTimeout(fetch(BASE + '/restapi/main/station_list/', { method: 'HEAD', headers: { 'User-Agent': UA } }), 15000, 'probe').then((r) => r.status, (e) => String(e.message || e));
        let shared = 'no KV binding (TELERID_KV)';
        if (env && env.TELERID_KV) {
          try {
            const r = await env.TELERID_KV.getWithMetadata('bundle', { type: 'stream' });
            if (r.value) await r.value.cancel();
            shared = r.metadata ? { storedAt: new Date(r.metadata.t).toISOString(), ageMin: Math.round((Date.now() - r.metadata.t) / 60000), newestReading: r.metadata.u, images: Object.keys(r.metadata.img || {}).length } : 'empty (waits for a run that can reach telerid)';
          } catch (e) { shared = 'KV error: ' + (e.message || e); }
        }
        return json({ ok: probe === 200, requestEnteredAt: colo, runsIn, teleridStatus: probe, shared,
          hint: probe === 200 ? 'telerid reachable from here' : 'telerid not reachable from ' + runsIn + ' - enable Smart Placement (Settings > Runtime > Placement)',
          use: ['/stations.json', '/{CODE}.detail.json', '/{CODE}.jpg'] }, 200, 0);
      }
      else if (path === 'stations.json') res = await stationsJson(ctx, env, colo);
      else if (path.endsWith('.detail.json')) res = await detailJson(ctx, env, path.slice(0, -'.detail.json'.length));
      else if (path.endsWith('.jpg')) res = await cameraJpg(ctx, env, path.slice(0, -'.jpg'.length));
      else return json({ error: 'not found' }, 404, 0);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
      headers.set('cache-control', res.ok ? 'public, max-age=60' : 'no-store');
      headers.set('x-colo', colo);
      headers.delete('x-stored');
      return new Response(res.body, { status: res.status, headers });
    } catch (e) {
      // ศูนย์นี้ดึง telerid ไม่ได้ (เช่น ถูกบล็อก) → หน้าเว็บจะไปใช้ข้อมูลจากคอม (สาขา cam) แทน
      return json({ error: String(e && e.message || e), colo, hint: 'see / for where this Worker runs' }, 502, 0);
    }
  },
  // Cron (ทุก 5 นาที): ลองดึงเอง ถ้ารอบนี้รันในศูนย์ที่ดึงได้ จะได้เก็บชุดใหม่ลง KV แม้ไม่มีคนเปิดเว็บ
  async scheduled(event, env, ctx) {
    ctx.waitUntil(stationsJson(ctx, env, 'cron').catch(() => {}));
  },
};
