import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  verifySignature, matchCommand, postbackCommand, parseStations, statusText, nearText,
  makeHandler, COMMANDS, thaiClock,
} from "../../supabase/functions/line-webhook/bot.mjs";

const HOME = JSON.parse(readFileSync(new URL("./fixtures/home.json", import.meta.url), "utf8"));
const SHELTERS = JSON.parse(readFileSync(new URL("../../data/shelters-ddpm.json", import.meta.url), "utf8"));
const SHELTER_ROWS = SHELTERS.features.map((f) => f.attributes);
const NOW = HOME.parts.ddpm.t + 60_000;
const SITE = "https://naraflood.com";
const SECRET = "test-channel-secret";
const TOKEN = "test-access-token";

const PLACES = {
  narathiwat: [6.4255, 101.8253],
  kolok: [6.0297, 101.9650],
  bangkok: [13.7563, 100.5018],
};

const clone = (x) => structuredClone(x);
const withRows = (mutate) => {
  const h = clone(HOME);
  mutate(h.parts.ddpm.d.data, h);
  return h;
};
const sign = (body) => createHmac("sha256", SECRET).update(body).digest("base64");

// ------------------------------------------------------------ ลายเซ็น

test("signature: correct, wrong, missing, Thai body", async () => {
  const body = JSON.stringify({ events: [{ message: { text: "สถานการณ์น้ำ ตอนนี้เป็นไง" } }] });
  const bytes = new TextEncoder().encode(body);
  assert.equal(await verifySignature(SECRET, bytes, sign(body)), true);
  assert.equal(await verifySignature(SECRET, bytes, sign(body + " ")), false);
  assert.equal(await verifySignature(SECRET, bytes, null), false);
  assert.equal(await verifySignature("other-secret", bytes, sign(body)), false);
  const reparsed = new TextEncoder().encode(JSON.stringify(JSON.parse(body), null, 1));
  assert.equal(await verifySignature(SECRET, reparsed, sign(body)), false, "must verify raw bytes, not re-serialized JSON");
});

// ------------------------------------------------------------ คำสั่ง

test("every command word routes to its command", () => {
  for (const [cmd, words] of COMMANDS) {
    for (const w of words) {
      const got = matchCommand(`  ${w}  `);
      const earlier = COMMANDS.slice(0, COMMANDS.findIndex(([c]) => c === cmd)).find(([, ws]) => ws.some((x) => w.toLowerCase().includes(x)));
      assert.equal(got, earlier ? earlier[0] : cmd, `"${w}"`);
    }
  }
});

test("commands: typical phrases and no-match", () => {
  assert.equal(matchCommand("สถานการณ์น้ำ"), "status");
  assert.equal(matchCommand("ศูนย์พักพิงใกล้ฉัน"), "shelter");
  assert.equal(matchCommand("ใกล้ฉัน"), "near");
  assert.equal(matchCommand("ฝน"), "rain");
  assert.equal(matchCommand("ช่วยเหลือ"), "help");
  assert.equal(matchCommand("SOS"), "help");
  assert.equal(matchCommand("เตือน"), "alert");
  assert.equal(matchCommand("Telegram"), "alert");
  assert.equal(matchCommand("สถานะ"), "me");
  assert.equal(matchCommand("หยุด"), "stop");
  assert.equal(matchCommand("สวัสดีครับ"), null);
  assert.equal(matchCommand("   "), null);
  assert.equal(postbackCommand("cmd=status"), "status");
  assert.equal(postbackCommand("cmd=drop_tables"), null);
  assert.equal(postbackCommand(""), null);
});

// ------------------------------------------------------------ สถานี

test("live fixture: classification matches the homepage DDPM rule", () => {
  const p = parseStations(HOME, NOW);
  assert.equal(p.stale, false);
  assert.equal(p.stations.length, 10);
  const by = (l) => p.stations.filter((s) => s.lvl === l).map((s) => s.code);
  assert.deepEqual(by("over"), []);
  assert.deepEqual(by("high"), ["NWT06"]);
  assert.equal(by("normal").length, 9);
  const nwt06 = p.stations.find((s) => s.code === "NWT06");
  assert.equal(nwt06.fb.toFixed(2), "0.29");
  assert.equal(nwt06.trend, "flat");
  assert.equal(p.stations.find((s) => s.code === "NWT09").trend, "up");
  assert.equal(p.stations.find((s) => s.code === "NWT10").trend, "down");
});

