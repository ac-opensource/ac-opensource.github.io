const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const ContactTransport = require("../assets/js/contact-transport");
const SignalsContract = require("../assets/js/signals-contract");
const {
  injectContactRuntimeHtml,
  renderRegistry,
  renderSignalsHtml,
  slotGeometry,
  syncSignalsSitemap
} = require("./render-signals-page");
const { assertNoForbiddenOutput } = require("./build-site");
const { createRecordStore, loadFixture } = require("./local-contact-signals-server");

const ROOT = path.join(__dirname, "..");
const LOCATION = Object.freeze({
  origin: "https://ac-opensource.github.io",
  protocol: "https:",
  hostname: "ac-opensource.github.io",
  host: "ac-opensource.github.io"
});
const DISABLED = Object.freeze({
  version: 1,
  enabled: false,
  endpoint: "",
  publicFeedEndpoint: "",
  requestTimeoutMs: 8000
});
const DISABLED_RECORDS = Object.freeze({
  version: 1,
  enabled: false,
  transport: "disabled",
  endpoint: "",
  publicFeedEndpoint: "",
  requestTimeoutMs: 12000
});
const PRIVATE_PAYLOAD = Object.freeze({
  version: 1,
  intent: "private",
  name: "Test Operator",
  email: "operator@example.test",
  privateMessage: "Hi!",
  contextPath: "/contact.html"
});
const PRIVATE_PAYLOAD_V2 = Object.freeze({
  version: 2,
  submissionId: "contact_contract_test_000001",
  intent: "private",
  name: "Test Operator",
  email: "operator@example.test",
  privateMessage: "Hi!",
  contextPath: "/contact.html"
});

function assertApprovedCheckedInRuntime(rawRuntime) {
  const runtime = ContactTransport.validateRuntimeConfig(rawRuntime, LOCATION);
  if (runtime.enabled) {
    const endpoint = new URL(runtime.endpoint);
    assert.strictEqual(runtime.transport, "apps_script_iframe");
    assert.strictEqual(endpoint.protocol, "https:");
    assert.strictEqual(endpoint.hostname, "script.google.com");
    assert.match(endpoint.pathname, /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/);
    assert.strictEqual(endpoint.search, "");
    assert.strictEqual(endpoint.hash, "");
    assert.strictEqual(endpoint.username, "");
    assert.strictEqual(endpoint.password, "");
    assert.strictEqual(runtime.publicFeedEndpoint, "");
  } else {
    assert.strictEqual(runtime.transport, "disabled");
    assert.strictEqual(runtime.endpoint, "");
    assert.strictEqual(runtime.publicFeedEndpoint, "");
  }
  return runtime;
}

function testAppsScriptAcknowledgementOrigins() {
  [
    "https://script.google.com",
    "https://script.googleusercontent.com",
    "https://sandbox.script.googleusercontent.com",
    "https://n-example-runtime-0lu-script.googleusercontent.com"
  ].forEach(function (origin) {
    assert.strictEqual(ContactTransport.allowedAppsScriptAcknowledgementOrigin(origin), true, origin);
  });
  [
    "http://script.google.com",
    "https://script.google.com.evil.example",
    "https://evilscript.googleusercontent.com",
    "https://n-runtime-script.googleusercontent.com.evil.example",
    "not-an-origin"
  ].forEach(function (origin) {
    assert.strictEqual(ContactTransport.allowedAppsScriptAcknowledgementOrigin(origin), false, origin);
  });
}

function publicPayload(overrides) {
  return Object.assign({}, PRIVATE_PAYLOAD, {
    intent: "public",
    contextPath: "/contact.html?intent=public",
    public: Object.assign({
      quote: "This separate public quote is long enough for deliberate review.",
      target: "contact",
      display: { mode: "anonymous", label: "Anonymous" },
      consent: true
    }, overrides || {})
  });
}

