(function () {
  "use strict";

  const form = document.getElementById("assembly-form");
  const adapter = window.ContactTransport;
  if (!form || !adapter) return;

  const query = new URL(window.location.href).searchParams;
  const localDemo = query.get("localDemo") === "1";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const elements = {
    name: document.getElementById("assembly-name"),
    email: document.getElementById("assembly-email"),
    message: document.getElementById("assembly-message"),
    quote: document.getElementById("assembly-quote"),
    target: document.getElementById("assembly-target"),
    publicConsent: document.getElementById("assembly-public-consent"),
    acknowledgement: document.getElementById("assembly-acknowledgement"),
    publicModule: form.querySelector("[data-public-module]"),
    messageCount: form.querySelector("[data-message-count]"),
    quoteCount: form.querySelector("[data-quote-count]"),
    progress: form.querySelector("[data-progress-label]"),
    status: document.getElementById("assembly-status"),
    submit: form.querySelector("[data-submit]"),
    submitLabel: form.querySelector("[data-submit-label]"),
    demoFlag: form.querySelector("[data-demo-flag]"),
    demoLink: form.querySelector("[data-demo-link]"),
    vehicle: form.querySelector("[data-vehicle]")
  };
  const systemNodes = Array.from(form.querySelectorAll("[data-system]"));
  const displayInputs = Array.from(form.querySelectorAll('input[name="publicDisplay"]'));
  const intentInputs = Array.from(form.querySelectorAll('input[name="intent"]'));
  let launchTimer = 0;

  function intent() {
    const selected = intentInputs.find(function (input) { return input.checked; });
    return selected && selected.value === "public" ? "public" : "private";
  }

  function displayMode() {
    const selected = displayInputs.find(function (input) { return input.checked; });
    return selected && selected.value === "named" ? "named" : "anonymous";
  }

  function publicPayloadIsValid() {
    if (intent() !== "public") return true;
    const quote = elements.quote.value.trim();
    return quote.length >= 20 && quote.length <= 280 && elements.publicConsent.checked;
  }

  function systemValidity(system) {
    if (system === "mission") return Boolean(intent());
    if (system === "guidance") {
      const value = elements.name.value.trim();
      return value.length >= 2 && value.length <= 80;
    }
    if (system === "comms") return elements.email.validity.valid && Boolean(elements.email.value.trim());
    if (system === "payload") {
      const value = elements.message.value.trim();
      return value.length >= 20 && value.length <= 4000 && publicPayloadIsValid();
    }
    if (system === "release") return elements.acknowledgement.checked;
    return false;
  }

  function togglePublicControls() {
    const isPublic = intent() === "public";
    form.dataset.public = String(isPublic);
    elements.publicModule.hidden = !isPublic;
    elements.quote.disabled = !isPublic;
    elements.quote.required = isPublic;
    elements.target.disabled = !isPublic;
    elements.publicConsent.disabled = !isPublic;
    elements.publicConsent.required = isPublic;
    displayInputs.forEach(function (input) { input.disabled = !isPublic; });
  }

  function setComponent(system, installed) {
    const node = form.querySelector('[data-system="' + system + '"]');
    const part = form.querySelector('[data-rocket-part="' + system + '"]');
    const callout = form.querySelector('[data-rocket-callout="' + system + '"]');
    if (node) node.classList.toggle("is-installed", installed);
    [part, callout].filter(Boolean).forEach(function (target) {
      const becameInstalled = installed && !target.classList.contains("is-installed");
      target.classList.toggle("is-installed", installed);
      if (!becameInstalled) return;
      target.classList.remove("is-installing");
      void target.getBoundingClientRect();
      target.classList.add("is-installing");
    });
  }

  function updateAssembly(options) {
    togglePublicControls();
    const validity = systemNodes.map(function (node) {
      const system = node.dataset.system;
      const installed = systemValidity(system);
      setComponent(system, installed);
      return installed;
    });
    const count = validity.filter(Boolean).length;
    const ready = count === validity.length;
    form.style.setProperty("--assembly-progress", (count / validity.length * 100) + "%");
    form.classList.toggle("is-ready", ready);
    elements.vehicle.dataset.installedSystems = String(count);
    elements.vehicle.dataset.integrationState = ready ? "flight-ready" : "assembly";
    elements.progress.textContent = count + " / " + validity.length + " SYSTEMS";
    elements.messageCount.textContent = elements.message.value.length + " / 4000";
    elements.quoteCount.textContent = elements.quote.value.length + " / 280";
    elements.submitLabel.textContent = ready
      ? (localDemo ? "Launch local demo" : "Handoff to email app")
      : "Complete assembly";
    elements.submit.setAttribute("aria-label", elements.submitLabel.textContent);

    if (options && options.announce) {
      if (ready) {
        elements.status.textContent = localDemo
          ? "Vehicle ready for an explicit local-only launch. No message will be sent."
          : "Vehicle ready · submitting will hand a draft to your email app.";
      } else {
        elements.status.textContent = "Assembly in progress · " + (validity.length - count) + " system" + (validity.length - count === 1 ? "" : "s") + " incomplete.";
      }
    }
  }

  function payload() {
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
        display: {
          mode: mode,
          label: mode === "named" ? result.name : "Anonymous"
        },
        consent: elements.publicConsent.checked
      };
    }
    return result;
  }

  function openEmailApp(contactPayload) {
    const uri = adapter.buildMailto(contactPayload, "aarconcepcion@gmail.com");
    const link = document.createElement("a");
    link.href = uri;
    link.hidden = true;
    link.tabIndex = -1;
    document.body.append(link);
    link.click();
    link.remove();
    elements.status.textContent = "HANDOFF TO EMAIL APP · delivery remains unknown. No website receipt was created.";
    form.dataset.transportState = "handoff";
  }

  function runLocalDemo() {
    window.clearTimeout(launchTimer);
    form.classList.remove("is-launching");
    void form.getBoundingClientRect();
    form.classList.add("is-launching");
    elements.vehicle.dataset.integrationState = "ignition-sequence";
    form.dataset.transportState = "local-demo";
    elements.submit.disabled = true;
    elements.status.textContent = "LOCAL DEMO CONFIRMED · no request or email was sent. Launch is a visual simulation.";
    launchTimer = window.setTimeout(function () {
      form.classList.add("is-launched");
      elements.vehicle.dataset.integrationState = "local-demo-complete";
      elements.status.textContent = "LOCAL DEMO COMPLETE · no message, receipt, delivery, or public record exists.";
      elements.submit.disabled = false;
    }, reducedMotion.matches ? 20 : 2450);
  }

  function resetDemoVisual() {
    if (!form.classList.contains("is-launching") && !form.classList.contains("is-launched")) return;
    window.clearTimeout(launchTimer);
    form.classList.remove("is-launching", "is-launched");
    elements.vehicle.dataset.integrationState = "assembly";
    elements.submit.disabled = false;
  }

  intentInputs.forEach(function (input) {
    input.addEventListener("change", function () {
      resetDemoVisual();
      updateAssembly({ announce: true });
    });
  });

  form.addEventListener("input", function () {
    resetDemoVisual();
    updateAssembly({ announce: true });
  });

  form.addEventListener("change", function () {
    resetDemoVisual();
    updateAssembly({ announce: true });
  });

  elements.submit.addEventListener("click", function () {
    updateAssembly({ announce: true });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    updateAssembly({ announce: true });
    if (!form.checkValidity()) {
      form.reportValidity();
      elements.status.textContent = "Preflight stopped locally · complete the highlighted system. Nothing was sent.";
      return;
    }
    let contactPayload;
    try {
      contactPayload = payload();
      adapter.validatePayload(contactPayload);
    } catch (error) {
      elements.status.textContent = "Preflight stopped locally · " + error.message + " Nothing was sent.";
      return;
    }
    if (localDemo) runLocalDemo();
    else openEmailApp(contactPayload);
  });

  window.addEventListener("pageshow", function (event) {
    if (event.persisted) {
      resetDemoVisual();
      elements.status.textContent = "Vehicle grounded · nothing has left this page.";
      updateAssembly();
    }
  });

  if (localDemo) {
    elements.demoFlag.hidden = false;
    elements.demoLink.hidden = true;
  }
  togglePublicControls();
  updateAssembly();
})();
