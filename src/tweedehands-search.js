import { chromium } from "playwright";
import fs from "node:fs/promises";

const SEARCH_URL =
  "https://www.2dehands.be/l/caravans-en-kamperen/caravans/#q:caravan|Language:all-languages|PriceCentsFrom:10000|PriceCentsTo:300000|sortBy:PRICE|sortOrder:INCREASING";
const COOLDOWN_PATH = ".crawler-state/2dehands-cooldown.json";
const COOLDOWN_HOURS = 12;
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font"]);
const BLOCKED_HOST_PATTERNS = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.net",
  "hotjar.com"
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.searchParams.delete("c");
  parsed.searchParams.delete("correlationId");
  return parsed.toString();
}

function parseEuroPrice(raw) {
  if (!raw) return null;
  const match = raw.match(/€\s*([\d.\s]+)(?:,(\d{1,2})|-)?/);
  if (!match) return null;
  const euros = Number.parseInt(match[1].replace(/[.\s]/g, ""), 10);
  if (!Number.isFinite(euros)) return null;
  const cents = match[2] ? Number.parseInt(match[2].padEnd(2, "0"), 10) : 0;
  return euros + cents / 100;
}

function formatEuroPrice(value) {
  if (!Number.isFinite(value)) return "";
  return `€ ${value.toLocaleString("nl-BE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

async function readCooldown() {
  try {
    const cooldown = JSON.parse(await fs.readFile(COOLDOWN_PATH, "utf8"));
    if (new Date(cooldown.until).getTime() > Date.now()) {
      throw new Error(
        `2dehands cooldown actief tot ${cooldown.until}. Reden: ${cooldown.reason}`
      );
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function writeCooldown(reason) {
  const until = new Date(Date.now() + COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
  await fs.mkdir(".crawler-state", { recursive: true });
  await fs.writeFile(COOLDOWN_PATH, JSON.stringify({ reason, until }, null, 2));
}

function toResult(raw) {
  const priceValue = Number.isFinite(raw.priceCents)
    ? raw.priceCents / 100
    : parseEuroPrice(raw.price);
  return {
    url: normalizeUrl(raw.url),
    price: formatEuroPrice(priceValue),
    priceValue,
    title: raw.title,
    summary: raw.summary
  };
}

function toRawResultFromListing(listing) {
  return {
    url: new URL(listing.vipUrl, "https://www.2dehands.be").href,
    title: String(listing.title || "").replace(/\s+/g, " ").trim(),
    price: "",
    priceCents: listing.priceInfo?.priceCents,
    summary: `${listing.title || ""} ${listing.description || ""}`.replace(/\s+/g, " ").trim().slice(0, 500)
  };
}

export async function searchCaravans({
  minPrice = 100,
  maxPrice = 3000,
  maxResults = 300,
  maxScrolls = 35,
  requestBudget = 220,
  delayMs = 1250,
  headless = true
} = {}) {
  await readCooldown();

  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ locale: "nl-BE" });
  let continuedRequests = 0;
  let apiPageRequests = 0;
  let blockedByStatus = null;

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    const host = new URL(url).hostname;

    if (
      BLOCKED_RESOURCE_TYPES.has(request.resourceType()) ||
      BLOCKED_HOST_PATTERNS.some((pattern) => host.includes(pattern))
    ) {
      await route.abort();
      return;
    }

    continuedRequests += 1;
    if (continuedRequests > requestBudget) {
      await route.abort("blockedbyclient");
      return;
    }

    await route.continue();
  });

  page.on("response", (response) => {
    const host = new URL(response.url()).hostname;
    if (host.endsWith("2dehands.be") && [403, 429].includes(response.status())) {
      blockedByStatus = `${response.status()} from ${response.url()}`;
    }
  });

  try {
    const firstSearchResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/lrp/api/search?")
    );
    await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 45000 });

    const byUrl = new Map();
    const addRawResults = (rawResults) => {
      for (const raw of rawResults) {
        const result = toResult(raw);
        if (
          result.url &&
          result.priceValue !== null &&
          result.priceValue >= minPrice &&
          result.priceValue <= maxPrice &&
          !byUrl.has(result.url)
        ) {
          byUrl.set(result.url, result);
        }
      }
    };

    const firstSearchResponse = await firstSearchResponsePromise;
    apiPageRequests += 1;
    if ([403, 429].includes(firstSearchResponse.status())) {
      await writeCooldown(`${firstSearchResponse.status()} from ${firstSearchResponse.url()}`);
      throw new Error(`2dehands blokkeerde de run: ${firstSearchResponse.status()}`);
    }

    const firstSearchData = await firstSearchResponse.json();
    addRawResults((firstSearchData.listings ?? []).map(toRawResultFromListing));

    const firstSearchUrl = new URL(firstSearchResponse.url());
    const limit = Number.parseInt(firstSearchUrl.searchParams.get("limit") || "30", 10);
    const totalResultCount = Math.min(firstSearchData.totalResultCount ?? limit, maxResults);

    for (let offset = limit; offset < totalResultCount; offset += limit) {
      if (blockedByStatus) {
        await writeCooldown(blockedByStatus);
        throw new Error(`2dehands blokkeerde de run: ${blockedByStatus}`);
      }

      await sleep(delayMs + Math.round(Math.random() * 1000));
      const pageUrl = new URL(firstSearchUrl);
      pageUrl.searchParams.set("offset", String(offset));

      const nextSearchData = await page.evaluate(async (url) => {
        const response = await fetch(url, {
          credentials: "include",
          headers: {
            accept: "application/json"
          }
        });
        const payload = await response.json().catch(() => null);
        return {
          status: response.status,
          url: response.url,
          payload
        };
      }, pageUrl.toString());
      apiPageRequests += 1;

      if ([403, 429].includes(nextSearchData.status)) {
        await writeCooldown(`${nextSearchData.status} from ${nextSearchData.url}`);
        throw new Error(`2dehands blokkeerde de run: ${nextSearchData.status}`);
      }

      addRawResults((nextSearchData.payload?.listings ?? []).map(toRawResultFromListing));
    }

    await page.waitForTimeout(1500);
    for (let scroll = 0; scroll <= maxScrolls; scroll += 1) {
      const domRawResults = await page.evaluate(() => {
        const anchors = [...document.querySelectorAll("a[href*='/v/']")];
        const results = [];
        for (const anchor of anchors) {
          const container =
            anchor.closest("li, article, [data-testid], .hz-Listing, .Listing") ??
            anchor.parentElement;
          const summary = (container?.innerText || anchor.innerText || "")
            .replace(/\s+/g, " ")
            .trim();
          const price = summary.match(/€\s*[\d.\s]+(?:,\d{1,2}|-)?/)?.[0] ?? "";
          const title = (anchor.innerText || "")
            .replace(/\s+/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&#39;/g, "'")
            .trim();
          results.push({
            url: anchor.href,
            title,
            price,
            summary: summary.slice(0, 500)
          });
        }

        function walk(value) {
          if (!value || typeof value !== "object") {
            return;
          }

          if (
            typeof value.itemId === "string" &&
            typeof value.title === "string" &&
            value.priceInfo &&
            typeof value.priceInfo.priceCents === "number" &&
            typeof value.vipUrl === "string"
          ) {
            results.push({
              url: new URL(value.vipUrl, location.origin).href,
              title: value.title.replace(/\s+/g, " ").trim(),
              price: "",
              priceCents: value.priceInfo.priceCents,
              summary: `${value.title} ${value.description || ""}`.replace(/\s+/g, " ").trim().slice(0, 500)
            });
          }

          if (Array.isArray(value)) {
            for (const item of value) {
              walk(item);
            }
            return;
          }

          for (const item of Object.values(value)) {
            walk(item);
          }
        }

        for (const script of document.querySelectorAll("script[type='application/json']")) {
          try {
            walk(JSON.parse(script.textContent || ""));
          } catch {
            // Some JSON script tags can be non-data bootstraps; ignore them.
          }
        }

        return results;
      });
      addRawResults(domRawResults);

      const results = [...byUrl.values()].sort((a, b) => a.priceValue - b.priceValue);
      if (results.length >= maxResults) {
        break;
      }

      await page.mouse.wheel(0, 1800);
      await sleep(delayMs + Math.round(Math.random() * 750));
    }

    return {
      searchUrl: SEARCH_URL,
      requestCount: continuedRequests,
      apiPageRequests,
      results: [...byUrl.values()].sort((a, b) => a.priceValue - b.priceValue)
    };
  } finally {
    await browser.close();
  }
}
