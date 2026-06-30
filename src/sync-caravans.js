import {
  getSheetsClient,
  getSheetTitle,
  quoteSheetRange,
  SPREADSHEET_ID
} from "./google-sheets.js";
import { searchCaravans } from "./tweedehands-search.js";
import { filterCaravanCandidates } from "./caravan-filter.js";

function parseArgs() {
  const args = new Map();
  for (const arg of process.argv.slice(2)) {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    args.set(key, value);
  }
  return {
    dryRun: args.get("dry-run") === "true",
    limit: args.has("limit") ? Number.parseInt(args.get("limit"), 10) : null,
    minPrice: args.has("min-price") ? Number.parseInt(args.get("min-price"), 10) : 100,
    maxPrice: args.has("max-price") ? Number.parseInt(args.get("max-price"), 10) : 3000,
    requestBudget: args.has("request-budget")
      ? Number.parseInt(args.get("request-budget"), 10)
      : 220,
    maxScrolls: args.has("max-scrolls") ? Number.parseInt(args.get("max-scrolls"), 10) : 35
  };
}

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

async function clearHelloWorldIfPresent(sheets, sheetTitle) {
  const range = quoteSheetRange(sheetTitle, "A10");
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range
  });

  if (current.data.values?.[0]?.[0] !== "Hello World") {
    return false;
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range
  });
  return true;
}

async function readExistingRows(sheets, sheetTitle) {
  const range = quoteSheetRange(sheetTitle, "A:F");
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range
  });
  return response.data.values ?? [];
}

async function appendRows(sheets, sheetTitle, rows) {
  if (!rows.length) {
    return null;
  }

  return sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: quoteSheetRange(sheetTitle, "A:F"),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows
    }
  });
}

async function main() {
  const options = parseArgs();
  const sheets = await getSheetsClient();
  const sheetTitle = await getSheetTitle(sheets);
  const cleanedHelloWorld = options.dryRun
    ? false
    : await clearHelloWorldIfPresent(sheets, sheetTitle);
  const existingRows = await readExistingRows(sheets, sheetTitle);
  const existingUrls = new Set(existingRows.map((row) => normalizeExistingUrl(row[0])).filter(Boolean));

  const search = await searchCaravans({
    minPrice: options.minPrice,
    maxPrice: options.maxPrice,
    maxResults: options.limit ?? 300,
    maxScrolls: options.maxScrolls,
    requestBudget: options.requestBudget
  });

  const filtered = filterCaravanCandidates(search.results);
  const newResults = filtered.kept.filter((result) => !existingUrls.has(normalizeExistingUrl(result.url)));
  const selected = options.limit ? newResults.slice(0, options.limit) : newResults;
  const rows = selected.map((result) => [
    result.url,
    result.price,
    "",
    "",
    "",
    result.title.slice(0, 500)
  ]);

  if (!options.dryRun) {
    await appendRows(sheets, sheetTitle, rows);
  }

  console.log(
    JSON.stringify(
      {
        sheetTitle,
        cleanedHelloWorld,
        dryRun: options.dryRun,
        requestCount: search.requestCount,
        apiPageRequests: search.apiPageRequests,
        foundAtOrBelowMaxPrice: search.results.length,
        keptAfterFilter: filtered.kept.length,
        rejectedByFilter: filtered.rejected.length,
        rejectionSummary: filtered.rejected.reduce((summary, item) => {
          summary[item.rejectReason] = (summary[item.rejectReason] ?? 0) + 1;
          return summary;
        }, {}),
        alreadyInSheet: filtered.kept.length - newResults.length,
        appended: options.dryRun ? 0 : rows.length,
        wouldAppend: options.dryRun ? rows.length : undefined,
        rejectedExamples: filtered.rejected.slice(0, 10).map((item) => ({
          title: item.title,
          price: item.price,
          reason: item.rejectReason
        })),
        firstRows: rows.slice(0, 5)
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
