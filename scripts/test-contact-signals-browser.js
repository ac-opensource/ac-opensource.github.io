const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");
const { createLocalServer } = require("./local-contact-signals-server");
const { renderSignalsHtml } = require("./render-signals-page");

const ROOT = path.join(__dirname, "..");
const EVIDENCE_ROOT = "/tmp/ac-universe-evidence/synthesis-contact-signals/screenshots";
const PORT = 43987;

function requestWithHostHeader(hostHeader) {
  return new Promise(function (resolve, reject) {
    const request = http.get({
      hostname: "127.0.0.1",
      port: PORT,
      path: "/contact.html",
      headers: { host: hostHeader }
    }, function (response) {
      response.resume();
      response.on("end", function () { resolve(response.statusCode); });
    });
    request.on("error", reject);
  });
}

function installPageGuards(page, errors) {
  page.on("pageerror", function (error) { errors.push("pageerror: " + error.message); });
  page.on("console", function (message) {
    if (message.type() === "error") errors.push("console: " + message.text());
  });
}

async function fillPrivate(page) {
  await page.locator("#contact-name").fill("Runtime Operator");
  await page.locator("#contact-email").fill("runtime@example.test");
  await page.locator("#contact-message").fill("Hi!");
  await page.locator("#contact-storage-consent").check();
}

async function fillPublic(page, options) {
  await fillPrivate(page);
  await page.locator('input[name="intent"][value="public"]').check();
  if (options && Object.hasOwn(options, "privateMessage")) {
    await page.locator("#contact-message").fill(options.privateMessage);
  }
  await page.locator("#contact-public-quote").fill((options && options.quote) ||
    "This separate public quote is intentionally bounded and ready for human review.");
  await page.locator("#contact-public-target").selectOption((options && options.target) || "contact");
  if (options && options.named) {
    await page.locator('input[name="publicDisplay"][value="named"]').check();
  }
  await page.locator("#contact-public-consent").check();
}

async function waitForState(page, value) {
  await page.locator("[data-contact-console]").waitFor({ state: "visible" });
  await page.waitForFunction(function (expected) {
    return document.querySelector("[data-contact-console]")?.dataset.recordState === expected;
  }, value);
}

async function submitAndSkip(page, terminalState) {
  await page.locator("[data-contact-submit]").click();
  await waitForState(page, terminalState);
  const skip = page.locator("[data-skip-launch]");
  await skip.waitFor({ state: "visible" });
  await skip.click();
  await page.waitForFunction(function () {
    return document.querySelector("[data-contact-console]")?.classList.contains("is-deployed");
  });
}

async function assertPendingLaunchMotion(page, label) {
  await page.locator("[data-contact-submit]").click();
  assert.strictEqual(
    await page.locator("[data-contact-console]").getAttribute("data-visual-phase"),
    "preparing",
    label + " launch did not enter the preparing phase immediately"
  );
  assert.ok(await page.locator("[data-contact-console]").evaluate(function (form) {
    return form.classList.contains("is-preparing");
  }), label + " launch did not expose its preparing visual state");
  assert.match(await page.locator("#contact-form-status").textContent(), /Preparing payload bay/i);
  await page.waitForFunction(function () {
    const visual = document.querySelector("[data-payload-visual]");
    if (!visual) return false;
    const bounds = visual.getBoundingClientRect();
    return bounds.bottom > 0 && bounds.top < window.innerHeight;
  });
  await page.waitForFunction(function () {
    return document.querySelector("[data-contact-console]")?.dataset.visualPhase === "recording";
  });
  assert.strictEqual(
    await page.locator("[data-contact-console]").getAttribute("data-record-state"),
    "submitting",
    label + " displayed recording motion after leaving the submitting state"
  );
  assert.strictEqual(
    await page.locator("[data-receipt]").isVisible(),
    false,
    label + " exposed a receipt before the recording phase finished"
  );
  const recordingMotion = await page.locator("[data-payload-visual]").evaluate(function (visual) {
    return {
      scan: getComputedStyle(visual, "::after").animationName,
      core: getComputedStyle(visual.querySelector(".satellite__core")).animationName,
      beacon: getComputedStyle(visual.querySelector(".satellite__beacon")).animationName
    };
  });
  assert.match(recordingMotion.scan, /payload-record-scan/, label + " recording scan is not animated");
  assert.match(recordingMotion.core, /payload-core-record/, label + " recording core is not animated");
  assert.match(recordingMotion.beacon, /payload-beacon-record/, label + " recording beacon is not animated");
  assert.match(await page.locator("#contact-form-status").textContent(), /Recording payload/i);
}