test("live fixture: status text", () => {
  const t = statusText(parseStations(HOME, NOW), SITE);
  assert.match(t, /^🟠 จ\.นราธิวาส: น้ำใกล้ตลิ่ง 1 สถานี/);
  assert.match(t, /ล้นตลิ่ง 0 · ใกล้ตลิ่ง 1 · ปกติ 9/);
  assert.match(t, /🟠 ท่าเรือ\(เก่า\) ยะกัง2 อ\.เมืองนราธิวาส — อีก 0\.29 ม\. ถึงตลิ่ง → ทรงตัว/);
  assert.match(t, /ดูแผนที่สด: https:\/\/naraflood\.com\/map\.html/);
  assert.match(t, new RegExp(`ข้อมูล ปภ\\. ณ ${thaiClock(HOME.parts.ddpm.t)} น\\.$`));
  console.log("\n--- status (live fixture) ---\n" + t);
});

test("overflow station sorts first, list capped at 5", () => {
  const h = withRows((rows) => {
    rows.forEach((d) => { d.waterLevelStatus = 3; });
    const r = rows.find((d) => d.code === "NWT02");
    r.currentWaterLevel = r.riverBankLevel + 0.4;
  });
  const t = statusText(parseStations(h, NOW), SITE);
  assert.match(t, /^🔴 จ\.นราธิวาส: น้ำล้นตลิ่ง 1 สถานี/);
  assert.match(t, /ล้นตลิ่ง 1 · ใกล้ตลิ่ง 9 · ปกติ 0/);
  const list = t.split("สถานีที่ต้องจับตา\n")[1].split("\n\n")[0].split("\n");
  assert.equal(list.length, 5);
  assert.match(list[0], /^🔴 สะพานข้ามคลองบากง .*สูงกว่าตลิ่ง 0\.40 ม\./);
  const fbs = list.slice(1).map((l) => parseFloat(l.match(/อีก ([\d.]+) ม\./)[1]));
  assert.deepEqual(fbs, [...fbs].sort((a, b) => a - b));
});

test("all normal: names the closest-to-bank station", () => {
  const h = withRows((rows) => rows.forEach((d) => { d.waterLevelStatus = 1; }));
  const t = statusText(parseStations(h, NOW), SITE);
  assert.match(t, /^🟢 จ\.นราธิวาส: ทุกสถานีอยู่ในระดับปกติ/);
  assert.match(t, /สถานีที่ใกล้ตลิ่งที่สุด\n🟢 ท่าเรือ\(เก่า\) ยะกัง2/);
  assert.doesNotMatch(t, /ต้องจับตา/);
});

test("status 0, zero/null bank, stale readings", () => {
  const h = withRows((rows) => {
    rows.find((d) => d.code === "NWT06").status = 0;
    rows.find((d) => d.code === "NWT01").riverBankLevel = 0;
    rows.find((d) => d.code === "NWT02").riverBankLevel = null;
    rows.find((d) => d.code === "NWT03").updatedAt = "2026-11-14T08:00:00";
  });
  const p = parseStations(h, NOW);
  const s = (c) => p.stations.find((x) => x.code === c);
  assert.equal(s("NWT06").lvl, "nodata");
  assert.equal(s("NWT01").bank, null);
  assert.equal(s("NWT01").fb, null);
  assert.equal(s("NWT02").fb, null);
  assert.equal(s("NWT03").lvl, "nodata");
  const t = statusText(p, SITE);
  assert.match(t, /^🟢/);
  assert.match(t, /ไม่มีค่าล่าสุด 2/);
});

test("stale proxy flag or old fetch time says data may be old", () => {
  const h = clone(HOME); h.parts.ddpm.s = 1;
  assert.match(statusText(parseStations(h, NOW), SITE), /ข้อมูลอาจไม่ล่าสุด/);
  assert.match(statusText(parseStations(HOME, NOW + 31 * 60e3), SITE), /ข้อมูลอาจไม่ล่าสุด/);
});

test("ddpm.d null or no fetch: fallback with web link", () => {
  const h = clone(HOME); h.parts.ddpm.d = null;
  assert.equal(parseStations(h, NOW), null);
  assert.equal(statusText(null, SITE), "ตอนนี้ดึงข้อมูลสดไม่ได้ กรุณาดูที่ https://naraflood.com ครับ");
});

// ------------------------------------------------------------ ใกล้ฉัน

