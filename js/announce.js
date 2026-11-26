/* js/announce.js · ป๊อปอัพประกาศเตือนภัยชั่วคราว (รูปภาพเต็มจอ ปัดซ้าย-ขวาดูได้หลายรูป)
 * ใส่ในทุกหน้า: <script src="js/announce.js?v=3" defer></script>
 *
 * กฎการโผล่
 *   • วันละไม่เกิน PER_DAY ครั้งต่อเครื่อง/เบราว์เซอร์ (นับวันตามเวลาไทย ขึ้นวันใหม่ตอนเที่ยงคืน)
 *     จำ {วันที่, จำนวนครั้ง} ไว้ใน localStorage ตั้งแต่ตอนที่แสดง มือถือกับคอมเก็บแยกกัน
 *   • เปิดเว็บรอบเดียวกัน (แท็บเดิม) เห็นแล้วกดไปหน้าอื่นจะไม่ขึ้นซ้ำ (sessionStorage)
 *     ครั้งที่สองของวันจึงเป็นการกลับมาเปิดเว็บใหม่จริง ๆ ไม่ใช่แค่เปลี่ยนหน้า
 *   • หมดเวลา UNTIL แล้วไม่แสดง และไม่โหลดรูปเลย
 *   • ปัดซ้ายดูรูปถัดไป หรือกดลูกศร/ปุ่ม "ถัดไป" (จอคอมใช้ปุ่ม ← → ได้)
 *   • ปิดได้ด้วยปุ่ม ×, ปุ่ม "รับทราบ" (รูปสุดท้าย), แตะพื้นหลัง หรือกด Esc
 *
 * ประกาศใหม่: เปลี่ยน ID (ให้ทุกคนเห็นทันทีแม้วันนี้เห็นครบแล้ว), SLIDES, UNTIL แล้วเพิ่ม ?v= ในหน้าเว็บ
 */