async function testDefaultBoundary(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const endpointRequests = [];
  installPageGuards(page, errors);
  await page.route(/^https:\/\/(?:script\.google\.com|(?:[^/]+\.)?script\.googleusercontent\.com)\//, async function (route) {
    endpointRequests.push(route.request().url());
    await route.abort();
  });
  page.on("request", function (request) {
    if (request.url().includes("/__local/contact/")) endpointRequests.push(request.url());
  });
  await page.goto(origin + "/contact.html?publicBoundary=1", { waitUntil: "domcontentloaded" });
  const runtime = JSON.parse(await page.locator("#contact-runtime-config").textContent());
  assert.ok(await page.locator("[data-js-public-intent]").isVisible());
  assert.strictEqual(await page.locator('input[name="intent"][value="public"]').isEnabled(), true);
  await fillPrivate(page);
  if (runtime.enabled) {
    const endpoint = new URL(runtime.endpoint);
    assert.strictEqual(runtime.transport, "apps_script_iframe");
    assert.strictEqual(endpoint.protocol, "https:");
    assert.strictEqual(endpoint.hostname, "script.google.com");
    assert.match(endpoint.pathname, /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/);
    assert.strictEqual(endpoint.search, "");
    assert.strictEqual(endpoint.hash, "");
    assert.strictEqual(runtime.publicFeedEndpoint, "");
    assert.strictEqual(await page.locator("[data-contact-submit]").isDisabled(), false);
    assert.match(await page.locator("[data-runtime-message]").textContent(), /Private Sheet bridge online/i);
  } else {
    assert.strictEqual(runtime.transport, "disabled");
    assert.strictEqual(runtime.endpoint, "");
    assert.strictEqual(runtime.publicFeedEndpoint, "");
    assert.strictEqual(await page.locator("[data-contact-submit]").isDisabled(), true);
    assert.match(await page.locator("[data-runtime-message]").textContent(), /awaiting personal Google deployment/i);
  }
  assert.strictEqual(await page.locator("#contact-form").getAttribute("action"), "/contact.html#contact-form");
  assert.strictEqual(await page.locator("[data-local-demo-link]").isVisible(), false);
  assert.strictEqual(endpointRequests.length, 0);
  assert.strictEqual(await page.locator("[data-receipt-id]").isVisible(), false);
  assert.deepStrictEqual(errors, []);
  await context.close();
}