test("near: Narathiwat town", () => {
  const t = nearText(...PLACES.narathiwat, parseStations(HOME, NOW), SHELTER_ROWS, SITE);
  assert.match(t, /^สถานีวัดน้ำใกล้คุณ\n🟠 ท่าเรือ\(เก่า\) ยะกัง2 อ\.เมืองนราธิวาส · /);
  assert.match(t, /ใกล้ตลิ่ง \(ปภ\.: เตรียมรับมือ\) · อีก 0\.29 ม\. ถึงตลิ่ง/);
  assert.equal((t.match(/^🏠 /gm) || []).length, 3);
  assert.equal((t.match(/google\.com\/maps\/dir\/\?api=1&destination=/g) || []).length, 3);
  assert.match(t, /check\.html/);
  assert.match(t, /route\.html/);
  console.log("\n--- near (Narathiwat town) ---\n" + t);
});

test("near: Sungai Kolok picks Kolok stations", () => {
  const t = nearText(...PLACES.kolok, parseStations(HOME, NOW), SHELTER_ROWS, SITE);
  const first = t.split("\n")[1];
  assert.match(first, /สุไหงโก-ลก/);
});

test("near: Bangkok is out of area", () => {
  const t = nearText(...PLACES.bangkok, parseStations(HOME, NOW), SHELTER_ROWS, SITE);
  assert.match(t, /ครอบคลุมเฉพาะ จ\.นราธิวาส/);
  assert.doesNotMatch(t, /🏠/);
});

test("near: open shelters come first and show remaining room", () => {
  const rows = SHELTER_ROWS.map((a) => ({ ...a }));
  const far = rows.reduce((m, a) => (a.lat < m.lat ? a : m));
  far.is_active = 1; far.capacity = 200; far.current_residents = 150;
  const t = nearText(...PLACES.narathiwat, parseStations(HOME, NOW), rows, SITE);
  const block = t.split("ศูนย์พักพิงใกล้คุณ\n")[1];
  assert.ok(block.startsWith(`🏠 ${far.name.trim()}`));
  assert.match(block, /เปิดแล้ว · ว่าง 50 ที่/);
});

test("near: missing data degrades to web links", () => {
  const t = nearText(...PLACES.narathiwat, null, null, SITE);
  assert.match(t, /map\.html/);
  assert.match(t, /shelter\.html/);
});

// ------------------------------------------------------------ webhook ทั้งเส้น

function harness({ home = HOME, shelters = SHELTERS, failFetch = false, secret = SECRET } = {}) {
  const replies = [];
  const logs = [];
  const fetch = async (url, init) => {
    url = String(url);
    if (url === "https://api.line.me/v2/bot/message/reply") {
      assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
      replies.push(JSON.parse(init.body));
      return new Response("{}", { status: 200 });
    }
    if (failFetch) throw new Error("network down");
    if (url.startsWith("https://home-proxy.newusmanwaji.workers.dev/home.json")) return { ok: true, json: async () => home };
    if (url === `${SITE}/data/shelters-ddpm.json`) return Response.json(shelters);
    throw new Error(`unexpected fetch ${url}`);
  };
  const handler = makeHandler({ channelSecret: secret, accessToken: TOKEN, siteUrl: SITE, fetch, now: () => NOW, log: (...a) => logs.push(a) });
  const post = (body, sig = sign(body)) => handler(new Request("https://x/line-webhook", {
    method: "POST", headers: sig ? { "x-line-signature": sig } : {}, body,
  }));
  const send = (...events) => post(JSON.stringify({ destination: "U0", events }));
  return { handler, post, send, replies, logs };
}

const user = { type: "user", userId: "U0123456789abcdef0123456789abcdef" };
const ev = (extra) => ({ replyToken: "rt-" + Math.random(), source: user, timestamp: NOW, mode: "active",
  deliveryContext: { isRedelivery: false }, webhookEventId: "e", ...extra });
const textEv = (text) => ev({ type: "message", message: { id: "1", type: "text", text } });

function assertValidReply(r) {
  assert.ok(r.replyToken);
  assert.ok(r.messages.length >= 1 && r.messages.length <= 5);
  for (const m of r.messages) {
    assert.equal(m.type, "text");
    assert.ok(m.text.length > 0 && m.text.length <= 5000, `text length ${m.text.length}`);
    assert.ok(m.quickReply.items.length <= 13);
    for (const it of m.quickReply.items) {
      assert.equal(it.type, "action");
      assert.ok(it.action.label.length <= 20);
      assert.ok(["message", "location"].includes(it.action.type));
      if (it.action.type === "message") assert.ok(it.action.text.length <= 300);
    }
  }
}

test("webhook: GET, missing secret, empty events (Verify button)", async () => {
  const h = harness();
  assert.equal((await h.handler(new Request("https://x/", { method: "GET" }))).status, 200);
  assert.equal((await harness({ secret: undefined }).send(textEv("น้ำ"))).status, 200);
  assert.equal((await h.send()).status, 200);
  assert.equal(h.replies.length, 0);
});