(function () {
  'use strict';

  var ID = 'nwt-rain-2569-11-27';
  var SLIDES = [
    { src: 'announce/rain-warning-2569-11-27.webp', w: 1122, h: 1402,
      alt: 'นราธิวาสแจ้งเตือน 13 อำเภอ ฝนตกหนักถึงหนักมาก ช่วงวันที่ 27–30 พฤศจิกายน 2569 ' +
           'เฝ้าระวังน้ำท่วมฉับพลัน น้ำป่าไหลหลาก ดินโคลนถล่ม น้ำท่วมขัง ' +
           'ชาวเรือควรเดินเรือด้วยความระมัดระวัง หากเกิดเหตุฉุกเฉินโทรสายด่วนนิรภัย 1784' },
    { src: 'announce/letter-2569-11-26-p1.webp', w: 1242, h: 1755,
      alt: 'หนังสือกองอำนวยการป้องกันและบรรเทาสาธารณภัยจังหวัดนราธิวาส ด่วนที่สุด ลงวันที่ 26 พฤศจิกายน 2569 หน้า 1: ' +
           'กรมอุตุนิยมวิทยาแจ้งว่าช่วงวันที่ 27–30 พฤศจิกายน 2569 ภาคใต้จะมีฝนตกหนักถึงหนักมากบางแห่ง ' +
           'จังหวัดนราธิวาสอาจเกิดน้ำท่วมฉับพลัน น้ำป่าไหลหลาก ดินโคลนถล่ม และน้ำท่วมขัง ' +
           'ให้ทุกอำเภอเตรียมพร้อมรับมือ เฝ้าระวังพื้นที่เสี่ยงตลอด 24 ชั่วโมง และจัดเตรียมศูนย์พักพิงชั่วคราว' },
    { src: 'announce/letter-2569-11-26-p2.webp', w: 1242, h: 1755,
      alt: 'หนังสือหน้า 2: ให้ประชาสัมพันธ์ผ่านสื่อออนไลน์ หอกระจายข่าว วิทยุท้องถิ่น และวิทยุชุมชน ' +
           'ลงนามโดยนายบุญช่วย หอมยามเย็น ผู้ว่าราชการจังหวัดนราธิวาส ' +
           'สำนักงาน ปภ.จังหวัด ฝ่ายป้องกันและปฏิบัติการ โทร 0 7353 2134' }
  ];
  var PER_DAY = 2;
  /* 30 พ.ย. 2569 (ค.ศ. 2026) เวลา 23:00 น. เวลาประเทศไทย */
  var UNTIL = Date.parse('2026-11-30T23:00:00+07:00');
  var KEY = 'naraflood.announce.' + ID;

  if (!(Date.now() < UNTIL)) return;
  try { if (sessionStorage.getItem(KEY)) return; } catch (e) {}

  /* วันที่วันนี้ตามเวลาไทย (UTC+7) เช่น "2026-11-27" ไม่ขึ้นกับโซนเวลาที่ตั้งในเครื่อง */
  var today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  try {
    var raw = localStorage.getItem(KEY), rec = null;
    try { rec = JSON.parse(raw); } catch (e) {}
    /* รุ่นก่อนเก็บเป็นวันที่เปล่า ๆ ("2026-11-26") = เห็นไปแล้ว 1 ครั้งในวันนั้น */
    if (!rec || typeof rec !== 'object') rec = raw ? { d: String(raw), n: 1 } : { d: '', n: 0 };
    var n = rec.d === today ? (+rec.n || 0) : 0;
    if (n >= PER_DAY) return;
    localStorage.setItem(KEY, JSON.stringify({ d: today, n: n + 1 }));
  } catch (e) { /* โหมดส่วนตัวบางเบราว์เซอร์เขียนไม่ได้ → แสดงตามปกติ */ }
  try { sessionStorage.setItem(KEY, '1'); } catch (e) {}

  var FONT = '"Anuphan","Noto Sans Thai",Tahoma,sans-serif';
  var css =
    '.ann-back{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.78);display:flex;' +
      'align-items:center;justify-content:center;padding:max(10px,env(safe-area-inset-top)) 10px max(10px,env(safe-area-inset-bottom));' +
      'animation:annIn .18s ease-out}' +
    '.ann-box{position:relative;display:flex;flex-direction:column;align-items:center;gap:8px;width:min(560px,100%);max-height:100%}' +
    '.ann-track{display:flex;width:100%;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;' +
      'scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;border-radius:10px}' +
    '.ann-track::-webkit-scrollbar{display:none}' +
    '.ann-slide{flex:0 0 100%;display:flex;align-items:center;justify-content:center;scroll-snap-align:center;scroll-snap-stop:always}' +
    '.ann-slide img{display:block;max-width:100%;max-height:calc(100vh - 130px);width:auto;height:auto;' +
      'border-radius:10px;background:#fff;box-shadow:0 10px 40px rgba(0,0,0,.5);user-select:none;-webkit-user-drag:none}' +
    '@supports (height:100dvh){.ann-slide img{max-height:calc(100dvh - 130px)}}' +
    '.ann-x{position:absolute;top:-8px;right:-8px;z-index:2;width:40px;height:40px;border-radius:50%;border:2px solid #fff;' +
      'background:#c62828;color:#fff;font:700 24px/1 system-ui,sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.4)}' +
    '.ann-hint{color:#fff;font:500 14px/1.3 ' + FONT + ';text-align:center;min-height:18px}' +
    '.ann-hint a{color:#ffe082}' +
    '.ann-bar{display:flex;align-items:center;justify-content:center;gap:10px;width:100%}' +
    '.ann-nav{width:44px;height:44px;flex:0 0 44px;border-radius:50%;border:0;background:rgba(255,255,255,.18);color:#fff;' +
      'font:700 26px/1 system-ui,sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center}' +
    '.ann-nav:disabled{opacity:.3;cursor:default}' +
    '.ann-dots{display:flex;gap:7px}' +
    '.ann-dots i{width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,.4);transition:background .15s,transform .15s}' +
    '.ann-dots i.on{background:#fff;transform:scale(1.25)}' +
    '.ann-ok{min-width:132px;min-height:44px;padding:0 20px;border:0;border-radius:999px;background:#fff;color:#111;' +
      'font:600 16px/1 ' + FONT + ';cursor:pointer}' +
    '.ann-back button:focus-visible,.ann-back a:focus-visible{outline:3px solid #ffd54f;outline-offset:2px}' +
    '@keyframes annIn{from{opacity:0}to{opacity:1}}' +
    '@media (prefers-reduced-motion:reduce){.ann-back{animation:none}.ann-track{scroll-behavior:auto}}';

  function show() {
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    var N = SLIDES.length;
    var back = document.createElement('div');
    back.className = 'ann-back';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-label', 'ประกาศเตือนภัย');
    back.innerHTML =
      '<div class="ann-box">' +
        '<div class="ann-track" aria-roledescription="carousel"></div>' +
        '<button type="button" class="ann-x" aria-label="ปิดประกาศ">×</button>' +
        '<div class="ann-hint" aria-live="polite"></div>' +
        '<div class="ann-bar">' +
          '<button type="button" class="ann-nav ann-prev" aria-label="รูปก่อนหน้า">‹</button>' +
          '<div class="ann-dots" aria-hidden="true"></div>' +
          '<button type="button" class="ann-nav ann-next" aria-label="รูปถัดไป">›</button>' +
          '<button type="button" class="ann-ok"></button>' +
        '</div>' +
      '</div>';
    var track = back.querySelector('.ann-track');
    var dots = back.querySelector('.ann-dots');
    var hint = back.querySelector('.ann-hint');
    var prev = back.querySelector('.ann-prev');
    var next = back.querySelector('.ann-next');
    var ok = back.querySelector('.ann-ok');

    SLIDES.forEach(function (s, i) {
      var sl = document.createElement('div');
      sl.className = 'ann-slide';
      sl.setAttribute('role', 'group');
      sl.setAttribute('aria-label', 'รูปที่ ' + (i + 1) + ' จาก ' + N);
      var img = document.createElement('img');
      img.alt = s.alt;
      img.width = s.w; img.height = s.h;
      img.decoding = 'async';
      img.draggable = false;
      if (i > 0) img.loading = 'lazy';
      img.src = s.src;
      sl.appendChild(img);
      track.appendChild(sl);
      dots.appendChild(document.createElement('i'));
    });
    if (N < 2) { prev.hidden = next.hidden = true; dots.hidden = true; }

    var cur = -1;
    function setCur(i) {
      if (i === cur) return;
      cur = i;
      for (var k = 0; k < N; k++) dots.children[k].className = k === i ? 'on' : '';
      prev.disabled = i === 0;
      next.disabled = i === N - 1;
      var last = i === N - 1;
      ok.textContent = last ? 'รับทราบ' : 'ถัดไป ›';
      hint.innerHTML = (N > 1 ? (i + 1) + '/' + N + ' · ' : '') +
        (last ? '' : 'ปัดซ้ายเพื่อดูต่อ · ') +
        '<a href="' + SLIDES[i].src + '" target="_blank" rel="noopener">ดูภาพขนาดเต็ม</a>';
    }
    function go(i) {
      i = Math.max(0, Math.min(N - 1, i));
      track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
      setCur(i);
    }
    var raf = 0;
    track.addEventListener('scroll', function () {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        setCur(Math.round(track.scrollLeft / Math.max(1, track.clientWidth)));
      });
    }, { passive: true });
    setCur(0);

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
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(cur + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(cur - 1); }
      else if (e.key === 'Tab') {   /* วนโฟกัสอยู่ในกล่อง */
        var f = Array.prototype.filter.call(back.querySelectorAll('button,a'), function (el) {
          return !el.disabled && !el.hidden && el.offsetParent !== null;
        });
        var first = f[0], lastEl = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
      }
    }
    back.addEventListener('click', function (e) {
      if (e.target === back || e.target.closest('.ann-x')) close();
      else if (e.target.closest('.ann-prev')) go(cur - 1);
      else if (e.target.closest('.ann-next')) go(cur + 1);
      else if (e.target.closest('.ann-ok')) { if (cur >= N - 1) close(); else go(cur + 1); }
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(back);
    ok.focus({ preventScroll: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
  else show();
})();
