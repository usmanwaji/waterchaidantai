/*
  ONWR radar proxy — Cloudflare Worker
  ------------------------------------------------------------------
  แก้ปัญหา CORS ของ API หน้าเรดาร์ สทนช. (https://wam.onwr.go.th/radar)
  เพื่อให้ map.html แสดง 4 ชั้นข้อมูลนี้ได้:
    • เรดาร์ฝนคอมโพสิต TMD (ย้อนหลัง 1 ชม. + คาดการณ์ 3 ชม.)
    • ประมาณการฝนสะสม 3 ชม. ล่วงหน้า รายอำเภอ/ตำบล
    • ฝนสถานีรายชั่วโมง (จุด / Heat)
    • สถานีเรดาร์ (ข้อมูลนิ่ง อยู่ใน map.js ไม่ผ่าน proxy)

  ภาพ PNG (เฟรมเรดาร์ / heat) โหลดตรงจาก wam.onwr.go.th ได้อยู่แล้ว (img ไม่ติด CORS)
  proxy นี้จึงส่งเฉพาะ JSON และ "กรองให้เหลือแค่จังหวัดนราธิวาส" ก่อนส่งกลับ
  เพราะไฟล์ต้นทางใหญ่มาก (rain_stations ~1 MB · zones ตำบล ~8.7 MB)
  → กรองด้วยการค้นข้อความ ไม่ JSON.parse ทั้งก้อน เพื่อให้อยู่ใน CPU limit ของ Worker แผนฟรี
  → ผลลัพธ์ที่กรองแล้วเก็บใน Cache API 5 นาที (เรดาร์ออกภาพทุก 15 นาที)

  วิธี deploy (เหมือน ddpm-proxy / tmd-proxy ~5 นาที)
  1) dash.cloudflare.com → Workers & Pages → Create → Create Worker
  2) ตั้งชื่อ:  onwr-proxy   → Deploy → Edit code → วางไฟล์นี้ทั้งหมด → Save and deploy
  3) ได้ URL https://onwr-proxy.<บัญชี>.workers.dev
     (map.js ตั้งค่าไว้ที่ https://onwr-proxy.newusmanwaji.workers.dev แล้ว —
      ถ้าตั้งชื่อ worker ว่า onwr-proxy จะทำงานทันที ไม่ต้องแก้อะไร)

  ทดสอบ:  https://<worker>/frames
          https://<worker>/rain_stations
          https://<worker>/zones?level=district   (หรือ level=subdistrict)
  ------------------------------------------------------------------
*/

