// supabase/functions/line-webhook/core.mjs
//
// ตรรกะทั้งหมดของบอท LINE OA ที่ไม่แตะเครือข่าย · index.ts เป็นแค่ขอบนอก (รับ webhook / ส่ง reply)
// เขียนเป็น JavaScript ล้วน (ไม่ใช้ API เฉพาะ Deno) เพื่อให้ชุดทดสอบ node --test ใน line-oa/test/ รันได้
// ดูแบบทั้งหมดที่ LINE-OA-PLAN.md ข้อ 5
//
// เกณฑ์จัดระดับสถานีคัดมาจาก index.html (DDPM_LV, loadDdpm, heroPool, renderHero) ห้ามตั้งเกณฑ์ใหม่ที่นี่
// ถ้าแก้เกณฑ์ในหน้าแรก ต้องแก้ตรงนี้ให้ตรงกันด้วย ไม่งั้นบอทกับหน้าเว็บจะตอบคนละอย่าง

export const PROV = "นราธิวาส";
export const FRESH_H = 6;        // HERO_FRESH_H ใน index.html · ค่าเก่ากว่านี้ไม่ใช้เป็น "ตอนนี้"
export const NEAR_KM = 60;       // HERO_NEAR_KM · ห่างสถานีใกล้สุดเกินนี้ ถือว่าอยู่นอกพื้นที่
export const TREND_THR = 0.02;   // ม. · เกณฑ์ทิศทางน้ำของ ปภ. ในหน้าแรก (heroPool thr)
export const STALE_FETCH_MIN = 30; // home-proxy ดึง ปภ. ทุก 5 นาที · เกินนี้แปลว่า cron ค้าง
export const SHELTER_NEAR_KM = 15; // ในรัศมีนี้ ศูนย์ที่เปิดอยู่ขึ้นก่อนศูนย์ที่ใกล้กว่าแต่ยังไม่เปิด
export const HELP = { tel: "1784", play: "https://play.google.com/store/apps/details?id=th.co.mm.phonphai",
  ios: "https://apps.apple.com/th/app/phonphai/id1434801222" }; // ค่าเดียวกับ js/tabbar.js
export const TG_BOT = "NaraFloodbot"; // ค่าเดียวกับ alert.html
export const MAX_TEXT = 5000;   // ข้อความ text ของ LINE ยาวได้ไม่เกินนี้

// ระดับของ ปภ. (waterLevelStatus) · ชื่อเดียวกับ DDPM_LV ใน index.html
const DDPM_LV = { 1: "ปกติ", 2: "เฝ้าระวัง", 3: "เตรียมรับมือ", 4: "อพยพ", 5: "ต้องอพยพ" };
const ICON = { over: "🔴", high: "🟠", rise: "🟡", normal: "🟢", na: "⚪" };

const num = (v) => { const n = typeof v === "string" ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; };

/* ---------------- ลายเซ็น webhook ---------------- */

// X-Line-Signature = base64(HMAC-SHA256(channel secret, body ดิบ)) · ต้องคำนวณจาก byte ที่ได้รับจริง
// ห้าม JSON.parse แล้ว stringify ใหม่ (ลำดับ key / escape อักษรไทยจะต่างไป ลายเซ็นไม่ตรง)
export async function verifySignature(rawBytes, signature, secret) {
  if (!signature || !secret) return false;
  const enc = new TextEncoder();
  const body = typeof rawBytes === "string" ? enc.encode(rawBytes) : rawBytes;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
  let bin = ""; for (const b of mac) bin += String.fromCharCode(b);
  return safeEqual(btoa(bin), String(signature));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------------- จับคำสั่ง ---------------- */

// เรียงจากคำที่เจาะจงไปคำกว้าง · "น้ำ" กว้างที่สุด จึงอยู่ท้าย ไม่งั้น "ขอความช่วยเหลือน้ำท่วม" จะได้สรุปสถานการณ์แทนเบอร์ฉุกเฉิน
const COMMANDS = [
  ["help", ["ช่วยเหลือ", "ช่วยด้วย", "ฉุกเฉิน", "sos", "1784"]],
  ["stop", ["หยุด", "ยกเลิก"]],
  ["me", ["สถานะ", "รหัสของฉัน", "ไอดี"]],
  ["alert", ["แจ้งเตือน", "เตือน", "telegram", "เทเลแกรม"]],
  ["shelter", ["ศูนย์พักพิง", "พักพิง", "อพยพ", "ที่จอดรถ", "จอดรถ"]],
  ["near", ["ใกล้ฉัน", "บ้านฉัน", "พื้นที่ฉัน", "ใกล้บ้าน"]],
  ["rain", ["ฝน", "พยากรณ์", "คาดการณ์"]],
  ["status", ["สถานการณ์", "ระดับน้ำ", "ตอนนี้", "น้ำ"]],
];
export function matchCommand(text) {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return null;
  if (/^(id|my ?id|userid)$/.test(t)) return "me";
  for (const [cmd, words] of COMMANDS) if (words.some((w) => t.includes(w))) return cmd;
  return null;
}

/* ---------------- ข้อมูลสถานี ปภ. จาก home-proxy ---------------- */

// updatedAt ของ ปภ. เป็นเวลาไทยไม่มีโซน ("2026-10-01T14:45:01") · มีโซนมาแล้วใช้ตามนั้น (เหมือน loadDdpm)
function ddpmTime(s) {
  if (!s) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : String(s) + "+07:00");
  return isNaN(d) ? null : d.getTime();
}

