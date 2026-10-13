/* js/survey-import.js — แปลงไฟล์แบบสำรวจ (Excel / PDF) เป็นแถวข้อมูลพร้อมพิกัด สำหรับ staff-upload.html
 * ใช้ได้ทั้งในเบราว์เซอร์ (window.SurveyImport) และ node (require) เพื่อทดสอบ
 *
 * ขั้นตอน: ไฟล์ → ตาราง 2 มิติ (tableFromSheet / tableFromPdfPages) → หาแถวหัวตาราง + จับคู่คอลัมน์จากคำในหัว
 *   → toRecords() ทำความสะอาดค่า แล้ววางพิกัด
 * รูปแบบแถวที่ได้ตรงกับไฟล์ในเว็บ:
 *   hosts   (บ้านพี่เลี้ยง)  = js/hosts_nwt.js   — ไม่มีพิกัดในแบบสำรวจ: กลางหมู่บ้าน (lv:'m') / กลางเขตเทศบาล (lv:'w') / กลางตำบล
 *   parking (ที่จอดรถหนีน้ำ) = js/parking_nwt.js — ใช้พิกัดที่กรอกถ้าอยู่ในอำเภอนั้น (x:1) ไม่งั้นกลางตำบล (raw = ค่าที่กรอก)
 */
