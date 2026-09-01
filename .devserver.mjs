/* .devserver.mjs — สแตติกเซิร์ฟเวอร์สำหรับตรวจงานบน localhost ก่อนขึ้นจริง
   ไม่ใช่ไฟล์ของเว็บ ใช้ตอนพัฒนาเท่านั้น: node .devserver.mjs */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const PORT = 8788;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.geojson': 'application/json; charset=utf-8'
};

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' || p.endsWith('/')) p += 'index.html';
  const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 ' + p);
  }
}).listen(PORT, () => console.log('naraflood dev server: http://127.0.0.1:' + PORT));
