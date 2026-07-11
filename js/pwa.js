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
