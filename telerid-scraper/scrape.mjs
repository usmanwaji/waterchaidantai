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

  โหมด
    node scrape.mjs           ดึงรอบเดียวแล้วจบ (ใช้กับ run-local.bat / run-auto.bat)
    node scrape.mjs --watch   โหมดสด: เปิดค้างไว้ ดึงทุก WATCH_MIN นาที (ค่าเริ่มต้น 2)
                              ส่งขึ้น GitHub เฉพาะรอบที่ค่าเปลี่ยน (ใช้กับ run-live.bat)
                              สถานีส่งค่าทุก 15 นาที → หน้าเว็บเห็นค่าใหม่ภายในไม่กี่นาทีหลัง telerid

  ผลลัพธ์ (โฟลเดอร์ ./telerid-cam):
    - {CODE}.jpg           ภาพกล้องล่าสุดของแต่ละสถานี
    - stations.json        เมทาดาทา + ระดับน้ำ + พิกัด + สถานะภาพ (ให้ dashboard อ่าน)
    - _discovery.json      สถานะ ws/ภาพ รายสถานี (ไว้ debug)
*/

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { appendFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { publish } from './publish-github.mjs';

const BASE = 'https://telerid.rid.go.th';
const OUT = 'telerid-cam';
const PROVINCES = ['นราธิวาส'];
const CHUNK = 8;           // ดึงพร้อมกันทีละกี่สถานี
const WS_TIMEOUT = 20000;  // รอข้อความแรกจาก websocket (ms)

const WATCH = process.argv.includes('--watch');
const WATCH_MS = Math.max(1, Number(process.env.WATCH_MIN) || 2) * 60000;
const BROWSER_MAX_AGE = 6 * 3600e3;   // โหมดสด: ปิด-เปิด Chromium ใหม่ทุก 6 ชม. กันหน่วยความจำบวม
const LOCK = 'telerid-live.lock';
const LOGFILE = 'telerid-live.log';

let logFile = null;   // โหมดสดเขียน log ลงไฟล์ด้วย (หน้าต่างถูกซ่อน)
const log = (...a) => {
  console.log('[telerid]', ...a);
  if (logFile) try { appendFileSync(logFile, `${new Date().toISOString()} ${a.join(' ')}\n`); } catch {}
};

async function openApp() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      viewport: { width: 1400, height: 900 },
    });
    const page = await ctx.newPage();
    log('opening app…');
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(3000);
    return { browser, page, opened: Date.now() };
  } catch (e) { await browser.close().catch(() => {}); throw e; }
}

/* ดึงข้อมูลทุกสถานีหนึ่งรอบ แล้วเขียนไฟล์ลง ./telerid-cam
   mem (โหมดสด) จำภาพ/รายละเอียดรอบก่อน: ภาพกล้องที่ยังไม่เปลี่ยนไม่ต้องโหลดซ้ำ
   ไฟล์ detail ที่เนื้อหาเหมือนเดิมไม่เขียนทับ (publish จะได้ข้ามไฟล์นั้น) */
