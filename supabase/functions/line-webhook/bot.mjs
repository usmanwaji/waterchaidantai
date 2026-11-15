// supabase/functions/line-webhook/bot.mjs
//
// ตรรกะทั้งหมดของบอท LINE แยกจาก index.ts เพื่อให้รันทดสอบด้วย node --test ได้
// (ใช้แค่ Web Crypto, fetch, Request/Response มาตรฐาน · ไม่มี API เฉพาะ Deno)
// ชุดทดสอบอยู่ที่ line-oa/test/

const HOME_URL = "https://home-proxy.newusmanwaji.workers.dev/home.json?parts=ddpm,trends,thr";
const FETCH_TIMEOUT_MS = 5000;

// เกณฑ์ชุดเดียวกับหน้าแรก (index.html: heroPool, HERO_FRESH_H, HERO_NEAR_KM, DDPM_LV, เกณฑ์ทิศทาง ปภ. 2 ซม.)
const FRESH_H = 6;
const NEAR_KM = 60;
const TREND_M = 0.02;
const DDPM_LABEL = { 1: "ปกติ", 2: "เฝ้าระวัง", 3: "เตรียมรับมือ", 4: "อพยพ", 5: "ต้องอพยพ" };
const DATA_STALE_MIN = 30;

const LV = {
  over: { dot: "🔴", word: "ล้นตลิ่ง" },
  high: { dot: "🟠", word: "ใกล้ตลิ่ง" },
  normal: { dot: "🟢", word: "ปกติ" },
  nodata: { dot: "⚪", word: "ไม่มีค่าล่าสุด" },
};
const TREND = { up: "↑ กำลังขึ้น", down: "↓ กำลังลด", flat: "→ ทรงตัว" };

export const TG_BOT_URL = "https://t.me/NaraFloodbot";
export const HOTLINE = "1784";

// ---------------------------------------------------------------- ลายเซ็น

const b64 = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// LINE เซ็น body ดิบ (ไบต์ตามที่ส่งมา) ด้วย HMAC-SHA256 แล้วเข้ารหัส base64
export async function verifySignature(secret, rawBytes, signature) {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBytes));
  return safeEqual(b64(mac), signature);
}

// ---------------------------------------------------------------- คำสั่ง

// ลำดับมีความหมาย: เทียบตามลำดับนี้ เจออันแรกใช้อันนั้น (LINE-OA-PLAN.md ข้อ 5.2)
export const COMMANDS = [
  ["status", ["สถานการณ์", "น้ำ", "ระดับน้ำ", "ตอนนี้"]],
  ["shelter", ["ศูนย์พักพิง", "อพยพ", "ที่จอดรถ"]],
  ["near", ["ใกล้ฉัน", "บ้านฉัน", "พื้นที่ฉัน"]],
  ["rain", ["ฝน", "พยากรณ์", "คาดการณ์"]],
  ["help", ["ช่วย", "sos", "1784"]],
  ["alert", ["เตือน", "แจ้งเตือน", "telegram"]],
  ["me", ["สถานะ", "รหัสของฉัน", "id"]],
  ["stop", ["หยุด", "ยกเลิก"]],
];
const CMD_NAMES = new Set(COMMANDS.map(([c]) => c));

export function matchCommand(text) {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return null;
  for (const [cmd, words] of COMMANDS) if (words.some((w) => t.includes(w))) return cmd;
  return null;
}

export function postbackCommand(data) {
  const cmd = new URLSearchParams(String(data ?? "")).get("cmd");
  return cmd && CMD_NAMES.has(cmd) ? cmd : null;
}

