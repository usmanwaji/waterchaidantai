/* js/ffr-import.js — แปลงตารางคาดการณ์หมู่บ้านเสี่ยงภัยน้ำหลากดินถล่ม (Excel / PDF) เป็นแถว FFR สำหรับ ffr-upload.html
 * ใช้ตัวอ่านตารางและตัวเทียบชื่ออำเภอ/ตำบลของ js/survey-import.js (โหลดก่อนไฟล์นี้)
 * ใช้ได้ทั้งในเบราว์เซอร์ (window.FfrImport) และ node (require) เพื่อทดสอบ
 *
 * แถวที่ได้ = [อำเภอ, ตำบล, บ้าน, ค่า FFR, ระดับ] รูปแบบเดียวกับ js/ffr_risk_data.js
 *   • อำเภอ/ตำบล สะกดตามขอบเขตตำบล js/onwr-nara-subdistricts.geojson เพื่อให้ forecast.html ระบายสีตำบลได้
 *     ชื่อที่หาไม่เจอยังนำเข้า (ขึ้นในรายชื่อ แต่ไม่ระบายสีบนแผนที่) และแจ้งเตือนในตัวอย่าง
 *   • ระดับ: จากคอลัมน์ระดับความเสี่ยง (สูง/ปานกลาง/ต่ำ · แดง/ส้ม/เหลือง) · ไม่มีหรืออ่านไม่ออก ใช้ค่า FFR (≥ FFR_HIGH = สูง)
 *   • มีคอลัมน์จังหวัด: เก็บเฉพาะนราธิวาส · อำเภอ/ตำบลที่ผสานเซลล์ (ว่างในแถวถัดไป) ใช้ค่าของแถวก่อนหน้า
 */