// home = ผลของ /home.json?parts=ddpm,trends · คืนรายการสถานีที่จัดระดับแล้ว
export function ddpmStations(home, now) {
  const data = home?.parts?.ddpm?.d?.data;
  if (!Array.isArray(data)) return null;
  const trends = home?.parts?.trends?.d?.ddpm || {};
  return data.filter((d) => d.isActive !== 0 && !d.deletedAt).map((d) => {
    const cur = num(d.currentWaterLevel), bankRaw = num(d.riverBankLevel);
    const bank = bankRaw != null && bankRaw > 0 ? bankRaw : null;
    const lvNum = cur == null || d.status === 0 || !DDPM_LV[d.waterLevelStatus] ? 0 : d.waterLevelStatus;
    const dt = ddpmTime(d.updatedAt);
    const fresh = cur != null && dt != null && now - dt <= FRESH_H * 3600e3;
    const lvl = !fresh ? "na" : bank != null && cur >= bank ? "over" : lvNum >= 3 ? "high" : "normal";
    const t = trends[d.code];
    const dd = Array.isArray(t) && num(t[0]) != null && num(t[1]) != null ? num(t[1]) - num(t[0]) : null;
    const trend = !fresh || dd == null ? null : dd >= TREND_THR ? "up" : dd <= -TREND_THR ? "down" : "flat";
    return {
      code: d.code, name: String(d.name || "").trim(), amphoe: String(d.amphoeName || "").trim(),
      lat: num(d.latitude), lng: num(d.longitude), cur, bank, fb: bank != null && cur != null ? bank - cur : null,
      lvNum, lvText: lvNum ? DDPM_LV[lvNum] : null, lvl, trend, dt,
    };
  });
}

// ข้อมูลเก่าไหม: home-proxy ติดธง s / ดึงครั้งล่าสุดนานเกิน / ค่าวัดล่าสุดเก่าเกิน FRESH_H
export function dataAge(home, stations, now) {
  const part = home?.parts?.ddpm;
  const newest = Math.max(0, ...(stations || []).map((s) => s.dt || 0)) || null;
  const stale = !part || part.s === 1 || (part.t && now - part.t > STALE_FETCH_MIN * 60e3) ||
    !newest || now - newest > FRESH_H * 3600e3;
  return { newest, stale: !!stale };
}

/* ---------------- จัดรูปข้อความ ---------------- */

