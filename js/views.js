/* js/views.js · ป้ายจำนวนผู้เข้าชม มุมขวาล่างของทุกหน้า + ตัวนับกลางของเว็บ
 * ใส่ในทุกหน้า (หลัง js/supabase-client.js):
 *   <script src="js/views.js?v=3" defer></script>
 *
 * - นับผ่าน RPC track_view() ใน Supabase (supabase/schema-v10.sql)
 *   ถ้ายังไม่ได้รัน v10 จะถอยไปใช้ bump_page_view() ของ v9 ให้อัตโนมัติ
 * - นับหน้าละ 1 ครั้งต่อ session (กด F5 ซ้ำไม่เพิ่มยอด) · ครั้งต่อไปอ่านอย่างเดียว
 * - "ผู้เข้าชม" นับเบราว์เซอร์ละ 1 ครั้งต่อวัน โดยเก็บแค่ "วันที่" ไว้ใน localStorage
 *   ไม่มีรหัสประจำตัว ไม่มี cookie ไม่มี IP ทั้งบนเครื่องและบนฐานข้อมูล (PDPA)
 * - ถ้าออฟไลน์หรือ RPC ล้มเหลว → ซ่อนป้ายไปเงียบ ๆ ไม่ขึ้น error ไม่ทำหน้าพัง
 */
(function () {
  'use strict';

  if (typeof sb === 'undefined' || !sb) return;   // ไม่มี supabase-client.js บนหน้านี้

  /* ---------- ตัวช่วยเวลาไทย ----------
     เครื่องผู้ใช้ตั้งโซนเวลาอะไรก็ได้ แต่ "วันนี้" ของสถิติต้องเป็นวันไทยเสมอ
     ไม่งั้นยอดของคนที่ตั้งเครื่องเป็นโซนอื่นจะไปตกวันผิด */
  function bkkDate() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date());
    } catch (e) { return new Date().toISOString().slice(0, 10); }
  }

  function bkkHour() {
    try {
      var h = parseInt(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false
      }).format(new Date()), 10);
      return isNaN(h) ? new Date().getHours() : (h % 24);
    } catch (e) { return new Date().getHours(); }
  }

  /* ---------- มิติที่เก็บ: หยาบพอที่จะไม่ชี้ตัวใครได้ ---------- */
  function deviceClass() {
    var coarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
    if (!coarse) return 'desktop';
    var w = window.innerWidth || (window.screen && window.screen.width) || 0;
    return w >= 768 ? 'tablet' : 'mobile';
  }

  /* ที่มา: เก็บเฉพาะชื่อโฮสต์ ไม่เก็บ path และไม่เก็บ query string
     (ลิงก์จาก Google/Facebook มีคำค้นและรหัสติดมาใน query string จึงต้องตัดทิ้ง) */
  function refHost() {
    try {
      if (!document.referrer) return 'direct';
      var h = new URL(document.referrer).hostname.toLowerCase().replace(/^www\./, '');
      var me = location.hostname.toLowerCase().replace(/^www\./, '');
      return h === me ? 'internal' : h;
    } catch (e) { return 'direct'; }
  }

  /* หน้าไหน: ตัด origin และ index.html ออก ให้ '/' กับ '/index.html' นับรวมกัน */
  function currentPath() {
    var p = location.pathname.replace(/\/index\.html?$/i, '/');
    return p || '/';
  }

  var VISIT_KEY = 'nf_visit_day';

  /* เป็นผู้เข้าชมคนใหม่ของวันนี้หรือยัง — ยังไม่เขียน flag จนกว่าจะส่งสำเร็จ
     ถ้าเขียนก่อนแล้วเน็ตหลุด ยอดผู้เข้าชมของวันนั้นจะหายไปทั้งคน */
  function isFirstVisitToday() {
    try { return localStorage.getItem(VISIT_KEY) !== bkkDate(); }
    catch (e) { return false; }    // โหมดส่วนตัว: ไม่นับ ดีกว่านับซ้ำทุกครั้งที่เปิด
  }
  function markVisitedToday() {
    try { localStorage.setItem(VISIT_KEY, bkkDate()); } catch (e) {}
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
    'background:rgba(66,61,56,.82);color:var(--card-2);' +
    'font-family:inherit;font-size:11.5px;line-height:1;font-variant-numeric:tabular-nums;' +
    'padding:6px 10px;border-radius:99px;border:1px solid rgba(255,255,255,.12);' +
    'box-shadow:0 2px 8px rgba(0,0,0,.22);backdrop-filter:blur(4px);' +
    'pointer-events:none;user-select:none}' +
    '#viewCounter b{font-weight:700;font-size:12.5px;color:#fff}' +
    '#viewCounter small{font-size:10px;color:var(--ink-3)}' +
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

  /* แถบเครดิต Leaflet อยู่มุมขวาล่างเหมือนกัน · ต้องไม่บัง (เงื่อนไขการใช้แผนที่ OSM) */
  function liftAboveLeaflet() {
    if (document.querySelector('.leaflet-control-attribution')) el.classList.add('above-attrib');
  }

  function render(total, today, visitorsToday) {
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
    el.title = 'เปิดหน้าเว็บทั้งหมด ' + fmt(total) + ' ครั้ง · วันนี้ ' + fmt(today) + ' ครั้ง' +
               (visitorsToday != null ? ' จากผู้เข้าชม ' + fmt(visitorsToday) + ' คน' : '');
    el.hidden = false;
  }

  async function run() {
    var path = currentPath();
    var key = 'pv:' + path;
    var counted = false;
    try { counted = sessionStorage.getItem(key) === '1'; } catch (e) { /* private mode */ }

    var isNew = !counted && isFirstVisitToday();
    var res;

    if (counted) {
      res = await sb.rpc('get_page_views');
    } else {
      res = await sb.rpc('track_view', {
        p_path: path,
        p_new_visitor: isNew,
        p_device: deviceClass(),
        p_ref: refHost(),
        p_hour: bkkHour()
      });
      // ยังไม่ได้รัน schema-v10.sql → ถอยไปใช้ตัวนับเดิมของ v9 ป้ายจะได้ไม่หาย
      if (res.error) { res = await sb.rpc('bump_page_view', { p_path: path }); isNew = false; }
    }

    if (res.error) return;                       // ออฟไลน์ / ยังไม่ได้รัน v9 → ไม่ต้องแสดง
    var row = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!row) return;

    if (!counted) { try { sessionStorage.setItem(key, '1'); } catch (e) {} }
    if (isNew) markVisitedToday();

    render(row.total || 0, row.today || 0,
           row.visitors_today == null ? null : row.visitors_today);
  }

  function init() {
    mount();
    run()
      .catch(function () {})
      // การ์ดสถิติหน้าแรกรอสัญญาณนี้ ตัวเลขจะได้รวมการเข้าครั้งนี้ด้วย
      .then(function () { document.dispatchEvent(new CustomEvent('naraflood:counted')); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
