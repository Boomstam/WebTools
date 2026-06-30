import { chromium } from "playwright";

const SEARCH_URL =
  "https://www.2dehands.be/l/caravans-en-kamperen/caravans/#q:caravan|Language:all-languages|PriceCentsFrom:10000|PriceCentsTo:300000|sortBy:PRICE|sortOrder:INCREASING";

const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font"]);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    locale: "nl-BE",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  });

  let requestCount = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
      await route.abort();
      return;
    }
    requestCount += 1;
    await route.continue();
  });

  await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(6000);

  const data = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll("a[href*='/v/caravans-en-kamperen/caravans/']")];
    const unique = new Map();
    for (const anchor of anchors) {
      const href = anchor.href;
      if (!href || unique.has(href)) continue;
      const container =
        anchor.closest("li, article, [data-testid], .hz-Listing, .Listing") ?? anchor.parentElement;
      const text = (container?.innerText || anchor.innerText || "").replace(/\s+/g, " ").trim();
      const price = text.match(/€\s*[\d.,]+/)?.[0] ?? "";
      unique.set(href, {
        href,
        title: (anchor.innerText || "").replace(/\s+/g, " ").trim(),
        price,
        text: text.slice(0, 300)
      });
    }
    return [...unique.values()].slice(0, 20);
  });

  console.log(JSON.stringify({ requestCount, count: data.length, data }, null, 2));
  await browser.close();
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
