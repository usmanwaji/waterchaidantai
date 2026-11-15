#!/usr/bin/env node
// ติดตั้ง rich menu ของ LINE OA · Node 22 ขึ้นไป ไม่มี dependency
//
//   node line-oa/setup-richmenu.mjs --dry-run      ตรวจ JSON และรูป ไม่เรียก API
//   LINE_CHANNEL_ACCESS_TOKEN=... node line-oa/setup-richmenu.mjs
//
// ลำดับ: สร้าง rich menu → อัปโหลดรูป → ตั้งเป็นค่าเริ่มต้นของทุกคน → ลบ rich menu เก่า
// รันซ้ำได้: ทุกครั้งได้เมนูใหม่หนึ่งตัวเป็นค่าเริ่มต้น และของเก่าถูกลบ

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = "https://api.line.me/v2/bot";
const API_DATA = "https://api-data.line.me/v2/bot";
const MAX_IMAGE_BYTES = 1024 * 1024;

// ---------------------------------------------------------------- ตรวจ

function imageSize(buf) {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: "image/jpeg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

const chars = (s) => [...String(s ?? "")].length;

export function validate(menu, image) {
  const errors = [];
  const { width: W, height: H } = menu.size ?? {};
  if (!(W === 2500 && (H === 1686 || H === 843))) errors.push(`size ต้องเป็น 2500×1686 หรือ 2500×843 (ได้ ${W}×${H})`);
  if (!menu.name || chars(menu.name) > 300) errors.push("name ต้องมีและยาวไม่เกิน 300 ตัวอักษร");
  if (!menu.chatBarText || chars(menu.chatBarText) > 14) errors.push("chatBarText ต้องมีและยาวไม่เกิน 14 ตัวอักษร");
  if (typeof menu.selected !== "boolean") errors.push("selected ต้องเป็น true/false");
  const areas = menu.areas ?? [];
  if (areas.length < 1 || areas.length > 20) errors.push("areas ต้องมี 1–20 ช่อง");

  areas.forEach((a, i) => {
    const b = a.bounds ?? {};
    if (b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0 || b.x + b.width > W || b.y + b.height > H) {
      errors.push(`areas[${i}] อยู่นอกขอบรูป`);
    }
    const act = a.action ?? {};
    if (act.label != null && chars(act.label) > 20) errors.push(`areas[${i}].label ยาว ${chars(act.label)} ตัวอักษร (สูงสุด 20)`);
    if (act.type === "message" && !(chars(act.text) >= 1 && chars(act.text) <= 300)) errors.push(`areas[${i}].text ต้องยาว 1–300`);
    if (act.type === "uri" && !(/^(https?:|tel:|line:)/.test(act.uri ?? "") && chars(act.uri) <= 1000)) errors.push(`areas[${i}].uri ไม่ถูกต้อง`);
    if (!["message", "uri", "postback"].includes(act.type)) errors.push(`areas[${i}].action.type ไม่รองรับ: ${act.type}`);
    areas.slice(i + 1).forEach((o, j) => {
      const c = o.bounds ?? {};
      if (b.x < c.x + c.width && c.x < b.x + b.width && b.y < c.y + c.height && c.y < b.y + b.height) {
        errors.push(`areas[${i}] ทับกับ areas[${i + 1 + j}]`);
      }
    });
  });
  const covered = areas.reduce((s, a) => s + (a.bounds?.width ?? 0) * (a.bounds?.height ?? 0), 0);
  if (W && H && covered !== W * H) errors.push(`ช่องรวมกันไม่เต็มรูป (${covered} จาก ${W * H} px²)`);

  if (!image) {
    errors.push("ไม่พบรูป richmenu.png หรือ richmenu.jpg");
  } else {
    const info = imageSize(image.buf);
    if (!info) errors.push(`${image.name} ไม่ใช่ PNG/JPEG`);
    else if (info.width !== W || info.height !== H) errors.push(`${image.name} ขนาด ${info.width}×${info.height} ไม่ตรงกับ size ${W}×${H}`);
    if (image.buf.length > MAX_IMAGE_BYTES) errors.push(`${image.name} ใหญ่ ${image.buf.length} ไบต์ (สูงสุด 1 MB) · บันทึกเป็น JPEG คุณภาพ 85 แทน`);
  }
  return errors;
}

function loadImage() {
  for (const name of ["richmenu.png", "richmenu.jpg"]) {
    const p = join(HERE, name);
    if (existsSync(p)) return { name, buf: readFileSync(p) };
  }
  return null;
}

// ---------------------------------------------------------------- เรียก API

async function call(step, url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  if (!r.ok) {
    console.error(`✗ ${step}: HTTP ${r.status}\n${text}`);
    process.exit(1);
  }
  console.log(`✓ ${step}`);
  return text ? JSON.parse(text) : {};
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const menu = JSON.parse(readFileSync(join(HERE, "richmenu.json"), "utf8"));
  const image = loadImage();
  const errors = validate(menu, image);
  if (errors.length) {
    console.error("✗ ตรวจไม่ผ่าน:\n  " + errors.join("\n  "));
    process.exit(1);
  }
  const info = imageSize(image.buf);
  console.log(`✓ richmenu.json ${menu.areas.length} ช่อง · ${image.name} ${info.width}×${info.height} ${(image.buf.length / 1024).toFixed(0)} KB`);
  if (dryRun) return;

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.error("✗ ตั้ง LINE_CHANNEL_ACCESS_TOKEN ก่อน (อย่าใส่ token ลงไฟล์ใด ๆ ใน repo)");
    process.exit(1);
  }
  const auth = { Authorization: `Bearer ${token}` };

  await call("ตรวจรูปแบบ rich menu", `${API}/richmenu/validate`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(menu),
  });
  const { richMenuId } = await call("สร้าง rich menu", `${API}/richmenu`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(menu),
  });
  console.log(`  richMenuId = ${richMenuId}`);
  await call("อัปโหลดรูป", `${API_DATA}/richmenu/${richMenuId}/content`, {
    method: "POST", headers: { ...auth, "Content-Type": info.type }, body: image.buf,
  });
  await call("ตั้งเป็นเมนูเริ่มต้นของทุกคน", `${API}/user/all/richmenu/${richMenuId}`, {
    method: "POST", headers: auth,
  });
  const { richmenus = [] } = await call("อ่านรายการ rich menu", `${API}/richmenu/list`, { headers: auth });
  for (const old of richmenus.filter((m) => m.richMenuId !== richMenuId)) {
    await call(`ลบเมนูเก่า ${old.richMenuId} (${old.name})`, `${API}/richmenu/${old.richMenuId}`, {
      method: "DELETE", headers: auth,
    });
  }
  console.log("เสร็จ · เปิดแชท LINE OA ใหม่อีกครั้งเพื่อเห็นเมนู (อาจต้องรอไม่กี่นาที)");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
