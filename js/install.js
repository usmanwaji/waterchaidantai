/* js/install.js · ปุ่มลอย "ติดตั้งแอป" มุมล่างซ้าย
 * ใส่ในทุกหน้า: <script src="js/install.js?v=1" defer></script>
 *
 * ปุ่มนี้ทำอะไร
 * กดครั้งเดียวแล้ว Android จะติดตั้งเว็บนี้เป็นแอป (PWA) และวางไอคอน naraflood
 * ไว้บนหน้าจอโฮมให้เลย เปิดครั้งต่อไปได้เต็มจอไม่มีแถบเบราว์เซอร์ ใช้ออฟไลน์ได้
 * ตาม sw.js และกดค้างที่ไอคอนจะได้ทางลัดสามอันจาก manifest.json
 * (เช็คพื้นที่ฉัน / ระดับน้ำ / ศูนย์พักพิง)
 *
 * ทำไมต้องมีปุ่มของเราเอง ในเมื่อ Chrome มีเมนู "ติดตั้งแอป" อยู่แล้ว
 * เพราะเมนูนั้นอยู่หลังปุ่มสามจุดมุมขวาบน ซึ่งคนที่เปิดเว็บนี้ตอนน้ำกำลังมา
 * ไม่มีใครไปเปิดหา แถบเชิญชวนของ Chrome เองก็โผล่เองไม่ได้ทุกเครื่อง
 * เว็บต้องเป็นฝ่ายขอเอง และต้องขอด้วยปุ่มที่เห็นด้วยตาว่ากดได้
 *
 * ทำไมอยู่มุมล่างซ้าย
 * มุมล่างขวาเป็นที่ของตัวนับผู้เข้าชม (js/views.js) และมือขวาของคนใช้เอง
 * มุมล่างซ้ายว่างในทุกหน้า และอยู่เหนือแถบแท็บพอที่นิ้วจะไม่กดพลาดเป็นแท็บแรก
 *
 * กฎการโผล่ (สำคัญกว่าตัวปุ่ม — ปุ่มที่ตามหลอกคือปุ่มที่ถูกปิดทิ้ง)
 *   • เปิดจากแอปที่ติดตั้งแล้ว (standalone / TWA) → ไม่ต้องขอ ไม่แสดงเลย
 *   • เคยกด "ไม่ต้องตอนนี้" หรือกดปิดปุ่ม → เงียบไป 14/30 วัน
 *   • เบราว์เซอร์ที่ติดตั้งไม่ได้บนจอคอม → ไม่แสดง ไม่มีอะไรให้กด
 */
