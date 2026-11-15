// ติดตั้ง rich menu + ผูก webhook ของ LINE OA (NaraFlood) ผ่าน Messaging API · Node 22 ไม่มี dependency
//
//   export LINE_CHANNEL_ACCESS_TOKEN=<long-lived token จาก LINE Developers Console>   (ห้าม commit)
//   node line-oa/setup-richmenu.mjs --dry-run      ตรวจ richmenu.json + รูป โดยไม่เรียก API
//   node line-oa/setup-richmenu.mjs --info         ดู Basic ID (@xxxx) ของบัญชี → ใส่ LINE_OA_ID ใน alert.html
//   node line-oa/setup-richmenu.mjs --webhook      ตั้ง Webhook URL เป็น line-webhook ของ Supabase แล้วทดสอบ
//   node line-oa/setup-richmenu.mjs                สร้าง rich menu ใหม่ → อัปโหลดรูป → ตั้งเป็นค่าเริ่มต้น → ลบตัวเก่า
//   ใส่หลายตัวพร้อมกันได้ เช่น --info --webhook (ทำ rich menu ด้วยเมื่อไม่มี --info/--webhook หรือใส่ --richmenu)
//
// --webhook-url <url> ใช้แทน URL ค่าเริ่มต้นได้
import { readFileSync, statSync } from "node:fs";

const DIR = new URL(".", import.meta.url);
const API = "https://api.line.me/v2/bot";
const API_DATA = "https://api-data.line.me/v2/bot";
const DEFAULT_WEBHOOK = "https://tnvzeahfugmmrydtnsdv.supabase.co/functions/v1/line-webhook";
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argVal = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const dry = has("--dry-run");
const doInfo = has("--info"), doHook = has("--webhook") || has("--webhook-url");
const doMenu = has("--richmenu") || (!doInfo && !doHook);

function fail(msg) { console.error("✗ " + msg); process.exit(1); }

/* ---------- ตรวจไฟล์ (ทำทุกครั้งก่อนเรียก API) ---------- */
function pngSize(buf) {
  if (buf.length > 24 && buf.toString("ascii", 1, 4) === "PNG") return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: "image/png" };
  if (buf[0] === 0xff && buf[1] === 0xd8) { // JPEG: หา SOF
    for (let i = 2; i < buf.length - 9;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), type: "image/jpeg" };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}
function validate() {
  const menu = JSON.parse(readFileSync(new URL("richmenu.json", DIR), "utf8"));
  const { width: W, height: H } = menu.size;
  const errs = [];
  if (W !== 2500 || ![1686, 843].includes(H)) errs.push(`size ${W}x${H} ไม่ใช่ 2500x1686/843`);
  if ([...menu.chatBarText].length > 14) errs.push("chatBarText ยาวเกิน 14 ตัวอักษร");
  if (!menu.areas?.length || menu.areas.length > 20) errs.push("areas ต้องมี 1–20 ช่อง");
  let area = 0;
  for (const [i, a] of (menu.areas || []).entries()) {
    const b = a.bounds;
    if (b.x < 0 || b.y < 0 || b.x + b.width > W || b.y + b.height > H) errs.push(`area ${i} เกินขอบรูป`);
    area += b.width * b.height;
    const act = a.action || {};
    if (act.label && [...act.label].length > 20) errs.push(`area ${i} label ยาวเกิน 20`);
    if (act.type === "uri" && !/^(https?:|tel:|line:)/.test(act.uri || "")) errs.push(`area ${i} uri ไม่รองรับ: ${act.uri}`);
    if (act.type === "message" && !act.text) errs.push(`area ${i} ไม่มี text`);
  }
  if (area !== W * H) errs.push(`พื้นที่ปุ่มรวม ${area} ≠ ${W * H} (มีช่องว่างหรือทับกัน)`);

  const imgName = ["richmenu.png", "richmenu.jpg"].find((n) => { try { return statSync(new URL(n, DIR)).isFile(); } catch { return false; } });
  if (!imgName) errs.push("ไม่พบ richmenu.png / richmenu.jpg (รัน node line-oa/render-richmenu.mjs)");
  let img = null;
  if (imgName) {
    const buf = readFileSync(new URL(imgName, DIR));
    const dim = pngSize(buf);
    if (!dim) errs.push(`${imgName} ไม่ใช่ PNG/JPEG`);
    else if (dim.w !== W || dim.h !== H) errs.push(`${imgName} ขนาด ${dim.w}x${dim.h} ไม่ตรงกับ size`);
    if (buf.length > 1024 * 1024) errs.push(`${imgName} ${Math.round(buf.length / 1024)} KB เกิน 1 MB`);
    img = { name: imgName, buf, type: dim?.type };
  }
  if (errs.length) fail("richmenu ไม่ผ่าน:\n  - " + errs.join("\n  - "));
  console.log(`✓ richmenu.json ${menu.areas.length} ปุ่ม · ${img.name} ${Math.round(img.buf.length / 1024)} KB`);
  return { menu, img };
}

