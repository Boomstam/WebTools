import { chromium } from "playwright";

const SEARCH_URL =
  "https://www.2dehands.be/l/caravans-en-kamperen/caravans/#q:caravan|Language:all-languages|PriceCentsFrom:10000|PriceCentsTo:300000|sortBy:PRICE|sortOrder:INCREASING";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "nl-BE" });
const seen = [];

await page.route("**/*", async (route) => {
  const type = route.request().resourceType();
  if (["image", "media", "font"].includes(type)) {
    await route.abort();
    return;
  }
  await route.continue();
});

page.on("request", (request) => {
  const url = request.url();
  if (/api|search|listing|lrp|feed|page|offset|pagination/i.test(url)) {
    seen.push({ type: request.resourceType(), method: request.method(), url });
  }
});

await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(8000);

console.log(JSON.stringify(seen, null, 2));
await browser.close();
