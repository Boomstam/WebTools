import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getSheetsClient,
  getSheetTitle,
  quoteSheetRange,
  SPREADSHEET_ID
} from "./google-sheets.js";
import { searchCaravans } from "./tweedehands-search.js";
import { filterCaravanCandidates } from "./caravan-filter.js";
import { suggestCaravanFields } from "./caravan-suggestions.js";

const PORT = Number.parseInt(process.env.PORT || "5173", 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "web");
const STATE_DIR = ".review-state";
const STATE_PATH = path.join(STATE_DIR, "caravan-review.json");

let appState = {
  loading: false,
  loadedAt: null,
  error: null,
  stats: null,
  candidates: [],
  decisions: {}
};

function normalizeExistingUrl(value) {
  if (!value || !value.startsWith("http")) return "";
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
}

async function readReviewState() {
  try {
    return JSON.parse(await fs.readFile(STATE_PATH, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return { decisions: {} };
    }
    throw error;
  }
}

async function writeReviewState() {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(
    STATE_PATH,
    JSON.stringify({ decisions: appState.decisions }, null, 2)
  );
}

async function readExistingUrls(sheets, sheetTitle) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: quoteSheetRange(sheetTitle, "A:F")
  });
  const rows = response.data.values ?? [];
  return new Set(rows.map((row) => normalizeExistingUrl(row[0])).filter(Boolean));
}

function candidateForClient(candidate) {
  const suggestions = suggestCaravanFields(candidate);
  return {
    url: candidate.url,
    price: candidate.price,
    title: candidate.title,
    summary: candidate.summary,
    suggestions,
    decision: appState.decisions[candidate.url]?.decision ?? null
  };
}

async function loadCandidates({ force = false } = {}) {
  if (appState.loading) return;
  if (appState.loadedAt && !force) return;

  appState.loading = true;
  appState.error = null;

  try {
    const savedState = await readReviewState();
    appState.decisions = savedState.decisions ?? {};

    const sheets = await getSheetsClient();
    const sheetTitle = await getSheetTitle(sheets);
    const existingUrls = await readExistingUrls(sheets, sheetTitle);
    const search = await searchCaravans({
      maxScrolls: 0,
      requestBudget: 160,
      maxResults: 300
    });
    const filtered = filterCaravanCandidates(search.results);
    const candidates = filtered.kept
      .filter((candidate) => !existingUrls.has(normalizeExistingUrl(candidate.url)))
      .filter((candidate) => appState.decisions[candidate.url]?.decision !== "no")
      .filter((candidate) => appState.decisions[candidate.url]?.decision !== "yes")
      .map(candidateForClient);

    appState = {
      ...appState,
      loading: false,
      loadedAt: new Date().toISOString(),
      error: null,
      candidates,
      stats: {
        sheetTitle,
        foundAtOrBelowMaxPrice: search.results.length,
        keptAfterFilter: filtered.kept.length,
        rejectedByFilter: filtered.rejected.length,
        alreadyInSheet: filtered.kept.length - candidates.length,
        reviewQueue: candidates.length,
        apiPageRequests: search.apiPageRequests
      }
    };
  } catch (error) {
    appState.loading = false;
    appState.error = error.stack || error.message;
  }
}

async function appendCandidate({ url, prijs, grootte, rijdtNog, staat, opmerking }) {
  const sheets = await getSheetsClient();
  const sheetTitle = await getSheetTitle(sheets);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: quoteSheetRange(sheetTitle, "A:F"),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[url, prijs || "", grootte || "", rijdtNog || "", staat || "", opmerking || ""]]
    }
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function proxyTweedehandsDetail(url, response) {
  let target;
  try {
    target = new URL(url);
  } catch {
    response.writeHead(400);
    response.end("Bad proxy URL");
    return;
  }

  const isAllowed =
    target.protocol === "https:" &&
    target.hostname === "www.2dehands.be" &&
    target.pathname.startsWith("/v/caravans-en-kamperen/caravans/");

  if (!isAllowed) {
    response.writeHead(403);
    response.end("Proxy URL not allowed");
    return;
  }

  const upstream = await fetch(target, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "accept-language": "nl-BE,nl;q=0.9,fr;q=0.8,en;q=0.6"
    }
  });

  let html = await upstream.text();
  html = html.replace(
    /<head([^>]*)>/i,
    `<head$1><base href="https://www.2dehands.be/"><style>body{min-height:100vh}</style><script>
      window.addEventListener("keydown", function(event) {
        if (["ArrowLeft", "ArrowRight", "y", "Y", "n", "N"].includes(event.key)) {
          parent.postMessage({ type: "review-key", key: event.key }, "*");
          event.preventDefault();
        }
      }, true);
    </script>`
  );
  response.writeHead(upstream.status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(html);
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8"
    };
    response.writeHead(200, { "content-type": contentTypes[ext] || "application/octet-stream" });
    response.end(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/candidates") {
      await loadCandidates({ force: url.searchParams.get("refresh") === "1" });
      sendJson(response, 200, {
        loading: appState.loading,
        loadedAt: appState.loadedAt,
        error: appState.error,
        stats: appState.stats,
        candidates: appState.candidates
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/decision") {
      const body = await readJsonBody(request);
      const candidate = appState.candidates.find((item) => item.url === body.url);
      if (!candidate) {
        sendJson(response, 404, { error: "Candidate not found" });
        return;
      }

      if (body.decision === "yes") {
        await appendCandidate({
          url: candidate.url,
          prijs: candidate.price,
          grootte: body.grootte,
          rijdtNog: body.rijdtNog,
          staat: body.staat,
          opmerking: candidate.title
        });
      }

      appState.decisions[candidate.url] = {
        decision: body.decision,
        decidedAt: new Date().toISOString()
      };
      appState.candidates = appState.candidates.filter((item) => item.url !== candidate.url);
      if (appState.stats) {
        appState.stats.reviewQueue = appState.candidates.length;
      }
      await writeReviewState();
      sendJson(response, 200, { ok: true, remaining: appState.candidates.length });
      return;
    }

    if (request.method === "GET" && url.pathname === "/proxy") {
      await proxyTweedehandsDetail(url.searchParams.get("url"), response);
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, 500, { error: error.stack || error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Review app running at http://localhost:${PORT}`);
});