(function () {
  'use strict';

  var SNOOZE_KEY = 'naraflood.install.snooze';   /* เวลาที่ครบกำหนดกลับมาแสดงได้ */
  var DAY = 86400000;
  var SNOOZE_DISMISS = 14 * DAY;   /* กดยกเลิกกล่องของระบบ = ยังไม่พร้อม */
  var SNOOZE_CLOSE   = 30 * DAY;   /* กดปิดปุ่มเอง = ไม่อยากเห็น */

  var ua = navigator.userAgent || '';
  var isAndroid = /Android/i.test(ua);
  var isIOS = /iPad|iPhone|iPod/i.test(ua) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isTouch = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;

  var deferred = null;   /* กล่อง beforeinstallprompt ที่เก็บไว้ ใช้ได้ครั้งเดียว */
  var dock = null;
  var shown = false;

  /* ---------- ติดตั้งไปแล้วหรือยัง ----------
     display-mode: standalone ครอบทั้ง PWA ที่ติดตั้งแล้วและ TWA บน Play Store
     navigator.standalone คือของ iOS ที่ยังไม่รู้จัก display-mode
     referrer android-app:// คือกรณีเปิดจากตัวแอป Android จริง */
  function installed() {
    var mm = window.matchMedia;
    return !!(
      (mm && (mm('(display-mode: standalone)').matches || mm('(display-mode: minimal-ui)').matches)) ||
      navigator.standalone === true ||
      document.referrer.indexOf('android-app://') === 0
    );
  }

  function snoozed() {
    try { return Date.now() < (+localStorage.getItem(SNOOZE_KEY) || 0); }
    catch (e) { return false; }
  }
  function snooze(ms) {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + ms)); } catch (e) {}
  }

  function svg(paths) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>';
  }

  /* ไอคอนวาดเป็นเส้นชุดเดียวกับแถบแท็บ ไม่ใช้ emoji
     รูปคือมือถือที่มีลูกศรลง = ของชิ้นนี้จะลงไปอยู่ในเครื่อง */
  var ICON_PHONE = '<rect x="6.2" y="2.6" width="11.6" height="18.8" rx="2.4"/>' +
                   '<path d="M10.4 19.2h3.2"/><path d="M12 6.6v6.2"/>' +
                   '<path d="M9.6 10.6 12 13l2.4-2.4"/>';
  var ICON_X = '<path d="M6.4 6.4l11.2 11.2"/><path d="M17.6 6.4 6.4 17.6"/>';

  /* ---------- ปุ่มลอย ---------- */
  function build() {
    if (dock) return dock;

    dock = document.createElement('div');
    dock.className = 'install-dock';
    dock.id = 'installDock';
    dock.innerHTML =
      '<button type="button" class="install-fab" id="installFab">' +
        svg(ICON_PHONE) + '<span>ติดตั้งแอป</span>' +
      '</button>' +
      '<button type="button" class="install-x" id="installClose" ' +
        'aria-label="ปิดปุ่มติดตั้งแอป">' + svg(ICON_X) + '</button>';
    document.body.appendChild(dock);

    dock.querySelector('#installFab').addEventListener('click', install);
    dock.querySelector('#installClose').addEventListener('click', function () {
      snooze(SNOOZE_CLOSE);
      hide();
    });
    return dock;
  }

  function show() {
    if (shown || installed() || snoozed()) return;
    shown = true;
    var d = build();
    /* คลาสบน body ให้ของอื่นที่อยู่มุมล่างซ้ายหลบได้ (คำอธิบายสีของแผนที่) */
    document.body.classList.add('has-install-fab');
    requestAnimationFrame(function () { d.classList.add('show'); });
  }

  function hide() {
    shown = false;
    document.body.classList.remove('has-install-fab');
    if (dock) dock.classList.remove('show');
  }

  /* ---------- ขอติดตั้ง ----------
     ถ้ามีกล่องของระบบเก็บไว้ → กดปุ่มเดียวจบ ระบบวางไอคอนบนหน้าจอโฮมให้เอง
     ถ้าไม่มี (Safari บน iOS ไม่มี API นี้ หรือ Chrome ยังไม่ส่งกล่องมา)
     → เปิดแผ่นบอกวิธีทำมือ แทนที่จะปล่อยให้กดแล้วไม่เกิดอะไรขึ้น */
  function install() {
    if (!deferred) { sheet(); return; }
    var evt = deferred;
    deferred = null;                 /* กล่องหนึ่งใบใช้ได้ครั้งเดียว */
    var res = evt.prompt();
    /* Chrome รุ่นเก่าคืน undefined แล้วใช้ evt.userChoice แทน */
    var choice = (res && typeof res.then === 'function') ? res.then(function (r) {
      return r || evt.userChoice;
    }) : evt.userChoice;

    Promise.resolve(choice).then(function (r) {
      if (r && r.outcome === 'accepted') { hide(); return; }
      /* ผู้ใช้ปิดกล่องเอง = ยังไม่พร้อม ไม่ตามถามซ้ำ */
      snooze(SNOOZE_DISMISS);
      hide();
    }).catch(function () { sheet(); });
  }

  /* ---------- แผ่นบอกวิธีติดตั้งด้วยมือ ---------- */
  var STEPS_ANDROID = [
    'เปิดเมนู <b>⋮</b> ที่มุมขวาบนของเบราว์เซอร์',
    'เลือก <b>ติดตั้งแอป</b> หรือ <b>เพิ่มลงในหน้าจอหลัก</b>',
    'กด <b>ติดตั้ง</b> — ไอคอน naraflood จะไปอยู่บนหน้าจอโฮมเหมือนแอปทั่วไป'
  ];
  var STEPS_IOS = [
    'กดปุ่ม <b>แชร์</b> (สี่เหลี่ยมมีลูกศรขึ้น) ที่แถบล่างของ Safari',
    'เลื่อนลงแล้วเลือก <b>เพิ่มไปยังหน้าจอโฮม</b>',
    'กด <b>เพิ่ม</b> — ไอคอน naraflood จะไปอยู่บนหน้าจอโฮม'
  ];
  var STEPS_DESKTOP = [
    'กดไอคอน <b>ติดตั้ง</b> (จอมีลูกศรลง) ที่ท้ายช่องที่อยู่เว็บ',
    'หรือเปิดเมนูของเบราว์เซอร์แล้วเลือก <b>ติดตั้ง naraflood</b>',
    'กด <b>ติดตั้ง</b> — จะได้ไอคอนเปิดเว็บนี้แบบเต็มจอ'
  ];

  function steps() {
    if (isIOS) return STEPS_IOS;
    if (isAndroid || isTouch) return STEPS_ANDROID;
    return STEPS_DESKTOP;
  }

  function sheet() {
    var scrim = document.querySelector('.install-scrim');
    var panel = document.querySelector('.install-sheet');

    if (!panel) {
      scrim = document.createElement('div');
      scrim.className = 'install-scrim';

      panel = document.createElement('div');
      panel.className = 'install-sheet';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-labelledby', 'installSheetTitle');
      panel.innerHTML =
        '<div class="sheet-grab" aria-hidden="true"></div>' +
        '<h2 id="installSheetTitle">ติดตั้ง naraflood ลงเครื่อง</h2>' +
        '<p class="install-lead">เบราว์เซอร์นี้ยังไม่ให้กดติดตั้งจากปุ่มในเว็บ ' +
          'ทำเองได้สามขั้นตอน ใช้เวลาไม่ถึงนาที</p>' +
        '<ol class="install-steps">' +
          steps().map(function (s) { return '<li>' + s + '</li>'; }).join('') +
        '</ol>' +
        '<p class="install-lead">ติดตั้งแล้วเปิดได้เต็มจอ ใช้ดูข้อมูลชุดล่าสุด' +
          'ตอนเน็ตล่มได้ และกดค้างที่ไอคอนจะได้ทางลัดไปหน้าเช็คพื้นที่ ' +
          'ระดับน้ำ และศูนย์พักพิง</p>' +
        '<div class="install-sheet-actions">' +
          '<button type="button" class="install-btn" id="installSheetOk">เข้าใจแล้ว</button>' +
          '<button type="button" class="install-btn ghost" id="installSheetNo">ไม่ต้องตอนนี้</button>' +
        '</div>';

      document.body.appendChild(scrim);
      document.body.appendChild(panel);

      scrim.addEventListener('click', closeSheet);
      panel.querySelector('#installSheetOk').addEventListener('click', closeSheet);
      panel.querySelector('#installSheetNo').addEventListener('click', function () {
        snooze(SNOOZE_DISMISS);
        closeSheet();
        hide();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && panel.classList.contains('show')) closeSheet();
      });
    }

    scrim.classList.add('show');
    panel.classList.add('show');
    panel.querySelector('#installSheetOk').focus();
  }

  function closeSheet() {
    var scrim = document.querySelector('.install-scrim');
    var panel = document.querySelector('.install-sheet');
    if (scrim) scrim.classList.remove('show');
    if (panel) panel.classList.remove('show');
    var fab = document.getElementById('installFab');
    if (fab) fab.focus();
  }

  /* ---------- ป้ายยืนยันหลังติดตั้งสำเร็จ ---------- */
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'install-toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 400);
    }, 5200);
  }

  /* ---------- สายไฟ ---------- */
  window.addEventListener('beforeinstallprompt', function (e) {
    /* กันแถบเชิญชวนของเบราว์เซอร์เอง แล้วเก็บกล่องไว้ให้ปุ่มเราใช้ */
    e.preventDefault();
    deferred = e;
    show();
  });

  window.addEventListener('appinstalled', function () {
    deferred = null;
    hide();
    try { localStorage.removeItem(SNOOZE_KEY); } catch (e) {}
    toast('ติดตั้งแล้ว — เปิด naraflood จากไอคอนบนหน้าจอโฮมได้เลย');
  });

  /* ติดตั้งสำเร็จระหว่างเปิดหน้านี้ค้างไว้ หน้าต่างเดิมจะกลายเป็นโหมดแอป
     เอาปุ่มออกทันที ไม่ต้องรอรีโหลด */
  if (window.matchMedia) {
    var mq = window.matchMedia('(display-mode: standalone)');
    var onMode = function (e) { if (e.matches) hide(); };
    if (mq.addEventListener) mq.addEventListener('change', onMode);
    else if (mq.addListener) mq.addListener(onMode);
  }

  function start() {
    if (installed() || snoozed()) return;

    /* บนมือถือ แสดงปุ่มไว้ก่อนแม้ beforeinstallprompt ยังไม่มา
       เพราะบางเครื่องส่งช้า และ Safari บน iOS ไม่ส่งเลยแต่ติดตั้งมือได้
       ถ้ากล่องมาทีหลัง ปุ่มเดิมจะเปลี่ยนไปใช้ทางติดตั้งครั้งเดียวจบเอง
       จอคอมไม่แสดงถ้าไม่มีกล่อง — เบราว์เซอร์ที่ติดตั้งไม่ได้จะเหลือปุ่มที่กดแล้วไม่ได้อะไร */
    if (isAndroid || isIOS || isTouch) setTimeout(show, 1200);

    /* getInstalledRelatedApps: ถ้าเครื่องมีแอป Android ของเราอยู่แล้ว
       การชวนติดตั้งซ้ำเป็นการชวนให้มีไอคอนสองอันที่เปิดของเดียวกัน */
    if (navigator.getInstalledRelatedApps) {
      navigator.getInstalledRelatedApps().then(function (apps) {
        if (apps && apps.length) hide();
      }).catch(function () {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
