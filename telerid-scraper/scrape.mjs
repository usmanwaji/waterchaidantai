/*
  telerid-scraper — ดึงภาพกล้อง + ระดับน้ำสถานีโทรมาตร กรมชลประทาน (telerid.rid.go.th)
  ของ 5 จังหวัดภาคใต้ตอนล่าง (สตูล สงขลา ปัตตานี ยะลา นราธิวาส) ด้วย Playwright (headless)

  วิธีทำงาน (อัปเดต ก.ค. 2569 — endpoint เดิม station_image ถูกปิด ตอบ 401 ตลอด):
    1. เปิดแอป telerid ด้วย Chromium (ผ่าน WAF)
    2. GET /restapi/main/station_list/  → รายชื่อสถานี (public, ไม่ต้อง login)
    3. ต่อ WebSocket  wss://telerid.rid.go.th/ws/station/{id}/  ทีละสถานี (public เช่นกัน)
       ข้อความแรกที่ได้ = ข้อมูลเต็มของสถานี: values.cctv[n].path, values.water_level,
       water_level_warning / water_level_critical ฯลฯ
    4. GET /restapi/main/camera{path}  → ไฟล์ภาพ .jpg ตรง ๆ (ไม่ต้องมี token!)

  ผลลัพธ์ (โฟลเดอร์ ./telerid-cam):
    - {CODE}.jpg           ภาพกล้องล่าสุดของแต่ละสถานี
    - stations.json        เมทาดาทา + ระดับน้ำ + พิกัด + สถานะภาพ (ให้ dashboard อ่าน)
    - _discovery.json      สถานะ ws/ภาพ รายสถานี (ไว้ debug)
*/

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://telerid.rid.go.th';
const OUT = 'telerid-cam';
const PROVINCES = ['สตูล', 'สงขลา', 'ปัตตานี', 'ยะลา', 'นราธิวาส'];
const CHUNK = 8;           // ดึงพร้อมกันทีละกี่สถานี
const WS_TIMEOUT = 20000;  // รอข้อความแรกจาก websocket (ms)