async function testConfiguredContact(browser, origin, local) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  installPageGuards(page, errors);

  await page.goto(origin + "/contact.html?localDemo=1", { waitUntil: "domcontentloaded" });
  await fillPrivate(page);
  const firstSubmissionId = await page.locator("[data-submission-id]").inputValue();
  assert.strictEqual(firstSubmissionId, "");
  await page.locator("[data-contact-submit]").click();
  await waitForState(page, "confirmed");
  const storedSubmissionId = await page.locator("[data-submission-id]").inputValue();
  assert.match(storedSubmissionId, /^contact_[A-Za-z0-9_-]{16,}$/);
  assert.strictEqual(local.recordStore.count(), 1);
  await page.locator("#contact-message").fill(
    "Editing this preserved private message invalidates the already confirmed route snapshot."
  );
  await waitForState(page, "idle");
  assert.match(await page.locator("#contact-form-status").textContent(), /ready to request a stored record/i);
  assert.strictEqual(await page.locator("[data-submission-id]").inputValue(), "");
  assert.strictEqual(await page.locator("[data-receipt-id]").isVisible(), false);
  await submitAndSkip(page, "confirmed");
  assert.match(await page.locator("[data-receipt-id]").textContent(), /^OPAQUE RECEIPT · local_private_receipt_0001$/);
  assert.strictEqual(local.recordStore.count(), 2);

  await page.goto(origin + "/contact.html?localDemo=1&demoScenario=fail-once", { waitUntil: "domcontentloaded" });
  await fillPrivate(page);
  const preservedMessage = await page.locator("#contact-message").inputValue();
  await page.locator("[data-contact-submit]").click();
  await waitForState(page, "failed");
  assert.ok(await page.locator("[data-contact-retry]").isVisible());
  assert.strictEqual(await page.locator("#contact-message").inputValue(), preservedMessage);
  assert.strictEqual(await page.locator("[data-contact-console]").getAttribute("data-visual-phase"), "idle");
  assert.strictEqual(await page.locator("[data-contact-console]").evaluate(function (form) {
    return form.classList.contains("is-preparing") || form.classList.contains("is-recording");
  }), false);
  await page.locator("[data-contact-retry]").click();
  await page.waitForFunction(function () {
    return document.querySelector("[data-contact-console]")?.dataset.visualPhase === "recording";
  });
  await waitForState(page, "confirmed");
  await page.locator("[data-skip-launch]").waitFor({ state: "visible" });
  await page.locator("[data-skip-launch]").click();
  assert.strictEqual(await page.locator("#contact-message").inputValue(), preservedMessage);

  await page.goto(origin + "/contact.html?localDemo=1&intent=public", { waitUntil: "domcontentloaded" });
  await fillPublic(page, { target: "portfolio", privateMessage: "", quote: "K" });
  assert.strictEqual(await page.locator('input[name="publicDisplay"]:checked').getAttribute("value"), "anonymous");
  assert.strictEqual(await page.locator("#contact-message").getAttribute("required"), null);
  assert.strictEqual(await page.locator("#contact-public-quote").getAttribute("minlength"), null);
  assert.strictEqual(await page.locator("#contact-public-quote").getAttribute("required"), "");
  assert.strictEqual(await page.locator('[data-module-state="payload"]').textContent(), "BEACON PACKAGE LOADED");
  await submitAndSkip(page, "pending_moderation");
  const publicSubmissionId = await page.locator("[data-submission-id]").inputValue();
  const storedPublicPayload = JSON.parse(local.recordStore.get(publicSubmissionId).payload_json);
  assert.strictEqual(storedPublicPayload.privateMessage, "");
  assert.strictEqual(storedPublicPayload.public.quote, "K");
  assert.match(await page.locator("[data-receipt-heading]").textContent(), /not public/i);
  assert.match(await page.locator("[data-receipt-body]").textContent(), /requires human approval/i);
  assert.strictEqual(await page.locator("[data-contact-console]").getAttribute("data-record-state"), "pending_moderation");

  await page.goto(
    origin + "/contact.html?localDemo=1&intent=public&demoScenario=invalid-approved",
    { waitUntil: "domcontentloaded" }
  );
  await fillPublic(page, { named: true });
  await page.locator("[data-contact-submit]").click();
  await waitForState(page, "failed");
  assert.notStrictEqual(await page.locator("[data-contact-console]").getAttribute("data-record-state"), "approved");
  assert.deepStrictEqual(errors.filter(function (error) {
    return !error.includes("Configured Contact record request failed") &&
      !error.includes("status of 503");
  }), []);
  await context.close();
}

async function testAppsScriptIframeBridge(browser, origin, local) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  installPageGuards(page, errors);
  const before = local.recordStore.count();
  await page.goto(origin + "/contact.html?localDemo=1&iframeDemo=1&iframeDelay=900", { waitUntil: "domcontentloaded" });
  await fillPrivate(page);
  await page.locator("#contact-name").fill("  Runtime Operator  ");
  await page.locator("#contact-message").fill(
    "  This normalized iframe payload keeps whitespace out of the persisted record.  \n"
  );
  assert.strictEqual(await page.locator('[data-module-state="identity"]').getAttribute("aria-hidden"), "false");
  await assertPendingLaunchMotion(page, "Mobile");
  assert.strictEqual(await page.locator("#contact-name").isDisabled(), true);
  await waitForState(page, "confirmed");
  assert.strictEqual(await page.locator("[data-contact-console]").getAttribute("data-visual-phase"), "idle");
  assert.strictEqual(await page.locator("[data-contact-console]").evaluate(function (form) {
    return form.classList.contains("is-preparing") || form.classList.contains("is-recording");
  }), false);
  assert.strictEqual(await page.locator("#contact-name").isDisabled(), false);
  assert.strictEqual(local.recordStore.count(), before + 1);
  const submissionId = await page.locator("[data-submission-id]").inputValue();
  const storedPayload = JSON.parse(local.recordStore.get(submissionId).payload_json);
  assert.strictEqual(storedPayload.name, "Runtime Operator");
  assert.strictEqual(
    storedPayload.privateMessage,
    "This normalized iframe payload keeps whitespace out of the persisted record."
  );
  assert.match(await page.locator("[data-receipt-id]").textContent(), /^OPAQUE RECEIPT · local_private_receipt_0001$/);
  await page.waitForTimeout(520);
  const visualInView = await page.locator("[data-payload-visual]").evaluate(function (element) {
    const bounds = element.getBoundingClientRect();
    return bounds.bottom > 0 && bounds.top < window.innerHeight;
  });
  assert.strictEqual(visualInView, true, "Confirmed mobile iframe submission did not reframe the payload animation");
  await page.locator("[data-skip-launch]").click();
  assert.deepStrictEqual(errors, []);
  await context.close();
}

