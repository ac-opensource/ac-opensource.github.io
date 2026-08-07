(() => {
  "use strict";

  const root = document.querySelector("[data-resume-dossier]");
  const controls = document.querySelector("[data-signal-controls]");
  if (!root || !controls) return;

  const SIGNALS = Object.freeze({
    android: "Android",
    architecture: "Architecture",
    leadership: "Leadership",
    fintech: "Fintech",
    reliability: "Reliability",
    "cross-platform": "Cross-platform",
    "ai-assisted-delivery": "AI-assisted delivery"
  });
  const buttons = Array.from(controls.querySelectorAll("[data-signal]"));
  const resetButton = controls.querySelector("[data-signal-reset]");
  const printButton = controls.querySelector("[data-print-resume]");
  const status = document.getElementById("signal-filter-status");
  const evidenceNodes = Array.from(root.querySelectorAll("[data-signals]"));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let activeSignal = "";
  let scanTimer = 0;

  function requestedSignal() {
    const value = new URL(window.location.href).searchParams.get("signal") || "";
    return Object.hasOwn(SIGNALS, value) ? value : "";
  }

  function signalUrl(signal) {
    const url = new URL(window.location.href);
    if (signal) url.searchParams.set("signal", signal);
    else url.searchParams.delete("signal");
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function writeHistory(signal, mode) {
    const next = signalUrl(signal);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next === current) return;
    window.history[mode === "replace" ? "replaceState" : "pushState"]({
      ...(window.history.state || {}),
      resumeSignal: signal || null
    }, "", next);
  }

  function nodeSupportsSignal(node, signal) {
    return !signal || (node.dataset.signals || "").split(/\s+/).includes(signal);
  }

  function applySignal(signal, { history = null } = {}) {
    activeSignal = Object.hasOwn(SIGNALS, signal) ? signal : "";
    root.dataset.activeSignal = activeSignal;

    buttons.forEach((button) => {
      const selected = button.dataset.signal === activeSignal;
      button.setAttribute("aria-pressed", String(selected));
      button.dataset.selected = String(selected);
    });
    evidenceNodes.forEach((node) => {
      node.dataset.signalMatch = String(nodeSupportsSignal(node, activeSignal));
    });

    resetButton.disabled = !activeSignal;
    if (status) {
      status.textContent = activeSignal
        ? `${SIGNALS[activeSignal]} evidence is highlighted. Every other resume item remains visible and print stays complete.`
        : "All experience shown · choose a capability to highlight its evidence.";
    }
    if (history) writeHistory(activeSignal, history);
  }

  function pulseScan() {
    window.clearTimeout(scanTimer);
    root.classList.remove("is-scanning");
    if (reducedMotion.matches) return;
    root.getBoundingClientRect();
    root.classList.add("is-scanning");
    scanTimer = window.setTimeout(() => root.classList.remove("is-scanning"), 700);
  }

  root.classList.add("resume-dossier--enhanced");
  controls.hidden = false;

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.signal === activeSignal ? "" : button.dataset.signal;
      applySignal(next, { history: "push" });
      pulseScan();
    });
  });
  resetButton.addEventListener("click", () => {
    applySignal("", { history: "push" });
    pulseScan();
  });
  printButton.addEventListener("click", () => window.print());
  window.addEventListener("popstate", () => applySignal(requestedSignal()));
  window.addEventListener("pageshow", () => applySignal(requestedSignal()));

  const initialUrl = new URL(window.location.href);
  const initialSignal = requestedSignal();
  if (initialUrl.searchParams.has("signal") && !initialSignal) writeHistory("", "replace");
  applySignal(initialSignal);
})();