function approvedRecord(index, overrides) {
  return Object.assign({
    id: "sig_approved_record_" + String(index).padStart(3, "0"),
    status: "approved",
    display: { mode: "anonymous", label: "Anonymous" },
    quote: "Approved contract test quote number " + index + " stays safely in public scope.",
    target: index % 2 ? "portfolio" : "contact",
    createdAt: "2026-08-01",
    approvedAt: "2026-08-02",
    slot: index
  }, overrides || {});
}

async function testMailtoBoundary() {
  let fetchCalls = 0;
  let navigated = "";
  const transport = ContactTransport.create({
    config: DISABLED,
    location: LOCATION,
    destination: "aarconcepcion@gmail.com",
    fetchImpl: async function () {
      fetchCalls += 1;
      throw new Error("disabled transport must not fetch");
    },
    navigate: function (uri) { navigated = uri; }
  });
  const states = [];
  const result = await transport.submit(PRIVATE_PAYLOAD, {
    onState: function (state) { states.push(state); }
  });
  assert.strictEqual(transport.kind, "email_app");
  assert.deepStrictEqual(states, ["validating", "handoff"]);
  assert.deepStrictEqual(result, { state: "handoff", confirmed: false });
  assert.strictEqual(fetchCalls, 0);
  assert.match(navigated, /^mailto:aarconcepcion@gmail\.com\?/);
  assert.doesNotMatch(navigated, /receipt|confirmed|delivered/i);
}

async function testDisabledRecordBoundary() {
  let fetchCalls = 0;
  let navigated = false;
  const transport = ContactTransport.create({
    config: DISABLED_RECORDS,
    location: LOCATION,
    fetchImpl: async function () { fetchCalls += 1; },
    navigate: function () { navigated = true; }
  });
  assert.strictEqual(transport.kind, "unavailable");
  await assert.rejects(transport.submit(PRIVATE_PAYLOAD_V2), /not configured/);
  assert.strictEqual(fetchCalls, 0);
  assert.strictEqual(navigated, false);
}

async function testConfiguredBoundary() {
  const requests = [];
  const config = {
    version: 1,
    enabled: true,
    endpoint: "https://contact-api.example.test/messages",
    publicFeedEndpoint: "https://contact-api.example.test/signals",
    requestTimeoutMs: 2000
  };
  let responseValue = {
    version: 1,
    receiptId: "opaque_private_receipt_001",
    intent: "private",
    state: "confirmed"
  };
  const transport = ContactTransport.create({
    config,
    location: LOCATION,
    destination: "aarconcepcion@gmail.com",
    navigate: function () { throw new Error("configured transport must not navigate"); },
    fetchImpl: async function (url, options) {
      requests.push({ url, options });
      return new Response(JSON.stringify(responseValue), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  const privateResult = await transport.submit(PRIVATE_PAYLOAD);
  assert.strictEqual(privateResult.state, "confirmed");
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].options.credentials, "omit");
  assert.strictEqual(requests[0].options.redirect, "error");
  assert.deepStrictEqual(JSON.parse(requests[0].options.body), PRIVATE_PAYLOAD);

  responseValue = {
    version: 1,
    receiptId: "opaque_public_receipt_0001",
    intent: "public",
    state: "pending_moderation"
  };
  const publicResult = await transport.submit(publicPayload());
  assert.strictEqual(publicResult.state, "pending_moderation");

  responseValue = {
    version: 1,
    receiptId: "opaque_public_receipt_0002",
    intent: "public",
    state: "approved"
  };
  await assert.rejects(transport.submit(publicPayload()), /only return pending_moderation/);
}

async function testAppsScriptIframeBoundary() {
  const calls = [];
  const config = {
    version: 1,
    enabled: true,
    transport: "apps_script_iframe",
    endpoint: "https://script.google.com/macros/s/TEST_DEPLOYMENT_123/exec",
    publicFeedEndpoint: "",
    requestTimeoutMs: 12000
  };
  const states = [];
  const transport = ContactTransport.create({
    config,
    location: LOCATION,
    iframeBridge: async function (payload, options) {
      calls.push({ payload, options });
      return {
        version: 2,
        receiptId: "apps_script_receipt_0001",
        intent: "private",
        state: "confirmed"
      };
    }
  });
  const result = await transport.submit(PRIVATE_PAYLOAD_V2, {
    onState: function (state) { states.push(state); }
  });
  assert.strictEqual(transport.kind, "apps_script_iframe");
  assert.deepStrictEqual(states, ["validating", "submitting", "confirmed"]);
  assert.strictEqual(result.receiptId, "apps_script_receipt_0001");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].payload.submissionId, PRIVATE_PAYLOAD_V2.submissionId);
  assert.strictEqual(calls[0].options.endpoint, config.endpoint);
}