async function testDesktopLaunchMotion(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  installPageGuards(page, errors);
  await page.goto(origin + "/contact.html?localDemo=1&iframeDemo=1&iframeDelay=900", { waitUntil: "domcontentloaded" });
  await fillPrivate(page);
  await assertPendingLaunchMotion(page, "Desktop");
  assert.strictEqual(await page.locator("#contact-name").isDisabled(), true);
  await waitForState(page, "confirmed");
  await page.locator("[data-skip-launch]").waitFor({ state: "visible" });
  await page.locator("[data-skip-launch]").click();
  assert.deepStrictEqual(errors, []);
  await context.close();
}

async function testSignals(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  installPageGuards(page, errors);
  await page.goto(origin + "/signals.html?localDemo=1", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(function () {
    return document.querySelector("[data-signals-root]")?.dataset.feedSource === "local_demo";
  });
  assert.strictEqual(await page.locator("[data-signal-record]").count(), 2);
  assert.strictEqual(await page.locator("[data-satellite]").count(), 1);
  assert.strictEqual(await page.locator("[data-slot-marker]").count(), 2);
  assert.strictEqual(await page.locator('[data-slot-marker][data-status="removed"]').count(), 1);
  assert.strictEqual(await page.locator('.signal-record[data-status="removed"] blockquote').count(), 0);
  assert.strictEqual(await page.locator('.signal-record[data-status="removed"] a').count(), 0);
  assert.match(await page.locator('.signal-record[data-status="removed"]').textContent(), /quote, attribution, target, and dates are no longer present/i);

  await page.locator('[data-slot-marker][data-status="removed"]').click();
  assert.ok(await page.locator("[data-signal-detail]").isVisible());
  assert.match(await page.locator("[data-detail-title]").textContent(), /Removed signal/);
  assert.strictEqual(await page.locator("[data-detail-quote]").isVisible(), false);
  assert.strictEqual(await page.locator("[data-detail-target]").isVisible(), false);
  assert.strictEqual(await page.locator('.signal-record[data-status="removed"]').getAttribute("class"), "signal-record signal-record--removed is-selected");
  await page.locator("[data-close-detail]").click();

  const readApproved = page.locator('[data-select-signal="sig_local_demo_approved_001"]');
  await readApproved.focus();
  await page.keyboard.press("Enter");
  assert.ok(await page.locator("[data-signal-detail]").isVisible());
  assert.match(page.url(), /signal=sig_local_demo_approved_001/);
  await page.locator("[data-close-detail]").click();

  await page.locator("#signal-target-filter").selectOption("contact");
  assert.match(page.url(), /target=contact/);
  assert.strictEqual(await page.locator('[data-slot-marker]:visible').count(), 1);
  assert.strictEqual(await page.locator('[data-signal-record]:visible').count(), 1);
  assert.strictEqual(await page.locator("[data-field-visible]").textContent(), "1");
  await readApproved.click();
  assert.match(page.url(), /signal=sig_local_demo_approved_001/);
  await page.evaluate(function () { window.history.back(); });
  await page.waitForFunction(function () {
    return !new URL(window.location.href).searchParams.has("signal");
  });
  assert.doesNotMatch(page.url(), /signal=/);
  assert.match(page.url(), /target=contact/);
  await page.evaluate(function () { window.history.back(); });
  await page.waitForFunction(function () {
    return !new URL(window.location.href).searchParams.has("target");
  });
  assert.doesNotMatch(page.url(), /target=/);
  assert.deepStrictEqual(errors, []);

  const hostile = {
    version: 1,
    records: [{
      id: "sig_runtime_safe_text_001",
      status: "approved",
      display: { mode: "named", label: "<b>Text label</b>" },
      quote: "<img src=x onerror=alert(1)> remains inert text in the registry.",
      target: "contact",
      createdAt: "2026-08-01",
      approvedAt: "2026-08-02",
      slot: 4
    }]
  };
  await page.route("**/__local/contact/signals", async function (route) {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(hostile)
    });
  });
  await page.goto(origin + "/signals.html?localDemo=1&sanitization=1", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(function () {
    return document.querySelector("[data-signals-root]")?.dataset.feedSource === "local_demo";
  });
  const card = page.locator("[data-signal-record]").first();
  assert.match(await card.textContent(), /<img src=x onerror=alert\(1\)>/);
  assert.strictEqual(await card.locator("img, b").count(), 0);
  await context.close();
}

