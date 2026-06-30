import { chromium } from "playwright";

const SEARCH_URL =
  "https://www.2dehands.be/l/caravans-en-kamperen/caravans/#q:caravan|Language:all-languages|PriceCentsFrom:10000|PriceCentsTo:300000|sortBy:PRICE|sortOrder:INCREASING";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "nl-BE", viewport: { width: 1365, height: 900 } });
let requestCount = 0;
await page.route("**/*", async (route) => {
  const type = route.request().resourceType();
  if (["image", "media", "font"].includes(type)) {
    await route.abort();
    return;
  }
  requestCount += 1;
  await route.continue();
});
await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(6000);

for (let i = 0; i < 18; i += 1) {
  const stats = await page.evaluate(() => ({
    scrollY,
    scrollHeight: document.documentElement.scrollHeight,
    links: document.querySelectorAll("a[href*='/v/']").length,
    listingTexts: [...document.querySelectorAll("a[href*='/v/']")]
      .slice(-5)
      .map((a) => a.innerText.replace(/\s+/g, " ").trim().slice(0, 80))
  }));
  console.log(JSON.stringify({ i, requestCount, ...stats }));
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(2500);
}

await browser.close();
