/*
  publish-github.mjs — อัปโหลดโฟลเดอร์ ./telerid-cam ขึ้นสาขา `cam` ของ repo บน GitHub
  ผ่าน GitHub API (ไม่ต้องลงโปรแกรม Git) — ใช้ตอนรันบนคอมตัวเอง (IP ไทย)
  รันเดี่ยว ๆ (node publish-github.mjs) หรือเรียก publish() จาก scrape.mjs --watch ก็ได้

  ต้องตั้งค่า (ครั้งเดียว) ตัวแปรสภาพแวดล้อม:
    GH_TOKEN = GitHub Personal Access Token (สิทธิ์ Contents: Read and write ของ repo)
    GH_REPO  = usmanwaji/waterchaidantai   (ตั้งค่าเริ่มต้นให้แล้ว ไม่ต้องใส่ก็ได้)
    GH_BRANCH= cam                          (ค่าเริ่มต้น)

  ไฟล์ที่เนื้อหาเหมือนบนสาขาเดิม (เทียบ git blob sha) จะไม่อัปโหลดซ้ำ
  → รอบหนึ่งเรียก API แค่ไม่กี่ครั้ง ส่งถี่ (ทุกไม่กี่นาที) ได้โดยไม่ชนลิมิตของ GitHub
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const TOKEN = process.env.GH_TOKEN || '';
const REPO = process.env.GH_REPO || 'usmanwaji/waterchaidantai';
const BRANCH = process.env.GH_BRANCH || 'cam';
const DIR = 'telerid-cam';
const API = 'https://api.github.com';

async function gh(method, urlPath, body) {
  const r = await fetch(API + urlPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

// sha ของไฟล์แบบที่ git ใช้ — ถ้าตรงกับบนสาขาเดิม ใช้ blob เดิมได้เลย
const blobSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

export async function publish({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...a) => console.log('[publish]', ...a);
  if (!TOKEN) throw new Error('ยังไม่ได้ตั้งค่า GH_TOKEN');

  // อ่านไฟล์ทั้งหมดในโฟลเดอร์ telerid-cam
  let names;
  try { names = await fs.readdir(DIR); }
  catch { throw new Error(`ไม่พบโฟลเดอร์ ${DIR} — รัน node scrape.mjs ก่อน`); }
  if (!names.length) throw new Error(`โฟลเดอร์ ${DIR} ว่างเปล่า`);

  // 0) ไฟล์ที่อยู่บนสาขาตอนนี้ (ดึงไม่ได้ = อัปโหลดใหม่ทั้งหมดแบบเดิม)
  const remote = new Map();
  const cur = await gh('GET', `/repos/${REPO}/git/trees/${BRANCH}`);
  if (cur.status === 200 && Array.isArray(cur.json?.tree)) {
    for (const e of cur.json.tree) if (e.type === 'blob') remote.set(e.path, e.sha);
  }

  // 1) สร้าง blob เฉพาะไฟล์ที่เปลี่ยน
  const tree = [];
  let uploaded = 0;
  for (const name of names) {
    const buf = await fs.readFile(path.join(DIR, name));
    let sha = blobSha(buf);
    if (remote.get(name) !== sha) {
      const b = await gh('POST', `/repos/${REPO}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
      if (b.status >= 300) throw new Error(`สร้าง blob ล้มเหลว ${name} ${b.status} ${b.text.slice(0, 200)}`);
      sha = b.json.sha;
      uploaded++;
    }
    tree.push({ path: name, mode: '100644', type: 'blob', sha });
  }
  log(`${names.length} ไฟล์ (เปลี่ยน ${uploaded}) → ${REPO} สาขา ${BRANCH}`);

  // 2) สร้าง tree
  const t = await gh('POST', `/repos/${REPO}/git/trees`, { tree });
  if (t.status >= 300) throw new Error(`สร้าง tree ล้มเหลว ${t.status} ${t.text.slice(0, 200)}`);

  // 3) สร้าง commit (ไม่มี parent = สาขาคอมมิตเดียว ไม่บวมประวัติ)
  const c = await gh('POST', `/repos/${REPO}/git/commits`, {
    message: 'telerid cam ' + new Date().toISOString(),
    tree: t.json.sha, parents: [],
  });
  if (c.status >= 300) throw new Error(`สร้าง commit ล้มเหลว ${c.status} ${c.text.slice(0, 200)}`);

  // 4) อัปเดต ref สาขา cam (ถ้าไม่มี ให้สร้าง)
  let u = await gh('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: c.json.sha, force: true });
  if (u.status === 404 || u.status === 422) {
    u = await gh('POST', `/repos/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: c.json.sha });
  }
  if (u.status >= 300) {
    const hint = u.status === 401 || u.status === 403 ? ' → เช็ก GH_TOKEN ว่ามีสิทธิ์ Contents: Read and write ของ repo นี้' : '';
    throw new Error(`อัปเดตสาขา ${BRANCH} ล้มเหลว ${u.status} ${u.text.slice(0, 300)}${hint}`);
  }
  return { files: names.length, uploaded };
}

// รันเดี่ยว ๆ: node publish-github.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!TOKEN) {
    console.error('\n❌ ยังไม่ได้ตั้งค่า GH_TOKEN');
    console.error('   เปิด Command Prompt แล้วพิมพ์ (ครั้งเดียว):  setx GH_TOKEN "โทเคนของคุณ"');
    console.error('   แล้วปิด-เปิดหน้าต่างใหม่ ค่อยรันอีกครั้ง\n');
    process.exit(1);
  }
  publish().then(() => {
    console.log(`✅ เสร็จ! ภาพขึ้นสาขา ${BRANCH} แล้ว — เปิดเว็บหน้า สถานการณ์ ดูได้เลย`);
    console.log(`   ตรวจได้ที่ https://github.com/${REPO}/tree/${BRANCH}`);
  }).catch((e) => { console.error('❌', e.message || e); process.exit(1); });
}
