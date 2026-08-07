const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const STORAGE_KEY = "ac.route-signal.v1";
const DEFAULT_EVIDENCE_DIR = "/tmp/ac-route-signal-handoff";

async function checkRouteSignalHandoff({
  browser,
  baseUrl,
  failures,
  evidenceDir = process.env.ROUTE_SIGNAL_EVIDENCE_DIR || DEFAULT_EVIDENCE_DIR
}) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const startingFailureCount = failures.length;
  const assert = (condition, message) => {
    if (!condition) failures.push(message);
  };
  const attachIssues = (page, label) => {
    page.on("pageerror", (error) => failures.push(`${label} pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(`${label} console error: ${message.text()}`);
    });
  };
  const installEventCapture = (context) => context.addInitScript(() => {
    window.__routeSignalEvents = [];
    for (const type of ["emit", "receive"]) {
      document.addEventListener(`route-signal:${type}`, (event) => {
        window.__routeSignalEvents.push({ type, detail: event.detail });
      });
    }
  });
  const snapshot = (page, destination) => page.evaluate(({ key, destination: routeDestination }) => {
    const emitter = document.querySelector("[data-route-signal-emitter]");
    const receiver = document.querySelector(`[data-route-signal-receiver="${routeDestination}"]`);
    const receiverState = receiver?.querySelector("[data-route-signal-receiver-state]");
    return {
      arrival: document.body.dataset.routeSignalArrival || null,
      emitterVisible: emitter ? !emitter.hidden && getComputedStyle(emitter).display !== "none" : false,
      events: window.__routeSignalEvents || [],
      historyMarker: history.state?.__acRouteSignal || null,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      mode: document.body.dataset.routeSignalMode || null,
      outbound: document.body.dataset.routeSignalOutbound || null,
      page: document.body.dataset.routeSignalPage || null,
      ready: document.body.dataset.routeSignalReady || null,
      receiverPointerEvents: receiver ? getComputedStyle(receiver).pointerEvents : null,
      receiverInViewport: receiver ? (() => {
        const bounds = receiver.getBoundingClientRect();
        return bounds.right > 0 && bounds.bottom > 0 && bounds.left < innerWidth && bounds.top < innerHeight;
      })() : false,
      receiverState: receiver?.dataset.routeSignalState || null,
      receiverStatus: receiverState?.textContent?.trim() || null,
      receiverVisible: receiver ? !receiver.hidden && getComputedStyle(receiver).display !== "none" : false,
      runningReceiverAnimations: receiver
        ? receiver.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length
        : 0,
      storedSignal: sessionStorage.getItem(key),
      url: location.href
    };
  }, { key: STORAGE_KEY, destination });
  const focusFacet = async (page, destination, useTouch = false) => {
    const control = page.locator(`[data-map-target="${destination}"]`);
    await control.scrollIntoViewIfNeeded();
    if (useTouch) await control.tap();
    else await control.click();
    await page.waitForFunction((value) => {
      const root = document.querySelector("[data-synthesis]");
      const detail = document.querySelector(`[data-facet-detail="${value}"]`);
      return root?.dataset.phase === "focused" && detail?.classList.contains("is-active");
    }, destination);
  };

  // Direct entry, refresh, malformed payloads and valid reload payloads never
  // produce an arrival. Taking storage before validation keeps every token
  // one-time even when its shape is rejected.
  const directContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await installEventCapture(directContext);
  const directPage = await directContext.newPage();
  attachIssues(directPage, "Signal handoff direct-entry");
  for (const destination of ["work", "contact"]) {
    const destinationPath = `/${destination}.html`;
    await directPage.goto(`${baseUrl}${destinationPath}`, { waitUntil: "domcontentloaded" });
    const directState = await snapshot(directPage, destination);
    await assert(directState.ready === "true" && !directState.receiverVisible && directState.storedSignal === null,
      `Signal handoff direct ${destination} entry played or retained a signal: ${JSON.stringify(directState)}`);
    await assert(await directPage.locator("h1").isVisible(), `Signal handoff direct ${destination} entry hides primary content`);

    await directPage.evaluate(({ key, destination: routeDestination }) => {
      sessionStorage.setItem(key, JSON.stringify({
        version: 1,
        token: "0123456789abcdef",
        source: "dashboard",
        destination: routeDestination,
        createdAt: Date.now(),
        unexpected: true
      }));
    }, { key: STORAGE_KEY, destination });
    await directPage.goto(`${baseUrl}${destinationPath}`, { waitUntil: "domcontentloaded" });
    const invalidState = await snapshot(directPage, destination);
    await assert(!invalidState.receiverVisible && invalidState.storedSignal === null,
      `Signal handoff ${destination} accepted or retained a malformed token: ${JSON.stringify(invalidState)}`);

    await directPage.evaluate(({ key, destination: routeDestination }) => {
      sessionStorage.setItem(key, JSON.stringify({
        version: 1,
        token: "fedcba9876543210",
        source: "dashboard",
        destination: routeDestination,
        createdAt: Date.now()
      }));
    }, { key: STORAGE_KEY, destination });
    await directPage.reload({ waitUntil: "domcontentloaded" });
    const reloadState = await snapshot(directPage, destination);
    await assert(!reloadState.receiverVisible && reloadState.storedSignal === null,
      `Signal handoff ${destination} refresh replayed or retained an arrival: ${JSON.stringify(reloadState)}`);
  }
  await directContext.close();

  // Only the two major-region CTAs carry the experiment. Modifier, auxiliary,
  // download, new-context and ordinary top-nav activations stay native.
  const nativeContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await installEventCapture(nativeContext);
  const nativePage = await nativeContext.newPage();
  attachIssues(nativePage, "Signal handoff native activation");
  await nativePage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  const sourceScope = await nativePage.evaluate(() => ({
    annotated: [...document.querySelectorAll("a[data-route-signal-link]")].map((anchor) => ({
      destination: anchor.dataset.routeSignalDestination,
      href: anchor.getAttribute("href")
    })),
    navAnnotated: document.querySelectorAll("#site-nav [data-route-signal-link], #site-nav-mobile [data-route-signal-link]").length
  }));
  await assert(JSON.stringify(sourceScope.annotated) === JSON.stringify([
    { destination: "work", href: "/work.html" },
    { destination: "contact", href: "/contact.html" }
  ]) && sourceScope.navAnnotated === 0, `Signal handoff source scope generalized beyond the two proof CTAs: ${JSON.stringify(sourceScope)}`);

  const nativeActivations = [
    { altKey: true, name: "Alt-click" },
    { button: 1, name: "middle-click" },
    { ctrlKey: true, name: "Control-click" },
    { download: true, name: "download" },
    { metaKey: true, name: "Meta-click" },
    { shiftKey: true, name: "Shift-click" },
    { target: "_blank", name: "target-blank" }
  ];
  for (const activation of nativeActivations) {
    const result = await nativePage.evaluate(({ name: _name, target, download, ...mouse }) => new Promise((resolve) => {
      const anchor = document.querySelector('[data-route-signal-destination="work"]');
      const previousTarget = anchor.getAttribute("target");
      const hadDownload = anchor.hasAttribute("download");
      if (target) anchor.setAttribute("target", target);
      if (download) anchor.setAttribute("download", "work.html");
      window.addEventListener("click", (event) => {
        const value = {
          emitterVisible: !document.querySelector("[data-route-signal-emitter]").hidden,
          preventedByHandoff: event.defaultPrevented,
          storedSignal: sessionStorage.getItem("ac.route-signal.v1")
        };
        event.preventDefault();
        if (previousTarget === null) anchor.removeAttribute("target");
        else anchor.setAttribute("target", previousTarget);
        if (!hadDownload) anchor.removeAttribute("download");
        resolve(value);
      }, { once: true });
      anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, button: mouse.button || 0, cancelable: true, ...mouse }));
    }), activation);
    await assert(!result.preventedByHandoff && !result.emitterVisible && result.storedSignal === null,
      `Signal handoff ${activation.name} no longer stays native: ${JSON.stringify(result)}`);
  }
  const topNavState = await nativePage.evaluate(() => new Promise((resolve) => {
    const anchor = document.querySelector('#site-nav a[href="/work.html"]');
    window.addEventListener("click", (event) => {
      const result = {
        annotated: anchor.hasAttribute("data-route-signal-link"),
        emitterVisible: !document.querySelector("[data-route-signal-emitter]").hidden,
        preventedByHandoff: event.defaultPrevented,
        storedSignal: sessionStorage.getItem("ac.route-signal.v1")
      };
      event.preventDefault();
      resolve(result);
    }, { once: true });
    anchor.click();
  }));
  await assert(!topNavState.annotated && !topNavState.preventedByHandoff && !topNavState.emitterVisible && topNavState.storedSignal === null,
    `Signal handoff intercepted ordinary top navigation: ${JSON.stringify(topNavState)}`);
  await nativeContext.close();

  const unavailableContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  await unavailableContext.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(storageKey, value) {
      if (storageKey === key) throw new DOMException("Storage unavailable", "QuotaExceededError");
      return original.call(this, storageKey, value);
    };
  }, STORAGE_KEY);
  const unavailablePage = await unavailableContext.newPage();
  attachIssues(unavailablePage, "Signal handoff storage fallback");
  await unavailablePage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  const unavailableState = await unavailablePage.evaluate(() => new Promise((resolve) => {
    const anchor = document.querySelector('[data-route-signal-destination="work"]');
    window.addEventListener("click", (event) => {
      const result = {
        emitterVisible: !document.querySelector("[data-route-signal-emitter]").hidden,
        preventedByHandoff: event.defaultPrevented
      };
      event.preventDefault();
      resolve(result);
    }, { once: true });
    anchor.click();
  }));
  await assert(!unavailableState.preventedByHandoff && !unavailableState.emitterVisible,
    `Signal handoff storage failure did not fall through to the native anchor: ${JSON.stringify(unavailableState)}`);
  await unavailableContext.close();

  // A competing navigation can win during the brief departure interval. The
  // resulting token must be consumed as stale when the user later reaches the
  // nominal destination from anywhere except the dashboard.
  const diversionContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  await installEventCapture(diversionContext);
  const diversionPage = await diversionContext.newPage();
  attachIssues(diversionPage, "Signal handoff diverted navigation");
  await diversionPage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await focusFacet(diversionPage, "work");
  await diversionPage.evaluate(() => {
    document.querySelector('[data-route-signal-destination="work"]').click();
    window.location.assign("/about.html");
  });
  await diversionPage.waitForURL((url) => url.pathname === "/about.html", { waitUntil: "domcontentloaded" });
  const divertedToken = await diversionPage.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY);
  await assert(Boolean(divertedToken), "Signal handoff diversion setup did not retain the interrupted one-time token");
  await diversionPage.locator('#site-nav a[href="/work.html"]').click();
  await diversionPage.waitForURL((url) => url.pathname === "/work.html", { waitUntil: "domcontentloaded" });
  const divertedArrival = await snapshot(diversionPage, "work");
  await assert(
    !divertedArrival.receiverVisible
      && divertedArrival.storedSignal === null
      && divertedArrival.historyMarker === null,
    `Signal handoff replayed a diverted dashboard token from a non-dashboard referrer: ${JSON.stringify(divertedArrival)}`
  );
  await diversionContext.close();

  // Keyboard activation proves the W2-style trajectory handoff and its
  // session/history privacy boundary end-to-end.
  const workContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await installEventCapture(workContext);
  const workPage = await workContext.newPage();
  attachIssues(workPage, "Signal handoff Work");
  await workPage.route("**/work.html", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 90));
    await route.continue();
  });
  await workPage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await focusFacet(workPage, "work");
  const workLink = workPage.locator('[data-route-signal-destination="work"]');
  await workLink.focus();
  const workNavigation = workPage.waitForURL((url) => url.pathname === "/work.html", { waitUntil: "domcontentloaded" });
  await workPage.keyboard.press("Enter");
  const emitter = workPage.locator("[data-route-signal-emitter]");
  await emitter.waitFor({ state: "visible", timeout: 180 });
  const outboundState = await workPage.evaluate((key) => {
    const stored = sessionStorage.getItem(key);
    const signal = stored ? JSON.parse(stored) : null;
    return {
      event: window.__routeSignalEvents?.[0] || null,
      historyContainsToken: signal ? JSON.stringify(history.state).includes(signal.token) : null,
      historyMarker: history.state?.__acRouteSignal || null,
      label: document.querySelector("[data-route-signal-emitter-label]")?.textContent?.trim(),
      mode: document.body.dataset.routeSignalMode,
      signal,
      tokenInDom: signal ? document.documentElement.outerHTML.includes(signal.token) : null,
      url: location.href
    };
  }, STORAGE_KEY);
  await assert(
    outboundState.mode === "normal"
      && outboundState.label === "DESTINATION ID · WORK"
      && outboundState.event?.type === "emit"
      && JSON.stringify(outboundState.event.detail) === JSON.stringify({ source: "dashboard", destination: "work" })
      && JSON.stringify(Object.keys(outboundState.signal || {}).sort()) === JSON.stringify(["createdAt", "destination", "source", "token", "version"])
      && !outboundState.historyContainsToken
      && !outboundState.tokenInDom
      && new URL(outboundState.url).pathname === "/"
      && !new URL(outboundState.url).search
      && new URL(outboundState.url).hash === "#facet-work"
      && !outboundState.url.includes(outboundState.signal.token),
    `Signal handoff Work outbound signal is incomplete or leaks its token: ${JSON.stringify(outboundState)}`
  );
  await workNavigation;
  await workPage.unroute("**/work.html");
  const workReceiver = workPage.locator('[data-route-signal-receiver="work"]');
  await workReceiver.waitFor({ state: "visible", timeout: 400 });
  const workArrivalStartedAt = Date.now();
  await workPage.waitForFunction(() => document.querySelector('[data-route-signal-receiver="work"]')?.dataset.routeSignalState === "resolved");
  const workState = await snapshot(workPage, "work");
  const workReleaseStroke = await workPage.locator(".work-pipeline__node--release rect").evaluate((element) => getComputedStyle(element).stroke);
  await workPage.screenshot({ path: path.join(evidenceDir, "work-trajectory-arrival.png") });
  await assert(
    workState.arrival === "work"
      && workState.receiverStatus === "TRAJECTORY LOCK ACQUIRED · PORTFOLIO READY"
      && workState.receiverPointerEvents === "none"
      && workState.storedSignal === null
      && workState.historyMarker?.phase === "resolved"
      && !JSON.stringify(workState.historyMarker).includes(outboundState.signal.token)
      && workState.events.some((event) => event.type === "receive" && event.detail?.destination === "work")
      && Math.abs(workState.horizontalOverflow) <= 1
      && new URL(workState.url).pathname === "/work.html"
      && !new URL(workState.url).search
      && !new URL(workState.url).hash
      && workReleaseStroke !== "none",
    `Signal handoff Work arrival is incomplete: ${JSON.stringify({ ...workState, workReleaseStroke })}`
  );
  await assert(await workPage.locator("#work-title").isVisible(), "Signal handoff Work arrival hides immediate destination content");
  await workReceiver.waitFor({ state: "hidden", timeout: 750 });
  await assert(Date.now() - workArrivalStartedAt < 700, "Signal handoff Work receiver exceeded its 620ms arrival phase");

  await workPage.reload({ waitUntil: "domcontentloaded" });
  await assert(!(await snapshot(workPage, "work")).receiverVisible, "Signal handoff Work refresh replayed the receiver");
  await workPage.goBack({ waitUntil: "domcontentloaded" });
  await workPage.waitForTimeout(80);
  const backState = await snapshot(workPage, "work");
  await assert(!backState.emitterVisible && backState.historyMarker === null,
    `Signal handoff Back navigation replayed the emitter or retained its outbound marker: ${JSON.stringify(backState)}`);
  await workPage.goForward({ waitUntil: "domcontentloaded" });
  await workPage.waitForTimeout(80);
  await assert(!(await snapshot(workPage, "work")).receiverVisible, "Signal handoff Forward/BFCache navigation replayed the receiver");
  const persistedCleanup = await workPage.evaluate((key) => {
    sessionStorage.setItem(key, "stale");
    const receiver = document.querySelector('[data-route-signal-receiver="work"]');
    receiver.hidden = false;
    document.body.dataset.routeSignalArrival = "work";
    let event;
    try {
      event = new PageTransitionEvent("pageshow", { persisted: true });
    } catch (_error) {
      event = new Event("pageshow");
      Object.defineProperty(event, "persisted", { value: true });
    }
    window.dispatchEvent(event);
    return {
      arrival: document.body.dataset.routeSignalArrival || null,
      receiverHidden: receiver.hidden,
      storedSignal: sessionStorage.getItem(key)
    };
  }, STORAGE_KEY);
  await assert(persistedCleanup.receiverHidden && !persistedCleanup.arrival && persistedCleanup.storedSignal === null,
    `Signal handoff persisted-pageshow cleanup failed: ${JSON.stringify(persistedCleanup)}`);
  await workContext.close();

  // Touch activation proves the C3-style telemetry receiver remains bounded and
  // leaves the form and navigation usable on a narrow viewport.
  const touchContext = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  await installEventCapture(touchContext);
  const touchPage = await touchContext.newPage();
  attachIssues(touchPage, "Signal handoff Contact touch");
  await touchPage.route("**/contact.html", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 80));
    await route.continue();
  });
  await touchPage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await focusFacet(touchPage, "contact", true);
  const contactLink = touchPage.locator('[data-route-signal-destination="contact"]');
  await contactLink.scrollIntoViewIfNeeded();
  const contactTarget = await contactLink.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { height: bounds.height, width: bounds.width };
  });
  const contactNavigation = touchPage.waitForURL((url) => url.pathname === "/contact.html", { waitUntil: "domcontentloaded" });
  await contactLink.tap({ noWaitAfter: true });
  await touchPage.locator("[data-route-signal-emitter]").waitFor({ state: "visible", timeout: 180 });
  await contactNavigation;
  await touchPage.unroute("**/contact.html");
  const contactReceiver = touchPage.locator('[data-route-signal-receiver="contact"]');
  await contactReceiver.waitFor({ state: "visible", timeout: 400 });
  await touchPage.waitForFunction(() => document.querySelector('[data-route-signal-receiver="contact"]')?.dataset.routeSignalState === "resolved");
  const contactState = await snapshot(touchPage, "contact");
  await touchPage.screenshot({ path: path.join(evidenceDir, "contact-telemetry-arrival-mobile.png") });
  await assert(
    contactTarget.height >= 44
      && contactTarget.width >= 44
      && contactState.arrival === "contact"
      && contactState.receiverInViewport
      && contactState.receiverStatus === "TELEMETRY LOCK ACQUIRED · CONTACT READY"
      && contactState.receiverPointerEvents === "none"
      && contactState.storedSignal === null
      && contactState.events.some((event) => event.type === "receive" && event.detail?.destination === "contact")
      && Math.abs(contactState.horizontalOverflow) <= 1
      && new URL(contactState.url).pathname === "/contact.html",
    `Signal handoff Contact touch arrival is incomplete: ${JSON.stringify({ contactTarget, contactState })}`
  );
  await assert(await touchPage.locator("h1").isVisible() && await touchPage.locator("#contact-form").isVisible(),
    "Signal handoff Contact arrival hides immediate destination content");
  await contactReceiver.waitFor({ state: "hidden", timeout: 1200 });
  await touchContext.close();

  // Reduced-motion and constrained-device paths retain the labeled handoff as
  // a short static cue. They never start an animation.
  const fallbackCases = [
    {
      label: "reduced-motion",
      context: { reducedMotion: "reduce", viewport: { width: 1024, height: 768 } },
      destination: "work",
      expectedMode: "reduced"
    },
    {
      label: "save-data",
      context: { viewport: { width: 1024, height: 768 } },
      destination: "contact",
      expectedMode: "constrained",
      install: () => Object.defineProperty(Navigator.prototype, "connection", {
        configurable: true,
        get: () => ({ effectiveType: "4g", saveData: true })
      })
    },
    {
      label: "low-device",
      context: { viewport: { width: 844, height: 390 } },
      destination: "work",
      expectedMode: "constrained",
      install: () => {
        Object.defineProperty(Navigator.prototype, "deviceMemory", { configurable: true, get: () => 2 });
        Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { configurable: true, get: () => 2 });
      }
    }
  ];
  for (const fallback of fallbackCases) {
    const context = await browser.newContext(fallback.context);
    if (fallback.install) await context.addInitScript(fallback.install);
    await context.addInitScript(() => {
      document.addEventListener("route-signal:receive", (event) => {
        const element = document.querySelector(`[data-route-signal-receiver="${event.detail?.destination}"]`);
        window.__routeSignalArrivalSample = {
          mode: document.body.dataset.routeSignalMode,
          runningAnimations: element.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length,
          visible: !element.hidden && getComputedStyle(element).display !== "none"
        };
      });
    });
    const page = await context.newPage();
    attachIssues(page, `Signal handoff ${fallback.label}`);
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await focusFacet(page, fallback.destination);
    const navigation = page.waitForURL((url) => url.pathname === `/${fallback.destination}.html`, { waitUntil: "domcontentloaded" });
    const sourceMotion = await page.evaluate((destination) => new Promise((resolve) => {
      document.addEventListener("route-signal:emit", () => {
        const element = document.querySelector("[data-route-signal-emitter]");
        resolve({
          mode: document.body.dataset.routeSignalMode,
          runningAnimations: element.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length,
          visible: !element.hidden && getComputedStyle(element).display !== "none"
        });
      }, { once: true });
      document.querySelector(`[data-route-signal-destination="${destination}"]`).click();
    }), fallback.destination);
    await navigation;
    await page.waitForFunction(() => Boolean(window.__routeSignalArrivalSample));
    const arrivalMotion = await page.evaluate(() => window.__routeSignalArrivalSample);
    await assert(
      sourceMotion.mode === fallback.expectedMode
        && sourceMotion.visible
        && sourceMotion.runningAnimations === 0
        && arrivalMotion.mode === fallback.expectedMode
        && arrivalMotion.visible
        && arrivalMotion.runningAnimations === 0
        && await page.locator("h1").isVisible(),
      `Signal handoff ${fallback.label} did not remain a static, usable cue: ${JSON.stringify({ sourceMotion, arrivalMotion })}`
    );
    await context.close();
  }

  const noScriptContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const noScriptPage = await noScriptContext.newPage();
  await noScriptPage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  const noScriptLink = noScriptPage.locator('[data-route-signal-destination="work"]');
  await noScriptLink.scrollIntoViewIfNeeded();
  await noScriptLink.click();
  await assert(new URL(noScriptPage.url()).pathname === "/work.html" && await noScriptPage.locator("#work-title").isVisible(),
    "Signal handoff JavaScript-disabled path no longer uses the native Work anchor");
  await assert(!(await noScriptPage.locator('[data-route-signal-receiver="work"]').isVisible()),
    "Signal handoff JavaScript-disabled destination exposes the hidden receiver");
  await noScriptContext.close();

  return {
    evidenceDir,
    failuresAdded: failures.length - startingFailureCount
  };
}

async function main() {
  const baseUrl = process.env.BASE_URL || "http://127.0.0.1:4173";
  const evidenceDir = process.env.ROUTE_SIGNAL_EVIDENCE_DIR || DEFAULT_EVIDENCE_DIR;
  fs.rmSync(evidenceDir, { recursive: true, force: true });
  fs.mkdirSync(evidenceDir, { recursive: true });
  const failures = [];
  const browser = await chromium.launch({ headless: true });
  try {
    await checkRouteSignalHandoff({ browser, baseUrl, failures, evidenceDir });
  } finally {
    await browser.close();
  }
  const report = {
    baseUrl,
    evidenceDir,
    failures,
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync(path.join(evidenceDir, "focused-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { checkRouteSignalHandoff };
