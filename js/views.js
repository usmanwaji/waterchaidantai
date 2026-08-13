/* js/views.js — ป้ายจำนวนผู้เข้าชม มุมขวาล่างของทุกหน้า
 * ใส่ในทุกหน้า (หลัง js/supabase-client.js):
 *   <script src="js/views.js" defer></script>
 *
 * - นับผ่าน RPC bump_page_view() ใน Supabase (supabase/schema-v9.sql)
 * - นับหน้าละ 1 ครั้งต่อ session (กด F5 ซ้ำไม่เพิ่มยอด) — ครั้งต่อไปอ่านอย่างเดียว
 * - ถ้ายังไม่ได้รัน schema-v9.sql หรือออฟไลน์ → ซ่อนป้ายไปเงียบ ๆ ไม่ขึ้น error
 * - ไม่เก็บ cookie / IP / ตัวตนผู้ใช้ ฝั่ง client เก็บแค่ flag ใน sessionStorage
 */
(function () {
  'use strict';

  if (typeof sb === 'undefined' || !sb) return;   // ไม่มี supabase-client.js บนหน้านี้

  /* หน้าไหน: ตัด origin และ index.html ออก ให้ '/' กับ '/index.html' นับรวมกัน */
  function currentPath() {
    var p = location.pathname.replace(/\/index\.html?$/i, '/');
    return p || '/';
  }

  var fmt = function (n) {
    try { return Number(n).toLocaleString('th-TH'); } catch (e) { return String(n); }
  };

  /* ---------- ป้าย ---------- */
  var el = document.createElement('div');
  el.id = 'viewCounter';
  el.hidden = true;
  el.setAttribute('role', 'status');

  var css = document.createElement('style');
  css.textContent =
    '#viewCounter{position:fixed;right:10px;bottom:10px;z-index:900;' +
    'display:flex;align-items:baseline;gap:6px;' +
    'background:rgba(66,61,56,.82);color:#f3f4f6;' +
    'font-family:inherit;font-size:11.5px;line-height:1;font-variant-numeric:tabular-nums;' +
    'padding:6px 10px;border-radius:99px;border:1px solid rgba(255,255,255,.12);' +
    'box-shadow:0 2px 8px rgba(0,0,0,.22);backdrop-filter:blur(4px);' +
    'pointer-events:none;user-select:none}' +
    '#viewCounter b{font-weight:700;font-size:12.5px;color:#fff}' +
    '#viewCounter small{font-size:10px;color:#cfc8c0}' +
    /* หน้าที่มีแผนที่เต็มจอ: ยกขึ้นเหนือแถบเครดิต Leaflet มุมขวาล่าง */
    '#viewCounter.above-attrib{bottom:26px}' +
    '@media(max-width:768px){#viewCounter{right:8px;bottom:8px;font-size:11px;padding:5px 9px}' +
    '#viewCounter.above-attrib{bottom:24px}}' +
    '@supports(padding:max(0px)){#viewCounter{' +
    'right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom))}' +
    '#viewCounter.above-attrib{bottom:calc(26px + env(safe-area-inset-bottom))}}' +
    '@media print{#viewCounter{display:none}}';

  function mount() {
    document.head.appendChild(css);
    document.body.appendChild(el);
    liftAboveLeaflet();
    window.addEventListener('load', liftAboveLeaflet);
  }

  /* แถบเครดิต Leaflet อยู่มุมขวาล่างเหมือนกัน — ต้องไม่บัง (เงื่อนไขการใช้แผนที่ OSM) */
  function liftAboveLeaflet() {
    if (document.querySelector('.leaflet-control-attribution')) el.classList.add('above-attrib');
  }

  function render(total, today) {
    el.innerHTML = '';
    var eye = document.createElement('span'); eye.textContent = '👁';
    var b = document.createElement('b'); b.textContent = fmt(total);
    var unit = document.createElement('small'); unit.textContent = 'ครั้ง';
    el.append(eye, b, unit);
    if (today > 0) {
      var t = document.createElement('small');
      t.textContent = '· วันนี้ ' + fmt(today);
      el.append(t);
    }
    el.title = 'ผู้เข้าชมทั้งเว็บ ' + fmt(total) + ' ครั้ง — วันนี้ ' + fmt(today) + ' ครั้ง';
    el.hidden = false;
  }

  async function run() {
    var path = currentPath();
    var key = 'pv:' + path;
    var counted = false;
    try { counted = sessionStorage.getItem(key) === '1'; } catch (e) { /* private mode */ }

    var res = counted
      ? await sb.rpc('get_page_views')
      : await sb.rpc('bump_page_view', { p_path: path });

    if (res.error) return;                       // ยังไม่ได้รัน schema-v9.sql / ออฟไลน์ → ไม่ต้องแสดง
    var row = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!row) return;

    if (!counted) { try { sessionStorage.setItem(key, '1'); } catch (e) {} }
    render(row.total || 0, row.today || 0);
  }

  function init() { mount(); run().catch(function () {}); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
