const CONTACT_SCHEMA_VERSION = 2;
const CONTACT_CHANNEL = "ac-contact-v2";
const CONTACT_HEADERS = Object.freeze([
  "record_id",
  "request_id",
  "received_at",
  "intent",
  "name",
  "email",
  "private_message",
  "public_quote",
  "public_target",
  "public_display",
  "public_consent",
  "source_path",
  "notification_status",
  "schema_version"
]);
const CONTACT_TARGETS = Object.freeze(["dashboard", "portfolio", "logs", "about", "contact", "resume", "skills"]);
const CONTACT_PARAMETER_NAMES = Object.freeze([
  "version",
  "submissionId",
  "returnOrigin",
  "startedAt",
  "website",
  "intent",
  "name",
  "email",
  "privateMessage",
  "contextPath",
  "publicQuote",
  "publicTarget",
  "publicDisplay",
  "publicConsent",
  "storageConsent"
]);

function doGet() {
  return HtmlService.createHtmlOutput(
    "<!doctype html><meta charset=\"utf-8\"><title>Contact record service</title>" +
    "<p>Contact record service endpoint. A stored record is claimed only by a valid submission receipt.</p>"
  );
}

function doPost(event) {
  const parameters = event && event.parameter ? event.parameter : {};
  let requestId = "";
  let returnOrigin = "";
  try {
    requestId = normalizedRequestId_(parameters.submissionId);
    returnOrigin = allowedReturnOrigin_(parameters.returnOrigin);
    const payload = validateContactParameters_(parameters, requestId);
    const result = storeContactRecord_(payload);
    return acknowledgementPage_({
      channel: CONTACT_CHANNEL,
      ok: true,
      requestId: payload.submissionId,
      version: payload.version,
      receiptId: result.recordId,
      intent: payload.intent,
      state: payload.intent === "public" ? "pending_moderation" : "confirmed"
    }, returnOrigin);
  } catch (error) {
    console.error(JSON.stringify({
      event: "contact_record_failed",
      requestId: requestId,
      error: safeErrorCode_(error)
    }));
    return acknowledgementPage_({
      channel: CONTACT_CHANNEL,
      ok: false,
      requestId: requestId,
      code: safeErrorCode_(error)
    }, returnOrigin);
  }
}

function setupContactSheet() {
  const sheet = contactSheet_();
  ensureHeader_(sheet);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, CONTACT_HEADERS.length);
  return sheet.getName();
}

function storeContactRecord_(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = contactSheet_();
    ensureHeader_(sheet);
    const existing = findRequestRow_(sheet, payload.submissionId);
    if (existing) {
      if (!storedPayloadMatches_(existing.values, payload)) {
        throw new Error("IDEMPOTENCY_CONFLICT");
      }
      return { recordId: String(existing.values[0]), storedAt: existing.values[2], duplicate: true };
    }

    const recordId = Utilities.getUuid();
    const receivedAt = new Date();
    const publicPayload = payload.public || null;
    sheet.appendRow([
      recordId,
      payload.submissionId,
      receivedAt,
      payload.intent,
      sheetSafe_(payload.name),
      sheetSafe_(payload.email),
      sheetSafe_(payload.privateMessage),
      publicPayload ? sheetSafe_(publicPayload.quote) : "",
      publicPayload ? publicPayload.target : "",
      publicPayload ? publicPayload.display : "",
      publicPayload ? "yes" : "no",
      sheetSafe_(payload.contextPath),
      "pending",
      payload.version
    ]);
    SpreadsheetApp.flush();

    const lastRow = sheet.getLastRow();
    const persisted = sheet.getRange(lastRow, 1, 1, CONTACT_HEADERS.length).getValues()[0];
    if (String(persisted[0]) !== recordId || String(persisted[1]) !== payload.submissionId) {
      throw new Error("ROW_READBACK_MISMATCH");
    }
    return { recordId: recordId, storedAt: receivedAt, duplicate: false };
  } finally {
    lock.releaseLock();
  }
}

function storedPayloadMatches_(values, payload) {
  const publicPayload = payload.public || null;
  const expected = [
    payload.intent,
    sheetSafe_(payload.name),
    sheetSafe_(payload.email),
    sheetSafe_(payload.privateMessage),
    publicPayload ? sheetSafe_(publicPayload.quote) : "",
    publicPayload ? publicPayload.target : "",
    publicPayload ? publicPayload.display : "",
    publicPayload ? "yes" : "no",
    sheetSafe_(payload.contextPath),
    payload.version
  ];
  const actual = values.slice(3, 12).concat(Number(values[13]));
  return JSON.stringify(actual.map(String)) === JSON.stringify(expected.map(String));
}

