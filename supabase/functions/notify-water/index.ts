// supabase/functions/notify-water/index.ts
//
// Deno Edge Function — เครื่องยนต์แจ้งเตือนน้ำ (roadmap ข้อ 2)
// ตรวจระดับน้ำ/ฝน เทียบกับ alert_rules ทุก ~15 นาที แล้วยิงข้อความเข้า Telegram (Bot API)
// พร้อมกัน cooldown ไม่ให้สแปม และบันทึกลง alert_log
//
// Deploy:
//   supabase functions deploy notify-water
//   supabase secrets set TELEGRAM_BOT_TOKEN=<token จาก @BotFather>  CRON_SECRET=some-long-random
// ตั้งเวลา (Supabase Dashboard → Edge Functions → Schedules) ทุก 15 นาที:
//   */15 * * * *   → POST ไปที่ฟังก์ชันนี้ พร้อม header x-cron-secret: <CRON_SECRET>
//
// ทำไม Telegram: ส่งข้อความไม่จำกัดและไม่มีค่าใช้จ่าย ต่างจาก LINE OA ที่จำกัดโควตาต่อเดือน
//           (LINE Notify เองก็ปิดบริการไปแล้ว มี.ค. 2025)
//           ช่อง channel ในกฎเก็บเป็น 'telegram:<chat_id>'
//           chat_id เป็นบวก = แชทส่วนตัว · เป็นลบ (-100...) = กลุ่ม/แชนแนล
//           วิธีได้ chat_id: ทักบอท (หรือเชิญบอทเข้ากลุ่ม) แล้วเปิด
//           https://api.telegram.org/bot<TOKEN>/getUpdates จะเห็น message.chat.id

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; // ข้าม RLS ได้ (เขียน alert_log)
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const SITE = Deno.env.get("SITE_URL") ?? "https://waterchaidantai.com";

// API สาธารณะเดียวกับที่หน้าเว็บใช้
const TW_API = "https://api-v3.thaiwater.net/api/v1/thaiwater30";
// รหัสจังหวัด 5 จังหวัดชายแดนใต้ (ตรงกับ PROV_CODE ในหน้าเว็บ)
const PROV_CODE: Record<string, number> = {
  "สตูล": 91, "สงขลา": 90, "ปัตตานี": 94, "ยะลา": 95, "นราธิวาส": 96,
};

interface Rule {
  id: string; label: string | null; station_code: string | null;
  province: string | null; metric: string; threshold: number;
  channel: string; cooldown_min: number; enabled: boolean;
}

Deno.serve(async (req: Request) => {
  // อนุญาตเฉพาะผู้เรียกที่มี secret (ตัวตั้งเวลา) เท่านั้น
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!TG_TOKEN) {
    return new Response("TELEGRAM_BOT_TOKEN not set", { status: 500 });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 1) ดึงกฎที่เปิดอยู่
  const { data: rules, error } = await sb
    .from("alert_rules").select("*").eq("enabled", true);
  if (error) return json({ error: error.message }, 500);
  if (!rules?.length) return json({ ok: true, checked: 0, fired: 0 });

  // 2) ดึงข้อมูลระดับน้ำรายจังหวัด (cache ในรอบนี้)
  const provinces = [...new Set(rules.map((r: Rule) => r.province).filter(Boolean))] as string[];
  const wlByProv: Record<string, any[]> = {};
  await Promise.all(provinces.map(async (p) => {
    const code = PROV_CODE[p];
    if (!code) return;
    try {
      const j = await fetch(`${TW_API}/public/waterlevel?province_code=${code}`).then((r) => r.json());
      wlByProv[p] = Array.isArray(j?.data) ? j.data : [];
    } catch { wlByProv[p] = []; }
  }));

  let fired = 0;
  for (const rule of rules as Rule[]) {
    // cooldown: มีการยิงกฎนี้ภายใน cooldown_min นาทีล่าสุดไหม
    const since = new Date(Date.now() - rule.cooldown_min * 60_000).toISOString();
    const { count } = await sb.from("alert_log")
      .select("id", { count: "exact", head: true })
      .eq("rule_id", rule.id).gte("fired_at", since);
    if ((count ?? 0) > 0) continue;

    const hit = evaluateRule(rule, wlByProv[rule.province ?? ""] ?? []);
    if (!hit) continue;

    const msg = buildMessage(rule, hit);
    const ok = await sendTelegram(rule.channel, msg);
    await sb.from("alert_log").insert({
      rule_id: rule.id,
      payload: { value: hit.value, station: hit.station, message: msg, channel: rule.channel, sent: ok },
    });
    if (ok) fired++;
  }

  return json({ ok: true, checked: rules.length, fired });
});

// ประเมินกฎกับชุดข้อมูลระดับน้ำของจังหวัด → คืน {value, station} ถ้าเข้าเงื่อนไข
function evaluateRule(rule: Rule, rows: any[]): { value: number; station: string } | null {
  const match = (d: any) => {
    const code = d?.station?.tele_station_oldcode ?? "";
    return !rule.station_code || code === rule.station_code;
  };
  for (const d of rows.filter(match)) {
    const st = d.station || {};
    const name = `${st.tele_station_oldcode ?? ""} ${cleanName(st.tele_station_name)}`.trim();
    let v: number | null = null;
    if (rule.metric === "wl_pct_bank") v = numOrNull(d.storage_percent);
    else if (rule.metric === "rain_24h") v = numOrNull(d.rain_24h ?? d.rain24h);
    if (v != null && v >= rule.threshold) return { value: v, station: name || (rule.province ?? "") };
  }
  return null;
}

function buildMessage(rule: Rule, hit: { value: number; station: string }): string {
  const unit = rule.metric === "wl_pct_bank" ? "% ของตลิ่ง" : "มม./24 ชม.";
  const level = hit.value >= 100 ? "🔴 [ล้นตลิ่ง]" : hit.value >= 90 ? "🟠 [เฝ้าระวังสูง]" : "🟡 [เฝ้าระวัง]";
  const link = `${SITE}/map.html`;
  return `${level} ${hit.station}\nค่า ${round1(hit.value)} ${unit} (เกณฑ์ ${rule.threshold})\nดูสด: ${link}`;
}

async function sendTelegram(channel: string, text: string): Promise<boolean> {
  // channel = 'telegram:<chat_id>' — chat_id บวก = แชทส่วนตัว · ลบ (-100...) = กลุ่ม/แชนแนล
  const to = channel.startsWith("telegram:") ? channel.slice("telegram:".length).trim() : null;
  if (!to) return false; // รองรับเฉพาะช่องทาง telegram: ในฉบับนี้
  try {
    // ส่งเป็นข้อความเปล่า ไม่ใช้ parse_mode เพราะชื่อสถานีมี _ * [ ] ปนได้
    // ถ้าใช้ Markdown แล้วไม่ escape ให้ครบ Telegram จะตีกลับทั้งข้อความ
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: to, text, disable_web_page_preview: true }),
    });
    // ที่พลาดบ่อยคือผู้ใช้บล็อกบอท หรือ chat_id ผิด — ต้องเห็นสาเหตุใน log ของฟังก์ชัน
    // ไม่งั้นเวลาน้ำมาจริงแล้วข้อความไม่ถึง จะไล่หาสาเหตุไม่ได้
    if (!res.ok) console.error("telegram sendMessage failed", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (e) { console.error("telegram sendMessage error", e); return false; }
}

// helpers
function numOrNull(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}
function round1(n: number): number { return Math.round(n * 10) / 10; }
function cleanName(s: unknown): string { return String(s ?? "").replace(/^สถานี\s*/, "").trim(); }
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
