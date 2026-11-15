// ถ่ายรูป rich menu จาก richmenu.html → richmenu.png (2500×1686 · ไม่เกิน 1 MB ตามข้อกำหนดของ LINE)
// รัน: node line-oa/render-richmenu.mjs   (ต้องมี playwright + chromium)
import { createRequire } from "node:module";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

// require (ไม่ใช่ import) เพื่อให้เจอ playwright ที่ติดตั้งแบบ global ด้วย
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = new URL(".", import.meta.url);
const out = fileURLToPath(new URL("richmenu.png", dir));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2500, height: 1686 }, deviceScaleFactor: 1 });
await page.goto(new URL("richmenu.html", dir).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const font = await page.evaluate(() => document.fonts.check("700 104px Anuphan"));
if (!font) console.warn("คำเตือน: โหลดฟอนต์ Anuphan ไม่ได้ รูปจะใช้ฟอนต์สำรอง");
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 2500, height: 1686 } });
await browser.close();
const kb = Math.round(statSync(out).size / 1024);
console.log(`saved ${out} (${kb} KB)`);
if (kb > 1024) { console.error("เกิน 1 MB · LINE ไม่รับ"); process.exit(1); }
