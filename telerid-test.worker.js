/*
  telerid-test.worker.js - Cloudflare Worker สำหรับทดสอบว่า Worker ดึงข้อมูล telerid.rid.go.th ได้ไหม
  (telerid บล็อก IP ต่างประเทศ · Worker รันที่ศูนย์ Cloudflare ใกล้คนเรียก เปิดจากเน็ตไทยมักได้ศูนย์ BKK)

  วิธีใช้: dash.cloudflare.com → Workers & Pages → Create → Create Worker → ชื่อ telerid-test → Deploy
          → Edit code → ลบโค้ดเดิม วางไฟล์นี้ → Deploy
          → เปิด https://telerid-test.<บัญชี>.workers.dev จากมือถือ/คอมที่ใช้เน็ตไทย แล้วส่งผลให้ Claude
  ทดสอบ 3 อย่าง: หน้าแรก telerid (เช็ก WAF) · REST station_list · WebSocket ข้อมูลสถานี BNR.02 (id 689)
*/
const BASE = 'https://telerid.rid.go.th';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timeout ' + ms + 'ms')), ms))]);

async function tryHttp(path) {
  const t0 = Date.now();
  try {
    const r = await withTimeout(fetch(BASE + path, { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'manual' }), 15000, 'http');
    const body = await r.text();
    return { ok: r.ok, status: r.status, ms: Date.now() - t0, contentType: r.headers.get('content-type'),
      server: r.headers.get('server'), setCookie: !!r.headers.get('set-cookie'), bytes: body.length, start: body.slice(0, 160) };
  } catch (e) { return { ok: false, error: String(e && e.message || e), ms: Date.now() - t0 }; }
}

async function tryWs(id) {
  const t0 = Date.now();
  try {
    const r = await withTimeout(fetch(BASE + '/ws/station/' + id + '/', { headers: { Upgrade: 'websocket', 'User-Agent': UA, Origin: BASE } }), 15000, 'ws connect');
    const ws = r.webSocket;
    if (!ws) return { ok: false, status: r.status, ms: Date.now() - t0, note: 'no websocket upgrade', start: (await r.text()).slice(0, 160) };
    ws.accept();
    const msg = await withTimeout(new Promise((res, rej) => {
      ws.addEventListener('message', (e) => res(e.data));
      ws.addEventListener('error', () => rej(new Error('ws error')));
      ws.addEventListener('close', (e) => rej(new Error('ws closed ' + e.code)));
    }), 15000, 'ws message');
    try { ws.close(); } catch {}
    let level = null;
    try { level = JSON.parse(JSON.parse(msg).message).values.water_level; } catch {}
    return { ok: true, ms: Date.now() - t0, waterLevel: level, bytes: String(msg).length };
  } catch (e) { return { ok: false, error: String(e && e.message || e), ms: Date.now() - t0 }; }
}

export default {
  async fetch(request) {
    const cf = request.cf || {};
    const [home, list, ws] = await Promise.all([tryHttp('/'), tryHttp('/restapi/main/station_list/'), tryWs(689)]);
    const verdict = list.ok && ws.ok ? 'WORKS - Worker can read telerid from ' + cf.colo
      : 'BLOCKED or partial - see details';
    return new Response(JSON.stringify({ verdict, ranAt: { colo: cf.colo, country: cf.country, city: cf.city },
      time: new Date().toISOString(), home, stationList: list, websocketBNR02: ws }, null, 2),
      { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
  }
};