export function thTime(ms) {
  const d = new Date(ms + 7 * 3600e3); // เวลาไทยไม่มีเวลาออมแสง
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} น.`;
}
const amp = (a) => (a ? "อ." + a.replace(/^อ(ำเภอ|\.)\s*/, "") : "");
const fbText = (s) => s.fb == null ? "ไม่มีข้อมูลตลิ่ง"
  : s.fb >= 0 ? `ต่ำกว่าตลิ่ง ${s.fb.toFixed(2)} ม.` : `สูงกว่าตลิ่ง ${(-s.fb).toFixed(2)} ม.`;
const trendText = (t) => ({ up: "↑ กำลังขึ้น", down: "↓ กำลังลด", flat: "→ ทรงตัว" }[t] || "");
export const fmtKm = (k) => k < 1 ? Math.round(k * 1000) + " ม." : (k < 10 ? k.toFixed(1) : String(Math.round(k))) + " กม.";
export function kmBetween(a, b, c, d) {
  const R = 6371, r = Math.PI / 180;
  const x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function stationLine(s) {
  const bits = [s.lvl === "na" ? "ไม่มีค่าล่าสุด" : fbText(s)];
  if (s.trend) bits.push(trendText(s.trend));
  if (s.lvText && s.lvl !== "na") bits.push(`ปภ.: ${s.lvText}`);
  const icon = s.lvl === "normal" && s.trend === "up" ? ICON.rise : ICON[s.lvl];
  return `${icon} ${s.name}${s.amphoe ? " " + amp(s.amphoe) : ""}\n   ${bits.join(" · ")}`;
}
function footer(age, site, page) {
  const lines = [`ดูแผนที่สด: ${site}/${page}`];
  if (age.newest) lines.push(`ข้อมูล ปภ. ณ ${thTime(age.newest)}${age.stale ? " (ข้อมูลอาจไม่ล่าสุด)" : ""}`);
  return lines.join("\n");
}
const clip = (t) => (t.length > MAX_TEXT ? t.slice(0, MAX_TEXT - 1) + "…" : t);

// สรุปสถานการณ์ทั้งจังหวัด · หัวข้อใช้ลำดับเดียวกับประโยคบนสุดของหน้าแรก (renderHero)
export function buildStatus(home, now, site) {
  const all = ddpmStations(home, now);
  if (!all || !all.length) return `ตอนนี้ดึงข้อมูลสดไม่ได้ครับ กรุณาดูที่ ${site}`;
  const live = all.filter((s) => s.lvl !== "na");
  const over = live.filter((s) => s.lvl === "over"), high = live.filter((s) => s.lvl === "high");
  const normal = live.length - over.length - high.length;
  const rise = live.filter((s) => s.trend === "up").length, fall = live.filter((s) => s.trend === "down").length;
  const age = dataAge(home, all, now);

  let head;
  if (!live.length) head = `${ICON.na} ${PROV}: ยังอ่านค่าระดับน้ำล่าสุดไม่ได้`;
  else if (over.length) head = `${ICON.over} ${PROV}: น้ำล้นตลิ่ง ${over.length} สถานี`;
  else if (high.length) head = `${ICON.high} ${PROV}: น้ำใกล้ตลิ่ง ${high.length} สถานี`;
  else if (rise > fall && rise >= 2) head = `${ICON.rise} ${PROV}: น้ำกำลังเพิ่มระดับ`;
  else if (fall > rise) head = `${ICON.normal} ${PROV}: น้ำกำลังลด`;
  else head = `${ICON.normal} ${PROV}: น้ำยังปกติ`;

  const out = [head, `ล้นตลิ่ง ${over.length} · ใกล้ตลิ่ง ${high.length} · ปกติ ${normal} (สถานีวัดน้ำ ปภ. ${live.length} แห่ง)`];
  if (live.length) out.push(`ทิศทาง: ขึ้น ${rise} · ลด ${fall} · ทรงตัว ${live.length - rise - fall}`);

  const byFb = (a, b) => (a.fb ?? 1e9) - (b.fb ?? 1e9);
  const flagged = [...over.sort(byFb), ...high.sort(byFb)].slice(0, 5);
  if (flagged.length) {
    out.push("", "สถานีที่ต้องจับตา", ...flagged.map(stationLine));
    const more = over.length + high.length - flagged.length;
    if (more > 0) out.push(`…และอีก ${more} สถานี`);
  } else {
    const closest = live.filter((s) => s.fb != null).sort(byFb)[0];
    if (closest) out.push("", "สถานีที่ใกล้ตลิ่งที่สุด", stationLine(closest));
  }
  out.push("", footer(age, site, "map.html"));
  return clip(out.join("\n"));
}

// ใกล้ฉัน: สถานีใกล้สุด 2 แห่ง + ศูนย์พักพิง 3 แห่ง · ไม่บันทึกตำแหน่งไว้ที่ใด
export function buildNear(lat, lng, home, shelters, now, site) {
  lat = num(lat); lng = num(lng);
  if (lat == null || lng == null) return `อ่านตำแหน่งไม่ได้ครับ ลองส่งตำแหน่งใหม่ หรือดูที่ ${site}/check.html`;
  const all = (ddpmStations(home, now) || []).filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ ...s, km: kmBetween(lat, lng, s.lat, s.lng) })).sort((a, b) => a.km - b.km);
  const sh = shelterList(shelters).map((s) => ({ ...s, km: kmBetween(lat, lng, s.lat, s.lng) }));
  const nearestSt = all[0]?.km ?? Infinity, nearestSh = Math.min(Infinity, ...sh.map((s) => s.km));
  if (Math.min(nearestSt, nearestSh) > NEAR_KM) {
    return `ตำแหน่งนี้อยู่นอกพื้นที่ที่ระบบติดตามครับ\nNaraFlood ครอบคลุมเฉพาะ จ.${PROV}\n\nดูสถานการณ์ทั้งจังหวัด: ${site}`;
  }
  const out = [];
  if (all.length) {
    out.push("📍 สถานีวัดน้ำใกล้คุณ");
    for (const s of all.slice(0, 2)) out.push(`${stationLine(s)}\n   ห่าง ${fmtKm(s.km)}`);
  } else out.push("📍 ตอนนี้ดึงข้อมูลสถานีวัดน้ำไม่ได้");

  const pick = pickShelters(sh, 3);
  out.push("");
  if (pick.length) {
    out.push("🏠 ศูนย์พักพิงใกล้คุณ");
    for (const s of pick) {
      const st = s.active ? "เปิดอยู่" : "ยังไม่เปิด";
      const room = s.active && s.capacity > 0 ? ` · ว่าง ${Math.max(0, s.capacity - s.residents)}/${s.capacity}` : "";
      const lines = [`• ${s.name}${s.district ? " " + amp(s.district) : ""} — ${fmtKm(s.km)}`, `   ${st}${room}`];
      if (s.phone) lines.push(`   โทร ${s.phone}`);
      lines.push(`   นำทาง: https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`);
      out.push(lines.join("\n"));
    }
  } else out.push(`🏠 ตอนนี้ดึงรายชื่อศูนย์พักพิงไม่ได้ ดูที่ ${site}/shelter.html`);

  out.push("", `ผลละเอียดรายตำบล: ${site}/check.html`, `เส้นทาง/ถนนปิด: ${site}/route.html`);
  const age = dataAge(home, all, now);
  if (age.newest) out.push(`ข้อมูล ปภ. ณ ${thTime(age.newest)}${age.stale ? " (ข้อมูลอาจไม่ล่าสุด)" : ""}`);
  return clip(out.join("\n"));
}

export function shelterList(json) {
  const f = json?.features;
  if (!Array.isArray(f)) return [];
  return f.map((x) => x?.attributes || {}).filter((a) => num(a.lat) != null && num(a.lng) != null).map((a) => ({
    name: String(a.name || "ศูนย์พักพิง").trim(), district: String(a.district_name || "").trim(),
    lat: num(a.lat), lng: num(a.lng), active: a.is_active === 1 || a.is_active === "1",
    capacity: num(a.capacity) || 0, residents: num(a.current_residents) || 0,
    phone: String(a.coordinator_phone || "").replace(/[^\d,+ -]/g, "").trim(),
  }));
}
// ในรัศมี SHELTER_NEAR_KM: เปิดอยู่ก่อน แล้วตามระยะ · ไม่พอ 3 แห่งค่อยเติมแห่งที่ใกล้ที่สุดที่เหลือ
export function pickShelters(list, n) {
  const near = list.filter((s) => s.km <= SHELTER_NEAR_KM)
    .sort((a, b) => (b.active - a.active) || (a.km - b.km)).slice(0, n);
  const rest = list.filter((s) => !near.includes(s)).sort((a, b) => a.km - b.km);
  return [...near, ...rest].slice(0, n);
}

/* ---------------- ข้อความคงที่ ---------------- */

export function welcomeText() {
  return "สวัสดีครับ 👋 นี่คือ NaraFlood ติดตามน้ำท่วม จ.นราธิวาส\n\n" +
    "แตะเมนูด้านล่างเพื่อดู\n" +
    "• สถานการณ์น้ำตอนนี้\n" +
    "• สถานีน้ำและศูนย์พักพิงใกล้คุณ (ส่งตำแหน่งมาได้เลย)\n" +
    "• แผนที่น้ำและพยากรณ์ฝนบนเว็บ naraflood.com\n\n" +
    "LINE นี้ตอบเมื่อคุณถาม ถ้าต้องการให้เตือนอัตโนมัติเมื่อน้ำใกล้ล้นตลิ่ง พิมพ์ \"เตือน\"\n" +
    `เหตุฉุกเฉินโทร ${HELP.tel}`;
}
export function helpText(site) {
  return "พิมพ์หรือแตะปุ่มด้านล่างได้เลยครับ\n" +
    "• \"สถานการณ์น้ำ\" — สรุประดับน้ำทั้งจังหวัด\n" +
    "• ส่งตำแหน่ง — สถานีน้ำและศูนย์พักพิงใกล้คุณ\n" +
    "• \"ศูนย์พักพิง\" · \"ฝน\" · \"เตือน\" · \"ช่วยเหลือ\"\n\n" +
    `เว็บไซต์: ${site}`;
}
export function sosText() {
  return `🆘 เหตุฉุกเฉิน โทร ${HELP.tel} (สายด่วน ปภ. 24 ชม.)\n\n` +
    `หรือแจ้งผ่านแอปพ้นภัย\nAndroid: ${HELP.play}\niPhone: ${HELP.ios}\n\n` +
    "ถ้าน้ำกำลังขึ้นเร็ว ตัดไฟ ย้ายของขึ้นที่สูง และเตรียมออกจากบ้านทันทีครับ";
}
export const shelterAskText = (site) =>
  `ส่งตำแหน่งของคุณมาได้เลยครับ (แตะปุ่ม "ส่งตำแหน่ง" ด้านล่าง) จะได้ศูนย์พักพิงใกล้ที่สุด 3 แห่งพร้อมลิงก์นำทาง\n\nดูทั้งหมดบนแผนที่: ${site}/shelter.html`;
export const nearAskText = (site) =>
  `ส่งตำแหน่งของคุณมาได้เลยครับ (แตะปุ่ม "ส่งตำแหน่ง" ด้านล่าง) จะได้ระดับน้ำของสถานีใกล้คุณและศูนย์พักพิงใกล้ที่สุด\n\nเช็คความเสี่ยงรายตำบล: ${site}/check.html`;
export const rainText = (site) =>
  `🌧️ พยากรณ์ฝนและพื้นที่เสี่ยงน้ำท่วมรายอำเภอ 7 วันข้างหน้า\n${site}/forecast.html`;
export const alertText = (site) =>
  "LINE นี้ตอบเมื่อคุณถามครับ ส่วนการเตือนอัตโนมัติเมื่อน้ำใกล้ล้นตลิ่ง ส่งทาง Telegram (ฟรี ไม่จำกัด)\n\n" +
  `1) ติดตั้งแอป Telegram\n2) เปิด https://t.me/${TG_BOT}\n3) กด Start แล้วเลือกระดับที่ต้องการ\n\n` +
  `รายละเอียด: ${site}/alert.html\n\n` +
  "ผู้ใหญ่บ้าน กำนัน อปท. ที่ต้องการให้ LINE นี้เตือนเพื่อส่งต่อเข้ากลุ่มหมู่บ้าน พิมพ์ \"สถานะ\" แล้วส่งรหัสที่ได้ให้เจ้าหน้าที่";
