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
  const visibleText = document.body.innerText.replace(/\s+/g, " ").slice(0, 5000);
  const links = [...document.querySelectorAll("a[href]")]
    .map((a) => ({
      text: a.innerText.replace(/\s+/g, " ").trim(),
      href: a.href
    }))
    .filter((a) => /volgende|next|page|pagina|meer|toon/i.test(`${a.text} ${a.href}`))
    .slice(0, 80);
  const buttons = [...document.querySelectorAll("button")]
    .map((button) => ({
      text: button.innerText.replace(/\s+/g, " ").trim(),
      aria: button.getAttribute("aria-label"),
      testId: button.getAttribute("data-testid")
    }))
    .filter((button) => /volgende|next|page|pagina|meer|toon|result/i.test(JSON.stringify(button)))
    .slice(0, 80);
  return { visibleText, links, buttons, url: location.href };
});

console.log(JSON.stringify(data, null, 2));
await browser.close();
