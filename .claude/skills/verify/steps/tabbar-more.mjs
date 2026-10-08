// Tab bar (js/tabbar.js, injected on every page): read the tabs, open the "เพิ่มเติม" sheet,
// close it with Escape, then follow the แผนที่น้ำ tab to map.html.
// Run: node .claude/skills/verify/drive.mjs index.html .claude/skills/verify/steps/tabbar-more.mjs
export default async ({ page, shot, log }) => {
  const bar = page.getByRole('navigation', { name: 'เมนูหลัก' });
  log('tabs', await bar.locator('a').allTextContents());
  log('current', await bar.locator('a[aria-current="page"]').textContent());
  await page.click('#tabMore');
  await page.waitForSelector('.sheet.show');
  log('expanded', await page.getAttribute('#tabMore', 'aria-expanded'));
  log('sheetLinks', await page.locator('.sheet.show a').evaluateAll(as => as.map(a => a.getAttribute('href'))));
  await shot('sheet-open');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sheet:not(.show)', { state: 'attached' });
  log('expandedAfterEscape', await page.getAttribute('#tabMore', 'aria-expanded'));
  await bar.getByText('แผนที่น้ำ').click();
  await page.waitForURL('**/map.html');
  log('navigatedTo', new URL(page.url()).pathname);
  log('currentOnMap', await page.getByRole('navigation', { name: 'เมนูหลัก' }).locator('a[aria-current="page"]').textContent());
  await shot('map');
};