(function (root) {
'use strict';

/* ---------- ข้อความ ---------- */
// ฟอนต์ใน PDF ที่ export จาก Excel ทำ "ำ" แตกเป็น " า"/" ำ" และไม้เอกหลุดหลัง ใ/ไ
function fixThai(s) {
  return String(s == null ? '' : s)
    .replace(/\s+[าำ]/g, 'ำ')
    .replace(/ไม\s+มี/g, 'ไม่มี').replace(/ใหญ\s*(?=บ้าน)/g, 'ใหญ่')
    .replace(/([\u0E31\u0E34-\u0E3A\u0E47-\u0E4E])\1+/g, '$1')   // สระ/วรรณยุกต์ซ้อนซ้ำ
    .replace(/\s+/g, ' ').trim();
}
// คีย์เทียบชื่อแบบหลวม: ไม่สนช่องว่าง วรรณยุกต์ การันต์ และ ำ/า
const key = s => fixThai(s).replace(/[\s.\-()]/g, '').replace(/ำ/g, 'า').replace(/[่-์]/g, '');
const blank = s => { s = fixThai(s); return s === '' || /^[-–—]+$/.test(s); };

const TH_MON = {'ม.ค.':1,'ก.พ.':2,'มี.ค.':3,'เม.ย.':4,'พ.ค.':5,'มิ.ย.':6,'ก.ค.':7,'ส.ค.':8,'ก.ย.':9,'ต.ค.':10,'พ.ย.':11,'ธ.ค.':12};
// Excel แปลงบ้านเลขที่ "29/4" เป็นวันที่ → ได้ "29-เม.ย." (ข้อความ) หรือ Date (เซลล์วันที่)
function house(v) {
  if (v instanceof Date) return v.getDate() + '/' + (v.getMonth() + 1);
  let h = fixThai(v).replace(/\s*\/\s*/g, '/');
  const m = h.match(/^(\d+)-(\S+)$/);
  if (m && TH_MON[m[2]]) return m[1] + '/' + TH_MON[m[2]];
  if (blank(h) || /^ไม่มี/.test(h)) return '';
  return h;
}
function tel(v) {
  const s = fixThai(v);
  const m = s.match(/0\d[\d\- ]{7,11}\d/) || s.match(/\d[\d\- ]{7,10}\d/);
  if (!m) return '';
  let d = m[0].replace(/\D/g, '');
  if (d.length === 9 && d[0] !== '0' && /^[689]/.test(d)) d = '0' + d;   // Excel ตัดเลข 0 นำหน้ามือถือ
  if (d.length === 10) return d.slice(0, 3) + '-' + d.slice(3);
  if (d.length === 9 && d[0] === '0') return d.slice(0, 2) + '-' + d.slice(2);
  return '';
}
function num(v) {
  if (typeof v === 'number') return isFinite(v) ? Math.round(v) : null;
  const m = fixThai(v).replace(/,/g, '').match(/\d+/);
  return m ? +m[0] : null;
}

/* ---------- หัวตาราง ---------- */
// ลำดับสำคัญ: ทดสอบผู้ประสานงานก่อนชื่อเจ้าของ (ทั้งคู่มีคำว่า "ชื่อ") · จักรยานยนต์ก่อนรถยนต์/จำนวน
const COLS = [
  ['n',     /^(ที|no|ลาดับที?)$|^ลา?ดับ/i],
  ['coord', /ผูประสาน|ผูดูแล|ผูรับผิดชอบ/],              // ชั่วคราว: กันไม่ให้ไปเข้าคอลัมน์อื่น แล้วเปลี่ยนชื่อเป็น c
  ['tel',   /เบอร|โทร|tel|phone/i],
  ['mc',    /จักรยานยนต|มอเตอรไซ/],
  ['car',   /รถยนต|รถเกง|รถกระบะ/],
  ['lat',   /ละติจูด|latitude|^lat$/i],
  ['lon',   /ลองจิจูด|longitude|^lon|^lng$/i],
  ['pos',   /พิกัด|gps|utm|ตาแหนง/i],
  ['amp',   /อาเภอ|อเภอ|^เภอ/],
  ['org',   /อปท|หนวยงาน|องคกร/],
  ['tam',   /ตาบล|ตบล/],
  ['house', /บานเลขที|เลขที/],
  ['mu',    /หมู|^ม$/],
  ['cap',   /รองรับ|จานวน|จนวน|คน\)?$/],
  ['place', /สถานที|ชือสถาน|ชือจุด|จุดจอด/],
  ['owner', /ชือ|เจาของ|บานพีเลียง/],
];
function headerScore(cells) {
  const ks = cells.map(key);
  return COLS.filter(([, re]) => ks.some(k => k && re.test(k))).length;
}
function mapColumns(hdr) {
  const map = {}, ks = hdr.map(key);
  ks.forEach((k, i) => {
    if (!k) return;
    for (const [f, re] of COLS) {
      if (!re.test(k)) continue;
      (map[f] = map[f] || []).push(i);
      return;
    }
  });
  if (map.coord) { map.c = map.coord; delete map.coord; }
  return map;
}
// ตาราง 2 มิติ → {hdr, rows} · หัวตารางอาจกินหลายแถว (เช่น "จำนวนที่จอด" แล้วแยก รถยนต์/จักรยานยนต์ แถวล่าง)
function splitHeader(table) {
  let best = -1, bestScore = 2;
  table.slice(0, 25).forEach((r, i) => { const s = headerScore(r); if (s > bestScore) { bestScore = s; best = i; } });
  if (best < 0) throw new Error('ไม่พบแถวหัวตาราง (ต้องมีหัวคอลัมน์ เช่น ลำดับ อำเภอ ตำบล หมู่ที่ ...)');
  const width = Math.max(...table.map(r => r.length));
  const hdr = Array.from({length: width}, (_, i) => fixThai(table[best][i]));
  let j = best + 1;
  // แถวถัดไปที่ช่องแรกไม่ใช่ตัวเลขลำดับ และมีคำหัวตาราง = หัวตารางต่อ
  while (j < table.length && j <= best + 2 && !/^\d+$/.test(fixThai(table[j][0])) && headerScore(table[j]) > 0) {
    table[j].forEach((c, i) => { if (!blank(c)) hdr[i] = (hdr[i] ? hdr[i] + ' ' : '') + fixThai(c); });
    j++;
  }
  // หัวที่ผสานเซลล์ (merged) จะว่างในคอลัมน์ถัดไป: ไม่เติม เพราะแถวล่างระบุชื่อย่อยไว้แล้ว
  return { hdr, rows: table.slice(j) };
}

/* ---------- Excel / CSV (SheetJS: sheet_to_json(ws, {header:1, raw:true})) ---------- */
function tableFromSheet(aoa) {
  return aoa.map(r => (r || []).map(c => c == null ? '' : c));
}

/* ---------- PDF (pdf.js getTextContent ทุกหน้า) ----------
 * pages = [[{str, x, y, w}, ...], ...] (y เพิ่มขึ้นด้านบน ตาม PDF)
 * แบ่งบรรทัดตาม y → รวมข้อความที่ชิดกันเป็นก้อน → หาบรรทัดหัวตาราง แล้วใช้ "ขอบขวาของหัวแต่ละคอลัมน์" เป็นเส้นแบ่ง
 * (หัวตารางจัดกึ่งกลาง ข้อมูลชิดซ้าย/ขวา: ข้อมูลเริ่มก่อนขอบขวาของหัวคอลัมน์ตัวเองเสมอ)
 * บรรทัดที่ไม่มีเลขลำดับ = ข้อความที่ตัดบรรทัดในเซลล์ → ต่อเข้าแถวที่ y ใกล้ที่สุด */
function pdfLines(items) {
  const its = items.filter(t => t.str && t.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  its.forEach(t => {
    const L = lines.find(l => Math.abs(l.y - t.y) <= 2.5);
    if (L) L.items.push(t); else lines.push({ y: t.y, items: [t] });
  });
  lines.forEach(l => {
    l.items.sort((a, b) => a.x - b.x);
    const ch = [];
    l.items.forEach(t => {
      const last = ch[ch.length - 1];
      const gap = last ? t.x - last.r : 99;
      if (last && gap < 4) { last.str += (gap > 1.5 ? ' ' : '') + t.str; last.r = Math.max(last.r, t.x + t.w); }
      else ch.push({ str: t.str, x: t.x, r: t.x + t.w });
    });
    l.chunks = ch;
    l.text = ch.map(c => c.str).join(' ');
  });
  return lines.sort((a, b) => b.y - a.y);
}
function tableFromPdfPages(pages) {
  let cols = null, hdrText = null;
  const out = [];
  pages.forEach(items => {
    const lines = pdfLines(items);
    let start = 0;
    const hi = lines.findIndex(l => headerScore(l.chunks.map(c => c.str)) >= 4);
    if (hi >= 0) {
      // บรรทัดหัวตาราง + บรรทัดหัวที่ต่อลงมา (จนกว่าจะเจอบรรทัดข้อมูลที่ขึ้นต้นด้วยเลขลำดับ)
      const hl = [lines[hi]];
      let k = hi + 1;
      while (k < lines.length && !/^\d+$/.test(fixThai(lines[k].chunks[0].str))) { hl.push(lines[k]); k++; }
      const cells = [];
      hl.forEach((l, li) => l.chunks.forEach(c => {
        const o = cells.find(z => c.x < z.r + 2 && c.r > z.x - 2);
        if (o) { o.x = Math.min(o.x, c.x); o.r = Math.max(o.r, c.r); o.str += ' ' + c.str; }
        else if (li === 0) cells.push({ x: c.x, r: c.r, str: c.str });
      }));
      // หัวคอลัมน์ที่เป็นหลายก้อนติดกัน (เช่น "ชื่อ - นามสกุล ( บ้านพี่เลี้ยง ) เจ้าของบ้าน") รวมกันถ้าห่างกันน้อย
      cells.sort((a, b) => a.x - b.x);
      const merged = [];
      cells.forEach(c => { const p = merged[merged.length - 1]; if (p && c.x - p.r < 5) { p.r = c.r; p.str += ' ' + c.str; } else merged.push({ ...c }); });
      cols = merged.map(c => c.r);
      hdrText = merged.map(c => fixThai(c.str));
      start = k;
    }
    if (!cols) return;   // หน้าก่อนเจอหัวตาราง (เช่นหน้าสรุป) ข้ามไป
    const colOf = x => { const i = cols.findIndex(r => x < r - 1); return i < 0 ? cols.length - 1 : i; };
    const rows = [];      // {y, cells:[[{y,str}]]}
    const extra = [];
    lines.slice(start).forEach(l => {
      const first = l.chunks[0];
      const isRow = colOf(first.x) === 0 && /^\d+$/.test(fixThai(first.str));
      const cellsOf = () => { const cs = cols.map(() => []); l.chunks.forEach(c => cs[colOf(c.x)].push({ y: l.y, str: c.str })); return cs; };
      if (isRow) rows.push({ y: l.y, cells: cellsOf() });
      else extra.push({ y: l.y, cells: cellsOf() });
    });
    extra.forEach(e => {
      if (!rows.length) return;
      const near = rows.reduce((a, b) => Math.abs(b.y - e.y) < Math.abs(a.y - e.y) ? b : a);
      if (Math.abs(near.y - e.y) > 30) return;     // ไกลเกินไป = ท้ายกระดาษ/หมายเหตุ
      e.cells.forEach((c, i) => near.cells[i].push(...c));
    });
    rows.forEach(r => out.push(r.cells.map(c => c.sort((a, b) => b.y - a.y).map(z => z.str).join(' '))));
  });
  if (!cols) throw new Error('ไม่พบหัวตารางในไฟล์ PDF');
  return [hdrText, ...out];
}

/* ---------- ภูมิศาสตร์ ---------- */
// villages = DDPM_RISK_DATA (pv, ap, tb, mu, lat, lng) · subdistricts / districts = GeoJSON ของ สทนช.
const AMP_ALIAS = { 'เมือง': 'เมืองนราธิวาส', 'อเมือง': 'เมืองนราธิวาส', 'โกลก': 'สุไหงโก-ลก', 'สุไหงโกลก': 'สุไหงโก-ลก' };
// เทศบาลที่แบบสำรวจกรอกถนน/ซอยแทนหมู่ → ใช้จุดกลางเขตเทศบาล (พิกัดจากแบบสำรวจที่จอดรถ)
const MUNI_POINTS = { 'สุไหงปาดี|ปะลุรู': [6.085697, 101.881283] };
function buildGeo(villages, subdistricts, districts) {
  const amps = {}, tams = {}, vill = {}, polys = {};
  districts.features.forEach(f => { amps[key(f.properties.name_th)] = f.properties.name_th; polys[f.properties.name_th] = f.geometry; });
  Object.keys(AMP_ALIAS).forEach(k => { amps[key(k)] = AMP_ALIAS[k]; });
  subdistricts.features.forEach(f => {
    const p = f.properties;
    tams[p.district_th + '|' + key(p.name_th)] = { a: p.district_th, t: p.name_th, ll: [p.center_lat, p.center_lon] };
  });
  (villages || []).forEach(v => { if (v.pv === '96') vill[v.ap + '|' + key(v.tb) + '|' + v.mu] = [v.lat, v.lng]; });
  const ampCenter = {};
  districts.features.forEach(f => { ampCenter[f.properties.name_th] = [f.properties.center_lat, f.properties.center_lon]; });

  function amphoe(s) {
    return amps[key(fixThai(s).replace(/^(อ\.|อำเภอ)\s*/, ''))] || null;
  }
  // ตำบล: ถ้าไม่รู้อำเภอ (หรืออำเภอกรอกผิด) หาจากชื่อตำบลที่ไม่ซ้ำทั้งจังหวัด
  function tambon(a, s) {
    const k = key(fixThai(s).replace(/^(ต\.|ตำบล)\s*/, ''));
    if (!k) return null;
    if (a && tams[a + '|' + k]) return tams[a + '|' + k];
    const hits = Object.keys(tams).filter(x => x.endsWith('|' + k));
    return hits.length === 1 ? tams[hits[0]] : null;
  }
  const village = (a, t, mu) => vill[a + '|' + key(t) + '|' + mu] || null;
  function inDistrict(lat, lon, a) {
    const g = polys[a]; if (!g) return false;
    const polysOf = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    return polysOf.some(rings => {
      let inside = false;
      rings.forEach((ring, ri) => {
        let c = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i], [xj, yj] = ring[j];
          if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
        }
        if (ri === 0) inside = c; else if (c) inside = false;
      });
      return inside;
    });
  }
  return { amphoe, tambon, village, inDistrict, ampCenter, muni: MUNI_POINTS };
}

