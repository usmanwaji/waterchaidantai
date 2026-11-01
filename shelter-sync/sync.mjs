/* shelter-sync — ดึงข้อมูลศูนย์พักพิง จ.นราธิวาส ล่าสุดจากระบบหลังบ้าน ปภ. (shelter.disaster.go.th/backoffice)
   แล้วเขียนเป็น data/shelters-ddpm.json ให้หน้า shelter.html ใช้
   รันโดย .github/workflows/shelter-sync.yml วันละ 2 รอบ (เช้า/เย็น เวลาไทย)

   ทำไมต้องล็อกอิน: ชั้น ArcGIS ตัวจริงของ ปภ. (DDPM_Shelter) ต้องใช้ token ส่วนชั้น _UAT ที่เปิดสาธารณะไม่อัปเดตตามระบบจริง
   วิธีทำ: เปิดหน้า dashboard ด้วย Chromium → ล็อกอินด้วยบัญชีใน secret → เก็บทุกคำตอบ JSON ที่หน้าเว็บโหลดมา
           → หาชุดที่เป็นรายการศูนย์พักพิง (มีชื่อ + ความจุ/ยอดผู้พักพิง) → กรองเฉพาะนราธิวาส → แปลงเป็นชื่อฟิลด์เดียวกับชั้น ArcGIS
   ไม่ผูกกับ URL API ใด ๆ ของ ปภ. → ถ้าหลังบ้านเปลี่ยน endpoint ก็ยังหาเจอ ตราบใดที่หน้า dashboard ยังโหลดรายการศูนย์มา
   ทุกรอบพิมพ์ "รายงานสิ่งที่หน้าเว็บโหลด" (เฉพาะ URL path, ชื่อฟิลด์, จำนวนแถว · ไม่พิมพ์ค่าข้อมูล) ไว้ใน log ใช้ปรับสคริปต์

   ตัวแปรแวดล้อม:
     DDPM_SHELTER_USER, DDPM_SHELTER_PASS  บัญชีเข้าระบบหลังบ้าน (ตั้งเป็น GitHub secret)
     SHELTER_START        path หน้าแรกที่เปิด (ค่าเริ่มต้น /backoffice/dashboard)
     SHELTER_EXTRA_PATHS  path อื่นที่ต้องเปิดต่อ คั่นด้วย , (เช่น หน้ารายการศูนย์ ถ้า dashboard ไม่ได้โหลดรายการครบ)
   ใช้: node sync.mjs <ไฟล์ผลลัพธ์>   · exit 0 = เขียนไฟล์แล้ว · exit 1 = ล้มเหลว (ไม่แตะไฟล์เดิม) */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const BASE = (process.env.SHELTER_BASE || 'https://shelter.disaster.go.th').replace(/\/$/, '');
const START = process.env.SHELTER_START || '/backoffice/dashboard';
const EXTRA = (process.env.SHELTER_EXTRA_PATHS || '').split(',').map(s => s.trim()).filter(Boolean);
const USER = process.env.DDPM_SHELTER_USER || '';
const PASS = process.env.DDPM_SHELTER_PASS || '';
const OUT = process.argv[2] || 'data/shelters-ddpm.json';

const PROV_CODE = '96', PROV_NAME = 'นราธิวาส';
const NARA_DISTRICTS = ['เมืองนราธิวาส', 'ตากใบ', 'บาเจาะ', 'ยี่งอ', 'ระแงะ', 'รือเสาะ', 'ศรีสาคร', 'แว้ง',
  'สุคิริน', 'สุไหงโก-ลก', 'สุไหงปาดี', 'จะแนะ', 'เจาะไอร้อง'];
const MIN_KEEP = 0.5;   // ได้น้อยกว่าครึ่งของรอบก่อน → น่าจะดึงไม่ครบ ไม่เขียนทับ

const log = (...a) => console.log(...a);