export function meText(userId, rules) {
  const on = (rules || []).filter((r) => r.enabled);
  const state = on.length
    ? "กำลังรับแจ้งเตือนทาง LINE:\n" + on.map((r) => `• ${r.station_code || "ทั้งจังหวัด " + (r.province || PROV)} ≥ ${r.threshold}${r.metric === "rain_24h" ? " มม." : "% ของตลิ่ง"}`).join("\n") +
      "\n\nพิมพ์ \"หยุด\" เพื่อยกเลิก"
    : "ยังไม่ได้รับแจ้งเตือนทาง LINE (เปิดให้เฉพาะผู้ส่งต่อที่เจ้าหน้าที่ตั้งให้)";
  return `${state}\n\nรหัส LINE ของคุณ (ส่งให้เจ้าหน้าที่ได้):\n${userId}`;
}
export const stopText = (n) => n > 0
  ? "ยกเลิกรับแจ้งเตือนทาง LINE แล้วครับ · ยังถามสถานการณ์ได้ตามปกติ"
  : "คุณไม่ได้รับแจ้งเตือนทาง LINE อยู่ครับ (ถ้ารับทาง Telegram ให้พิมพ์ /stop ในบอท Telegram)";
export const fallbackText = (site) => `ตอนนี้ดึงข้อมูลสดไม่ได้ครับ กรุณาดูที่ ${site} หรือโทร ${HELP.tel} หากเป็นเหตุฉุกเฉิน`;