/* ---------- พิกัด: ทศนิยม / องศา-ลิปดา-ฟิลิปดา / UTM 47N ---------- */
function utmToLatLon(E, N, zone) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const x = E - 500000, M = N / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const C1 = ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2, N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2);
  const R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, D = x / (N1 * k0);
  const lat = p1 - (N1 * Math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(p1);
  return [lat * 180 / Math.PI, (zone - 1) * 6 - 180 + 3 + lon * 180 / Math.PI];
}
function parseCoord(lat, lon, pos) {
  const s = [lat, lon, pos].filter(v => v != null && String(v).trim()).map(String).join(' ').replace(/[“”″]/g, '"').replace(/[‘’′]/g, "'");
  if (!s.trim()) return null;
  // องศา ลิปดา ฟิลิปดา
  const dms = [...s.matchAll(/(\d{1,3})\s*°\s*(\d{1,2})\s*['\s]\s*(\d{1,2}(?:\.\d+)?)?\s*"?\s*([NSEW])?/gi)]
    .map(m => +m[1] + (+m[2]) / 60 + (+(m[3] || 0)) / 3600);
  if (dms.length >= 2) return [dms[0], dms[1]];
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  // UTM 47N: E ~ 7xxxxx-8xxxxx, N ~ 6xxxxx-75xxxx (ไม่รวมเลขโซน 47)
  const big = nums.filter(n => n >= 100000);
  if (big.length >= 2) {
    const E = big.find(n => n < 1000000 && n > 600000), Nn = big.find(n => n !== E);
    if (E && Nn) return utmToLatLon(E, Nn, 47);
  }
  const dec = nums.filter(n => n > 1 && n < 200 && /\./.test(String(n)));
  if (dec.length >= 2) {
    const la = dec.find(n => n > 4 && n < 8), lo = dec.find(n => n > 100 && n < 103);
    if (la && lo) return [la, lo];
  }
  return null;
}

/* ---------- แถว → ระเบียน ---------- */
function detectKind(hdr) {
  const k = hdr.map(key).join(' ');
  if (/จักรยานยนต|รถยนต|จอดรถ/.test(k)) return 'parking';
  if (/บานพีเลียง|ผูพักพิง|เจาของบาน/.test(k)) return 'hosts';
  return null;
}
function toRecords(table, geo, kind) {
  const { hdr, rows } = splitHeader(table);
  const cm = mapColumns(hdr);
  kind = kind || detectKind(hdr);
  if (!kind) throw new Error('ระบุชนิดข้อมูลไม่ได้ (บ้านพี่เลี้ยง / ที่จอดรถ) — เลือกชนิดเองแล้วลองใหม่');
  const need = kind === 'hosts' ? ['tam'] : ['tam', 'place'];
  const miss = need.filter(f => !cm[f]);
  if (miss.length) throw new Error('ไม่พบคอลัมน์: ' + miss.map(f => ({ tam: 'ตำบล', place: 'สถานที่' }[f])).join(', '));
  const get = (r, f, last) => { const ix = cm[f]; if (!ix) return ''; const v = ix.map(i => r[i]).filter(v => !blank(v)); return v.length ? (last ? v[v.length - 1] : v[0]) : ''; };
  const out = [], warn = [];
  rows.forEach((r, ri) => {
    if (!r || r.every(blank)) return;
    const nRaw = get(r, 'n');
    const n = num(nRaw) || out.length + 1;
    // อำเภอ: แบบสำรวจมีทั้ง "อำเภอ" ของ อปท. และ "อำเภอ" ในที่อยู่ — ใช้ค่าท้ายสุดที่อ่านออก
    const ampRaw = get(r, 'amp', true) || get(r, 'amp');
    let a = geo.amphoe(ampRaw) || (cm.amp || []).map(i => geo.amphoe(r[i])).find(Boolean) || null;
    // อปท. "อบต.X" / "ทต.X": ถ้า X เป็นชื่อตำบลใช้ชื่อที่สะกดถูก และใช้แทนตำบลที่เว้นว่าง
    let o = fixThai(get(r, 'org')).replace(/\s*\.\s*/g, '.');
    const om = o.match(/^(อบต|ทต|ทม|ทน|เทศบาลตำบล|เทศบาลเมือง)\.?\s*(.+)$/);
    const otm = om ? geo.tambon(a, om[2]) : null;
    if (otm) o = om[1] + (om[1].length <= 3 ? '.' : '') + otm.t;
    const tm = geo.tambon(a, get(r, 'tam')) || (blank(get(r, 'tam')) ? otm : null);
    if (tm) a = tm.a;
    if (!a) { warn.push(`แถว ${n}: ไม่รู้จักอำเภอ/ตำบล "${fixThai(ampRaw)}" / "${fixThai(get(r, 'tam'))}" — ไม่นำเข้า`); return; }
    const t = tm ? tm.t : '';
    if (!tm && !blank(get(r, 'tam'))) warn.push(`แถว ${n}: ไม่รู้จักตำบล "${fixThai(get(r, 'tam'))}" ใน อ.${a} — วางกลางอำเภอ`);
    const muRaw = fixThai(get(r, 'mu'));
    const mm = muRaw.match(/^(?:ม\.?|หมู่(?:ที่)?)?\s*(\d{1,2})$/);
    const mnum = mm ? String(+mm[1]) : '';
    const road = !mnum && muRaw && !blank(muRaw) ? muRaw : '';
    const d = { n, a, t };
    if (mnum) d.m = 'ม.' + mnum;
    if (road) d.r = road;
    if (o) d.o = o;
    let c = fixThai(get(r, 'c')), ph = tel(get(r, 'tel'));
    // ข้อความยาวล้นเซลล์ใน PDF ทำให้เบอร์ไปติดท้ายชื่อผู้ประสานงาน
    if (!ph && tel(c)) { ph = tel(c); c = c.replace(/\s*0?\d[\d\- ]{7,11}\d\s*$/, '').replace(/\s+ะ$/, 'ะ'); }
    if (kind === 'hosts') {
      const p = fixThai(get(r, 'owner')); if (!blank(p)) d.p = p;
      const hRaw = (cm.house || []).map(i => r[i]).find(v => !blank(v));
      const h = house(hRaw);
      if (h && !/^\d/.test(h) && !/^\d/.test(h.replace(/^บ้านเลขที่\s*/, ''))) d.note = h.replace(/^\(|\)$/g, '');
      else if (h) d.h = h;
      const cap = num(get(r, 'cap')); if (cap != null) d.cap = cap;
    } else {
      d.p = fixThai(get(r, 'place')) || 'ไม่ระบุชื่อสถานที่';
      const mc = num(get(r, 'mc')), car = num(get(r, 'car'));
      if (mc != null) d.mc = mc;
      if (car != null) d.car = car;
    }
    if (!blank(c)) d.c = c;
    if (ph) d.tel = ph;
    // พิกัด
    let ll = null;
    if (kind === 'parking') {
      const raw = [get(r, 'lat'), get(r, 'lon'), get(r, 'pos')].filter(v => !blank(v)).map(v => fixThai(v)).join(' ');
      const pc = parseCoord(get(r, 'lat'), get(r, 'lon'), get(r, 'pos'));
      if (pc && geo.inDistrict(pc[0], pc[1], a)) { ll = pc; d.x = 1; }
      else if (raw) d.raw = raw.slice(0, 60);
    } else {
      const v = mnum && t ? geo.village(a, t, mnum) : null;
      const mp = !v && road && t ? geo.muni[a + '|' + t] : null;
      if (v) { ll = v; d.lv = 'm'; }
      else if (mp) { ll = mp; d.lv = 'w'; }
    }
    if (!ll) ll = tm ? tm.ll : geo.ampCenter[a];
    d.lat = Math.round(ll[0] * 1e6) / 1e6; d.lon = Math.round(ll[1] * 1e6) / 1e6;
    out.push(d);
  });
  return { kind, rows: out, warn, columns: Object.fromEntries(Object.entries(cm).map(([f, ix]) => [f, ix.map(i => hdr[i])])) };
}

const API = { fixThai, house, tel, parseCoord, utmToLatLon, tableFromSheet, tableFromPdfPages, splitHeader, mapColumns, detectKind, buildGeo, toRecords };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.SurveyImport = API;
})(typeof window !== 'undefined' ? window : globalThis);