async function testTouchReducedAndNoJs(browser, origin) {
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true
  });
  const touchPage = await touchContext.newPage();
  await touchPage.goto(origin + "/signals.html?localDemo=1", { waitUntil: "domcontentloaded" });
  await touchPage.waitForSelector('[data-select-signal="sig_local_demo_approved_001"]');
  await touchPage.tap('[data-select-signal="sig_local_demo_approved_001"]');
  assert.ok(await touchPage.locator("[data-signal-detail]").isVisible());
  await touchContext.close();

  const reducedContext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    reducedMotion: "reduce"
  });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(origin + "/contact.html?localDemo=1&iframeDemo=1&iframeDelay=900", { waitUntil: "domcontentloaded" });
  assert.strictEqual(
    await reducedPage.evaluate(function () { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }),
    true
  );
  await fillPrivate(reducedPage);
  await reducedPage.locator("[data-contact-submit]").click();
  await reducedPage.waitForFunction(function () {
    return document.querySelector("[data-contact-console]")?.dataset.visualPhase === "recording";
  });
  const reducedVisual = await reducedPage.locator("[data-payload-visual]").evaluate(function (visual) {
    const bounds = visual.getBoundingClientRect();
    return {
      inView: bounds.bottom > 0 && bounds.top < window.innerHeight,
      scanAnimation: getComputedStyle(visual, "::after").animationName,
      scanOpacity: Number.parseFloat(getComputedStyle(visual, "::after").opacity),
      coreAnimation: getComputedStyle(visual.querySelector(".satellite__core")).animationName
    };
  });
  assert.strictEqual(reducedVisual.inView, true);
  assert.strictEqual(reducedVisual.scanAnimation, "none");
  assert.strictEqual(reducedVisual.coreAnimation, "none");
  assert.ok(reducedVisual.scanOpacity >= 0.7, "Reduced-motion recording state is not visually legible");
  await waitForState(reducedPage, "confirmed");
  await reducedContext.close();

  const noJsContext = await browser.newContext({
    viewport: { width: 768, height: 1024 },
    javaScriptEnabled: false
  });
  const noJsPage = await noJsContext.newPage();
  await noJsPage.goto(origin + "/signals.html", { waitUntil: "domcontentloaded" });
  assert.ok(await noJsPage.locator(".signals-noscript").isVisible());
  assert.strictEqual(await noJsPage.locator(".signals-controls").isVisible(), false);
  assert.match(await noJsPage.locator("[data-feed-empty]").textContent(), /No public Signals yet/);
  assert.strictEqual(await noJsPage.locator("[data-signals-orbit]").isVisible(), true);
  assert.strictEqual(await noJsPage.locator("[data-slot-marker]").count(), 0);

  const template = fs.readFileSync(path.join(ROOT, "signals.html"), "utf8");
  const styles = fs.readFileSync(path.join(ROOT, "assets/css/signals-registry.css"), "utf8");
  const approvedNoJsHtml = renderSignalsHtml(template, {
    version: 1,
    records: [{
      id: "sig_static_nojs_approved_001",
      status: "approved",
      display: { mode: "anonymous", label: "Anonymous" },
      quote: "This approved static signal stays readable without JavaScript controls.",
      target: "contact",
      createdAt: "2026-08-01",
      approvedAt: "2026-08-02",
      slot: 1
    }]
  }).replace("</head>", "<style>" + styles + "</style></head>");
  await noJsPage.setContent(approvedNoJsHtml, { waitUntil: "domcontentloaded" });
  assert.strictEqual(await noJsPage.locator("[data-signal-record]").count(), 1);
  assert.strictEqual(await noJsPage.locator("[data-slot-marker]").count(), 1);
  assert.ok(await noJsPage.locator('[data-slot-marker][href="#record-sig_static_nojs_approved_001"]').isVisible());
  assert.strictEqual(await noJsPage.locator(".signals-controls").isVisible(), false);
  assert.strictEqual(await noJsPage.locator("[data-select-signal]").isVisible(), false);
  assert.ok(await noJsPage.locator('.signal-record a[href="/contact.html"]').isVisible());
  assert.strictEqual(await noJsPage.locator("[data-select-signal]").getAttribute("aria-controls"), "signal-detail");

  await noJsPage.goto(origin + "/contact.html?publicBoundary=1", { waitUntil: "domcontentloaded" });
  assert.ok(await noJsPage.locator(".payload-bay__noscript").isVisible());
  assert.match(
    await noJsPage.locator(".payload-bay__noscript").textContent(),
    /does not submit or open an email client/i
  );
  assert.strictEqual(await noJsPage.locator("[data-js-public-intent]").isVisible(), false);
  assert.strictEqual(await noJsPage.locator("[data-public-fields]").isVisible(), false);
  assert.strictEqual(await noJsPage.locator('input[name="intent"]:checked').getAttribute("value"), "private");
  assert.strictEqual(await noJsPage.locator("#contact-form").getAttribute("action"), "/contact.html#contact-form");
  assert.strictEqual(await noJsPage.locator("[data-contact-submit]").isDisabled(), true);
  await noJsContext.close();
}