/* ---------- ชื่อฟิลด์: เทียบแบบตัวพิมพ์เล็ก ไม่สนขีด/ขีดล่าง · ฟิลด์ซ้อน district.name_th → districtnameth ---------- */
const norm = k => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS = {
  shelter_code: ['sheltercode', 'code', 'shelterid', 'id', 'uuid'],
  name: ['name', 'sheltername', 'nameth', 'title'],
  province_code: ['provincecode', 'provinceid', 'provcode'],
  province_name: ['provincename', 'provincenameth', 'province'],
  district_name: ['districtname', 'districtnameth', 'amphoe', 'amphoename', 'amphurname', 'amphurnameth', 'district'],
  subdistrict_name: ['subdistrictname', 'subdistrictnameth', 'tambon', 'tambonname', 'tambonnameth', 'subdistrict'],
  district_code: ['districtcode', 'amphoecode', 'amphurcode'],
  subdistrict_code: ['subdistrictcode', 'tamboncode'],
  address_detail: ['addressdetail', 'address'],
  lat: ['lat', 'latitude', 'locationlat', 'geometrylat'],
  lng: ['lng', 'lon', 'long', 'longitude', 'locationlng', 'locationlon', 'geometrylng'],
  capacity: ['capacity', 'maxcapacity', 'totalcapacity', 'capacitytotal'],
  current_residents: ['currentresidents', 'residents', 'residentcount', 'residentscount', 'currentoccupancy',
    'occupancy', 'evacueecount', 'evacuees', 'totalresidents'],
  is_active: ['isactive', 'active', 'isopen'],
  status: ['status', 'shelterstatus'],
  coordinator_name: ['coordinatorname', 'contactname'],
  coordinator_phone: ['coordinatorphone', 'contactphone', 'phone', 'tel'],
  facility_items: ['facilityitems', 'facilities'],
  restroom_count: ['restroomcount', 'toiletcount'],
  updated_at: ['updatedat', 'updateddate', 'lasteditedat', 'lastediteddate', 'modifiedat'],
  deleted_at: ['deletedat'],
};

function flat(o, pre = '', out = {}, depth = 0) {
  for (const [k, v] of Object.entries(o)) {
    const nk = pre + norm(k);
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) flat(v, nk, out, depth + 1);
    else if (!(nk in out)) out[nk] = v;
  }
  return out;
}
const has = (f, field) => ALIAS[field].some(k => k in f);
function pick(f, field) {
  for (const k of ALIAS[field]) if (f[k] != null && f[k] !== '') return f[k];
  return null;
}
const isShelterLike = f => typeof pick(f, 'name') === 'string' && (has(f, 'capacity') || has(f, 'current_residents'));

/* ---------- เดินหา array ของ object ในคำตอบ JSON ---------- */
function* arrays(v, path = '$', depth = 0) {
  if (depth > 6 || v == null || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    if (v.length && v.every(x => x && typeof x === 'object' && !Array.isArray(x))) yield { path, arr: v };
    for (let i = 0; i < Math.min(v.length, 3); i++) yield* arrays(v[i], `${path}[${i}]`, depth + 1);
    return;
  }
  for (const [k, x] of Object.entries(v)) yield* arrays(x, `${path}.${k}`, depth + 1);
}

/* ---------- แปลงเป็นแถวมาตรฐาน (ชื่อฟิลด์ชุดเดียวกับชั้น ArcGIS DDPM_Shelter) ---------- */
const num = v => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; };
function toMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(String(v)); return Number.isFinite(t) ? t : null;
}
function activeOf(f) {
  const a = pick(f, 'is_active');
  if (a != null) return (a === true || a === 1 || /^(1|true|y|yes|active|open)$/i.test(String(a))) ? 1 : 0;
  const s = pick(f, 'status');
  if (typeof s === 'string') return (/open|active|เปิด/i.test(s) && !/close|inactive|ปิด/i.test(s)) ? 1 : 0;
  return 0;
}
function facilities(v) {
  if (v == null) return '[]';
  let a = v;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { a = a.split(',').map(s => s.trim()).filter(Boolean); } }
  if (!Array.isArray(a)) return '[]';
  return JSON.stringify(a.map(x => (x && typeof x === 'object') ? (x.code ?? x.key ?? x.value ?? x.name) : x).filter(x => x != null));
}
const cleanAmp = s => { s = String(s || '').replace(/^(อำเภอ|อ\.)\s*/, '').trim(); return s === 'เมือง' ? 'เมืองนราธิวาส' : s; };
const cleanTam = s => String(s || '').replace(/^(ตำบล|ต\.)\s*/, '').trim();

