/*
  telerid-scraper — ดึงภาพกล้อง + ระดับน้ำสถานีโทรมาตร กรมชลประทาน (telerid.rid.go.th)
  ของ 5 จังหวัดภาคใต้ตอนล่าง (สตูล สงขลา ปัตตานี ยะลา นราธิวาส) ด้วย Playwright (headless)

  ทำไมต้องใช้เบราว์เซอร์จริง: API ภาพ (station_image) ต้องมี Authorization token ที่ "แอปหน้าเว็บ"
  สร้างขึ้นตอนรัน + WAF ของ RID บล็อกการเรียกแบบ server ตรง ๆ → เราจึงให้ Playwright เปิดแอปจริง
  ดักจับ token ตอนแอปเริ่มโหลด แล้วยิงขอภาพจากใน page context (ผ่าน WAF ได้)

  ผลลัพธ์ (โฟลเดอร์ ./telerid-cam):
    - {CODE}.jpg           ภาพกล้องล่าสุดของแต่ละสถานี
    - stations.json        เมทาดาทา + ระดับน้ำ + พิกัด + สถานะภาพ (ให้ dashboard อ่าน)
    - _discovery.json      บันทึก request /restapi/main ที่แอปยิงจริง (ไว้ debug รอบแรก)

  ตัวแปรลับ (ถ้า anonymous ดึงไม่ได้ ค่อยใส่ — ไม่ใส่ก็ลองแบบ anonymous ก่อน):
    RID_USER, RID_PASS   (ใส่เป็น GitHub Secrets)  → สคริปต์จะล็อกอินผ่านฟอร์มให้
*/

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://telerid.rid.go.th';
const OUT = 'telerid-cam';
const PROVINCES = ['สงขลา'];
const RID_USER = process.env.RID_USER || '';
const RID_PASS = process.env.RID_PASS || '';

const log = (...a) => console.log('[telerid]', ...a);

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    viewport: { width: 1400, height: 900 },
  });
  const page = await ctx.newPage();

  // ---- ดักจับ Authorization token + บันทึก request ไว้ debug ----
  let authToken = '';
  const discovery = [];
  page.on('request', (req) => {
    const u = req.url();
    if (!/\/restapi\/main\//.test(u)) return;
    const h = req.headers();
    const a = h['authorization'] || h['Authorization'] || '';
    if (a && !authToken) { authToken = a; log('captured auth token, scheme=', a.split(' ')[0], 'len=', a.length); }
    if (discovery.length < 60) {
      let post = '';
      try { post = (req.postData() || '').slice(0, 120); } catch {}
      discovery.push({ url: u.split('/main/')[1], method: req.method(), hasAuth: !!a, post });
    }
  });

  log('opening app…');
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  // ให้แอปเริ่ม + ขอ token (แอปมักยิง get_basin_tree/summary ตอน init)
  await page.waitForTimeout(12000);

  // ---- ถ้ายังไม่ได้ token และมี credential → ลองล็อกอินผ่านฟอร์ม ----
  if (!authToken && RID_USER && RID_PASS) {
    log('no anonymous token; attempting UI login…');
    try {
      // best-effort: กดปุ่มเข้าสู่ระบบ แล้วกรอกฟอร์ม
      const loginBtn = page.locator('text=/เข้าสู่ระบบ|Login|Sign in/i').first();
      if (await loginBtn.count()) { await loginBtn.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1500); }
      const user = page.locator('input[type="text"], input[name*="user" i], input[placeholder*="ผู้ใช้"], input[placeholder*="user" i]').first();
      const pass = page.locator('input[type="password"]').first();
      await user.fill(RID_USER, { timeout: 5000 });
      await pass.fill(RID_PASS, { timeout: 5000 });
      await pass.press('Enter').catch(() => {});
      const submit = page.locator('button[type="submit"], text=/เข้าสู่ระบบ|Login|ตกลง/i').first();
      if (await submit.count()) await submit.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(6000);
      log('login attempted; token=', !!authToken);
    } catch (e) { log('login flow error:', String(e).slice(0, 120)); }
  }

  // ---- ดึงรายชื่อสถานีของ 5 จังหวัด (public) จากใน page context ----
  const stations = await page.evaluate(async (provs) => {
    const r = await fetch('/restapi/main/station_list/', { headers: { Accept: 'application/json' } });
    const j = await r.json();
    const rows = j.results || j || [];
    return rows
      .filter((s) => provs.some((p) => String(s.province_name || '').includes(p)))
      .map((s) => ({
        id: s.id, code: s.code, name: s.name,
        basin: s.basin_name || '', amphur: s.amphur_name || '',
        tambon: s.tambon_name || '', province: s.province_name || '',
        project: s.project_name || '',
        lat: s.geom && s.geom.coordinates ? s.geom.coordinates[1] : null,
        lon: s.geom && s.geom.coordinates ? s.geom.coordinates[0] : null,
      }));
  }, PROVINCES);
  log('stations in 5 provinces:', stations.length);

  // ---- ดึงภาพ + ระดับน้ำ ทีละสถานี (ทำใน page context เพื่อผ่าน WAF) ----
  const meta = [];
  let okImg = 0, okLevel = 0;
  for (const s of stations) {
    // ---- ระดับน้ำ+ฝน: อ่านจากแผงรายละเอียดที่แอปเรนเดอร์ (ค่ามาทาง WebSocket/สเตท ไม่ใช่ REST เปิด) ----
    // วิธี: ค้นชื่อสถานีในช่องค้นหา → คลิกรายการ → อ่านตัวเลขจากแผง (rain/level/เวลา)
    let dom = {};
    try {
      dom = await scrapeDetail(page, s);
      if (dom.level != null || dom.rain != null) okLevel++;
    } catch (e) { dom = { scrapeErr: String(e).slice(0, 80) }; }

    const res = await page.evaluate(async ({ s, token }) => {
      const out = { code: s.code };
      // ---- ภาพกล้อง (POST station_image + FormData + Authorization) ลองหลายชื่อฟิลด์ ----
      const fieldSets = [
        { station_id: s.id }, { id: s.id }, { station: s.id },
        { station_code: s.code }, { station_id: s.code },
      ];
      const b64 = (buf) => { const b = new Uint8Array(buf); let bin = ''; const c = 8192; for (let i = 0; i < b.length; i += c) bin += String.fromCharCode.apply(null, b.subarray(i, i + c)); return btoa(bin); };
      for (const f of fieldSets) {
        try {
          const fd = new FormData();
          for (const k in f) fd.append(k, f[k]);
          const r = await fetch('/restapi/main/station_image', {
            method: 'POST', body: fd, credentials: 'include',
            headers: token ? { Authorization: token } : {},
          });
          out.imgStatus = r.status;
          const ct = (r.headers.get('content-type') || '').split(';')[0];
          if (r.ok && /image/.test(ct)) {
            const buf = await r.arrayBuffer();
            if (buf.byteLength > 500) { out.imgB64 = b64(buf); out.imgField = Object.keys(f)[0]; break; }
          }
        } catch (e) { out.imgErr = String(e).slice(0, 80); }
      }
      return out;
    }, { s, token: authToken });

    if (res.imgB64) {
      await fs.writeFile(path.join(OUT, s.code + '.jpg'), Buffer.from(res.imgB64, 'base64'));
      okImg++;
    }
    meta.push({
      code: s.code, name: s.name, basin: s.basin, amphur: s.amphur, province: s.province,
      lat: s.lat, lon: s.lon,
      level: dom.level ?? null,   // ระดับน้ำปัจจุบัน (ม.รทก / MSL)
      rain: dom.rain ?? null,     // ปริมาณน้ำฝนสะสม (มม.)
      dt: dom.dt ?? null,         // เวลาที่ตรวจวัดล่าสุด
      hasImage: !!res.imgB64, imgStatus: res.imgStatus ?? null,
    });
    if (stations.indexOf(s) % 5 === 0) log(`… ${meta.length}/${stations.length} (images ${okImg}, levels ${okLevel})`);
  }

  await fs.writeFile(path.join(OUT, 'stations.json'), JSON.stringify({
    updated: new Date().toISOString(), tokenCaptured: !!authToken,
    total: meta.length, withImage: okImg, withLevel: okLevel, stations: meta,
  }, null, 2));
  await fs.writeFile(path.join(OUT, '_discovery.json'), JSON.stringify(discovery, null, 2));

  log(`DONE. stations=${meta.length} images=${okImg} levels=${okLevel} token=${!!authToken}`);
  if (okLevel === 0) log('⚠️ ไม่ได้ระดับน้ำเลย — เปิด telerid-cam/stations.json ดู แล้วส่งให้ผมปรับ (แอปอาจเปลี่ยนโครงสร้างหน้า)');
  await browser.close();
}