// ---------------------------------------------------------------- สถานี

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// updatedAt ของ ปภ. เป็นเวลาไทยไม่มีโซน ("2026-11-15T21:40:01.242") · มีโซนมาแล้วใช้ตามนั้น
const ddpmTime = (s) => {
  if (!s) return null;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}+07:00`);
  return Number.isFinite(t) ? t : null;
};

export function trendOf(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const prev = num(pair[0]), last = num(pair[1]);
  if (prev == null || last == null) return null;
  const d = last - prev;
  return d >= TREND_M ? "up" : d <= -TREND_M ? "down" : "flat";
}

/**
 * home.json ของ home-proxy → สถานี ปภ. ในรูปเดียวกัน
 * lvl ใช้กติกาเดียวกับ heroPool() หน้าแรก:
 *   over   = ระดับน้ำถึงตลิ่ง · high = ปภ. ประกาศ "เตรียมรับมือ" ขึ้นไป · ที่เหลือ normal
 *   nodata = ไม่มีค่า, status 0, หรือค่าเก่ากว่า 6 ชม.
 * fb (ม.) = ตลิ่ง − ระดับน้ำ · null เมื่อไม่มีตลิ่ง (riverBankLevel ≤ 0 หรือว่าง)
 */
export function parseStations(home, nowMs) {
  const ddpm = home?.parts?.ddpm;
  const rows = ddpm?.d?.data;
  if (!Array.isArray(rows)) return null;
  const trends = home?.parts?.trends?.d?.ddpm ?? {};
  const stations = rows.filter((d) => d && d.isActive !== 0 && !d.deletedAt).map((d) => {
    const cur = num(d.currentWaterLevel);
    const bankRaw = num(d.riverBankLevel);
    const bank = bankRaw != null && bankRaw > 0 ? bankRaw : null;
    const dt = ddpmTime(d.updatedAt);
    const fresh = dt != null && nowMs - dt <= FRESH_H * 3600e3;
    const nodata = cur == null || d.status === 0 || !fresh;
    const lvNum = nodata ? 0 : num(d.waterLevelStatus) ?? 0;
    const lvl = nodata ? "nodata"
      : bank != null && cur >= bank ? "over"
      : lvNum >= 3 ? "high" : "normal";
    return {
      code: String(d.code ?? ""), name: String(d.name ?? "").trim(), amphoe: String(d.amphoeName ?? "").trim(),
      lat: num(d.latitude), lng: num(d.longitude), cur, bank, dt, lvl, lvNum,
      fb: !nodata && bank != null ? bank - cur : null,
      trend: nodata ? null : trendOf(trends[d.code]),
    };
  });
  const at = num(ddpm.t);
  const stale = ddpm.s === 1 || at == null || nowMs - at > DATA_STALE_MIN * 60e3;
  return { stations, at, stale };
}

// ---------------------------------------------------------------- ข้อความ

const f2 = (n) => n.toFixed(2);

export function thaiClock(ms) {
  const d = new Date(ms + 7 * 3600e3);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

const fbText = (s) => s.fb == null ? "ไม่มีข้อมูลตลิ่ง"
  : s.fb >= 0 ? `อีก ${f2(s.fb)} ม. ถึงตลิ่ง` : `สูงกว่าตลิ่ง ${f2(-s.fb)} ม.`;
const place = (s) => s.amphoe ? `${s.name} อ.${s.amphoe}` : s.name;
const stationLine = (s) =>
  `${LV[s.lvl].dot} ${place(s)} — ${fbText(s)}${s.trend ? ` ${TREND[s.trend]}` : ""}`;

const dataFooter = (p) => p.stale
  ? `ข้อมูลอาจไม่ล่าสุด${p.at != null ? ` (ปภ. ณ ${thaiClock(p.at)} น.)` : ""}`
  : `ข้อมูล ปภ. ณ ${thaiClock(p.at)} น.`;

const byUrgency = (a, b) =>
  (a.lvl === "over" ? 0 : 1) - (b.lvl === "over" ? 0 : 1) || (a.fb ?? Infinity) - (b.fb ?? Infinity);

export function statusText(parsed, site) {
  const live = parsed?.stations.filter((s) => s.lvl !== "nodata") ?? [];
  if (!live.length) return `ตอนนี้ดึงข้อมูลสดไม่ได้ กรุณาดูที่ ${site} ครับ`;
  const over = live.filter((s) => s.lvl === "over");
  const high = live.filter((s) => s.lvl === "high");
  const normal = live.length - over.length - high.length;
  const nodata = parsed.stations.length - live.length;

  const head = over.length ? `🔴 จ.นราธิวาส: น้ำล้นตลิ่ง ${over.length} สถานี`
    : high.length ? `🟠 จ.นราธิวาส: น้ำใกล้ตลิ่ง ${high.length} สถานี`
    : "🟢 จ.นราธิวาส: ทุกสถานีอยู่ในระดับปกติ";
  const lines = [
    head,
    `(สถานีวัดน้ำ ปภ. ${live.length} แห่งที่ส่งค่าใน ${FRESH_H} ชม.)`,
    "",
    `ล้นตลิ่ง ${over.length} · ใกล้ตลิ่ง ${high.length} · ปกติ ${normal}${nodata ? ` · ไม่มีค่าล่าสุด ${nodata}` : ""}`,
    "",
  ];
  const hot = [...over, ...high].sort(byUrgency);
  if (hot.length) {
    lines.push("สถานีที่ต้องจับตา", ...hot.slice(0, 5).map(stationLine));
  } else {
    const closest = live.filter((s) => s.fb != null).sort(byUrgency)[0];
    if (closest) lines.push("สถานีที่ใกล้ตลิ่งที่สุด", stationLine(closest));
  }
  lines.push("", `ดูแผนที่สด: ${site}/map.html`, dataFooter(parsed));
  return lines.join("\n");
}

export function kmBetween(a, b, c, d) {
  const R = 6371, r = Math.PI / 180;
  const x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const fmtKm = (k) => k < 1 ? `${Math.round(k * 1000)} ม.` : `${k < 10 ? k.toFixed(1) : Math.round(k)} กม.`;

const levelWord = (s) => s.lvl === "high" || (s.lvl === "normal" && s.lvNum === 2)
  ? `${LV[s.lvl].word} (ปภ.: ${DDPM_LABEL[s.lvNum]})` : LV[s.lvl].word;

/**
 * ตำแหน่งผู้ใช้ → สถานีใกล้สุด 2 แห่ง + ศูนย์พักพิงใกล้สุด 3 แห่ง
 * parsed หรือ shelters เป็น null ได้ (ดึงไม่ทัน) · ส่วนที่ขาดชี้ไปหน้าเว็บแทน
 * ไม่เก็บตำแหน่งไว้ที่ไหนเลย
 */
export function nearText(lat, lng, parsed, shelters, site) {
  const withKm = (list, la, ln) => list
    .filter((x) => la(x) != null && ln(x) != null)
    .map((x) => ({ x, km: kmBetween(lat, lng, la(x), ln(x)) }));
  const st = parsed ? withKm(parsed.stations, (s) => s.lat, (s) => s.lng).sort((a, b) => a.km - b.km) : [];

  if (st.length && st[0].km > NEAR_KM) {
    return `ตำแหน่งนี้อยู่ห่างสถานีวัดน้ำที่ใกล้ที่สุด ${fmtKm(st[0].km)} ครับ\n` +
      "ระบบนี้ครอบคลุมเฉพาะ จ.นราธิวาส\n\n" +
      `ดูสถานการณ์น้ำทั่วประเทศ: https://www.thaiwater.net\nเหตุฉุกเฉินโทร ${HOTLINE}`;
  }

  const lines = [];
  if (st.length) {
    lines.push("สถานีวัดน้ำใกล้คุณ");
    for (const { x: s, km } of st.slice(0, 2)) {
      lines.push(`${LV[s.lvl].dot} ${place(s)} · ${fmtKm(km)}`);
      lines.push(s.lvl === "nodata" ? "   ไม่มีค่าล่าสุด"
        : `   ${levelWord(s)} · ${fbText(s)}${s.trend ? ` · ${TREND[s.trend]}` : ""}`);
    }
  } else {
    lines.push(`ดึงข้อมูลสถานีน้ำไม่ได้ ดูแผนที่: ${site}/map.html`);
  }

  lines.push("");
  const sh = shelters ? withKm(shelters, (a) => num(a.lat), (a) => num(a.lng))
    .sort((a, b) => (b.x.is_active === 1) - (a.x.is_active === 1) || a.km - b.km) : [];
  if (sh.length) {
    lines.push("ศูนย์พักพิงใกล้คุณ");
    for (const { x: a, km } of sh.slice(0, 3)) {
      const open = a.is_active === 1;
      const cap = num(a.capacity), now = num(a.current_residents) ?? 0;
      const room = cap == null ? "" : open ? ` · ว่าง ${Math.max(0, cap - now)} ที่` : ` · จุ ${cap} คน`;
      lines.push(`🏠 ${String(a.name ?? "").trim()}${a.district_name ? ` (อ.${a.district_name})` : ""} · ${fmtKm(km)}`);
      lines.push(`   ${open ? "เปิดแล้ว" : "ยังไม่เปิด"}${room}${a.coordinator_phone ? ` · โทร ${a.coordinator_phone}` : ""}`);
      lines.push(`   นำทาง: https://www.google.com/maps/dir/?api=1&destination=${num(a.lat)},${num(a.lng)}`);
    }
  } else {
    lines.push(`ดึงรายชื่อศูนย์พักพิงไม่ได้ ดูที่: ${site}/shelter.html`);
  }

  lines.push("", `ผลละเอียดรายตำบล: ${site}/check.html`, `เส้นทางเลี่ยงน้ำ: ${site}/route.html`);
  if (parsed && st.length) lines.push(dataFooter(parsed));
  return lines.join("\n");
}

