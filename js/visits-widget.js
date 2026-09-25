/* js/visits-widget.js · การ์ด "ผู้เข้าชมเว็บไซต์" บนหน้าแรก
 * ต้องการ: <div class="card full" id="visitCard"></div> ในหน้า
 *          และโหลดหลัง js/supabase-client.js กับ js/views.js
 *
 * ตัวเลขมาจาก RPC สองตัวใน supabase/schema-v10.sql
 *   get_visit_summary()   — วันนี้ / 7 วัน / 30 วัน / ทั้งหมด + ช่วงก่อนหน้าไว้เทียบ
 *   get_visit_daily(30)   — อนุกรมรายวันสำหรับกราฟแท่ง
 *
 * ถ้ายังไม่ได้รัน schema-v10.sql หรือออฟไลน์ → ซ่อนการ์ดทั้งใบไปเงียบ ๆ
 * การ์ดว่างที่เขียนว่า "โหลดไม่ได้" ไม่ได้ช่วยใครในวันที่น้ำกำลังมา
 */
(function () {
  'use strict';

  var card = document.getElementById('visitCard');
  if (!card || typeof sb === 'undefined' || !sb) return;

  var fmt = function (n) {
    try { return Number(n || 0).toLocaleString('th-TH'); } catch (e) { return String(n || 0); }
  };

  /* วันที่แบบสั้นภาษาไทย ใช้บน tooltip ของแท่งกราฟ */
  function dayLabel(iso) {
    try {
      return new Date(iso + 'T00:00:00+07:00')
        .toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
    } catch (e) { return iso; }
  }

  /* เทียบกับช่วงก่อนหน้าที่ยาวเท่ากัน
     ฐานเป็น 0 แล้วมีคนเข้า = "เริ่มมีคนเข้า" ไม่ใช่ +∞% จึงไม่แสดงตัวเลข */
  function delta(now, prev) {
    if (!prev) return null;
    return Math.round(((now - prev) / prev) * 100);
  }

  function deltaHtml(d) {
    if (d === null || d === 0) return '';
    var up = d > 0;
    return '<span class="vc-delta ' + (up ? 'up' : 'down') + '">' +
           (up ? '▲' : '▼') + ' ' + Math.abs(d) + '%</span>';
  }

  var css = document.createElement('style');
  css.textContent =
    /* ตัวเลขคือเนื้อหาหลักของการ์ด จึงให้พื้นที่มันมากกว่าหัวข้อ */
    '#visitCard .vc-row{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s2);margin-bottom:var(--s3)}' +
    '#visitCard .vc-tile{background:var(--card-2);border:1px solid var(--line);' +
      'border-radius:var(--r-control);padding:10px 12px;min-width:0}' +
    '#visitCard .vc-k{font-size:11.5px;color:var(--ink-3);line-height:1.35;' +
      'display:flex;align-items:center;gap:6px;flex-wrap:wrap}' +
    '#visitCard .vc-v{font-size:24px;font-weight:600;line-height:var(--lh-tight);color:var(--ink);' +
      'margin-top:2px;display:flex;align-items:baseline;gap:5px}' +
    '#visitCard .vc-v small{font-size:12px;font-weight:400;color:var(--ink-3)}' +
    '#visitCard .vc-sub{font-size:11.5px;color:var(--ink-3);line-height:1.4;margin-top:2px}' +
    '#visitCard .vc-delta{font-size:11px;font-weight:600}' +
    '#visitCard .vc-delta.up{color:var(--signal)}' +
    '#visitCard .vc-delta.down{color:var(--ink-3)}' +
    /* กราฟแท่ง 30 วัน: แท่งบางแต่ยังกดโดนได้ และมีพื้นจาง ๆ บอกวันที่ไม่มีคนเข้า */
    '#visitCard .vc-chart{display:flex;align-items:flex-end;gap:2px;height:64px;' +
      'padding:0 1px;border-bottom:1px solid var(--line)}' +
    '#visitCard .vc-bar{flex:1 1 0;min-width:0;background:var(--signal-wash);' +
      'border-radius:2px 2px 0 0;position:relative;height:100%;display:flex;align-items:flex-end}' +
    '#visitCard .vc-bar i{display:block;width:100%;background:var(--signal);' +
      'border-radius:2px 2px 0 0;min-height:2px}' +
    /* วันนี้เข้มกว่าวันอื่นหนึ่งขั้น ไม่ใช้เหลืองของตรา ปภ.
       เหลืองในระบบนี้แปลว่า "เฝ้าระวัง" เอามาแปะบนตัวเลขผู้เข้าชมไม่ได้ */
    '#visitCard .vc-bar.today i{background:var(--signal-deep)}' +
    '#visitCard .vc-axis{display:flex;justify-content:space-between;' +
      'font-size:10.5px;color:var(--ink-3);margin-top:4px}' +
    '@media(max-width:520px){' +
      '#visitCard .vc-row{grid-template-columns:1fr;gap:6px}' +
      '#visitCard .vc-tile{display:flex;align-items:baseline;justify-content:space-between;gap:10px}' +
      '#visitCard .vc-v{font-size:20px;margin-top:0}}';
  document.head.appendChild(css);

  function tile(label, visitors, views, d) {
    return '<div class="vc-tile">' +
      '<div class="vc-k">' + label + deltaHtml(d) + '</div>' +
      '<div class="vc-v">' + fmt(visitors) + '<small>คน</small></div>' +
      '<div class="vc-sub">เปิดหน้า ' + fmt(views) + ' ครั้ง</div>' +
      '</div>';
  }

  function chart(rows) {
    var max = rows.reduce(function (m, r) { return Math.max(m, r.visitors || 0); }, 0);
    var bars = rows.map(function (r, i) {
      var v = r.visitors || 0;
      var h = max ? Math.round((v / max) * 100) : 0;
      var last = i === rows.length - 1;
      return '<div class="vc-bar' + (last ? ' today' : '') + '" title="' +
             dayLabel(r.day) + ' · ' + fmt(v) + ' คน · ' + fmt(r.views) + ' ครั้ง">' +
             '<i style="height:' + (v ? Math.max(h, 3) : 0) + '%"></i></div>';
    }).join('');
    return '<div class="vc-chart" role="img" aria-label="กราฟผู้เข้าชมรายวัน 30 วันล่าสุด">' + bars + '</div>' +
           '<div class="vc-axis"><span>' + dayLabel(rows[0].day) + '</span>' +
           '<span>สูงสุด ' + fmt(max) + ' คน/วัน</span>' +
           '<span>วันนี้</span></div>';
  }

  async function load() {
    var out = await Promise.all([
      sb.rpc('get_visit_summary'),
      sb.rpc('get_visit_daily', { p_days: 30 })
    ]);
    var s = out[0], d = out[1];
    if (s.error || d.error) return;                    // ยังไม่ได้รัน v10 → ซ่อนการ์ด

    var m = Array.isArray(s.data) ? s.data[0] : s.data;
    var rows = d.data || [];
    if (!m || !rows.length) return;

    card.innerHTML =
      '<h2>ผู้เข้าชมเว็บไซต์ <span class="where">อัปเดตอัตโนมัติ</span></h2>' +
      '<div class="vc-row">' +
        tile('วันนี้', m.visitors_today, m.views_today, null) +
        tile('7 วันล่าสุด', m.visitors_7, m.views_7, delta(m.visitors_7, m.visitors_prev7)) +
        tile('30 วันล่าสุด', m.visitors_30, m.views_30, delta(m.visitors_30, m.visitors_prev30)) +
      '</div>' +
      chart(rows) +
      /* คำอธิบายพับไว้เหมือนการ์ดอื่นในหน้าแรก (ดู .fold-note ใน shared.css)
         การ์ดนี้ถูกสร้างด้วย JS ทีหลัง จึงต้องเขียนโครง details เองตรงนี้ */
      '<details class="fold fold-note"><summary>คำอธิบาย</summary>' +
      '<div class="note">นับผู้เข้าชมจากเบราว์เซอร์ 1 เครื่องต่อ 1 วัน · ' +
        'สะสมทั้งหมด ' + fmt(m.visitors_total) + ' คน ' + fmt(m.views_total) + ' ครั้ง' +
        (m.first_day ? ' ตั้งแต่ ' + dayLabel(m.first_day) : '') + ' · ' +
        'ไม่เก็บคุกกี้ ไม่เก็บหมายเลขไอพี และไม่ระบุตัวบุคคล</div></details>';
    card.hidden = false;
  }

  /* รอให้ views.js นับครั้งนี้เสร็จก่อน ตัวเลข "วันนี้" จะได้รวมคนที่กำลังดูอยู่ด้วย
     ถ้าสัญญาณไม่มา (views.js ไม่ได้โหลด) ก็ยังโหลดเองหลัง 1.5 วินาที */
  var started = false;
  function start() {
    if (started) return;
    started = true;
    load().catch(function () {});
  }
  document.addEventListener('naraflood:counted', start);
  setTimeout(start, 1500);
})();