test("webhook: bad or missing signature is 401 and sends nothing", async () => {
  const h = harness();
  const body = JSON.stringify({ events: [textEv("น้ำ")] });
  assert.equal((await h.post(body, "AAAA")).status, 401);
  assert.equal((await h.post(body, null)).status, 401);
  assert.equal(h.replies.length, 0);
});

test("webhook: follow, every command, location, sticker, postback", async () => {
  const h = harness();
  const events = [
    ev({ type: "follow" }),
    ...COMMANDS.map(([, words]) => textEv(words[0])),
    textEv("สวัสดี"),
    ev({ type: "message", message: { id: "2", type: "location", latitude: PLACES.kolok[0], longitude: PLACES.kolok[1], address: "x" } }),
    ev({ type: "message", message: { id: "3", type: "sticker", packageId: "1", stickerId: "1" } }),
    ev({ type: "postback", postback: { data: "cmd=rain" } }),
  ];
  assert.equal((await h.send(...events)).status, 200);
  assert.equal(h.replies.length, events.length);
  h.replies.forEach(assertValidReply);
  const texts = h.replies.map((r) => r.messages[0].text);
  assert.match(texts[0], /^สวัสดีครับ 👋 นี่คือ NaraFlood/);
  assert.match(texts[1], /^🟠 จ\.นราธิวาส/);
  assert.match(texts[1 + COMMANDS.findIndex(([c]) => c === "alert")], /https:\/\/t\.me\/NaraFloodbot/);
  assert.match(texts[1 + COMMANDS.findIndex(([c]) => c === "me")], new RegExp(user.userId));
  assert.match(texts[1 + COMMANDS.findIndex(([c]) => c === "help")], /1784/);
  assert.match(texts[1 + COMMANDS.length], /พิมพ์ถามได้เลย/);
  assert.match(texts[2 + COMMANDS.length], /สุไหงโก-ลก/);
  assert.match(texts[3 + COMMANDS.length], /พิมพ์ถามได้เลย/);
  assert.match(texts[4 + COMMANDS.length], /forecast\.html/);
  assert.equal(h.logs.length, 0, JSON.stringify(h.logs));
});

test("webhook: unfollow, redelivery and group events get no reply", async () => {
  const h = harness();
  await h.send(
    { type: "unfollow", source: user, timestamp: NOW, mode: "active", deliveryContext: { isRedelivery: false } },
    { ...textEv("น้ำ"), deliveryContext: { isRedelivery: true } },
    { ...textEv("น้ำ"), source: { type: "group", groupId: "C1", userId: user.userId } },
  );
  assert.equal(h.replies.length, 0);
});

test("webhook: upstream down still answers with a web link", async () => {
  const h = harness({ failFetch: true });
  await h.send(textEv("สถานการณ์น้ำ"), ev({ type: "message", message: { id: "4", type: "location", latitude: 6.4, longitude: 101.8 } }));
  assert.equal(h.replies.length, 2);
  assert.match(h.replies[0].messages[0].text, /ดึงข้อมูลสดไม่ได้ กรุณาดูที่ https:\/\/naraflood\.com/);
  assert.match(h.replies[1].messages[0].text, /shelter\.html/);
});

test("webhook: a bug inside one event still replies and other events continue", async () => {
  const h = harness({ home: { parts: { ddpm: { t: NOW, s: 0, d: { data: [{ code: "X", get name() { throw new Error("boom"); } }] } } } } });
  await h.send(textEv("น้ำ"), textEv("ฝน"));
  assert.equal(h.replies.length, 2);
  assert.match(h.replies[0].messages[0].text, /ระบบตอบไม่ได้ชั่วคราว/);
  assert.match(h.replies[1].messages[0].text, /forecast\.html/);
  assert.equal(h.logs.length, 1);
});

test("webhook: home.json fetched once per request", async () => {
  let calls = 0;
  const handler = makeHandler({
    channelSecret: SECRET, accessToken: TOKEN, siteUrl: SITE, now: () => NOW, log: () => {},
    fetch: async (url, init) => {
      if (String(url).includes("home.json")) { calls++; return Response.json(HOME); }
      return Response.json(String(url).includes("shelters") ? SHELTERS : {});
    },
  });
  const body = JSON.stringify({ events: [textEv("น้ำ"), textEv("ระดับน้ำ")] });
  await handler(new Request("https://x/", { method: "POST", headers: { "x-line-signature": sign(body) }, body }));
  assert.equal(calls, 1);
});
