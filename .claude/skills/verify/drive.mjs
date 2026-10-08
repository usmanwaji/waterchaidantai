// Open one page of the site in a fresh headless Chromium, run a steps module, capture evidence.
// Usage: node .claude/skills/verify/drive.mjs <page.html> [steps.mjs] [--wide]
//   steps.mjs default-exports async ({ page, shot, log }) => {}; omit it to just load and screenshot.
//   --wide uses a 1280x900 desktop viewport; the default is a 390x844 phone.
// Evidence goes to shots/verify/<timestamp>-<page>/ (gitignored): numbered PNGs and report.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const wide = args.includes('--wide');
const [pagePath, stepsPath] = args.filter(a => !a.startsWith('--'));
if (!pagePath) { console.error('usage: drive.mjs <page.html> [steps.mjs] [--wide]'); process.exit(2); }

const repo = resolve(import.meta.dirname, '../../..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = resolve(repo, 'shots/verify', `${stamp}-${basename(pagePath, '.html')}`);
mkdirSync(out, { recursive: true });

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs');
// No proxy option: Chromium picks up the environment proxy for outside hosts and goes direct
// to 127.0.0.1. Passing Playwright's `proxy` sends localhost through the proxy, which refuses it.
const browser = await chromium.launch();
const context = await browser.newContext(wide
  ? { viewport: { width: 1280, height: 900 } }
  : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();

const report = { page: pagePath, viewport: wide ? 'wide' : 'phone', steps: [], blocked: [], failed: [], pageErrors: [], console: [] };
page.on('pageerror', e => report.pageErrors.push(e.message));
page.on('console', m => { if (m.type() === 'error') report.console.push(m.text().slice(0, 300)); });
page.on('requestfailed', r => {
  const err = r.failure()?.errorText || '';
  const entry = `${new URL(r.url()).host} ${err}`;
  // Tunnel failures are the sandbox network policy refusing the host, not the app.
  (err.includes('TUNNEL_CONNECTION_FAILED') ? report.blocked : report.failed).push(entry);
});

let n = 0;
const shot = async name => { const f = `${String(++n).padStart(2, '0')}-${name}.png`; await page.screenshot({ path: resolve(out, f), fullPage: false }); report.steps.push({ shot: f }); return f; };
const log = (k, v) => { report.steps.push({ [k]: v }); console.log(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`); };

let status = 'ok';
try {
  await page.goto(`http://127.0.0.1:8788/${pagePath}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await shot('loaded');
  if (stepsPath) {
    const steps = (await import(pathToFileURL(resolve(stepsPath)).href)).default;
    await steps({ page, shot, log });
  }
} catch (e) {
  status = 'error';
  report.error = e.message.split('\n')[0];
  await shot('error').catch(() => {});
}
report.blocked = [...new Set(report.blocked)];
report.failed = [...new Set(report.failed)];
report.status = status;
writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();

console.log(`status: ${status}${report.error ? ' (' + report.error + ')' : ''}`);
if (report.blocked.length) console.log(`blocked by network policy: ${report.blocked.map(b => b.split(' ')[0]).join(', ')}`);
if (report.failed.length) console.log(`other failed requests: ${report.failed.join('; ')}`);
if (report.pageErrors.length) console.log(`page errors: ${report.pageErrors.join(' | ')}`);
console.log(`evidence: ${out}`);
process.exit(status === 'ok' ? 0 : 1);