// รหัสอำเภอ/ตำบล → ชื่อ จากรายการตัวเลือกที่หน้าหลังบ้านโหลด (/administrative/districts/options …) ใช้เมื่อรายการศูนย์มีแต่รหัส
const LABELS = { district: new Map(), subdistrict: new Map() };
function learnLabels(c) {
  const kind = /\/subdistricts\//i.test(c.url) ? 'subdistrict' : /\/districts\//i.test(c.url) ? 'district' : null;
  if (!kind) return;
  for (const { arr } of arrays(c.body)) for (const o of arr) if (o.value != null && o.label) LABELS[kind].set(String(o.value), String(o.label));
}

function toRow(f) {
  const lat = num(pick(f, 'lat')), lng = num(pick(f, 'lng'));
  const geo = lat != null && lng != null && lat !== 0 && lng !== 0;
  return {
    shelter_code: String(pick(f, 'shelter_code') ?? ''),
    name: String(pick(f, 'name') || '').trim(),
    province_code: pick(f, 'province_code') != null ? String(pick(f, 'province_code')) : null,
    province_name: pick(f, 'province_name') != null ? String(pick(f, 'province_name')) : null,
    district_name: cleanAmp(pick(f, 'district_name') ?? LABELS.district.get(String(pick(f, 'district_code')))),
    subdistrict_name: cleanTam(pick(f, 'subdistrict_name') ?? LABELS.subdistrict.get(String(pick(f, 'subdistrict_code')))),
    district_code: pick(f, 'district_code') != null ? String(pick(f, 'district_code')) : null,
    address_detail: pick(f, 'address_detail') ?? '',
    lat: geo ? lat : null, lng: geo ? lng : null,
    capacity: num(pick(f, 'capacity')),
    current_residents: num(pick(f, 'current_residents')) ?? 0,
    is_active: activeOf(f),
    coordinator_name: pick(f, 'coordinator_name') ?? '',
    coordinator_phone: pick(f, 'coordinator_phone') ?? '',
    facility_items: facilities(pick(f, 'facility_items')),
    restroom_count: num(pick(f, 'restroom_count')),
    updated_at: toMs(pick(f, 'updated_at')),
    deleted_at: toMs(pick(f, 'deleted_at')),
  };
}
function inNara(r) {
  if (r.province_code == null && r.district_code) return String(r.district_code).startsWith(PROV_CODE);
  if (r.province_code) return r.province_code.replace(/^0+/, '').startsWith(PROV_CODE);
  if (r.province_name) return r.province_name.includes(PROV_NAME);
  return NARA_DISTRICTS.includes(r.district_name);
}

/* ---------- รายงาน (ไม่พิมพ์ค่าข้อมูล) ---------- */
function urlBrief(u) {
  try { const x = new URL(u); const q = [...x.searchParams.keys()]; return x.host + x.pathname + (q.length ? '?' + q.join('&') : ''); }
  catch { return u.slice(0, 120); }
}
function report(captured, others, tables) {
  log('\n===== รายงานสิ่งที่หน้าเว็บโหลด (JSON %d รายการ) =====', captured.length);
  for (const c of captured) {
    const top = c.body && typeof c.body === 'object' && !Array.isArray(c.body) ? Object.keys(c.body).slice(0, 20).join(',') : (Array.isArray(c.body) ? `array[${c.body.length}]` : typeof c.body);
    log(`- ${c.method} ${c.status} ${urlBrief(c.url)}  top: ${top}`);
    for (const { path, arr } of arrays(c.body)) {
      const keys = Object.keys(flat(arr[0])).slice(0, 45).join(',');
      const like = arr.filter(o => isShelterLike(flat(o))).length;
      log(`    ${path} [${arr.length}]${like ? ` ← คล้ายศูนย์พักพิง ${like} แถว` : ''}  keys: ${keys}`);
    }
  }
  if (others.length) {
    log('----- คำตอบ xhr/fetch ที่ไม่ใช่ JSON -----');
    others.forEach(o => log(`- ${o.method} ${o.status} ${urlBrief(o.url)}  (${o.ct || 'ไม่ระบุ content-type'})`));
  }
  if (tables.length) {
    log('----- ตารางบนหน้า -----');
    tables.forEach(t => log(`- ${t.page}: ตาราง ${t.rows} แถว · หัวตาราง: ${t.heads.join(' | ')}`));
  }
  log('===== จบรายงาน =====\n');
}