export const welcomeText = () =>
  "สวัสดีครับ 👋 นี่คือ NaraFlood ติดตามน้ำท่วม จ.นราธิวาส\n\n" +
  "แตะเมนูด้านล่างเพื่อดู\n" +
  "• สถานการณ์น้ำตอนนี้\n" +
  "• สถานีน้ำและศูนย์พักพิงใกล้คุณ (ส่งตำแหน่งมาได้เลย)\n" +
  "• แผนที่น้ำและพยากรณ์ฝนบนเว็บ naraflood.com\n\n" +
  'LINE นี้ตอบเมื่อคุณถาม ถ้าต้องการให้เตือนอัตโนมัติเมื่อน้ำใกล้ล้นตลิ่ง พิมพ์ "เตือน"\n' +
  `เหตุฉุกเฉินโทร ${HOTLINE}`;

export const fallbackText = (site) =>
  `ตอนนี้ระบบตอบไม่ได้ชั่วคราว กรุณาดูที่ ${site} ครับ\nเหตุฉุกเฉินโทร ${HOTLINE}`;

export const usageText = () =>
  "พิมพ์ถามได้เลยครับ เช่น\n" +
  "• สถานการณ์น้ำ\n" +
  "• ศูนย์พักพิง\n" +
  "• ฝน\n" +
  "• เตือน (รับเตือนอัตโนมัติ)\n" +
  "• ช่วยเหลือ\n\n" +
  'หรือแตะ "ใกล้ฉัน" ด้านล่างเพื่อส่งตำแหน่ง';

