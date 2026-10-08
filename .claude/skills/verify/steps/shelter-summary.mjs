// shelter.html: the official per-district summary (inline SUMM data) renders even with Supabase down.
// Run: node .claude/skills/verify/drive.mjs shelter.html .claude/skills/verify/steps/shelter-summary.mjs
export default async ({ page, shot, log }) => {
  await page.waitForSelector('#offBody tr', { timeout: 15000 });
  log('intro', (await page.textContent('#offIntro')).trim().slice(0, 160));
  log('districtRows', await page.locator('#offBody tr').count());
  log('firstRow', (await page.locator('#offBody tr').first().innerText()).replace(/\s+/g, ' '));
  log('memberTableRows', await page.locator('#tbody tr').count());
  await page.locator('#officialCard').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await shot('official-summary');
};
