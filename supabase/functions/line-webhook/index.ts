// supabase/functions/line-webhook/index.ts
//
// Deno Edge Function — รับ webhook จาก LINE Messaging API (บัญชี LINE OA ของ NaraFlood)
// ผู้ใช้กดเมนู/พิมพ์/ส่งตำแหน่ง → ตอบด้วย Reply API (ไม่นับโควตา 300 ข้อความ/เดือนของแผนฟรี)
// LINE นี้ "ตอบเมื่อถาม" เท่านั้น การเตือนอัตโนมัติถึงทุกคนยังอยู่ที่ Telegram (ดู LINE-OA-PLAN.md ข้อ 1)
// ตรรกะทั้งหมดอยู่ใน core.mjs (ทดสอบด้วย node --test line-oa/test/) ไฟล์นี้เป็นแค่ขอบนอก
//
// Deploy:
//   supabase functions deploy line-webhook --no-verify-jwt
//   supabase secrets set LINE_CHANNEL_SECRET=<Channel secret>  LINE_CHANNEL_ACCESS_TOKEN=<long-lived token>
//   ตั้ง Webhook URL: node line-oa/setup-richmenu.mjs --webhook  (หรือวางในคอนโซล LINE เอง · ดู DEPLOY.md ข้อ 4)
//
// หมายเหตุ:
// - ตอบ LINE ด้วย 200 เสมอ ยกเว้นลายเซ็นไม่ตรง (401) แบบเดียวกับ telegram-webhook
// - ต้องตอบให้จบก่อนคืน response เพราะ reply token ใช้ได้ครั้งเดียวและหมดอายุเร็ว
// - ไม่บันทึกข้อความหรือตำแหน่งของผู้ใช้ไว้ที่ใด · userId ถูกอ่าน/ปิดเฉพาะในกฎ alert_rules ที่เจ้าหน้าที่ตั้งให้

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleEvent, verifySignature } from "./core.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("LINE_CHANNEL_SECRET");
const TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
const SITE = (Deno.env.get("SITE_URL") ?? "https://naraflood.com").replace(/\/+$/, "");
const HOME_URL = Deno.env.get("HOME_PROXY_URL") ??
  "https://home-proxy.newusmanwaji.workers.dev/home.json?parts=ddpm,trends";
const SHELTERS_URL = `${SITE}/data/shelters-ddpm.json`;
const FETCH_MS = 5000;

// แคชใน isolate: home-proxy อัปเดต ปภ. ทุก 5 นาที · ศูนย์พักพิงอัปเดตไม่กี่ครั้งต่อวัน
const cache: Record<string, { t: number; v: unknown }> = {};
async function cachedJson(url: string, ttlMs: number) {
  const hit = cache[url];
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const v = await r.json();
    cache[url] = { t: Date.now(), v };
    return v;
  } catch (e) {
    console.error("fetch failed", url, String(e));
    return hit?.v ?? null; // ดึงไม่ได้ ใช้ชุดเดิมที่เคยได้ (ถ้ามี) ดีกว่าเงียบ
  }
}

let sb: ReturnType<typeof createClient> | null = null;
const db = () => (sb ??= createClient(SUPABASE_URL, SERVICE_ROLE));

const deps = {
  now: () => Date.now(),
  site: SITE,
  getHome: () => cachedJson(HOME_URL, 60e3),
  getShelters: () => cachedJson(SHELTERS_URL, 15 * 60e3),
  listRules: async (channel: string) => {
    const { data } = await db().from("alert_rules").select("station_code,province,metric,threshold,enabled").eq("channel", channel);
    return data ?? [];
  },
  disableRules: async (channel: string) => {
    const { data } = await db().from("alert_rules").update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("channel", channel).eq("enabled", true).select("id");
    return data?.length ?? 0;
  },
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });
  if (!SECRET || !TOKEN) return new Response("OK", { status: 200 }); // ยังไม่ได้ตั้ง secrets — เงียบไว้

  const raw = new Uint8Array(await req.arrayBuffer());
  if (!(await verifySignature(raw, req.headers.get("x-line-signature"), SECRET))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let events: unknown[] = [];
  try { events = JSON.parse(new TextDecoder().decode(raw))?.events ?? []; } catch { /* body เสีย → ตอบ 200 เฉย ๆ */ }

  // ปุ่ม Verify ในคอนโซลส่ง events ว่าง → ตอบ 200 ทันที
  await Promise.all(events.map(async (ev) => {
    try {
      const out = await handleEvent(ev, deps);
      if (out) await lineReply(out.replyToken, out.messages);
    } catch (e) { console.error("line-webhook event error", e); }
  }));
  return new Response("OK", { status: 200 });
});

async function lineReply(replyToken: string, messages: unknown[]) {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ replyToken, messages }),
      signal: AbortSignal.timeout(FETCH_MS),
    });
    // พลาดบ่อย: token หมดอายุ/ผิด (401) · reply token หมดอายุ (400) · JSON ข้อความผิดรูป (400)
    if (!res.ok) console.error("line reply failed", res.status, await res.text().catch(() => ""));
  } catch (e) { console.error("line reply error", e); }
}
