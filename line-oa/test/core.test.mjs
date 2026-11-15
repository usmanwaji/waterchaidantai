// ทดสอบตรรกะบอท LINE OA (supabase/functions/line-webhook/core.mjs) โดยไม่ต้องมี LINE จริง
// รัน: node --test line-oa/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import * as core from "../../supabase/functions/line-webhook/core.mjs";

const here = new URL(".", import.meta.url);
const load = (p) => JSON.parse(readFileSync(new URL(p, here), "utf8"));
const HOME = load("fixtures/home.json");                 // home-proxy จริง 15 พ.ย. 2569 20:48 น.
const SHELTERS = load("../../data/shelters-ddpm.json");  // ไฟล์เดียวกับที่เว็บใช้
const NOW = HOME.now;
const SITE = "https://naraflood.com";
const clone = (x) => structuredClone(x);
const st = (home, code) => home.parts.ddpm.d.data.find((d) => d.code === code);

/* ---------- ลายเซ็น ---------- */
test("signature: ถูก / ผิด / ไม่มี header / body อักษรไทย", async () => {
  const secret = "test-secret";
  const body = JSON.stringify({ events: [{ type: "message", message: { type: "text", text: "สถานการณ์น้ำ ตอนนี้" } }] });
  const sig = createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("base64");
  assert.equal(await core.verifySignature(new TextEncoder().encode(body), sig, secret), true);
  assert.equal(await core.verifySignature(body, sig, secret), true);
  assert.equal(await core.verifySignature(body + " ", sig, secret), false);
  assert.equal(await core.verifySignature(body, sig, "other"), false);
  assert.equal(await core.verifySignature(body, null, secret), false);
  assert.equal(await core.verifySignature(body, sig, ""), false);
});

/* ---------- คำสั่ง ---------- */
test("matchCommand ทุกแถวของตาราง", () => {
  const cases = {
    "สถานการณ์น้ำ": "status", "ระดับน้ำตอนนี้": "status", "น้ำท่วมไหม": "status",
    "ศูนย์พักพิง": "shelter", "จะอพยพไปไหน": "shelter", "ที่จอดรถ": "shelter",
    "ใกล้ฉัน": "near", "บ้านฉันเป็นยังไง": "near",
    "ฝน": "rain", "พยากรณ์อากาศ": "rain",
    "ช่วยเหลือ": "help", "SOS": "help", "ขอความช่วยเหลือน้ำท่วม": "help", "1784": "help",
    "เตือน": "alert", "อยากได้แจ้งเตือนน้ำ": "alert", "Telegram": "alert",
    "สถานะ": "me", "id": "me", "ID": "me",
    "หยุด": "stop", "ยกเลิกการแจ้งเตือน": "stop",
    "สวัสดีครับ": null, "": null, "   ": null, "android": null,
  };
  for (const [t, want] of Object.entries(cases)) assert.equal(core.matchCommand(t), want, t);
});

/* ---------- สถานการณ์ ---------- */
test("status จากข้อมูลจริง ตรงกับหน้าแรก ณ เวลาเดียวกัน", () => {
  const t = core.buildStatus(HOME, NOW, SITE);
  // ณ เวลานั้น NWT06 ท่าเรือ(เก่า) ปภ. ประกาศ "เตรียมรับมือ" (ระดับ 3) ต่ำกว่าตลิ่ง 0.29 ม. น้ำขึ้น 36 ซม.
  assert.match(t, /^🟠 นราธิวาส: น้ำใกล้ตลิ่ง 1 สถานี/);
  assert.match(t, /ล้นตลิ่ง 0 · ใกล้ตลิ่ง 1 · ปกติ 9 \(สถานีวัดน้ำ ปภ\. 10 แห่ง\)/);
  assert.match(t, /ท่าเรือ\(เก่า\) ยะกัง2 อ\.เมืองนราธิวาส\n   ต่ำกว่าตลิ่ง 0\.29 ม\. · ↑ กำลังขึ้น · ปภ\.: เตรียมรับมือ/);
  assert.match(t, /ดูแผนที่สด: https:\/\/naraflood\.com\/map\.html/);
  assert.match(t, /ข้อมูล ปภ\. ณ 20:45 น\.$/);
  assert.ok(!t.includes("ไม่ล่าสุด"));
});

test("status: มีสถานีล้นตลิ่ง → หัวแดง เรียงล้นก่อน", () => {
  const h = clone(HOME);
  st(h, "NWT09").currentWaterLevel = 9.1;   // ตลิ่ง 8.752
  const t = core.buildStatus(h, NOW, SITE);
  assert.match(t, /^🔴 นราธิวาส: น้ำล้นตลิ่ง 1 สถานี/);
  assert.match(t, /ล้นตลิ่ง 1 · ใกล้ตลิ่ง 1 · ปกติ 8/);
  assert.ok(t.indexOf("ท่าประปา") < t.indexOf("ท่าเรือ(เก่า)"));
  assert.match(t, /สูงกว่าตลิ่ง 0\.35 ม\./);
});

