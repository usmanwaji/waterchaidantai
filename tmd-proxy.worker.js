/*
  TMD API proxy — Cloudflare Worker
  ------------------------------------------------------------------
  แก้ปัญหา CORS ของ API กรมอุตุนิยมวิทยา (https://data.tmd.go.th/api)
  เพื่อให้ index.html แสดง "พยากรณ์ทางการ 7 วันรายภาค" และ
  "ผลตรวจวัดจริงรายสถานี" ได้ (ทดสอบแล้ว 2026-07-19: ทั้งสองตอบเร็ว
  ส่วน WeatherForecast7Days รายจังหวัดแฮงค์ และ WeatherWarningNews
  ค้างที่ปี 2022 — ห้ามใช้)

  อีกเส้นทางคือ /riskmap = ฝนสะสมรายวันคาดการณ์ "รายอำเภอ" ของนราธิวาส
  จากแบบจำลอง NWP กรมอุตุฯ (https://hpc.tmd.go.th/riskmap-district)
  ต้นทางเป็นไฟล์ทั้งประเทศ 930 อำเภอ ~570 KB จึงกรองเหลือ 13 อำเภอนราธิวาส
  ในตัว worker ก่อนส่งกลับ (เหมือน onwr-proxy) — ใช้ regex จับทีละ object
  แทน JSON.parse ทั้งก้อน เพื่อให้อยู่ใน CPU limit ของแผนฟรี

  วิธี deploy (เหมือน ddpm-proxy เดิม ~5 นาที)
  1) dash.cloudflare.com → Workers & Pages → Create → Create Worker
  2) ตั้งชื่อ:  tmd-proxy   → Deploy → Edit code → วางไฟล์นี้ → Save and deploy
  3) ได้ URL https://tmd-proxy.<บัญชี>.workers.dev
     (index.html ตั้งค่าไว้ที่ https://tmd-proxy.newusmanwaji.workers.dev แล้ว —
      ถ้าตั้งชื่อ worker ว่า tmd-proxy จะทำงานทันที ไม่ต้องแก้อะไร)

  และ /riskmap-district = หน้าเว็บ "แผนที่เสี่ยงภัยรายอำเภอ" ของ hpc.tmd.go.th
  ที่เสิร์ฟผ่าน worker พร้อมล็อกตัวกรองไว้ที่นราธิวาส สำหรับฝัง iframe ใน forecast.html
  (ต้นทางกรองจาก URL ไม่ได้ และตัวกรองของต้นทางเองก็พังอยู่ — ดูหมายเหตุที่ฟังก์ชัน)
  หน้านี้เรียกไฟล์ /static/... ของต้นทางซึ่งไม่เปิด CORS จึงพร็อกซี /static/ กับ /api/ ให้ด้วย

  ทดสอบ:  https://<worker>/region7days   ·   https://<worker>/today   ·   https://<worker>/riskmap
          https://<worker>/riskmap-district
  ------------------------------------------------------------------
*/

const UPSTREAM = 'https://data.tmd.go.th/api';
const UID = 'api', UKEY = 'api12345';   // demo key สาธารณะจากเอกสาร TMD
const ALLOW_ORIGIN = '*';
const CACHE_SECONDS = 1800;             // 30 นาที (ภาคอัปเดตวันละครั้ง 11:00, ตรวจวัด 07:00)

// ฝนคาดการณ์รายอำเภอ (riskmap) — ต้นทางออกวันละ 2 รอบ (00Z/12Z) จึง cache ยาวกว่า
const RISKMAP_UPSTREAM = 'https://hpc.tmd.go.th/static/images/riskmap_json';
const RISKMAP_CACHE_SECONDS = 3600;
const PROV_PCODE = 'TH96';              // นราธิวาส
const PROV_NAME  = 'นราธิวาส';

// หน้าเว็บต้นทางของ riskmap-district (ใช้ทั้งตัวหน้าและไฟล์ static ที่หน้านั้นเรียก)
const HPC = 'https://hpc.tmd.go.th';
const HPC_PAGE_CACHE_SECONDS = 900;

