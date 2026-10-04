/* js/staff.js · หน้าเจ้าหน้าที่ (staff.html)
 * ลงเวลาปฏิบัติงาน · รายงานสถานการณ์ภาคสนาม · ข้อสั่งการ · ทำเนียบเจ้าหน้าที่ · ข้อมูลของฉัน
 * ทุกอย่างที่บันทึกที่นี่ไปปรากฏใน War Room เทศบาล (warroom.html) ทันที
 *
 * สิทธิ์ (RLS ใน supabase/schema-v11.sql)
 *   รออนุมัติ  → กรอก/แก้ "ข้อมูลของฉัน" ได้อย่างเดียว ผู้ดูแลจะได้รู้ว่าเป็นใครตอนอนุมัติ
 *   อนุมัติแล้ว → ใช้ได้ทุกส่วน
 * ต้องโหลดหลัง: supabase-client.js, nara-units.js
 */
(function () {
  'use strict';

  var NO = window.NaraOps;
  if (!NO) return;

  var $ = function (id) { return document.getElementById(id); };
  var esc = NO.esc;
  var SB = null;
  try { if (window.supabase && typeof sb !== 'undefined') SB = sb; } catch (e) { SB = null; }
  var OPS_EVERY = 60e3;

  var S = {
    state: 'loading', profile: null, member: false, admin: false,
    mine: null, mineLoaded: false, schema: true,
    staff: null, reports: null, dirs: null, loadErr: null,
    loc: null, ordFilter: 'mine', ordPending: false
  };

  /* ---------- ตัวช่วย ---------- */
  function msg(id, text, kind) { var el = $(id); el.textContent = text || ''; if (kind) el.dataset.k = kind; else delete el.dataset.k; }
  function errText(err) {
    if (!err) return 'ไม่ทราบสาเหตุ';
    if (NO.isMissingTable(err)) return 'ระบบยังไม่เปิดใช้งาน (ผู้ดูแลต้องรัน supabase/schema-v11.sql)';
    if (/row-level security|permission denied|violates row-level/i.test(err.message || '')) return 'ไม่มีสิทธิ์บันทึก (บัญชีต้องได้รับอนุมัติก่อน)';
    return err.message || String(err);
  }
  function intOrNull(v) { var n = parseInt(v, 10); return isNaN(n) || n < 0 ? null : n; }
  function numOrNull(v) { var n = parseFloat(v); return isNaN(n) || n < 0 ? null : n; }
  function myId() { return S.profile && S.profile.id; }
  function displayName() {
    return (S.mine && S.mine.display_name) || (S.profile && (S.profile.full_name || (S.profile.email || '').split('@')[0])) || 'เจ้าหน้าที่';
  }
  function myName() {
    var p = S.mine;
    return ((p && p.position ? p.position + ' ' : '') + displayName()).trim();
  }
  function myUnit() { return (S.mine && S.mine.unit) || ''; }

  function getPos() {
    return new Promise(function (res, rej) {
      if (!navigator.geolocation) { rej(new Error('อุปกรณ์นี้ระบุตำแหน่งไม่ได้')); return; }
      navigator.geolocation.getCurrentPosition(function (p) {
        res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy });
      }, function (e) {
        rej(new Error(e && e.code === 1 ? 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง' : 'ระบุตำแหน่งไม่สำเร็จ'));
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    });
  }

  /* ย่อรูปจากกล้องมือถือ (3-8 MB) ให้เหลือราว 200-400 KB ก่อนส่ง
     สัญญาณในพื้นที่น้ำท่วมมักอ่อน ส่งรูปเต็มขนาดจะค้างจนเจ้าหน้าที่เลิกส่ง */
  function shrinkImage(file) {
    return new Promise(function (resolve) {
      if (!file || !/^image\//.test(file.type) || file.type === 'image/gif') { resolve(file); return; }
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, sc = Math.min(1, 1600 / Math.max(w, h));
        if (sc >= 1 && file.size < 1.5e6) { URL.revokeObjectURL(url); resolve(file); return; }
        var c = document.createElement('canvas');
        c.width = Math.round(w * sc); c.height = Math.round(h * sc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) {
          URL.revokeObjectURL(url);
          resolve(b ? new File([b], 'report.jpg', { type: 'image/jpeg' }) : file);
        }, 'image/jpeg', 0.8);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  /* ---------- ตัวเลือกในฟอร์ม ---------- */
  function fillStatic() {
    $('rKind').innerHTML = Object.keys(NO.KINDS).map(function (k, i) {
      return '<label><input type="radio" name="rKind" value="' + k + '"' + (i === 0 ? ' checked' : '') + '><span>' + esc(NO.KINDS[k]) + '</span></label>';
    }).join('');
    $('rSev').innerHTML = NO.LEVELS.map(function (l) {
      return '<label><input type="radio" name="rSev" value="' + l.k + '"' + (l.k === 'watch' ? ' checked' : '') + '><span data-lv="' + l.k + '">' + esc(l.label) + '</span></label>';
    }).join('');
    $('rNeeds').innerHTML = Object.keys(NO.NEEDS).map(function (k) {
      return '<label><input type="checkbox" name="rNeeds" value="' + k + '"><span>' + esc(NO.NEEDS[k]) + '</span></label>';
    }).join('');
    sevHint();
    $('qUnit').innerHTML = '<option value="">ทุกพื้นที่</option>' + NO.unitOptions('', false, true);
  }
  /* สร้างตัวเลือกพื้นที่ใหม่เฉพาะตอนพื้นที่ของฉันเปลี่ยน ไม่ใช่ทุกรอบรีเฟรช
     (สร้างใหม่ระหว่างที่ผู้ใช้กำลังเปิดตัวเลือกอยู่ รายการจะปิดเองต่อหน้า)
     ยังไม่มีพื้นที่ → ขึ้น "เลือกพื้นที่" ไว้ก่อน ไม่ปล่อยให้เบราว์เซอร์เลือกตัวแรกให้เงียบ ๆ */
  function unitSelects() {
    var u = myUnit();
    if (S.selUnit === u && $('rUnit').options.length) return;
    S.selUnit = u;
    ['rUnit', 'dUnitSel', 'mUnit'].forEach(function (id) {
      var cur = id === 'mUnit' ? ($(id).value || u) : (u || $(id).value);
      $(id).innerHTML = (cur ? '' : '<option value="" selected disabled>— เลือกพื้นที่ —</option>') + NO.unitOptions(cur, false, true);
    });
  }
  function sevHint() {
    var c = document.querySelector('input[name="rSev"]:checked');
    var l = c ? NO.LEVEL_BY_K[c.value] : null;
    $('rSevHint').textContent = l ? l.label + ': ' + l.hint : '';
  }

  /* ===================================================================
     โหลดข้อมูล
     =================================================================== */
  function loadMine() {
    if (!SB || !myId()) return Promise.resolve();
    return SB.from('staff_members').select('*').eq('user_id', myId()).maybeSingle().then(function (r) {
      if (r.error) { if (NO.isMissingTable(r.error)) S.schema = false; return; }
      S.schema = true;
      S.mine = r.data || null;
      S.mineLoaded = true;
    });
  }
  function loadOps() {
    if (!S.member || !SB || !S.schema) return Promise.resolve();
    var since7d = new Date(Date.now() - 7 * 86400e3).toISOString();
    return Promise.all([
      SB.from('staff_members').select('user_id,display_name,agency,position,unit,phone,line_id,on_duty,duty_since,duty_note,updated_at'),
      SB.from('field_reports').select('*').eq('created_by', myId()).or('status.eq.open,created_at.gte."' + since7d + '"').order('created_at', { ascending: false }).limit(100),
      SB.from('directives').select('*').or('status.in.(ordered,acknowledged,in_progress),created_at.gte."' + since7d + '"').order('created_at', { ascending: false }).limit(300)
    ]).then(function (res) {
      var errs = res.map(function (r) { return r.error; }).filter(Boolean);
      if (errs.some(NO.isMissingTable)) { S.schema = false; return; }
      S.loadErr = errs.length ? errs[0] : null;
      if (!res[0].error) S.staff = res[0].data || [];
      if (!res[1].error) S.reports = res[1].data || [];
      if (!res[2].error) S.dirs = res[2].data || [];
    }).catch(function (e) { S.loadErr = e; });
  }
  function refresh() {
    return loadMine().then(loadOps).then(renderAll);
  }

  /* ===================================================================
     แสดงผล
     =================================================================== */
  function renderGate() {
    var g = $('gate');
    var login = '<button type="button" class="wbtn" data-login>เข้าสู่ระบบด้วย Google</button>';
    var intro = '<p>ใช้ลงเวลาปฏิบัติงาน ส่งรายงานสถานการณ์จากพื้นที่ รับและรายงานผลข้อสั่งการจากผู้บริหาร และค้นหาเบอร์ผู้ประสานงานของทุกหน่วย ข้อมูลทั้งหมดส่งเข้า <a href="warroom.html">War Room เทศบาล</a> ทันที</p>';
    var html = '';
    if (S.state === 'loading') html = '<div class="card"><div class="empty"><span class="spin"></span> กำลังตรวจสอบบัญชี…</div></div>';
    else if (S.state === 'offline') html = '<div class="card gate"><h2>ระบบสมาชิกไม่พร้อมใช้งาน</h2><p>เชื่อมต่อฐานข้อมูลไม่ได้ (อาจออฟไลน์อยู่) ลองใหม่เมื่อมีสัญญาณ</p></div>';
    else if (S.state === 'signedout') html = '<div class="card gate"><h2>หน้าสำหรับเจ้าหน้าที่ภาครัฐ จังหวัดนราธิวาส</h2>' + intro +
      '<ol class="steps"><li>เข้าสู่ระบบด้วยบัญชี Google</li><li>กรอกชื่อ หน่วยงาน ตำแหน่ง และพื้นที่รับผิดชอบ</li><li>รอผู้ดูแลระบบอนุมัติ แล้วใช้งานได้ทุกส่วน</li></ol>' + login + '</div>';
    else if (S.state === 'pending') html = '<div class="card gate"><h2>บัญชีของคุณกำลังรออนุมัติ</h2>' +
      '<p>ระหว่างนี้กรุณากรอก <b>ข้อมูลของฉัน</b> ด้านล่างให้ครบ ผู้ดูแลระบบจะใช้ข้อมูลนี้ยืนยันตัวตนก่อนอนุมัติ เมื่ออนุมัติแล้วหน้านี้จะเปิดให้ลงเวลาและส่งรายงานได้ทันที</p></div>';
    else if (S.state === 'rejected') html = '<div class="card gate"><h2>บัญชีนี้ไม่ได้รับอนุมัติ</h2><p>หากเชื่อว่าเป็นข้อผิดพลาด กรุณาติดต่อผู้ดูแลระบบ</p></div>';
    g.innerHTML = html;
    g.classList.toggle('hide', !html);
  }

  function renderHello() {
    $('helloName').textContent = 'สวัสดี ' + displayName();
    var p = S.mine;
    $('helloSub').textContent = p
      ? [p.position, p.agency, p.unit ? NO.unitLabel(p.unit) : ''].filter(Boolean).join(' · ') || 'ยังไม่ได้กรอกหน่วยงาน/ตำแหน่ง'
      : 'ยังไม่ได้กรอกข้อมูลของฉัน — กรอกด้านล่างก่อนเริ่มใช้งาน';
  }

  function renderSchema() {
    var el = $('schemaNote');
    if (S.schema) { el.classList.add('hide'); return; }
    el.classList.remove('hide');
    el.innerHTML = '<div class="lock"><b>ระบบงานเจ้าหน้าที่ยังไม่เปิดใช้งาน</b>' + (S.admin
      ? 'ผู้ดูแลระบบ: รันไฟล์ <code>supabase/schema-v11.sql</code> ใน Supabase SQL Editor หนึ่งครั้ง หน้านี้จะใช้งานได้ทันที'
      : 'กรุณาแจ้งผู้ดูแลระบบให้เปิดใช้งาน (schema-v11) ระหว่างนี้ยังส่งต่อข้อมูลทางช่องทางเดิมได้ตามปกติ') + '</div>';
  }

  function renderDuty() {
    var p = S.mine, on = !!(p && p.on_duty);
    $('dutyPill').dataset.on = on ? '1' : '0';
    $('dutyPill').textContent = on ? 'กำลังปฏิบัติงาน' : 'ไม่ได้ปฏิบัติงาน';
    if (on) {
      $('dutyInfo').innerHTML = 'ตั้งแต่ <b>' + esc(NO.fmtTime(p.duty_since)) + '</b> (' + esc(NO.duration(Date.now() - Date.parse(p.duty_since))) + ')' +
        ' · <b>' + esc(NO.unitLabel(p.unit)) + '</b>' + (p.duty_note ? ' · ' + esc(p.duty_note) : '') +
        (p.lat != null && p.loc_at ? '<br>แชร์ตำแหน่งล่าสุด ' + esc(NO.ago(p.loc_at)) : '');
    } else {
      $('dutyInfo').textContent = 'ลงเวลาเมื่อเริ่มปฏิบัติงาน ผู้บริหารจะเห็นกำลังพลรายพื้นที่ใน War Room ทันที';
    }
    // ไม่เขียนทับสิ่งที่ผู้ใช้กำลังแก้อยู่ (รีเฟรชอัตโนมัติทุกนาที)
    if (!S.dutyDirty) {
      $('dNote').value = (p && p.duty_note) || '';
      if (on && p.unit) $('dUnitSel').value = p.unit;
    }
    if (on) $('dShare').checked = p.lat != null;
    $('dBtn').textContent = on ? 'จบการปฏิบัติงาน' : 'เริ่มปฏิบัติงาน';
    $('dBtn').classList.toggle('ghost', on);
    $('dSave').classList.toggle('hide', !on);
    $('dLoc').classList.toggle('hide', !(on && $('dShare').checked));
  }

  function openDirs() {
    return (S.dirs || []).filter(function (d) { return NO.OPEN_D.indexOf(d.status) >= 0; });
  }
  function renderOrders() {
    var el = $('ordList');
    if (!S.schema) { el.innerHTML = '<div class="empty">ยังไม่เปิดใช้งาน</div>'; return; }
    if (!S.dirs) { el.innerHTML = S.loadErr ? '<div class="empty">โหลดข้อสั่งการไม่สำเร็จ</div>' : '<div class="empty"><span class="spin"></span></div>'; return; }
    var ae = document.activeElement;
    if (ae && ae.tagName === 'INPUT' && el.contains(ae)) { S.ordPending = true; return; }
    S.ordPending = false;
    var u = myUnit();
    var mineOpen = openDirs().filter(function (d) { return d.unit === 'all' || (u && d.unit === u); });
    $('jumpOrd').textContent = mineOpen.length;
    $('jumpOrd').classList.toggle('hide', !mineOpen.length);
    var list = S.ordFilter === 'mine' ? mineOpen : S.dirs.slice();
    list.sort(NO.dirSort);
    var ctx = { meId: myId(), admin: S.admin };
    el.innerHTML = list.map(function (d) { return NO.dirHtml(d, ctx); }).join('') ||
      '<div class="empty">' + (S.ordFilter === 'mine'
        ? (u ? 'ไม่มีข้อสั่งการค้างถึง ' + esc(NO.unitLabel(u)) : 'ยังไม่ได้เลือกพื้นที่รับผิดชอบใน "ข้อมูลของฉัน"')
        : 'ไม่มีข้อสั่งการใน 7 วันที่ผ่านมา') + '</div>';
  }

  function renderMineReports() {
    var el = $('mineList');
    if (!S.schema) { el.innerHTML = '<div class="empty">ยังไม่เปิดใช้งาน</div>'; return; }
    if (!S.reports) { el.innerHTML = S.loadErr ? '<div class="empty">โหลดรายงานไม่สำเร็จ</div>' : '<div class="empty"><span class="spin"></span></div>'; return; }
    el.innerHTML = S.reports.map(function (r) { return NO.repHtml(r, { del: true }); }).join('') ||
      '<div class="empty">ยังไม่มีรายงานใน 7 วันที่ผ่านมา · ส่งรายงานแรกได้จากฟอร์มด้านซ้าย</div>';
  }

  function renderDirectory() {
    var el = $('dirList');
    if (!S.schema) { el.innerHTML = '<div class="empty">ยังไม่เปิดใช้งาน</div>'; $('dirCount').textContent = ''; return; }
    if (!S.staff) { el.innerHTML = S.loadErr ? '<div class="empty">โหลดรายชื่อไม่สำเร็จ</div>' : '<div class="empty"><span class="spin"></span></div>'; return; }
    var q = $('qName').value.trim().toLowerCase(), fu = $('qUnit').value, fd = $('qDuty').checked;
    var list = S.staff.filter(function (p) {
      if (fu && p.unit !== fu) return false;
      if (fd && !p.on_duty) return false;
      if (q && [p.display_name, p.agency, p.position].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      return (b.on_duty - a.on_duty) || String(a.display_name).localeCompare(String(b.display_name), 'th');
    });
    $('dirCount').textContent = S.staff.length + ' คน · ปฏิบัติงานอยู่ ' + S.staff.filter(function (p) { return p.on_duty; }).length + ' คน';
    el.innerHTML = list.map(function (p) {
      var tel = NO.telHref(p.phone);
      var line = p.line_id ? 'https://line.me/ti/p/~' + encodeURIComponent(p.line_id) : '';
      return '<div class="sitem"><div><div class="nm">' + esc(p.display_name) + (p.on_duty ? '<span class="duty-on">ปฏิบัติงาน</span>' : '') + '</div>' +
        '<div class="ps">' + esc([p.position, p.agency].filter(Boolean).join(' · ') || 'ยังไม่ระบุหน่วยงาน') + '</div>' +
        (p.unit ? '<span class="unitchip">' + esc(NO.unitLabel(p.unit)) + '</span>' : '') +
        (p.on_duty && p.duty_note ? '<div class="ps">' + esc(p.duty_note) + '</div>' : '') + '</div>' +
        '<div class="tel">' + (tel ? '<a class="wbtn ghost sm" href="' + tel + '" aria-label="โทรหา ' + esc(p.display_name) + '">โทร</a>' : '') +
        (line ? '<a class="wbtn ghost sm" href="' + line + '" target="_blank" rel="noopener">LINE</a>' : '') + '</div></div>';
    }).join('') || '<div class="empty">ไม่พบเจ้าหน้าที่ตามเงื่อนไข</div>';
  }

  function fillMeForm() {
    if (S.meDirty) return;   // กำลังแก้อยู่ ไม่เขียนทับ
    var p = S.mine, f = function (id, v) { $(id).value = v || ''; };
    f('mName', p ? p.display_name : (S.profile && S.profile.full_name) || '');
    f('mPos', p && p.position); f('mAgency', p && p.agency); f('mPhone', p && p.phone); f('mLine', p && p.line_id);
    if (p && p.unit) $('mUnit').value = p.unit;
  }

  function renderAll() {
    renderGate();
    var showPortal = S.member;
    $('portal').classList.toggle('hide', !showPortal);
    $('me').classList.toggle('hide', !(S.member || S.state === 'pending'));
    if (S.member || S.state === 'pending') { unitSelects(); fillMeForm(); }
    if (!showPortal) return;
    renderHello(); renderSchema(); renderDuty(); renderOrders(); renderMineReports(); renderDirectory();
    ['dutyForm', 'repForm'].forEach(function (id) {
      $(id).querySelectorAll('input,select,textarea,button').forEach(function (x) { x.disabled = !S.schema; });
    });
  }

  /* ===================================================================
     การกระทำ
     =================================================================== */
  function upsertMine(fields) {
    var rec = Object.assign({ user_id: myId(), display_name: displayName() }, fields);
    return SB.from('staff_members').upsert(rec, { onConflict: 'user_id' }).select().maybeSingle().then(function (r) {
      if (r.error) throw r.error;
      if (r.data) S.mine = r.data; else S.mine = Object.assign({}, S.mine || {}, rec);
    });
  }

  // ---- ข้อมูลของฉัน ----
  $('meForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!SB || !myId()) return;
    var name = $('mName').value.trim();
    if (!name) { $('mName').focus(); msg('mMsg', 'กรุณากรอกชื่อ-สกุล', 'err'); return; }
    var btn = $('mSave'); btn.disabled = true; msg('mMsg', 'กำลังบันทึก…');
    upsertMine({
      display_name: name, position: $('mPos').value.trim() || null, agency: $('mAgency').value.trim() || null,
      unit: $('mUnit').value || null, phone: $('mPhone').value.trim() || null, line_id: $('mLine').value.trim().replace(/^@/, '') || null
    }).then(function () {
      S.meDirty = false;
      msg('mMsg', S.member ? 'บันทึกแล้ว' : 'บันทึกแล้ว · ผู้ดูแลระบบจะเห็นข้อมูลนี้ตอนพิจารณาอนุมัติ', 'ok');
      return S.member ? loadOps() : null;
    }).then(renderAll).catch(function (err) {
      msg('mMsg', 'บันทึกไม่สำเร็จ: ' + errText(err), 'err');
    }).then(function () { btn.disabled = false; });
  });

  $('meForm').addEventListener('input', function () { S.meDirty = true; });

  // ---- ลงเวลา ----
  $('dutyForm').addEventListener('input', function (e) { if (e.target.id !== 'dShare') S.dutyDirty = true; });
  /* ช่องแชร์ตำแหน่งคือความยินยอมแบบสด: ติ๊กออกระหว่างปฏิบัติงาน = ลบตำแหน่งที่แชร์ไว้ทันที */
  $('dShare').addEventListener('change', function () {
    var on = !!(S.mine && S.mine.on_duty);
    $('dLoc').classList.toggle('hide', !(on && $('dShare').checked));
    if (!on || !SB) return;
    var job = $('dShare').checked
      ? getPos().then(function (p) { return upsertMine({ lat: p.lat, lon: p.lon, loc_at: new Date().toISOString() }); })
      : upsertMine({ lat: null, lon: null, loc_at: null });
    msg('dMsg', $('dShare').checked ? 'กำลังแชร์ตำแหน่ง…' : 'กำลังหยุดแชร์ตำแหน่ง…');
    job.then(function () {
      msg('dMsg', $('dShare').checked ? 'แชร์ตำแหน่งแล้ว' : 'หยุดแชร์และลบตำแหน่งแล้ว', 'ok'); renderDuty();
    }).catch(function (err) {
      msg('dMsg', err.message || errText(err), 'err');
      $('dShare').checked = !$('dShare').checked; renderDuty();
    });
  });
  $('dutyForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!SB || !S.member) return;
    var on = !!(S.mine && S.mine.on_duty), btn = $('dBtn');
    btn.disabled = true;
    var job;
    if (on) {
      job = upsertMine({ on_duty: false, duty_since: null, lat: null, lon: null, loc_at: null }).then(function () { msg('dMsg', 'จบการปฏิบัติงานแล้ว · ขอบคุณครับ/ค่ะ', 'ok'); });
    } else {
      var unit = $('dUnitSel').value;
      if (!unit) { btn.disabled = false; msg('dMsg', 'กรุณาเลือกพื้นที่ปฏิบัติงาน', 'err'); $('dUnitSel').focus(); return; }
      msg('dMsg', 'กำลังลงเวลา…');
      var pos = $('dShare').checked ? getPos().catch(function (err) { msg('dMsg', err.message + ' · ลงเวลาโดยไม่แชร์ตำแหน่ง', 'err'); return null; }) : Promise.resolve(null);
      job = pos.then(function (p) {
        var rec = { on_duty: true, duty_since: new Date().toISOString(), unit: unit, duty_note: $('dNote').value.trim() || null,
          lat: p ? p.lat : null, lon: p ? p.lon : null, loc_at: p ? new Date().toISOString() : null };
        return upsertMine(rec);
      }).then(function () { if (!$('dMsg').dataset.k) msg('dMsg', 'ลงเวลาแล้ว · ปรากฏใน War Room แล้ว', 'ok'); });
    }
    job.then(function () { S.dutyDirty = false; return loadOps(); }).then(renderAll).catch(function (err) {
      msg('dMsg', 'ไม่สำเร็จ: ' + errText(err), 'err');
    }).then(function () { btn.disabled = false; });
  });
  $('dSave').addEventListener('click', function () {
    if (!S.mine || !S.mine.on_duty) return;
    $('dSave').disabled = true;
    upsertMine({ unit: $('dUnitSel').value || S.mine.unit, duty_note: $('dNote').value.trim() || null })
      .then(function () { S.dutyDirty = false; msg('dMsg', 'บันทึกพื้นที่/ภารกิจแล้ว', 'ok'); return loadOps(); }).then(renderAll)
      .catch(function (err) { msg('dMsg', 'ไม่สำเร็จ: ' + errText(err), 'err'); })
      .then(function () { $('dSave').disabled = false; });
  });
  $('dLoc').addEventListener('click', function () {
    $('dLoc').disabled = true; msg('dMsg', 'กำลังระบุตำแหน่ง…');
    getPos().then(function (p) { return upsertMine({ lat: p.lat, lon: p.lon, loc_at: new Date().toISOString() }); })
      .then(function () { msg('dMsg', 'อัปเดตตำแหน่งแล้ว', 'ok'); renderDuty(); })
      .catch(function (err) { msg('dMsg', err.message || errText(err), 'err'); })
      .then(function () { $('dLoc').disabled = false; });
  });

  // ---- รายงานภาคสนาม ----
  $('rSev').addEventListener('change', sevHint);
  $('rLocBtn').addEventListener('click', function () {
    $('rLocTxt').textContent = 'กำลังระบุตำแหน่ง…';
    getPos().then(function (p) {
      S.loc = p;
      $('rLocTxt').textContent = p.lat.toFixed(5) + ', ' + p.lon.toFixed(5) + (p.acc ? ' (±' + Math.round(p.acc) + ' ม.)' : '');
    }).catch(function (err) { S.loc = null; $('rLocTxt').textContent = err.message; });
  });
  $('repForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!SB || !S.member) return;
    var unit = $('rUnit').value;
    var kind = (document.querySelector('input[name="rKind"]:checked') || {}).value;
    var sev = (document.querySelector('input[name="rSev"]:checked') || {}).value;
    if (!unit) { msg('rMsg', 'กรุณาเลือกพื้นที่', 'err'); $('rUnit').focus(); return; }
    if (!kind || !sev) { msg('rMsg', 'กรุณาเลือกประเภทและระดับสถานการณ์', 'err'); return; }
    var btn = $('rSubmit'); btn.disabled = true; msg('rMsg', 'กำลังส่งรายงาน…');
    var file = $('rPhoto').files && $('rPhoto').files[0];
    var u = NO.unitById(unit);
    var photo = file && typeof uploadFloodPhoto === 'function'
      ? shrinkImage(file).then(uploadFloodPhoto).catch(function () { return null; })
      : Promise.resolve(null);
    var amphoe = u && u.amphoe ? Promise.resolve(u.amphoe)
      : (S.loc ? NO.loadDistricts().then(function () { return NO.amphoeAt(S.loc.lat, S.loc.lon) || null; }) : Promise.resolve(null));
    Promise.all([photo, amphoe]).then(function (res) {
      var photoUrl = res[0], amp = res[1];
      return SB.from('field_reports').insert({
        unit: unit, amphoe: amp, place: $('rPlace').value.trim() || null, kind: kind, severity: sev,
        water_cm: numOrNull($('rWater').value), households: intOrNull($('rHh').value), people: intOrNull($('rPpl').value),
        needs: Array.prototype.map.call(document.querySelectorAll('input[name="rNeeds"]:checked'), function (x) { return x.value; }),
        detail: $('rDetail').value.trim() || null, photo_url: photoUrl,
        lat: S.loc ? S.loc.lat : null, lon: S.loc ? S.loc.lon : null,
        reporter_name: myName() || null, reporter_phone: (S.mine && S.mine.phone) || null, created_by: myId()
      }).then(function (r) {
        if (r.error) throw r.error;
        msg('rMsg', 'ส่งรายงานแล้ว' + (file && !photoUrl ? ' (อัปโหลดรูปไม่สำเร็จ ส่งเฉพาะข้อความ)' : '') + ' · ปรากฏใน War Room เทศบาลแล้ว', 'ok');
        ['rPlace', 'rWater', 'rHh', 'rPpl', 'rDetail', 'rPhoto'].forEach(function (id) { $(id).value = ''; });
        document.querySelectorAll('input[name="rNeeds"]').forEach(function (x) { x.checked = false; });
        S.loc = null; $('rLocTxt').textContent = 'ยังไม่ระบุ';
        return loadOps().then(renderAll);
      });
    }).catch(function (err) {
      msg('rMsg', 'ส่งไม่สำเร็จ: ' + errText(err), 'err');
    }).then(function () { btn.disabled = false; });
  });

  // ---- รายงานของฉัน: คลี่คลาย / เปิดใหม่ / ลบ ----
  $('mineList').addEventListener('click', function (e) {
    var item = e.target.closest('.ritem'); if (!item || !SB) return;
    var b = e.target.closest('button'); if (!b) return;
    var id = item.dataset.id, job;
    if (b.hasAttribute('data-rdel')) {
      if (!confirm('ลบรายงานนี้ออกจากระบบ? (War Room จะไม่เห็นรายงานนี้อีก)')) return;
      job = SB.from('field_reports').delete().eq('id', id);
    } else if (b.dataset.rs) {
      job = SB.from('field_reports').update({ status: b.dataset.rs }).eq('id', id);
    } else return;
    b.disabled = true;
    job.then(function (r) { if (r.error) throw r.error; return loadOps(); }).then(renderAll)
      .catch(function (err) { alert('ไม่สำเร็จ: ' + errText(err)); b.disabled = false; });
  });

  // ---- ข้อสั่งการ: อัปเดตสถานะ (ปุ่มชุดเดียวกับ War Room) ----
  $('ordList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-ds]'); if (!b || !SB) return;
    var item = b.closest('.ditem'), inp = item.querySelector('input');
    var status = b.dataset.ds, note = inp ? inp.value.trim() : '';
    if (status === 'cancelled' && !confirm('ยืนยันยกเลิกข้อสั่งการนี้?')) return;
    var rec = { status: status, status_by_name: myName() || null };
    if (note) rec.status_note = note;
    item.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
    SB.from('directives').update(rec).eq('id', item.dataset.id).then(function (r) {
      if (r.error) throw r.error;
      if (inp) inp.value = '';
      if (document.activeElement) document.activeElement.blur();
      return loadOps();
    }).then(renderAll).catch(function (err) {
      alert('อัปเดตสถานะไม่สำเร็จ: ' + errText(err));
      item.querySelectorAll('button').forEach(function (x) { x.disabled = false; });
    });
  });
  $('ordList').addEventListener('focusout', function () { setTimeout(function () { if (S.ordPending) renderOrders(); }, 0); });
  $('ordSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-f]'); if (!b) return;
    S.ordFilter = b.dataset.f;
    $('ordSeg').querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
    renderOrders();
  });

  // ---- ทำเนียบ ----
  ['qName', 'qUnit', 'qDuty'].forEach(function (id) { $(id).addEventListener(id === 'qName' ? 'input' : 'change', renderDirectory); });

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-login]') && typeof signInWithGoogle === 'function') signInWithGoogle(location.href);
  });

  /* ===================================================================
     สิทธิ์ผู้ใช้ + เริ่มทำงาน
     =================================================================== */
  var jumped = false;
  function jumpToHash() {
    if (jumped || !S.member || !location.hash) return;
    var t = document.getElementById(location.hash.slice(1));
    if (t && !t.closest('.hide')) { jumped = true; setTimeout(function () { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120); }
  }
  function setState(state, profile) {
    var wasMember = S.member, prevId = S.profile && S.profile.id;
    S.state = state; S.profile = profile || null;
    S.member = state === 'approved' || state === 'admin';
    S.admin = state === 'admin';
    if (!profile) { S.mine = null; S.staff = S.reports = S.dirs = null; }
    var first = (profile && profile.id) !== prevId || S.member !== wasMember;
    if (first && profile) refresh().then(jumpToHash);
    else renderAll();
  }

  fillStatic();
  if (SB && typeof watchAuthState === 'function') {
    try {
      watchAuthState({
        onSignedOut: function () { setState('signedout', null); },
        onPending: function (p) { setState('pending', p); },
        onRejected: function (p) { setState('rejected', p); },
        onApproved: function (p) { setState('approved', p); },
        onAdmin: function (p) { setState('admin', p); }
      });
    } catch (e) { setState('offline', null); }
  } else setState('offline', null);

  setInterval(function () {
    if (document.visibilityState === 'visible' && S.member) loadMine().then(loadOps).then(renderAll);
  }, OPS_EVERY);
})();