const askLocationText = (site, page, what) =>
  `แตะปุ่ม "ใกล้ฉัน" ด้านล่างเพื่อส่งตำแหน่ง แล้วจะตอบ${what}ใกล้คุณครับ\n\n` +
  `หรือดูบนเว็บ: ${site}/${page}`;

const TEXTS = {
  shelter: (site) => askLocationText(site, "shelter.html", "ศูนย์พักพิงและสถานีน้ำ"),
  near: (site) => askLocationText(site, "check.html", "สถานีน้ำและศูนย์พักพิง"),
  rain: (site) => `พยากรณ์ฝนและพื้นที่เสี่ยงรายอำเภอ 7 วัน ดูได้ที่\n${site}/forecast.html`,
  help: (site) =>
    `เหตุฉุกเฉิน โทรสายด่วน ปภ. ${HOTLINE} (ตลอด 24 ชม.)\n\n` +
    `ศูนย์พักพิงใกล้คุณ: แตะ "ใกล้ฉัน" ด้านล่าง\nหรือดูที่ ${site}/shelter.html`,
  alert: (site) =>
    "LINE นี้ตอบเมื่อคุณถาม ไม่ได้ส่งเตือนเองครับ เพราะ LINE แผนฟรีส่งข้อความหาเพื่อนได้จำกัดต่อเดือน\n\n" +
    `รับเตือนอัตโนมัติเมื่อน้ำใกล้ล้นตลิ่ง ฟรีไม่จำกัด ทาง Telegram:\n${TG_BOT_URL}\n\n` +
    `วิธีสมัครทีละขั้น: ${site}/alert.html`,
  me: (_site, userId) =>
    `รหัส LINE ของคุณ:\n${userId}\n\n` +
    "ถ้าคุณเป็นผู้ใหญ่บ้าน กำนัน หรือเจ้าหน้าที่ อปท./ปภ. และต้องการให้ LINE นี้ส่งเตือนถึงคุณ " +
    "แจ้งรหัสนี้กับผู้ดูแลระบบครับ\n\nตอนนี้ LINE นี้ยังไม่ได้ส่งเตือนอัตโนมัติถึงคุณ",
  stop: () =>
    "ตอนนี้ LINE นี้ไม่ได้ส่งเตือนอัตโนมัติถึงคุณ จึงไม่มีอะไรต้องยกเลิกครับ\n" +
    "ถ้ารับเตือนทาง Telegram อยู่ พิมพ์ /stop ในบอท Telegram",
};

