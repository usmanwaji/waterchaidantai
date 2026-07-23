/*
  TMD API proxy — Cloudflare Worker
  ------------------------------------------------------------------
  แก้ปัญหา CORS ของ API กรมอุตุนิยมวิทยา (https://data.tmd.go.th/api)
  เพื่อให้ index.html แสดง "พยากรณ์ทางการ 7 วันรายภาค" และ
  "ผลตรวจวัดจริงรายสถานี" ได้ (ทดสอบแล้ว 2026-07-19: ทั้งสองตอบเร็ว
  ส่วน WeatherForecast7Days รายจังหวัดแฮงค์ และ WeatherWarningNews
  ค้างที่ปี 2022 — ห้ามใช้)

  วิธี deploy (เหมือน ddpm-proxy เดิม ~5 นาที)
  1) dash.cloudflare.com → Workers & Pages → Create → Create Worker
  2) ตั้งชื่อ:  tmd-proxy   → Deploy → Edit code → วางไฟล์นี้ → Save and deploy
  3) ได้ URL https://tmd-proxy.<บัญชี>.workers.dev
     (index.html ตั้งค่าไว้ที่ https://tmd-proxy.newusmanwaji.workers.dev แล้ว —
      ถ้าตั้งชื่อ worker ว่า tmd-proxy จะทำงานทันที ไม่ต้องแก้อะไร)

  ทดสอบ:  https://<worker>/region7days   และ   https://<worker>/today
  ------------------------------------------------------------------
*/

const UPSTREAM = 'https://data.tmd.go.th/api';
const UID = 'api', UKEY = 'api12345';   // demo key สาธารณะจากเอกสาร TMD
const ALLOW_ORIGIN = '*';
const CACHE_SECONDS = 1800;             // 30 นาที (ภาคอัปเดตวันละครั้ง 11:00, ตรวจวัด 07:00)

// จำกัด endpoint ที่พิสูจน์แล้วว่าใช้งานได้เท่านั้น
const ROUTES = {
  region7days: `${UPSTREAM}/WeatherForecast7DaysByRegion/v1/?uid=${UID}&ukey=${UKEY}&format=json`,
  today:       `${UPSTREAM}/WeatherToday/V2/?uid=${UID}&ukey=${UKEY}&format=json`
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    if (request.method !== 'GET')     return new Response('Method Not Allowed', { status: 405, headers: cors() });

    const path = new URL(request.url).pathname.replace(/^\/+|\/+$/g, '');
    if (!path) return new Response('TMD proxy OK — ใช้ /region7days หรือ /today', { headers: cors() });
    const target = ROUTES[path];
    if (!target) return new Response('Unknown route', { status: 404, headers: cors() });

    let upstream;
    try {
      // TMD ช้าเป็นบางเวลา — ตัดที่ 20 วิ กันค้าง
      upstream = await fetch(target, {
        signal: AbortSignal.timeout(20000),
        headers: { 'Accept': 'application/json' },
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
      });
    } catch (e) {
      return new Response('Upstream fetch failed', { status: 502, headers: cors() });
    }

    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', ...cors() });
    headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
    return new Response(upstream.body, { status: upstream.status, headers });
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type'
  };
}
