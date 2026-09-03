/* js/criteria.js · เกณฑ์กลางสำหรับการเตือนน้ำท่วม
 * ใช้ร่วมกันระหว่าง forecast.html (คาดการณ์รายสถานี) และ index.html (อำเภอที่ต้องเฝ้าระวัง)
 * แก้ที่นี่ที่เดียว ทั้งสองหน้าจะเปลี่ยนตาม ไม่หลุดกันเหมือนตอนที่ต่างคนต่างมีเกณฑ์ของตัวเอง
 *
 * หลักคิด: "ฝนคือต้นเหตุ ดินและระดับน้ำคือตัวเร่ง"
 * ดินอิ่มน้ำหรือสถานีน้ำมาก จะยกระดับความเสี่ยงได้ก็ต่อเมื่อมีฝนหนักจริงในพยากรณ์
 * ลำพังดินชื้นในฤดูที่ฝนไม่ตก ไม่ทำให้เกิดน้ำท่วม จึงต้องไม่ขึ้นสีเตือน
 */
(function(){
'use strict';

const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };

const CRIT = {
  /* ---- ระดับน้ำรายสถานี (ใช้ใน forecast.html) ---- */
  RISE_MIN:   0.02,   // ม./ชม. · ถือว่า "กำลังขึ้น" (12 ซม. ใน 6 ชม.)
  RISE_FAST:  0.05,   // ม./ชม. · ถือว่า "ขึ้นเร็ว" (30 ซม. ใน 6 ชม.)
  FALL_MIN:  -0.02,   // ม./ชม. · ถือว่า "กำลังลด"
  PCT_HIGH:   85,     // % ของตลิ่ง · น้ำมากใกล้ตลิ่ง แม้ทรงตัวก็เฝ้าระวัง
  PCT_RISE:   70,     // % ของตลิ่ง · "น้ำมาก" (เกณฑ์ สสน.) ใช้ร่วมกับน้ำกำลังขึ้น
  PCT_MID:    50,     // % ของตลิ่ง · ใช้ร่วมกับน้ำขึ้นเร็ว
  STALE_H:    6,      // ชม. · ข้อมูลเก่ากว่านี้ไม่ใช้คาดการณ์

  /* ---- ฝนพยากรณ์รายวัน (เกณฑ์กรมอุตุนิยมวิทยา) ---- */
  RAIN1_HEAVY: 35,    // มม./วัน · "ฝนตกหนัก"
  RAIN1_VHEAVY: 90,   // มม./วัน · "ฝนตกหนักมาก"
  RAIN1_MID:   60,    // มม./วัน · หนักค่อนไปทางหนักมาก
  /* ฝนสะสม 3 วันติดกัน คือตัวชี้น้ำท่วมที่ดีกว่าฝนรวมทั้งสัปดาห์
     ฝนรวม 250 มม. ที่กระจาย 7 วัน ไม่อันตรายเท่า 200 มม. ใน 3 วัน */
  RAIN3F_LOW:  70,    // มม./3 วันพยากรณ์ · เริ่มต้องมอง
  RAIN3F_MID: 120,
  RAIN3F_HIGH:200,

  /* ---- ฝนสะสม 3 วันที่ผ่านมา = ดินอิ่มน้ำ (สสน.) ---- */
  SOIL_MOIST:  80,
  SOIL_WET:   150,
  SOIL_SAT:   250,

  RAIN3D: [           // ใช้แสดงป้ายดัชนีดินอิ่มน้ำ
    {min:250, color:'var(--st-danger)', short:'อิ่มน้ำมาก',  long:'อิ่มน้ำมาก เสี่ยงสูง'},
    {min:150, color:'var(--st-warn)',   short:'อิ่มน้ำ',     long:'อิ่มน้ำ เฝ้าระวัง'},
    {min:80,  color:'var(--st-watch)',  short:'ชื้นปานกลาง', long:'ชื้นปานกลาง'},
    {min:0,   color:'var(--st-normal)', short:'ปกติ',        long:'ปกติ'}
  ]
};

function rainClass(mm){
  if(mm==null) return {color:'var(--ink-3)', short:'ไม่มีข้อมูล', long:'ไม่มีข้อมูล'};
  return CRIT.RAIN3D.find(r => mm >= r.min);
}

/* ระดับตลิ่งที่ใช้ได้: min_bank ถ้า > 0 · ถ้าไม่มี (สถานี ชป. ส่ง 0) ค่อยใช้ค่าต่ำสุดของตลิ่งซ้าย/ขวาที่ > 0
   ไม่เอา min ของทั้งสามค่า เพราะบางสถานีมีตลิ่งซ้าย/ขวาผิด
   เช่น บ้านนาสีทอง min_bank 39.9 แต่ซ้าย/ขวา 6.3 ซึ่งจะกลายเป็นล้นตลิ่งตลอดเวลา */
function validBank(minBank, left, right){
  const mb = num(minBank);
  if(mb!=null && mb > 0) return mb;
  const v = [left, right].map(num).filter(x => x!=null && x > 0);
  return v.length ? Math.min(...v) : null;
}

/* % ความจุลำน้ำ · ใช้ค่าที่หน่วยงานส่งมาก่อน ถ้าไม่มีจึงคำนวณจากพื้นท้องน้ำถึงตลิ่ง */
function fillPct(s){
  if(s.pct!=null) return s.pct;
  if(s.msl!=null && s.bank!=null && s.ground!=null && s.bank > s.ground)
    return (s.msl - s.ground) / (s.bank - s.ground) * 100;
  return null;
}

/* สถานะจาก "ระดับน้ำปัจจุบัน" อย่างเดียว (ไม่ใช้แนวโน้ม)
   ใช้ได้กับสถานีที่ไม่มีกราฟย้อนหลัง เช่น สถานีกรมชลประทาน */
function stationLevel(s){
  if(s.msl==null) return 'na';
  // ล้นตลิ่งต้องมีตลิ่งที่ถูกต้อง และถ้าหน่วยงานส่ง % มาเองต้องสอดคล้องกัน
  if(s.bank!=null && s.msl >= s.bank && (s.pct==null || s.pct >= 100)) return 'over';
  const p = fillPct(s);
  if(p!=null && p >= CRIT.PCT_HIGH) return 'high';
  return 'normal';
}

/* ตัดสถานีซ้ำ (ชื่อเดียวกัน จังหวัดเดียวกัน จากคนละหน่วยงาน)
   เก็บตัวที่มีข้อมูลตลิ่ง/สถานะครบกว่า ไม่งั้นสถานีเดียวถูกนับสองครั้ง */
function dedupe(list){
  const seen = new Map();
  list.forEach(s => {
    const key = (s.prov||'') + '|' + String(s.name||'').replace(/\s+/g,'');
    // ให้คะแนนรหัสสถานีด้วย เพราะการ์ดสถานีหลักในหน้าแรกค้นด้วย tele_station_oldcode (X.73, X.119A)
    const score = (s.bank!=null?2:0) + (s.sit!=null?1:0) + (s.pct!=null?1:0) + (s.code?1:0);
    const prev = seen.get(key);
    if(!prev || score > prev.score) seen.set(key, {s, score});
  });
  return [...seen.values()].map(v => v.s);
}

/* ฝนสะสมสูงสุด 3 วันติดกัน จากอาเรย์ฝนรายวัน */
function maxRoll3(daily){
  const a = (daily||[]).map(v => +v || 0);
  if(!a.length) return 0;
  let mx = 0;
  for(let i=0;i<a.length;i++) mx = Math.max(mx, a[i] + (a[i+1]||0) + (a[i+2]||0));
  return mx;
}

const AMP_LV = [
  {k:'normal', label:'ต่ำ',      color:'var(--st-normal)'},
  {k:'watch',  label:'ปานกลาง', color:'var(--st-watch)'},
  {k:'warn',   label:'สูง',     color:'var(--st-warn)'},
  {k:'danger', label:'สูงมาก',  color:'var(--st-danger)'}
];

/* ความเสี่ยงน้ำท่วมรายอำเภอใน 7 วันข้างหน้า
 * ระดับตั้งต้นมาจากฝนพยากรณ์เท่านั้น (rainLv)
 * ดินอิ่มน้ำและสถานีน้ำมาก เป็นตัวยกระดับ ใช้ได้เมื่อมีฝนหนักจริงแล้วเท่านั้น
 * ยกเว้นสถานีที่ล้นตลิ่งอยู่จริงตอนนี้ ซึ่งเป็นเหตุการณ์ที่เกิดแล้ว ไม่ใช่การคาด
 */
function amphoeRisk(x){
  const rain1 = x.rain1max, rain3 = x.rain3max;
  if(rain1==null) return {lv:null, ...AMP_LV[0], label:'…', color:'var(--ink-3)', why:'ไม่มีข้อมูลฝนพยากรณ์', bar:0};
  const soil = x.soil || 0, stOver = x.stOver || 0, stHigh = x.stHigh || 0;

  let lv = (rain1 >= CRIT.RAIN1_VHEAVY || rain3 >= CRIT.RAIN3F_HIGH) ? 3
         : (rain1 >= CRIT.RAIN1_MID    || rain3 >= CRIT.RAIN3F_MID)  ? 2
         : (rain1 >= CRIT.RAIN1_HEAVY  || rain3 >= CRIT.RAIN3F_LOW)  ? 1 : 0;
  const rainLv = lv;
  const why = [];
  // บอกให้ตรงว่าอะไรเป็นตัวดันระดับ ฝนก้อนเดียวหนักมาก หรือฝนสะสมหลายวัน
  if(rain1 >= CRIT.RAIN1_VHEAVY)        why.push('ฝนหนักมาก');
  else if(rain3 >= CRIT.RAIN3F_HIGH)    why.push('ฝนสะสม 3 วันสูงมาก');
  else if(rain1 >= CRIT.RAIN1_HEAVY)    why.push('ฝนหนัก');
  else if(rain3 >= CRIT.RAIN3F_MID)     why.push('ฝนสะสม 3 วันสูง');
  else if(rain3 >= CRIT.RAIN3F_LOW)     why.push('ฝนสะสม 3 วันปานกลาง');
  else                                  why.push('ฝนไม่ถึงเกณฑ์หนัก');

  if(rainLv >= 1 && soil >= CRIT.SOIL_WET){ lv++; why.push('ดินอิ่มน้ำ'); }
  if(rainLv >= 1 && stHigh >= 2){ lv++; why.push('หลายสถานีน้ำใกล้ตลิ่ง'); }
  if(stHigh >= 1 && lv < 1){ lv = 1; why.push('มีสถานีน้ำใกล้ตลิ่ง'); }
  if(stOver >= 1 && lv < 2){ lv = 2; why.push('มีสถานีล้นตลิ่งแล้ว'); }
  else if(stOver >= 1) why.push('มีสถานีล้นตลิ่งแล้ว');
  lv = Math.min(3, lv);

  const barRain = Math.max(rain1 / CRIT.RAIN1_VHEAVY, rain3 / CRIT.RAIN3F_HIGH);
  const bar = Math.round(Math.min(1, Math.max(barRain, lv/3)) * 100);
  return {lv, ...AMP_LV[lv], why: why.join(' · '), bar};
}

window.FloodCriteria = {CRIT, rainClass, validBank, fillPct, stationLevel, dedupe, maxRoll3, amphoeRisk, AMP_LV};
})();
