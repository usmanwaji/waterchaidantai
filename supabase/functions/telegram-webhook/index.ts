// supabase/functions/telegram-webhook/index.ts
//
// Deno Edge Function — รับ webhook จาก Telegram Bot API
// ทำให้ประชาชนสมัครรับแจ้งเตือนน้ำได้เอง (กด /start แล้วเลือกระดับ) โดยไม่ต้อง
// พึ่งเจ้าหน้าที่คอยเปิด getUpdates อ่าน chat id ให้เหมือนที่ทำอยู่ตอนนี้
//
// ขอบเขตที่ตั้งใจ: สมัครได้ระดับ "ทั้งจังหวัดนราธิวาส" เท่านั้น (ไม่มีเลือกรายอำเภอ)
// เพราะ evaluateRule() ใน notify-water จับคู่กฎด้วย province หรือ station_code
// ที่แน่นอนเท่านั้น ไม่เคยอ่าน geocode.amphoe_name เลย — ถ้าทำปุ่มเลือกอำเภอ
// ตรงนี้จะได้กฎที่หน้าตาดูถูกต้องแต่เครื่องยนต์แจ้งเตือนไม่มีทางกรองได้จริง
// ผู้ที่อยากได้แจ้งเตือนเฉพาะสถานีเดียว ยังใช้ alert.html (สมาชิกอนุมัติ) ได้ตามเดิม
//
// Deploy:
//   supabase functions deploy telegram-webhook --no-verify-jwt
//   supabase secrets set TELEGRAM_BOT_TOKEN=<token เดียวกับ notify-water>
//   supabase secrets set TELEGRAM_WEBHOOK_SECRET=<สุ่มสตริงยาว ๆ เอง>
//   ตั้ง webhook ครั้งเดียว (ดูคำสั่งเต็มใน DEPLOY.md):
//   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
//     -d url=https://<project>.supabase.co/functions/v1/telegram-webhook \
//     -d secret_token=<TELEGRAM_WEBHOOK_SECRET>
//
// หมายเหตุ: ตอบ Telegram ด้วย 200 เสมอไม่ว่าข้างในจะสำเร็จหรือพัง
// เพราะ Telegram จะ retry ซ้ำ ๆ ถ้าไม่ได้ 200 กลับไป ซึ่งจะยิ่งเพิ่มโอกาสพังซ้อนพัง
// ข้อยกเว้นเดียวคือ secret token ไม่ตรง (401) — แปลว่าไม่ใช่คำขอจาก Telegram จริง

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;

const PROVINCE = "นราธิวาส";
const METRIC = "wl_pct_bank";
const COOLDOWN_MIN = 180;

// ตัวเลือกระดับความไวของการแจ้งเตือน (% ของตลิ่ง) — ตรงกับเกณฑ์ที่หน้าเว็บใช้อยู่แล้ว
// (ดู js/criteria.js: PCT_HIGH=85 คือ "ใกล้ตลิ่ง เฝ้าระวัง", >=100 คือ "ล้นตลิ่งแล้ว")
const LEVELS: Record<string, { threshold: number; label: string }> = {
  "85": { threshold: 85, label: "เฝ้าระวัง (≥85% ของตลิ่ง)" },
  "100": { threshold: 100, label: "เฉพาะล้นตลิ่งแล้ว (100%)" },
};

const HELP_TEXT =
  "คำสั่งที่ใช้ได้:\n" +
  "/start — สมัคร/แก้ไขระดับการแจ้งเตือน\n" +
  "/status — ดูสถานะการสมัครของคุณ\n" +
  "/stop — ยกเลิกรับแจ้งเตือน";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  // ป้องกันคนอื่นยิง POST มาปลอมเป็น Telegram — ต้องตั้งค่า secret_token ตอน setWebhook ด้วย
  if (WEBHOOK_SECRET && req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!TG_TOKEN) return new Response("OK", { status: 200 }); // ยังไม่ได้ตั้งค่า token — เงียบไว้ ไม่ใช่ error ของผู้ใช้

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const update = await req.json();
    if (update.message?.text) {
      await handleMessage(sb, update.message);
    } else if (update.callback_query) {
      await handleCallback(sb, update.callback_query);
    }
  } catch (e) {
    console.error("telegram-webhook error", e);
  }
  return new Response("OK", { status: 200 }); // เสมอ 200 กัน Telegram retry ซ้ำ
});

