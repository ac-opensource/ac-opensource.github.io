const assert = require("assert");
const {
  appsScriptUserHtml,
  buildDisposablePayload,
  endpointFromArgs,
  parseAcknowledgement,
  validatedEndpoint,
  verifyDeployment
} = require("./verify-contact-apps-script");

const ENDPOINT = "https://script.google.com/macros/s/TEST_DEPLOYMENT_123/exec";
const RECEIPT = "7fe12e2e-90ea-4861-a472-7859ae612f54";

function storedHtml(receipt) {
  return "<!doctype html><html><head><title>Contact stored</title></head><body><main>" +
    "<h1>Contact record stored.</h1><p>You may return to the portfolio. The opaque receipt is " + receipt + ".</p>" +
    "</main><script>window.parent.postMessage({ok:true},\"\");</script></body></html>";
}

function notStoredHtml() {
  return "<!doctype html><html><head><title>Contact not stored</title></head><body><main>" +
    "<h1>Contact record was not stored.</h1><p>Return to the portfolio and retry. No stored record is being claimed.</p>" +
    "</main></body></html>";
}

function appsScriptWrapper(userHtml) {
  const jsonEscapedHtml = JSON.stringify(userHtml).slice(1, -1);
  const outerEscapedHtml = JSON.stringify(jsonEscapedHtml).slice(1, -1)
    .replace(/\\u00([0-9a-f]{2})/gi, "\\x$1")
    .replace(/[<>:=]/g, function (character) {
      return "\\x" + character.charCodeAt(0).toString(16).padStart(2, "0");
    });
  return "<!doctype html><script>goog.script.init(\"" +
    "\\x7b\\x22userHtml\\x22:\\x22" + outerEscapedHtml +
    "\\x22,\\x22ncc\\x22:\\x22\\x7b\\x7d\\x22\\x7d\", \"\");</script>";
}

function htmlResponse(html, status) {
  return new Response(html, {
    status: status || 200,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function testEndpointValidation() {
  assert.strictEqual(validatedEndpoint(ENDPOINT), ENDPOINT);
  assert.strictEqual(
    endpointFromArgs(["--endpoint", ENDPOINT], {}).endpoint,
    ENDPOINT
  );
  assert.strictEqual(
    endpointFromArgs([], { CONTACT_APPS_SCRIPT_ENDPOINT: ENDPOINT }).endpoint,
    ENDPOINT
  );
  [
    "http://script.google.com/macros/s/TEST_DEPLOYMENT_123/exec",
    "https://evil.example/macros/s/TEST_DEPLOYMENT_123/exec",
    "https://script.google.com.evil.example/macros/s/TEST_DEPLOYMENT_123/exec",
    "https://user:secret@script.google.com/macros/s/TEST_DEPLOYMENT_123/exec",
    "https://script.google.com/macros/s/TEST_DEPLOYMENT_123/dev",
    "https://script.google.com/macros/s/TEST_DEPLOYMENT_123/exec?credential=secret",
    "https://script.google.com/macros/s/TEST_DEPLOYMENT_123/exec#fragment"
  ].forEach(function (endpoint) {
    assert.throws(function () { validatedEndpoint(endpoint); }, /must be exactly HTTPS/);
  });
}

function testPayloadAndParsing() {
  const payload = buildDisposablePayload({
    now: 200000,
    randomBytes: function () { return Buffer.from("123456789012"); }
  });
  assert.strictEqual(payload.version, "2");
  assert.strictEqual(payload.intent, "private");
  assert.strictEqual(payload.storageConsent, "yes");
  assert.strictEqual(payload.startedAt, "198000");
  assert.match(payload.submissionId, /^contact_deploy_verify_[a-f0-9]{24}$/);
  assert.match(payload.email, /@example\.invalid$/);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(payload, "publicQuote"), false);

  assert.deepStrictEqual(parseAcknowledgement(storedHtml(RECEIPT)), {
    stored: true,
    receiptId: RECEIPT
  });
  assert.deepStrictEqual(parseAcknowledgement(notStoredHtml()), {
    stored: false,
    receiptId: ""
  });
  const wrappedStored = appsScriptWrapper(storedHtml(RECEIPT));
  assert.strictEqual(appsScriptUserHtml(wrappedStored), storedHtml(RECEIPT));
  assert.deepStrictEqual(parseAcknowledgement(wrappedStored), {
    stored: true,
    receiptId: RECEIPT
  });
  assert.deepStrictEqual(parseAcknowledgement(appsScriptWrapper(notStoredHtml())), {
    stored: false,
    receiptId: ""
  });
  assert.throws(
    function () { parseAcknowledgement("<h1>Everything is fine</h1>"); },
    /neither the explicit stored page nor the explicit not-stored page/
  );
}

async function testVerificationSequence() {
  const bodies = [];
  const payload = buildDisposablePayload({
    now: Date.now(),
    randomBytes: function () { return Buffer.from("abcdefghijkl"); }
  });
  const responses = [storedHtml(RECEIPT), storedHtml(RECEIPT), notStoredHtml()];
  const result = await verifyDeployment({
    endpoint: ENDPOINT,
    payload,
    fetchImpl: async function (endpoint, options) {
      assert.strictEqual(endpoint, ENDPOINT);
      assert.strictEqual(options.method, "POST");
      assert.strictEqual(options.credentials, "omit");
      assert.strictEqual(options.redirect, "follow");
      bodies.push(options.body.toString());
      return htmlResponse(responses.shift());
    }
  });

  assert.deepStrictEqual(result, {
    submissionId: payload.submissionId,
    receiptId: RECEIPT
  });
  assert.strictEqual(bodies.length, 3);
  assert.strictEqual(bodies[0], bodies[1]);
  assert.strictEqual(new URLSearchParams(bodies[0]).get("submissionId"), payload.submissionId);
  assert.strictEqual(new URLSearchParams(bodies[2]).get("submissionId"), payload.submissionId);
  assert.notStrictEqual(
    new URLSearchParams(bodies[2]).get("privateMessage"),
    new URLSearchParams(bodies[0]).get("privateMessage")
  );
}

async function testVerificationRejections() {
  const payload = buildDisposablePayload();
  await assert.rejects(
    verifyDeployment({
      endpoint: ENDPOINT,
      payload,
      fetchImpl: async function () { return htmlResponse(notStoredHtml()); }
    }),
    /Initial disposable record was explicitly not stored/
  );

  let replayCall = 0;
  await assert.rejects(
    verifyDeployment({
      endpoint: ENDPOINT,
      payload,
      fetchImpl: async function () {
        replayCall += 1;
        return htmlResponse(storedHtml(replayCall === 1 ? RECEIPT : "different-receipt-0001"));
      }
    }),
    /different receipt/
  );

  let conflictCall = 0;
  await assert.rejects(
    verifyDeployment({
      endpoint: ENDPOINT,
      payload,
      fetchImpl: async function () {
        conflictCall += 1;
        return htmlResponse(storedHtml(RECEIPT));
      }
    }),
    /idempotency conflict handling failed/
  );
}

async function main() {
  testEndpointValidation();
  testPayloadAndParsing();
  await testVerificationSequence();
  await testVerificationRejections();
  console.log("Contact Apps Script verifier tests passed.");
}

if (require.main === module) {
  main().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
  });
}
