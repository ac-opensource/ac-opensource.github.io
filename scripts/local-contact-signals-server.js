const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const ContactTransport = require("../assets/js/contact-transport");
const SignalsContract = require("../assets/js/signals-contract");
const { jsonForInlineScript } = require("./render-signals-page");

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4177;
const DEFAULT_ROOT = path.join(__dirname, "..", "dist");
const FIXTURE_PATH = path.join(__dirname, "fixtures", "contact-signals.local.json");
const MIME = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8"
});

function exactKeys(value, expected) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(Array.from(expected).sort())
  );
}

function loadFixture(fixturePath) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  if (!exactKeys(fixture, ["approvedFeed", "label", "privateResponse", "publicResponse"])) {
    throw new Error("Local Contact/Signals fixture shape is invalid.");
  }
  if (fixture.label !== "LOCAL DEMO DATA — NEVER PUBLISH") {
    throw new Error("Local fixture must retain its unmistakable never-publish label.");
  }
  ContactTransport.validateResponse(fixture.privateResponse, "private");
  ContactTransport.validateResponse(fixture.publicResponse, "public");
  SignalsContract.validateFeed(fixture.approvedFeed);
  return fixture;
}

function replaceRuntime(html, config) {
  const pattern = /(<script\b[^>]*\bid="contact-runtime-config"[^>]*>)[\s\S]*?(<\/script>)/i;
  if (!pattern.test(html)) return html;
  return html.replace(pattern, "$1" + jsonForInlineScript(config) + "$2");
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function sendHtml(response, status, value) {
  const body = String(value);
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function readJsonBody(request, limit) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    request.on("data", function (chunk) {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("REQUEST_BODY_TOO_LARGE"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", function () {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (_error) {
        reject(new Error("INVALID_JSON"));
      }
    });
    request.on("error", reject);
  });
}

function readFormBody(request, limit) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    request.on("data", function (chunk) {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("REQUEST_BODY_TOO_LARGE"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", function () {
      try {
        resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
      } catch (_error) {
        reject(new Error("INVALID_FORM_BODY"));
      }
    });
    request.on("error", reject);
  });
}

function contactPayloadFromForm(parameters) {
  if (parameters.get("website")) throw new Error("AUTOMATION_REJECTED");
  if (parameters.get("storageConsent") !== "yes") throw new Error("STORAGE_CONSENT_REQUIRED");
  const intent = parameters.get("intent") === "public" ? "public" : "private";
  const payload = {
    version: Number(parameters.get("version")),
    submissionId: String(parameters.get("submissionId") || ""),
    intent,
    name: String(parameters.get("name") || ""),
    email: String(parameters.get("email") || ""),
    privateMessage: String(parameters.get("privateMessage") || ""),
    contextPath: String(parameters.get("contextPath") || "")
  };
  if (intent === "public") {
    const mode = parameters.get("publicDisplay") === "named" ? "named" : "anonymous";
    payload.public = {
      quote: String(parameters.get("publicQuote") || ""),
      target: String(parameters.get("publicTarget") || ""),
      display: { mode, label: mode === "named" ? payload.name : "Anonymous" },
      consent: parameters.get("publicConsent") === "yes"
    };
  }
  return ContactTransport.validatePayload(payload);
}

