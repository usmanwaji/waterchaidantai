// supabase/functions/line-webhook/index.ts
//
// Deno Edge Function — รับ webhook จาก LINE Messaging API (บัญชี LINE OA แผนฟรี)
// LINE ใช้เป็น "ประตูหน้า" ให้ชาวบ้านถามสถานการณ์แล้วได้คำตอบทันทีด้วย Reply
// ซึ่งไม่นับโควตา 300 ข้อความ/เดือนของแผนฟรี · การเตือนอัตโนมัติถึงทุกคนยังเป็นหน้าที่ของ
// Telegram (@NaraFloodbot) ตามเดิม (เหตุผลเต็มใน LINE-OA-PLAN.md)
//
// ตรรกะทั้งหมดอยู่ใน bot.mjs เพื่อให้ทดสอบด้วย node --test ได้ (line-oa/test/)
// ไฟล์นี้แค่อ่าน secrets แล้วส่งต่อ
//
// Deploy:
//   supabase secrets set LINE_CHANNEL_SECRET=<channel secret>
//   supabase secrets set LINE_CHANNEL_ACCESS_TOKEN=<long-lived token>
//   supabase functions deploy line-webhook --no-verify-jwt
//   Webhook URL ในคอนโซล LINE: https://<project>.supabase.co/functions/v1/line-webhook
//
// ตอบ 200 เสมอ ยกเว้นลายเซ็น X-Line-Signature ไม่ตรง (401) ซึ่งแปลว่าไม่ใช่คำขอจาก LINE
// เฟสนี้ไม่แตะฐานข้อมูลและไม่บันทึกข้อความหรือตำแหน่งของผู้ใช้

import { makeHandler } from "./bot.mjs";

Deno.serve(makeHandler({
  channelSecret: Deno.env.get("LINE_CHANNEL_SECRET"),
  accessToken: Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN"),
  siteUrl: Deno.env.get("SITE_URL") ?? "https://naraflood.com",
}));
