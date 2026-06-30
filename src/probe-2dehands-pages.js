import { chromium } from "playwright";

const HASHES = [
  "q:caravan|Language:all-languages|PriceCentsFrom:10000|PriceCentsTo:300000|sortBy:PRICE|sortOrder:INCREASING",
  "q:caravan|Language:all-languages|PriceCentsFrom:10000|PriceCentsTo:300000|sortBy:PRICE|sortOrder:INCREASING|page:2",
  "q:caravan|Language:all-languages|PriceCentsFrom:10000|PriceCentsTo:300000|sortBy:PRICE|sortOrder:INCREASING|Page:2",
  "q:caravan|Language:all-languages|PriceCentsFrom:10000|PriceCentsTo:300000|sortBy:PRICE|sortOrder:INCREASING|pagination:2",
  "q:caravan|Language:all-languages|PriceCentsFrom:10000|PriceCentsTo:300000|sortBy:PRICE|sortOrder:INCREASING|offset:30"
];

function collect(json) {
  const rows = [];
  function walk(value) {
    if (!value || typeof value !== "object") return;
    if (
      typeof value.itemId === "string" &&
      typeof value.title === "string" &&
      value.priceInfo &&
      typeof value.priceInfo.priceCents === "number"
    ) {
      rows.push({
        id: value.itemId,
        title: value.title,
        cents: value.priceInfo.priceCents,
        url: value.vipUrl
      });
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else {
      Object.values(value).forEach(walk);
    }
  }
  walk(json);
  return rows;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "nl-BE" });
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

for (const hash of HASHES) {
  const url = `https://www.2dehands.be/l/caravans-en-kamperen/caravans/#${hash}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(5000);
  const rows = await page.evaluate(() => {
    const rows = [];
    function walk(value) {
      if (!value || typeof value !== "object") return;
      if (
        typeof value.itemId === "string" &&
        typeof value.title === "string" &&
        value.priceInfo &&
        typeof value.priceInfo.priceCents === "number"
      ) {
        rows.push({
          id: value.itemId,
          title: value.title,
          cents: value.priceInfo.priceCents,
          url: value.vipUrl
        });
      }
      if (Array.isArray(value)) {
        value.forEach(walk);
      } else {
        Object.values(value).forEach(walk);
      }
    }
    for (const script of document.querySelectorAll("script[type='application/json']")) {
      try {
        walk(JSON.parse(script.textContent || ""));
      } catch {}
    }
    return rows;
  });
  const priced = rows.filter((row) => row.cents >= 10000 && row.cents <= 300000);
  console.log(
    JSON.stringify({
      hash,
      requestCount,
      total: rows.length,
      priced: priced.length,
      firstPriced: priced.slice(0, 5).map((row) => [row.id, row.cents, row.title]),
      lastPriced: priced.slice(-5).map((row) => [row.id, row.cents, row.title])
    })
  );
}

await browser.close();