/* ---- read water level + rain from the app-rendered detail panel ----
   Live values arrive via WebSocket/app-state, so read them from the DOM (not an open REST API).
   Returns { level, rain, dt } — level in m MSL, rain in mm, dt like 'D/M/YYYY H:MM' */
async function scrapeDetail(page, s) {
  const searchTerm = s.name || s.code;
  const inp = page.locator('input').first();
  await inp.click({ timeout: 5000 }).catch(() => {});
  await inp.fill('');
  await inp.fill(searchTerm);
  await page.waitForTimeout(1400);
  const clicked = await page.evaluate((code) => {
    const nodes = [...document.querySelectorAll('*')].filter(
      (e) => e.children.length === 0 && e.textContent.trim() === code
    );
    if (!nodes.length) return false;
    let el = nodes[0];
    for (let k = 0; k < 5 && el; k++) { el.click(); el = el.parentElement; }
    return true;
  }, s.code);
  if (!clicked) { await inp.fill(''); return {}; }
  await page.waitForTimeout(2600);
  const out = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('div')].filter(
      (e) => /\u0e23\u0e30\u0e14\u0e31\u0e1a\u0e19\u0e49\u0e33\u0e1b\u0e31\u0e08\u0e08\u0e38\u0e1a\u0e31\u0e19/.test(e.textContent) && e.textContent.length < 1200
    );
    panels.sort((a, b) => a.textContent.length - b.textContent.length);
    if (!panels.length) return {};
    const d = panels[0].innerText;
    const rain = (d.match(/\u0e1b\u0e23\u0e34\u0e21\u0e32\u0e13\u0e19\u0e49\u0e33\u0e1d\u0e19\u0e2a\u0e30\u0e2a\u0e21\s*:?\s*([\d.]+)/) || [])[1];
    const lvl = (d.match(/\u0e23\u0e30\u0e14\u0e31\u0e1a\u0e19\u0e49\u0e33\u0e1b\u0e31\u0e08\u0e08\u0e38\u0e1a\u0e31\u0e19[\s\S]*?([\-\d.]+)\s*\u0e21\.?\u0e23\u0e17\u0e01/) || [])[1];
    const dts = [...d.matchAll(/(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2})/g)].map((m) => m[1]);
    return {
      level: lvl != null ? Number(lvl) : null,
      rain: rain != null ? Number(rain) : null,
      dt: dts.length ? dts[dts.length - 1] : null,
    };
  });
  await inp.fill('');
  return out;
}

main().catch((e) => { console.error(e); process.exit(1); });
