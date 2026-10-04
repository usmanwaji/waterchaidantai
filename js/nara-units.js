/* js/nara-units.js · พื้นที่ปฏิบัติการ (เทศบาล/อำเภอ) จ.นราธิวาส + คำศัพท์กลางของ War Room
 * ใช้ร่วมกันระหว่าง warroom.html, staff.html และ admin.html
 *   <script src="js/nara-units.js?v=1"></script>
 *
 * รายชื่อพื้นที่ชุดตั้งต้น: เทศบาลที่เป็นศูนย์กลางของ 9 อำเภอ + อีก 4 อำเภอใช้ภาพรวมทั้งอำเภอ
 * รวม 13 แถวครบทุกอำเภอ ผู้บริหารจึงไม่พลาดพื้นที่ไหนไป แม้ยังไม่ได้ใส่เทศบาลของอำเภอนั้น
 * ตรวจทานชื่อกับสำนักงานส่งเสริมการปกครองท้องถิ่นจังหวัดก่อนใช้งานจริง
 * และเพิ่มเทศบาลอื่นได้ (หลายแห่งต่ออำเภอก็ได้) ด้วยการเพิ่มแถวใหม่ในรายการด้านล่าง
 *
 * id คือค่าที่เก็บลงฐานข้อมูล (staff_members.unit, field_reports.unit, directives.unit)
 * ห้ามเปลี่ยน id หลังเริ่มใช้งานจริง ไม่งั้นรายงานเก่าจะหลุดจากพื้นที่ของตัวเอง
 * พิกัดคือจุดกลางตำบลที่ตั้งเทศบาล (หรือจุดกลางอำเภอ) จากขอบเขต สทนช. ในโฟลเดอร์ js/
 * ใช้วางหมุดบนแผนที่เท่านั้น ส่วนฝนพยากรณ์ใช้จุดกลางอำเภอชุดเดียวกับหน้าแรก ตัวเลขจึงตรงกัน
 */