async function scrapeOnce(page, mem = { cam: {}, detail: {} }) {
  await fs.mkdir(OUT, { recursive: true });

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
  if (!WATCH) log('stations in', PROVINCES.join(','), ':', stations.length);

  // ---- 2+3) websocket รายสถานี + โหลดภาพกล้อง (ทำใน page context ผ่าน WAF) ----
  const meta = [];
  const discovery = [];
  const sigParts = [];   // ค่าที่ใช้ตัดสินว่า "ข้อมูลเปลี่ยน" (ไม่รวมเวลาที่รันสคริปต์)
  let okImg = 0;
  let okDetail = 0;
  let detailChanged = false;

  for (let i = 0; i < stations.length; i += CHUNK) {
    const chunk = stations.slice(i, i + CHUNK);
    const results = await page.evaluate(async ({ chunk, wsTimeout, seen }) => {
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
            out.camKey = String(cam.path || '') + '@' + (cam.unixtime || '');
            if (seen[s.code] === out.camKey) { out.imgSame = true; out.imgStatus = 200; }
            else try {
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
    }, { chunk, wsTimeout: WS_TIMEOUT, seen: mem.cam });

    for (let k = 0; k < chunk.length; k++) {
      const s = chunk[k], res = results[k];
      if (res.imgB64) {
        await fs.writeFile(path.join(OUT, s.code + '.jpg'), Buffer.from(res.imgB64, 'base64'));
        mem.cam[s.code] = res.camKey;
      } else if (!res.imgSame) delete mem.cam[s.code];
      const hasImage = !!(res.imgB64 || res.imgSame);
      if (hasImage) okImg++;
      // -- ไฟล์รายละเอียด (กราฟระดับน้ำ + น้ำฝน + รูปตัดลำน้ำ) ให้ dashboard ดึงตอนเปิด popup --
      const hasDetail = !!((res.wl && res.wl.v && res.wl.v.length) || res.cross);
      if (hasDetail) {
        const body = {
          code: s.code, name: s.name,
          level: res.level ?? null, levelUnix: res.levelUnix ?? null,
          warning: res.warning ?? null, critical: res.critical ?? null,
          wl: res.wl ?? null, rain: res.rain ?? null, cross: res.cross ?? null,
        };
        const sig = JSON.stringify(body);
        if (mem.detail[s.code] !== sig) {
          await fs.writeFile(path.join(OUT, s.code + '.detail.json'), JSON.stringify({ ...body, updated: new Date().toISOString() }));
          mem.detail[s.code] = sig;
          detailChanged = true;
        }
        okDetail++;
      }
      meta.push({
        code: s.code, name: s.name, basin: s.basin, amphur: s.amphur, province: s.province,
        lat: s.lat, lon: s.lon,
        level: res.level ?? null,
        bank: res.critical ?? null,           // ระดับตลิ่ง/วิกฤต (เส้นแดงใน telerid)
        warning: res.warning ?? null,
        critical: res.critical ?? null,
        hasImage, hasDetail, cams: res.cams ?? 0, imgStatus: res.imgStatus ?? null,
        dt: res.camUnix ? new Date(res.camUnix * 1000).toISOString()
          : res.levelUnix ? new Date(res.levelUnix * 1000).toISOString() : null,
      });
      discovery.push({ code: s.code, id: s.id, wsErr: res.wsErr ?? null, imgStatus: res.imgStatus ?? null, imgErr: res.imgErr ?? null, cams: res.cams ?? 0 });
      sigParts.push([s.code, res.level ?? null, res.levelUnix ?? null, res.camKey ?? null, hasImage, res.warning ?? null, res.critical ?? null]);
    }
    if (!WATCH) log(`… ${meta.length}/${stations.length} (images ${okImg})`);
  }

  await fs.writeFile(path.join(OUT, 'stations.json'), JSON.stringify({
    updated: new Date().toISOString(),
    total: meta.length, withImage: okImg, withDetail: okDetail, stations: meta,
  }, null, 2));
  await fs.writeFile(path.join(OUT, '_discovery.json'), JSON.stringify(discovery, null, 2));

  const withData = meta.filter((m) => m.level != null || m.hasImage).length;
  return { total: meta.length, okImg, okDetail, withData, detailChanged, sig: JSON.stringify(sigParts) };
}

async function once() {
  const app = await openApp();
  try {
    const r = await scrapeOnce(app.page);
    log(`DONE. stations=${r.total} images=${r.okImg} detail=${r.okDetail}`);
    if (r.okImg === 0) log('⚠️ ไม่ได้ภาพเลย — เปิด telerid-cam/_discovery.json ดู wsErr/imgStatus แล้วส่งให้ผมปรับ');
  } finally { await app.browser.close(); }
}

/* ---- โหมดสด: เปิด Chromium ค้างไว้ ดึงทุก WATCH_MIN นาที ส่งขึ้น GitHub เมื่อค่าเปลี่ยน ---- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

async function watch() {
  // กันรันซ้อน: Task Scheduler เรียก run-live-hidden.vbs ซ้ำได้เรื่อย ๆ ตัวที่ 2 จะออกทันที
  try {
    const pid = Number(await fs.readFile(LOCK, 'utf8'));
    if (pid && pid !== process.pid && alive(pid)) { console.log('[telerid] โหมดสดรันอยู่แล้ว (pid', pid + ') — ออก'); return; }
  } catch {}
  await fs.writeFile(LOCK, String(process.pid));
  process.on('exit', () => { try { unlinkSync(LOCK); } catch {} });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => process.exit(0));

  logFile = LOGFILE;
  const rotate = async () => { try { if ((await fs.stat(LOGFILE)).size > 2e6) await fs.rename(LOGFILE, LOGFILE + '.old'); } catch {} };
  await rotate();
  if (!process.env.GH_TOKEN) { log('❌ ยังไม่ได้ตั้งค่า GH_TOKEN — ดู README ข้อ 2-3 (setx GH_TOKEN "...")'); process.exit(2); }
  log(`โหมดสด เริ่มทำงาน · ดึงทุก ${WATCH_MS / 60000} นาที · pid ${process.pid}`);

  const mem = { cam: {}, detail: {} };
  let app = null, lastSig = null, dirty = false, fails = 0;   // dirty = มีไฟล์ detail เปลี่ยนที่ยังไม่ได้ส่ง (เช่น สถานีวัดฝนอย่างเดียว)
  for (;;) {
    const t0 = Date.now();
    await rotate();
    try {
      if (app && t0 - app.opened > BROWSER_MAX_AGE) { await app.browser.close().catch(() => {}); app = null; }
      if (!app) app = await openApp();
      const r = await scrapeOnce(app.page, mem);
      if (!r.withData) throw new Error(`ไม่ได้ข้อมูลสักสถานี (stations=${r.total}) — ไม่ส่งขึ้น กันทับข้อมูลดี`);
      dirty = dirty || r.detailChanged;
      if (r.sig === lastSig && !dirty) log(`ไม่มีค่าใหม่ (มีข้อมูล ${r.withData}/${r.total})`);
      else {
        const p = await publish({ quiet: true });
        lastSig = r.sig; dirty = false;
        log(`ส่งขึ้นแล้ว · มีข้อมูล ${r.withData}/${r.total} ภาพ ${r.okImg} · ไฟล์เปลี่ยน ${p.uploaded}/${p.files}`);
      }
      fails = 0;
    } catch (e) {
      fails++;
      log('ผิดพลาด:', String(e && e.message || e).slice(0, 300));
      if (app) { await app.browser.close().catch(() => {}); app = null; }   // เปิดใหม่รอบหน้า (session/WAF หมดอายุ)
    }
    // พลาดติดกันหลายรอบ → เว้นระยะนานขึ้น (สูงสุด 15 นาที) ไม่ยิง telerid ถี่ตอนระบบเขาล่ม
    const wait = fails ? Math.min(15 * 60000, WATCH_MS * 2 ** Math.min(fails - 1, 3)) : WATCH_MS;
    await sleep(Math.max(5000, wait - (Date.now() - t0)));
  }
}

(WATCH ? watch() : once()).catch((e) => { log(String(e && e.stack || e)); process.exit(1); });