// ปุ่มลัดใต้ทุกคำตอบ (LINE รับได้ไม่เกิน 13 ปุ่ม · ป้ายไม่เกิน 20 ตัวอักษร)
export function quickReply() {
  const msg = (label, text) => ({ type: "action", action: { type: "message", label, text } });
  return { items: [
    msg("สถานการณ์น้ำ", "สถานการณ์น้ำ"),
    { type: "action", action: { type: "location", label: "ส่งตำแหน่ง" } },
    msg("ศูนย์พักพิง", "ศูนย์พักพิง"),
    msg("พยากรณ์ฝน", "ฝน"),
    msg("ช่วยเหลือ 1784", "ช่วยเหลือ"),
  ] };
}
const text = (t) => ({ type: "text", text: clip(t), quickReply: quickReply() });

/* ---------------- ตัวจัดการเหตุการณ์ ---------------- */

// deps: { now(), site, getHome(), getShelters(), listRules(channel), disableRules(channel) }
// คืน {replyToken, messages} ถ้าต้องตอบ · null ถ้าไม่ต้องตอบ (unfollow, กลุ่ม, ส่งซ้ำ)
export async function handleEvent(ev, deps) {
  if (!ev || ev.deliveryContext?.isRedelivery) return null;
  if (ev.source?.type !== "user") return null;       // เฟสแรกไม่รองรับกลุ่ม/ห้อง (ดู LINE-OA-PLAN.md ข้อ 9)
  const userId = ev.source.userId;
  const channel = userId ? `line:${userId}` : null;
  const site = deps.site;

  if (ev.type === "unfollow") {
    if (channel) await deps.disableRules(channel).catch(() => 0);
    return null;
  }
  const reply = (...msgs) => (ev.replyToken ? { replyToken: ev.replyToken, messages: msgs.slice(0, 5) } : null);

  if (ev.type === "follow") return reply(text(welcomeText()));

  let cmd = null;
  if (ev.type === "postback") cmd = new URLSearchParams(String(ev.postback?.data || "")).get("cmd");
  else if (ev.type === "message") {
    const m = ev.message || {};
    if (m.type === "location") {
      const [home, shelters] = await Promise.all([deps.getHome().catch(() => null), deps.getShelters().catch(() => null)]);
      if (!home && !shelters) return reply(text(fallbackText(site)));
      return reply(text(buildNear(m.latitude, m.longitude, home, shelters, deps.now(), site)));
    }
    if (m.type !== "text") return reply(text(helpText(site)));
    cmd = matchCommand(m.text);
  } else return null;

  switch (cmd) {
    case "status": {
      const home = await deps.getHome().catch(() => null);
      return reply(text(home ? buildStatus(home, deps.now(), site) : fallbackText(site)));
    }
    case "shelter": return reply(text(shelterAskText(site)));
    case "near": return reply(text(nearAskText(site)));
    case "rain": return reply(text(rainText(site)));
    case "help": return reply(text(sosText()));
    case "alert": return reply(text(alertText(site)));
    case "me": {
      const rules = channel ? await deps.listRules(channel).catch(() => []) : [];
      return reply(text(meText(userId || "(ไม่ทราบ)", rules)));
    }
    case "stop": {
      const n = channel ? await deps.disableRules(channel).catch(() => 0) : 0;
      return reply(text(stopText(n)));
    }
    default: return reply(text(helpText(site)));
  }
}
