/* js/pwa.js — ลงทะเบียน Service Worker + ป้ายแจ้งเตือนออฟไลน์
 * ใส่ในทุกหน้า: <script src="js/pwa.js" defer></script>
 * ไฟล์นี้เพิ่ม <link rel="manifest"> ให้เอง จึงไม่ต้องแก้ <head> ของแต่ละหน้า
 */
(function () {
  'use strict';

  // เพิ่ม manifest + theme-color ถ้ายังไม่มี
  if (!document.querySelector('link[rel="manifest"]')) {
    const l = document.createElement('link');
    l.rel = 'manifest'; l.href = 'manifest.json';
    document.head.appendChild(l);
  }
  if (!document.querySelector('meta[name="theme-color"]')) {
    const m = document.createElement('meta');
    m.name = 'theme-color'; m.content = '#423d38';
    document.head.appendChild(m);
  }

  // ลงทะเบียน service worker (เฉพาะ https หรือ localhost)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  // ป้ายแจ้งออฟไลน์ (แสดงชุดข้อมูลล่าสุดที่แคชไว้)
  function banner() {
    let b = document.getElementById('offlineBanner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'offlineBanner';
      b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#78350f;color:#fff;font:600 12.5px/1.4 "Noto Sans Thai",Tahoma,sans-serif;padding:8px 14px;text-align:center;box-shadow:0 -2px 8px rgba(0,0,0,.25)';
      document.body.appendChild(b);
    }
    return b;
  }
  function update() {
    const b = banner();
    if (navigator.onLine) { b.style.display = 'none'; }
    else {
      b.style.display = 'block';
      b.textContent = '⚠️ ออฟไลน์อยู่ — กำลังแสดงข้อมูลชุดล่าสุดที่โหลดได้ก่อนหน้า (อาจไม่เป็นปัจจุบัน)';
    }
  }
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  if (!navigator.onLine) update();
})();

/* ================= พิมพ์เป็น PDF (A4 แนวตั้ง) =================
 * ปุ่ม 🖨️ ลอยมุมขวาล่างทุกหน้า → window.print() (เลือก "Save as PDF" ได้)
 * สไตล์ @media print จัดหน้าให้พอดี A4 แนวตั้งอัตโนมัติ */
