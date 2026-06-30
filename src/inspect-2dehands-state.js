import { chromium } from "playwright";

const SEARCH_URL =
  "https://www.2dehands.be/l/caravans-en-kamperen/caravans/#q:caravan|Language:all-languages|PriceCentsFrom:10000|PriceCentsTo:300000|sortBy:PRICE|sortOrder:INCREASING";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "nl-BE" });
await page.route("**/*", async (route) => {
  const type = route.request().resourceType();
  if (["image", "media", "font"].includes(type)) {
    await route.abort();
    return;
  }
  await route.continue();
});
await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(6000);

const data = await page.evaluate(() => {
  const html = document.documentElement.outerHTML;
  const ids = [...html.matchAll(/m\d{9,11}|a\d{8,11}/g)].map((m) => m[0]);
  const uniqueIds = [...new Set(ids)];
  const scripts = [...document.scripts].map((script, index) => {
    const text = script.textContent || "";
    return {
      index,
      type: script.type,
      length: text.length,
      hasListings: /listings|searchResult|Caravan tabert|Matras|m2412398268/i.test(text),
      snippet: /Caravan tabert|Matras|m2412398268/i.test(text)
        ? text.slice(Math.max(text.search(/Caravan tabert|Matras|m2412398268/i) - 500, 0), text.search(/Caravan tabert|Matras|m2412398268/i) + 1000)
        : ""
    };
  });
  return { htmlLength: html.length, uniqueIds: uniqueIds.slice(0, 80), idCount: uniqueIds.length, scripts };
});

console.log(JSON.stringify(data, null, 2));
await browser.close();