async function testViewportsAndScreenshots(browser, origin) {
  fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
  const viewports = [
    { name: "mobile", width: 360, height: 800 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "landscape", width: 1024, height: 768 },
    { name: "desktop", width: 1440, height: 900 }
  ];
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const route of ["/contact.html", "/signals.html"]) {
      await page.goto(origin + route, { waitUntil: "domcontentloaded" });
      const overflow = await page.evaluate(function () {
        return document.documentElement.scrollWidth - document.documentElement.clientWidth;
      });
      assert.ok(overflow <= 1, route + " overflowed " + viewport.name + " by " + overflow + "px");
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + "/contact.html?publicBoundary=1", { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: path.join(EVIDENCE_ROOT, "contact-default-desktop.png"), fullPage: true });
  await page.goto(origin + "/signals.html", { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: path.join(EVIDENCE_ROOT, "signals-empty-desktop.png"), fullPage: true });
  await page.goto(origin + "/signals.html?localDemo=1", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-signal-record]");
  await page.screenshot({ path: path.join(EVIDENCE_ROOT, "signals-local-demo-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/contact.html?localDemo=1&intent=public", { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: path.join(EVIDENCE_ROOT, "contact-public-mobile.png"), fullPage: true });
  await context.close();
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, "dist", "contact.html"))) {
    throw new Error("Build dist before running the focused Contact/Signals browser test.");
  }
  const local = createLocalServer({ port: PORT, rootDir: path.join(ROOT, "dist") });
  const origin = await local.start();
  assert.strictEqual(await requestWithHostHeader("localhost:" + PORT), 421);
  const browser = await chromium.launch({ headless: true });
  try {
    await testDefaultBoundary(browser, origin);
    await testConfiguredContact(browser, origin, local);
    await testDesktopLaunchMotion(browser, origin);
    await testAppsScriptIframeBridge(browser, origin, local);
    await testSignals(browser, origin);
    await testTouchReducedAndNoJs(browser, origin);
    await testViewportsAndScreenshots(browser, origin);
    console.log("Contact/Signals focused browser matrix passed; screenshots: " + EVIDENCE_ROOT);
  } finally {
    await browser.close();
    await local.stop();
  }
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
