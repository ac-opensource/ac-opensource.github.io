const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SCRIPT_PATH = path.join(ROOT, "integrations", "google-apps-script", "contact-records", "Code.gs");
const ALLOWED_ORIGIN = "https://ac-opensource.github.io";
const CONTACT_HEADERS = [
  "record_id", "request_id", "received_at", "intent", "name", "email", "private_message",
  "public_quote", "public_target", "public_display", "public_consent", "source_path",
  "notification_status", "schema_version"
];

function createAppsScriptHarness() {
  const state = {
    rows: [], pendingWrites: [], operations: [], flushCount: 0, logs: [], uuidCount: 0
  };

  function committedCell(row, column) {
    return state.rows[row - 1] && state.rows[row - 1][column - 1];
  }

  class RangeMock {
    constructor(row, column, rowCount, columnCount) {
      this.row = row;
      this.column = column;
      this.rowCount = rowCount;
      this.columnCount = columnCount;
    }

    setValues(values) {
      state.operations.push("setValues:" + this.row);
      state.pendingWrites.push(() => {
        for (let rowOffset = 0; rowOffset < this.rowCount; rowOffset += 1) {
          const rowIndex = this.row - 1 + rowOffset;
          state.rows[rowIndex] = state.rows[rowIndex] || [];
          for (let columnOffset = 0; columnOffset < this.columnCount; columnOffset += 1) {
            state.rows[rowIndex][this.column - 1 + columnOffset] = values[rowOffset][columnOffset];
          }
        }
      });
      return this;
    }

    getValues() {
      state.operations.push("getValues:" + this.row);
      return Array.from({ length: this.rowCount }, (_, rowOffset) =>
        Array.from({ length: this.columnCount }, (_, columnOffset) =>
          committedCell(this.row + rowOffset, this.column + columnOffset)
        )
      );
    }

    getDisplayValues() {
      return this.getValues().map((row) => row.map((value) => String(value == null ? "" : value)));
    }

    createTextFinder(query) {
      const range = this;
      let exact = false;
      return {
        matchEntireCell(value) {
          exact = value === true;
          return this;
        },
        findNext() {
          for (let rowOffset = 0; rowOffset < range.rowCount; rowOffset += 1) {
            for (let columnOffset = 0; columnOffset < range.columnCount; columnOffset += 1) {
              const cell = committedCell(range.row + rowOffset, range.column + columnOffset);
              const value = String(cell == null ? "" : cell);
              if ((exact && value === query) || (!exact && value.includes(query))) {
                const matchedRow = range.row + rowOffset;
                return { getRow: () => matchedRow };
              }
            }
          }
          return null;
        }
      };
    }
  }

  const sheet = {
    getName: () => "Contact Records",
    getLastRow: () => state.rows.length,
    getRange: (row, column, rowCount, columnCount) => new RangeMock(row, column, rowCount, columnCount),
    appendRow(values) {
      state.operations.push("appendRow");
      state.pendingWrites.push(() => state.rows.push(values.slice()));
      return this;
    },
    setFrozenRows() {},
    autoResizeColumns() {}
  };
  const spreadsheet = {
    getSheetByName: () => sheet,
    insertSheet: () => sheet
  };
  const scriptProperties = new Map([
    ["SPREADSHEET_ID", "test-spreadsheet"],
    ["SHEET_NAME", "Contact Records"],
    ["ALLOWED_ORIGINS", ALLOWED_ORIGIN + ",https://preview.example.test"]
  ]);
  const sandbox = {
    console: Object.fromEntries(["error", "warn", "log", "info"].map((level) => [
      level,
      (...values) => state.logs.push(level + ":" + values.map(String).join(" "))
    ])),
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: "ALLOWALL" },
      createHtmlOutput(content) {
        return {
          content,
          xFrameOptionsMode: null,
          setXFrameOptionsMode(mode) {
            this.xFrameOptionsMode = mode;
            return this;
          }
        };
      }
    },
    LockService: {
      getScriptLock() {
        return {
          waitLock: () => state.operations.push("waitLock"),
          releaseLock: () => state.operations.push("releaseLock")
        };
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return { getProperty: (key) => scriptProperties.get(key) || null };
      }
    },
    SpreadsheetApp: {
      openById(id) {
        assert.strictEqual(id, "test-spreadsheet");
        return spreadsheet;
      },
      flush() {
        state.operations.push("flush");
        state.flushCount += 1;
        state.pendingWrites.splice(0).forEach((write) => write());
      }
    },
    Utilities: {
      getUuid() {
        state.uuidCount += 1;
        return "00000000-0000-4000-8000-" + String(state.uuidCount).padStart(12, "0");
      }
    }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SCRIPT_PATH, "utf8"), context, { filename: SCRIPT_PATH });
  const doPost = vm.runInContext("doPost", context);
  return { state, submit: (parameters) => doPost({ parameter: parameters }) };
}

