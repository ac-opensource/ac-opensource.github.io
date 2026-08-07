const crypto = require("crypto");

const ENDPOINT_ENV = "CONTACT_APPS_SCRIPT_ENDPOINT";
const STORED_HEADING = "Contact record stored.";
const NOT_STORED_HEADING = "Contact record was not stored.";
const NOT_STORED_EXPLANATION = "No stored record is being claimed.";
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RESPONSE_LENGTH = 256 * 1024;

function validatedEndpoint(value) {
  const input = String(value || "").trim();
  if (!input) {
    throw new Error(
      "Missing Apps Script endpoint. Pass --endpoint=https://script.google.com/macros/s/<deployment-id>/exec " +
      "or set " + ENDPOINT_ENV + "."
    );
  }

  let endpoint;
  try {
    endpoint = new URL(input);
  } catch (_error) {
    throw new Error("Apps Script endpoint must be an absolute URL.");
  }

  const approved = endpoint.protocol === "https:" &&
    endpoint.hostname === "script.google.com" &&
    !endpoint.username &&
    !endpoint.password &&
    !endpoint.search &&
    !endpoint.hash &&
    /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint.pathname);
  if (!approved) {
    throw new Error(
      "Apps Script endpoint must be exactly HTTPS script.google.com/macros/s/<deployment-id>/exec " +
      "with no credentials, query, or fragment."
    );
  }
  return endpoint.href;
}

function endpointFromArgs(argv, env) {
  const args = Array.isArray(argv) ? argv : [];
  let argumentValue = "";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--endpoint") {
      argumentValue = args[index + 1] || "";
      index += 1;
    } else if (argument.startsWith("--endpoint=")) {
      argumentValue = argument.slice("--endpoint=".length);
    } else if (argument === "--help" || argument === "-h") {
      return { help: true, endpoint: "" };
    } else {
      throw new Error("Unknown argument: " + argument);
    }
  }
  return {
    help: false,
    endpoint: validatedEndpoint(argumentValue || (env && env[ENDPOINT_ENV]))
  };
}