test("status: ทุกสถานีปกติ → บอกสถานีที่ใกล้ตลิ่งที่สุด", () => {
  const h = clone(HOME);
  st(h, "NWT06").waterLevelStatus = 1;
  // ขึ้น 3 ลด 1 → ตรงกฎหน้าแรก (ขึ้นมากกว่าลด และขึ้น ≥ 2) = "กำลังเพิ่มระดับ"
  let t = core.buildStatus(h, NOW, SITE);
  assert.match(t, /^🟡 นราธิวาส: น้ำกำลังเพิ่มระดับ/);
  assert.match(t, /ทิศทาง: ขึ้น 3 · ลด 1 · ทรงตัว 6/);
  assert.match(t, /สถานีที่ใกล้ตลิ่งที่สุด\n🟡 ท่าเรือ\(เก่า\)/);
  h.parts.trends.d.ddpm = {};
  t = core.buildStatus(h, NOW, SITE);
  assert.match(t, /^🟢 นราธิวาส: น้ำยังปกติ/);
  assert.match(t, /สถานีที่ใกล้ตลิ่งที่สุด\n🟢 ท่าเรือ\(เก่า\)/);
});

test("status: status===0, ตลิ่ง 0/null, ค่าเก่า → ไม่นับเป็นสถานการณ์", () => {
  const h = clone(HOME);
  st(h, "NWT06").status = 0;                          // ไม่มีข้อมูล → ระดับ ปภ. ไม่ใช้
  st(h, "NWT01").riverBankLevel = 0;
  st(h, "NWT02").riverBankLevel = null;
  st(h, "NWT03").updatedAt = "2026-11-14T08:00:00";   // เก่ากว่า 6 ชม.
  const t = core.buildStatus(h, NOW, SITE);
  assert.match(t, /ใกล้ตลิ่ง 0 /);
  assert.ok(!t.includes("ปภ.: "), "status 0 ต้องไม่แสดงป้ายระดับ ปภ.");
  assert.match(t, /ปกติ 9 \(สถานีวัดน้ำ ปภ\. 9 แห่ง\)/);
  const s = core.ddpmStations(h, NOW);
  assert.equal(s.find((x) => x.code === "NWT01").fb, null);
  assert.equal(s.find((x) => x.code === "NWT03").lvl, "na");
});

test("status: ดึงข้อมูลไม่ได้ / ข้อมูลเก่า", () => {
  const h = clone(HOME); h.parts.ddpm.d = null;
  assert.match(core.buildStatus(h, NOW, SITE), /ดึงข้อมูลสดไม่ได้/);
  assert.match(core.buildStatus({}, NOW, SITE), /ดึงข้อมูลสดไม่ได้/);
  const old = clone(HOME); old.parts.ddpm.s = 1;
  assert.match(core.buildStatus(old, NOW, SITE), /ข้อมูลอาจไม่ล่าสุด/);
  assert.match(core.buildStatus(HOME, NOW + 45 * 60e3, SITE), /ข้อมูลอาจไม่ล่าสุด/);
});

/* ---------- ใกล้ฉัน ---------- */
test("near: ในเมืองนราธิวาส", () => {
  const t = core.buildNear(6.4255, 101.8253, HOME, SHELTERS, NOW, SITE);
  assert.match(t, /^📍 สถานีวัดน้ำใกล้คุณ\n🟠 ท่าเรือ\(เก่า\)/);
  assert.match(t, /🏠 ศูนย์พักพิงใกล้คุณ/);
  assert.equal((t.match(/^• /gm) || []).length, 3);
  assert.match(t, /google\.com\/maps\/dir\/\?api=1&destination=/);
  assert.match(t, /check\.html/);
});

test("near: สุไหงโก-ลก ได้สถานีโก-ลก", () => {
  const t = core.buildNear(6.0275, 101.9653, HOME, SHELTERS, NOW, SITE);
  const first = t.split("\n")[1];
  assert.match(first, /สุไหงโก-ลก/);
});

test("near: กรุงเทพฯ อยู่นอกพื้นที่", () => {
  assert.match(core.buildNear(13.7563, 100.5018, HOME, SHELTERS, NOW, SITE), /นอกพื้นที่/);
});

test("near: ศูนย์ที่เปิดอยู่ในรัศมีขึ้นก่อน", () => {
  const list = [
    { name: "A", km: 1, active: false }, { name: "B", km: 8, active: true },
    { name: "C", km: 2, active: false }, { name: "D", km: 40, active: true },
  ];
  assert.deepEqual(core.pickShelters(list, 3).map((s) => s.name), ["B", "A", "C"]);
});

test("near: ไม่มีข้อมูลศูนย์ / ตำแหน่งเสีย", () => {
  assert.match(core.buildNear(6.4255, 101.8253, HOME, null, NOW, SITE), /ดึงรายชื่อศูนย์พักพิงไม่ได้/);
  assert.match(core.buildNear("x", null, HOME, SHELTERS, NOW, SITE), /อ่านตำแหน่งไม่ได้/);
});

