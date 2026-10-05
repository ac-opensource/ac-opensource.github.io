(() => {
  "use strict";

  const root = document.querySelector("[data-resume-dossier]");
  if (!root) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // The current role's length and its share of the timeline grow with time.
  function monthsSince(value) {
    const [year, month] = String(value).split("-").map(Number);
    if (!year || !month) return 0;
    const now = new Date();
    return Math.max(1, (now.getFullYear() - year) * 12 + (now.getMonth() + 1 - month));
  }

  function durationLabel(total) {
    const years = Math.floor(total / 12);
    const months = total % 12;
    const parts = [];
    if (years) parts.push(`${years} yr${years > 1 ? "s" : ""}`);
    if (months) parts.push(`${months} mo${months > 1 ? "s" : ""}`);
    return parts.join(" ") || "1 mo";
  }

  root.querySelectorAll("[data-duration-since]").forEach((node) => {
    const total = monthsSince(node.dataset.durationSince);
    if (total) node.textContent = durationLabel(total);
  });
  root.querySelectorAll("[data-months-since]").forEach((node) => {
    const total = monthsSince(node.dataset.monthsSince);
    if (total) node.style.setProperty("--months", String(total));
  });

  // Copy email, only where the clipboard is available.
  const copyButton = root.querySelector("[data-copy-email]");
  const copyStatus = root.querySelector("[data-copy-status]");
  const email = root.querySelector("[data-email]");
  let copyTimer = 0;
  if (copyButton && email && navigator.clipboard?.writeText) {
    copyButton.hidden = false;
    copyButton.addEventListener("click", async () => {
      window.clearTimeout(copyTimer);
      try {
        await navigator.clipboard.writeText(email.textContent.trim());
        copyButton.textContent = "Copied";
        if (copyStatus) copyStatus.textContent = "Email address copied.";
      } catch (_error) {
        if (copyStatus) copyStatus.textContent = "Copy failed. Select the address instead.";
      }
      copyTimer = window.setTimeout(() => {
        copyButton.textContent = "Copy";
        if (copyStatus) copyStatus.textContent = "";
      }, 2400);
    });
  }

  // Highlight roles by focus. Nothing is hidden; other roles are dimmed and the
  // choice is kept in ?signal= so a highlighted view can be shared.
  const controls = root.querySelector("[data-signal-controls]");
  if (!controls) return;

  const SIGNALS = Object.freeze({
    leadership: "Leadership",
    architecture: "Architecture",
    fintech: "Fintech & crypto",
    "cross-platform": "Cross-platform",
    reliability: "Reliability"
  });
  const buttons = Array.from(controls.querySelectorAll("[data-signal]"));
  const resetButton = controls.querySelector("[data-signal-reset]");
  const status = document.getElementById("signal-filter-status");
  const roles = Array.from(root.querySelectorAll(".resume-role[data-signals]"));
  const evidenceNodes = Array.from(root.querySelectorAll("[data-signals]"));
  let activeSignal = "";

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

  function supports(node, signal) {
    return !signal || (node.dataset.signals || "").split(/\s+/).includes(signal);
  }

  function applySignal(signal, { history = null } = {}) {
    activeSignal = Object.hasOwn(SIGNALS, signal) ? signal : "";
    root.dataset.activeSignal = activeSignal;

    buttons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.signal === activeSignal));
    });
    evidenceNodes.forEach((node) => {
      node.dataset.signalMatch = String(supports(node, activeSignal));
    });

    resetButton.disabled = !activeSignal;
    if (status) {
      const matches = roles.filter((role) => supports(role, activeSignal)).length;
      status.textContent = activeSignal
        ? `${SIGNALS[activeSignal]}: ${matches} of ${roles.length} roles. The others are dimmed, not hidden.`
        : "";
    }
    if (history) writeHistory(activeSignal, history);
  }

  function revealFirstMatch() {
    const first = roles.find((role) => supports(role, activeSignal));
    if (!activeSignal || !first) return;
    const bounds = first.getBoundingClientRect();
    if (bounds.top >= 0 && bounds.top < window.innerHeight * 0.8) return;
    first.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
  }

  controls.hidden = false;

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.signal === activeSignal ? "" : button.dataset.signal;
      applySignal(next, { history: "push" });
      revealFirstMatch();
    });
  });
  resetButton.addEventListener("click", () => {
    applySignal("", { history: "push" });
    buttons[0]?.focus();
  });
  window.addEventListener("popstate", () => applySignal(requestedSignal()));
  window.addEventListener("pageshow", () => applySignal(requestedSignal()));

  const initialUrl = new URL(window.location.href);
  const initialSignal = requestedSignal();
  if (initialUrl.searchParams.has("signal") && !initialSignal) writeHistory("", "replace");
  applySignal(initialSignal);
})();
