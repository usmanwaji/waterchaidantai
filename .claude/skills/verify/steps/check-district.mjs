// check.html: pick a Narathiwat district on the phone layout and read the four result cards.
// Run: node .claude/skills/verify/drive.mjs check.html .claude/skills/verify/steps/check-district.mjs
export default async ({ page, shot, log }) => {
  const district = process.env.DISTRICT || 'ตากใบ';
  await page.selectOption('#ampSel', district);
  await page.waitForSelector('#result:not(.hide)', { timeout: 20000 });
  // The cards fill independently as each fetch settles; wait until none still shows the "…" placeholder.
  await page.waitForFunction(() => ['riskLv', 'rainNow', 'stName', 'shName']
    .every(id => document.getElementById(id).textContent.trim() !== '…'), null, { timeout: 30000 }).catch(() => {});
  const cards = await page.evaluate(() => Object.fromEntries(['riskLv', 'riskDs', 'rainNow', 'stName', 'stDs', 'shName']
    .map(id => [id, document.getElementById(id).textContent.trim().slice(0, 120)])));
  log('district', district);
  log('cards', cards);
  await page.locator('#riskCard').evaluate(el => el.scrollIntoView({ block: 'center' }));
  await shot('result');
};