function buildDisposablePayload(options) {
  const now = options && options.now ? Number(options.now) : Date.now();
  const randomBytes = options && options.randomBytes ? options.randomBytes : crypto.randomBytes;
  const suffix = randomBytes(12).toString("hex");
  return Object.freeze({
    version: "2",
    submissionId: "contact_deploy_verify_" + suffix,
    returnOrigin: "",
    startedAt: String(now - 2000),
    website: "",
    intent: "private",
    name: "Disposable verifier",
    email: "contact-verifier+" + suffix + "@example.invalid",
    privateMessage: "Disposable deployment verification record. Inspect this row, then delete it when verification is complete.",
    contextPath: "/contact.html?verification=manual",
    storageConsent: "yes"
  });
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, function (_match, decimal) { return String.fromCodePoint(Number(decimal)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_match, hexadecimal) { return String.fromCodePoint(parseInt(hexadecimal, 16)); })
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function elementText(html, tagName) {
  const match = String(html || "").match(new RegExp("<" + tagName + "\\b[^>]*>([\\s\\S]*?)<\\/" + tagName + ">", "i"));
  if (!match) return "";
  return decodeHtml(match[1].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function visibleText(html) {
  return decodeHtml(
    String(html || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function appsScriptUserHtml(html) {
  const source = String(html || "");
  const match = source.match(/\\x22userHtml\\x22:\\x22([\s\S]*?)\\x22,\\x22ncc\\x22/);
  if (!match) return source;

  try {
    const jsonEscapedHtml = JSON.parse(
      "\"" + match[1].replace(/\\x([0-9a-f]{2})/gi, "\\u00$1") + "\""
    );
    return JSON.parse("\"" + jsonEscapedHtml + "\"");
  } catch (_error) {
    return source;
  }
}

function parseAcknowledgement(html) {
  const acknowledgementHtml = appsScriptUserHtml(html);
  const heading = elementText(acknowledgementHtml, "h1");
  const text = visibleText(acknowledgementHtml);
  if (heading === STORED_HEADING) {
    const receiptMatch = text.match(/\bopaque receipt is ([A-Za-z0-9_-]{8,128})\./i);
    if (!receiptMatch) throw new Error("Stored acknowledgement did not expose an opaque receipt.");
    return { stored: true, receiptId: receiptMatch[1] };
  }
  if (heading === NOT_STORED_HEADING && text.includes(NOT_STORED_EXPLANATION)) {
    return { stored: false, receiptId: "" };
  }
  throw new Error("Endpoint returned neither the explicit stored page nor the explicit not-stored page.");
}

async function postForm(endpoint, payload, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams(payload),
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });
    if (!response || !response.ok) {
      throw new Error("Apps Script POST failed with HTTP " + (response ? response.status : "unknown") + ".");
    }
    const contentType = String(response.headers && response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html")) {
      throw new Error("Apps Script acknowledgement must be HTML, received " + (contentType || "an unknown content type") + ".");
    }
    const html = await response.text();
    if (!html || html.length > MAX_RESPONSE_LENGTH) {
      throw new Error("Apps Script acknowledgement was empty or unexpectedly large.");
    }
    return parseAcknowledgement(html);
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyDeployment(options) {
  const endpoint = validatedEndpoint(options && options.endpoint);
  const fetchImpl = options && options.fetchImpl ? options.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("This verifier requires a fetch implementation.");
  const payload = options && options.payload ? Object.freeze(Object.assign({}, options.payload)) : buildDisposablePayload();

  const first = await postForm(endpoint, payload, fetchImpl);
  if (!first.stored) throw new Error("Initial disposable record was explicitly not stored.");

  const replay = await postForm(endpoint, payload, fetchImpl);
  if (!replay.stored) throw new Error("Identical replay was explicitly not stored.");
  if (replay.receiptId !== first.receiptId) {
    throw new Error("Identical replay returned a different receipt; idempotency is not proven.");
  }

  const mutation = Object.assign({}, payload, {
    privateMessage: payload.privateMessage + " Mutated-content conflict probe."
  });
  const conflict = await postForm(endpoint, mutation, fetchImpl);
  if (conflict.stored) {
    throw new Error("Mutated content with the same request ID was reported stored; idempotency conflict handling failed.");
  }

  return Object.freeze({
    submissionId: payload.submissionId,
    receiptId: first.receiptId
  });
}

function usage() {
  return [
    "Verify a deployed personal Contact Apps Script with one disposable private record.",
    "",
    "Usage:",
    "  npm run contact:verify-apps-script -- --endpoint=https://script.google.com/macros/s/<deployment-id>/exec",
    "  " + ENDPOINT_ENV + "=https://script.google.com/macros/s/<deployment-id>/exec npm run contact:verify-apps-script",
    "",
    "The command creates one row. Inspect that private Sheet row manually and delete it afterward if desired."
  ].join("\n");
}

async function main() {
  const parsed = endpointFromArgs(process.argv.slice(2), process.env);
  if (parsed.help) {
    console.log(usage());
    return;
  }
  const result = await verifyDeployment({ endpoint: parsed.endpoint });
  console.log("Contact Apps Script acknowledgement checks passed.");
  console.log("Request ID: " + result.submissionId);
  console.log("Opaque receipt: " + result.receiptId);
  console.log(
    "Evidence boundary: this proves only that the deployed Apps Script reported its own Sheet flush/readback acknowledgement, " +
    "stable idempotent replay, and conflict rejection."
  );
  console.log(
    "Required manual check: inspect the private Sheet for exactly one row with this Request ID and matching disposable fields; " +
    "then delete the row if it is no longer needed."
  );
}

if (require.main === module) {
  main().catch(function (error) {
    console.error("Contact Apps Script verification failed: " + (error && error.message ? error.message : String(error)));
    process.exitCode = 1;
  });
}

module.exports = {
  ENDPOINT_ENV,
  appsScriptUserHtml,
  buildDisposablePayload,
  endpointFromArgs,
  parseAcknowledgement,
  postForm,
  validatedEndpoint,
  verifyDeployment
};