// จำกัด endpoint ที่พิสูจน์แล้วว่าใช้งานได้เท่านั้น
const ROUTES = {
  region7days: `${UPSTREAM}/WeatherForecast7DaysByRegion/v1/?uid=${UID}&ukey=${UKEY}&format=json`,
  today:       `${UPSTREAM}/WeatherToday/V2/?uid=${UID}&ukey=${UKEY}&format=json`
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    if (request.method !== 'GET')     return new Response('Method Not Allowed', { status: 405, headers: cors() });

    const path = new URL(request.url).pathname.replace(/^\/+|\/+$/g, '');
    if (!path) return new Response('TMD proxy OK — ใช้ /region7days, /today หรือ /riskmap', { headers: cors() });
    if (path === 'riskmap') return riskmap(request, ctx);
    if (path === 'riskmap-district') return riskmapDistrict();
    if (path.startsWith('static/') || path.startsWith('api/')) return hpcAsset(path);
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

/* ---------- /riskmap : ฝนสะสมรายวันคาดการณ์รายอำเภอ (นราธิวาส) ---------- */
async function riskmap(request, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + '/riskmap', { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // ต้นทางออกวันละ 2 รอบ (00Z ก่อน แล้ว 12Z ตามมาช่วงเย็น) — ไล่จากรอบใหม่สุดที่มีจริง
  let text = null, run = '';
  for (const name of runCandidates()) {
    try {
      const r = await fetch(`${RISKMAP_UPSTREAM}/${name}`, {
        signal: AbortSignal.timeout(20000),
        cf: { cacheTtl: RISKMAP_CACHE_SECONDS, cacheEverything: true }
      });
      if (!r.ok) continue;
      text = await r.text();
      run = name;
      break;
    } catch (e) { /* ลองรอบถัดไป */ }
  }
  if (text == null) return new Response('Upstream fetch failed', { status: 502, headers: cors() });

  // แต่ละ record เป็น object แบนไม่มี object ซ้อน → จับทีละก้อนด้วย regex ถูกกว่า parse ทั้งไฟล์
  const districts = [];
  let days = [];
  for (const chunk of text.match(/\{[^{}]*\}/g) || []) {
    if (!chunk.includes(PROV_PCODE)) continue;
    let d;
    try { d = JSON.parse(chunk); } catch (e) { continue; }
    if (d.PCODE !== PROV_PCODE) continue;
    if (!days.length) days = Object.keys(d).filter(k => /^\d{2}:\d{2}Z /.test(k));
    districts.push({
      code: d.ACODE,
      name: d.aname_th,
      lat: d.lat,
      lng: d.lng,
      rain: days.map(k => Math.round(d[k] * 10) / 10)
    });
  }
  if (!districts.length) return new Response('No district rows for ' + PROV_PCODE, { status: 502, headers: cors() });

  const body = JSON.stringify({
    run,                                   // ชื่อไฟล์รอบที่ใช้ เช่น rain.20260909.0000.json
    days: days.map(k => k.replace(/^\d{2}:\d{2}Z /, '')),   // เช่น '09-Sep-2026'
    districts
  });
  const res = new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${RISKMAP_CACHE_SECONDS}`,
      ...cors()
    }
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/* ---------- /riskmap-district : หน้าแผนที่เสี่ยงภัยรายอำเภอ (ล็อกนราธิวาส) ----------
   ฝังหน้า https://hpc.tmd.go.th/riskmap-district ตรง ๆ ไม่ได้ตามที่ต้องการ เพราะ
   1) ต้นทางไม่มีพารามิเตอร์ใน URL ให้เลือกจังหวัด ต้องพิมพ์ในช่องค้นหาเอง
   2) ช่อง "รหัสจังหวัด" (#filter-province-code) ถูกคอมเมนต์ทิ้งไว้ใน HTML
      แต่ riskmap_district.js ยังอ่าน inputPCode.value ตอนกรอง จึงโยน TypeError
      ผลคือช่องค้นหาทั้งหมดของต้นทางใช้ไม่ได้เลย (ทดสอบแล้ว 2026-09-09 พิมพ์ชื่อ
      จังหวัดแล้วตารางไม่เปลี่ยน ยังขึ้น 928 อำเภอ)
   จึงดึง HTML มาแล้วแทรก (ก) ช่องรหัสจังหวัดที่หายไปกลับเข้าไปแบบซ่อน ซึ่งซ่อม
   ตัวกรองของต้นทางไปในตัว (ข) สคริปต์ตั้ง state.pName/pCode ให้กรองตั้งแต่เรนเดอร์
   รอบแรก และนับสรุป 4 ระดับใหม่ให้ตรงกับที่กรองแล้ว (ของเดิมนับทั้งประเทศ)
   (ค) CSS ซ่อนหัว/ท้ายเว็บ เพราะเมนูต้นทางพาผู้ใช้ออกไปจากหน้าเรา */
async function riskmapDistrict() {
  let html;
  try {
    const r = await fetch(HPC + '/riskmap-district', {
      signal: AbortSignal.timeout(20000),
      cf: { cacheTtl: HPC_PAGE_CACHE_SECONDS, cacheEverything: true }
    });
    if (!r.ok) return new Response('Upstream fetch failed', { status: 502, headers: cors() });
    html = await r.text();
  } catch (e) {
    return new Response('Upstream fetch failed', { status: 502, headers: cors() });
  }

  html = html.replace(
    '<input type="text" id="filter-province-name"',
    '<input type="hidden" id="filter-province-code" value="' + PROV_PCODE + '">\n        <input type="text" id="filter-province-name"'
  );
  html = html.replace('</body>', RD_INJECT + '</body>');

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=' + HPC_PAGE_CACHE_SECONDS,
      ...cors()
    }
  });
}

const RD_INJECT = `
<style>
  /* ฝังอยู่ในหน้าเราแล้ว หัวเว็บ/เมนู/ท้ายเว็บของต้นทางไม่ต้องใช้ */
  .nwp-header, .nwp-footer { display: none !important; }
  .main-content { padding-top: 10px !important; }
  #filter-province-name { background: #f3f5fc; cursor: not-allowed; }
</style>
<script>
(function () {
  var PNAME = '${PROV_NAME}', PCODE = '${PROV_PCODE}';

  /* ตั้งค่าลง state โดยตรง ไม่รอ event เพื่อให้การเรนเดอร์รอบแรกกรองแล้ว
     (state ประกาศด้วย const ในสคริปต์ระดับบนสุดของหน้า จึงอ่านได้จากที่นี่) */
  try { state.pName = PNAME; state.pCode = PCODE; } catch (e) {}

  /* ตัวเลขสรุป 4 ระดับของต้นทางนับทั้งประเทศ ต้องนับใหม่จากรายการที่กรองแล้ว */
  var IDS = ['count-critical', 'count-high', 'count-moderate', 'count-medium'];
  function recount() {
    var rows = [];
    try { rows = state.filteredDistricts || []; } catch (e) { return; }
    var c = [0, 0, 0, 0];
    rows.forEach(function (d) { if (d.risk_order >= 1 && d.risk_order <= 4) c[d.risk_order - 1]++; });
    IDS.forEach(function (id, i) {
      var el = document.getElementById(id);
      if (el) el.textContent = c[i];
    });
  }

  function init() {
    var p = document.getElementById('filter-province-name');
    if (p) { p.value = PNAME; p.readOnly = true; p.title = 'หน้านี้ล็อกไว้เฉพาะ ' + PNAME; }
    var tb = document.getElementById('district-table-tbody');
    if (tb) new MutationObserver(recount).observe(tb, { childList: true });
    recount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
<\/script>
`;

/* ---------- /static/... และ /api/... : พร็อกซีไฟล์ที่หน้า riskmap-district เรียก ----------
   หน้าเว็บอ้าง path แบบ /static/css/... /static/js/... /static/images/... ซึ่งจะวิ่งมาที่
   โดเมน worker ไม่ใช่ hpc.tmd.go.th จึงต้องส่งต่อให้ (ต้นทางไม่เปิด CORS ใช้ base href แทนไม่ได้) */
async function hpcAsset(path) {
  let upstream;
  try {
    upstream = await fetch(HPC + '/' + path, {
      signal: AbortSignal.timeout(20000),
      cf: { cacheTtl: HPC_PAGE_CACHE_SECONDS, cacheEverything: true }
    });
  } catch (e) {
    return new Response('Upstream fetch failed', { status: 502, headers: cors() });
  }
  const headers = new Headers(cors());
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=' + HPC_PAGE_CACHE_SECONDS);
  return new Response(upstream.body, { status: upstream.status, headers });
}

// ชื่อไฟล์รอบคาดการณ์ ไล่จากใหม่ไปเก่า (เวลาไทย = UTC+7)
function runCandidates() {
  const out = [];
  for (let back = 0; back < 2; back++) {
    const d = new Date(Date.now() + 7 * 3600e3 - back * 86400e3);
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    out.push(`rain.${ymd}.1200.json`, `rain.${ymd}.0000.json`);
  }
  return out;
}

function cors() {
  return {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type'
  };
}
