/* js/tabbar.js · แถบแท็บล่างสำหรับมือถือ
 * ใส่ในทุกหน้า: <script src="js/tabbar.js?v=1" defer></script>
 *
 * ทำไมต้อง inject ด้วย JS แทนที่จะแปะ markup ลงไฟล์ทั้ง 14 หน้า
 * กฎคือแถบนี้ต้องเหมือนกันทุกหน้าไม่มีข้อยกเว้น เมนูที่ไม่เหมือนกันระหว่างหน้า
 * คือข้อบกพร่องที่ของเดิมเป็นอยู่จริง (index มี 12 อัน, map มี 9, eoc มี 8,
 * people มี 4) การมีแหล่งความจริงแหล่งเดียวทำให้มันเพี้ยนไม่ได้อีก
 *
 * ปลายทางหลักมี 5 อัน ไม่มากกว่านั้น ถ้าต้องการอันที่ 6 แปลว่าสองอัน
 * ควรอยู่ในอันที่สาม ที่เหลือทั้งหมดไปอยู่ในแผ่น "เพิ่มเติม"
 *
 * แต่ละอันมีทั้งไอคอนและคำ ไม่ใช่ไอคอนเปล่า แถบที่มีแต่ไอคอน
 * ใช้ไม่ได้กับทุกคนที่ยังไม่รู้จักระบบนี้มาก่อน ซึ่งคือคนส่วนใหญ่ตอนน้ำกำลังมา
 */
