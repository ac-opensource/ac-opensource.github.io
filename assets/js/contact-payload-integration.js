(function () {
  "use strict";

  document.documentElement.classList.remove("no-js");
  document.documentElement.classList.add("js");

  const form = document.getElementById("contact-form");
  const adapter = window.ContactTransport;
  if (!form || !adapter) return;

  const fallbackRuntime = Object.freeze({
    version: 1,
    enabled: false,
    transport: "disabled",
    endpoint: "",
    publicFeedEndpoint: "",
    requestTimeoutMs: 12000
  });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const localDemo = new URL(window.location.href).searchParams.get("localDemo") === "1";
  const elements = {
    name: document.getElementById("contact-name"),
    email: document.getElementById("contact-email"),
    message: document.getElementById("contact-message"),
    quote: document.getElementById("contact-public-quote"),
    target: document.getElementById("contact-public-target"),
    publicConsent: document.getElementById("contact-public-consent"),
    storageConsent: document.getElementById("contact-storage-consent"),
    publicFields: form.querySelector("[data-public-fields]"),
    messageCount: form.querySelector("[data-private-count]"),
    quoteCount: form.querySelector("[data-public-count]"),
    topologyLabel: form.querySelector("[data-topology-label]"),
    progress: form.querySelector("[data-progress-label]"),
    payloadState: form.querySelector('[data-module-state="payload"]'),
    identityMark: form.querySelector(".satellite__identity"),
    status: document.getElementById("contact-form-status"),
    submit: form.querySelector("[data-contact-submit]"),
    submitLabel: form.querySelector("[data-submit-label]"),
    retry: form.querySelector("[data-contact-retry]"),
    skip: form.querySelector("[data-skip-launch]"),
    receipt: form.querySelector("[data-receipt]"),
    receiptKicker: form.querySelector("[data-receipt-kicker]"),
    receiptHeading: form.querySelector("[data-receipt-heading]"),
    receiptBody: form.querySelector("[data-receipt-body]"),
    receiptId: form.querySelector("[data-receipt-id]"),
    runtimeMessage: form.querySelector("[data-runtime-message]"),
    visual: form.querySelector("[data-payload-visual]"),
    submissionId: form.querySelector("[data-submission-id]"),
    contextPath: form.querySelector("[data-context-path]"),
    returnOrigin: form.querySelector("[data-return-origin]"),
    startedAt: form.querySelector("[data-started-at]")
  };
  if (Object.values(elements).some(function (value) { return !value; })) return;

  const moduleNodes = Array.from(form.querySelectorAll("[data-module]"));
  const intentInputs = Array.from(form.querySelectorAll('input[name="intent"]'));
  const displayInputs = Array.from(form.querySelectorAll('input[name="publicDisplay"]'));
  const submissionControls = Array.from(form.querySelectorAll('input:not([type="hidden"]), textarea, select'));
  const animationTimers = new Set();
  let runtime = fallbackRuntime;
  let transport = null;
  let requestController = null;
  let submitting = false;
  let terminalState = false;
  let generation = 0;
  let submissionLockState = null;

  function parseRuntime() {
    try {
      const node = document.getElementById("contact-runtime-config");
      if (!node) throw new Error("Missing Contact runtime config.");
      return adapter.validateRuntimeConfig(JSON.parse(node.textContent), window.location);
    } catch (error) {
      console.error("Contact runtime config rejected; record submission remains disabled.", error);
      return adapter.validateRuntimeConfig(fallbackRuntime, window.location);
    }
  }

  function intent() {
    const selected = intentInputs.find(function (input) { return input.checked; });
    return selected && selected.value === "public" ? "public" : "private";
  }

  function displayMode() {
    const selected = displayInputs.find(function (input) { return input.checked; });
    return selected && selected.value === "named" ? "named" : "anonymous";
  }

  function after(delay, callback) {
    const timer = window.setTimeout(function () {
      animationTimers.delete(timer);
      callback();
    }, delay);
    animationTimers.add(timer);
  }

  function clearAnimationTimers() {
    animationTimers.forEach(function (timer) { window.clearTimeout(timer); });
    animationTimers.clear();
  }

  function reframeVisual() {
    elements.visual.scrollIntoView({
      behavior: reducedMotion.matches ? "auto" : "smooth",
      block: "center",
      inline: "nearest"
    });
  }

  function setLaunchVisualPhase(phase) {
    const preparing = phase === "preparing";
    const recording = phase === "recording";
    form.classList.toggle("is-preparing", preparing);
    form.classList.toggle("is-recording", recording);
    form.dataset.visualPhase = preparing || recording ? phase : "idle";
    if (preparing) {
      elements.topologyLabel.textContent = "PREPARING BAY";
      elements.progress.textContent = "LOCKING MODULES";
      elements.status.textContent = "Preparing payload bay · locking the integrated modules.";
    } else if (recording) {
      elements.topologyLabel.textContent = "RECORDING PAYLOAD";
      elements.progress.textContent = "AWAITING RECEIPT";
      elements.status.textContent = "Recording payload · awaiting persistent storage acknowledgement.";
    }
  }

  function waitForVisualPhase(delay) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, delay);
    });
  }

  async function runLaunchVisualTimeline(currentGeneration) {
    setLaunchVisualPhase("preparing");
    reframeVisual();
    await waitForVisualPhase(reducedMotion.matches ? 0 : 480);
    if (currentGeneration !== generation || !submitting || terminalState) return;
    setLaunchVisualPhase("recording");
    await waitForVisualPhase(reducedMotion.matches ? 0 : 360);
  }

  function exactLoopback(urlValue) {
    try {
      const endpoint = new URL(urlValue, window.location.origin);
      return endpoint.protocol === "http:" &&
        endpoint.hostname === "127.0.0.1" &&
        window.location.hostname === "127.0.0.1" &&
        endpoint.origin === window.location.origin;
    } catch (_error) {
      return false;
    }
  }

  function allowedAcknowledgementOrigin(origin, endpoint) {
    if (exactLoopback(endpoint)) return origin === window.location.origin;
    return adapter.allowedAppsScriptAcknowledgementOrigin(origin);
  }

  function iframeBridge(payload, options) {
    return new Promise(function (resolve, reject) {
      const frame = document.createElement("iframe");
      const bridgeForm = document.createElement("form");
      const frameName = "contact-record-ack-" + payload.submissionId;
      let settled = false;
      let timeout = 0;
      frame.name = frameName;
      frame.title = "Contact record acknowledgement";
      frame.hidden = true;
      frame.setAttribute("aria-hidden", "true");
      document.body.append(frame);

      bridgeForm.hidden = true;
      bridgeForm.setAttribute("aria-hidden", "true");
      bridgeForm.action = options.endpoint;
      bridgeForm.method = "post";
      bridgeForm.target = frameName;
      bridgeForm.acceptCharset = "UTF-8";

      const appendField = function (name, value) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = String(value == null ? "" : value);
        bridgeForm.append(input);
      };
      appendField("version", payload.version);
      appendField("submissionId", payload.submissionId);
      appendField("returnOrigin", window.location.origin);
      appendField("startedAt", elements.startedAt.value);
      appendField("website", "");
      appendField("intent", payload.intent);
      appendField("name", payload.name);
      appendField("email", payload.email);
      appendField("privateMessage", payload.privateMessage);
      appendField("contextPath", payload.contextPath);
      appendField("storageConsent", "yes");
      if (payload.public) {
        appendField("publicQuote", payload.public.quote);
        appendField("publicTarget", payload.public.target);
        appendField("publicDisplay", payload.public.display.mode);
        appendField("publicConsent", "yes");
      }
      document.body.append(bridgeForm);

      const cleanup = function () {
        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        if (options.signal) options.signal.removeEventListener("abort", onAbort);
        after(40, function () {
          bridgeForm.remove();
          frame.remove();
        });
      };
      const fail = function (error) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = function () {
        fail(options.signal && options.signal.reason instanceof Error
          ? options.signal.reason
          : new Error("Contact record request was cancelled."));
      };
      const onMessage = function (event) {
        // Apps Script nests the authored HTML inside its own script.google.com wrapper,
        // so the acknowledgement source is the inner googleusercontent frame rather
        // than this outer target frame. Authenticate the message by its exact Google
        // origin, channel, and high-entropy request ID instead.
        if (!allowedAcknowledgementOrigin(event.origin, options.endpoint)) return;
        const message = event.data;
        if (!message || message.channel !== "ac-contact-v2" || message.requestId !== payload.submissionId) return;
        if (message.ok !== true) {
          fail(new Error("The record service did not confirm storage."));
          return;
        }
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          version: message.version,
          receiptId: message.receiptId,
          intent: message.intent,
          state: message.state
        });
      };

      window.addEventListener("message", onMessage);
      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
      timeout = window.setTimeout(function () {
        fail(new Error("The record service did not acknowledge storage before timeout."));
      }, options.timeoutMs);

      window.HTMLFormElement.prototype.submit.call(bridgeForm);
    });
  }

  function setSubmissionLock(locked) {
    if (locked) {
      if (submissionLockState) return;
      submissionLockState = submissionControls.map(function (control) {
        return {
          control: control,
          disabled: control.disabled,
          ariaDisabled: control.getAttribute("aria-disabled")
        };
      });
      submissionLockState.forEach(function (entry) {
        entry.control.disabled = true;
        entry.control.setAttribute("aria-disabled", "true");
      });
      form.setAttribute("aria-busy", "true");
      return;
    }
    if (!submissionLockState) return;
    submissionLockState.forEach(function (entry) {
      entry.control.disabled = entry.disabled;
      if (entry.ariaDisabled === null) entry.control.removeAttribute("aria-disabled");
      else entry.control.setAttribute("aria-disabled", entry.ariaDisabled);
    });
    submissionLockState = null;
    form.removeAttribute("aria-busy");
    togglePublic();
  }

  function makeSubmissionId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return "contact_" + window.crypto.randomUUID().replace(/-/g, "");
    }
    const bytes = new Uint8Array(18);
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      window.crypto.getRandomValues(bytes);
      return "contact_" + Array.from(bytes, function (value) { return value.toString(16).padStart(2, "0"); }).join("");
    }
    return "contact_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 14);
  }

  function ensureSubmissionId() {
    if (!elements.submissionId.value) elements.submissionId.value = makeSubmissionId();
    return elements.submissionId.value;
  }

  function togglePublic() {
    const isPublic = intent() === "public";
    form.dataset.topology = isPublic ? "public" : "private";
    elements.topologyLabel.textContent = isPublic ? "FEEDBACK SATELLITE" : "PRIVATE CAPSULE";
    elements.publicFields.hidden = !isPublic;
    elements.message.required = !isPublic;
    elements.payloadState.textContent = isPublic ? "BEACON PACKAGE LOADED" : "MISSION CORE LOADED";
    elements.quote.disabled = !isPublic;
    elements.quote.required = isPublic;
    elements.target.disabled = !isPublic;
    elements.publicConsent.disabled = !isPublic;
    elements.publicConsent.required = isPublic;
    displayInputs.forEach(function (input) { input.disabled = !isPublic; });
  }

  function valid(moduleName) {
    if (moduleName === "mission") return Boolean(intent());
    if (moduleName === "identity") {
      const value = elements.name.value.trim();
      return value.length >= 2 && value.length <= 80;
    }
    if (moduleName === "comms") return Boolean(elements.email.value.trim()) && elements.email.validity.valid;
    if (moduleName === "payload") {
      const privateMessage = elements.message.value.trim();
      if (privateMessage.length > 4000) return false;
      if (intent() !== "public") return privateMessage.length >= 1;
      const quote = elements.quote.value.trim();
      return quote.length >= 1 && quote.length <= 280 && elements.publicConsent.checked;
    }
    if (moduleName === "release") return elements.storageConsent.checked;
    return false;
  }

  function setPart(moduleName, loaded) {
    const node = form.querySelector('[data-module="' + moduleName + '"]');
    if (node) node.classList.toggle("is-loaded", loaded);
    const state = form.querySelector('[data-module-state="' + moduleName + '"]');
    if (state) state.setAttribute("aria-hidden", String(!loaded));
    Array.from(form.querySelectorAll('[data-payload-part="' + moduleName + '"]')).forEach(function (part) {
      part.classList.toggle("is-loaded", loaded);
    });
  }

  function online() {
    return Boolean(runtime.enabled && transport && transport.kind !== "unavailable");
  }

  function update(options) {
    togglePublic();
    const states = moduleNodes.map(function (node) {
      const loaded = valid(node.dataset.module);
      setPart(node.dataset.module, loaded);
      return loaded;
    });
    const count = states.filter(Boolean).length;
    const ready = count === states.length;
    form.classList.toggle("is-ready", ready);
    form.style.setProperty("--payload-progress", (count / states.length * 100) + "%");
    elements.progress.textContent = count + " / " + states.length + " MODULES";
    elements.messageCount.textContent = elements.message.value.length + " / 4000";
    elements.quoteCount.textContent = elements.quote.value.length + " / 280";
    elements.identityMark.textContent = elements.name.value.trim()
      ? elements.name.value.trim().toUpperCase()
      : "ID";
    elements.submit.disabled = !online() || !ready || submitting || terminalState;
    elements.submitLabel.textContent = !online()
      ? "Record service offline"
      : submitting
        ? "Recording payload…"
        : ready
          ? (intent() === "public" ? "Launch review record" : "Launch private record")
          : "Integrate payload";
    if (options && options.announce && !submitting && !terminalState) {
      elements.status.textContent = !online()
        ? "Payload stays local · the personal record service is not connected in this build."
        : ready
          ? "Payload integrated · ready to request a stored record."
          : "Fairing open · " + (states.length - count) + " module" + (states.length - count === 1 ? "" : "s") + " incomplete · nothing recorded.";
    }
  }

  function payload() {
    const currentIntent = intent();
    const value = {
      version: 2,
      submissionId: ensureSubmissionId(),
      intent: currentIntent,
      name: elements.name.value.trim(),
      email: elements.email.value.trim(),
      privateMessage: elements.message.value.trim(),
      contextPath: window.location.pathname + (currentIntent === "public" ? "?intent=public" : "")
    };
    if (currentIntent === "public") {
      const mode = displayMode();
      value.public = {
        quote: elements.quote.value.trim(),
        target: elements.target.value,
        display: { mode: mode, label: mode === "named" ? value.name : "Anonymous" },
        consent: elements.publicConsent.checked
      };
    }
    return value;
  }

  function showReceipt(result) {
    elements.receipt.hidden = false;
    elements.receiptId.hidden = false;
    elements.receiptId.textContent = "OPAQUE RECEIPT · " + result.receiptId;
    if (result.state === adapter.STATES.PENDING_MODERATION) {
      elements.receiptKicker.textContent = "[stored review request]";
      elements.receiptHeading.textContent = "Review request stored — not public.";
      elements.receiptBody.textContent = "The private record exists, but the separate quote still requires human approval before it can appear anywhere.";
    } else {
      elements.receiptKicker.textContent = "[stored private record]";
      elements.receiptHeading.textContent = "Private contact record stored.";
      elements.receiptBody.textContent = "The record service acknowledged persistence. This does not claim an email notification or reply has already happened.";
    }
  }

  function finishDeployment() {
    clearAnimationTimers();
    setLaunchVisualPhase("idle");
    form.classList.remove("is-sealing", "is-deploying");
    form.classList.add("is-deployed");
    elements.skip.hidden = true;
    elements.status.textContent = intent() === "public"
      ? "Record complete · public quote remains pending human review."
      : "Record complete · private payload is ready for Andrew's review.";
  }

  function deploy(result) {
    terminalState = true;
    setLaunchVisualPhase("idle");
    showReceipt(result);
    elements.status.textContent = "Storage confirmed · preparing the deployment bay.";
    elements.skip.hidden = reducedMotion.matches;
    after(reducedMotion.matches ? 0 : 120, function () {
      form.classList.add("is-sealing");
      after(reducedMotion.matches ? 0 : 700, function () {
        form.classList.remove("is-sealing");
        form.classList.add("is-deploying");
        elements.status.textContent = "Record confirmed · deployment animation is visual only.";
      });
      after(reducedMotion.matches ? 10 : 2980, finishDeployment);
    });
    update();
  }

  function setTransportState(next) {
    if (next === adapter.STATES.VALIDATING) {
      form.dataset.recordState = next;
      if (form.dataset.visualPhase !== "preparing") {
        elements.status.textContent = "Checking payload locally · no request completed yet.";
      }
    } else if (next === adapter.STATES.SUBMITTING) {
      form.dataset.recordState = next;
      if (form.dataset.visualPhase !== "preparing") {
        elements.status.textContent = "Recording payload · awaiting persistent storage acknowledgement.";
      }
    }
  }

  async function submitRecord() {
    const currentGeneration = ++generation;
    let value;
    try {
      value = payload();
      adapter.validatePayload(value);
    } catch (error) {
      elements.status.textContent = "Integration stopped locally · " + error.message + " Nothing was recorded.";
      return;
    }

    requestController = new AbortController();
    submitting = true;
    terminalState = false;
    elements.retry.hidden = true;
    elements.receipt.hidden = true;
    clearAnimationTimers();
    form.classList.remove("is-sealing", "is-deploying", "is-deployed");
    update();
    const visualTimeline = runLaunchVisualTimeline(currentGeneration);
    setSubmissionLock(true);
    try {
      const pendingSubmission = transport.submit(value, {
        signal: requestController.signal,
        onState: setTransportState
      });
      const results = await Promise.all([pendingSubmission, visualTimeline]);
      const result = results[0];
      if (currentGeneration !== generation) return;
      submitting = false;
      setSubmissionLock(false);
      form.dataset.recordState = result.state;
      deploy(result);
    } catch (error) {
      if (currentGeneration !== generation) return;
      submitting = false;
      setSubmissionLock(false);
      setLaunchVisualPhase("idle");
      form.dataset.recordState = "failed";
      elements.runtimeMessage.dataset.runtimeState = "failed";
      elements.status.textContent = "Storage was not confirmed. Your payload is preserved for retry.";
      elements.receipt.hidden = false;
      elements.receiptKicker.textContent = "[record attempt failed]";
      elements.receiptHeading.textContent = "No stored record is being claimed.";
      elements.receiptBody.textContent = "The service did not return a valid persistence acknowledgement. Retry uses the same idempotency key unless you edit the payload.";
      elements.receiptId.hidden = true;
      elements.retry.hidden = false;
      console.error("Configured Contact record request failed.", error);
      update();
    } finally {
      setSubmissionLock(false);
      requestController = null;
    }
  }

  function resetResultForEdit() {
    if (submitting && requestController) requestController.abort(new Error("Contact payload changed."));
    generation += 1;
    submitting = false;
    terminalState = false;
    clearAnimationTimers();
    setLaunchVisualPhase("idle");
    form.classList.remove("is-sealing", "is-deploying", "is-deployed");
    form.dataset.recordState = "idle";
    elements.submissionId.value = "";
    elements.receipt.hidden = true;
    elements.receiptId.hidden = true;
    elements.retry.hidden = true;
    elements.skip.hidden = true;
    elements.runtimeMessage.dataset.runtimeState = online() ? "online" : "offline";
  }

  form.addEventListener("input", function () {
    resetResultForEdit();
    update({ announce: true });
  });

  form.addEventListener("change", function () {
    resetResultForEdit();
    update({ announce: true });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    update({ announce: true });
    if (!online()) {
      elements.status.textContent = "Nothing recorded · the personal record service still needs deployment from the correct Google account.";
      return;
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      elements.status.textContent = "Integration stopped locally · complete the highlighted module. Nothing was recorded.";
      return;
    }
    if (!submitting && !terminalState) submitRecord();
  });

  elements.retry.addEventListener("click", function () {
    if (submitting) return;
    terminalState = false;
    submitRecord();
  });

  elements.skip.addEventListener("click", finishDeployment);

  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    resetResultForEdit();
    elements.status.textContent = "Payload state restored · nothing newly recorded.";
    update();
  });

  runtime = parseRuntime();
  try {
    transport = adapter.create({
      config: runtime,
      location: window.location,
      destination: "aarconcepcion@gmail.com",
      navigate: function () { throw new Error("Production Contact never opens an email client."); },
      fetchImpl: window.fetch.bind(window),
      iframeBridge: iframeBridge
    });
  } catch (error) {
    runtime = adapter.validateRuntimeConfig(fallbackRuntime, window.location);
    transport = adapter.create({ config: runtime, location: window.location });
    console.error("Contact transport initialization failed; record submission remains disabled.", error);
  }

  elements.startedAt.value = String(Date.now());
  elements.contextPath.value = window.location.pathname;
  elements.returnOrigin.value = window.location.origin;
  if (online()) {
    elements.runtimeMessage.dataset.runtimeState = "online";
    elements.runtimeMessage.textContent = runtime.transport === "apps_script_iframe"
      ? "Private Sheet bridge online · completion follows row acknowledgement."
      : (localDemo ? "Local record store online · demo rows never publish." : "Configured record service online.");
  } else {
    elements.runtimeMessage.dataset.runtimeState = "offline";
    elements.runtimeMessage.textContent = "Record service awaiting personal Google deployment.";
  }
  togglePublic();
  update();
})();