/* ---------- เรียก API ---------- */
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
async function call(method, url, body, type = "application/json") {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body != null ? { "Content-Type": type } : {}) },
    body: body == null ? undefined : type === "application/json" ? JSON.stringify(body) : body,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : {}; } catch { /* ไม่ใช่ JSON */ }
  if (!res.ok) fail(`${method} ${url} → HTTP ${res.status}\n${text}`);
  return json;
}

const { menu, img } = doMenu || dry ? validate() : {};
if (dry) { console.log("dry-run: ไม่ได้เรียก API"); process.exit(0); }
if (!TOKEN) fail("ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN");

if (doInfo) {
  const info = await call("GET", `${API}/info`);
  console.log(`✓ บัญชี: ${info.displayName} · Basic ID: ${info.basicId} · โหมดแชท: ${info.chatMode} · อ่านอัตโนมัติ: ${info.markAsReadMode}`);
  console.log(`  ลิงก์เพิ่มเพื่อน: https://line.me/R/ti/p/${info.basicId}`);
  const q = await call("GET", `${API}/message/quota`);
  const used = await call("GET", `${API}/message/quota/consumption`);
  console.log(`  โควตาข้อความเดือนนี้: ใช้ ${used.totalUsage} / ${q.type === "limited" ? q.value : "ไม่จำกัด"}`);
}

if (doHook) {
  const endpoint = argVal("--webhook-url") || DEFAULT_WEBHOOK;
  await call("PUT", `${API}/channel/webhook/endpoint`, { endpoint });
  const cur = await call("GET", `${API}/channel/webhook/endpoint`);
  console.log(`✓ Webhook URL: ${cur.endpoint} · เปิดใช้: ${cur.active}`);
  const t = await call("POST", `${API}/channel/webhook/test`, { endpoint });
  console.log(t.success ? `✓ ทดสอบ webhook: HTTP ${t.statusCode}` : `✗ ทดสอบ webhook ไม่ผ่าน: ${t.reason} · ${t.detail} (HTTP ${t.statusCode})`);
  if (!cur.active) console.log("  ! ต้องเปิด \"Use webhook\" ในแท็บ Messaging API ของ LINE Developers Console เอง (API เปิดให้ไม่ได้)");
  if (!t.success) process.exitCode = 1;
}

if (doMenu) {
  await call("POST", `${API}/richmenu/validate`, menu);
  const { richMenuId } = await call("POST", `${API}/richmenu`, menu);
  console.log(`✓ สร้าง rich menu ${richMenuId}`);
  await call("POST", `${API_DATA}/richmenu/${richMenuId}/content`, img.buf, img.type);
  console.log(`✓ อัปโหลดรูป ${img.name}`);
  await call("POST", `${API}/user/all/richmenu/${richMenuId}`);
  console.log("✓ ตั้งเป็นเมนูเริ่มต้นของทุกคน");
  const { richmenus = [] } = await call("GET", `${API}/richmenu/list`);
  for (const m of richmenus.filter((m) => m.richMenuId !== richMenuId)) {
    await call("DELETE", `${API}/richmenu/${m.richMenuId}`);
    console.log(`✓ ลบเมนูเก่า ${m.richMenuId} (${m.name})`);
  }
}