(function () {
  'use strict';

  /* ---- สไตล์สำหรับพิมพ์ ---- */
  const css = `
@page { size: A4 portrait; margin: 10mm; }
@media print {
  html, body { width:auto !important; height:auto !important; min-height:0 !important;
    overflow:visible !important; background:#fff !important; display:block !important; }
  /* ห้ามพิมพ์โค้ด/องค์ประกอบที่ซ่อนอยู่เด็ดขาด */
  script, style, template, noscript { display:none !important; }
  [hidden], .hide, .modal, #wrfModal, #helpModal, #imgModal, #shModal, #pickBanner,
  [id$="Modal"], [id$="modal"] { display:none !important; }
  /* คลี่คอนเทนเนอร์ที่เลื่อนสกอลล์ให้ยาวเต็มเนื้อหา (ไม่ยุ่งกับ display เดิม) */
  body div, body main, body section, body aside {
    overflow:visible !important; max-height:none !important; }
  body > * , #wrap, #content, #main { height:auto !important; flex:none !important; }
  #wrap, #content, #main { display:block !important; }
  /* ซ่อนส่วนโต้ตอบ/นำทาง */
  nav.navtab, footer, button, select, input, textarea, details:not([open]) summary,
  #printFab, #selbar, #bar, #authBox, #offlineBanner,
  .chip, .pbtn, .provbtn, .src-btn, .vbtn, .btn,
  .leaflet-control-container, .gm-style-cc, .gmnoprint { display:none !important; }
  /* หัวหน้าเว็บ: พื้นขาว ตัวหนังสือดำ */
  header { background:#fff !important; color:#000 !important; box-shadow:none !important; padding:0 0 6px !important; }
  header h1, header h1 small { color:#000 !important; }
  /* แผนที่: ตรึงความสูงพอดีหน้ากระดาษ ไม่ให้ tile ล้น */
  #map, #ddpm-map, .leaflet-container { max-height:150mm !important; width:100% !important;
    overflow:hidden !important; page-break-inside:avoid; border:1px solid #ccc; }
  /* กันการ์ด/แถว/กราฟโดนตัดกลางหน้า */
  .card, .provcard, .wtaCol, .sumcard, .item, .notice, .ex, tr, svg, canvas, img { page-break-inside:avoid; }
  h1,h2,h3 { page-break-after:avoid; }
  table { width:100% !important; border-collapse:collapse; }
  a { color:#000 !important; text-decoration:none !important; }
  * { box-shadow:none !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  #printMeta { display:block !important; }
}
#printMeta { display:none; font:600 11px "Noto Sans Thai",Tahoma,sans-serif; color:#475569;
  border-bottom:1px solid #cbd5e1; padding-bottom:4px; margin-bottom:8px; }
#printFab { position:fixed; right:14px; bottom:64px; z-index:9998; width:46px; height:46px;
  border-radius:50%; border:none; cursor:pointer; font-size:20px; line-height:1;
  background:#423d38; color:#fff; box-shadow:0 3px 10px rgba(0,0,0,.35); }
#printFab:hover { transform:scale(1.06); }
@media (max-width:640px){ #printFab{ right:10px; bottom:72px; width:42px; height:42px; } }`;
  const st = document.createElement('style');
  st.id = 'printA4css';
  st.textContent = css;
  document.head.appendChild(st);

  /* ---- แถบข้อมูลบนหัวกระดาษ (แสดงเฉพาะตอนพิมพ์) ---- */
  function ensureMeta() {
    let m = document.getElementById('printMeta');
    if (!m) {
      m = document.createElement('div');
      m.id = 'printMeta';
      document.body.insertBefore(m, document.body.firstChild);
    }
    const t = (document.querySelector('header h1')?.textContent || document.title).replace(/\s+/g, ' ').trim();
    m.textContent = '🖨️ ' + t + ' — One Map หาดใหญ่ · พิมพ์เมื่อ ' +
      new Date().toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' }) +
      ' · ขนาด A4 แนวตั้ง';
    return m;
  }

  /* ---- ตรึงความสูงแผนที่ก่อนพิมพ์ (กัน layout ยุบเมื่อ flex ถูกปิด) ---- */
  function fixHeights() {
    document.querySelectorAll('#map, #ddpm-map, .leaflet-container').forEach(el => {
      const h = el.offsetHeight;
      if (h > 60) el.style.height = Math.min(h, 560) + 'px';
    });
    // คลี่ <details> ให้เนื้อหาในนั้นถูกพิมพ์ด้วย
    document.querySelectorAll('details:not([open])').forEach(d => { d.dataset.wasClosed = '1'; d.open = true; });
  }
  function restore() {
    document.querySelectorAll('details[data-was-closed]').forEach(d => { d.open = false; delete d.dataset.wasClosed; });
  }
  window.addEventListener('beforeprint', () => { ensureMeta(); fixHeights(); });
  window.addEventListener('afterprint', restore);

  /* ---- ปุ่มพิมพ์ ---- */
  function addBtn() {
    if (document.getElementById('printFab')) return;
    const b = document.createElement('button');
    b.id = 'printFab';
    b.type = 'button';
    b.title = 'พิมพ์หน้านี้เป็น PDF (A4 แนวตั้ง)';
    b.setAttribute('aria-label', 'พิมพ์หน้านี้เป็น PDF ขนาด A4 แนวตั้ง');
    b.textContent = '🖨️';
    b.onclick = () => { ensureMeta(); fixHeights(); setTimeout(() => window.print(), 60); };
    document.body.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addBtn);
  else addBtn();
})();
