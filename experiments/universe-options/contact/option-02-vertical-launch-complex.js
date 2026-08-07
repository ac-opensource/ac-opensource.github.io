(function () {
  "use strict";

  const form = document.getElementById("tower-form");
  const adapter = window.ContactTransport;
  if (!form || !adapter) return;

  const localDemo = new URL(window.location.href).searchParams.get("localDemo") === "1";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const elements = {
    name: document.getElementById("tower-name"),
    email: document.getElementById("tower-email"),
    message: document.getElementById("tower-message"),
    quote: document.getElementById("tower-quote"),
    target: document.getElementById("tower-target"),
    publicConsent: document.getElementById("tower-public-consent"),
    acknowledgement: document.getElementById("tower-acknowledgement"),
    publicModule: form.querySelector("[data-public-module]"),
    publicConsentRow: form.querySelector("[data-public-consent-row]"),
    messageCount: form.querySelector("[data-message-count]"),
    quoteCount: form.querySelector("[data-quote-count]"),
    status: document.getElementById("tower-status"),
    submit: form.querySelector("[data-submit]"),
    submitLabel: form.querySelector("[data-submit-label]"),
    demoFlag: form.querySelector("[data-demo-flag]"),
    demoLink: form.querySelector("[data-demo-link]")
  };
  const intentInputs = Array.from(form.querySelectorAll('input[name="intent"]'));
  const displayInputs = Array.from(form.querySelectorAll('input[name="publicDisplay"]'));
  const stations = Array.from(form.querySelectorAll("[data-station]"));
  let launchTimer = 0;

  function intent() {
    const selected = intentInputs.find(function (input) { return input.checked; });
    return selected && selected.value === "public" ? "public" : "private";
  }

  function displayMode() {
    const selected = displayInputs.find(function (input) { return input.checked; });
    return selected && selected.value === "named" ? "named" : "anonymous";
  }

  function togglePublic() {
    const isPublic = intent() === "public";
    form.dataset.public = String(isPublic);
    elements.publicModule.hidden = !isPublic;
    elements.publicConsentRow.hidden = !isPublic;
    elements.quote.disabled = !isPublic;
    elements.quote.required = isPublic;
    elements.target.disabled = !isPublic;
    elements.publicConsent.disabled = !isPublic;
    elements.publicConsent.required = isPublic;
    displayInputs.forEach(function (input) { input.disabled = !isPublic; });
  }

  function valid(system) {
    if (system === "mission") return Boolean(intent());
    if (system === "guidance") {
      const value = elements.name.value.trim();
      return value.length >= 2 && value.length <= 80;
    }
    if (system === "comms") return Boolean(elements.email.value.trim()) && elements.email.validity.valid;
    if (system === "payload") {
      const privateMessage = elements.message.value.trim();
      if (privateMessage.length < 20 || privateMessage.length > 4000) return false;
      if (intent() !== "public") return true;
      const quote = elements.quote.value.trim();
      return quote.length >= 20 && quote.length <= 280;
    }
    if (system === "release") {
      return elements.acknowledgement.checked && (intent() !== "public" || elements.publicConsent.checked);
    }
    return false;
  }

  function setClamp(system, released) {
    const station = form.querySelector('[data-station="' + system + '"]');
    const clamp = form.querySelector('[data-clamp="' + system + '"]');
    if (station) station.classList.toggle("is-cleared", released);
    if (clamp) clamp.classList.toggle("is-released", released);
  }

  function update(options) {
    togglePublic();
    const states = stations.map(function (station) {
      const cleared = valid(station.dataset.station);
      setClamp(station.dataset.station, cleared);
      return cleared;
    });
    const cleared = states.filter(Boolean).length;
    const ready = cleared === states.length;
    form.classList.toggle("is-ready", ready);
    elements.messageCount.textContent = elements.message.value.length + " / 4000";
    elements.quoteCount.textContent = elements.quote.value.length + " / 280";
    elements.submitLabel.textContent = ready
      ? (localDemo ? "Run local launch" : "Handoff to email app")
      : "Complete preflight";
    if (options && options.announce) {
      elements.status.textContent = ready
        ? (localDemo
          ? "All clamps clear · the explicit local demo can launch without sending anything."
          : "All clamps clear · normal mode will hand the draft to your email app.")
        : (states.length - cleared) + " clamp" + (states.length - cleared === 1 ? "" : "s") + " still hold · nothing has left this page.";
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
    elements.status.textContent = "HANDOFF TO EMAIL APP · sending and delivery remain unknown. No website receipt exists.";
  }

  function runLocalDemo() {
    window.clearTimeout(launchTimer);
    form.classList.remove("is-launching", "is-launched");
    void form.getBoundingClientRect();
    form.classList.add("is-launching");
    form.dataset.transportState = "local-demo";
    elements.submit.disabled = true;
    elements.status.textContent = "LOCAL DEMO CONFIRMED · launch is visual only; no message or request was sent.";
    launchTimer = window.setTimeout(function () {
      form.classList.add("is-launched");
      elements.submit.disabled = false;
      elements.status.textContent = "LOCAL DEMO COMPLETE · no delivery, receipt, or publication exists.";
    }, reducedMotion.matches ? 20 : 2850);
  }

  function resetLaunch() {
    if (!form.classList.contains("is-launching") && !form.classList.contains("is-launched")) return;
    window.clearTimeout(launchTimer);
    form.classList.remove("is-launching", "is-launched");
    elements.submit.disabled = false;
  }

  function observeStations() {
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        stations.forEach(function (station) { station.classList.toggle("is-active", station === entry.target); });
        Array.from(form.querySelectorAll("[data-clamp]")).forEach(function (clamp) {
          clamp.classList.toggle("is-active", clamp.dataset.clamp === entry.target.dataset.station);
        });
      });
    }, { rootMargin: "-38% 0px -38%", threshold: 0 });
    stations.forEach(function (station) { observer.observe(station); });
  }

  form.addEventListener("input", function () {
    resetLaunch();
    update({ announce: true });
  });

  form.addEventListener("change", function () {
    resetLaunch();
    update({ announce: true });
  });

  elements.submit.addEventListener("click", function () {
    update({ announce: true });
    if (!form.checkValidity()) {
      elements.status.textContent = "Preflight stopped locally · complete the highlighted station. Nothing was sent.";
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
      elements.status.textContent = "Preflight stopped locally · " + error.message + " Nothing was sent.";
      return;
    }
    if (localDemo) runLocalDemo();
    else handoffToEmail(payload);
  });

  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    resetLaunch();
    elements.status.textContent = "Five-clamp preflight restored · nothing has left this page.";
    update();
  });

  if (localDemo) {
    elements.demoFlag.hidden = false;
    elements.demoLink.hidden = true;
  }
  togglePublic();
  update();
  observeStations();
})();
