// ทำ DEPLOY.md ข้อ 4.2–4.3 ทั้งหมดในคำสั่งเดียว · รันบนคอมของผู้ดูแล (Windows/Mac/Linux, Node 22+)
//
//   cd waterchaidantai
//   git checkout ccr-2f8cf004-l4e2sd   (หรือ main หลัง merge)
//   node line-oa/deploy-all.mjs
//
// สิ่งที่ทำ: ล็อกอิน Supabase (เปิดเบราว์เซอร์) → deploy line-webhook → ตั้ง secrets ของ LINE
//          → ผูก webhook + ทดสอบ → ติดตั้ง rich menu → บอก Basic ID สำหรับใส่ใน alert.html
// ถาม Channel secret / access token ตอนรัน · ไม่เขียนลงไฟล์ใน repo (ไฟล์ชั่วคราวใน temp ถูกลบทันทีหลังใช้)
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REF = "tnvzeahfugmmrydtnsdv";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SUPA = ["--yes", "supabase@latest"];

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (r.status !== 0) { console.error(`\n✗ คำสั่งล้มเหลว (exit ${r.status}) · ส่งข้อความด้านบนให้ผู้ช่วยดูได้`); process.exit(1); }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log("ต้องมีบัญชี LINE OA + channel แล้ว (DEPLOY.md ข้อ 4.1)");
console.log("ค่าทั้งสองอยู่ที่ developers.line.biz/console → channel ของ NaraFlood\n");
const secret = (await rl.question("Channel secret (แท็บ Basic settings): ")).trim();
const token = (await rl.question("Channel access token long-lived (แท็บ Messaging API): ")).trim();
rl.close();
if (!/^[0-9a-f]{32}$/i.test(secret)) { console.error("✗ Channel secret ควรเป็นเลขฐาน 16 ยาว 32 ตัว"); process.exit(1); }
if (token.length < 100) { console.error("✗ Access token สั้นผิดปกติ (long-lived token ยาวราว 170 ตัวอักษร)"); process.exit(1); }

// 1) ล็อกอิน Supabase · ล็อกอินอยู่แล้วจะผ่านทันที
const who = spawnSync("npx", [...SUPA, "projects", "list"], { cwd: ROOT, shell: process.platform === "win32", encoding: "utf8" });
if (who.status !== 0 || !String(who.stdout).includes(REF)) run("npx", [...SUPA, "login"]);

// 2) deploy ฟังก์ชัน (--use-api ไม่ต้องมี Docker)
run("npx", [...SUPA, "functions", "deploy", "line-webhook", "--no-verify-jwt", "--use-api", "--project-ref", REF]);

// 3) ตั้ง secrets ผ่านไฟล์ชั่วคราว (ไม่ใส่ค่าลงบรรทัดคำสั่ง) แล้วลบทิ้ง
const dir = mkdtempSync(join(tmpdir(), "naraflood-"));
const env = join(dir, "line.env");
try {
  writeFileSync(env, `LINE_CHANNEL_SECRET=${secret}\nLINE_CHANNEL_ACCESS_TOKEN=${token}\n`, { mode: 0o600 });
  run("npx", [...SUPA, "secrets", "set", "--env-file", env, "--project-ref", REF]);
} finally { rmSync(dir, { recursive: true, force: true }); }

// 4) ผูก webhook + ทดสอบ + rich menu (secrets ใช้เวลาไม่กี่วินาทีกว่าจะมีผลกับฟังก์ชัน)
await new Promise((r) => setTimeout(r, 5000));
const withToken = { env: { ...process.env, LINE_CHANNEL_ACCESS_TOKEN: token } };
run("node", ["line-oa/setup-richmenu.mjs", "--info", "--webhook"], withToken);
run("node", ["line-oa/setup-richmenu.mjs"], withToken);

console.log("\n✓ เสร็จแล้ว · เหลือ:");
console.log("  1) ถ้าข้างบนบอก \"เปิดใช้: false\" → เปิด Use webhook ในแท็บ Messaging API ของคอนโซล LINE");
console.log("  2) ส่ง Basic ID (@xxxx) ข้างบนให้ผู้ช่วย เพื่อใส่ LINE_OA_ID ใน alert.html");
console.log("  3) ทดสอบตาม DEPLOY.md ข้อ 4.4 (เพิ่มเพื่อน · กดเมนู · ส่งตำแหน่ง)");
