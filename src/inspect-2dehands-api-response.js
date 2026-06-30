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
const apiResponsePromise = page.waitForResponse((response) =>
  response.url().includes("/lrp/api/search?")
);
await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
const response = await apiResponsePromise;
const data = await response.json();
console.log(
  JSON.stringify(
    {
      url: response.url(),
      keys: Object.keys(data),
      sample: data
    },
    null,
    2
  ).slice(0, 20000)
);
await browser.close();
