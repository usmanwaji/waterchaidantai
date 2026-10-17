/*
  status-dash.worker.js — หน้าสถานะ Worker ทุกตัวของ naraflood ในหน้าเดียว (สำหรับผู้ดูแล ไม่ลิงก์จากเว็บ)
  ------------------------------------------------------------------
  เปิดได้เฉพาะลิงก์ที่มีรหัสลับ:  https://status-dash.<บัญชี>.workers.dev/<DASH_KEY>
  path อื่นทั้งหมดตอบ 404 · รหัสเก็บเป็น secret ของ Worker (DASH_KEY) ไม่อยู่ในไฟล์นี้/ใน GitHub
  เปลี่ยนรหัส = ตั้ง DASH_KEY ใหม่ ลิงก์เดิมใช้ไม่ได้ทันที

  หน้าเว็บขอ /<DASH_KEY>/data.json ทุก 2 นาที · Worker นี้ไปถามหน้าสถานะ (/) ของแต่ละ Worker ผ่าน Service binding
  (เรียกผ่าน URL workers.dev ในบัญชีเดียวกันไม่ได้ ได้ error 1042) แล้วรวมส่งกลับ · เก็บผลไว้ 60 วิ คนเปิดพร้อมกันหลายคน
  ก็ถามต่อ 1 รอบ (หน้าสถานะของ telerid/hyd/ews ลองต่อต้นทางจริงทุกครั้งที่ถูกเรียก จึงไม่ถามถี่)

  วิธี deploy:
    1) Create Worker ชื่อ status-dash → วางไฟล์นี้ → Deploy
    2) Settings → Bindings → Service binding 7 ตัว (ชื่อตัวแปรต้องตรง):
         HOME → home-proxy · TELERID → telerid-proxy · HYD → hyd-proxy · EWS → ews-proxy
         TMD → tmd-proxy · DDPM → ddpm-proxy · ONWR → onwr-proxy
       ตัวไหนไม่ผูก การ์ดนั้นขึ้น "ไม่ได้ผูก binding" ตัวอื่นยังทำงาน
    3) Settings → Variables and Secrets → Add → Type: Secret · ชื่อ DASH_KEY · ค่า = ข้อความสุ่มยาว ๆ (เช่น 24 ตัวอักษรขึ้นไป)
    4) เปิด https://status-dash.<บัญชี>.workers.dev/<DASH_KEY>
  ------------------------------------------------------------------
*/
const CHECKS = [
  { id: 'home', binding: 'HOME', json: true },
  { id: 'telerid', binding: 'TELERID', json: true },
  { id: 'hyd', binding: 'HYD', json: true },
  { id: 'ews', binding: 'EWS', json: true },
  { id: 'tmd', binding: 'TMD' },
  { id: 'ddpm', binding: 'DDPM' },
  { id: 'onwr', binding: 'ONWR' },
  { id: 'site', url: 'https://naraflood.com/sw.js' },   // เว็บจริง + รุ่นแคชของ service worker
];
const TIMEOUT = 25000;     // หน้าสถานะ hyd-proxy ลองต่อ hyd-app ได้ถึง 20 วิ
const CACHE_SEC = 60;
const CACHE_KEY = 'https://status-dash.cache/data';

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + ms / 1000 + 's')), ms))]);

async function check(env, c) {
  const t0 = Date.now();
  const out = { id: c.id };
  const b = c.binding && env && env[c.binding];
  if (c.binding && !b) return { ...out, error: 'binding ' + c.binding + ' not set' };
  try {
    const r = await withTimeout(b ? b.fetch('https://' + c.id + '/') : fetch(c.url), TIMEOUT);
    const text = await r.text();
    out.http = r.status; out.ms = Date.now() - t0;
    out.placement = r.headers.get('cf-placement') || null;
    if (c.json) { try { out.data = JSON.parse(text); } catch { out.text = text.slice(0, 200); } }
    else if (c.id === 'site') out.sw = (text.match(/VERSION\s*=\s*'([^']+)'/) || [])[1] || null;
    else out.text = text.slice(0, 120);
  } catch (e) {
    out.ms = Date.now() - t0; out.error = String(e?.message || e);
  }
  return out;
}