/* ---------- เบราว์เซอร์ ---------- */
async function settle(page, ms = 4000) {
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(ms);
}
async function visibleError(page) {
  const t = await page.locator('[role=alert], .error, .alert, .text-danger, .invalid-feedback, .ant-message, .MuiAlert-message')
    .allInnerTexts().catch(() => []);
  return t.map(s => s.trim()).filter(Boolean).join(' / ').slice(0, 300);
}
async function login(page) {
  const pw = page.locator('input[type="password"]:visible');
  if (!(await pw.count())) {
    const btn = page.locator('a:visible, button:visible').filter({ hasText: /เข้าสู่ระบบ|log ?in|sign ?in/i });
    if (await btn.count()) { await btn.first().click().catch(() => {}); await settle(page); }
  }
  if (!(await pw.count())) return false;   // ไม่เจอฟอร์มล็อกอิน → ถือว่าเข้าได้เลย/ล็อกอินอยู่แล้ว
  if (!USER || !PASS) throw new Error('หน้าเว็บขอล็อกอิน แต่ยังไม่ได้ตั้ง secret DDPM_SHELTER_USER / DDPM_SHELTER_PASS');
  const user = page.locator('input:visible:not([type=password]):not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=search])').first();
  if (!(await user.count())) throw new Error('เจอช่องรหัสผ่าน แต่ไม่เจอช่องชื่อผู้ใช้');
  await user.fill(USER);
  await pw.first().fill(PASS);
  const submit = page.locator('button[type=submit]:visible, input[type=submit]:visible').first();
  if (await submit.count()) await submit.click(); else await pw.first().press('Enter');
  await settle(page, 6000);
  if (await page.locator('input[type="password"]:visible').count()) {
    const err = await visibleError(page);
    throw new Error('ล็อกอินไม่สำเร็จ (ยังอยู่หน้าล็อกอิน)' + (err ? ' · ข้อความบนหน้า: ' + err : '') +
      ' · ถ้าระบบมี CAPTCHA/OTP ต้องใช้วิธีอื่น');
  }
  return true;
}
async function scrollAll(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 800) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 250)); }
  }).catch(() => {});
}
async function tablesOn(page) {
  return page.evaluate(() => [...document.querySelectorAll('table')].map(t => ({
    heads: [...t.querySelectorAll('thead th, tr:first-child th')].map(th => th.innerText.trim()).filter(Boolean).slice(0, 20),
    rows: t.querySelectorAll('tbody tr').length,
  }))).catch(() => []);
}

// ลิงก์ในเมนูหลังบ้าน (path เท่านั้น) · ใช้หาหน้ารายการศูนย์พักพิงเอง
async function navLinks(page) {
  return page.evaluate(() => [...new Set([...document.querySelectorAll('a[href]')]
    .map(a => { try { const u = new URL(a.getAttribute('href'), location.href); return u.origin === location.origin ? u.pathname : null; } catch { return null; } })
    .filter(Boolean))]).catch(() => []);
}
const isListPage = p => /shelter/i.test(p) && !/(new|create|add|edit)(\/|$)/i.test(p) && !/\/\d+(\/|$)|[0-9a-f]{8}-[0-9a-f]{4}/i.test(p);