// quick reply ชุดเดียวกันทุกคำตอบ · คำขอตำแหน่งยก "ใกล้ฉัน" ขึ้นก่อน
export function quickReply(locationFirst = false) {
  const msg = (label) => ({ type: "action", action: { type: "message", label, text: label } });
  const loc = { type: "action", action: { type: "location", label: "ใกล้ฉัน" } };
  const rest = [msg("สถานการณ์น้ำ"), msg("ศูนย์พักพิง"), msg("ฝน"), msg("ช่วยเหลือ")];
  return { items: locationFirst ? [loc, ...rest] : [rest[0], loc, ...rest.slice(1)] };
}

const textMessage = (text, locationFirst) => ({ type: "text", text, quickReply: quickReply(locationFirst) });

// ---------------------------------------------------------------- เส้นทาง

/** event หนึ่งตัว → รายการ message ที่จะ reply (null = ไม่ต้องตอบ) */
export async function route(ev, ctx) {
  const site = ctx.site;
  const cmdReply = async (cmd) => {
    if (cmd === "status") return textMessage(statusText(await ctx.loadStations(), site));
    if (cmd === "me") return textMessage(TEXTS.me(site, ev.source.userId));
    if (cmd === "shelter" || cmd === "near") return textMessage(TEXTS[cmd](site), true);
    return textMessage(TEXTS[cmd](site));
  };

  if (ev.type === "follow") return [textMessage(welcomeText())];
  if (ev.type === "postback") {
    const cmd = postbackCommand(ev.postback?.data);
    return [cmd ? await cmdReply(cmd) : textMessage(usageText())];
  }
  if (ev.type !== "message") return null;

  const m = ev.message ?? {};
  if (m.type === "location") {
    const [parsed, shelters] = await Promise.all([ctx.loadStations(), ctx.loadShelters()]);
    return [textMessage(nearText(m.latitude, m.longitude, parsed, shelters, site))];
  }
  if (m.type === "text") {
    const cmd = matchCommand(m.text);
    return [cmd ? await cmdReply(cmd) : textMessage(usageText())];
  }
  return [textMessage(usageText())];
}

// ---------------------------------------------------------------- handler

async function getJson(fetchFn, url) {
  try {
    const r = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/**
 * สร้างตัวรับ webhook · ทุกอย่างที่แตะโลกภายนอกส่งเข้ามาทาง deps ให้ทดสอบได้
 * deps: { channelSecret, accessToken, siteUrl, fetch, now, log }
 */
export function makeHandler(deps) {
  const { channelSecret, accessToken } = deps;
  const site = (deps.siteUrl || "https://naraflood.com").replace(/\/+$/, "");
  const fetchFn = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console.error;
  const ok = () => new Response("OK", { status: 200 });

  const reply = async (replyToken, messages) => {
    try {
      const r = await fetchFn("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ replyToken, messages }),
      });
      if (!r.ok) log("line reply failed", r.status, await r.text().catch(() => ""));
    } catch (e) {
      log("line reply error", e);
    }
  };

  return async (req) => {
    if (req.method !== "POST") return ok();
    if (!channelSecret || !accessToken) return ok();

    const raw = new Uint8Array(await req.arrayBuffer());
    if (!(await verifySignature(channelSecret, raw, req.headers.get("x-line-signature")))) {
      return new Response("Unauthorized", { status: 401 });
    }
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return ok();
    }

    // โหลดข้อมูลครั้งเดียวต่อคำขอ แม้มีหลาย event
    let stations, shelters;
    const ctx = {
      site,
      loadStations: () => stations ??= getJson(fetchFn, HOME_URL).then((j) => parseStations(j, now())),
      loadShelters: () => shelters ??= getJson(fetchFn, `${site}/data/shelters-ddpm.json`)
        .then((j) => Array.isArray(j?.features) ? j.features.map((f) => f?.attributes).filter(Boolean) : null),
    };

    for (const ev of body?.events ?? []) {
      try {
        if (ev?.deliveryContext?.isRedelivery === true) continue;
        if (ev?.source?.type !== "user") continue;
        const messages = await route(ev, ctx);
        if (messages && ev.replyToken) await reply(ev.replyToken, messages);
      } catch (e) {
        log("line event error", e);
        if (ev?.replyToken) await reply(ev.replyToken, [textMessage(fallbackText(site))]);
      }
    }
    return ok();
  };
}
