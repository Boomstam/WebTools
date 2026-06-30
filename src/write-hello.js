import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import fs from "node:fs/promises";
import process from "node:process";

const SPREADSHEET_ID = "1JmxAQlcqFv6CM10Cz3dlbxVqXEh0BXhl7dQQa0Vw420";
const SHEET_ID = 1034308374;
const CELL = "A10";
const VALUE = "Hello World";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const CREDENTIALS_PATH = "credentials.json";
const WINDOWS_DOUBLE_EXTENSION_CREDENTIALS_PATH = "credentials.json.json";
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

async function getCredentialsPath() {
  if (await fileExists(CREDENTIALS_PATH)) {
    return CREDENTIALS_PATH;
  }

  if (await fileExists(WINDOWS_DOUBLE_EXTENSION_CREDENTIALS_PATH)) {
    console.warn(
      `Gebruik ${WINDOWS_DOUBLE_EXTENSION_CREDENTIALS_PATH}. Tip: hernoem dit later naar ${CREDENTIALS_PATH}.`
    );
    return WINDOWS_DOUBLE_EXTENSION_CREDENTIALS_PATH;
  }

  return CREDENTIALS_PATH;
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
  try {
    const credentialsPath = await getCredentialsPath();
    const credentials = await readJson(credentialsPath);
    const tokens = await readJson(TOKEN_PATH);
    const config = getOAuthClientConfig(credentials);
    const auth = new google.auth.OAuth2(
      config.client_id,
      config.client_secret,
      config.redirect_uris?.[0]
    );

    auth.setCredentials(tokens);
    return auth;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function saveTokens(auth) {
  await fs.writeFile(TOKEN_PATH, JSON.stringify(auth.credentials, null, 2));
}

async function authorize() {
  const savedAuth = await loadSavedAuthClient();

  if (savedAuth) {
    return savedAuth;
  }

  try {
    const auth = await authenticate({
      scopes: SCOPES,
      keyfilePath: await getCredentialsPath()
    });

    await saveTokens(auth);
    return auth;
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND" || error.message.includes(CREDENTIALS_PATH)) {
      throw new Error(
        `Zet eerst je Google OAuth Desktop-client in deze map als ${CREDENTIALS_PATH}.`
      );
    }

    throw error;
  }
}

async function main() {
  const auth = await authorize();

  const sheets = google.sheets({ version: "v4", auth });
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

  const range = `'${sheet.title.replaceAll("'", "''")}'!${CELL}`;

  const result = await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: "RAW",
    requestBody: {
      values: [[VALUE]]
    }
  });

  const verification = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range
  });

  console.log(
    `Wrote "${VALUE}" to ${result.data.updatedRange}. Updated cells: ${result.data.updatedCells ?? 0}. Read back: "${verification.data.values?.[0]?.[0] ?? ""}"`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
