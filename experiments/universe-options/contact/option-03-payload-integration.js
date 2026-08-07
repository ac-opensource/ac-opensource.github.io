(function () {
  "use strict";

  const form = document.getElementById("payload-form");
  const adapter = window.ContactTransport;
  if (!form || !adapter) return;

  const localDemo = new URL(window.location.href).searchParams.get("localDemo") === "1";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const elements = {
    name: document.getElementById("payload-name"),
    email: document.getElementById("payload-email"),
    message: document.getElementById("payload-message"),
    quote: document.getElementById("payload-quote"),
    target: document.getElementById("payload-target"),
    publicConsent: document.getElementById("payload-public-consent"),
    acknowledgement: document.getElementById("payload-acknowledgement"),
    publicModule: form.querySelector("[data-public-module]"),
    messageCount: form.querySelector("[data-message-count]"),
    quoteCount: form.querySelector("[data-quote-count]"),
    topologyLabel: form.querySelector("[data-topology-label]"),
    progress: form.querySelector("[data-progress-label]"),
    payloadState: form.querySelector('[data-module-state="payload"]'),
    identityMark: form.querySelector(".satellite__identity"),
    status: document.getElementById("payload-status"),
    submit: form.querySelector("[data-submit]"),
    submitLabel: form.querySelector("[data-submit-label]"),
    demoFlag: form.querySelector("[data-demo-flag]"),
    demoLink: form.querySelector("[data-demo-link]"),
    visual: form.querySelector("[data-payload-visual]")
  };
  const moduleNodes = Array.from(form.querySelectorAll("[data-module]"));
  const intentInputs = Array.from(form.querySelectorAll('input[name="intent"]'));
  const displayInputs = Array.from(form.querySelectorAll('input[name="publicDisplay"]'));
  const demoTimers = new Set();

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
      demoTimers.delete(timer);
      callback();
    }, delay);
    demoTimers.add(timer);
  }

  function clearDemoTimers() {
    demoTimers.forEach(function (timer) { window.clearTimeout(timer); });
    demoTimers.clear();
  }

  function setVisualPhase(phase) {
    const preparing = phase === "preparing";
    const recording = phase === "recording";
    form.classList.toggle("is-preparing", preparing);
    form.classList.toggle("is-recording", recording);
    form.dataset.visualPhase = preparing || recording ? phase : "idle";
    if (preparing) {
      elements.topologyLabel.textContent = "PREPARING BAY";
      elements.progress.textContent = "LOCKING MODULES";
      elements.status.textContent = "LOCAL DEMO PREPARING · the payload graphics are visual only; nothing was sent.";
    } else if (recording) {
      elements.topologyLabel.textContent = "RECORDING PAYLOAD";
      elements.progress.textContent = "LOCAL SIMULATION";
      elements.status.textContent = "LOCAL DEMO RECORDING · no network request, receipt, or public record exists.";
    }
  }

  function togglePublic() {
    const isPublic = intent() === "public";
    form.dataset.topology = isPublic ? "public" : "private";
    elements.topologyLabel.textContent = isPublic ? "FEEDBACK SATELLITE" : "PRIVATE CAPSULE";
    elements.publicModule.hidden = !isPublic;
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
    if (moduleName === "release") return elements.acknowledgement.checked;
    return false;
  }

  function setPart(moduleName, loaded) {
    const node = form.querySelector('[data-module="' + moduleName + '"]');
    if (node) node.classList.toggle("is-loaded", loaded);
    Array.from(form.querySelectorAll('[data-payload-part="' + moduleName + '"]')).forEach(function (part) {
      part.classList.toggle("is-loaded", loaded);
    });
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
    elements.submitLabel.textContent = ready
      ? (localDemo ? "Run local deployment" : "Handoff to email app")
      : "Integrate payload";
    if (options && options.announce) {
      elements.status.textContent = ready
        ? (localDemo
          ? "Payload integrated · explicit local deployment is ready; nothing will be sent."
          : "Payload integrated · normal mode will hand the draft to your email app.")
        : "Fairing open · " + (states.length - count) + " module" + (states.length - count === 1 ? "" : "s") + " incomplete · nothing sent.";
    }
  }

  function contactPayload() {
    const currentIntent = intent();
    const result = {
      version: 1,
      intent: currentIntent,
      name: elements.name.value.trim(),
      email: elements.email.value.trim(),
      privateMessage: elements.message.value.trim(),
      contextPath: window.location.pathname + (currentIntent === "public" ? "?intent=public" : "")
    };
    if (currentIntent === "public") {
      const mode = displayMode();
      result.public = {
        quote: elements.quote.value.trim(),
        target: elements.target.value,
        display: { mode: mode, label: mode === "named" ? result.name : "Anonymous" },
        consent: elements.publicConsent.checked
      };
    }
    return result;
  }

  function handoffToEmail(payload) {
    const link = document.createElement("a");
    link.href = adapter.buildMailto(payload, "aarconcepcion@gmail.com");
    link.hidden = true;
    link.tabIndex = -1;
    document.body.append(link);
    link.click();
    link.remove();
    form.dataset.transportState = "handoff";
    elements.status.textContent = "HANDOFF TO EMAIL APP · no website receipt; sending and delivery remain unknown.";
  }

  function runLocalDemo() {
    clearDemoTimers();
    setVisualPhase("idle");
    form.classList.remove("is-sealing", "is-deploying", "is-deployed");
    void form.getBoundingClientRect();
    form.dataset.transportState = "local-demo";
    elements.submit.disabled = true;
    const reframeVisual = Boolean(elements.visual);
    setVisualPhase("preparing");
    if (reframeVisual) {
      elements.visual.scrollIntoView({
        behavior: reducedMotion.matches ? "auto" : "smooth",
        block: "center",
        inline: "nearest"
      });
    }
    after(reducedMotion.matches ? 10 : 480, function () {
      setVisualPhase("recording");
    });
    after(reducedMotion.matches ? 20 : 960, function () {
      setVisualPhase("idle");
      update();
      form.classList.add("is-sealing");
      const sealDelay = reducedMotion.matches ? 10 : 760;
      after(sealDelay, function () {
        form.classList.remove("is-sealing");
        form.classList.add("is-deploying");
        elements.status.textContent = "LOCAL DEMO DEPLOYMENT · no network request, receipt, moderation event, or publication.";
      });
      after(reducedMotion.matches ? 25 : 3075, function () {
        form.classList.add("is-deployed");
        elements.submit.disabled = false;
        elements.status.textContent = "LOCAL DEMO COMPLETE · no delivery, receipt, or public record exists.";
      });
    });
  }

  function resetDemo() {
    if (!form.classList.contains("is-preparing") && !form.classList.contains("is-recording") && !form.classList.contains("is-sealing") && !form.classList.contains("is-deploying") && !form.classList.contains("is-deployed")) return;
    clearDemoTimers();
    setVisualPhase("idle");
    form.classList.remove("is-sealing", "is-deploying", "is-deployed");
    elements.submit.disabled = false;
  }

  form.addEventListener("input", function () {
    resetDemo();
    update({ announce: true });
  });

  form.addEventListener("change", function () {
    resetDemo();
    update({ announce: true });
  });

  elements.submit.addEventListener("click", function () {
    update({ announce: true });
    if (!form.checkValidity()) {
      elements.status.textContent = "Integration stopped locally · complete the highlighted module. Nothing was sent.";
    }
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    update({ announce: true });
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    let payload;
    try {
      payload = contactPayload();
      adapter.validatePayload(payload);
    } catch (error) {
      elements.status.textContent = "Integration stopped locally · " + error.message + " Nothing was sent.";
      return;
    }
    if (localDemo) runLocalDemo();
    else handoffToEmail(payload);
  });

  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    resetDemo();
    elements.status.textContent = "Fairing open · payload state restored · nothing sent.";
    update();
  });

  if (localDemo) {
    elements.demoFlag.hidden = false;
    if (elements.demoLink) elements.demoLink.hidden = true;
  }
  togglePublic();
  update();
})();