/* ---------- ทั้งเส้น: handleEvent ---------- */
function makeDeps(over = {}) {
  const calls = { disabled: [] };
  return {
    calls,
    deps: {
      now: () => NOW, site: SITE,
      getHome: async () => HOME, getShelters: async () => SHELTERS,
      listRules: async () => [{ station_code: "NWT06", province: "นราธิวาส", metric: "wl_pct_bank", threshold: 90, enabled: true }],
      disableRules: async (ch) => { calls.disabled.push(ch); return 1; },
      ...over,
    },
  };
}
const userEv = (extra) => ({ replyToken: "rt", source: { type: "user", userId: "U0123456789abcdef0123456789abcdef" }, deliveryContext: { isRedelivery: false }, ...extra });
const textEv = (t) => userEv({ type: "message", message: { type: "text", text: t } });

function checkReply(out) {
  assert.ok(out, "ต้องมีคำตอบ");
  assert.equal(out.replyToken, "rt");
  assert.ok(out.messages.length >= 1 && out.messages.length <= 5);
  for (const m of out.messages) {
    assert.equal(m.type, "text");
    assert.ok(m.text.length > 0 && m.text.length <= 5000);
    const items = m.quickReply.items;
    assert.ok(items.length <= 13);
    for (const it of items) assert.ok([...(it.action.label || "")].length <= 20, it.action.label);
  }
  return out.messages[0].text;
}

test("handleEvent: follow / ข้อความทุกคำสั่ง / ตำแหน่ง / สติกเกอร์", async () => {
  const { deps } = makeDeps();
  assert.match(checkReply(await core.handleEvent(userEv({ type: "follow" }), deps)), /สวัสดีครับ/);
  const expect = {
    "สถานการณ์น้ำ": /น้ำใกล้ตลิ่ง 1 สถานี/, "ศูนย์พักพิง": /ส่งตำแหน่ง/, "ใกล้ฉัน": /check\.html/,
    "ฝน": /forecast\.html/, "ช่วยเหลือ": /1784/, "เตือน": /t\.me\/NaraFloodbot/,
    "สถานะ": /U0123456789abcdef0123456789abcdef[\s\S]*|NWT06/, "หยุด": /ยกเลิกรับแจ้งเตือน/, "อะไรก็ได้": /พิมพ์หรือแตะปุ่ม/,
  };
  for (const [t, re] of Object.entries(expect)) assert.match(checkReply(await core.handleEvent(textEv(t), deps)), re, t);
  const me = checkReply(await core.handleEvent(textEv("สถานะ"), deps));
  assert.match(me, /NWT06 ≥ 90% ของตลิ่ง/);
  assert.match(me, /U0123456789abcdef0123456789abcdef/);
  const loc = await core.handleEvent(userEv({ type: "message", message: { type: "location", latitude: 6.4255, longitude: 101.8253 } }), deps);
  assert.match(checkReply(loc), /ศูนย์พักพิงใกล้คุณ/);
  const stk = await core.handleEvent(userEv({ type: "message", message: { type: "sticker" } }), deps);
  assert.match(checkReply(stk), /พิมพ์หรือแตะปุ่ม/);
  const pb = await core.handleEvent(userEv({ type: "postback", postback: { data: "cmd=status" } }), deps);
  assert.match(checkReply(pb), /นราธิวาส/);
});

test("handleEvent: unfollow ปิดกฎ ไม่ตอบ · กลุ่ม/ส่งซ้ำ ไม่ตอบ", async () => {
  const { deps, calls } = makeDeps();
  assert.equal(await core.handleEvent(userEv({ type: "unfollow", replyToken: undefined }), deps), null);
  assert.deepEqual(calls.disabled, ["line:U0123456789abcdef0123456789abcdef"]);
  assert.equal(await core.handleEvent({ ...textEv("น้ำ"), source: { type: "group", groupId: "C1" } }, deps), null);
  assert.equal(await core.handleEvent({ ...textEv("น้ำ"), deliveryContext: { isRedelivery: true } }, deps), null);
  assert.equal(await core.handleEvent(null, deps), null);
});

test("handleEvent: ข้อมูลภายนอกล่ม ยังตอบเสมอ ไม่เงียบ", async () => {
  const boom = async () => { throw new Error("down"); };
  const { deps } = makeDeps({ getHome: boom, getShelters: boom, listRules: boom, disableRules: boom });
  for (const t of ["สถานการณ์น้ำ", "สถานะ", "หยุด"]) assert.ok(checkReply(await core.handleEvent(textEv(t), deps)), t);
  const loc = await core.handleEvent(userEv({ type: "message", message: { type: "location", latitude: 6.4, longitude: 101.8 } }), deps);
  assert.match(checkReply(loc), /ดึงข้อมูลสดไม่ได้/);
});
