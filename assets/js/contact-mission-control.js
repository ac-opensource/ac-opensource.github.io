(function () {
  "use strict";

  const root = document.querySelector("[data-contact-console]");
  const form = document.getElementById("contact-form");
  const adapter = window.ContactTransport;
  if (!root || !form || !adapter) return;

  const fallbackConfig = Object.freeze({
    version: 1,
    enabled: false,
    endpoint: "",
    publicFeedEndpoint: "",
    requestTimeoutMs: 8000
  });
  const queryAtLoad = new URL(window.location.href);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const elements = {
    banner: root.querySelector("[data-demo-banner]"),
    transportChip: root.querySelector("[data-transport-chip]"),
    submit: root.querySelector("[data-contact-submit]"),
    submitLabel: root.querySelector("[data-submit-label]"),
    transportNote: root.querySelector("[data-transport-note]"),
    status: document.getElementById("contact-form-status"),
    name: document.getElementById("contact-name"),
    email: document.getElementById("contact-email"),
    message: document.getElementById("contact-message"),
    publicFields: root.querySelector("[data-public-fields]"),
    quote: document.getElementById("contact-public-quote"),
    target: document.getElementById("contact-public-target"),
    consent: document.getElementById("contact-public-consent"),
    privateCount: root.querySelector("[data-private-count]"),
    publicCount: root.querySelector("[data-public-count]"),
    validation: root.querySelector("[data-telemetry-validation]"),
    payload: root.querySelector("[data-telemetry-payload]"),
    transport: root.querySelector("[data-telemetry-transport]"),
    privacy: root.querySelector("[data-telemetry-privacy]"),
    state: root.querySelector("[data-telemetry-state]"),
    localTime: document.getElementById("local-time-value"),
    trajectory: root.querySelector("[data-trajectory]"),
    trajectoryPhase: root.querySelector("[data-trajectory-phase]"),
    routeDestination: root.querySelector("[data-route-destination]"),
    routeDestinationLabel: root.querySelector("[data-route-destination-label]"),
    receiptKicker: root.querySelector("[data-receipt-kicker]"),
    receiptHeading: root.querySelector("[data-receipt-heading]"),
    receiptBody: root.querySelector("[data-receipt-body]"),
    receiptId: root.querySelector("[data-receipt-id]"),
    retry: root.querySelector("[data-contact-retry]"),
    skip: form.querySelector("[data-skip-launch]"),
    demoLink: form.querySelector("[data-local-demo-link]")
  };
  const intentInputs = Array.from(form.querySelectorAll('input[name="intent"]'));
  const publicIntentLabel = form.querySelector("[data-js-public-intent]");
  const displayInputs = Array.from(form.querySelectorAll('input[name="publicDisplay"]'));
  const publicControls = [elements.quote, elements.target, elements.consent].concat(displayInputs);
  const stageItems = new Map(
    Array.from(root.querySelectorAll("[data-route-stage]")).map(function (item) {
      return [item.dataset.routeStage, item];
    })
  );
  const stageStatus = new Map(
    Array.from(root.querySelectorAll("[data-route-status]")).map(function (item) {
      return [item.dataset.routeStatus, item];
    })
  );
  const timers = new Set();
  let requestController = null;
  let generation = 0;
  let state = "idle";
  let trajectoryVisible = true;
  let runtime = fallbackConfig;
  let effectiveRuntime = fallbackConfig;
  let transport = null;
  let loopbackDemoAvailable = false;
  let loopbackDemoActive = false;
  let clock = 0;

  function setText(element, value) {
    if (element) element.textContent = value;
  }

  function parseRuntime() {
    const node = document.getElementById("contact-runtime-config");
    try {
      const candidate = JSON.parse(node ? node.textContent : "");
      return adapter.validateRuntimeConfig(candidate, window.location);
    } catch (error) {
      if (elements.banner) {
        elements.banner.hidden = false;
        elements.banner.classList.add("is-rejected");
        elements.banner.textContent = "[RUNTIME CONFIG REJECTED] Email-app handoff remains active; no endpoint request will be made.";
      }
      console.error("Contact runtime config rejected; using disabled mailto fallback.", error);
      return adapter.validateRuntimeConfig(fallbackConfig, window.location);
    }
  }

  function configureRuntime() {
    runtime = parseRuntime();
    let endpoint = null;
    try {
      endpoint = runtime.endpoint ? new URL(runtime.endpoint) : null;
    } catch (_error) {
      endpoint = null;
    }
    const exactLoopback =
      window.location.protocol === "http:" &&
      window.location.hostname === "127.0.0.1" &&
      endpoint &&
      endpoint.origin === window.location.origin &&
      endpoint.hostname === "127.0.0.1";
    loopbackDemoAvailable = Boolean(runtime.enabled && exactLoopback);
    loopbackDemoActive = loopbackDemoAvailable && queryAtLoad.searchParams.get("localDemo") === "1";
    effectiveRuntime = loopbackDemoAvailable && !loopbackDemoActive ? fallbackConfig : runtime;
    transport = adapter.create({
      config: effectiveRuntime,
      location: window.location,
      destination: "aarconcepcion@gmail.com",
      fetchImpl: window.fetch.bind(window),
      navigate: function (uri) {
        const link = document.createElement("a");
        link.href = uri;
        link.hidden = true;
        link.tabIndex = -1;
        document.body.append(link);
        link.click();
        link.remove();
      }
    });

    if (loopbackDemoActive) {
      elements.banner.hidden = false;
      elements.banner.classList.remove("is-rejected");
      elements.banner.textContent = "[LOCAL DEMO TRANSPORT] Exact 127.0.0.1 test service only. Opaque receipts and approved feed records are test data, never production evidence.";
    } else if (queryAtLoad.searchParams.get("localDemo") === "1" && !loopbackDemoAvailable) {
      elements.banner.hidden = false;
      elements.banner.classList.add("is-rejected");
      elements.banner.textContent = "[LOCAL DEMO UNAVAILABLE] An exact 127.0.0.1 configured server is required. Email-app handoff remains active.";
    }
    updateDemoLink();
  }

  function getIntent() {
    const selected = intentInputs.find(function (input) { return input.checked; });
    return selected && selected.value === "public" ? "public" : "private";
  }

  function getDisplay() {
    const selected = displayInputs.find(function (input) { return input.checked; });
    return selected && selected.value === "named" ? "named" : "anonymous";
  }

  function fieldSummary() {
    const name = elements.name.value.trim();
    const email = elements.email.value.trim();
    const privateMessage = elements.message.value.trim();
    const quote = elements.quote.value.trim();
    const intent = getIntent();
    const missing = [];
    if (name.length < 2) missing.push("name");
    if (!email || !elements.email.validity.valid) missing.push("valid email");
    if (privateMessage.length < 1 || privateMessage.length > 4000) {
      missing.push("1–4000 character private message");
    }
    if (intent === "public" && (quote.length < 20 || quote.length > 280)) {
      missing.push("20–280 character public quote");
    }
    if (intent === "public" && !elements.consent.checked) missing.push("explicit public consent");
    return { name, email, privateMessage, quote, intent, missing };
  }

  function currentPayload() {
    const values = fieldSummary();
    const context = new URL(window.location.href);
    context.search = values.intent === "public" ? "?intent=public" : "";
    context.hash = "";
    const payload = {
      version: 1,
      intent: values.intent,
      name: values.name,
      email: values.email,
      privateMessage: values.privateMessage,
      contextPath: context.pathname + context.search
    };
    if (values.intent === "public") {
      const mode = getDisplay();
      payload.public = {
        quote: values.quote,
        target: elements.target.value,
        display: { mode, label: mode === "named" ? values.name : "Anonymous" },
        consent: elements.consent.checked
      };
    }
    return payload;
  }

  function clearTimers() {
    timers.forEach(function (timer) { window.clearTimeout(timer); });
    timers.clear();
  }

  function after(delay, callback) {
    const timer = window.setTimeout(function () {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  }

  function setStage(name, text, stageState) {
    setText(stageStatus.get(name), text);
    const item = stageItems.get(name);
    if (!item) return;
    if (stageState) item.dataset.stageState = stageState;
    else delete item.dataset.stageState;
  }

  function showReceiptId(receiptId) {
    elements.receiptId.hidden = !receiptId;
    elements.receiptId.textContent = receiptId ? "OPAQUE RECEIPT · " + receiptId : "";
  }

  function setBusy(busy) {
    elements.submit.disabled = busy;
    elements.submit.setAttribute("aria-disabled", String(busy));
  }

  function clearFlight() {
    root.classList.remove("is-flight-active", "is-motion-paused");
  }

  function setFlight(active) {
    clearFlight();
    if (!active) return;
    void root.offsetWidth;
    root.classList.add("is-flight-active");
    root.classList.toggle("is-motion-paused", document.hidden || !trajectoryVisible);
  }

  function routeLanguage(intent) {
    const isPublic = intent === "public";
    setText(elements.routeDestination, isPublic ? "PUBLIC HOLDING ORBIT" : "PRIVATE CORRIDOR");
    setText(elements.routeDestinationLabel, isPublic ? "03 · Public holding orbit" : "03 · Private corridor");
  }

  function setState(next, detail) {
    state = next;
    root.dataset.missionState = next;
    elements.retry.hidden = true;
    elements.skip.hidden = true;
    showReceiptId("");

    if (next === "idle") {
      clearFlight();
      setBusy(false);
      setStage("launch", "Awaiting preflight");
      setStage("insertion", "Not started");
      setStage("destination", transport && transport.kind === "configured_endpoint" ? "Configured route available" : "Email-app handoff");
      setText(elements.state, "IDLE · NOTHING SENT");
      setText(elements.trajectoryPhase, "IDLE · NOTHING SENT");
      setText(elements.receiptKicker, "[operator feedback]");
      setText(elements.receiptHeading, detail && detail.reason ? "Route reset safely." : "Nothing has been sent.");
      setText(
        elements.receiptBody,
        detail && detail.reason
          ? detail.reason + " Form content is preserved."
          : "Complete the required fields to prepare the selected route. No receipt exists."
      );
      setText(elements.status, detail && detail.reason ? detail.reason + " Form content is preserved." : "Nothing has been sent.");
      return;
    }
    if (next === "validating") {
      clearFlight();
      setBusy(true);
      setStage("launch", "Validating fields", "active");
      setStage("insertion", "Not started");
      setStage("destination", "Not started");
      setText(elements.state, "VALIDATING · LOCAL PREFLIGHT");
      setText(elements.trajectoryPhase, "PREFLIGHT · NO REQUEST YET");
      setText(elements.receiptKicker, "[preflight]");
      setText(elements.receiptHeading, "Checking the selected route.");
      setText(elements.receiptBody, "No receipt or launch state exists during local validation.");
      setText(elements.status, "Running local preflight checks.");
      return;
    }
    if (next === "handoff") {
      clearFlight();
      setBusy(false);
      setStage("launch", "Email app requested", "complete");
      setStage("insertion", "Unavailable without endpoint");
      setStage("destination", "Sending remains in your email app");
      setText(elements.state, "HANDOFF · DELIVERY UNKNOWN");
      setText(elements.trajectoryPhase, "EMAIL-APP HANDOFF · NO LAUNCH");
      setText(elements.receiptKicker, "[email-app handoff]");
      setText(elements.receiptHeading, "No website receipt was created.");
      setText(elements.receiptBody, "Check your email app. This page cannot know whether the draft is sent, delivered, or received.");
      setText(elements.status, "Email app requested. Sending and delivery are not confirmed.");
      return;
    }
    if (next === "submitting") {
      setBusy(true);
      setStage("launch", "Preflight complete", "complete");
      setStage("insertion", "Request in progress", "active");
      setStage("destination", "Awaiting configured response");
      setText(elements.state, "SUBMITTING · CONFIGURED ENDPOINT");
      setText(elements.trajectoryPhase, "REQUEST IN PROGRESS · NO RECEIPT YET");
      setText(elements.receiptKicker, "[configured transport]");
      setText(elements.receiptHeading, "Awaiting a validated response.");
      setText(elements.receiptBody, "No receipt, completion, or moderation state is shown until the response contract passes.");
      setText(elements.status, "Configured request in progress.");
      return;
    }
    if (next === "confirmed") {
      setBusy(true);
      setStage("launch", "Response validated", "complete");
      setStage("insertion", "Ready for route display", "active");
      setStage("destination", detail.intent === "public" ? "Moderation state confirmed" : "Private acceptance confirmed");
      setText(elements.state, detail.intent === "public" ? "CONFIRMED · REVIEW REQUEST" : "CONFIRMED · PRIVATE RESPONSE");
      setText(elements.trajectoryPhase, "RESPONSE VALIDATED · ROUTE READY");
      setText(elements.receiptKicker, "[configured response]");
      setText(
        elements.receiptHeading,
        detail.intent === "public" ? "Review request accepted — not public." : "Private request accepted."
      );
      setText(elements.receiptBody, "The opaque receipt below came from the configured endpoint.");
      showReceiptId(detail.receiptId);
      setText(elements.status, "Configured response validated. Preparing the skippable route display.");
      return;
    }
    if (next === "launching") {
      setBusy(true);
      setFlight(true);
      setStage("launch", "Response validated", "complete");
      setStage("insertion", "Route display active", "active");
      setStage("destination", detail.intent === "public" ? "Approaching holding orbit" : "Approaching private corridor");
      setText(elements.state, "LAUNCHING · DISPLAY ONLY");
      setText(elements.trajectoryPhase, "ROUTE DISPLAY · RECEIPT ALREADY VALIDATED");
      setText(elements.receiptKicker, "[route display]");
      setText(elements.receiptHeading, detail.intent === "public" ? "Approaching a moderation holding orbit." : "Approaching the private corridor.");
      setText(elements.receiptBody, "This animation visualizes the validated response; it is not additional delivery evidence.");
      showReceiptId(detail.receiptId);
      elements.skip.hidden = false;
      setText(elements.status, "Route display in progress. Skip is available beside the form.");
      return;
    }
    if (next === "private_complete") {
      setBusy(false);
      setFlight(false);
      setStage("launch", "Response validated", "complete");
      setStage("insertion", "Route display complete", "complete");
      setStage("destination", "Private endpoint acceptance", "complete");
      setText(elements.state, "PRIVATE COMPLETE");
      setText(elements.trajectoryPhase, "PRIVATE CORRIDOR · COMPLETE");
      setText(elements.receiptKicker, "[private configured response]");
      setText(elements.receiptHeading, "Private request accepted by the configured endpoint.");
      setText(elements.receiptBody, "This receipt confirms the configured service response, not email delivery or a public record.");
      showReceiptId(detail.receiptId);
      setText(elements.status, "Private configured response complete.");
      return;
    }
    if (next === "pending_moderation") {
      setBusy(false);
      setFlight(false);
      setStage("launch", "Response validated", "complete");
      setStage("insertion", "Route display complete", "complete");
      setStage("destination", "Awaiting human moderation", "complete");
      setText(elements.state, "PENDING MODERATION · NOT PUBLIC");
      setText(elements.trajectoryPhase, "HOLDING ORBIT · NOT PUBLIC");
      setText(elements.receiptKicker, "[public review request]");
      setText(elements.receiptHeading, "Holding orbit — awaiting human moderation.");
      setText(elements.receiptBody, "The quote is not approved or public. Client code cannot advance this state.");
      showReceiptId(detail.receiptId);
      setText(elements.status, "Review request is pending human moderation and is not public.");
      return;
    }
    if (next === "failed") {
      setBusy(false);
      setFlight(false);
      setStage("launch", "Preflight complete", "complete");
      setStage("insertion", "Request failed", "active");
      setStage("destination", "No terminal state created");
      setText(elements.state, "FAILED · CONTENT PRESERVED");
      setText(elements.trajectoryPhase, "ROUTE SCRUBBED · NO COMPLETION");
      setText(elements.receiptKicker, "[configured transport failure]");
      setText(elements.receiptHeading, "The configured request did not complete.");
      setText(elements.receiptBody, "No completion or moderation claim was created. Retry uses the preserved form content.");
      elements.retry.hidden = false;
      setText(elements.status, "Configured request failed. Form content is preserved for retry.");
    }
  }

  function invalidate(reason, announce) {
    generation += 1;
    clearTimers();
    if (requestController) requestController.abort(new Error("CONTACT_SNAPSHOT_INVALIDATED"));
    requestController = null;
    if (state !== "idle" || announce) setState("idle", { reason });
    else syncTelemetry();
  }

  function syncTelemetry() {
    const fields = fieldSummary();
    setText(elements.privateCount, fields.privateMessage.length + " characters");
    setText(elements.publicCount, fields.quote.length + " / 280");
    setText(elements.validation, fields.missing.length ? "Awaiting " + fields.missing.join(", ") : "Fields ready");
    setText(
      elements.payload,
      fields.intent === "public"
        ? "Private " + fields.privateMessage.length + " / public " + fields.quote.length
        : "Private message · " + fields.privateMessage.length
    );
    setText(
      elements.privacy,
      fields.intent === "public"
        ? (elements.consent.checked ? "Separate quote consent selected" : "Public quote blocked without consent")
        : "Name, email, and message stay private"
    );
  }

  function updateUrl(intent, mode) {
    const url = new URL(window.location.href);
    if (intent === "public") url.searchParams.set("intent", "public");
    else url.searchParams.delete("intent");
    const next = url.pathname + url.search + url.hash;
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (next !== current) {
      window.history[mode === "replace" ? "replaceState" : "pushState"]({ contactIntent: intent }, "", next);
    }
  }

  function updateDemoLink() {
    if (!elements.demoLink) return;
    elements.demoLink.hidden = !loopbackDemoAvailable || loopbackDemoActive;
    if (elements.demoLink.hidden) return;
    const url = new URL(window.location.href);
    url.searchParams.set("localDemo", "1");
    if (getIntent() === "public") url.searchParams.set("intent", "public");
    else url.searchParams.delete("intent");
    url.hash = "contact-form";
    elements.demoLink.href = url.pathname + url.search + url.hash;
  }

  function applyIntent(intent, historyMode, announce) {
    const normalized = intent === "public" ? "public" : "private";
    intentInputs.forEach(function (input) { input.checked = input.value === normalized; });
    const isPublic = normalized === "public";
    elements.publicFields.hidden = !isPublic;
    publicControls.forEach(function (control) {
      control.disabled = !isPublic;
      if (control === elements.quote || control === elements.consent) control.required = isPublic;
    });
    routeLanguage(normalized);
    setText(elements.submitLabel, transport && transport.kind === "configured_endpoint"
      ? (isPublic ? "Request Human Review" : "Send Private Message")
      : (isPublic ? "Prepare Review Email" : "Open Email App"));
    setText(elements.transportChip, transport && transport.kind === "configured_endpoint" ? "Configured private endpoint" : "Email app handoff");
    setText(elements.transport, transport && transport.kind === "configured_endpoint" ? "Configured API · validated JSON" : "Email app · mailto:");
    setText(
      elements.transportNote,
      transport && transport.kind === "configured_endpoint"
        ? (isPublic
          ? "A valid response can only enter pending moderation; it cannot publish feedback."
          : "A valid response can confirm private service acceptance.")
        : "This opens your email app. The page performs no fetch and cannot create a receipt or delivery claim."
    );
    if (historyMode) updateUrl(normalized, historyMode);
    updateDemoLink();
    invalidate("Intent changed; the previous route snapshot was cleared.", Boolean(announce));
    syncTelemetry();
  }

  async function submit() {
    const fields = fieldSummary();
    setState("validating");
    if (fields.missing.length || !form.checkValidity()) {
      form.reportValidity();
      setState("idle", { reason: "Preflight needs " + (fields.missing.join(", ") || "valid fields") + "." });
      syncTelemetry();
      return;
    }

    let payload;
    try {
      payload = adapter.validatePayload(currentPayload());
    } catch (error) {
      setState("idle", { reason: "Preflight rejected the payload contract." });
      console.error("Contact payload rejected.", error);
      return;
    }

    const token = ++generation;
    requestController = new AbortController();
    try {
      const result = await transport.submit(payload, {
        signal: requestController.signal,
        onState: function (next, detail) {
          if (token !== generation) return;
          if (next === "validating") setState("validating", detail);
          if (next === "submitting") setState("submitting", detail);
          if (next === "handoff") setState("handoff", detail);
        }
      });
      if (token !== generation || result.state === "handoff") return;
      const routeDetail = Object.assign({}, result, { intent: payload.intent });
      setState("confirmed", routeDetail);
      const prelaunchDelay = reducedMotion.matches ? 10 : 180;
      after(prelaunchDelay, function () {
        if (token !== generation) return;
        setState("launching", routeDetail);
        const launchDelay = reducedMotion.matches || document.hidden ? 20 : 1800;
        after(launchDelay, function () {
          if (token !== generation) return;
          setState(payload.intent === "public" ? "pending_moderation" : "private_complete", routeDetail);
          requestController = null;
        });
      });
    } catch (error) {
      if (token !== generation) return;
      requestController = null;
      setState("failed", { error: error && error.message });
      console.error("Configured Contact request failed.", error);
    }
  }

  function updateLocalTime() {
    if (!elements.localTime || document.hidden) return;
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-NZ", {
      timeZone: "Pacific/Auckland",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short"
    });
    setText(elements.localTime, formatter.format(now).toUpperCase());
  }

  function startClock() {
    window.clearInterval(clock);
    updateLocalTime();
    clock = window.setInterval(updateLocalTime, 30000);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (state === "submitting" || state === "launching") return;
    submit();
  });
  form.addEventListener("invalid", function () {
    if (state === "idle") {
      setState("idle", { reason: "Preflight needs the highlighted required fields." });
      syncTelemetry();
    }
  }, true);
  form.addEventListener("input", function (event) {
    if (event.target.matches('input[name="intent"]')) return;
    const shouldAnnounce = state !== "idle";
    invalidate("Payload edited; the previous route snapshot was cleared.", shouldAnnounce);
    syncTelemetry();
  });
  form.addEventListener("change", function (event) {
    if (event.target.matches('input[name="intent"]')) return;
    const shouldAnnounce = state !== "idle";
    invalidate("Payload choice changed; the previous route snapshot was cleared.", shouldAnnounce);
    syncTelemetry();
  });
  intentInputs.forEach(function (input) {
    input.addEventListener("change", function () {
      if (input.checked) applyIntent(input.value, "push", true);
    });
  });
  elements.retry.addEventListener("click", function () {
    if (state === "failed") submit();
  });
  elements.skip.addEventListener("click", function () {
    if (state !== "launching") return;
    const token = generation;
    clearTimers();
    const payload = currentPayload();
    const receiptId = elements.receiptId.textContent.replace(/^OPAQUE RECEIPT · /, "");
    if (token === generation) {
      setState(payload.intent === "public" ? "pending_moderation" : "private_complete", {
        intent: payload.intent,
        receiptId
      });
    }
  });
  window.addEventListener("popstate", function () {
    const restored = new URL(window.location.href).searchParams.get("intent") === "public" ? "public" : "private";
    applyIntent(restored, null, true);
  });
  document.addEventListener("visibilitychange", function () {
    updateLocalTime();
    root.classList.toggle("is-motion-paused", document.hidden || !trajectoryVisible);
  });
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(function (entries) {
      trajectoryVisible = !entries.length || entries[0].isIntersecting;
      root.classList.toggle("is-motion-paused", document.hidden || !trajectoryVisible);
    }, { threshold: 0.01 });
    observer.observe(elements.trajectory);
  }
  const initialIntent = queryAtLoad.searchParams.get("intent") === "public" ? "public" : "private";
  if (publicIntentLabel) publicIntentLabel.hidden = false;
  intentInputs.forEach(function (input) { input.disabled = false; });
  configureRuntime();
  applyIntent(initialIntent, null, false);
  startClock();
  window.addEventListener("pagehide", function () {
    clearTimers();
    window.clearInterval(clock);
    clock = 0;
    if (requestController) requestController.abort();
  });
  window.addEventListener("pageshow", function (event) {
    startClock();
    root.classList.toggle("is-motion-paused", document.hidden || !trajectoryVisible);
    if (!event.persisted) return;
    if (["validating", "submitting", "confirmed", "launching"].includes(state)) {
      generation += 1;
      clearTimers();
      if (requestController) requestController.abort(new Error("CONTACT_BFCACHE_RESTORE"));
      requestController = null;
      setState("idle", { reason: "Page restored; the in-progress route was cancelled safely. Review the preserved content before submitting again." });
    }
    syncTelemetry();
  });
})();
