/* js/ui.js — ปรับแถบเมนูให้ใช้งานง่ายบนมือถือ
 * ใส่ในทุกหน้า: <script src="js/ui.js" defer></script>
 * - เลื่อนแท็บหน้าปัจจุบันให้เห็นเสมอเมื่อเปิดหน้า (เมนูมีถึง 12 แท็บ เลื่อนแนวนอน)
 * - เพิ่มเงาจาง ๆ ที่ขอบขวาให้รู้ว่ายังมีแท็บถัดไป (แถบเลื่อนถูกซ่อนไว้)
 */
(function () {
  'use strict';

  function setup(nav) {
    // เงาขอบขวา: แสดงเมื่อยังเลื่อนต่อได้ ซ่อนเมื่อเลื่อนสุดแล้ว
    function affordance() {
      var scrollable = nav.scrollWidth - nav.clientWidth > 4;
      nav.classList.toggle('is-scrollable', scrollable);
      nav.classList.toggle('at-end', scrollable && nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 4);
    }

    // เลื่อนแท็บที่กำลังเปิดอยู่มาให้เห็น
    var active = nav.querySelector('a.on');
    if (active && nav.scrollWidth > nav.clientWidth) {
      var target = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
      nav.scrollLeft = Math.max(0, target);
    }

    affordance();
    nav.addEventListener('scroll', affordance, { passive: true });
    window.addEventListener('resize', affordance);
  }

  function init() {
    var navs = document.querySelectorAll('.navtab');
    for (var i = 0; i < navs.length; i++) setup(navs[i]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