(function () {
  'use strict';

  /* ไอคอนวาดเป็นเส้น ไม่ใช้ emoji
     emoji ในหัวข้อและเมนูคือสัญญาณของหน้าที่เครื่องสร้างโดยไม่ได้ออกแบบ
     และมันเรนเดอร์ไม่เหมือนกันเลยระหว่าง Android, iOS และ Windows */
  var ICON = {
    home:   '<path d="M3 10.2 12 3l9 7.2"/><path d="M5.5 9.6V20h13V9.6"/><path d="M9.7 20v-5.2h4.6V20"/>',
    map:    '<path d="M9 4 3 6.4v13.2L9 17.2l6 2.4 6-2.4V4l-6 2.4z"/><path d="M9 4v13.2"/><path d="M15 6.4v13.2"/>',
    pin:    '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
    house:  '<path d="M4 10.6 12 4l8 6.6"/><path d="M6 9.9V20h12V9.9"/><path d="M9.4 20v-4.4h5.2V20"/><path d="M12 8.6v3"/>',
    more:   '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',

    cloud:  '<path d="M7.2 18.5h9.4a3.8 3.8 0 0 0 .5-7.6 5.4 5.4 0 0 0-10.3-1.2 3.9 3.9 0 0 0 .4 8.8z"/>',
    clock:  '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.2V12l3.2 2"/>',
    alert:  '<path d="M12 4.4 2.9 19.6h18.2z"/><path d="M12 10v4.1"/><path d="M12 17.1h.01"/>',
    wave:   '<path d="M2.8 8.4c2.3-2.1 4.6-2.1 6.9 0s4.6 2.1 6.9 0 4.6-2.1 4.6 0"/><path d="M2.8 13.4c2.3-2.1 4.6-2.1 6.9 0s4.6 2.1 6.9 0 4.6-2.1 4.6 0"/><path d="M2.8 18.4c2.3-2.1 4.6-2.1 6.9 0s4.6 2.1 6.9 0 4.6-2.1 4.6 0"/>',
    car:    '<path d="M4.4 16.4v2.2h2.8v-2.2"/><path d="M16.8 16.4v2.2h2.8v-2.2"/><rect x="2.9" y="10.4" width="18.2" height="6" rx="1.6"/><path d="M5.2 10.4 7 5.9h10l1.8 4.5"/><path d="M6.4 13.4h1.4"/><path d="M16.2 13.4h1.4"/>',
    truck:  '<rect x="2.6" y="7.4" width="11" height="8.4" rx="1.2"/><path d="M13.6 10.6h3.6l2.9 3v2.2h-6.5"/><circle cx="7" cy="17.6" r="1.9"/><circle cx="17" cy="17.6" r="1.9"/>',
    bell:   '<path d="M17.6 15.6V11a5.6 5.6 0 1 0-11.2 0v4.6L4.8 17.8h14.4z"/><path d="M10.2 20.4h3.6"/>',
    grid:   '<rect x="3.4" y="3.4" width="7" height="7" rx="1.3"/><rect x="13.6" y="3.4" width="7" height="7" rx="1.3"/><rect x="3.4" y="13.6" width="7" height="7" rx="1.3"/><rect x="13.6" y="13.6" width="7" height="7" rx="1.3"/>',
    people: '<circle cx="9" cy="8.2" r="3.2"/><path d="M3.4 19.4c0-3.1 2.5-5.2 5.6-5.2s5.6 2.1 5.6 5.2"/><path d="M16.4 5.4a3 3 0 0 1 0 5.7"/><path d="M17.6 14.6c2 .6 3.4 2.3 3.4 4.8"/>',
    tools:  '<path d="M14.4 6.6a3.9 3.9 0 0 1 5.2 5.1l-8.3 8.3a2 2 0 0 1-2.8-2.8z"/><path d="M4.6 4.6l3.6 3.6"/><path d="M3.4 9.4h5"/>',
    layers: '<path d="M12 3.4 3 8l9 4.6L21 8z"/><path d="M3 12.6 12 17.2l9-4.6"/><path d="M3 17.2 12 21.8l9-4.6"/>'
  };

  /* แถบล่าง: ห้าปลายทางที่คนใช้จริงตอนน้ำกำลังมา
     ตอนนี้เป็นยังไง / น้ำอยู่ตรงไหน / บ้านฉันโดนไหม / ไปไหนได้ / ที่เหลือ */
  var TABS = [
    { href: 'index.html',   label: 'สถานการณ์', icon: 'home'  },
    { href: 'map.html',     label: 'แผนที่น้ำ', icon: 'map'   },
    { href: 'check.html',   label: 'พื้นที่ฉัน', icon: 'pin'   },
    { href: 'shelter.html', label: 'ศูนย์พักพิง', icon: 'house' }
  ];

  /* ที่เหลืออยู่ในแผ่น จัดกลุ่มตามคำถามที่คนถาม ไม่ใช่ตามชื่อหน่วยงาน */
  var SHEET = [
    { head: 'คาดการณ์และย้อนหลัง', items: [
      { href: 'forecast.html',  label: 'คาดการณ์',   icon: 'cloud'  },
      { href: 'sim.html',       label: 'แบบจำลอง',   icon: 'wave'   },
      { href: 'history.html',   label: 'ย้อนหลัง',    icon: 'clock'  },
      { href: 'repeat.html',    label: 'พื้นที่เสี่ยง', icon: 'alert'  }
    ]},
    { head: 'ลงมือ', items: [
      { href: 'route.html',     label: 'เส้นทาง',     icon: 'car'    },
      { href: 'resources.html', label: 'ทรัพยากร',   icon: 'truck'  },
      { href: 'alert.html',     label: 'แจ้งเตือน',   icon: 'bell'   }
    ]},
    { head: 'สำหรับเจ้าหน้าที่', items: [
      { href: 'eoc.html',       label: 'ศูนย์บัญชาการ', icon: 'grid'   },
      { href: 'people.html',    label: 'กลุ่มเปราะบาง', icon: 'people' },
      { href: 'admin.html',     label: 'ผู้ดูแล',      icon: 'tools'  }
    ]}
  ];

  function svg(name) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICON[name] || ICON.layers) + '</svg>';
  }

  function currentPage() {
    var p = location.pathname.split('/').pop();
    return (!p || p === '') ? 'index.html' : p;
  }

  function link(item, here) {
    var on = item.href === here ? ' aria-current="page"' : '';
    return '<a href="' + item.href + '"' + on + '>' + svg(item.icon) +
           '<span>' + item.label + '</span></a>';
  }

  function build() {
    if (document.querySelector('.tabbar')) return;
    var here = currentPage();

    /* หน้าไหนที่ไม่ได้อยู่ในแถบล่าง ให้ปุ่มเพิ่มเติมติดสถานะไว้แทน
       ผู้ใช้จะได้ไม่รู้สึกว่าตัวเองหลุดออกจากระบบนำทาง */
    var inBar = TABS.some(function (t) { return t.href === here; });

    var bar = document.createElement('nav');
    bar.className = 'tabbar';
    bar.setAttribute('aria-label', 'เมนูหลัก');
    bar.innerHTML =
      TABS.map(function (t) { return link(t, here); }).join('') +
      '<button type="button" id="tabMore" aria-expanded="false" aria-controls="navSheet"' +
        (inBar ? '' : ' style="color:var(--signal);font-weight:600"') + '>' +
        svg('more') + '<span>เพิ่มเติม</span></button>';

    var scrim = document.createElement('div');
    scrim.className = 'sheet-scrim';

    var sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.id = 'navSheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'เมนูเพิ่มเติม');
    sheet.innerHTML = '<div class="sheet-grab" aria-hidden="true"></div>' +
      SHEET.map(function (g) {
        return '<h3>' + g.head + '</h3><div class="sheet-grid">' +
               g.items.map(function (i) { return link(i, here); }).join('') + '</div>';
      }).join('');

    document.body.appendChild(scrim);
    document.body.appendChild(sheet);
    document.body.appendChild(bar);

    var btn = bar.querySelector('#tabMore');

    function open() {
      scrim.classList.add('show');
      sheet.classList.add('show');
      btn.setAttribute('aria-expanded', 'true');
    }
    function close() {
      scrim.classList.remove('show');
      sheet.classList.remove('show');
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function () {
      sheet.classList.contains('show') ? close() : open();
    });
    scrim.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheet.classList.contains('show')) { close(); btn.focus(); }
    });

    /* ปัดลงเพื่อปิด เป็นท่าที่เดาไม่ได้ถ้าไม่บอก แต่แถบจับด้านบนของแผ่น
       ทำหน้าที่บอกอยู่แล้ว และการแตะฉากหลังก็ปิดได้เหมือนกัน */
    var y0 = null;
    sheet.addEventListener('touchstart', function (e) {
      y0 = sheet.scrollTop <= 0 ? e.touches[0].clientY : null;
    }, { passive: true });
    sheet.addEventListener('touchmove', function (e) {
      if (y0 === null) return;
      var dy = e.touches[0].clientY - y0;
      if (dy > 70) { close(); y0 = null; }
    }, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
