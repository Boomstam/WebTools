import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import fs from "node:fs/promises";

export const SPREADSHEET_ID = "1JmxAQlcqFv6CM10Cz3dlbxVqXEh0BXhl7dQQa0Vw420";
export const SHEET_ID = 1034308374;

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const CREDENTIALS_PATH = "credentials.json";
const TOKEN_PATH = "token.json";

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function fileExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function getOAuthClientConfig(credentials) {
  const config = credentials.installed ?? credentials.web;

  if (!config?.client_id || !config?.client_secret) {
    throw new Error(
      "credentials.json is geen geldige OAuth Client JSON. Maak in Google Cloud een OAuth Client ID van type Desktop app."
    );
  }

  return config;
}

async function loadSavedAuthClient() {
  if (!(await fileExists(CREDENTIALS_PATH)) || !(await fileExists(TOKEN_PATH))) {
    return null;
  }

  const credentials = await readJson(CREDENTIALS_PATH);
  const tokens = await readJson(TOKEN_PATH);
  const config = getOAuthClientConfig(credentials);
  const auth = new google.auth.OAuth2(
    config.client_id,
    config.client_secret,
    config.redirect_uris?.[0]
  );

  auth.setCredentials(tokens);
  return auth;
}

async function saveTokens(auth) {
  await fs.writeFile(TOKEN_PATH, JSON.stringify(auth.credentials, null, 2));
}

async function authorize() {
  const savedAuth = await loadSavedAuthClient();

  if (savedAuth) {
    return savedAuth;
  }

  const auth = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH
  });

  await saveTokens(auth);
  return auth;
}

export async function getSheetsClient() {
  const auth = await authorize();
  return google.sheets({ version: "v4", auth });
}

export async function getSheetTitle(sheets) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: "sheets.properties"
  });

  const sheet = spreadsheet.data.sheets
    ?.map((entry) => entry.properties)
    .find((properties) => properties?.sheetId === SHEET_ID);

  if (!sheet?.title) {
    throw new Error(`Kon geen tabblad vinden met gid/sheetId ${SHEET_ID}.`);
  }

  return sheet.title;
}

export function quoteSheetRange(sheetTitle, a1Range) {
  return `'${sheetTitle.replaceAll("'", "''")}'!${a1Range}`;
}