function createRecordStore(databasePath) {
  const database = new Database(databasePath || ":memory:");
  database.exec(`
    CREATE TABLE IF NOT EXISTS contact_records (
      submission_id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL,
      intent TEXT NOT NULL,
      state TEXT NOT NULL,
      version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  const find = database.prepare("SELECT * FROM contact_records WHERE submission_id = ?");
  const insert = database.prepare(`
    INSERT INTO contact_records (
      submission_id, receipt_id, intent, state, version, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const count = database.prepare("SELECT COUNT(*) AS total FROM contact_records");

  return {
    close: function () { database.close(); },
    count: function () { return count.get().total; },
    get: function (submissionId) { return find.get(submissionId) || null; },
    persist: function (payload, responseTemplate) {
      const submissionId = payload.version === 2
        ? payload.submissionId
        : "legacy_" + crypto.randomUUID().replace(/-/g, "");
      const existing = find.get(submissionId);
      if (existing) {
        const existingPayload = JSON.parse(existing.payload_json);
        if (JSON.stringify(existingPayload) !== JSON.stringify(payload)) {
          throw new Error("IDEMPOTENCY_CONFLICT");
        }
        return {
          inserted: false,
          response: {
            version: existing.version,
            receiptId: existing.receipt_id,
            intent: existing.intent,
            state: existing.state
          }
        };
      }
      const response = Object.assign({}, responseTemplate, { version: payload.version });
      ContactTransport.validateResponse(response, payload.intent, payload.version);
      insert.run(
        submissionId,
        response.receiptId,
        response.intent,
        response.state,
        response.version,
        JSON.stringify(payload),
        new Date().toISOString()
      );
      const persisted = find.get(submissionId);
      if (!persisted || persisted.submission_id !== submissionId) throw new Error("LOCAL_RECORD_READBACK_FAILED");
      return { inserted: true, response };
    }
  };
}

function safeStaticPath(rootDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (_error) {
    return null;
  }
  let relative = decoded.replace(/^\/+/, "");
  if (!relative) relative = "index.html";
  if (relative.endsWith("/")) relative += "index.html";
  const candidate = path.resolve(rootDir, relative);
  const root = path.resolve(rootDir);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
  return candidate;
}

function createLocalServer(options) {
  const port = options && options.port ? Number(options.port) : DEFAULT_PORT;
  const rootDir = path.resolve((options && options.rootDir) || DEFAULT_ROOT);
  const fixture = loadFixture((options && options.fixturePath) || FIXTURE_PATH);
  const recordStore = createRecordStore(options && options.databasePath);
  let failOnceAvailable = true;

  const server = http.createServer(async function (request, response) {
    const expectedHost = HOST + ":" + port;
    if (request.headers.host !== expectedHost) {
      sendJson(response, 421, { error: "EXACT_LOOPBACK_HOST_REQUIRED" });
      return;
    }
    const requestUrl = new URL(request.url, "http://" + expectedHost);
    if (requestUrl.pathname === "/__local/contact/signals") {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
        return;
      }
      sendJson(response, 200, fixture.approvedFeed);
      return;
    }
    if (requestUrl.pathname === "/__local/contact/messages") {
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
        return;
      }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
        sendJson(response, 415, { error: "JSON_REQUIRED" });
        return;
      }
      try {
        const payload = ContactTransport.validatePayload(await readJsonBody(request, 16 * 1024));
        const scenario = requestUrl.searchParams.get("scenario") || "";
        if (scenario === "fail-once" && failOnceAvailable) {
          failOnceAvailable = false;
          sendJson(response, 503, { error: "LOCAL_DEMO_FAIL_ONCE" });
          return;
        }
        if (scenario === "invalid-approved" && payload.intent === "public") {
          sendJson(response, 200, {
            version: 1,
            receiptId: "local_invalid_receipt_0001",
            intent: "public",
            state: "approved"
          });
          return;
        }
        const persisted = recordStore.persist(
          payload,
          payload.intent === "public" ? fixture.publicResponse : fixture.privateResponse
        );
        sendJson(response, 200, persisted.response);
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }
      return;
    }
    if (requestUrl.pathname === "/__local/contact/apps-script") {
      if (request.method !== "POST") {
        sendHtml(response, 405, "<!doctype html><p>Method not allowed.</p>");
        return;
      }
      if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
        sendHtml(response, 415, "<!doctype html><p>Form encoding required.</p>");
        return;
      }
      try {
        const delayMs = Math.min(Number(requestUrl.searchParams.get("delayMs") || 0), 1500);
        if (delayMs > 0) await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
        const parameters = await readFormBody(request, 16 * 1024);
        const payload = contactPayloadFromForm(parameters);
        const persisted = recordStore.persist(
          payload,
          payload.intent === "public" ? fixture.publicResponse : fixture.privateResponse
        );
        const returnOrigin = String(parameters.get("returnOrigin") || "");
        if (returnOrigin !== "http://" + expectedHost) throw new Error("RETURN_ORIGIN_INVALID");
        const message = JSON.stringify(Object.assign({
          channel: "ac-contact-v2",
          ok: true,
          requestId: payload.submissionId
        }, persisted.response)).replace(/</g, "\\u003c");
        sendHtml(
          response,
          200,
          "<!doctype html><meta charset=\"utf-8\"><title>Local record stored</title>" +
          "<p>Local record stored.</p><script>window.parent.postMessage(" + message + "," +
          JSON.stringify(returnOrigin) + ");<\/script>"
        );
      } catch (error) {
        sendHtml(response, 400, "<!doctype html><p>Local record was not stored: " + String(error.message) + "</p>");
      }
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
      return;
    }
    const filePath = safeStaticPath(rootDir, requestUrl.pathname);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      sendJson(response, 404, { error: "NOT_FOUND" });
      return;
    }
    let body = fs.readFileSync(filePath);
    if (
      path.extname(filePath).toLowerCase() === ".html" &&
      requestUrl.searchParams.get("publicBoundary") !== "1"
    ) {
      const scenario = requestUrl.searchParams.get("demoScenario");
      const iframeDemo = requestUrl.searchParams.get("iframeDemo") === "1";
      const iframeDelayValue = requestUrl.searchParams.get("iframeDelay");
      const iframeDelayMs = iframeDelayValue === "1"
        ? 180
        : Math.min(Math.max(Number(iframeDelayValue || 0), 0), 1500);
      const endpoint = iframeDemo
        ? "/__local/contact/apps-script" + (iframeDelayMs > 0 ? "?delayMs=" + iframeDelayMs : "")
        : "/__local/contact/messages" + (scenario ? "?scenario=" + encodeURIComponent(scenario) : "");
      const runtime = {
        version: 1,
        enabled: true,
        transport: iframeDemo ? "apps_script_iframe" : "json_endpoint",
        endpoint,
        publicFeedEndpoint: "/__local/contact/signals",
        requestTimeoutMs: 4000
      };
      body = Buffer.from(replaceRuntime(body.toString("utf8"), runtime), "utf8");
    }
    response.writeHead(200, {
      "content-type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "content-length": body.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer"
    });
    if (request.method === "HEAD") response.end();
    else response.end(body);
  });

  return {
    fixture,
    host: HOST,
    port,
    rootDir,
    recordStore,
    server,
    start: function () {
      return new Promise(function (resolve, reject) {
        server.once("error", reject);
        server.listen(port, HOST, function () {
          server.removeListener("error", reject);
          resolve("http://" + HOST + ":" + port);
        });
      });
    },
    stop: function () {
      return new Promise(function (resolve, reject) {
        server.close(function (error) {
          recordStore.close();
          if (error) reject(error);
          else resolve();
        });
      });
    }
  };
}

function argument(name) {
  const prefix = "--" + name + "=";
  const match = process.argv.find(function (value) { return value.startsWith(prefix); });
  return match ? match.slice(prefix.length) : "";
}

async function main() {
  const local = createLocalServer({
    port: Number(argument("port") || DEFAULT_PORT),
    rootDir: argument("root") ? path.resolve(argument("root")) : DEFAULT_ROOT
  });
  const origin = await local.start();
  console.log("Local-only Contact/Signals demo listening on " + origin);
  console.log("Open " + origin + "/contact.html?localDemo=1 or " + origin + "/signals.html?localDemo=1");
}

if (require.main === module) {
  main().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { HOST, createLocalServer, createRecordStore, loadFixture, replaceRuntime, safeStaticPath };
