/* sw.js — Service Worker สำหรับ One Map ชายแดนใต้ (PWA + offline)
 * กลยุทธ์:
 *   • App shell (หน้า/สคริปต์/CSS ในโดเมนเดียวกัน) → stale-while-revalidate
 *   • การนำทาง (navigation) → network-first, ล้มเหลวใช้แคช, สุดท้าย index.html
 *   • ข้อมูล API (GET) → network-first แล้วเก็บชุดล่าสุดไว้ ใช้ตอนออฟไลน์ ("last good data")
 * เพิ่มเลขเวอร์ชันเมื่อแก้ไฟล์เพื่อบังคับอัปเดตแคช
 */
const VERSION = 'oms-hatyai-v3';
const SHELL = 'shell-' + VERSION;
const RUNTIME = 'runtime-' + VERSION;

const SHELL_ASSETS = [
  'index.html','map.html','map.js','forecast.html','history.html','repeat.html',
  'sim.html','shelter.html','route.html','resources.html','admin.html',
  'check.html','alert.html','eoc.html','people.html',
  'js/supabase-client.js','js/auth-ui.js','js/shelters_nwt.js','js/ddpm_risk_data.js','js/rivers.js','js/pwa.js',
  'manifest.json','icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // เก็บทีละไฟล์ ไม่ให้ install ล้มถ้าบางไฟล์โหลดไม่ได้
    await Promise.allSettled(SHELL_ASSETS.map(a => cache.add(a)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.endsWith(VERSION)).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

function isApiGet(url) {
  return /thaiwater\.net|open-meteo\.com|disaster\.go\.th|gistda\.or\.th|rid\.go\.th|supabase\.co/.test(url);
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // การนำทางหน้าเว็บ → network-first, fallback แคช/หน้าแรก
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const c = await caches.open(SHELL); c.put(req, net.clone());
        return net;
      } catch (e) {
        return (await caches.match(req)) || (await caches.match('index.html')) ||
               new Response('ออฟไลน์', {status:503, headers:{'Content-Type':'text/plain; charset=utf-8'}});
      }
    })());
    return;
  }

  // ข้อมูล API → network-first เก็บชุดล่าสุด
  if (isApiGet(url.href)) {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        if (net && net.ok) { const c = await caches.open(RUNTIME); c.put(req, net.clone()); }
        return net;
      } catch (e) {
        const cached = await caches.match(req);
        if (cached) return cached;
        return new Response(JSON.stringify({offline:true}), {status:503, headers:{'Content-Type':'application/json'}});
      }
    })());
    return;
  }

  // ทรัพยากรในโดเมนเดียวกัน (html/js/css) → stale-while-revalidate
  // คืนแคชทันทีเพื่อความเร็ว แต่ดึงเวอร์ชันใหม่มาอัปเดตแคชเบื้องหลังเสมอ → รอบหน้าจะได้ของใหม่
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await caches.match(req);
      const netFetch = fetch(req).then(net => { if (net && net.ok) cache.put(req, net.clone()); return net; }).catch(() => null);
      return cached || (await netFetch) || Response.error();
    })());
  }
});