function shelterRows(body) {
  let best = [];
  for (const { arr } of arrays(body)) {
    const like = arr.map(o => flat(o)).filter(isShelterLike);
    if (like.length >= Math.max(1, arr.length * 0.6) && like.length > best.length) best = like;
  }
  return best;
}
const rowKey = r => r.shelter_code || (r.name + '|' + r.district_name + '|' + r.subdistrict_name);

/* หน้ารายการในหลังบ้านมักแบ่งหน้า (เช่น ทีละ 10-20 แถว) → ยิง endpoint เดิมซ้ำด้วย session เดิม เพิ่มขนาดหน้าแล้วไล่ทีละหน้า
   จนไม่ได้แถวใหม่ · ใช้ header ชุดเดียวกับที่หน้าเว็บส่ง (Authorization/CSRF) */
async function paginate(ctx, captured) {
  const cands = captured.filter(c => c.method === 'GET' && c.status < 400 && shelterRows(c.body).length)
    .sort((a, b) => shelterRows(b.body).length - shelterRows(a.body).length);
  if (!cands.length) return [];
  const c = cands[0];
  const headers = Object.fromEntries(Object.entries(c.headers || {})
    .filter(([k]) => !k.startsWith(':') && !['content-length', 'host', 'accept-encoding', 'connection', 'cookie'].includes(k.toLowerCase())));
  const base = new URL(c.url);
  const sizeKey = ['limit', 'pageSize', 'perPage', 'per_page', 'size', 'pageLimit'].find(k => base.searchParams.has(k));
  const pageKey = ['page', 'pageNumber', 'currentPage', 'pageNo', 'pageIndex'].find(k => base.searchParams.has(k)) || 'page';
  const first = base.searchParams.has(pageKey) ? Number(base.searchParams.get(pageKey)) || 0 : 1;
  log(`ไล่หน้า: ${urlBrief(c.url)} (ขนาดหน้า: ${sizeKey || 'ไม่มี'} · เลขหน้า: ${pageKey})`);
  const seen = new Set(), bodies = [];
  async function get(n, size) {
    const u = new URL(base);
    u.searchParams.set(pageKey, String(n));
    if (sizeKey && size) u.searchParams.set(sizeKey, String(size));
    const res = await ctx.request.get(u.href, { headers, timeout: 60000 });
    if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
    return res.json();
  }
  let size = sizeKey ? 100 : null;
  for (let i = 0; i < 200; i++) {
    let body;
    try { body = await get(first + i, size); }
    catch (e) {
      if (i === 0 && size) { size = null; i = -1; log('  ขอทีละ 100 แถวไม่ได้ (' + e.message + ') → ใช้ขนาดหน้าเดิม'); continue; }
      log(`  หน้า ${first + i}: ${e.message} → หยุด`); break;
    }
    const rows = shelterRows(body);
    const fresh = rows.filter(f => { const k = rowKey(toRow(f)); if (seen.has(k)) return false; seen.add(k); return true; });
    log(`  หน้า ${first + i}: ${rows.length} แถว (ใหม่ ${fresh.length} · สะสม ${seen.size})`);
    if (!fresh.length) break;
    bodies.push(body);
  }
  return bodies.map(body => ({ method: 'GET', status: 200, url: c.url, body }));
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'th-TH', timezoneId: 'Asia/Bangkok', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const captured = [], others = [], tables = [];
  let paged = [];
  page.on('response', async res => {
    const req = res.request();
    if (!['xhr', 'fetch'].includes(req.resourceType())) return;
    const ct = res.headers()['content-type'] || '';
    if (!/json/i.test(ct)) { others.push({ method: req.method(), status: res.status(), url: res.url(), ct }); return; }
    try {
      const body = await res.json();
      const headers = await req.allHeaders().catch(() => req.headers());
      captured.push({ method: req.method(), status: res.status(), url: res.url(), body, headers });
    }
    catch { /* body ว่าง/redirect */ }
  });

  try {
    log('เปิด', BASE + START);
    await page.goto(BASE + START, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await settle(page);
    const didLogin = await login(page);
    log(didLogin ? 'ล็อกอินสำเร็จ' : 'ไม่เจอฟอร์มล็อกอิน (เข้าได้เลย)');
    const links = await navLinks(page);
    log('ลิงก์ในหน้าหลังบ้าน:', links.join(' ') || '(ไม่พบ)');
    const auto = links.filter(isListPage).slice(0, 4);
    const visit = [...new Set([START, ...EXTRA, ...(auto.length ? auto : ['/backoffice/shelters', '/backoffice/shelter'])])];
    for (const p of visit) {
      if (p !== START || !page.url().includes(START)) {
        log('เปิด', BASE + p);
        await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 90000 });
      }
      await settle(page);
      await scrollAll(page);
      await settle(page, 2000);
      (await tablesOn(page)).forEach(t => tables.push({ page: new URL(page.url()).pathname, ...t }));
      if (p !== START) log('  ลิงก์ในหน้านี้:', (await navLinks(page)).filter(x => /shelter/i.test(x)).slice(0, 15).join(' ') || '(ไม่มีลิงก์ shelter)');
    }
    captured.forEach(learnLabels);
    paged = await paginate(ctx, captured);
  } finally {
    report(captured, others, tables);
    await browser.close();
  }

  // รวมทุก array ที่ดูเป็นรายการศูนย์พักพิง · ศูนย์เดียวกันจากหลายคำตอบ → รวมฟิลด์ (ค่าที่ไม่ว่างชนะ)
  const byKey = new Map();
  for (const c of [...captured, ...paged]) {
    if (c.status >= 400) continue;
    for (const { arr } of arrays(c.body)) {
      const flats = arr.map(o => flat(o));
      const like = flats.filter(isShelterLike);
      if (like.length < Math.max(1, arr.length * 0.6)) continue;
      for (const f of like) {
        const r = toRow(f);
        const k = rowKey(r);
        const prev = byKey.get(k) || {};
        for (const [kk, v] of Object.entries(r)) if (v != null && v !== '' && !(kk in prev && prev[kk] != null && prev[kk] !== '')) prev[kk] = v;
        byKey.set(k, prev);
      }
    }
  }
  const all = [...byKey.values()];
  const rows = all.filter(r => !r.deleted_at && inNara(r))
    .sort((a, b) => (a.district_name || '').localeCompare(b.district_name || '', 'th') ||
      (a.subdistrict_name || '').localeCompare(b.subdistrict_name || '', 'th') || a.name.localeCompare(b.name, 'th'));
  log(`พบรายการคล้ายศูนย์พักพิง ${all.length} แถว · นราธิวาส ${rows.length} แถว · เปิดอยู่ ${rows.filter(r => r.is_active).length} แห่ง · ` +
    `ผู้พักพิงรวม ${rows.reduce((s, r) => s + (r.is_active ? r.current_residents || 0 : 0), 0)} คน`);

  if (!rows.length) throw new Error('ไม่พบรายการศูนย์พักพิงนราธิวาสในข้อมูลที่หน้าหลังบ้านโหลด · ดูรายงานด้านบนแล้วปรับ SHELTER_EXTRA_PATHS/สคริปต์');
  let prevN = 0;
  try { prevN = (JSON.parse(await readFile(OUT, 'utf8')).features || []).length; } catch { /* ยังไม่มีไฟล์ */ }
  if (prevN && rows.length < prevN * MIN_KEEP)
    throw new Error(`ได้ ${rows.length} แถว น้อยกว่าครึ่งของรอบก่อน (${prevN}) · น่าจะดึงไม่ครบ ไม่เขียนทับ`);

  const out = {
    source: 'shelter.disaster.go.th/backoffice',
    province_code: PROV_CODE,
    fetched_at: new Date().toISOString(),
    count: rows.length,
    features: rows.map(({ deleted_at, district_code, ...a }) => ({ attributes: a })),
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out) + '\n');
  log('เขียน', OUT);
}

main().catch(e => { console.error('ล้มเหลว:', e.message); process.exit(1); });