async function data(env, ctx, fresh) {
  const cache = caches.default;
  if (!fresh) {
    const hit = await cache.match(CACHE_KEY);
    if (hit) return new Response(hit.body, hit);
  }
  const results = await Promise.all(CHECKS.map((c) => check(env, c)));
  const body = JSON.stringify({ at: Date.now(), checks: results });
  const res = new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${CACHE_SEC}` } });
  ctx.waitUntil(cache.put(CACHE_KEY, res.clone()));
  return res;
}

const SEC_HEADERS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',          // ลิงก์ออกจากหน้านี้ไม่พกรหัสในที่อยู่ไปด้วย
  'x-robots-tag': 'noindex, nofollow',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
};

export default {
  async fetch(request, env, ctx) {
    const key = env && env.DASH_KEY;
    const path = new URL(request.url).pathname.replace(/(.)\/$/, '$1');   // /<รหัส>/ ก็เปิดได้
    if (!key) return new Response('DASH_KEY secret is not set', { status: 503, headers: SEC_HEADERS });
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: SEC_HEADERS });
    if (path === '/' + key) return new Response(PAGE, { headers: { ...SEC_HEADERS, 'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
    if (path === '/' + key + '/data.json') {
      const fresh = new URL(request.url).searchParams.has('fresh');
      const r = await data(env, ctx, fresh);
      return new Response(r.body, { headers: { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8' } });
    }
    return new Response('Not found', { status: 404, headers: SEC_HEADERS });
  },
};

/* ---------- หน้า dashboard (HTML เดียว ไม่มีไฟล์อื่น) ---------- */
const PAGE = String.raw`<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>สถานะระบบ naraflood</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: แถบสรุปบนสุด → ข้อมูลหน้าแรก (ตารางรายส่วน) → การ์ด Worker ต้นทาง · ตัวเลขเป็นฟอนต์ mono เรียงหลักตรงกัน */
:root{
  --paper:#f3f5f6; --card:#ffffff; --ink:#15212b; --muted:#5b6b78; --line:#d9e0e5; --river:#1f6f8b;
  --ok:#1e7d4f; --ok-wash:#e3f3ea; --warn:#a36200; --warn-wash:#fbefd9; --bad:#b3261e; --bad-wash:#fbe4e2; --idle:#7a8792; --idle-wash:#edf0f2;
  --sans:"IBM Plex Sans Thai","Noto Sans Thai",Tahoma,sans-serif; --mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;
  color-scheme:light;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --paper:#0f171d; --card:#16222b; --ink:#e6edf2; --muted:#9aaab6; --line:#283844; --river:#5bb4d3;
  --ok:#5fd09a; --ok-wash:#173628; --warn:#f0b452; --warn-wash:#3a2c12; --bad:#ff8a80; --bad-wash:#3d1c1a; --idle:#93a1ad; --idle-wash:#1f2b34; color-scheme:dark}}
:root[data-theme="dark"]{
  --paper:#0f171d; --card:#16222b; --ink:#e6edf2; --muted:#9aaab6; --line:#283844; --river:#5bb4d3;
  --ok:#5fd09a; --ok-wash:#173628; --warn:#f0b452; --warn-wash:#3a2c12; --bad:#ff8a80; --bad-wash:#3d1c1a; --idle:#93a1ad; --idle-wash:#1f2b34; color-scheme:dark}
*{box-sizing:border-box}
html{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 var(--sans);
  padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:20px 40px}
.wrap{max-width:1040px;margin:0 auto;display:grid;gap:22px}
h1{font-size:22px;font-weight:600;margin:0;text-wrap:balance}
h2{font-size:15px;font-weight:600;margin:0;letter-spacing:.01em}
.sub{color:var(--muted);font-size:13px}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums}
header.top{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:flex-end;justify-content:space-between}
.top .meta{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center}
button{font:500 14px var(--sans);color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:7px 14px;cursor:pointer}
button:hover{border-color:var(--river)} button:focus-visible{outline:2px solid var(--river);outline-offset:2px}
button[disabled]{opacity:.6;cursor:progress}
.summary{display:flex;flex-wrap:wrap;gap:10px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.summary .big{font-size:17px;font-weight:600;margin-right:auto}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:2px 10px;font-size:13px;font-weight:500;white-space:nowrap}
.pill::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.ok{color:var(--ok);background:var(--ok-wash)} .warn{color:var(--warn);background:var(--warn-wash)}
.bad{color:var(--bad);background:var(--bad-wash)} .idle{color:var(--idle);background:var(--idle-wash)}
section{display:grid;gap:10px}
.sec-head{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline;justify-content:space-between}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.cron{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--line);border-bottom:1px solid var(--line)}
.cron div{background:var(--card);padding:10px 14px;display:grid;gap:2px;min-width:0}
.k{color:var(--muted);font-size:12px;letter-spacing:.02em}
.v{font-size:15px;font-weight:500;overflow-wrap:anywhere}
.tbl{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:9px 14px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500;font-size:12px;letter-spacing:.02em;background:var(--card)}
tr:last-child td{border-bottom:0}
td.num{white-space:nowrap}
td.err{color:var(--bad);font-size:13px;overflow-wrap:anywhere;max-width:340px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;display:grid;gap:8px;align-content:start;min-width:0}
.card .head{display:flex;gap:8px;align-items:center;justify-content:space-between}
.card .name{font-weight:600}
.card .role{color:var(--muted);font-size:13px;margin-top:-6px}
.card dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:13px}
.card dt{color:var(--muted)} .card dd{margin:0;overflow-wrap:anywhere}
.note{color:var(--muted);font-size:12.5px}
.empty{padding:18px 16px;color:var(--muted)}
@media (max-width:640px){
  thead{display:none} table,tbody,tr,td{display:block;width:100%}
  tr{padding:10px 14px;border-bottom:1px solid var(--line)} td{border:0;padding:2px 0}
  td[data-k]::before{content:attr(data-k) " · ";color:var(--muted);font-size:12px}
  td.err{max-width:none} td:empty{display:none}
  .cron{grid-template-columns:1fr 1fr} .cron div:last-child:nth-child(odd){grid-column:1/-1}
}
@media (prefers-reduced-motion:no-preference){.panel,.card{transition:border-color .2s}}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <h1>สถานะระบบ naraflood</h1>
      <div class="sub">ข้อมูลหน้าแรกและ Worker ต้นทางบน Cloudflare · หน้าเฉพาะผู้ดูแล</div>
    </div>
    <div class="meta">
      <span class="sub" id="checked">กำลังตรวจ…</span>
      <button id="refresh" type="button">ตรวจตอนนี้</button>
    </div>
  </header>

  <div class="summary" id="summary"><span class="big">กำลังตรวจทุก Worker…</span></div>

  <section>
    <div class="sec-head"><h2>ข้อมูลหน้าแรก (home-proxy)</h2><span class="sub">cron ดึงแต่ละส่วนตามรอบของมัน · คนเปิดเว็บอ่านจากแคช</span></div>
    <div class="panel">
      <div class="cron" id="cron"><div><span class="k">รอบ cron ล่าสุด</span><span class="v">…</span></div></div>
      <div class="tbl"><table>
        <thead><tr><th>ข้อมูล</th><th>สถานะ</th><th>อายุ</th><th>รอบที่ดึงใหม่</th><th>ข้อผิดพลาดล่าสุด</th></tr></thead>
        <tbody id="parts"><tr><td class="empty" colspan="5">กำลังโหลด…</td></tr></tbody>
      </table></div>
    </div>
  </section>

  <section>
    <div class="sec-head"><h2>Worker ต้นทาง</h2><span class="sub">วัดเวลาตอบจาก Worker หน้านี้</span></div>
    <div class="cards" id="cards"></div>
    <p class="note">ศูนย์ BKK = Cloudflare กรุงเทพฯ · telerid และ hyd-app รับเฉพาะ IP ในไทย จึงต้องรันที่ BKK · หน้านี้รีเฟรชเองทุก 2 นาที</p>
  </section>