function validateContactParameters_(parameters, requestId) {
  Object.keys(parameters).forEach(function (key) {
    if (CONTACT_PARAMETER_NAMES.indexOf(key) === -1) throw new Error("UNKNOWN_FIELD");
  });
  if (String(parameters.website || "")) throw new Error("AUTOMATION_REJECTED");
  if (String(parameters.storageConsent || "") !== "yes") throw new Error("STORAGE_CONSENT_REQUIRED");

  const version = Number(parameters.version);
  if (version !== CONTACT_SCHEMA_VERSION) throw new Error("SCHEMA_VERSION_INVALID");
  const intent = String(parameters.intent || "");
  if (intent !== "private" && intent !== "public") throw new Error("INTENT_INVALID");
  const name = validText_(parameters.name, 2, 80, "NAME_INVALID");
  const email = validText_(parameters.email, 5, 254, "EMAIL_INVALID");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("EMAIL_INVALID");
  const privateMessage = validText_(parameters.privateMessage, intent === "public" ? 0 : 1, 4000, "MESSAGE_INVALID");
  const contextPath = validText_(parameters.contextPath, 1, 240, "CONTEXT_INVALID");
  if (contextPath.charAt(0) !== "/" || /^\/\//.test(contextPath) || /(?:https?:|mailto:|javascript:)/i.test(contextPath)) {
    throw new Error("CONTEXT_INVALID");
  }

  const startedAt = Number(parameters.startedAt || 0);
  if (startedAt && (Date.now() - startedAt < 800 || Date.now() - startedAt > 86400000)) {
    throw new Error("INTERACTION_TIME_INVALID");
  }

  const payload = {
    version: version,
    submissionId: requestId,
    intent: intent,
    name: name,
    email: email,
    privateMessage: privateMessage,
    contextPath: contextPath
  };
  if (intent === "public") {
    const quote = validText_(parameters.publicQuote, 1, 280, "PUBLIC_QUOTE_INVALID");
    const target = String(parameters.publicTarget || "");
    if (CONTACT_TARGETS.indexOf(target) === -1) throw new Error("PUBLIC_TARGET_INVALID");
    const display = String(parameters.publicDisplay || "");
    if (display !== "anonymous" && display !== "named") throw new Error("PUBLIC_DISPLAY_INVALID");
    if (String(parameters.publicConsent || "") !== "yes") throw new Error("PUBLIC_CONSENT_REQUIRED");
    payload.public = { quote: quote, target: target, display: display };
  }
  return payload;
}

function contactSheet_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = String(properties.getProperty("SPREADSHEET_ID") || "").trim();
  const sheetName = String(properties.getProperty("SHEET_NAME") || "Contact Records").trim();
  if (!spreadsheetId) throw new Error("SPREADSHEET_NOT_CONFIGURED");
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
}

function ensureHeader_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, CONTACT_HEADERS.length).setValues([CONTACT_HEADERS]);
    SpreadsheetApp.flush();
    return;
  }
  const actual = sheet.getRange(1, 1, 1, CONTACT_HEADERS.length).getDisplayValues()[0];
  if (JSON.stringify(actual) !== JSON.stringify(CONTACT_HEADERS)) throw new Error("SHEET_HEADER_MISMATCH");
}

function findRequestRow_(sheet, requestId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const match = sheet.getRange(2, 2, lastRow - 1, 1)
    .createTextFinder(requestId)
    .matchEntireCell(true)
    .findNext();
  if (!match) return null;
  return {
    row: match.getRow(),
    values: sheet.getRange(match.getRow(), 1, 1, CONTACT_HEADERS.length).getValues()[0]
  };
}

function normalizedRequestId_(value) {
  const candidate = String(value || "").trim();
  if (candidate) {
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(candidate)) throw new Error("REQUEST_ID_INVALID");
    return candidate;
  }
  return "contact_" + Utilities.getUuid().replace(/-/g, "");
}

function validText_(value, minimum, maximum, errorCode) {
  const text = String(value || "");
  if (text !== text.trim() || text.length < minimum || text.length > maximum) throw new Error(errorCode);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/.test(text)) {
    throw new Error(errorCode);
  }
  return text;
}

function sheetSafe_(value) {
  const text = String(value == null ? "" : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function allowedReturnOrigin_(value) {
  const origin = String(value || "").trim();
  if (!origin) return "";
  const configured = String(PropertiesService.getScriptProperties().getProperty("ALLOWED_ORIGINS") || "https://ac-opensource.github.io")
    .split(",")
    .map(function (entry) { return entry.trim(); })
    .filter(String);
  return configured.indexOf(origin) === -1 ? "" : origin;
}

function acknowledgementPage_(message, returnOrigin) {
  const safeMessage = JSON.stringify(message).replace(/</g, "\\u003c").replace(/-->/g, "--\\u003e");
  const safeOrigin = JSON.stringify(returnOrigin || "");
  const success = message.ok === true;
  const script = returnOrigin
    ? "<script>window.top.postMessage(" + safeMessage + "," + safeOrigin + ");<\/script>"
    : "";
  const html = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>" + (success ? "Contact stored" : "Contact not stored") + "</title></head><body>" +
    "<main><h1>" + (success ? "Contact record stored." : "Contact record was not stored.") + "</h1>" +
    "<p>" + (success
      ? "You may return to the portfolio. The opaque receipt is " + htmlEscape_(message.receiptId) + "."
      : "Return to the portfolio and retry. No stored record is being claimed.") + "</p></main>" + script + "</body></html>";
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function safeErrorCode_(error) {
  const value = error && error.message ? String(error.message) : "CONTACT_RECORD_FAILED";
  return /^[A-Z0-9_]{3,64}$/.test(value) ? value : "CONTACT_RECORD_FAILED";
}

function htmlEscape_(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
