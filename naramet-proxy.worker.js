/*
  naramet proxy — Cloudflare Worker
  ------------------------------------------------------------------
  ส่งต่อเว็บสถานีอุตุนิยมวิทยานราธิวาส (https://naramet.semet.uk) ทั้งโดเมนพร้อมเปิด CORS
  ให้การ์ด "ปริมาณฝนสะสม วันนี้ · เมื่อวาน" ใน index.html ดึงหน้า /rainfall มาแสดงแบบไม่มีเมนูได้

  เดิมหน้าแรกดึงตรงจาก naramet.pages.dev ซึ่งเปิด CORS * ไว้ แต่ต้นทางย้ายมา naramet.semet.uk
  (pages.dev ตอนนี้ 301 มาที่นี่) ซึ่งไม่เปิด CORS และไม่ยอมให้ฝังในกรอบ เบราว์เซอร์จึงดึงไม่ได้ ("Failed to fetch")
  หน้าแรกใส่ <base> ชี้มาที่ worker นี้ ไฟล์และข้อมูลที่หน้านั้นเรียกต่อ (สคริปต์ adm2.json API ฯลฯ) จึงผ่าน worker ด้วย
  ลิงก์แบบเต็ม https://naramet.semet.uk/... (และ naramet.pages.dev) ใน HTML/JS ถูกเปลี่ยนให้ชี้มาที่ worker เช่นกัน

  วิธี deploy (ฟรี ~5 นาที)
  1) เข้า https://dash.cloudflare.com  →  Workers & Pages  →  Create  →  Create Worker
  2) ตั้งชื่อ  naramet-proxy  →  Deploy
  3) กด Edit code  →  ลบโค้ดตัวอย่าง  →  วางไฟล์นี้ทั้งหมด  →  Save and deploy
  4) จะได้ URL  https://naramet-proxy.<ชื่อบัญชี>.workers.dev  (ตรงกับ NARAMET_PROXY ใน index.html แล้ว)

  ทดสอบว่าใช้ได้:  เปิด  https://<worker>/rainfall  ต้องเห็นหน้าปริมาณฝนสะสม
  ------------------------------------------------------------------
*/

const UPSTREAM = 'https://naramet.semet.uk';
const OLD_HOSTS = /https?:\/\/naramet\.(?:semet\.uk|pages\.dev)/g;   // ลิงก์แบบเต็มที่ต้องชี้มาที่ worker
const CACHE_SECONDS = 120;         // ฝนสะสมต้นทางอัปเดตเป็นรอบ ๆ แคชสั้น ๆ พอกันยิงต้นทางซ้ำ
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    if (!['GET', 'HEAD', 'POST'].includes(request.method)) return new Response('Method Not Allowed', { status: 405, headers: cors() });

    // ส่งต่อเฉพาะโดเมน naramet.semet.uk เท่านั้น (ทุก path)
    const url = new URL(request.url);
    const target = UPSTREAM + url.pathname + url.search;
    const get = request.method !== 'POST';
    const headers = { 'User-Agent': UA, 'Accept': request.headers.get('Accept') || '*/*', 'Referer': UPSTREAM + '/rainfall' };
    const lang = request.headers.get('Accept-Language'), type = request.headers.get('Content-Type');
    if (lang) headers['Accept-Language'] = lang;
    if (type) headers['Content-Type'] = type;

    let upstream;
    try {
      upstream = await fetch(target, {
        method: request.method, headers,
        body: get ? undefined : await request.arrayBuffer(),
        cf: get ? { cacheTtl: CACHE_SECONDS, cacheEverything: true } : undefined
      });
    } catch (e) {
      return new Response('Upstream fetch failed', { status: 502, headers: cors() });
    }

    const out = new Headers(upstream.headers);
    for (const h of ['set-cookie', 'x-frame-options', 'content-security-policy', 'content-length']) out.delete(h);
    for (const [k, v] of Object.entries(cors())) out.set(k, v);
    if (get) out.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);

    // HTML/JS: เปลี่ยนลิงก์แบบเต็มของต้นทางให้ชี้มาที่ worker (fetch ข้ามโดเมนจากกรอบจะติด CORS อีก)
    const ct = out.get('content-type') || '';
    if (request.method !== 'HEAD' && /text\/html|javascript/.test(ct)) {
      const text = (await upstream.text()).replace(OLD_HOSTS, url.origin);
      return new Response(text, { status: upstream.status, headers: out });
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type'
  };
}