</div>
<script>
'use strict';
var PART_NAME = { ddpm:'ระดับน้ำ ปภ.', rid:'โทรมาตร ชป.', hyd:'X.199 (hyd-app)', rain3d:'ฝนสะสม 3 วัน', tmd:'พยากรณ์รายภาค กรมอุตุฯ',
  nowcast:'เรดาร์ฝนระยะสั้น', riskmap:'ฝนคาดการณ์รายอำเภอ', trends:'ทิศทางน้ำ (ปภ./ชป.)', thr:'เกณฑ์เฝ้าระวัง ปภ.' };
var CARD = {
  telerid:{ name:'telerid-proxy', role:'โทรมาตร ชป. (telerid)' },
  hyd:{ name:'hyd-proxy', role:'สถานีอุทกวิทยา ชป. (X.199)' },
  ews:{ name:'ews-proxy', role:'เตือนภัย ทน. (หน้าแผนที่)' },
  tmd:{ name:'tmd-proxy', role:'กรมอุตุฯ: พยากรณ์ เรดาร์ ฝนรายอำเภอ' },
  ddpm:{ name:'ddpm-proxy', role:'กล้อง/ระดับน้ำ ปภ. (หน้าแผนที่)' },
  onwr:{ name:'onwr-proxy', role:'เรดาร์ สทนช. (หน้าแผนที่)' },
  site:{ name:'naraflood.com', role:'เว็บจริง (GitHub Pages)' }
};
var LABEL = { ok:'ปกติ', warn:'ต้องดู', bad:'มีปัญหา', idle:'ไม่ทราบ' };
var REFRESH_MS = 120000, timer = null, lastAt = 0;