(function () {
  'use strict';

  var UNITS = [
    { id: 'muang',     short: 'ทม.นราธิวาส',   name: 'เทศบาลเมืองนราธิวาส',   kind: 'tm',     amphoe: 'เมืองนราธิวาส', lat: 6.42453, lon: 101.82772 },
    { id: 'kolok',     short: 'ทม.สุไหงโก-ลก', name: 'เทศบาลเมืองสุไหงโก-ลก', kind: 'tm',     amphoe: 'สุไหงโก-ลก',   lat: 6.01096, lon: 101.95062 },
    { id: 'takbai',    short: 'ทม.ตากใบ',      name: 'เทศบาลเมืองตากใบ',      kind: 'tm',     amphoe: 'ตากใบ',        lat: 6.25617, lon: 102.04302 },
    { id: 'rangae',    short: 'ทต.ตันหยงมัส',  name: 'เทศบาลตำบลตันหยงมัส',   kind: 'tt',     amphoe: 'ระแงะ',        lat: 6.30779, lon: 101.73155 },
    { id: 'yingo',     short: 'ทต.ยี่งอ',       name: 'เทศบาลตำบลยี่งอ',        kind: 'tt',     amphoe: 'ยี่งอ',         lat: 6.37906, lon: 101.70277 },
    { id: 'rueso',     short: 'ทต.รือเสาะ',     name: 'เทศบาลตำบลรือเสาะ',      kind: 'tt',     amphoe: 'รือเสาะ',       lat: 6.36024, lon: 101.51764 },
    { id: 'bacho',     short: 'ทต.บาเจาะ',      name: 'เทศบาลตำบลบาเจาะ',       kind: 'tt',     amphoe: 'บาเจาะ',        lat: 6.51498, lon: 101.63863 },
    { id: 'waeng',     short: 'ทต.แว้ง',        name: 'เทศบาลตำบลแว้ง',         kind: 'tt',     amphoe: 'แว้ง',          lat: 5.93347, lon: 101.85171 },
    { id: 'padi',      short: 'ทต.สุไหงปาดี',   name: 'เทศบาลตำบลสุไหงปาดี',    kind: 'tt',     amphoe: 'สุไหงปาดี',     lat: 6.08215, lon: 101.88864 },
    { id: 'sisakhon',  short: 'อ.ศรีสาคร',      name: 'อำเภอศรีสาคร',           kind: 'amphoe', amphoe: 'ศรีสาคร',       lat: 6.19019, lon: 101.50693 },
    { id: 'sukhirin',  short: 'อ.สุคิริน',      name: 'อำเภอสุคิริน',           kind: 'amphoe', amphoe: 'สุคิริน',       lat: 5.91073, lon: 101.72250 },
    { id: 'chanae',    short: 'อ.จะแนะ',        name: 'อำเภอจะแนะ',             kind: 'amphoe', amphoe: 'จะแนะ',         lat: 6.04013, lon: 101.59223 },
    { id: 'choairong', short: 'อ.เจาะไอร้อง',   name: 'อำเภอเจาะไอร้อง',        kind: 'amphoe', amphoe: 'เจาะไอร้อง',    lat: 6.21410, lon: 101.83984 }
  ];

  /* หน่วยระดับจังหวัด ไม่ใช่แถวบนกระดาน แต่เลือกเป็นพื้นที่ของเจ้าหน้าที่/รายงาน/ข้อสั่งการได้ */
  var PROVINCE = { id: 'province', short: 'ส่วนกลางจังหวัด', name: 'ส่วนกลางจังหวัดนราธิวาส', kind: 'province', amphoe: null };

  /* ระดับสถานการณ์ของพื้นที่ ใช้สีไวยากรณ์สถานการณ์ (--st-*) ชุดเดียวกับทั้งเว็บ
     คำใช้ชุดเดียวกับ ปภ. (เฝ้าระวัง / เตรียมรับมือ) เพื่อให้ตรงกับที่ผู้บริหารคุ้นจากรายงานราชการ
     "วิกฤต" สงวนไว้ให้เหตุที่เกิดขึ้นแล้วเท่านั้น (ล้นตลิ่ง / ปภ. ประกาศอพยพ / รายงานภาคสนามระดับวิกฤต)
     ฝนพยากรณ์อย่างเดียวขึ้นได้สูงสุด "เตรียมรับมือ" */
  var LEVELS = [
    { k: 'normal', lv: 0, label: 'ปกติ',        hint: 'ไม่มีผลกระทบ หรือคลี่คลายแล้ว' },
    { k: 'watch',  lv: 1, label: 'เฝ้าระวัง',    hint: 'น้ำสูงขึ้น ยังไม่กระทบบ้านเรือน' },
    { k: 'warn',   lv: 2, label: 'เตรียมรับมือ', hint: 'เริ่มกระทบบ้านเรือน/ถนน ต้องเตรียมอพยพ' },
    { k: 'danger', lv: 3, label: 'วิกฤต',       hint: 'ต้องอพยพหรือช่วยเหลือเร่งด่วน' }
  ];
  var LEVEL_BY_K = {};
  LEVELS.forEach(function (l) { LEVEL_BY_K[l.k] = l; });

  var KINDS = {
    flood_home: 'น้ำท่วมบ้านเรือน/ชุมชน',
    road:       'ถนนน้ำท่วม/ปิดเส้นทาง',
    flash:      'น้ำป่า/ตลิ่งพัง/ดินสไลด์',
    rescue:     'ผู้ประสบภัยต้องช่วยเหลือเร่งด่วน',
    support:    'ขอรับการสนับสนุน',
    shelter:    'สถานการณ์ศูนย์พักพิง',
    other:      'อื่น ๆ'
  };

  var NEEDS = {
    evac:    'อพยพ/เคลื่อนย้ายคน',
    boat:    'เรือ',
    vehicle: 'รถยกสูง/ยานพาหนะ',
    food:    'อาหาร/น้ำดื่ม',
    medical: 'แพทย์/ยา/ผู้ป่วย',
    pump:    'เครื่องสูบน้ำ',
    sandbag: 'กระสอบทราย',
    power:   'ไฟฟ้า/เครื่องปั่นไฟ',
    shelter: 'ที่พักชั่วคราว'
  };

  /* สถานะข้อสั่งการเป็นเรื่องของการดำเนินงาน ไม่ใช่ระดับภัย จึงไม่ใช้สี --st-*
     (กฎของ shared.css: สีสถานการณ์สงวนไว้ให้ระดับภัยเท่านั้น) */
  var DSTATUS = {
    ordered:      { l: 'สั่งการแล้ว',         step: 0 },
    acknowledged: { l: 'รับทราบ',             step: 1 },
    in_progress:  { l: 'อยู่ระหว่างดำเนินการ', step: 2 },
    done:         { l: 'ดำเนินการแล้วเสร็จ',   step: 3 },
    cancelled:    { l: 'ยกเลิก',              step: 4 }
  };
  var PRIORITY = {
    normal:   { l: 'ปกติ',        rank: 0 },
    urgent:   { l: 'ด่วน',        rank: 1 },
    critical: { l: 'ด่วนที่สุด',  rank: 2 }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ชื่ออำเภอจากแต่ละแหล่งเขียนไม่เหมือนกัน ("อ.ตากใบ", "อำเภอตากใบ", "เมือง", "สุไหงโกลก")
     ปรับให้ตรงกับรายชื่ออำเภอก่อนนำไปจับคู่ */
  function normAmphoe(a) {
    var x = String(a || '').replace(/^\s*(อำเภอ|อ\.)\s*/, '').replace(/\s+/g, '').trim();
    if (!x) return '';
    if (x === 'เมือง' || x === 'เมืองนรา') return 'เมืองนราธิวาส';
    if (x === 'สุไหงโกลก' || x === 'สุไหงโก–ลก') return 'สุไหงโก-ลก';
    return x;
  }

  function unitById(id) {
    if (id === PROVINCE.id) return PROVINCE;
    for (var i = 0; i < UNITS.length; i++) if (UNITS[i].id === id) return UNITS[i];
    return null;
  }
  function unitLabel(id) {
    if (id === 'all') return 'ทุกพื้นที่';
    var u = unitById(id);
    return u ? u.short : (id || '–');
  }
  function unitsOfAmphoe(a) {
    var n = normAmphoe(a);
    return UNITS.filter(function (u) { return u.amphoe === n; });
  }
  /* ตัวเลือกพื้นที่สำหรับ <select> · includeAll = มีตัวเลือก "ทุกพื้นที่" (ข้อสั่งการ) */
  function unitOptions(selected, includeAll, includeProvince) {
    var out = [];
    if (includeAll) out.push('<option value="all"' + (selected === 'all' ? ' selected' : '') + '>ทุกพื้นที่</option>');
    if (includeProvince !== false) out.push('<option value="province"' + (selected === 'province' ? ' selected' : '') + '>ส่วนกลางจังหวัด</option>');
    out.push('<optgroup label="เทศบาล / อำเภอ">');
    UNITS.forEach(function (u) {
      out.push('<option value="' + u.id + '"' + (selected === u.id ? ' selected' : '') + '>' + esc(u.short) +
        (u.kind === 'amphoe' ? '' : ' · อ.' + esc(u.amphoe)) + '</option>');
    });
    out.push('</optgroup>');
    return out.join('');
  }

  /* ---------- เวลา (ยึดเวลาไทยเสมอ ไม่ว่าเครื่องตั้งโซนอะไร) ---------- */
  var TZ = 'Asia/Bangkok';
  function fmtTime(ts) {
    if (!ts) return '–';
    var d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d)) return '–';
    return d.toLocaleString('th-TH', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' น.';
  }
  function fmtClock(ts) {
    var d = ts instanceof Date ? ts : new Date(ts);
    return d.toLocaleTimeString('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  }
  function ago(ts) {
    if (!ts) return '–';
    var d = ts instanceof Date ? ts : new Date(ts);
    var s = Math.round((Date.now() - d.getTime()) / 1000);
    if (isNaN(s)) return '–';
    if (s < 60) return 'เมื่อสักครู่';
    if (s < 3600) return Math.floor(s / 60) + ' นาทีที่แล้ว';
    if (s < 86400) return Math.floor(s / 3600) + ' ชม.ที่แล้ว';
    if (s < 86400 * 7) return Math.floor(s / 86400) + ' วันที่แล้ว';
    return fmtTime(d);
  }
  function duration(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + ' นาที';
    var h = Math.floor(m / 60), r = m % 60;
    return h + ' ชม.' + (r ? ' ' + r + ' นาที' : '');
  }

  /* ตารางยังไม่ถูกสร้าง (ยังไม่ได้รัน schema-v11.sql) · PostgREST ตอบ PGRST205 หรือ 42P01 */
  function isMissingTable(err) {
    if (!err) return false;
    var c = String(err.code || ''), m = String(err.message || '');
    return c === 'PGRST205' || c === '42P01' || /schema cache|does not exist/i.test(m);
  }

  /* ---------- จุดอยู่ในอำเภอไหน (ขอบเขตอำเภอ สทนช. 13 อำเภอ ~14 KB) ---------- */
  var districts = null;
  function loadDistricts() {
    if (districts) return Promise.resolve(districts);
    return fetch('js/onwr-nara-districts.geojson').then(function (r) { return r.json(); })
      .then(function (g) { districts = (g && g.features) || []; return districts; })
      .catch(function () { districts = []; return districts; });
  }
  function inRing(lat, lon, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function amphoeAt(lat, lon) {
    if (!districts || lat == null || lon == null) return '';
    for (var i = 0; i < districts.length; i++) {
      var g = districts[i].geometry;
      if (!g) continue;
      var polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
      for (var p = 0; p < polys.length; p++) {
        if (inRing(lat, lon, polys[p][0])) return normAmphoe(districts[i].properties.name_th);
      }
    }
    return '';
  }

  /* ===================================================================
     การ์ดข้อสั่งการ / รายงานภาคสนาม — หน้าตาเดียวกันทั้ง War Room และหน้าเจ้าหน้าที่
     (สไตล์อยู่ใน ops.css) ทุกค่าที่มาจากฐานข้อมูลผ่าน esc() ก่อนเสมอ
     =================================================================== */
  var OPEN_D = ['ordered', 'acknowledged', 'in_progress'];

  function telHref(p) { var d = String(p || '').replace(/[^0-9+]/g, ''); return d ? 'tel:' + d : ''; }
  /* ลิงก์รูปต้องเป็น https เท่านั้น กัน javascript: หรือ data: ที่อาจถูกใส่มาในฐานข้อมูล */
  function safeUrl(u) { return /^https:\/\//i.test(String(u || '')) ? String(u) : ''; }
  function lvPill(k, label) { return '<span class="lv" data-lv="' + esc(k) + '">' + esc(label) + '</span>'; }
  function lvOfReport(r) { var l = LEVEL_BY_K[r.severity]; return l ? l.lv : 0; }
  function fmtN(v) { return v == null ? '–' : Math.round(v).toLocaleString('th-TH'); }

  /* ค้างก่อนเสร็จ → ด่วนก่อนปกติ → ใกล้กำหนดก่อน → ใหม่ก่อนเก่า */
  function dirSort(a, b) {
    var oa = OPEN_D.indexOf(a.status) >= 0, ob = OPEN_D.indexOf(b.status) >= 0;
    if (oa !== ob) return ob - oa;
    var pa = (PRIORITY[a.priority] || { rank: 0 }).rank, pb = (PRIORITY[b.priority] || { rank: 0 }).rank;
    if (pa !== pb) return pb - pa;
    var da = a.due_at ? Date.parse(a.due_at) : Infinity, db = b.due_at ? Date.parse(b.due_at) : Infinity;
    if (da !== db) return da - db;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  }

  /* ctx = { meId, admin } · ปุ่มยกเลิกเฉพาะผู้สั่งการหรือแอดมิน (ตรงกับ trigger ใน schema-v11) */
  function dirHtml(d, ctx) {
    ctx = ctx || {};
    var isOpen = OPEN_D.indexOf(d.status) >= 0;
    var late = isOpen && d.due_at && Date.parse(d.due_at) < Date.now();
    var st = DSTATUS[d.status] || { l: d.status, step: 0 };
    var canEdit = ctx.admin || (ctx.meId && d.created_by === ctx.meId);
    var steps = '';
    if (isOpen) {
      var btn = function (s, l, prim) { return '<button type="button" class="wbtn ' + (prim ? '' : 'ghost ') + 'sm" data-ds="' + s + '">' + l + '</button>'; };
      steps = '<div class="dsteps no-tv"><input type="text" maxlength="500" placeholder="ความคืบหน้า/หมายเหตุ (ถ้ามี)" aria-label="หมายเหตุสถานะ">' +
        (st.step < 1 ? btn('acknowledged', 'รับทราบ') : '') + (st.step < 2 ? btn('in_progress', 'กำลังดำเนินการ') : '') +
        btn('done', 'แล้วเสร็จ', true) + (canEdit ? btn('cancelled', 'ยกเลิก') : '') + '</div>';
    }
    return '<article class="ditem" data-id="' + esc(d.id) + '">' +
      '<div class="tagrow"><span class="prio" data-p="' + esc(d.priority) + '">' + esc((PRIORITY[d.priority] || {}).l || d.priority) + '</span>' +
        '<span class="unitchip">' + esc(unitLabel(d.unit)) + '</span>' +
        '<span class="dst" data-s="' + esc(d.status) + '">' + esc(st.l) + '</span>' +
        (late ? '<span class="overdue">เกินกำหนด ' + esc(duration(Date.now() - Date.parse(d.due_at))) + '</span>' : '') + '</div>' +
      '<div class="t">' + esc(d.title) + '</div>' +
      (d.detail ? '<div class="meta">' + esc(d.detail) + '</div>' : '') +
      '<div class="meta">สั่งการโดย <b>' + esc(d.ordered_by_name || 'ไม่ระบุ') + '</b> · ' + esc(ago(d.created_at)) +
        (d.assignee ? ' · ผู้รับผิดชอบ <b>' + esc(d.assignee) + '</b>' : '') +
        (d.due_at ? ' · กำหนด <b>' + esc(fmtTime(d.due_at)) + '</b>' : '') + '</div>' +
      (d.status_at && (d.status_note || d.status !== 'ordered') ? '<div class="meta">ล่าสุด: ' +
        esc([d.status_note, d.status_by_name].filter(Boolean).join(' — ') || st.l) + ' · ' + esc(ago(d.status_at)) + '</div>' : '') +
      steps + '</article>';
  }

  /* ctx = { mapLink: แสดงลิงก์ "ดูบนแผนที่", del: แสดงปุ่มลบ (รายงานของตัวเอง) } */
  function repHtml(r, ctx) {
    ctx = ctx || {};
    var lvk = LEVEL_BY_K[r.severity] ? r.severity : 'watch';
    var needs = (r.needs || []).map(function (n) { return '<span>' + esc(NEEDS[n] || n) + '</span>'; }).join('');
    var nums = [];
    if (r.water_cm != null) nums.push('ระดับน้ำ <b>' + fmtN(r.water_cm) + ' ซม.</b>');
    if (r.households != null) nums.push('<b>' + fmtN(r.households) + '</b> ครัวเรือน');
    if (r.people != null) nums.push('<b>' + fmtN(r.people) + '</b> คน');
    var photo = safeUrl(r.photo_url), tel = telHref(r.reporter_phone);
    var hasLoc = r.lat != null && r.lon != null;
    return '<article class="ritem' + (r.status === 'open' ? '' : ' closed') + '" data-lv="' + lvk + '" data-id="' + esc(r.id) + '">' +
      '<div class="tagrow">' + lvPill(lvk, LEVEL_BY_K[lvk].label) + '<span class="unitchip">' + esc(unitLabel(r.unit)) + '</span>' +
        '<span class="meta">' + esc(KINDS[r.kind] || r.kind) + '</span>' +
        (r.status === 'open' ? '' : '<span class="dst" data-s="done">คลี่คลายแล้ว</span>') + '</div>' +
      '<div class="t">' + esc(r.place || unitLabel(r.unit)) + '</div>' +
      (nums.length ? '<div class="meta">' + nums.join(' · ') + '</div>' : '') +
      (needs ? '<div class="needs">' + needs + '</div>' : '') +
      (r.detail ? '<div class="meta">' + esc(r.detail) + '</div>' : '') +
      (photo ? '<a href="' + esc(photo) + '" target="_blank" rel="noopener"><img src="' + esc(photo) + '" alt="ภาพจากภาคสนาม" loading="lazy"></a>' : '') +
      '<div class="meta">รายงานโดย <b>' + esc(r.reporter_name || 'ไม่ระบุ') + '</b>' + (tel ? ' · <a href="' + tel + '">' + esc(r.reporter_phone) + '</a>' : '') +
        ' · ' + esc(ago(r.created_at)) +
        (hasLoc && ctx.mapLink ? ' · <a href="#" data-act="maprep" data-lat="' + (+r.lat) + '" data-lon="' + (+r.lon) + '">ดูบนแผนที่</a>' : '') +
        (hasLoc && !ctx.mapLink ? ' · <a href="https://www.google.com/maps?q=' + (+r.lat) + ',' + (+r.lon) + '" target="_blank" rel="noopener">พิกัด</a>' : '') + '</div>' +
      '<div class="dsteps no-tv">' + (r.status === 'open'
        ? '<button type="button" class="wbtn ghost sm" data-rs="resolved">คลี่คลายแล้ว</button>'
        : '<button type="button" class="wbtn ghost sm" data-rs="open">เปิดเหตุอีกครั้ง</button>') +
        (ctx.del ? '<button type="button" class="wbtn ghost sm" data-rdel>ลบรายงาน</button>' : '') + '</div>' +
      '</article>';
  }

  window.NaraOps = {
    UNITS: UNITS, PROVINCE: PROVINCE, LEVELS: LEVELS, LEVEL_BY_K: LEVEL_BY_K,
    KINDS: KINDS, NEEDS: NEEDS, DSTATUS: DSTATUS, PRIORITY: PRIORITY, OPEN_D: OPEN_D,
    esc: esc, normAmphoe: normAmphoe, unitById: unitById, unitLabel: unitLabel,
    unitsOfAmphoe: unitsOfAmphoe, unitOptions: unitOptions,
    fmtTime: fmtTime, fmtClock: fmtClock, ago: ago, duration: duration,
    isMissingTable: isMissingTable, loadDistricts: loadDistricts, amphoeAt: amphoeAt,
    telHref: telHref, safeUrl: safeUrl, lvPill: lvPill, lvOfReport: lvOfReport,
    dirSort: dirSort, dirHtml: dirHtml, repHtml: repHtml
  };
})();