function testContactRejections() {
  assert.doesNotThrow(function () {
    ContactTransport.validatePayload(Object.assign({}, PRIVATE_PAYLOAD_V2, { privateMessage: "Hi!" }));
  });
  assert.throws(
    function () {
      ContactTransport.validatePayload(Object.assign({}, PRIVATE_PAYLOAD_V2, { privateMessage: "" }));
    },
    /between 1 and 4000/
  );
  assert.throws(
    function () {
      ContactTransport.validatePayload(Object.assign({}, PRIVATE_PAYLOAD_V2, { privateMessage: "   " }));
    },
    /trimmed text between 1 and 4000/
  );
  assert.doesNotThrow(
    function () {
      ContactTransport.validatePayload(Object.assign({}, publicPayload({ quote: "K" }), { privateMessage: "" }));
    }
  );
  assert.throws(
    function () { ContactTransport.validatePayload(publicPayload({ quote: "" })); },
    /between 1 and 280/
  );
  assert.throws(
    function () { ContactTransport.validatePayload(publicPayload({ quote: " " })); },
    /trimmed text between 1 and 280/
  );
  assert.throws(
    function () {
      ContactTransport.validateRuntimeConfig(Object.assign({}, DISABLED, { enabled: true }), LOCATION);
    },
    /requires a record transport and contact endpoint/
  );
  assert.throws(
    function () {
      ContactTransport.validateRuntimeConfig(Object.assign({}, DISABLED, {
        enabled: true,
        endpoint: "//evil.example/messages",
        publicFeedEndpoint: "https://safe.example/signals"
      }), LOCATION);
    },
    /protocol-relative/
  );
  assert.throws(
    function () {
      ContactTransport.validateRuntimeConfig(Object.assign({}, DISABLED, {
        enabled: true,
        endpoint: "https://user:secret@example.test/messages",
        publicFeedEndpoint: "https://safe.example/signals"
      }), LOCATION);
    },
    /credentials/
  );
  assert.throws(
    function () {
      ContactTransport.validateRuntimeConfig(Object.assign({}, DISABLED, {
        enabled: true,
        endpoint: "http://localhost:4177/messages",
        publicFeedEndpoint: "http://localhost:4177/signals"
      }), {
        origin: "http://localhost:4177",
        protocol: "http:",
        hostname: "localhost",
        host: "localhost:4177"
      });
    },
    /HTTPS or the page's exact 127\.0\.0\.1/
  );
  assert.throws(
    function () {
      ContactTransport.validatePayload(Object.assign({}, PRIVATE_PAYLOAD, {
        public: publicPayload().public
      }));
    },
    /unknown/
  );
  assert.throws(
    function () { ContactTransport.validatePayload(publicPayload({ target: "https://evil.example" })); },
    /not allowlisted/
  );
  assert.throws(
    function () { ContactTransport.validatePayload(publicPayload({ consent: false })); },
    /consent/
  );
  assert.throws(
    function () {
      ContactTransport.validatePayload(publicPayload({
        display: { mode: "named", label: "Someone Else" }
      }));
    },
    /separately submitted name/
  );
  assert.throws(
    function () {
      ContactTransport.validatePayload(Object.assign({}, PRIVATE_PAYLOAD_V2, { submissionId: "short" }));
    },
    /Submission ID is invalid/
  );
}