const UPSTREAM = 'https://wam.onwr.go.th';
const ALLOW_ORIGIN = '*';
const PROV_PCODE = 'TH96';          // รหัสจังหวัดนราธิวาสของ สทนช.
const PROV_NAME = 'นราธิวาส';
const TTL = { frames: 60, rain_stations: 300, zones: 300 };   // วินาที

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    if (request.method !== 'GET')     return new Response('Method Not Allowed', { status: 405, headers: cors() });

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!path) return new Response('ONWR proxy OK — ใช้ /frames, /rain_stations, /zones?level=district|subdistrict', { headers: cors() });

    let route;
    if (path === 'frames')             route = { key: 'frames', target: `${UPSTREAM}/api/frames`, filter: null };
    else if (path === 'rain_stations') route = { key: 'rain_stations', target: `${UPSTREAM}/api/rain_stations`, filter: filterRainStations };
    else if (path === 'zones') {
      const level = url.searchParams.get('level');
      if (level !== 'district' && level !== 'subdistrict')
        return new Response('level must be district or subdistrict', { status: 400, headers: cors() });
      route = { key: 'zones', target: `${UPSTREAM}/api/zones?level=${level}`, filter: filterZones };
    }
    else return new Response('Unknown route', { status: 404, headers: cors() });

    // ผลที่กรองแล้วอยู่ใน cache ของ Worker เอง → คำขอส่วนใหญ่ไม่ต้องแตะไฟล์ใหญ่ต้นทางเลย
    const cache = caches.default;
    const cacheKey = new Request(`${url.origin}/${route.key}${url.search}`, { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    let upstream;
    try {
      upstream = await fetch(route.target, {
        signal: AbortSignal.timeout(25000),
        headers: { 'Accept': 'application/json' },
        cf: { cacheTtl: TTL[route.key], cacheEverything: true }
      });
    } catch (e) {
      return new Response('Upstream fetch failed', { status: 502, headers: cors() });
    }
    if (!upstream.ok) return new Response(`Upstream ${upstream.status}`, { status: 502, headers: cors() });

    let body;
    try {
      const text = await upstream.text();
      body = route.filter ? route.filter(text) : text;
    } catch (e) {
      return new Response('Filter failed: ' + (e && e.message), { status: 500, headers: cors() });
    }

    const res = new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${TTL[route.key]}`,
        ...cors()
      }
    });
    if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  }
};

/* ---------- rain_stations: เหลือเฉพาะสถานีที่ช่อง prov ลงท้ายด้วย "นราธิวาส" ----------
   รูปแบบต้นทาง  {...header..., "stations":[[id,lat,lon,"name","agency","ต.x · อ.y · จังหวัด",mm,src,"obs",[hist],mm12,mm24], ...]}
   header (hours / windows / breaks สี ฯลฯ) คงไว้ทั้งหมด เพราะฝั่งเว็บใช้ระบายสีจุดและทำ legend */
export function filterRainStations(text) {
  const anchor = '"stations":[';
  const si = text.indexOf(anchor);
  if (si < 0) throw new Error('no stations array');
  const rowRe = /\[\d+,[^\[\]]*?นราธิวาส[^\[\]]*?\[[^\]]*\],[^\]]*\]/g;
  const rows = [];
  for (const m of text.slice(si + anchor.length).match(rowRe) || []) {
    let row;
    try { row = JSON.parse(m); } catch (e) { continue; }
    // ต้องเป็น "จังหวัด" นราธิวาสจริง ๆ ไม่ใช่แค่ชื่อสถานีมีคำว่านราธิวาส (เช่น ถนนนราธิวาสฯ กทม.)
    const prov = String(row[5] || '').split('·').pop().trim();
    if (prov === PROV_NAME) rows.push(m);
  }
  return text.slice(0, si + anchor.length) + rows.join(',') + '],"filtered":"' + PROV_NAME + '"}';
}

/* ---------- zones: เหลือเฉพาะโซนที่ pcode ขึ้นต้นด้วย TH96 ----------
   รูปแบบต้นทาง  {"generated":..,"level":"district",
                  "zones":[{"pcode":"TH1001",...},...],
                  "frames":[{"time":..,"offset_min":..,"kind":"past","zones":[{"pcode":..,"max_mm_hr":..,"max_dbz":..},...]},...],
                  "accum":{"window_min":180,...,"zones":[{"pcode":..,"max_mm":..,"mean_mm":..,"covered_px":..,"total_px":..,"hist":[..]},...],"breaks_mm":[..],"breaks_rgb":[..],...}}
   ลำดับ key คงที่จาก backend (Python) จึงใช้ indexOf หา section ได้ · ใน section ใช้ regex เก็บ object ของ TH96 */
export function filterZones(text) {
  const zi = text.indexOf('"zones":[');
  const fi = text.indexOf('"frames":[');
  const ai = text.indexOf('"accum":');
  if (zi < 0 || fi < 0 || ai < 0 || !(zi < fi && fi < ai)) throw new Error('unexpected zones layout');
  const provRe = new RegExp('\\{"pcode":"' + PROV_PCODE + '\\d*"[^{}]*\\}', 'g');

  const head = text.slice(0, zi);                                   // {"generated":..,"level":"..",
  const zones = text.slice(zi, fi).match(provRe) || [];

  // แต่ละเฟรม: header 3 ค่า + เฉพาะโซน TH96 · เดินด้วย indexOf ทีละเฟรม (16 เฟรม) ไม่ split ก้อน 7 MB
  const frames = [];
  const FR = '{"time":';
  let p = text.indexOf(FR, fi);
  while (p >= 0 && p < ai) {
    let q = text.indexOf(FR, p + FR.length);
    if (q < 0 || q > ai) q = ai;
    const chunk = text.slice(p, q);
    const h = chunk.match(/^\{"time":(\d+),"offset_min":(-?\d+),"kind":"(\w+)"/);
    if (h) frames.push(`{"time":${h[1]},"offset_min":${h[2]},"kind":"${h[3]}","zones":[${(chunk.match(provRe) || []).join(',')}]}`);
    p = q === ai ? -1 : q;
  }

  // accum: ส่วนหัวก่อน zones + โซน TH96 + ส่วนท้ายหลัง zones (breaks_mm/breaks_rgb/low_coverage_frac/min_px)
  const acc = text.slice(ai);
  const azi = acc.indexOf('"zones":[');
  if (azi < 0) return head + '"zones":[' + zones.join(',') + '],"frames":[' + frames.join(',') + '],' + acc;   // ไม่มีสถิติ (ยังไม่มี nowcast)
  const accHead = acc.slice(acc.indexOf('{') + 1, azi);              // "window_min":180,...,
  // element ของ zones ลงท้ายด้วย "hist":[..]} → ภายใน array ไม่มี "}]" จึงใช้หาตำแหน่งปิด array ได้เลย
  const close = acc.indexOf('}]', azi);
  if (close < 0) throw new Error('accum zones not closed');
  const accZones = acc.slice(azi, close + 1).match(provRe) || [];
  let accTail = acc.slice(close + 2);                               // ,"breaks_mm":[...],...}}  หรือ  }}
  accTail = accTail.replace(/\}\s*\}\s*$/, '}');                    // ตัด } ปิด document ออก เหลือ } ปิด accum

  return head + '"zones":[' + zones.join(',') + '],"frames":[' + frames.join(',') + '],' +
         '"accum":{' + accHead + '"zones":[' + accZones.join(',') + ']' + accTail +
         ',"filtered":"' + PROV_PCODE + '"}';
}

function cors() {
  return {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type'
  };
}
