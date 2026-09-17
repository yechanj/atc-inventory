const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:3456/');
  await page.waitForLoadState('networkidle');
  console.log('URL:', page.url());
  await page.screenshot({ path: process.argv[2] + '\login_page.png', fullPage: false });
  await browser.close();
})();
