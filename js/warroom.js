/* js/warroom.js · War Room เทศบาล (warroom.html)
 * กระดานสถานการณ์รายพื้นที่สำหรับผู้บริหารส่วนราชการ จ.นราธิวาส
 *
 * สองชั้นข้อมูล
 *   1) สถานการณ์ (เปิดสาธารณะ): ระดับน้ำ ฝนพยากรณ์ ดินอิ่มน้ำ ศูนย์พักพิง ถนนน้ำท่วม
 *      แหล่งและเกณฑ์ชุดเดียวกับหน้าแรก (js/criteria.js) ตัวเลขจึงตรงกันทุกหน้า
 *   2) การปฏิบัติงาน (เฉพาะสมาชิกอนุมัติ, RLS ใน supabase/schema-v11.sql):
 *      รายงานภาคสนาม ข้อสั่งการ เจ้าหน้าที่ปฏิบัติงาน
 *      ยังไม่ได้รัน schema-v11 → ส่วนนี้ขึ้นข้อความบอก ส่วนสถานการณ์ยังทำงานปกติ
 *
 * ต้องโหลดหลัง: supabase-client.js, criteria.js, shelters_nwt.js, nara-units.js
 */
(function () {
  'use strict';

  var FC = window.FloodCriteria, NO = window.NaraOps;
  if (!FC || !NO) return;

  var $ = function (id) { return document.getElementById(id); };
  var esc = NO.esc;
  var num = function (v) { var n = parseFloat(v); return isNaN(n) ? null : n; };
  var thName = function (o) { return (o && typeof o === 'object') ? (o.th || o.en || '') : (o || ''); };
  var fmt0 = function (v) { return v == null ? '–' : Math.round(v).toLocaleString('th-TH'); };
  var fmt2 = function (v) { return v == null ? '–' : (+v).toFixed(2); };
  var SB = null;
  try { if (window.supabase && typeof sb !== 'undefined') SB = sb; } catch (e) { SB = null; }

  var PROV = 'นราธิวาส', PROV_CODE = '96';
  var TW_API = 'https://api-v3.thaiwater.net/api/v1/thaiwater30';
  var DDPM_PROXY = 'https://ddpm-proxy.newusmanwaji.workers.dev';
  var RID_URL = 'https://raw.githubusercontent.com/usmanwaji/waterchaidantai/cam/stations.json';
  var RID_CAM = 'https://raw.githubusercontent.com/usmanwaji/waterchaidantai/cam';
  var FRESH_MS = FC.CRIT.STALE_H * 3600e3;          // ค่าที่เก่ากว่า 6 ชม. ไม่ใช้ตัดสินสถานะ
  var SIT_EVERY = 5 * 60e3, OPS_EVERY = 60e3;
  var OPEN_D = NO.OPEN_D;

  /* จุดกลางอำเภอชุดเดียวกับ index.html (AMPHOES) และเรียงลำดับเดียวกัน
     URL พยากรณ์จึงเหมือนหน้าแรกทุกตัวอักษร ตัวเลขฝนตรงกันและแคชใช้ร่วมกันได้ */
  var AMP_PTS = [
    ['เมืองนราธิวาส', 6.4297, 101.813], ['ตากใบ', 6.2407, 102.0025], ['บาเจาะ', 6.5542, 101.6498],
    ['ยี่งอ', 6.4217, 101.7041], ['ระแงะ', 6.2238, 101.7138], ['รือเสาะ', 6.3792, 101.5171],
    ['ศรีสาคร', 6.1906, 101.5017], ['แว้ง', 5.8877, 101.8733], ['สุคิริน', 5.91, 101.7221],
    ['สุไหงโก-ลก', 6.073, 101.99], ['สุไหงปาดี', 6.1298, 101.9017], ['จะแนะ', 6.0404, 101.614],
    ['เจาะไอร้อง', 6.2149, 101.8411]
  ];

  /* ระดับเตือนของ ปภ. (waterLevelStatus) · r = อันดับในสเกลเดียวกับหน้าแรก */
  var DDPM_LV = {
    1: { l: 'ปกติ', r: 0 }, 2: { l: 'เฝ้าระวัง', r: 1 }, 3: { l: 'เตรียมรับมือ', r: 2 },
    4: { l: 'อพยพ', r: 3 }, 5: { l: 'ต้องอพยพ', r: 3 }
  };

  /* ศูนย์พักพิงที่จังหวัดเตรียมไว้ (รายชื่อตั้งต้น ไม่มีสถานะสด) นับรายอำเภอ */
  var PREP = {};
  try {
    (typeof SHELTERS_NWT !== 'undefined' ? SHELTERS_NWT : []).forEach(function (s) {
      var a = NO.normAmphoe(s.amphoe);
      PREP[a] = PREP[a] || { n: 0, cap: 0 };
      PREP[a].n++; PREP[a].cap += (+s.cap || 0);
    });
  } catch (e) { /* ไม่มีรายชื่อตั้งต้นก็ยังใช้งานได้ */ }

  var S = {
    tw: [], ddpm: [], rid: [], soil: {}, meteo: null, shelters: null, roads: null,
    staff: null, reports: null, directives: null, opsErr: null, opsBusy: false,
    state: 'loading', me: null, myStaff: null, member: false, admin: false,
    sitAt: null, opsAt: null, fail: [], open: new Set(), units: [],
    dirFilter: 'open', repFilter: 'open', dirPending: false
  };

  var ICON_LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/></svg>';
  var SPIN = '<div class="empty"><span class="spin"></span> กำลังโหลด…</div>';

  function getJSON(url, opts) {
    return fetch(url, opts).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function timeout(ms) { var c = new AbortController(); setTimeout(function () { c.abort(); }, ms); return c.signal; }
  function bkkHourKey() {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    var g = function (t) { var x = p.find(function (q) { return q.type === t; }); return x ? x.value : '00'; };
    return g('year') + '-' + g('month') + '-' + g('day') + 'T' + g('hour') + ':00';
  }
  var telHref = NO.telHref, lvPill = NO.lvPill, lvOfReport = NO.lvOfReport, dirSort = NO.dirSort;

  /* ===================================================================
     1) โหลดข้อมูลสถานการณ์
     =================================================================== */
  function twRank(s) {
    var L = FC.stationLevel(s);
    if (L === 'over') return 3;
    if (L === 'high') return 2;
    // เกณฑ์ "กำลังขึ้น" ชุดเดียวกับการ์ดสถานีหลักในหน้าแรก
    if (s.msl != null && s.prev != null && s.msl - s.prev >= 0.03 && (s.pct == null ? 0 : s.pct) >= FC.CRIT.PCT_MID) return 1;
    return 0;
  }

  function loadThaiwater() {
    return getJSON(TW_API + '/public/waterlevel?province_code=' + PROV_CODE).then(function (j) {
      var next = ((j && j.data) || []).map(function (d) {
        var st = d.station || {}, gc = d.geocode || {};
        return {
          src: 'tw', code: st.tele_station_oldcode || '', name: thName(st.tele_station_name).trim(),
          amphoe: NO.normAmphoe(thName(gc.amphoe_name)), prov: thName(gc.province_name),
          pct: num(d.storage_percent), msl: num(d.waterlevel_msl), prev: num(d.waterlevel_msl_previous),
          bank: FC.validBank(st.min_bank, st.left_bank, st.right_bank), ground: num(st.ground_level),
          lat: num(st.tele_station_lat), lon: num(st.tele_station_long), river: d.river_name || '',
          agency: thName(d.agency && d.agency.agency_shortname),
          dt: d.waterlevel_datetime ? new Date(String(d.waterlevel_datetime).replace(' ', 'T') + '+07:00') : null
        };
      });
      next.forEach(function (s) { s.pct = FC.fillPct(s); });
      S.tw = FC.dedupe(next);
      S.tw.forEach(function (s) { s.rank = twRank(s); });
    });
  }

  function loadDdpm() {
    return getJSON(DDPM_PROXY + '/stations?provCode=' + PROV_CODE + '&limit=100').then(function (j) {
      S.ddpm = ((j && j.data) || []).filter(function (d) { return d.isActive !== 0 && !d.deletedAt; }).map(function (d) {
        var cur = num(d.currentWaterLevel), bank = num(d.riverBankLevel);
        var lv = cur == null || d.status === 0 ? null : DDPM_LV[d.waterLevelStatus];
        var t = d.updatedAt ? String(d.updatedAt) : '';
        return {
          src: 'ddpm', code: d.code, name: (d.name || '').trim(), amphoe: NO.normAmphoe(d.amphoeName),
          river: d.basin && d.basin !== '-' ? d.basin : '', lat: num(d.latitude), lon: num(d.longitude),
          cur: cur, bank: bank, lvLabel: lv ? lv.l : null,
          // updatedAt ของ ปภ. เป็นเวลาไทยไม่มีโซน
          dt: t ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t + '+07:00') : null,
          rank: cur != null && bank != null && cur >= bank ? 3 : (lv ? lv.r : 0)
        };
      });
    });
  }

  function loadRid() {
    return getJSON(RID_URL, { cache: 'no-cache' }).then(function (j) {
      S.rid = ((j && j.stations) || []).filter(function (d) { return d.province === PROV; }).map(function (d) {
        var cur = num(d.level); if (cur != null && cur <= -9) cur = null;   // -9.99 = เซนเซอร์ไม่ส่งค่า
        var bank = num(d.critical) != null ? num(d.critical) : num(d.bank), w = num(d.warning);
        var warn = w != null && bank != null && w < bank ? w : null;
        return {
          src: 'rid', code: d.code, name: (d.name || '').trim(), amphoe: NO.normAmphoe(d.amphur),
          lat: num(d.lat), lon: num(d.lon), cur: cur, bank: bank, warn: warn,
          dt: cur != null && d.dt ? new Date(d.dt) : null,
          rank: cur == null || bank == null ? 0 : cur >= bank ? 3 : (warn != null && cur >= warn) ? 2 : 0
        };
      });
    });
  }

  function loadSoil() {
    return getJSON(TW_API + '/provinces/rain3d').then(function (j) {
      var out = {};
      ((j && j.data) || []).forEach(function (d) {
        var gc = d.geocode || {};
        if (thName(gc.province_name) !== PROV) return;
        var a = NO.normAmphoe(thName(gc.amphoe_name)), mm = num(d.rain_3d);
        if (mm == null) return;
        if (!(a in out) || mm > out[a]) out[a] = mm;
      });
      S.soil = out;
    });
  }

  function loadMeteo() {
    var lats = AMP_PTS.map(function (a) { return a[1]; }).join(','), lons = AMP_PTS.map(function (a) { return a[2]; }).join(',');
    var u = 'https://api.open-meteo.com/v1/forecast?latitude=' + lats + '&longitude=' + lons +
      '&hourly=precipitation,precipitation_probability,weather_code' +
      '&daily=precipitation_sum' +
      '&forecast_days=7&timezone=Asia%2FBangkok';
    return getJSON(u).then(function (j) {
      var arr = Array.isArray(j) ? j : [j], out = {}, key = bkkHourKey();
      AMP_PTS.forEach(function (a, i) {
        var m = arr[i]; if (!m) return;
        var daily = (m.daily && m.daily.precipitation_sum) || null;
        var ht = (m.hourly && m.hourly.time) || [], hp = (m.hourly && m.hourly.precipitation) || [];
        var rain24 = null;
        if (ht.length) {
          var i0 = ht.findIndex(function (t) { return t >= key; }); if (i0 < 0) i0 = 0;
          rain24 = hp.slice(i0, i0 + 24).reduce(function (x, y) { return x + (+y || 0); }, 0);
        }
        out[a[0]] = {
          daily: daily, days: (m.daily && m.daily.time) || [], rain24: rain24,
          rain1max: daily ? Math.max.apply(null, daily.map(function (v) { return +v || 0; })) : null,
          rain3max: daily ? FC.maxRoll3(daily) : null
        };
      });
      S.meteo = out;
    });
  }

  function loadShelters() {
    if (!SB) return Promise.resolve();
    return SB.from('shelters').select('id,name,amphoe,tambon,lat,lon,capacity,occupancy,status,updated_at').eq('province', PROV)
      .then(function (r) {
        if (r.error) throw r.error;
        S.shelters = (r.data || []).map(function (s) { s.amphoe = NO.normAmphoe(s.amphoe); return s; });
      });
  }

  function loadRoads() {
    if (!SB) return Promise.resolve();
    return Promise.all([
      SB.from('flood_reports').select('id,lat,lon,road_name,depth_cm,report_type,status,reported_at').eq('status', 'active'),
      NO.loadDistricts()
    ]).then(function (res) {
      var r = res[0];
      if (r.error) throw r.error;
      S.roads = (r.data || []).map(function (x) { x.amphoe = NO.amphoeAt(x.lat, x.lon); return x; })
        .filter(function (x) { return x.amphoe; });
    });
  }

  /* ค่าก่อนหน้าของ ปภ./ชป. สำหรับลูกศรขึ้น-ลง (แหล่งเดียวกับหน้าแรก) ไม่ขวางการแสดงผลรอบแรก */
  function loadTrends() {
    var now = Date.now();
    var fresh = function (s) { return s.cur != null && s.dt && (now - s.dt) <= FRESH_MS; };
    var jobs = [];
    S.ddpm.filter(fresh).forEach(function (s) {
      jobs.push(fetch(DDPM_PROXY + '/water-level/graph?stationCode=' + encodeURIComponent(s.code) + '&type=hour&isSimulatorMode=false', { signal: timeout(15000) })
        .then(function (r) { return r.json(); }).then(function (j) {
          var ds = ((j && (j.data != null ? j.data : j)) || {}).datasets;
          var pts = ((ds && ds[0] && ds[0].data) || []).map(function (p) { return num(p && p.y); }).filter(function (v) { return v != null; });
          if (pts.length >= 2) { s.prev = pts[pts.length - 2]; s.trendCur = pts[pts.length - 1]; }
        }));
    });
    S.rid.filter(fresh).forEach(function (s) {
      jobs.push(fetch(RID_CAM + '/' + encodeURIComponent(s.code) + '.detail.json', { cache: 'no-cache', signal: timeout(15000) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) {
          var t = (j && j.wl && j.wl.t) || [], v = (j && j.wl && j.wl.v) || [];
          var ok = t.map(function (x, i) { return [x, num(v[i])]; }).filter(function (p) { return p[0] && p[1] != null && p[1] > -9; });
          if (ok.length < 2) return;
          var last = ok[ok.length - 1];
          var back = ok.filter(function (p) { return p[0] <= last[0] - 3600; }).pop() || ok[0];
          if (back[0] < last[0]) { s.prev = back[1]; s.trendCur = last[1]; }
        }));
    });
    return Promise.allSettled(jobs);
  }

  var SRC_NAME = { tw: 'ระดับน้ำ สสน./ชป.', ddpm: 'สถานี ปภ.', rid: 'โทรมาตร ชป.', soil: 'ดินอิ่มน้ำ', meteo: 'ฝนพยากรณ์', shelters: 'ศูนย์พักพิง', roads: 'ถนนน้ำท่วม' };

  function loadSituation() {
    $('wrRefresh').disabled = true;
    var jobs = [['tw', loadThaiwater], ['ddpm', loadDdpm], ['rid', loadRid], ['soil', loadSoil],
      ['meteo', loadMeteo], ['shelters', loadShelters], ['roads', loadRoads]];
    return Promise.allSettled(jobs.map(function (j) { return j[1](); })).then(function (res) {
      S.fail = jobs.filter(function (j, i) { return res[i].status === 'rejected'; }).map(function (j) { return j[0]; });
      S.sitAt = new Date();
      $('wrRefresh').disabled = false;
      renderAll();
      return loadTrends().then(renderAll);
    });
  }

  /* ===================================================================
     2) งานเจ้าหน้าที่ (ต้องเป็นสมาชิกอนุมัติ)
     =================================================================== */
  function loadOps() {
    if (!S.member || !SB || S.opsBusy) return Promise.resolve();
    S.opsBusy = true;
    var since72 = new Date(Date.now() - 72 * 3600e3).toISOString();
    var since7d = new Date(Date.now() - 7 * 86400e3).toISOString();
    return Promise.all([
      SB.from('staff_members').select('user_id,display_name,agency,position,unit,phone,line_id,on_duty,duty_since,duty_note,lat,lon,loc_at,updated_at'),
      SB.from('field_reports').select('*').or('status.eq.open,created_at.gte."' + since72 + '"').order('created_at', { ascending: false }).limit(300),
      SB.from('directives').select('*').or('status.in.(ordered,acknowledged,in_progress),created_at.gte."' + since7d + '"').order('created_at', { ascending: false }).limit(300)
    ]).then(function (res) {
      var errs = res.map(function (r) { return r.error; }).filter(Boolean);
      if (errs.some(NO.isMissingTable)) {
        S.opsErr = 'schema'; S.staff = S.reports = S.directives = null;
      } else {
        S.opsErr = errs.length ? 'error' : null;
        if (!res[0].error) S.staff = res[0].data || [];
        if (!res[1].error) S.reports = res[1].data || [];
        if (!res[2].error) S.directives = res[2].data || [];
      }
      S.myStaff = (S.staff || []).find(function (p) { return S.me && p.user_id === S.me.id; }) || S.myStaff;
      S.opsAt = new Date();
    }).catch(function () { S.opsErr = 'error'; }).then(function () {
      S.opsBusy = false;
      renderAll();
    });
  }

  function myName() {
    var p = S.myStaff;
    if (p) return ((p.position ? p.position + ' ' : '') + p.display_name).trim();
    return (S.me && (S.me.full_name || S.me.email)) || '';
  }

  /* ===================================================================
     3) ประมวลผลรายพื้นที่
     =================================================================== */
  function closeness(s) {
    if (s.src === 'tw') return s.pct == null ? 0 : s.pct;
    return s.cur != null && s.bank != null ? 100 - Math.max(0, s.bank - s.cur) * 20 : 0;
  }
  function byRank(a, b) { return (b.rank - a.rank) || (closeness(b) - closeness(a)); }

  function trendOf(s) {
    if (s.src === 'tw') {
      if (s.msl == null || s.prev == null) return null;
      var d = s.msl - s.prev; return d >= 0.01 ? 1 : d <= -0.01 ? -1 : 0;
    }
    if (s.prev == null || s.trendCur == null) return null;
    var e = s.trendCur - s.prev; return e >= 0.02 ? 1 : e <= -0.02 ? -1 : 0;
  }
  function arrow(t) {
    if (t === 1) return ' <span class="up">▲ ขึ้น</span>';
    if (t === -1) return ' <span class="down">▼ ลด</span>';
    if (t === 0) return ' <span class="flat">● ทรงตัว</span>';
    return '';
  }
  function stValue(s) {
    if (s.src === 'tw') {
      if (s.msl == null) return 'ไม่มีค่า';
      if (s.bank != null && s.msl >= s.bank && (s.pct == null || s.pct >= 100)) return 'ล้นตลิ่ง ' + fmt2(s.msl - s.bank) + ' ม.';
      return s.pct != null ? Math.round(s.pct) + '% ของตลิ่ง' : fmt2(s.msl) + ' ม.รทก.';
    }
    if (s.cur == null) return 'ไม่มีค่า';
    if (s.bank == null) return fmt2(s.cur) + ' ม.';
    var gap = s.bank - s.cur;
    return gap > 0 ? 'ต่ำกว่าตลิ่ง ' + fmt2(gap) + ' ม.' : 'ล้นตลิ่ง ' + fmt2(-gap) + ' ม.';
  }
  function srcLabel(s) { return s.src === 'tw' ? (s.agency || 'สสน./ชป.') : s.src === 'ddpm' ? 'ปภ.' : 'โทรมาตร ชป.'; }
  function stReason(s) {
    var nm = (s.code ? s.code + ' ' : '') + s.name;
    if (s.src === 'ddpm') return (s.cur != null && s.bank != null && s.cur >= s.bank) ? 'ปภ. ' + s.name + ' ล้นตลิ่ง' : 'ปภ. ' + s.name + ' ระดับ "' + s.lvLabel + '"';
    if (s.src === 'rid') return s.rank === 3 ? 'ชป. ' + s.name + ' ล้นตลิ่ง' : 'ชป. ' + s.name + ' ถึงระดับเตือน';
    return s.rank === 3 ? nm + ' ล้นตลิ่ง' : s.rank === 2 ? nm + ' ' + Math.round(s.pct) + '% ของตลิ่ง' : nm + ' น้ำกำลังขึ้น (' + Math.round(s.pct) + '%)';
  }

  function computeUnits() {
    var now = Date.now();
    var all = [].concat(S.tw, S.ddpm, S.rid);
    all.forEach(function (s) { s.fresh = !!(s.dt && (now - s.dt.getTime()) <= FRESH_MS && (s.src === 'tw' ? s.msl != null : s.cur != null)); });
    S.allSt = all;

    var units = NO.UNITS.map(function (u) {
      var a = u.amphoe;
      var st = all.filter(function (s) { return s.amphoe === a; });
      var fr = st.filter(function (s) { return s.fresh; }).sort(byRank);
      var key = fr[0] || null, reasons = [], stLv = 0;
      if (key && key.rank > 0) { stLv = key.rank; reasons.push({ lv: stLv, t: stReason(key) }); }
      var more = fr.filter(function (s) { return s !== key && s.rank >= 2; }).length;
      if (more) reasons.push({ lv: stLv, t: 'และอีก ' + more + ' สถานีระดับเตรียมรับมือขึ้นไป' });

      // รายงานภาคสนามที่ยังไม่คลี่คลายใน 24 ชม.
      var reps = (S.reports || []).filter(function (r) { return r.unit === u.id; });
      var repsOpen = reps.filter(function (r) { return r.status === 'open'; });
      var repLv = 0, repTop = null;
      repsOpen.forEach(function (r) {
        if (now - Date.parse(r.created_at) > 24 * 3600e3) return;
        var l = lvOfReport(r); if (l > repLv) { repLv = l; repTop = r; }
      });
      if (repLv > 0) reasons.push({ lv: repLv, t: 'รายงานภาคสนาม: ' + NO.LEVELS[repLv].label + (repTop.place ? ' · ' + repTop.place : '') });

      // ป้าย "เสี่ยง 7 วัน" ใช้อินพุตเดียวกับหน้าแรกทุกตัว (รวมสถานี thaiwater) ตัวเลขจึงตรงกัน
      var m = S.meteo ? S.meteo[a] || null : null;
      var tw = S.tw.filter(function (s) { return s.amphoe === a; });
      var stOver = tw.filter(function (s) { return FC.stationLevel(s) === 'over'; }).length;
      var stHigh = tw.filter(function (s) { return FC.stationLevel(s) === 'high'; }).length;
      var soil = S.soil && a in S.soil ? S.soil[a] : null;
      var risk = m ? FC.amphoeRisk({ rain1max: m.rain1max, rain3max: m.rain3max, soil: soil || 0, stOver: stOver, stHigh: stHigh }) : null;
      // แต่ส่วนที่ยกสถานะพื้นที่คิดจากฝนกับดินอย่างเดียว เพราะสถานีถูกนับไปแล้วข้างบน
      // ไม่งั้นสถานีใกล้ตลิ่งจะโผล่เป็นเหตุผลซ้ำในชื่อ "ฝนพยากรณ์" ทั้งที่ฝนไม่ถึงเกณฑ์
      var rainRisk = m ? FC.amphoeRisk({ rain1max: m.rain1max, rain3max: m.rain3max, soil: soil || 0, stOver: 0, stHigh: 0 }) : null;
      var outLv = rainRisk && rainRisk.lv != null ? Math.min(rainRisk.lv, 2) : 0;
      if (outLv > 0) reasons.push({ lv: outLv, t: 'ฝนพยากรณ์ 7 วัน: ' + rainRisk.why + ' (สูงสุด ' + fmt0(m.rain1max) + ' มม./วัน)' });

      var lv = Math.max(stLv, repLv, outLv);
      reasons.sort(function (x, y) { return y.lv - x.lv; });

      var shel = (S.shelters || []).filter(function (s) { return s.amphoe === a; });
      var shOpen = shel.filter(function (s) { return s.status === 'open' || s.status === 'full'; });
      var dirs = (S.directives || []).filter(function (d) { return d.unit === u.id && OPEN_D.indexOf(d.status) >= 0; });
      var duty = (S.staff || []).filter(function (p) { return p.on_duty && p.unit === u.id; });

      return {
        u: u, lv: lv, hasData: fr.length > 0 || !!m || repsOpen.length > 0, reasons: reasons,
        st: st, fr: fr, key: key, m: m, soil: soil, risk: risk,
        shel: shel, shOpen: shOpen, occ: shOpen.reduce(function (x, s) { return x + (s.occupancy || 0); }, 0),
        prep: PREP[a] || { n: 0, cap: 0 },
        roads: (S.roads || []).filter(function (r) { return r.amphoe === a; }),
        reps: reps, repsOpen: repsOpen, dirs: dirs, duty: duty,
        hh: repsOpen.reduce(function (x, r) { return x + (r.households || 0); }, 0),
        ppl: repsOpen.reduce(function (x, r) { return x + (r.people || 0); }, 0)
      };
    });
    units.sort(function (x, y) {
      return (y.lv - x.lv) || ((y.key ? y.key.rank : 0) - (x.key ? x.key.rank : 0)) ||
        ((y.m && y.m.rain24 || 0) - (x.m && x.m.rain24 || 0)) || (NO.UNITS.indexOf(x.u) - NO.UNITS.indexOf(y.u));
    });
    return units;
  }
  function lvKey(x) { return x.hasData ? NO.LEVELS[x.lv].k : 'na'; }
  function lvLabel(x) { return x.hasData ? NO.LEVELS[x.lv].label : 'ไม่มีข้อมูล'; }

  /* ===================================================================
     4) แสดงผล
     =================================================================== */
  function renderAll() {
    S.units = computeUnits();
    renderCmd(S.units);
    renderTiles(S.units);
    renderBoard(S.units);
    renderMap(S.units);
    renderDirectives();
    renderReports();
    renderDuty();
    renderUpd();
  }

  function renderCmd(units) {
    var el = $('cmd');
    var has = units.some(function (x) { return x.hasData; });
    if (!has) {
      el.dataset.lv = 'na';
      $('cmdV').textContent = S.sitAt ? 'ไม่มีข้อมูล' : 'กำลังประเมิน…';
      if (S.sitAt) $('cmdS').textContent = 'โหลดข้อมูลสถานการณ์ไม่สำเร็จ กดรีเฟรชเพื่อลองอีกครั้ง';
      return;
    }
    var maxLv = Math.max.apply(null, units.map(function (x) { return x.lv; }));
    var cnt = [0, 0, 0, 0]; units.forEach(function (x) { cnt[x.lv]++; });
    var L = NO.LEVELS[maxLv], watch = cnt[1] + cnt[2] + cnt[3];
    el.dataset.lv = L.k;
    $('cmdV').textContent = L.label;
    var top = units.filter(function (x) { return maxLv > 0 && x.lv === maxLv; }).map(function (x) { return esc(x.u.short); });
    $('cmdS').innerHTML = watch
      ? 'ต้องติดตาม <b>' + watch + '</b> จาก ' + units.length + ' พื้นที่ · วิกฤต <b>' + cnt[3] + '</b> · เตรียมรับมือ <b>' + cnt[2] + '</b> · เฝ้าระวัง <b>' + cnt[1] + '</b>' +
        (top.length ? '<br>ระดับสูงสุดที่: <b>' + top.join(', ') + '</b>' : '')
      : 'ทุกพื้นที่อยู่ในระดับปกติ · ไม่มีสถานีใกล้ตลิ่ง และฝนพยากรณ์ 7 วันยังไม่ถึงเกณฑ์ฝนหนัก';
  }

  function tile(id, n, d, lv, locked) {
    var el = $(id);
    el.classList.toggle('locked', !!locked);
    if (lv) el.dataset.lv = lv; else delete el.dataset.lv;
    el.querySelector('.n').innerHTML = n;
    el.querySelector('.d').innerHTML = d || '&nbsp;';
  }
  function opsTileLock(id) {
    var t = S.state === 'loading' ? '…' : S.opsErr === 'schema' ? 'ยังไม่เปิดใช้' : ICON_LOCK.replace('<svg', '<svg style="width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.8;vertical-align:-2px"') + ' เฉพาะเจ้าหน้าที่';
    tile(id, t, S.member ? '' : 'เข้าสู่ระบบเพื่อดู', null, S.state !== 'loading');
  }

  function renderTiles(units) {
    var has = units.some(function (x) { return x.hasData; });
    var cnt = [0, 0, 0, 0]; units.forEach(function (x) { cnt[x.lv]++; });
    var watch = cnt[1] + cnt[2] + cnt[3];
    var maxLv = has ? Math.max.apply(null, units.map(function (x) { return x.lv; })) : 0;
    tile('tArea', has ? watch + '<small> / ' + units.length + '</small>' : '–',
      has ? 'วิกฤต ' + cnt[3] + ' · เตรียมรับมือ ' + cnt[2] : '', has ? NO.LEVELS[watch ? maxLv : 0].k : null);

    /* อันดับ 3 รวม ปภ. ประกาศอพยพที่น้ำยังไม่ถึงตลิ่งด้วย ป้ายจึงเป็น "วิกฤต" ไม่ใช่ "ล้นตลิ่ง" */
    var fr = (S.allSt || []).filter(function (s) { return s.fresh; });
    var over = fr.filter(function (s) { return s.rank === 3; }).length, high = fr.filter(function (s) { return s.rank === 2; }).length;
    tile('tSt', fr.length ? over + '<small> / ' + high + '</small>' : '–',
      fr.length ? 'จาก ' + fr.length + ' สถานีที่รายงานใน 6 ชม.' : 'ยังไม่มีค่าล่าสุด',
      fr.length ? (over ? 'danger' : high ? 'warn' : 'normal') : null);

    var best = null;
    if (S.meteo) AMP_PTS.forEach(function (a) {
      var m = S.meteo[a[0]]; if (m && m.rain24 != null && (!best || m.rain24 > best.v)) best = { v: m.rain24, a: a[0] };
    });
    if (best) {
      var at = NO.unitsOfAmphoe(best.a).map(function (u) { return u.short; })[0] || ('อ.' + best.a);
      tile('tRain', fmt0(best.v) + '<small> มม.</small>', esc(at), best.v >= 125 ? 'danger' : best.v >= 65 ? 'warn' : best.v >= 35 ? 'watch' : 'normal');
    } else tile('tRain', '–', S.fail.indexOf('meteo') >= 0 ? 'โหลดพยากรณ์ไม่สำเร็จ' : '');

    if (S.shelters) {
      var op = S.shelters.filter(function (s) { return s.status === 'open' || s.status === 'full'; });
      var occ = op.reduce(function (x, s) { return x + (s.occupancy || 0); }, 0);
      tile('tShel', op.length + '<small> แห่ง</small>', 'ผู้พักพิง ' + fmt0(occ) + ' คน');
    } else tile('tShel', '–', SB ? '' : 'ออฟไลน์');

    if (S.member && !S.opsErr && S.reports) {
      var ro = S.reports.filter(function (r) { return r.status === 'open'; });
      var crit = ro.filter(function (r) { return r.severity === 'danger'; }).length;
      var hh = ro.reduce(function (x, r) { return x + (r.households || 0); }, 0);
      tile('tRep', ro.length + '<small> เรื่อง</small>', 'วิกฤต ' + crit + ' · ' + fmt0(hh) + ' ครัวเรือน',
        ro.length ? (crit ? 'danger' : ro.some(function (r) { return r.severity === 'warn'; }) ? 'warn' : null) : null);
    } else opsTileLock('tRep');

    if (S.member && !S.opsErr && S.directives) {
      var pend = S.directives.filter(function (d) { return OPEN_D.indexOf(d.status) >= 0; });
      var late = pend.filter(function (d) { return d.due_at && Date.parse(d.due_at) < Date.now(); }).length;
      tile('tDir', pend.length + '<small> เรื่อง</small>', late ? '<b>เกินกำหนด ' + late + '</b>' : 'ไม่มีรายการเกินกำหนด');
    } else opsTileLock('tDir');

    if (S.member && !S.opsErr && S.staff) {
      var on = S.staff.filter(function (p) { return p.on_duty; });
      var areas = {}; on.forEach(function (p) { areas[p.unit || '-'] = 1; });
      tile('tDuty', on.length + '<small> คน</small>', on.length ? 'ใน ' + Object.keys(areas).length + ' พื้นที่' : 'ยังไม่มีผู้ลงเวลา');
    } else opsTileLock('tDuty');
  }

  function rowHtml(x) {
    var u = x.u, k = lvKey(x), open = S.open.has(u.id);
    var why = x.reasons.length ? x.reasons.slice(0, 2).map(function (r) { return esc(r.t); }).join(' · ')
      : (x.hasData ? 'ไม่มีสถานีใกล้ตลิ่ง ฝนพยากรณ์ไม่ถึงเกณฑ์' : '');
    // ระดับน้ำ
    var water;
    if (x.key) {
      var s = x.key, age = s.dt ? NO.ago(s.dt) : '';
      water = '<b>' + esc(stValue(s)) + '</b>' + arrow(trendOf(s)) +
        '<small>' + esc((s.code ? s.code + ' ' : '') + s.name) + ' · ' + esc(srcLabel(s)) + (age ? ' · ' + esc(age) : '') + '</small>' +
        (x.fr.length > 1 ? '<small>สถานีในอำเภอที่มีค่าล่าสุด ' + x.fr.length + ' สถานี</small>' : '');
    } else if (x.st.length) {
      water = '<span class="stale">ไม่มีค่าใน 6 ชม.</span><small>' + x.st.length + ' สถานีในอำเภอ</small>';
    } else water = '<span class="stale">ไม่มีสถานีในอำเภอ</span>';
    // ฝน
    var rain = x.m
      ? '<b>' + fmt0(x.m.rain24) + ' มม.</b> ใน 24 ชม.<small>เสี่ยง 7 วัน: <b style="color:' + x.risk.color + '">' + esc(x.risk.label) + '</b>' +
        (x.soil != null ? ' · ดิน ' + fmt0(x.soil) + ' มม.' : '') + '</small>'
      : '<span class="stale">' + (S.meteo ? 'ไม่มีข้อมูล' : S.fail.indexOf('meteo') >= 0 ? 'โหลดไม่สำเร็จ' : '…') + '</span>';
    // ศูนย์พักพิง / ถนน
    var shel = (S.shelters ? '<b>เปิด ' + x.shOpen.length + '</b>' + (x.shOpen.length ? ' · ' + fmt0(x.occ) + ' คน' : '') : '<span class="stale">–</span>') +
      '<small>' + (x.prep.n ? 'เตรียมไว้ ' + x.prep.n + ' แห่ง' : 'ไม่มีในรายชื่อศูนย์ตั้งต้น') +
        (S.roads && x.roads.length ? ' · ถนนน้ำท่วม ' + x.roads.length + ' จุด' : '') + '</small>';
    // การปฏิบัติงาน
    var ops;
    if (!S.member) ops = '<span class="lockmini">' + ICON_LOCK + 'เฉพาะเจ้าหน้าที่</span>';
    else if (S.opsErr === 'schema') ops = '<span class="lockmini">ยังไม่เปิดใช้งาน</span>';
    else if (!S.reports) ops = '<span class="spin"></span>';
    else ops = '<div class="opsl">' +
      '<span class="opc' + (x.repsOpen.length ? ' hot' : '') + '">รายงาน <b>' + x.repsOpen.length + '</b></span>' +
      '<span class="opc' + (x.dirs.length ? ' hot' : '') + '">สั่งการ <b>' + x.dirs.length + '</b></span>' +
      '<span class="opc">จนท. <b>' + x.duty.length + '</b></span></div>' +
      (x.hh || x.ppl ? '<small>ผลกระทบ ' + fmt0(x.hh) + ' ครัวเรือน · ' + fmt0(x.ppl) + ' คน</small>' : '');

    return '<div class="brow" role="button" tabindex="0" aria-expanded="' + open + '" aria-controls="det-' + u.id + '" data-u="' + u.id + '" data-lv="' + k + '">' +
      '<div class="bc area"><b>' + esc(u.short) + '</b><span class="chev" aria-hidden="true"></span><small>' +
        (u.kind === 'amphoe' ? 'ภาพรวมทั้งอำเภอ' : 'อ.' + esc(u.amphoe)) + '</small></div>' +
      '<div class="bc lvc"><span class="k">สถานะ</span>' + lvPill(k, lvLabel(x)) + (why ? '<div class="why">' + why + '</div>' : '') + '</div>' +
      '<div class="bc"><span class="k">ระดับน้ำ</span>' + water + '</div>' +
      '<div class="bc"><span class="k">ฝน</span>' + rain + '</div>' +
      '<div class="bc"><span class="k">ศูนย์พักพิง / ถนน</span>' + shel + '</div>' +
      '<div class="bc"><span class="k">การปฏิบัติงาน</span>' + ops + '</div>' +
      '</div>';
  }

  function stationLi(s) {
    var k = !s.fresh ? 'na' : s.rank === 3 ? 'danger' : s.rank === 2 ? 'warn' : s.rank === 1 ? 'watch' : 'normal';
    var lab = !s.fresh ? 'ข้อมูลเก่า' : s.src === 'ddpm' && s.lvLabel ? s.lvLabel
      : s.rank === 3 ? 'ล้นตลิ่ง' : s.rank === 2 ? (s.src === 'rid' ? 'ถึงระดับเตือน' : 'ใกล้ตลิ่ง') : s.rank === 1 ? 'น้ำขึ้น' : 'ปกติ';
    return '<li' + (s.fresh ? '' : ' class="stale"') + '><b>' + esc((s.code ? s.code + ' ' : '') + s.name) + '</b> ' + lvPill(k, lab) +
      '<br>' + esc(stValue(s)) + (s.fresh ? arrow(trendOf(s)) : '') +
      '<small>' + esc(srcLabel(s)) + (s.river ? ' · ' + esc(s.river) : '') + (s.dt ? ' · ' + esc(NO.ago(s.dt)) : '') + '</small></li>';
  }

  function detailHtml(x) {
    var u = x.u;
    // สถานีที่ไม่มีค่าล่าสุดรวบเป็นบรรทัดเดียว ผู้บริหารจะได้เห็นค่าจริงก่อนโดยไม่ต้องเลื่อนผ่านช่องว่าง
    var fresh = x.fr, stale = x.st.filter(function (s) { return !s.fresh; });
    var stHtml = (fresh.length ? '<ul class="dl">' + fresh.slice(0, 8).map(stationLi).join('') + '</ul>' : '<div class="empty">ไม่มีสถานีที่ส่งค่าภายใน 6 ชม.</div>') +
      (fresh.length > 8 ? '<div class="note">และอีก ' + (fresh.length - 8) + ' สถานี · ดูทั้งหมดที่ <a href="map.html">หน้าแผนที่</a></div>' : '') +
      (stale.length ? '<div class="note" style="margin-top:6px">ไม่มีค่าใน 6 ชม. (' + stale.length + '): ' +
        stale.map(function (s) { return esc((s.code ? s.code + ' ' : '') + s.name); }).join(', ') + '</div>' : '');
    if (!x.st.length) stHtml = '<div class="empty">ไม่มีสถานีวัดน้ำในอำเภอนี้</div>';

    var rainHtml;
    if (x.m && x.m.daily) {
      var mx = Math.max(35, Math.max.apply(null, x.m.daily.map(function (v) { return +v || 0; })));
      rainHtml = '<div class="rainbars" role="img" aria-label="ฝนพยากรณ์รายวัน 7 วัน">' + x.m.daily.map(function (v, i) {
        var d = x.m.days[i] ? new Date(x.m.days[i] + 'T00:00:00+07:00') : null;
        var lab = d ? d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'short' }) : '';
        var c = FC.tmdRainClass(+v || 0).color;
        return '<div><b>' + fmt0(v) + '</b><i style="height:' + Math.max(2, Math.round((+v || 0) / mx * 64)) + 'px;background:' + c + '"></i>' + esc(lab) + '</div>';
      }).join('') + '</div>' +
        '<div class="note">ฝน 24 ชม. ข้างหน้า <b>' + fmt0(x.m.rain24) + '</b> มม. · สะสม 3 วันสูงสุด <b>' + fmt0(x.m.rain3max) + '</b> มม.' +
        (x.soil != null ? ' · ฝน 3 วันที่ผ่านมา (ดินอิ่มน้ำ) <b>' + fmt0(x.soil) + '</b> มม.' : '') +
        '<br>ความเสี่ยง 7 วัน: <b style="color:' + x.risk.color + '">' + esc(x.risk.label) + '</b> — ' + esc(x.risk.why) + '</div>';
    } else rainHtml = '<div class="empty">ไม่มีข้อมูลฝนพยากรณ์</div>';

    var shHtml = x.shOpen.length
      ? '<ul class="dl">' + x.shOpen.map(function (s) {
          return '<li><b>' + esc(s.name) + '</b> · ' + (s.status === 'full' ? 'เต็ม' : 'เปิด') +
            '<small>ผู้พักพิง ' + fmt0(s.occupancy) + (s.capacity ? ' / ' + fmt0(s.capacity) : '') + ' คน · อัปเดต ' + esc(NO.ago(s.updated_at)) + '</small></li>';
        }).join('') + '</ul>'
      : '<div class="note">ยังไม่มีศูนย์ที่เปิด' + (x.prep.n ? ' · เตรียมไว้ ' + x.prep.n + ' แห่ง รองรับราว ' + fmt0(x.prep.cap) + ' คน' : '') + ' · <a href="shelter.html">หน้าศูนย์พักพิง</a></div>';

    var opsHtml;
    if (!S.member) opsHtml = lockHtml('ข้อมูลการปฏิบัติงาน');
    else if (S.opsErr === 'schema') opsHtml = schemaHtml();
    else {
      var reps = x.repsOpen.slice(0, 3).map(function (r) {
        return '<li>' + lvPill(r.severity, (NO.LEVEL_BY_K[r.severity] || {}).label || r.severity) + ' <b>' + esc(NO.KINDS[r.kind] || r.kind) + '</b>' +
          (r.place ? ' · ' + esc(r.place) : '') + '<small>' + esc(NO.ago(r.created_at)) + (r.reporter_name ? ' · ' + esc(r.reporter_name) : '') + '</small></li>';
      }).join('');
      var dirs = x.dirs.slice(0, 3).map(function (d) {
        return '<li><b>' + esc(d.title) + '</b><small>' + esc((NO.DSTATUS[d.status] || {}).l || d.status) + (d.due_at ? ' · กำหนด ' + esc(NO.fmtTime(d.due_at)) : '') + '</small></li>';
      }).join('');
      var duty = x.duty.map(function (p) {
        var tel = telHref(p.phone);
        return '<li><b>' + esc(p.display_name) + '</b>' + (p.position ? ' · ' + esc(p.position) : '') +
          (tel ? ' · <a href="' + tel + '">' + esc(p.phone) + '</a>' : '') + '<small>' + esc(p.agency || '') + (p.duty_note ? ' · ' + esc(p.duty_note) : '') + '</small></li>';
      }).join('');
      opsHtml = '<h3>รายงานที่ยังไม่คลี่คลาย (' + x.repsOpen.length + ')</h3>' + (reps ? '<ul class="dl">' + reps + '</ul>' : '<div class="note">ไม่มี</div>') +
        '<h3 style="margin-top:10px">ข้อสั่งการค้าง (' + x.dirs.length + ')</h3>' + (dirs ? '<ul class="dl">' + dirs + '</ul>' : '<div class="note">ไม่มี</div>') +
        '<h3 style="margin-top:10px">เจ้าหน้าที่ปฏิบัติงาน (' + x.duty.length + ')</h3>' + (duty ? '<ul class="dl">' + duty + '</ul>' : '<div class="note">ยังไม่มีผู้ลงเวลาในพื้นที่นี้</div>');
    }

    return '<div class="bdetail" id="det-' + u.id + '">' +
      '<div><h3>สถานีวัดน้ำในอำเภอ' + esc(u.amphoe) + ' (' + x.st.length + ')</h3>' + stHtml + '</div>' +
      '<div><h3>ฝนพยากรณ์รายวัน (มม.)</h3>' + rainHtml + '<h3 style="margin-top:12px">ศูนย์พักพิงที่เปิด</h3>' + shHtml + '</div>' +
      '<div>' + opsHtml + '<div class="dact no-tv">' +
        (S.member && S.opsErr !== 'schema' ? '<button type="button" class="wbtn sm" data-act="order" data-u="' + u.id + '">สั่งการพื้นที่นี้</button>' : '') +
        '<button type="button" class="wbtn ghost sm" data-act="map" data-u="' + u.id + '">ดูบนแผนที่</button></div></div>' +
      '</div>';
  }

  function renderBoard(units) {
    var el = $('board');
    if (!S.sitAt) return;
    var focus = document.activeElement && document.activeElement.classList.contains('brow') ? document.activeElement.dataset.u : null;
    el.innerHTML = units.map(function (x) { return rowHtml(x) + (S.open.has(x.u.id) ? detailHtml(x) : ''); }).join('');
    if (focus) { var f = el.querySelector('.brow[data-u="' + focus + '"]'); if (f) f.focus({ preventScroll: true }); }
    var bad = S.fail.filter(function (k) { return k === 'tw' || k === 'ddpm' || k === 'rid' || k === 'meteo'; });
    $('boardWhere').textContent = units.length + ' พื้นที่ · เรียงจากต้องติดตามมากที่สุด' +
      (bad.length ? ' · โหลดไม่สำเร็จ: ' + bad.map(function (k) { return SRC_NAME[k]; }).join(', ') : '');
  }

  function lockHtml(what) {
    if (S.state === 'loading') return SPIN;
    if (S.state === 'pending') return '<div class="lock"><b>บัญชีของคุณกำลังรออนุมัติ</b>เมื่อผู้ดูแลระบบอนุมัติแล้วจะเห็น' + esc(what) + 'ได้ทันที · ระหว่างนี้กรอกข้อมูลหน่วยงานไว้ที่ <a href="staff.html">หน้าเจ้าหน้าที่</a></div>';
    if (S.state === 'rejected') return '<div class="lock"><b>บัญชีนี้ไม่มีสิทธิ์เข้าถึง' + esc(what) + '</b>หากเป็นข้อผิดพลาด กรุณาติดต่อผู้ดูแลระบบ</div>';
    if (S.state === 'offline') return '<div class="lock"><b>ระบบสมาชิกไม่พร้อมใช้งาน</b>เชื่อมต่อฐานข้อมูลไม่ได้ (อาจออฟไลน์อยู่)</div>';
    return '<div class="lock"><b>' + esc(what) + 'เปิดให้เฉพาะเจ้าหน้าที่ที่ได้รับอนุมัติ</b>ส่วนนี้มีชื่อ เบอร์ติดต่อ และรายงานจากพื้นที่ จึงไม่เปิดสาธารณะ' +
      '<button type="button" class="wbtn sm" data-login>เข้าสู่ระบบด้วย Google</button></div>';
  }
  function schemaHtml() {
    return '<div class="lock"><b>ระบบงานเจ้าหน้าที่ยังไม่เปิดใช้งาน</b>' + (S.admin
      ? 'ผู้ดูแลระบบ: รันไฟล์ <code>supabase/schema-v11.sql</code> ใน Supabase SQL Editor หนึ่งครั้ง ส่วนนี้จะใช้งานได้ทันที'
      : 'กรุณาแจ้งผู้ดูแลระบบให้เปิดใช้งาน (schema-v11)') + '</div>';
  }
  function opsGate(el, what) {
    if (!S.member) { el.innerHTML = lockHtml(what); return true; }
    if (S.opsErr === 'schema') { el.innerHTML = schemaHtml(); return true; }
    return false;
  }

  /* ---------- ข้อสั่งการ ---------- */
  function renderDirectives() {
    var el = $('dirList');
    if (opsGate(el, 'ข้อสั่งการ')) return;
    if (!S.directives) { el.innerHTML = S.opsErr ? '<div class="empty">โหลดข้อสั่งการไม่สำเร็จ</div>' : SPIN; return; }
    // อย่าวาดทับตอนผู้ใช้กำลังพิมพ์หมายเหตุอยู่ ค่อยวาดตอนออกจากช่อง
    var ae = document.activeElement;
    if (ae && ae.tagName === 'INPUT' && el.contains(ae)) { S.dirPending = true; return; }
    S.dirPending = false;
    var list = S.directives.slice();
    if (S.dirFilter === 'open') list = list.filter(function (d) { return OPEN_D.indexOf(d.status) >= 0; });
    list.sort(dirSort);
    var ctx = { meId: S.me && S.me.id, admin: S.admin };
    el.innerHTML = list.map(function (d) { return NO.dirHtml(d, ctx); }).join('') ||
      '<div class="empty">' + (S.dirFilter === 'open' ? 'ไม่มีข้อสั่งการค้างดำเนินการ' : 'ไม่มีข้อสั่งการใน 7 วันที่ผ่านมา') + '</div>';
  }

  /* ---------- รายงานภาคสนาม ---------- */
  function renderReports() {
    var el = $('repList');
    if (opsGate(el, 'รายงานภาคสนาม')) return;
    if (!S.reports) { el.innerHTML = S.opsErr ? '<div class="empty">โหลดรายงานไม่สำเร็จ</div>' : SPIN; return; }
    var now = Date.now();
    var list = S.reports.filter(function (r) {
      return S.repFilter === 'open' ? r.status === 'open' : (r.status === 'open' || now - Date.parse(r.created_at) <= 72 * 3600e3);
    });
    list.sort(function (a, b) {
      return ((b.status === 'open') - (a.status === 'open')) || (lvOfReport(b) - lvOfReport(a)) || (Date.parse(b.created_at) - Date.parse(a.created_at));
    });
    el.innerHTML = list.map(function (r) { return NO.repHtml(r, { mapLink: true }); }).join('') ||
      '<div class="empty">' + (S.repFilter === 'open' ? 'ไม่มีรายงานที่ยังไม่คลี่คลาย' : 'ไม่มีรายงานใน 72 ชม.') + '</div>';
  }

  /* ---------- เจ้าหน้าที่ปฏิบัติงาน ---------- */
  function renderDuty() {
    var el = $('dutyList');
    $('dutyWhere').textContent = '';
    if (opsGate(el, 'รายชื่อเจ้าหน้าที่')) return;
    if (!S.staff) { el.innerHTML = S.opsErr ? '<div class="empty">โหลดรายชื่อไม่สำเร็จ</div>' : SPIN; return; }
    var on = S.staff.filter(function (p) { return p.on_duty; });
    $('dutyWhere').textContent = on.length ? on.length + ' คน' : '';
    if (!on.length) { el.innerHTML = '<div class="empty">ยังไม่มีเจ้าหน้าที่ลงเวลาปฏิบัติงาน · ลงเวลาได้ที่ <a href="staff.html">หน้าเจ้าหน้าที่</a></div>'; return; }
    var order = ['province'].concat(NO.UNITS.map(function (u) { return u.id; }));
    var groups = {};
    on.forEach(function (p) { var k = order.indexOf(p.unit) >= 0 ? p.unit : '_'; (groups[k] = groups[k] || []).push(p); });
    el.innerHTML = order.concat(['_']).filter(function (k) { return groups[k]; }).map(function (k) {
      return '<div class="dgroup"><h3>' + esc(k === '_' ? 'ไม่ระบุพื้นที่' : NO.unitLabel(k)) + ' (' + groups[k].length + ')</h3>' +
        groups[k].map(function (p) {
          var tel = telHref(p.phone);
          return '<div class="sitem"><div><div class="nm">' + esc(p.display_name) + '</div>' +
            '<div class="ps">' + esc([p.position, p.agency].filter(Boolean).join(' · ')) + '</div>' +
            '<div class="ps">' + (p.duty_since ? 'ปฏิบัติงานมา ' + esc(NO.duration(Date.now() - Date.parse(p.duty_since))) : '') +
              (p.duty_note ? ' · ' + esc(p.duty_note) : '') + '</div></div>' +
            '<div class="tel">' + (tel ? '<a class="wbtn ghost sm" href="' + tel + '" aria-label="โทรหา ' + esc(p.display_name) + '">โทร</a>' : '') + '</div></div>';
        }).join('') + '</div>';
    }).join('');
  }

  function renderUpd() {
    var bits = [];
    if (S.sitAt) bits.push('สถานการณ์ ' + NO.fmtClock(S.sitAt) + ' น.');
    if (S.opsAt && S.member) bits.push('งานเจ้าหน้าที่ ' + NO.fmtClock(S.opsAt) + ' น.');
    bits.push('รีเฟรชอัตโนมัติ');
    $('updAt').textContent = 'อัปเดต ' + bits.join(' · ');
  }

  /* ===================================================================
     5) แผนที่
     =================================================================== */
  var map = null, lay = {}, COL = {};
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function ensureMap() {
    if (map) return map;
    if (typeof L === 'undefined') { $('wrMap').innerHTML = '<div class="empty" style="padding:14px">โหลดแผนที่ไม่สำเร็จ (อาจออฟไลน์อยู่)</div>'; return null; }
    // Leaflet วาด SVG ด้วย attribute ซึ่งอ่าน var(--...) ไม่ได้ จึงแปลงเป็นค่าสีจริงก่อน
    COL = { normal: cssVar('--st-normal'), watch: cssVar('--st-watch'), warn: cssVar('--st-warn'), danger: cssVar('--st-danger'),
      na: cssVar('--ink-3'), signal: cssVar('--signal'), ink: cssVar('--ink') };
    map = L.map('wrMap', { scrollWheelZoom: false, zoomSnap: 0.5 });
    map.fitBounds([[5.76, 101.42], [6.62, 102.12]]);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '&copy; OpenStreetMap' }).addTo(map);
    lay.units = L.layerGroup().addTo(map); lay.st = L.layerGroup().addTo(map); lay.shel = L.layerGroup().addTo(map);
    lay.rep = L.layerGroup().addTo(map); lay.duty = L.layerGroup().addTo(map);
    L.control.layers(null, {
      'พื้นที่ (เทศบาล/อำเภอ)': lay.units, 'สถานีวัดน้ำ': lay.st, 'ศูนย์พักพิงที่เปิด': lay.shel,
      'รายงานภาคสนาม': lay.rep, 'เจ้าหน้าที่ (แชร์ตำแหน่ง)': lay.duty
    }, { collapsed: true }).addTo(map);
    NO.loadDistricts().then(function (ds) {
      if (!ds.length) return;
      L.geoJSON({ type: 'FeatureCollection', features: ds }, { style: { color: cssVar('--line-strong') || '#7d86a0', weight: 1, opacity: 0.7, fill: false }, interactive: false }).addTo(map);
    });
    return map;
  }
  function renderMap(units) {
    if (!S.sitAt || !ensureMap()) return;
    Object.keys(lay).forEach(function (k) { lay[k].clearLayers(); });
    units.forEach(function (x) {
      var k = lvKey(x);
      // บนแผนที่ใช้ชื่อสั้นไม่มีคำนำหน้า (ทม./ทต./อ.) 13 ป้ายในจังหวัดเล็ก ๆ จะได้ไม่ทับกันมาก
      var icon = L.divIcon({ className: 'mlab-wrap', iconSize: null,
        html: '<span class="mlab" data-lv="' + k + '">' + esc(x.u.short.replace(/^(ทม|ทต|อ)\./, '')) + '</span>' });
      L.marker([x.u.lat, x.u.lon], { icon: icon, keyboard: false, zIndexOffset: 1000 + x.lv * 100 })
        .bindPopup('<b>' + esc(x.u.name) + '</b><br>สถานะ: ' + esc(lvLabel(x)) +
          (x.reasons.length ? '<br><small>' + x.reasons.slice(0, 3).map(function (r) { return esc(r.t); }).join('<br>') + '</small>' : ''))
        .addTo(lay.units);
    });
    (S.allSt || []).forEach(function (s) {
      if (s.lat == null || s.lon == null) return;
      var k = !s.fresh ? 'na' : s.rank === 3 ? 'danger' : s.rank === 2 ? 'warn' : s.rank === 1 ? 'watch' : 'normal';
      L.circleMarker([s.lat, s.lon], { radius: s.fresh ? 6 : 4, color: '#fff', weight: 1.5, fillColor: COL[k], fillOpacity: s.fresh ? 0.95 : 0.5 })
        .bindTooltip(esc((s.code ? s.code + ' ' : '') + s.name) + '<br>' + esc(stValue(s)) + ' · ' + esc(srcLabel(s)) + (s.dt ? '<br>' + esc(NO.ago(s.dt)) : ''))
        .addTo(lay.st);
    });
    (S.shelters || []).forEach(function (s) {
      if (s.lat == null || s.lon == null || !(s.status === 'open' || s.status === 'full')) return;
      L.circleMarker([s.lat, s.lon], { radius: 7, color: COL.signal, weight: 2, fillColor: '#fff', fillOpacity: 1 })
        .bindTooltip('ศูนย์พักพิง: ' + esc(s.name) + '<br>' + (s.status === 'full' ? 'เต็ม' : 'เปิด') + ' · ' + fmt0(s.occupancy) + ' คน')
        .addTo(lay.shel);
    });
    if (S.member) {
      (S.reports || []).forEach(function (r) {
        if (r.lat == null || r.lon == null || r.status !== 'open') return;
        var k = NO.LEVEL_BY_K[r.severity] ? r.severity : 'watch';
        var tri = L.divIcon({ className: 'mlab-wrap', iconSize: [18, 16], iconAnchor: [9, 12],
          html: '<svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true"><path d="M9 1 17 15H1z" fill="' + COL[k] + '" stroke="#fff" stroke-width="1.5"/></svg>' });
        L.marker([r.lat, r.lon], { icon: tri })
          .bindPopup('<b>' + esc(NO.KINDS[r.kind] || r.kind) + '</b> · ' + esc(NO.LEVEL_BY_K[k].label) + '<br>' + esc(r.place || '') +
            '<br><small>' + esc(NO.ago(r.created_at)) + ' · ' + esc(r.reporter_name || '') + '</small>')
          .addTo(lay.rep);
      });
      (S.staff || []).forEach(function (p) {
        if (!p.on_duty || p.lat == null || p.lon == null || !p.loc_at || Date.now() - Date.parse(p.loc_at) > 12 * 3600e3) return;
        L.circleMarker([p.lat, p.lon], { radius: 5, color: '#fff', weight: 1.5, fillColor: COL.ink, fillOpacity: 0.9 })
          .bindTooltip('เจ้าหน้าที่: ' + esc(p.display_name) + (p.position ? '<br>' + esc(p.position) : '') + '<br>ตำแหน่งเมื่อ ' + esc(NO.ago(p.loc_at)))
          .addTo(lay.duty);
      });
    }
  }
  function focusMap(lat, lon, z) {
    if (!ensureMap()) return;
    $('mapCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () { map.invalidateSize(); map.setView([lat, lon], z || 12); }, 350);
  }

  /* ===================================================================
     6) รายงานสรุปผู้บริหาร
     =================================================================== */
  function buildSitrep() {
    var now = new Date(), units = S.units, lines = [];
    var d = now.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'long', year: 'numeric' });
    var t = now.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
    var has = units.some(function (x) { return x.hasData; });
    var cnt = [0, 0, 0, 0]; units.forEach(function (x) { cnt[x.lv]++; });
    var maxLv = has ? Math.max.apply(null, units.map(function (x) { return x.lv; })) : null;
    var watchU = units.filter(function (x) { return x.lv > 0; });

    lines.push('รายงานสถานการณ์อุทกภัยรายพื้นที่ (War Room เทศบาล) จังหวัดนราธิวาส');
    lines.push('ข้อมูล ณ วันที่ ' + d + ' เวลา ' + t + ' น.');
    lines.push('');
    lines.push('1. ภาพรวม');
    if (maxLv == null) lines.push('   - ไม่สามารถประเมินได้ เนื่องจากโหลดข้อมูลสถานการณ์ไม่สำเร็จ');
    else {
      lines.push('   - สถานะสูงสุด: ' + NO.LEVELS[maxLv].label);
      lines.push('   - พื้นที่ต้องติดตาม ' + watchU.length + ' จาก ' + units.length + ' พื้นที่ (วิกฤต ' + cnt[3] + ' · เตรียมรับมือ ' + cnt[2] + ' · เฝ้าระวัง ' + cnt[1] + ')');
    }
    lines.push('');
    lines.push('2. พื้นที่ที่ต้องติดตามใกล้ชิด');
    if (!watchU.length) lines.push('   - ไม่มี (ทุกพื้นที่อยู่ในระดับปกติ)');
    watchU.forEach(function (x, i) {
      lines.push('   2.' + (i + 1) + ' ' + x.u.short + (x.u.kind === 'amphoe' ? '' : ' (อ.' + x.u.amphoe + ')') + ' — ' + NO.LEVELS[x.lv].label);
      x.reasons.slice(0, 3).forEach(function (r) { lines.push('        • ' + r.t); });
      var bits = [];
      if (x.key) bits.push('ระดับน้ำ ' + stValue(x.key) + ' (' + (x.key.code || x.key.name) + ')');
      if (x.m) bits.push('ฝน 24 ชม. ' + fmt0(x.m.rain24) + ' มม.');
      if (x.shOpen.length) bits.push('ศูนย์พักพิงเปิด ' + x.shOpen.length + ' แห่ง (' + fmt0(x.occ) + ' คน)');
      if (S.member && (x.hh || x.ppl)) bits.push('ผลกระทบ ' + fmt0(x.hh) + ' ครัวเรือน ' + fmt0(x.ppl) + ' คน');
      if (bits.length) lines.push('        • ' + bits.join(' · '));
    });
    lines.push('');
    var fr = (S.allSt || []).filter(function (s) { return s.fresh; });
    var crit = fr.filter(function (s) { return s.rank >= 2; }).sort(byRank);
    lines.push('3. สถานการณ์น้ำ');
    lines.push('   - สถานีที่รายงานใน 6 ชม. ' + fr.length + ' สถานี · ระดับวิกฤต (ล้นตลิ่ง/ปภ. ประกาศอพยพ) ' + fr.filter(function (s) { return s.rank === 3; }).length +
      ' · เตรียมรับมือ (ใกล้ตลิ่ง/ถึงระดับเตือน) ' + fr.filter(function (s) { return s.rank === 2; }).length);
    crit.slice(0, 8).forEach(function (s) {
      lines.push('   - ' + (s.code ? s.code + ' ' : '') + s.name + ' (อ.' + s.amphoe + ') ' + stValue(s) +
        (s.src === 'ddpm' && s.lvLabel ? ' · ปภ. ระดับ "' + s.lvLabel + '"' : '') +
        (trendOf(s) === 1 ? ' แนวโน้มเพิ่มขึ้น' : trendOf(s) === -1 ? ' แนวโน้มลดลง' : ''));
    });
    lines.push('');
    lines.push('4. สถานการณ์ฝน (พยากรณ์)');
    if (S.meteo) {
      var rs = units.filter(function (x) { return x.m; }).sort(function (a, b) { return (b.m.rain24 || 0) - (a.m.rain24 || 0); });
      if (rs[0]) lines.push('   - ฝน 24 ชม. ข้างหน้าสูงสุด ' + fmt0(rs[0].m.rain24) + ' มม. (' + rs[0].u.short + ')');
      var hi = units.filter(function (x) { return x.risk && x.risk.lv >= 1; });
      lines.push('   - ความเสี่ยงจากฝน 7 วัน (เกณฑ์กรมอุตุฯ): ' + (hi.length
        ? hi.map(function (x) { return x.u.short + ' ' + x.risk.label; }).join(', ')
        : 'ไม่มีพื้นที่ถึงเกณฑ์ฝนหนัก'));
    } else lines.push('   - ไม่มีข้อมูลพยากรณ์');
    lines.push('');
    lines.push('5. การช่วยเหลือผู้ประสบภัย');
    if (S.shelters) {
      var op = S.shelters.filter(function (s) { return s.status === 'open' || s.status === 'full'; });
      lines.push('   - ศูนย์พักพิงเปิด ' + op.length + ' แห่ง ผู้พักพิง ' + fmt0(op.reduce(function (x, s) { return x + (s.occupancy || 0); }, 0)) + ' คน');
    }
    if (S.roads) lines.push('   - ถนนน้ำท่วม/ชำรุดที่ยังรายงานอยู่ ' + S.roads.length + ' จุด');
    if (S.member && S.reports) {
      var ro = S.reports.filter(function (r) { return r.status === 'open'; });
      lines.push('   - รายงานภาคสนามที่ยังไม่คลี่คลาย ' + ro.length + ' เรื่อง (วิกฤต ' + ro.filter(function (r) { return r.severity === 'danger'; }).length + ')' +
        ' · ได้รับผลกระทบ ' + fmt0(ro.reduce(function (x, r) { return x + (r.households || 0); }, 0)) + ' ครัวเรือน ' +
        fmt0(ro.reduce(function (x, r) { return x + (r.people || 0); }, 0)) + ' คน');
      var need = {};
      ro.forEach(function (r) { (r.needs || []).forEach(function (n) { need[n] = (need[n] || 0) + 1; }); });
      var nk = Object.keys(need).sort(function (a, b) { return need[b] - need[a]; });
      if (nk.length) lines.push('   - ความต้องการจากพื้นที่: ' + nk.map(function (n) { return (NO.NEEDS[n] || n) + ' (' + need[n] + ')'; }).join(', '));
    }
    lines.push('');
    if (S.member && S.directives) {
      var pend = S.directives.filter(function (d) { return OPEN_D.indexOf(d.status) >= 0; }).sort(dirSort);
      var late = pend.filter(function (d) { return d.due_at && Date.parse(d.due_at) < Date.now(); });
      lines.push('6. ข้อสั่งการและการติดตาม');
      lines.push('   - ค้างดำเนินการ ' + pend.length + ' เรื่อง (เกินกำหนด ' + late.length + ')');
      pend.slice(0, 10).forEach(function (d) {
        lines.push('   - [' + ((NO.PRIORITY[d.priority] || {}).l || '') + '] ' + d.title + ' — ' + NO.unitLabel(d.unit) + ' — ' +
          ((NO.DSTATUS[d.status] || {}).l || d.status) + (d.due_at ? ' (กำหนด ' + NO.fmtTime(d.due_at) + ')' : ''));
      });
      lines.push('');
    }
    if (S.member && S.staff) {
      var on = S.staff.filter(function (p) { return p.on_duty; });
      var ar = {}; on.forEach(function (p) { ar[p.unit || '-'] = 1; });
      lines.push((S.directives ? '7' : '6') + '. กำลังพล');
      lines.push('   - เจ้าหน้าที่ปฏิบัติงาน ' + on.length + ' คน ใน ' + Object.keys(ar).length + ' พื้นที่');
      lines.push('');
    }
    lines.push('ที่มาข้อมูล: สสน. (thaiwater) · ปภ. · กรมชลประทาน · Open-Meteo' + (S.member ? ' · รายงานเจ้าหน้าที่ในระบบ' : ''));
    lines.push('จัดทำโดยระบบ War Room เทศบาล naraflood.com · โปรดตรวจสอบก่อนนำเสนอ');
    return lines.join('\n');
  }

  /* ===================================================================
     7) การกระทำของผู้ใช้
     =================================================================== */
  function toggleUnit(id) {
    if (S.open.has(id)) S.open.delete(id); else S.open.add(id);
    renderBoard(S.units);
  }

  $('board').addEventListener('click', function (e) {
    var act = e.target.closest('[data-act]');
    if (act) {
      e.stopPropagation();
      var u = NO.unitById(act.dataset.u);
      if (act.dataset.act === 'map' && u) focusMap(u.lat, u.lon, 12);
      if (act.dataset.act === 'order' && u) openDirForm(u.id);
      return;
    }
    if (e.target.closest('a,button,[data-login]')) return;
    var row = e.target.closest('.brow');
    if (row) toggleUnit(row.dataset.u);
  });
  $('board').addEventListener('keydown', function (e) {
    var row = e.target.closest && e.target.closest('.brow');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleUnit(row.dataset.u); }
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-login]');
    if (b && typeof signInWithGoogle === 'function') signInWithGoogle(location.href);
    var m = e.target.closest('[data-act="maprep"]');
    if (m) { e.preventDefault(); focusMap(+m.dataset.lat, +m.dataset.lon, 14); }
  });

  function segBind(id, key, render) {
    $(id).addEventListener('click', function (e) {
      var b = e.target.closest('button[data-f]'); if (!b) return;
      S[key] = b.dataset.f;
      $(id).querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      render();
    });
  }
  segBind('dirSeg', 'dirFilter', renderDirectives);
  segBind('repSeg', 'repFilter', renderReports);

  /* ---------- ฟอร์มข้อสั่งการ ---------- */
  function openDirForm(unit) {
    if (!S.member) return;
    $('dUnit').innerHTML = NO.unitOptions(unit || 'all', true, true);
    if (!$('dBy').value) $('dBy').value = myName();
    $('dirForm').classList.remove('hide');
    $('dirCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function () { $('dTitle').focus({ preventScroll: true }); }, 400);
  }
  $('btnDirNew').addEventListener('click', function () {
    if ($('dirForm').classList.contains('hide')) openDirForm('all'); else $('dirForm').classList.add('hide');
  });
  $('btnDirCancel').addEventListener('click', function () { $('dirForm').classList.add('hide'); });
  $('dirForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!S.member || !SB) return;
    var title = $('dTitle').value.trim();
    if (!title) { $('dTitle').focus(); return; }
    var btn = $('btnDirSave'); btn.disabled = true;
    getUser().then(function (user) {
      if (!user) throw new Error('กรุณาเข้าสู่ระบบใหม่');
      var due = $('dDue').value;
      return SB.from('directives').insert({
        unit: $('dUnit').value, priority: $('dPrio').value, title: title,
        detail: $('dDetail').value.trim() || null, assignee: $('dAssignee').value.trim() || null,
        due_at: due ? new Date(due).toISOString() : null,
        ordered_by_name: $('dBy').value.trim() || null, created_by: user.id
      });
    }).then(function (r) {
      if (r && r.error) throw r.error;
      ['dTitle', 'dDetail', 'dAssignee', 'dDue'].forEach(function (id) { $(id).value = ''; });
      $('dPrio').value = 'normal';
      $('dirForm').classList.add('hide');
      S.dirFilter = 'open';
      $('dirSeg').querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.f === 'open' ? 'true' : 'false'); });
      return loadOps();
    }).catch(function (err) {
      alert('บันทึกข้อสั่งการไม่สำเร็จ: ' + (err && err.message || err));
    }).then(function () { btn.disabled = false; });
  });

  $('dirList').addEventListener('click', function (e) {
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
    }).catch(function (err) {
      alert('อัปเดตสถานะไม่สำเร็จ: ' + (err && err.message || err));
      item.querySelectorAll('button').forEach(function (x) { x.disabled = false; });
    });
  });
  $('dirList').addEventListener('focusout', function () {
    setTimeout(function () { if (S.dirPending) renderDirectives(); }, 0);
  });

  $('repList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-rs]'); if (!b || !SB) return;
    var item = b.closest('.ritem');
    b.disabled = true;
    SB.from('field_reports').update({ status: b.dataset.rs }).eq('id', item.dataset.id).then(function (r) {
      if (r.error) throw r.error;
      return loadOps();
    }).catch(function (err) { alert('อัปเดตไม่สำเร็จ: ' + (err && err.message || err)); b.disabled = false; });
  });

  /* ---------- รายงานสรุป ---------- */
  $('btnSitrep').addEventListener('click', function () {
    $('sitrepCard').classList.remove('hide');
    $('sitrepText').value = buildSitrep();
    $('sitrepCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('btnCopy').addEventListener('click', function () {
    var t = $('sitrepText'), b = $('btnCopy');
    var done = function () { b.textContent = 'คัดลอกแล้ว'; setTimeout(function () { b.textContent = 'คัดลอก'; }, 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(t.value).then(done, function () { t.select(); document.execCommand('copy'); done(); });
    else { t.select(); document.execCommand('copy'); done(); }
  });
  $('btnShare').addEventListener('click', function () {
    var text = $('sitrepText').value;
    if (navigator.share) { navigator.share({ title: 'รายงานสถานการณ์ War Room เทศบาล', text: text }).catch(function () {}); return; }
    window.open('https://line.me/R/share?text=' + encodeURIComponent(text), '_blank', 'noopener');
  });

  /* ---------- จอใหญ่ ---------- */
  function setTv(on) {
    document.body.classList.toggle('tv', on);
    $('btnTv').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('btnTv').querySelector('span').textContent = on ? 'ออกจากจอใหญ่' : 'จอใหญ่';
    if (map) setTimeout(function () { map.invalidateSize(); }, 300);
  }
  $('btnTv').addEventListener('click', function () {
    var on = !document.body.classList.contains('tv');
    setTv(on);
    var de = document.documentElement;
    if (on && de.requestFullscreen) de.requestFullscreen().catch(function () {});
    else if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
  });
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && document.body.classList.contains('tv')) setTv(false);
  });

  $('wrRefresh').addEventListener('click', function () { loadSituation(); if (S.member) loadOps(); });

  /* ---------- นาฬิกา ---------- */
  function tick() {
    var d = new Date();
    $('clock').textContent = d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    $('clockDate').textContent = d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  /* ===================================================================
     8) สิทธิ์ผู้ใช้ + เริ่มทำงาน
     =================================================================== */
  function setAuth(state, profile) {
    var wasMember = S.member;
    S.state = state; S.me = profile || null;
    S.member = state === 'approved' || state === 'admin';
    S.admin = state === 'admin';
    $('btnDirNew').classList.toggle('hide', !S.member);
    // ตัวกรองไม่มีความหมายตอนส่วนนั้นล็อกอยู่
    $('dirSeg').classList.toggle('hide', !S.member);
    $('repSeg').classList.toggle('hide', !S.member);
    if (!S.member) { S.staff = S.reports = S.directives = null; S.opsErr = null; $('dirForm').classList.add('hide'); }
    if (S.member && !wasMember) loadOps();
    else renderAll();
  }
  if (SB && typeof watchAuthState === 'function') {
    try {
      watchAuthState({
        onSignedOut: function () { setAuth('signedout', null); },
        onPending: function (p) { setAuth('pending', p); },
        onRejected: function (p) { setAuth('rejected', p); },
        onApproved: function (p) { setAuth('approved', p); },
        onAdmin: function (p) { setAuth('admin', p); }
      });
    } catch (e) { S.state = 'offline'; }
  } else S.state = 'offline';

  var qs = new URLSearchParams(location.search);
  if (qs.get('tv') === '1') setTv(true);
  if (qs.get('u') && NO.unitById(qs.get('u'))) S.open.add(qs.get('u'));

  tick(); setInterval(tick, 1000);
  renderAll();
  loadSituation();
  setInterval(function () { if (document.visibilityState === 'visible') loadSituation(); }, SIT_EVERY);
  setInterval(function () { if (document.visibilityState === 'visible' && S.member) loadOps(); }, OPS_EVERY);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (S.sitAt && Date.now() - S.sitAt > SIT_EVERY) loadSituation();
    if (S.member && S.opsAt && Date.now() - S.opsAt > OPS_EVERY) loadOps();
  });
})();