function testRecordStoreIdempotency() {
  const store = createRecordStore();
  try {
    const response = {
      version: 2,
      receiptId: "local_record_receipt_0001",
      intent: "private",
      state: "confirmed"
    };
    const first = store.persist(PRIVATE_PAYLOAD_V2, response);
    const retry = store.persist(PRIVATE_PAYLOAD_V2, response);
    assert.strictEqual(first.inserted, true);
    assert.strictEqual(retry.inserted, false);
    assert.strictEqual(retry.response.receiptId, first.response.receiptId);
    assert.strictEqual(store.count(), 1);
    assert.throws(function () {
      store.persist(Object.assign({}, PRIVATE_PAYLOAD_V2, {
        privateMessage: "The same idempotency key cannot be reused for edited private content."
      }), response);
    }, /IDEMPOTENCY_CONFLICT/);
    assert.strictEqual(store.count(), 1);
  } finally {
    store.close();
  }
}

function testAppsScriptIdempotencyContract() {
  const source = fs.readFileSync(
    path.join(ROOT, "integrations/google-apps-script/contact-records/Code.gs"),
    "utf8"
  );
  const sandbox = {};
  vm.runInNewContext(source, sandbox, { filename: "Code.gs" });
  const stored = [
    "record_0001",
    PRIVATE_PAYLOAD_V2.submissionId,
    new Date("2026-08-07T00:00:00.000Z"),
    PRIVATE_PAYLOAD_V2.intent,
    PRIVATE_PAYLOAD_V2.name,
    PRIVATE_PAYLOAD_V2.email,
    PRIVATE_PAYLOAD_V2.privateMessage,
    "",
    "",
    "",
    "no",
    PRIVATE_PAYLOAD_V2.contextPath,
    "pending",
    PRIVATE_PAYLOAD_V2.version
  ];
  assert.strictEqual(sandbox.storedPayloadMatches_(stored, PRIVATE_PAYLOAD_V2), true);
  const edited = Object.assign({}, PRIVATE_PAYLOAD_V2, {
    privateMessage: "An edited payload must not inherit the original stored-record receipt."
  });
  assert.strictEqual(sandbox.storedPayloadMatches_(stored, edited), false);
}