function extractAcknowledgement(output) {
  const scriptMatch = output.content.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) return null;
  let acknowledgement = null;
  vm.runInNewContext(scriptMatch[1], {
    window: { top: { postMessage: (message, origin) => { acknowledgement = { message, origin }; } } }
  });
  return acknowledgement;
}

function privateRequest(overrides) {
  return Object.assign({
    version: "2",
    submissionId: "contact_apps_script_test_0001",
    returnOrigin: ALLOWED_ORIGIN,
    startedAt: "",
    website: "",
    intent: "private",
    name: "Test Operator",
    email: "operator@example.test",
    privateMessage: "Hi!",
    contextPath: "/contact.html",
    publicQuote: "",
    publicTarget: "",
    publicDisplay: "",
    publicConsent: "",
    storageConsent: "yes"
  }, overrides || {});
}

function publicRequest(overrides) {
  return Object.assign(privateRequest(), {
    submissionId: "contact_apps_script_public_0001",
    intent: "public",
    privateMessage: "",
    publicQuote: "K",
    publicTarget: "portfolio",
    publicDisplay: "anonymous",
    publicConsent: "yes"
  }, overrides || {});
}

function assertSuccess(output, requestId, expected) {
  const acknowledgement = extractAcknowledgement(output);
  const expectedIntent = expected && expected.intent ? expected.intent : "private";
  const expectedState = expected && expected.state ? expected.state : "confirmed";
  assert(acknowledgement, "expected an acknowledgement postMessage");
  assert.strictEqual(acknowledgement.origin, ALLOWED_ORIGIN);
  assert.strictEqual(acknowledgement.message.channel, "ac-contact-v2");
  assert.strictEqual(acknowledgement.message.ok, true);
  assert.strictEqual(acknowledgement.message.requestId, requestId);
  assert.strictEqual(acknowledgement.message.version, 2);
  assert.strictEqual(acknowledgement.message.intent, expectedIntent);
  assert.strictEqual(acknowledgement.message.state, expectedState);
  assert.match(acknowledgement.message.receiptId, /^[0-9a-f-]{36}$/);
  return acknowledgement.message;
}

function assertFailure(output, expectedCode, requestId) {
  const acknowledgement = extractAcknowledgement(output);
  assert(acknowledgement, "expected a failure acknowledgement postMessage");
  assert.strictEqual(acknowledgement.origin, ALLOWED_ORIGIN);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(acknowledgement.message)), {
    channel: "ac-contact-v2", ok: false, requestId, code: expectedCode
  });
}

