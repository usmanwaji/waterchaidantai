/*
  DDPM CCTV proxy — Cloudflare Worker
  ------------------------------------------------------------------
  แก้ปัญหา CORS ของ API กล้อง ปภ. (https://cctv.disaster.go.th/api/v1)
  เพื่อให้เว็บ static (waterchaidantai / GitHub Pages) เรียก JSON ข้ามโดเมนได้
  (ตัวภาพ .jpg ไม่ติด CORS อยู่แล้ว แต่ให้ผ่าน proxy ด้วยเพื่อกันปัญหา hotlink)

  วิธี deploy (ฟรี ~5 นาที)
  1) เข้า https://dash.cloudflare.com  →  Workers & Pages  →  Create  →  Create Worker
  2) ตั้งชื่อ เช่น  ddpm-proxy  →  Deploy
  3) กด Edit code  →  ลบโค้ดตัวอย่าง  →  วางไฟล์นี้ทั้งหมด  →  Save and deploy
  4) จะได้ URL เช่น  https://ddpm-proxy.<ชื่อบัญชี>.workers.dev
  5) นำ URL นั้นไปใส่ในตัวแปร  DDPM_PROXY  ที่หัวไฟล์ map.js
     (หรือส่ง URL มาให้ผมใส่ให้ก็ได้)

  ถ้าถนัด CLI:  npm i -g wrangler  →  wrangler deploy  (main = ไฟล์นี้)

  ทดสอบว่าใช้ได้:  เปิด  https://<worker>/stations/PTN07  ต้องได้ JSON
  ------------------------------------------------------------------
*/

const UPSTREAM = 'https://cctv.disaster.go.th/api/v1';
const ALLOW_ORIGIN = '*';          // จะจำกัดเป็น 'https://waterchaidantai.com' ก็ได้เพื่อความปลอดภัย
const CACHE_SECONDS = 240;         // แคช 4 นาที (ฝั่ง ปภ. อัปเดตภาพ/ระดับน้ำทุก ~5 นาที)

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    if (request.method !== 'GET')     return new Response('Method Not Allowed', { status: 405, headers: cors() });

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '');   // เช่น 'stations/PTN07' หรือ 'snapshots/.../x.jpg'
    if (!path) return new Response('DDPM CCTV proxy OK', { headers: cors() });

    // proxy เฉพาะใต้ cctv.disaster.go.th/api/v1 เท่านั้น (กันเอาไปใช้ผิดวัตถุประสงค์)
    const target = `${UPSTREAM}/${path}${url.search}`;
    let upstream;
    try {
      upstream = await fetch(target, {
        headers: { 'Accept': request.headers.get('Accept') || '*/*' },
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
      });
    } catch (e) {
      return new Response('Upstream fetch failed', { status: 502, headers: cors() });
    }

    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors())) headers.set(k, v);
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