function testSignalsContractAndRendering() {
  const records = Array.from({ length: 7 }, function (_value, index) {
    return approvedRecord(index);
  });
  records.push({
    id: "sig_removed_record_099",
    status: "removed",
    slot: 99
  });
  const feed = SignalsContract.validateFeed({ version: 1, records });
  assert.strictEqual(feed.records.length, 8);
  assert.strictEqual(SignalsContract.orbitRecords(feed).length, 5);
  assert.ok(SignalsContract.orbitRecords(feed).every(function (record) {
    return record.status === "approved";
  }));
  assert.strictEqual(
    SignalsContract.validateFeed({ version: 1, records: [approvedRecord(88, { quote: "K" })] }).records[0].quote,
    "K"
  );

  assert.throws(
    function () {
      SignalsContract.validateFeed({
        version: 1,
        records: [{ id: "sig_pending_record_001", status: "pending", slot: 1 }]
      });
    },
    /unknown, private, or missing|Only approved records/
  );
  assert.throws(
    function () {
      SignalsContract.validateFeed({
        version: 1,
        records: [{
          id: "sig_removed_record_001",
          status: "removed",
          slot: 1,
          quote: "A removed record must never retain this quote."
        }]
      });
    },
    /unknown, private, or missing/
  );
  assert.throws(
    function () {
      SignalsContract.validateFeed({
        version: 1,
        records: [approvedRecord(1), approvedRecord(2, { slot: 1 })]
      });
    },
    /Duplicate signal slot/
  );
  assert.throws(
    function () {
      SignalsContract.validateFeed({
        version: 1,
        records: [approvedRecord(1, { email: "private@example.test" })]
      });
    },
    /unknown, private, or missing/
  );
  assert.throws(
    function () {
      SignalsContract.validateFeed({
        version: 1,
        records: [approvedRecord(1, { target: "//evil.example/path" })]
      });
    },
    /not an allowed local destination/
  );

  const hostile = approvedRecord(42, {
    display: { mode: "named", label: "<b>Named & safe</b>" },
    quote: "<img src=x onerror=alert(1)> remains text with $& $1 </script>, never executable markup.",
    slot: 42
  });
  const registry = renderRegistry(SignalsContract.validateFeed({ version: 1, records: [hostile] }));
  assert.match(registry, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(registry, /&lt;b&gt;Named &amp; safe&lt;\/b&gt;/);
  assert.doesNotMatch(registry, /<img|<b>Named/);
  assert.match(registry, /aria-controls="signal-detail"/);
  assert.doesNotMatch(registry, /aria-controls="signal-detail-title"/);

  const hostilePage = renderSignalsHtml(
    fs.readFileSync(path.join(ROOT, "signals.html"), "utf8"),
    { version: 1, records: [hostile] }
  );
  assert.strictEqual((hostilePage.match(/id="signals-feed"/g) || []).length, 1);
  const inlineMatch = hostilePage.match(/<script id="signals-feed" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(inlineMatch);
  const inlineHostile = JSON.parse(inlineMatch[1]);
  assert.strictEqual(inlineHostile.records[0].quote, hostile.quote);

  const template = fs.readFileSync(path.join(ROOT, "signals.html"), "utf8");
  const rendered = renderSignalsHtml(template, { version: 1, records });
  assert.strictEqual((rendered.match(/data-satellite/g) || []).length, 7);
  assert.strictEqual((rendered.match(/data-slot-marker/g) || []).length, 8);
  assert.match(rendered, /data-slot-marker data-signal-id="sig_removed_record_099" data-status="removed" data-slot="99"/);
  assert.deepStrictEqual(slotGeometry(42), {
    angle: -147.664,
    track: 3,
    x: 29.046,
    y: 39.623
  });
  assert.notDeepStrictEqual(slotGeometry(42), slotGeometry(43));
  assert.match(rendered, /data-slot="99"[^>]*aria-label="Open removed public signal tombstone[^>]*><span>slot<\/span><b>099<\/b>/);
  assert.match(rendered, /content="index,follow"/);
  const removedSegment = rendered.slice(
    rendered.indexOf('id="record-sig_removed_record_099"'),
    rendered.indexOf("<!-- SIGNALS_REGISTRY_END -->")
  );
  assert.doesNotMatch(removedSegment, /<blockquote|approvedAt|createdAt|target=/);

  const empty = renderSignalsHtml(template, { version: 1, records: [] });
  assert.match(empty, /content="noindex,follow"/);
  assert.match(empty, /No public Signals yet/);
  assert.match(empty, /data-signals-orbit aria-labelledby="signals-orbit-title">/);
  assert.match(empty, /data-signal-filters[^>]* hidden/);
  assert.match(empty, /data-orbit-empty>/);
  assert.strictEqual((empty.match(/data-slot-marker/g) || []).length, 0);

  const sitemapRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac-site-signals-sitemap-"));
  try {
    fs.writeFileSync(
      path.join(sitemapRoot, "sitemap.xml"),
      '<?xml version="1.0"?><urlset><url><loc>https://ac-opensource.github.io/</loc></url></urlset>',
      "utf8"
    );
    assert.strictEqual(syncSignalsSitemap(sitemapRoot, {
      approvedCount: 7,
      feed
    }), true);
    const sitemap = fs.readFileSync(path.join(sitemapRoot, "sitemap.xml"), "utf8");
    assert.match(sitemap, /<loc>https:\/\/ac-opensource\.github\.io\/signals\.html<\/loc>/);
    assert.match(sitemap, /<lastmod>2026-08-02<\/lastmod>/);
  } finally {
    fs.rmSync(sitemapRoot, { recursive: true, force: true });
  }
}

function testForbiddenPublicationNames() {
  [
    "assets/images/contact-signals-screenshot.png",
    "assets/js/contact-signals-mock.js",
    "assets/data/local-fixture-copy.json",
    "assets/images/private_data-export.png"
  ].forEach(function (relativePath) {
    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ac-site-artifact-name-"));
    try {
      const absolutePath = path.join(stagingRoot, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, "local-only", "utf8");
      assert.throws(
        function () { assertNoForbiddenOutput(stagingRoot); },
        /Local-only artifact name reached the publication output/
      );
    } finally {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  });
}

function testCheckedInBoundaries() {
  const rawRuntime = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/data/contact-runtime.json"), "utf8"));
  const feed = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/data/signals.json"), "utf8"));
  assertApprovedCheckedInRuntime(DISABLED_RECORDS);
  assertApprovedCheckedInRuntime({
    version: 1,
    enabled: true,
    transport: "apps_script_iframe",
    endpoint: "https://script.google.com/macros/s/TEST_DEPLOYMENT_123/exec",
    publicFeedEndpoint: "",
    requestTimeoutMs: 12000
  });
  assertApprovedCheckedInRuntime(rawRuntime);
  assert.deepStrictEqual(SignalsContract.validateFeed(feed), { version: 1, records: [] });
  const contactHtml = fs.readFileSync(path.join(ROOT, "contact.html"), "utf8");
  const contactTargets = contactHtml
    .match(/<select id="contact-public-target"[\s\S]*?<\/select>/)[0]
    .matchAll(/<option value="([^"]+)"/g);
  assert.deepStrictEqual(
    Array.from(contactTargets, function (match) { return match[1]; }),
    Object.keys(SignalsContract.TARGETS)
  );
  assert.match(contactHtml, /name="publicDisplay" value="anonymous" checked/);
  assert.match(contactHtml, /data-js-public-intent/);
  assert.match(contactHtml, /name="intent" value="public"/);
  assert.match(contactHtml, /data-public-fields hidden/);
  assert.match(contactHtml, /does not open an email client or claim a stored message/);
  assert.doesNotMatch(contactHtml, /action="mailto:/);
  assert.match(contactHtml, /data-contact-submit disabled/);
  const configuredContact = injectContactRuntimeHtml(contactHtml, {
    version: 1,
    enabled: true,
    transport: "apps_script_iframe",
    endpoint: "https://script.google.com/macros/s/TEST_DEPLOYMENT_123/exec",
    publicFeedEndpoint: "",
    requestTimeoutMs: 12000
  });
  assert.match(configuredContact, /action="\/contact\.html#contact-form"/);
  assert.match(configuredContact.match(/<button\b[^>]*data-contact-submit[^>]*>/)[0], /\bdisabled\b/);
  assert.match(configuredContact, /JavaScript is required for verified record storage/);
  const signalsHtml = fs.readFileSync(path.join(ROOT, "signals.html"), "utf8");
  assert.match(signalsHtml, /id="signal-detail" data-signal-detail/);
  const filterTargets = signalsHtml
    .match(/<select id="signal-target-filter"[\s\S]*?<\/select>/)[0]
    .matchAll(/<option value="([^"]*)"/g);
  assert.deepStrictEqual(
    Array.from(filterTargets, function (match) { return match[1]; }),
    [""].concat(Object.keys(SignalsContract.TARGETS))
  );
  const fixture = loadFixture(path.join(ROOT, "scripts/fixtures/contact-signals.local.json"));
  assert.match(fixture.label, /LOCAL DEMO DATA/);
  const signalsCss = fs.readFileSync(path.join(ROOT, "assets/css/signals-registry.css"), "utf8");
  assert.match(signalsCss, /\.no-js \.signals-controls/);
  assert.match(signalsCss, /\.no-js \[data-select-signal\]/);
}

async function main() {
  testAppsScriptAcknowledgementOrigins();
  await testMailtoBoundary();
  await testDisabledRecordBoundary();
  await testConfiguredBoundary();
  await testAppsScriptIframeBoundary();
  testContactRejections();
  testRecordStoreIdempotency();
  testAppsScriptIdempotencyContract();
  testSignalsContractAndRendering();
  testForbiddenPublicationNames();
  testCheckedInBoundaries();
  console.log("Contact/Signals contracts, rendering, and default publication boundary passed.");
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
