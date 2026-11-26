/* js/announce.js · ป๊อปอัพประกาศเตือนภัยชั่วคราว (รูปภาพเต็มจอ)
 * ใส่ในทุกหน้า: <script src="js/announce.js?v=2" defer></script>
 *
 * กฎการโผล่
 *   • แสดงวันละครั้ง เฉพาะครั้งแรกที่เข้าในวันนั้น (นับวันตามเวลาไทย ขึ้นวันใหม่ตอนเที่ยงคืน)
 *     จำวันที่แสดงล่าสุดไว้ใน localStorage ตั้งแต่ตอนที่แสดง มือถือกับคอมเก็บแยกกัน
 *   • หมดเวลา UNTIL แล้วไม่แสดง และไม่โหลดรูปเลย
 *   • ปิดได้ด้วยปุ่ม ×, ปุ่ม "รับทราบ", แตะพื้นหลัง หรือกด Esc
 *
 * ประกาศใหม่: เปลี่ยน ID (ให้ทุกคนเห็นทันทีแม้วันนี้เห็นประกาศเดิมแล้ว), IMG, ALT, UNTIL แล้วเพิ่ม ?v= ในหน้าเว็บ
 */
(function () {
  'use strict';

  var ID    = 'nwt-rain-2569-11-27';
  var IMG   = 'announce/rain-warning-2569-11-27.webp';
  var ALT   = 'นราธิวาสแจ้งเตือน 13 อำเภอ ฝนตกหนักถึงหนักมาก ช่วงวันที่ 27–30 พฤศจิกายน 2569 ' +
              'เฝ้าระวังน้ำท่วมฉับพลัน น้ำป่าไหลหลาก ดินโคลนถล่ม น้ำท่วมขัง ' +
              'ชาวเรือควรเดินเรือด้วยความระมัดระวัง หากเกิดเหตุฉุกเฉินโทรสายด่วนนิรภัย 1784';
  /* 30 พ.ย. 2569 (ค.ศ. 2026) เวลา 23:00 น. เวลาประเทศไทย */
  var UNTIL = Date.parse('2026-11-30T23:00:00+07:00');
  var KEY   = 'naraflood.announce.' + ID;

  if (!(Date.now() < UNTIL)) return;
  /* วันที่วันนี้ตามเวลาไทย (UTC+7) เช่น "2026-11-27" ไม่ขึ้นกับโซนเวลาที่ตั้งในเครื่อง */
  var today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  try {
    if (localStorage.getItem(KEY) === today) return;
    localStorage.setItem(KEY, today);
  } catch (e) { /* โหมดส่วนตัวบางเบราว์เซอร์เขียนไม่ได้ → แสดงตามปกติ */ }

  var css =
    '.ann-back{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.72);display:flex;' +
      'align-items:center;justify-content:center;padding:max(12px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom));' +
      'animation:annIn .18s ease-out}' +
    '.ann-box{position:relative;display:flex;flex-direction:column;align-items:center;gap:10px;max-width:min(560px,100%);max-height:100%}' +
    '.ann-box img{display:block;max-width:100%;max-height:calc(100vh - 96px);' +
      'width:auto;height:auto;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.5);background:#1b2a4a}' +
    '@supports (height:100dvh){.ann-box img{max-height:calc(100dvh - 96px)}}' +
    '.ann-x{position:absolute;top:-10px;right:-10px;width:40px;height:40px;border-radius:50%;border:2px solid #fff;' +
      'background:#c62828;color:#fff;font:700 24px/1 system-ui,sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.4)}' +
    '.ann-ok{min-width:160px;min-height:44px;padding:0 22px;border:0;border-radius:999px;background:#fff;color:#111;' +
      'font:600 16px/1 "Anuphan","Noto Sans Thai",Tahoma,sans-serif;cursor:pointer}' +
    '.ann-x:focus-visible,.ann-ok:focus-visible{outline:3px solid #ffd54f;outline-offset:2px}' +
    '@keyframes annIn{from{opacity:0}to{opacity:1}}' +
    '@media (prefers-reduced-motion:reduce){.ann-back{animation:none}}';

  function show() {
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    var back = document.createElement('div');
    back.className = 'ann-back';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-label', 'ประกาศเตือนภัย');
    back.innerHTML =
      '<div class="ann-box">' +
        '<img alt="" decoding="async">' +
        '<button type="button" class="ann-x" aria-label="ปิดประกาศ">×</button>' +
        '<button type="button" class="ann-ok">รับทราบ</button>' +
      '</div>';
    var img = back.querySelector('img');
    img.alt = ALT;
    img.src = IMG;

    var prevFocus = document.activeElement;
    var prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    function close() {
      document.removeEventListener('keydown', onKey, true);
      document.documentElement.style.overflow = prevOverflow;
      back.remove();
      st.remove();
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) {}
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') {   /* วนโฟกัสอยู่ในกล่อง */
        var b = back.querySelectorAll('button'), first = b[0], last = b[b.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    back.addEventListener('click', function (e) {
      if (e.target === back || e.target.closest('.ann-x,.ann-ok')) close();
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(back);
    back.querySelector('.ann-ok').focus({ preventScroll: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
  else show();
})();