function run() {
  const harness = createAppsScriptHarness();
  const firstRequest = privateRequest();
  const first = assertSuccess(harness.submit(firstRequest), firstRequest.submissionId);

  assert.deepStrictEqual(harness.state.rows[0], CONTACT_HEADERS);
  assert.strictEqual(harness.state.rows.length, 2);
  assert.strictEqual(harness.state.rows[1][0], first.receiptId);
  assert.strictEqual(harness.state.rows[1][1], firstRequest.submissionId);
  assert.strictEqual(harness.state.rows[1][6], firstRequest.privateMessage);
  assert.strictEqual(harness.state.rows[1][12], "pending");

  const emptyMessageId = "contact_apps_script_test_empty";
  assertFailure(harness.submit(privateRequest({ submissionId: emptyMessageId, privateMessage: "" })),
    "MESSAGE_INVALID", emptyMessageId);
  assert.strictEqual(harness.state.rows.length, 2, "empty private message must not append a row");
  const appendIndex = harness.state.operations.indexOf("appendRow");
  const persistenceFlushIndex = harness.state.operations.indexOf("flush", appendIndex);
  const readbackIndex = harness.state.operations.indexOf("getValues:2", persistenceFlushIndex);
  assert(appendIndex >= 0 && persistenceFlushIndex > appendIndex && readbackIndex > persistenceFlushIndex,
    "record acknowledgement must follow append, flush, and readback");

  const duplicate = assertSuccess(harness.submit(firstRequest), firstRequest.submissionId);
  assert.strictEqual(duplicate.receiptId, first.receiptId);
  assert.strictEqual(harness.state.rows.length, 2, "retry must not append a second row");

  const changedSecret = "A changed private message that must never be written to logs.";
  assertFailure(harness.submit(privateRequest({ privateMessage: changedSecret })),
    "IDEMPOTENCY_CONFLICT", firstRequest.submissionId);
  assert.strictEqual(harness.state.rows.length, 2, "idempotency conflict must not append a row");

  const invalidConsentId = "contact_apps_script_test_0002";
  assertFailure(harness.submit(privateRequest({ submissionId: invalidConsentId, storageConsent: "no" })),
    "STORAGE_CONSENT_REQUIRED", invalidConsentId);
  assert.strictEqual(harness.state.rows.length, 2, "invalid consent must not append a row");

  const formulaRequest = privateRequest({
    submissionId: "contact_apps_script_test_0003",
    name: "=SUM(A1:A2)",
    privateMessage: "+CMD formula-like private content remains plain text."
  });
  assertSuccess(harness.submit(formulaRequest), formulaRequest.submissionId);
  assert.strictEqual(harness.state.rows.length, 3);
  assert.strictEqual(harness.state.rows[2][4], "'=SUM(A1:A2)");
  assert.strictEqual(harness.state.rows[2][6], "'+CMD formula-like private content remains plain text.");

  const publicFeedback = publicRequest();
  assertSuccess(harness.submit(publicFeedback), publicFeedback.submissionId, {
    intent: "public",
    state: "pending_moderation"
  });
  assert.strictEqual(harness.state.rows.length, 4);
  assert.strictEqual(harness.state.rows[3][3], "public");
  assert.strictEqual(harness.state.rows[3][6], "");
  assert.strictEqual(harness.state.rows[3][7], "K");
  assert.strictEqual(harness.state.rows[3][10], "yes");

  const blankQuoteId = "contact_apps_script_public_blank";
  assertFailure(harness.submit(publicRequest({ submissionId: blankQuoteId, publicQuote: "" })),
    "PUBLIC_QUOTE_INVALID", blankQuoteId);
  assert.strictEqual(harness.state.rows.length, 4, "blank public quote must not append a row");

  const lookalikeOriginOutput = harness.submit(Object.assign({}, formulaRequest, {
    returnOrigin: ALLOWED_ORIGIN + ".attacker.example"
  }));
  assert.strictEqual(extractAcknowledgement(lookalikeOriginOutput), null,
    "lookalike origins must not receive postMessage acknowledgements");
  assert.strictEqual(harness.state.rows.length, 4, "origin check must not break retry deduplication");

  const logs = harness.state.logs.join("\n");
  assert.match(logs, /IDEMPOTENCY_CONFLICT/);
  assert.match(logs, /STORAGE_CONSENT_REQUIRED/);
  [firstRequest.privateMessage, changedSecret, formulaRequest.privateMessage].forEach((privateMessage) => {
    assert(!logs.includes(privateMessage), "private message appeared in logs");
  });

  console.log("Apps Script contact record contract passed.");
}

run();