const log = (...a) => console.log('[telerid]', ...a);

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    viewport: { width: 1400, height: 900 },
  });
  const page = await ctx.newPage();

  log('opening app…');
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(3000);

  // ---- 1) รายชื่อสถานีของ 5 จังหวัด (public REST) ----
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

  // ---- 2+3) websocket รายสถานี + โหลดภาพกล้อง (ทำใน page context ผ่าน WAF) ----
  const meta = [];
  const discovery = [];
  let okImg = 0;
  let okDetail = 0;

  for (let i = 0; i < stations.length; i += CHUNK) {
    const chunk = stations.slice(i, i + CHUNK);
    const results = await page.evaluate(async ({ chunk, wsTimeout }) => {
      const b64 = (buf) => { const b = new Uint8Array(buf); let bin = ''; const c = 8192; for (let j = 0; j < b.length; j += c) bin += String.fromCharCode.apply(null, b.subarray(j, j + c)); return btoa(bin); };

      const one = async (s) => {
        const out = { code: s.code };
        // -- ข้อมูลสถานีจาก websocket (ข้อความแรก) --
        let st = null;
        try {
          st = await new Promise((resolve, reject) => {
            const ws = new WebSocket('wss://' + location.host + '/ws/station/' + s.id + '/');
            const t = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('ws timeout')); }, wsTimeout);
            ws.onmessage = (e) => { clearTimeout(t); try { ws.close(); } catch {} try { resolve(JSON.parse(JSON.parse(e.data).message)); } catch (err) { reject(err); } };
            ws.onerror = () => { clearTimeout(t); reject(new Error('ws error')); };
          });
        } catch (e) { out.wsErr = String(e && e.message || e).slice(0, 80); }

        if (st) {
          const v = st.values || {};
          out.level = v.water_level && v.water_level.value != null ? v.water_level.value : null;
          out.levelUnix = v.water_level ? v.water_level.unixtime : null;
          out.warning = st.water_level_warning ?? null;
          out.critical = st.water_level_critical ?? null;
          // -- ชุดข้อมูลกราฟ (ระดับน้ำรายวัน + น้ำฝน) + รูปตัดลำน้ำ --
          const N = 192; // เก็บ ~48 ชม.ล่าสุด (15 นาที/จุด)
          const wlg = v.water_level_graph ? Object.values(v.water_level_graph)[0] : null;
          if (wlg && Array.isArray(wlg.value) && Array.isArray(wlg.time)) {
            out.wl = { t: wlg.time.slice(-N), v: wlg.value.slice(-N).map((x) => (x == null ? null : Math.round(x * 100) / 100)) };
          }
          const rg = v.rain_graph;
          if (rg && Array.isArray(rg.value) && Array.isArray(rg.time)) {
            out.rain = { t: rg.time.slice(-N), v: rg.value.slice(-N).map((x) => (x == null ? null : Math.round(x * 10) / 10)) };
          }
          const cs = Array.isArray(st.cross_section) ? st.cross_section[0] : null;
          if (cs && Array.isArray(cs.distance) && Array.isArray(cs.high)) {
            out.cross = { distance: cs.distance, high: cs.high, ground: cs.ground ?? null, warning: cs.warning ?? null, critical: cs.critical ?? null, zerogate: cs.zerogate ?? null };
          }
          // -- ภาพกล้อง: GET /restapi/main/camera{path} (ไม่ต้อง auth) --
          const cams = v.cctv ? Object.values(v.cctv) : [];
          out.cams = cams.length;
          if (cams.length) {
            const cam = cams[0];
            out.camUnix = cam.unixtime || null;
            try {
              const p = String(cam.path || '').replace(/^\/+/, '');
              const r = await fetch('/restapi/main/camera/' + p);
              out.imgStatus = r.status;
              const ct = (r.headers.get('content-type') || '').split(';')[0];
              if (r.ok && /image/.test(ct)) {
                const buf = await r.arrayBuffer();
                if (buf.byteLength > 500) out.imgB64 = b64(buf);
              }
            } catch (e) { out.imgErr = String(e).slice(0, 80); }
          }
        }
        return out;
      };
      return Promise.all(chunk.map(one));
    }, { chunk, wsTimeout: WS_TIMEOUT });

    for (let k = 0; k < chunk.length; k++) {
      const s = chunk[k], res = results[k];
      if (res.imgB64) {
        await fs.writeFile(path.join(OUT, s.code + '.jpg'), Buffer.from(res.imgB64, 'base64'));
        okImg++;
      }
      // -- ไฟล์รายละเอียด (กราฟระดับน้ำ + น้ำฝน + รูปตัดลำน้ำ) ให้ dashboard ดึงตอนเปิด popup --
      const hasDetail = !!((res.wl && res.wl.v && res.wl.v.length) || res.cross);
      if (hasDetail) {
        await fs.writeFile(path.join(OUT, s.code + '.detail.json'), JSON.stringify({
          code: s.code, name: s.name, updated: new Date().toISOString(),
          level: res.level ?? null, levelUnix: res.levelUnix ?? null,
          warning: res.warning ?? null, critical: res.critical ?? null,
          wl: res.wl ?? null, rain: res.rain ?? null, cross: res.cross ?? null,
        }));
        okDetail++;
      }
      meta.push({
        code: s.code, name: s.name, basin: s.basin, amphur: s.amphur, province: s.province,
        lat: s.lat, lon: s.lon,
        level: res.level ?? null,
        bank: res.critical ?? null,           // ระดับตลิ่ง/วิกฤต (เส้นแดงใน telerid)
        warning: res.warning ?? null,
        critical: res.critical ?? null,
        hasImage: !!res.imgB64, hasDetail, cams: res.cams ?? 0, imgStatus: res.imgStatus ?? null,
        dt: res.camUnix ? new Date(res.camUnix * 1000).toISOString()
          : res.levelUnix ? new Date(res.levelUnix * 1000).toISOString() : null,
      });
      discovery.push({ code: s.code, id: s.id, wsErr: res.wsErr ?? null, imgStatus: res.imgStatus ?? null, imgErr: res.imgErr ?? null, cams: res.cams ?? 0 });
    }
    log(`… ${meta.length}/${stations.length} (images ${okImg})`);
  }

  await fs.writeFile(path.join(OUT, 'stations.json'), JSON.stringify({
    updated: new Date().toISOString(),
    total: meta.length, withImage: okImg, withDetail: okDetail, stations: meta,
  }, null, 2));
  await fs.writeFile(path.join(OUT, '_discovery.json'), JSON.stringify(discovery, null, 2));

  log(`DONE. stations=${meta.length} images=${okImg} detail=${okDetail}`);
  if (okImg === 0) log('⚠️ ไม่ได้ภาพเลย — เปิด telerid-cam/_discovery.json ดู wsErr/imgStatus แล้วส่งให้ผมปรับ');
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