function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function pill(state, text){ return '<span class="pill ' + state + '">' + esc(text || LABEL[state]) + '</span>'; }
function age(sec){
  if (sec == null) return '—';
  if (sec < 90) return Math.round(sec) + ' วิ';
  if (sec < 5400) return Math.round(sec / 60) + ' นาที';
  if (sec < 172800) return (Math.round(sec / 360) / 10) + ' ชม.';
  return Math.round(sec / 86400) + ' วัน';
}
function schedule(s){
  if (!s) return '—';
  var m;
  if ((m = /^every (\d+) min$/.exec(s))) return 'ทุก ' + m[1] + ' นาที';
  if ((m = /^every (\d+) h$/.exec(s))) return 'ทุก ' + m[1] + ' ชม.';
  if ((m = /^daily (\d+:\d+)/.exec(s))) return 'ทุกวัน ' + m[1] + ' น.';
  if ((m = /^monthly on the (\d+)/.exec(s))) return 'ทุกวันที่ ' + m[1] + ' ของเดือน';
  if (/after rid/.test(s)) return 'ตามโทรมาตร ชป. (14 นาที) · กราฟ ปภ. ชั่วโมงละครั้ง';
  return s;
}
function timeTh(ms){ return new Date(ms).toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit' }); }
function where(c){ var p = c.placement || ''; var m = /^(remote|local)-(\w+)/.exec(p); return m ? m[2] : ''; }

// lastError มีค่า = ครั้งล่าสุดที่ดึงล้มเหลว (ดึงสำเร็จแล้วจะล้างทิ้ง) · late = เกินรอบแล้ว หน้าเว็บจะติดธงข้อมูลเก่า
function partState(p){
  if (p.ageSec == null) return ['bad', 'ยังไม่มีข้อมูล'];
  if (p.lastError && p.late) return ['bad', 'ดึงไม่สำเร็จ · ข้อมูลเกินรอบ'];
  if (p.lastError) return ['warn', 'รอบล่าสุดดึงไม่สำเร็จ'];
  if (p.late) return ['warn', 'เกินรอบ'];
  if (p.upstreamStale) return ['warn', 'ต้นทางส่งชุดเก่า'];
  return ['ok', 'ปกติ'];
}

function renderHome(c, states){
  var cronEl = document.getElementById('cron'), body = document.getElementById('parts');
  if (c.error || !c.data || !c.data.parts){
    states.push('bad');
    cronEl.innerHTML = '<div><span class="k">home-proxy</span><span class="v">' + pill('bad', 'ติดต่อไม่ได้') + '</span></div>';
    body.innerHTML = '<tr><td class="empty" colspan="5">' + esc(c.error || ('HTTP ' + c.http)) + '</td></tr>';
    return;
  }
  var d = c.data, cr = d.cron;
  var cronState = 'ok', cronText = 'ปกติ';
  if (!cr || typeof cr !== 'object'){ cronState = 'bad'; cronText = 'ยังไม่เห็น cron'; }
  // รอบที่ไม่มีอะไรถึงกำหนดไม่บันทึก · ปกติบันทึกทุก ~5 นาที (ระดับน้ำ ปภ.) ช่วงที่ ปภ. ตอบ 429 ห่างได้ถึง 14 นาที (โทรมาตร ชป.)
  else if (cr.lastRunAgoSec > 3600){ cronState = 'bad'; cronText = 'ไม่ได้รันเกิน 1 ชม.'; }
  else if (cr.lastRunAgoSec > 960){ cronState = 'warn'; cronText = 'ไม่ได้รันนานเกิน'; }
  else if (cr.runsIn && cr.runsIn !== 'BKK'){ cronState = 'warn'; cronText = 'ไม่ได้รันที่ BKK'; }
  else if (cr.failed && cr.failed.length){ cronState = 'warn'; cronText = 'บางส่วนล้มเหลว'; }
  states.push(cronState);
  var missing = Object.keys(d.bindings || {}).filter(function(k){ return !d.bindings[k]; });
  if (missing.length) states.push('warn');
  cronEl.innerHTML =
    '<div><span class="k">cron</span><span class="v">' + pill(cronState, cronText) + '</span></div>' +
    '<div><span class="k">รันล่าสุด</span><span class="v num">' + (cr && cr.lastRunAgoSec != null ? age(cr.lastRunAgoSec) + ' ที่แล้ว' : '—') + '</span></div>' +
    '<div><span class="k">ศูนย์ที่รัน</span><span class="v num">' + esc(cr && cr.runsIn || '—') + '</span></div>' +
    '<div><span class="k">รอบล่าสุดดึงใหม่</span><span class="v num">' + (cr && cr.refreshed != null ? cr.refreshed + ' ส่วน · ' + cr.tookMs + ' ms' : '—') + '</span></div>' +
    '<div><span class="k">binding</span><span class="v">' + (missing.length ? pill('warn', 'ขาด ' + missing.join(', ')) : pill('ok', 'ครบ')) + '</span></div>';
  var rows = Object.keys(d.parts).map(function(k){
    var p = d.parts[k], st = partState(p);
    states.push(st[0]);
    return '<tr><td data-k="ข้อมูล"><b>' + esc(PART_NAME[k] || k) + '</b></td>' +
      '<td data-k="สถานะ">' + pill(st[0], st[1]) + '</td>' +
      '<td data-k="อายุ" class="num">' + age(p.ageSec) + '</td>' +
      '<td data-k="รอบ">' + esc(schedule(p.refresh)) + '</td>' +
      '<td data-k="ข้อผิดพลาด" class="err">' + (p.lastError ? esc(p.lastError) + ' <span class="sub">(' + age(p.lastErrorAgoSec) + ' ที่แล้ว)</span>' : '') + '</td></tr>';
  });
  body.innerHTML = rows.join('');
}

function card(c){
  var meta = CARD[c.id] || { name:c.id, role:'' }, st = 'ok', text = '', dl = [];
  var add = function(k, v){ dl.push('<dt>' + esc(k) + '</dt><dd>' + v + '</dd>'); };
  if (c.error){ st = /binding/.test(c.error) ? 'idle' : 'bad'; text = /binding/.test(c.error) ? 'ไม่ได้ผูก binding' : 'ติดต่อไม่ได้'; add('สาเหตุ', esc(c.error)); }
  else if (c.http >= 400){ st = 'bad'; text = 'HTTP ' + c.http; }
  else {
    var d = c.data || {};
    if (c.id === 'telerid' || c.id === 'hyd' || c.id === 'ews'){
      var up = c.id === 'telerid' ? d.teleridStatus : c.id === 'hyd' ? d.hydStatus
        : (d.probes || []).filter(function(p){ return /^https:/.test(p.url); })
            .map(function(p){ return p.url.replace(/^https:\/\/([^.]+).*$/, '$1') + ' ' + (p.status || p.error); }).join(' · ');
      if (!d.ok){ st = 'bad'; text = 'ต่อต้นทางไม่ได้'; }
      else if (d.runsIn !== 'BKK'){ st = 'warn'; text = 'ไม่ได้รันที่ BKK'; }
      add('รันที่ศูนย์', '<span class="num">' + esc(d.runsIn || '—') + '</span>');
      add('ต่อต้นทาง', '<span class="num">' + esc(up == null ? '—' : up) + (d.ms != null ? ' · ' + d.ms + ' ms' : '') + '</span>');
      if (c.id === 'telerid' && d.shared && typeof d.shared === 'object'){
        add('ชุดสำรอง KV', '<span class="num">' + esc(d.shared.ageMin) + ' นาที</span>');
        if (d.shared.newestReading) add('ค่าวัดล่าสุด', '<span class="num">' + esc(new Date(d.shared.newestReading).toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' })) + ' น.</span>');
      }
    } else if (c.id === 'site'){
      add('service worker', '<span class="num">' + esc(c.sw || '—') + '</span>');
    } else if (where(c)) {
      add('รันที่ศูนย์', '<span class="num">' + esc(where(c)) + '</span>');
    }
  }
  if (c.ms != null) add('เวลาตอบ', '<span class="num">' + c.ms + ' ms</span>');
  return { state: st, html: '<div class="card"><div class="head"><span class="name">' + esc(meta.name) + '</span>' + pill(st, text || LABEL[st]) + '</div>' +
    '<div class="role">' + esc(meta.role) + '</div><dl>' + dl.join('') + '</dl></div>' };
}

function render(j){
  var states = [], byId = {};
  j.checks.forEach(function(c){ byId[c.id] = c; });
  renderHome(byId.home || { error:'no data' }, states);
  var cards = j.checks.filter(function(c){ return c.id !== 'home'; }).map(card);
  cards.forEach(function(c){ states.push(c.state); });
  document.getElementById('cards').innerHTML = cards.map(function(c){ return c.html; }).join('');
  var bad = states.filter(function(s){ return s === 'bad'; }).length, warn = states.filter(function(s){ return s === 'warn'; }).length;
  var sum = document.getElementById('summary');
  sum.innerHTML = bad ? '<span class="big">มีปัญหา ' + bad + ' รายการ</span>' + pill('bad', 'มีปัญหา ' + bad) + (warn ? pill('warn', 'ต้องดู ' + warn) : '')
    : warn ? '<span class="big">ทำงานได้ มี ' + warn + ' รายการที่ต้องดู</span>' + pill('warn', 'ต้องดู ' + warn)
    : '<span class="big">ทุกอย่างทำงานปกติ</span>' + pill('ok', 'ปกติทั้งหมด');
  lastAt = j.at;
  tick();
}
function tick(){
  if (!lastAt) return;
  document.getElementById('checked').textContent = 'ตรวจล่าสุด ' + timeTh(lastAt) + ' (' + age((Date.now() - lastAt) / 1000) + ' ที่แล้ว)';
}
function load(fresh){
  var btn = document.getElementById('refresh');
  btn.disabled = true; btn.textContent = 'กำลังตรวจ…';
  var url = location.pathname.replace(/\/$/, '') + '/data.json' + (fresh ? '?fresh=1' : '');
  return fetch(url, { cache:'no-store' }).then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(render)
    .catch(function(e){ document.getElementById('summary').innerHTML = '<span class="big">ตรวจไม่สำเร็จ: ' + esc(e.message) + '</span>' + pill('bad', 'ลองใหม่'); })
    .then(function(){ btn.disabled = false; btn.textContent = 'ตรวจตอนนี้'; clearTimeout(timer); timer = setTimeout(load, REFRESH_MS); });
}
document.getElementById('refresh').addEventListener('click', function(){ load(true); });
setInterval(tick, 15000);
document.addEventListener('visibilitychange', function(){ if (!document.hidden && Date.now() - lastAt > REFRESH_MS) load(); });
load();
</script>
</body>
</html>`;