async function handleMessage(sb: any, msg: any) {
  const chatId = msg.chat?.id;
  const text = String(msg.text || "").trim();
  if (chatId == null) return;

  if (text === "/start") {
    await tgSend(chatId,
      `สวัสดีครับ 👋 บอทนี้แจ้งเตือนเมื่อระดับน้ำในสถานีวัดของ จ.${PROVINCE} ใกล้ล้นตลิ่ง\n\n` +
      "เลือกระดับความไวที่ต้องการ:",
      levelsKeyboard());
    return;
  }
  if (text === "/stop") {
    const n = await disableRules(sb, channelOf(chatId));
    await tgSend(chatId, n > 0
      ? "ยกเลิกรับแจ้งเตือนแล้ว · พิมพ์ /start ใหม่ได้ทุกเมื่อ"
      : "คุณยังไม่ได้สมัครรับแจ้งเตือนอยู่ก่อนแล้วครับ");
    return;
  }
  if (text === "/status") {
    const rule = await findRule(sb, channelOf(chatId));
    const state = rule
      ? (rule.enabled
        ? `กำลังรับแจ้งเตือน จ.${PROVINCE} ที่ระดับ ≥${rule.threshold}% ของตลิ่ง\nพิมพ์ /stop เพื่อยกเลิก`
        : "คุณเคยสมัครไว้แต่ปิดรับแจ้งเตือนอยู่ · พิมพ์ /start เพื่อเปิดใหม่")
      : "คุณยังไม่ได้สมัครรับแจ้งเตือน · พิมพ์ /start เพื่อสมัคร";
    // แสดง chat id ทุกครั้งที่ถาม /status เพื่อให้เจ้าหน้าที่ตั้งกฎเฉพาะสถานีให้ได้
    // โดยไม่ต้องเปิด getUpdates เอง — ผู้ใช้แค่พิมพ์ /status แล้วคัดลอกเลขนี้ไปแจ้งเอง
    await tgSend(chatId, `${state}\n\nchat id ของคุณ: ${chatId}`);
    return;
  }
  await tgSend(chatId, HELP_TEXT);
}

async function handleCallback(sb: any, cq: any) {
  const chatId = cq.message?.chat?.id;
  const data = String(cq.data || "");
  if (chatId == null || !data.startsWith("sub:")) {
    await tgAnswerCallback(cq.id);
    return;
  }
  const level = LEVELS[data.slice("sub:".length)];
  if (!level) { await tgAnswerCallback(cq.id, "ตัวเลือกไม่ถูกต้อง"); return; }

  await upsertRule(sb, channelOf(chatId), level.threshold);
  await tgAnswerCallback(cq.id, "สมัครสำเร็จ");
  await tgSend(chatId,
    `สมัครรับแจ้งเตือนแล้ว ✅\nระดับ: ${level.label}\nครอบคลุม: สถานีน้ำทุกแห่งใน จ.${PROVINCE}\n\n` +
    "พิมพ์ /start ใหม่เพื่อเปลี่ยนระดับ หรือ /stop เพื่อยกเลิก");
}

const channelOf = (chatId: number | string) => `telegram:${chatId}`;

function levelsKeyboard() {
  return {
    inline_keyboard: Object.entries(LEVELS).map(([key, v]) => (
      [{ text: v.label, callback_data: `sub:${key}` }]
    )),
  };
}

// หากฎที่สมัครไว้แล้ว (ไม่ว่าจะเปิดหรือปิดอยู่) ของช่องทางนี้ในจังหวัดนี้
async function findRule(sb: any, channel: string) {
  const { data } = await sb.from("alert_rules").select("*")
    .eq("channel", channel).eq("province", PROVINCE).eq("metric", METRIC)
    .limit(1).maybeSingle();
  return data as { id: string; threshold: number; enabled: boolean } | null;
}

// สมัครใหม่ หรือถ้าเคยสมัคร/เคยยกเลิกไว้ก่อนหน้านี้ ก็แก้ระดับ+เปิดใช้งานใหม่แทนที่จะสร้างแถวซ้ำ
async function upsertRule(sb: any, channel: string, threshold: number) {
  const existing = await findRule(sb, channel);
  if (existing) {
    await sb.from("alert_rules").update({ threshold, enabled: true, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await sb.from("alert_rules").insert({
      label: "สมัครผ่านบอท Telegram", station_code: null, province: PROVINCE,
      metric: METRIC, threshold, channel, cooldown_min: COOLDOWN_MIN, enabled: true,
    });
  }
}

async function disableRules(sb: any, channel: string): Promise<number> {
  const { data } = await sb.from("alert_rules").update({ enabled: false, updated_at: new Date().toISOString() })
    .eq("channel", channel).eq("enabled", true).select("id");
  return data?.length ?? 0;
}

async function tgSend(chatId: number | string, text: string, replyMarkup?: unknown) {
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup, disable_web_page_preview: true }),
    });
  } catch (e) { console.error("tgSend failed", e); }
}

async function tgAnswerCallback(callbackQueryId: string, text?: string) {
  try {
    await fetch(`${TG_API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  } catch (e) { console.error("tgAnswerCallback failed", e); }
}