(function (root) {
'use strict';
const SI = root.SurveyImport || require('./survey-import.js');
const { fixThai, key } = SI;
const blank = s => { s = fixThai(s); return s === '' || /^[-–—]+$/.test(s); };

// ไม่มีคอลัมน์ระดับ: ค่า FFR ตั้งแต่เท่านี้ = เสี่ยงสูง (ชุด 11 ต.ค. 69: เสี่ยงสูง 0.41–0.76 · เสี่ยงต่ำ 0.06–0.17)
const FFR_HIGH = 0.3;

/* ---------- หัวตาราง (เทียบด้วย key(): ไม่มีวรรณยุกต์/ช่องว่าง และ ำ → า) ----------
 * ลำดับสำคัญ: ค่า FFR ก่อนระดับ ("ค่าความเสี่ยง" กับ "ระดับความเสี่ยง") · ตำบลก่อนอำเภอ (subdistrict มีคำว่า district)
 * หมู่บ้านก่อนหมู่ที่ และก่อนระดับ ("หมู่บ้านเสี่ยง") */
const COLS = [
  ['n',   /^(ที|no)$|^ลาดับ/i],
  ['ffr', /ffr|ดัชนีความเสียง|คาความเสียง|คาเสียง/i],
  ['tam', /ตาบล|ตบล|tambon|subdistrict/i],
  ['amp', /อาเภอ|อเภอ|^เภอ|amphoe|district/i],
  ['pv',  /จังหวัด|จงหวด|province/i],
  ['ban', /หมูบาน|บาน|ชุมชน|village/i],
  ['mu',  /^หมู(ที)?$|^ม$|^moo$/i],
  ['lv',  /ระดับ|ความเสียง|สถานะ|^สี$|level|risk/i],
];
const isNum = c => typeof c === 'number' || /^\s*-?\d+(\.\d+)?\s*%?\s*$/.test(fixThai(c));
function fieldOf(cell) {
  const k = key(cell);
  if (!k) return null;
  const hit = COLS.find(([, re]) => re.test(k));
  return hit ? hit[0] : null;
}
function headerScore(cells) {
  return new Set(cells.map(fieldOf).filter(Boolean)).size;
}
function mapColumns(hdr) {
  const map = {};
  hdr.forEach((h, i) => { const f = fieldOf(h); if (f) (map[f] = map[f] || []).push(i); });
  // หลายคอลัมน์ FFR (เช่น 6 ชม. / 36 ชม.): ใช้คอลัมน์ 36 ชม. ถ้ามี ไม่งั้นคอลัมน์สุดท้าย
  if (map.ffr && map.ffr.length > 1) map.ffr = [map.ffr.find(i => /36/.test(hdr[i])) ?? map.ffr[map.ffr.length - 1]];
  return map;
}
// ตาราง 2 มิติ → {hdr, rows, above} · above = ข้อความเหนือหัวตาราง (ไว้เดาช่วงเวลาคาดการณ์)
function splitHeader(table) {
  let best = -1, bestScore = 2;
  table.slice(0, 30).forEach((r, i) => {
    const s = headerScore(r), m = mapColumns(r.map(fixThai));
    if (s > bestScore && m.ban && (m.ffr || m.lv)) { bestScore = s; best = i; }
  });
  if (best < 0) throw new Error('ไม่พบแถวหัวตาราง (ต้องมีหัวคอลัมน์ เช่น อำเภอ ตำบล หมู่บ้าน ค่า FFR ระดับความเสี่ยง)');
  const width = Math.max(...table.map(r => r.length));
  const top = Array.from({length: width}, (_, i) => fixThai(table[best][i]));
  const hdr = top.slice();
  let j = best + 1;
  // หัวตาราง 2 แถว (เช่น "ค่า FFR" ผสานเซลล์คลุม 2 คอลัมน์ แล้วแยก 6 ชม. / 36 ชม. แถวล่าง): ไม่มีตัวเลข และมีข้อความอย่างน้อย 2 ช่อง
  // ช่องบนที่ว่าง = ส่วนหนึ่งของเซลล์ผสานทางซ้าย จึงใช้ชื่อหัวบนทางซ้ายนำหน้า
  while (j < table.length && j <= best + 2 && !table[j].some(isNum) && table[j].filter(c => !blank(c)).length >= 2) {
    table[j].forEach((c, i) => {
      if (blank(c)) return;
      let base = hdr[i];
      if (!top[i]) { for (let k = i - 1; k >= 0; k--) if (top[k]) { base = top[k]; break; } }
      hdr[i] = (base ? base + ' ' : '') + fixThai(c);
    });
    j++;
  }
  const above = table.slice(0, best).map(r => r.filter(c => !blank(c)).map(fixThai).join(' ')).filter(Boolean);
  return { hdr, rows: table.slice(j), above };
}

/* ---------- ค่า ---------- */
function ffrValue(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = fixThai(v).replace(/,/g, '.');
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  return /%/.test(s) ? +m[0] / 100 : +m[0];
}
function level(v) {
  const s = fixThai(v).toLowerCase();
  if (!s) return null;
  if (/สูง|แดง|อพยพ|วิกฤ|high|red/.test(s)) return 'high';
  if (/ปานกลาง|กลาง|ส้ม|เตือนภัย|medium|moderate|mid|orange/.test(s)) return 'mid';
  if (/ต่?ำ|เหลือง|น้อย|เฝ้าระวัง|low|yellow/.test(s)) return 'low';
  return null;
}
const THAI_MONTH = /(\d{1,2})\s*(ม\.?ค\.?|ก\.?พ\.?|มี\.?ค\.?|เม\.?ย\.?|พ\.?ค\.?|มิ\.?ย\.?|ก\.?ค\.?|ส\.?ค\.?|ก\.?ย\.?|ต\.?ค\.?|พ\.?ย\.?|ธ\.?ค\.?|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*\d{2,4}/;
// ช่วงเวลาคาดการณ์จากข้อความหัวเอกสาร: บรรทัดแรกที่มีวันที่ (ชอบบรรทัดที่มี 2 วันที่ = ช่วง) ตัดตั้งแต่วันที่แรก
function guessPeriod(lines) {
  const ls = (lines || []).map(fixThai).filter(l => THAI_MONTH.test(l));
  const two = ls.find(l => (l.match(new RegExp(THAI_MONTH.source, 'g')) || []).length >= 2);
  const l = two || ls[0];
  if (!l) return '';
  return l.slice(l.search(THAI_MONTH)).slice(0, 150).trim();
}

/* ---------- ตาราง → แถว FFR ----------
 * geo = SurveyImport.buildGeo(villages, subdistricts, districts) */
function toRows(table, geo) {
  const { hdr, rows, above } = splitHeader(table);
  const cm = mapColumns(hdr);
  if (!cm.ffr) throw new Error('ไม่พบคอลัมน์ค่า FFR (หัวคอลัมน์ต้องมีคำว่า FFR หรือ ค่าความเสี่ยง)');
  if (!cm.tam) throw new Error('ไม่พบคอลัมน์ตำบล');
  const get = (r, f) => { const ix = cm[f]; if (!ix) return ''; const v = ix.map(i => r[i]).find(v => !blank(v)); return v == null ? '' : v; };
  const out = [], warn = [], unmatched = new Map(), lossy = [];
  let otherPv = 0, inferred = 0;
  const ctx = { pv: '', amp: '', tam: '' };
  rows.forEach((r, ri) => {
    if (!r || r.every(blank)) return;
    const filled = r.filter(c => !blank(c));
    if (filled.some(c => /^(รวม|total)/i.test(key(c)))) return;           // แถวสรุป
    // แถวหัวกลุ่ม (ช่องเดียว เช่น "อำเภอแว้ง" / "ตำบลแม่ดง") → ใช้กับแถวถัดไป
    if (filled.length === 1 && !isNum(filled[0])) {
      const s = fixThai(filled[0]), a = geo.amphoe(s), t = !a && geo.tambon(ctx.amp, s);
      if (a) { ctx.amp = a; ctx.tam = ''; } else if (t) { ctx.amp = t.a; ctx.tam = t.t; }
      return;
    }
    // ผสานเซลล์: ช่องว่าง = ค่าเดียวกับแถวก่อนหน้า
    ['pv', 'amp', 'tam'].forEach(f => { const v = fixThai(get(r, f)); if (v) { ctx[f] = v; if (f === 'amp') ctx.tam = ''; } });
    if (cm.pv && ctx.pv && !/นราธิวาส/.test(key(ctx.pv))) { otherPv++; return; }
    const n = ri + 1;
    // ตัดเฉพาะ "บ." (forecast.html เติม "บ." ให้เอง) · ไม่ตัด "บ้าน" เพราะบางหมู่บ้านชื่อขึ้นต้นด้วยบ้านจริง เช่น บ้านละหาร
    let ban = fixThai(get(r, 'ban')).replace(/^บ\.\s*/, '');
    const mu = fixThai(get(r, 'mu')).match(/\d{1,2}/);
    if (!ban && mu) ban = 'ม.' + (+mu[0]);
    if (!ban) { warn.push(`แถว ${n}: ไม่มีชื่อหมู่บ้าน — ไม่นำเข้า`); return; }
    const ffr = ffrValue(get(r, 'ffr'));
    if (ffr == null || ffr < 0 || ffr > 100) { warn.push(`แถว ${n} (บ.${ban}): ค่า FFR "${fixThai(get(r, 'ffr'))}" อ่านไม่ได้ — ไม่นำเข้า`); return; }
    if (/\u0000/.test(SI.pdfTone(get(r, 'ban')))) lossy.push(ban);   // วรรณยุกต์ที่ PDF ถอดไม่ออกและเดาไม่ได้ (fixThai ตัดทิ้ง) ชื่ออาจสะกดไม่ครบ
    let lv = level(get(r, 'lv'));
    if (!lv) { lv = ffr >= FFR_HIGH ? 'high' : 'low'; inferred++; }
    let a = geo.amphoe(ctx.amp);
    const tm = geo.tambon(a, ctx.tam);
    if (tm) a = tm.a;
    const ap = a || ctx.amp.replace(/^(อ\.|อำเภอ)\s*/, '');
    const tb = tm ? tm.t : ctx.tam.replace(/^(ต\.|ตำบล)\s*/, '');
    if (!tm) { const k = `ต.${tb || '?'} อ.${ap || '?'}`; unmatched.set(k, (unmatched.get(k) || 0) + 1); }
    out.push([ap, tb, ban, Math.round(ffr * 1000) / 1000, lv]);
  });
  if (lossy.length) warn.unshift(`${lossy.length} ชื่อหมู่บ้านมีวรรณยุกต์ที่อ่านจาก PDF ไม่ออก (ตัดออกแล้ว) เช่น ${lossy.slice(0, 5).map(b => 'บ.' + b).join(', ')} — ตรวจการสะกด หรือใช้ไฟล์ Excel แทน`);
  if (otherPv) warn.unshift(`ข้าม ${otherPv} แถวของจังหวัดอื่น (เก็บเฉพาะนราธิวาส)`);
  if (inferred) warn.unshift(`${inferred} แถวไม่มีระดับความเสี่ยงที่อ่านได้ — กำหนดจากค่า FFR (≥ ${FFR_HIGH} = เสี่ยงสูง ต่ำกว่านั้น = เสี่ยงต่ำ) ตรวจให้ตรงกับต้นฉบับ`);
  unmatched.forEach((c, k) => warn.unshift(`ไม่พบ ${k} ในขอบเขตตำบล (${c} หมู่บ้าน) — ขึ้นในรายชื่อแต่ไม่ระบายสีบนแผนที่ ตรวจการสะกด`));
  return {
    rows: out, warn, period: guessPeriod(above), unmatched: unmatched.size, inferred,
    columns: Object.fromEntries(Object.entries(cm).map(([f, ix]) => [f, ix.map(i => hdr[i])]))
  };
}

// PDF: ใช้ตัวอ่านของ survey-import กับตัวให้คะแนนหัวตารางของไฟล์นี้ · คืน {table, lines} (lines = ข้อความหน้าแรก ไว้เดาช่วงเวลา)
function tableFromPdfPages(pages) {
  const table = SI.tableFromPdfPages(pages, headerScore, 3);
  const lines = pages.length ? SI.pdfLines(pages[0]).map(l => l.text) : [];
  return { table, lines };
}

const API = { FFR_HIGH, level, ffrValue, guessPeriod, headerScore, mapColumns, splitHeader, toRows, tableFromPdfPages };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.FfrImport = API;
})(typeof window !== 'undefined' ? window : globalThis);
