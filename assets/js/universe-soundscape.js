(function () {
  "use strict";

  const STORAGE_KEY = "ac_universe_sound_v1";
  const root = document.documentElement;
  const state = {
    context: null,
    compressor: null,
    master: null,
    enabled: false,
    active: new Set(),
    lastCue: "",
    lastCueAt: 0,
    searchTimer: 0,
    rangeCueAt: 0
  };

  function readPreference() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "on";
    } catch (_error) {
      return false;
    }
  }

  function writePreference(enabled) {
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
    } catch (_error) {
      // Sound still works for this page when storage is unavailable.
    }
  }

  function pageContext() {
    const region = document.body?.dataset.universeRegion || document.body?.dataset.routeSignalPage;
    if (region) return region;
    const path = window.location.pathname;
    if (path === "/" || path.endsWith("/index.html")) return "dashboard";
    if (path.startsWith("/blog/")) return "article";
    return "site";
  }

  function updateDocumentState() {
    root.dataset.universeSound = state.enabled ? "on" : "off";
    document.body?.setAttribute("data-universe-sound", state.enabled ? "on" : "off");
    const synthesis = document.querySelector("[data-synthesis]");
    if (synthesis && !state.enabled) synthesis.dataset.audioState = "muted";
  }

  function updateControls() {
    document.querySelectorAll("[data-universe-sound-toggle]").forEach(function (button) {
      const label = state.enabled ? "[sound: on]" : "[sound: off]";
      button.setAttribute("aria-pressed", String(state.enabled));
      button.setAttribute("aria-label", state.enabled
        ? "Disable contextual interface sounds"
        : "Enable contextual interface sounds");
      button.title = state.enabled ? "Mute interface sounds" : "Enable interface sounds";
      const text = button.querySelector("[data-universe-sound-label]");
      if (text) text.textContent = label;
    });
  }

  function announceChange() {
    document.dispatchEvent(new CustomEvent("universe-sound:change", {
      detail: { enabled: state.enabled }
    }));
  }

  function ensureAudio() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      root.dataset.universeSoundState = "unsupported";
      return null;
    }
    if (!state.context) {
      state.context = new AudioContext();
      state.master = state.context.createGain();
      state.compressor = state.context.createDynamicsCompressor();
      state.master.gain.value = 0.68;
      state.compressor.threshold.value = -22;
      state.compressor.knee.value = 18;
      state.compressor.ratio.value = 7;
      state.compressor.attack.value = 0.003;
      state.compressor.release.value = 0.16;
      state.master.connect(state.compressor).connect(state.context.destination);
    }
    if (state.context.state === "suspended") state.context.resume().catch(function () {});
    root.dataset.universeSoundState = state.context.state;
    return state.context;
  }

  function track(source) {
    state.active.add(source);
    source.addEventListener?.("ended", function () { state.active.delete(source); }, { once: true });
    return source;
  }

  function tone(context, options) {
    const start = context.currentTime + (options.offset || 0);
    const duration = Math.max(0.025, options.duration || 0.1);
    const oscillator = track(context.createOscillator());
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    oscillator.type = options.type || "sine";
    oscillator.frequency.setValueAtTime(Math.max(20, options.frequency), start);
    if (options.endFrequency && options.endFrequency !== options.frequency) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.endFrequency), start + duration);
    }
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(options.cutoff || 1100, start);
    filter.Q.value = options.q || 0.45;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(options.gain || 0.025, start + Math.min(0.026, duration / 3));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(filter).connect(envelope).connect(state.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function noise(context, options) {
    const duration = Math.max(0.025, options.duration || 0.08);
    const start = context.currentTime + (options.offset || 0);
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const channel = buffer.getChannelData(0);
    let seed = 0x9e3779b9;
    for (let index = 0; index < channel.length; index += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      channel[index] = ((seed >>> 0) / 0xffffffff * 2 - 1) * (1 - index / channel.length);
    }
    const source = track(context.createBufferSource());
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = buffer;
    filter.type = options.filter || "bandpass";
    filter.frequency.value = options.frequency || 1800;
    filter.Q.value = options.q || 0.8;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(options.gain || 0.012, start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(envelope).connect(state.master);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  function playDashboard(context, cue) {
    if (cue === "navigate" || cue === "launch") {
      tone(context, { frequency: 110, endFrequency: 260, duration: 0.19, gain: 0.035, type: "triangle", cutoff: 720 });
      tone(context, { frequency: 330, endFrequency: 240, duration: 0.13, offset: 0.09, gain: 0.016, cutoff: 760 });
    } else {
      tone(context, { frequency: 190, endFrequency: 240, duration: 0.09, gain: 0.024, type: "triangle", cutoff: 680 });
    }
  }

  function playWork(context, cue) {
    if (cue === "navigate" || cue === "open") {
      tone(context, { frequency: 96, endFrequency: 136, duration: 0.15, gain: 0.04, type: "triangle", cutoff: 520 });
      tone(context, { frequency: 192, endFrequency: 252, duration: 0.13, offset: 0.055, gain: 0.022, type: "triangle", cutoff: 680 });
      noise(context, { duration: 0.065, offset: 0.03, frequency: 420, gain: 0.007, q: 0.65 });
    } else {
      tone(context, { frequency: 132, endFrequency: 174, duration: 0.085, gain: 0.028, type: "triangle", cutoff: 580 });
    }
  }

  function playLogs(context, cue) {
    if (cue === "galaxy-collision") {
      tone(context, { frequency: 68, endFrequency: 34, duration: 0.56, gain: 0.052, type: "sawtooth", cutoff: 260 });
      noise(context, { duration: 0.42, frequency: 110, gain: 0.029, q: 0.42 });
      tone(context, { frequency: 170, endFrequency: 92, duration: 0.3, offset: 0.055, gain: 0.025, type: "triangle", cutoff: 440 });
      tone(context, { frequency: 260, endFrequency: 180, duration: 0.26, offset: 0.13, gain: 0.012, type: "triangle", cutoff: 560 });
    } else if (cue === "galaxy-release") {
      tone(context, { frequency: 95, endFrequency: 240, duration: 0.3, gain: 0.03, type: "triangle", cutoff: 520 });
      noise(context, { duration: 0.18, offset: 0.03, frequency: 360, gain: 0.01, q: 0.6 });
      tone(context, { frequency: 270, endFrequency: 340, duration: 0.14, offset: 0.18, gain: 0.012, type: "triangle", cutoff: 620 });
    } else if (cue === "filter" || cue === "search" || cue === "toggle") {
      noise(context, { duration: 0.05, frequency: 650, gain: 0.008, q: 0.9 });
      tone(context, { frequency: 240, endFrequency: 300, duration: 0.065, gain: 0.018, type: "triangle", cutoff: 640 });
    } else if (cue === "dismiss") {
      tone(context, { frequency: 320, endFrequency: 150, duration: 0.13, gain: 0.022, type: "triangle", cutoff: 640 });
    } else if (cue === "bookmark") {
      tone(context, { frequency: 260, endFrequency: 330, duration: 0.07, gain: 0.022, type: "triangle", cutoff: 680 });
      tone(context, { frequency: 390, duration: 0.085, offset: 0.06, gain: 0.014, type: "triangle", cutoff: 720 });
    } else {
      tone(context, { frequency: 220, endFrequency: 320, duration: 0.11, gain: 0.023, type: "triangle", cutoff: 680 });
      noise(context, { duration: 0.045, offset: 0.025, frequency: 720, gain: 0.0055, q: 0.7 });
    }
  }

  function playAbout(context, cue) {
    if (cue === "dismiss") {
      tone(context, { frequency: 310, endFrequency: 155, duration: 0.18, gain: 0.025, cutoff: 620 });
    } else if (cue === "reset") {
      tone(context, { frequency: 330, endFrequency: 180, duration: 0.15, gain: 0.023, type: "triangle", cutoff: 680 });
      tone(context, { frequency: 130, duration: 0.18, offset: 0.08, gain: 0.016, cutoff: 440 });
    } else if (cue === "toggle" || cue === "filter") {
      tone(context, { frequency: 196, endFrequency: 247, duration: 0.09, gain: 0.021, type: "triangle", cutoff: 620 });
    } else {
      tone(context, { frequency: 130, endFrequency: 165, duration: 0.15, gain: 0.024, type: "triangle", cutoff: 480 });
      tone(context, { frequency: 196, endFrequency: 220, duration: 0.16, offset: 0.035, gain: 0.017, type: "triangle", cutoff: 560 });
      tone(context, { frequency: 262, duration: 0.11, offset: 0.09, gain: 0.01, type: "triangle", cutoff: 620 });
    }
  }

  function playResume(context, cue) {
    if (cue === "reset") {
      tone(context, { frequency: 340, endFrequency: 150, duration: 0.16, gain: 0.026, type: "triangle", cutoff: 660 });
    } else if (cue === "print") {
      noise(context, { duration: 0.045, frequency: 540, gain: 0.01, q: 0.7 });
      tone(context, { frequency: 165, duration: 0.075, offset: 0.03, gain: 0.019, type: "triangle", cutoff: 520 });
    } else {
      tone(context, { frequency: 95, endFrequency: 290, duration: 0.17, gain: 0.028, type: "triangle", cutoff: 620 });
      tone(context, { frequency: 340, duration: 0.065, offset: 0.14, gain: 0.014, type: "triangle", cutoff: 680 });
    }
  }

  function playContact(context, cue) {
    if (cue === "launch") {
      tone(context, { frequency: 72, endFrequency: 280, duration: 0.3, gain: 0.042, type: "sawtooth", cutoff: 520 });
      noise(context, { duration: 0.2, offset: 0.04, frequency: 320, gain: 0.014, q: 0.5 });
      tone(context, { frequency: 330, endFrequency: 390, duration: 0.1, offset: 0.23, gain: 0.015, type: "triangle", cutoff: 720 });
    } else if (cue === "success") {
      tone(context, { frequency: 165, duration: 0.16, gain: 0.026, type: "triangle", cutoff: 520 });
      tone(context, { frequency: 220, duration: 0.18, offset: 0.07, gain: 0.021, type: "triangle", cutoff: 580 });
      tone(context, { frequency: 262, duration: 0.2, offset: 0.14, gain: 0.016, type: "triangle", cutoff: 640 });
    } else if (cue === "error") {
      tone(context, { frequency: 170, endFrequency: 58, duration: 0.28, gain: 0.035, type: "sawtooth", cutoff: 420 });
      noise(context, { duration: 0.12, frequency: 240, gain: 0.01, q: 0.65 });
    } else if (cue === "toggle") {
      tone(context, { frequency: 150, endFrequency: 190, duration: 0.085, gain: 0.025, type: "triangle", cutoff: 520 });
    } else {
      tone(context, { frequency: 110, endFrequency: 147, duration: 0.1, gain: 0.029, type: "triangle", cutoff: 460 });
      tone(context, { frequency: 220, duration: 0.08, offset: 0.075, gain: 0.016, type: "triangle", cutoff: 560 });
    }
  }

  function playSignals(context, cue) {
    if (cue === "dismiss") {
      tone(context, { frequency: 300, endFrequency: 150, duration: 0.13, gain: 0.021, type: "triangle", cutoff: 620 });
    } else if (cue === "filter" || cue === "search" || cue === "reset") {
      tone(context, { frequency: 220, endFrequency: 270, duration: 0.07, gain: 0.019, type: "triangle", cutoff: 600 });
    } else {
      tone(context, { frequency: 260, endFrequency: 330, duration: 0.085, gain: 0.021, type: "triangle", cutoff: 660 });
      tone(context, { frequency: 440, duration: 0.065, offset: 0.08, gain: 0.011, type: "triangle", cutoff: 760 });
    }
  }

  function playArticle(context, cue) {
    if (cue === "bookmark") {
      tone(context, { frequency: 196, duration: 0.1, gain: 0.023, type: "triangle", cutoff: 560 });
      tone(context, { frequency: 247, duration: 0.12, offset: 0.07, gain: 0.016, type: "triangle", cutoff: 620 });
    } else if (cue === "share" || cue === "success") {
      tone(context, { frequency: 220, endFrequency: 262, duration: 0.11, gain: 0.021, type: "triangle", cutoff: 620 });
      tone(context, { frequency: 330, duration: 0.08, offset: 0.08, gain: 0.012, type: "triangle", cutoff: 680 });
    } else {
      tone(context, { frequency: 147, endFrequency: 196, duration: 0.12, gain: 0.021, type: "triangle", cutoff: 540 });
    }
  }

  function play(cue, options) {
    const settings = options || {};
    const contextName = settings.context || pageContext();
    const detail = { cue, context: contextName, enabled: state.enabled, audible: false };
    if (!state.enabled && !settings.force) {
      document.dispatchEvent(new CustomEvent("universe-sound:cue", { detail }));
      return false;
    }
    const now = performance.now();
    const cueKey = contextName + ":" + cue;
    if (cueKey === state.lastCue && now - state.lastCueAt < 55) return false;
    const context = ensureAudio();
    if (!context) return false;
    state.lastCue = cueKey;
    state.lastCueAt = now;
    detail.audible = true;
    document.dispatchEvent(new CustomEvent("universe-sound:cue", { detail }));

    if (contextName === "dashboard") playDashboard(context, cue);
    else if (contextName === "work") playWork(context, cue);
    else if (contextName === "logs") playLogs(context, cue);
    else if (contextName === "about") playAbout(context, cue);
    else if (contextName === "resume") playResume(context, cue);
    else if (contextName === "contact") playContact(context, cue);
    else if (contextName === "signals") playSignals(context, cue);
    else if (contextName === "article") playArticle(context, cue);
    else tone(context, { frequency: 180, endFrequency: 240, duration: 0.1, gain: 0.021, type: "triangle", cutoff: 600 });
    return true;
  }

  function setEnabled(enabled, options) {
    const next = Boolean(enabled);
    if (next === state.enabled) return;
    state.enabled = next;
    writePreference(next);
    updateDocumentState();
    updateControls();
    announceChange();
    if (options?.feedback !== false) {
      if (next) play("power", { context: pageContext(), force: true });
      else {
        play("power-down", { context: pageContext(), force: true });
        window.setTimeout(function () { state.context?.suspend().catch(function () {}); }, 280);
      }
    }
  }

  function cueForClick(target) {
    if (target.closest("[data-synthesis]")) return null;
    if (target.matches("[data-stellar-popup-close], .stellar-tree__popup-close") || target.closest("[data-close-detail], #galaxy-release")) return "dismiss";
    if (target.closest("[data-node-id], [data-band-trigger], .stellar-tree__root")) return "open";
    if (target.closest("[data-tree-reset], [data-signal-reset], [data-clear-filters]")) return "reset";
    if (target.closest("[data-tree-projection], [data-tree-interaction-toggle], [data-about-theme-toggle]")) return "toggle";
    if (target.closest("[data-signal]")) return "filter";
    if (target.closest("[data-print-resume]")) return "print";
    if (target.closest("button[data-slug], [data-select-signal], [data-slot-marker]")) return "open";
    if (target.closest("button[data-category]")) return "filter";
    if (target.closest("button[data-share-slug], #share-post-button")) return "share";
    if (target.closest("button[data-bookmark-slug], #bookmark-post-button")) return "bookmark";
    if (target.closest("[data-contact-retry]")) return "launch";
    if (target.closest("[data-skip-launch]")) return "success";
    const anchor = target.closest("a[href]");
    if (anchor) return anchor.hash && anchor.pathname === window.location.pathname ? "open" : "navigate";
    if (target.closest("summary")) return "open";
    if (target.closest("button, [role='button']")) return "toggle";
    return null;
  }

  function bindInteractions() {
    document.addEventListener("click", function (event) {
      const eventTarget = event.target instanceof Element ? event.target : null;
      if (!eventTarget) return;
      const toggle = eventTarget.closest("[data-universe-sound-toggle]");
      if (toggle) {
        setEnabled(!state.enabled);
        return;
      }
      const cue = cueForClick(eventTarget);
      if (cue) play(cue);
    });

    document.addEventListener("change", function (event) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest("[data-contact-console]")) return;
      if (target.matches("select")) play("filter");
      else if (target.matches("input[type='checkbox'], input[type='radio']")) play("toggle");
    });

    document.addEventListener("input", function (event) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.matches("input[type='range']")) {
        const now = performance.now();
        if (now - state.rangeCueAt >= 110) {
          state.rangeCueAt = now;
          play("filter");
        }
        return;
      }
      if (!target.matches("#galaxy-search, #signal-search")) return;
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(function () { play("search"); }, 460);
    });

    window.addEventListener("orbital:sound", function () {
      // The dashboard owns its orbital cue shapes; this event remains the
      // shared observability hook and the master preference gates its engine.
    });

    document.addEventListener("route-signal:emit", function () {
      // Orbital satellite links already emit a cue. Keep the route animation
      // from layering a second sound over the same action.
    });

    document.addEventListener("galaxy:animation-cue", function (event) {
      const cue = event.detail?.cue;
      if (["galaxy-collision", "galaxy-release"].includes(cue)) play(cue, { context: "logs" });
    });
  }

  function bindContactState() {
    const form = document.querySelector("[data-contact-console]");
    if (!form) return;
    const modules = Array.from(form.querySelectorAll("[data-module]"));
    modules.forEach(function (module) {
      module.dataset.soundLoaded = String(module.classList.contains("is-loaded"));
    });
    form.addEventListener("change", function (event) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.matches("input[name='intent']")) play("toggle", { context: "contact" });
      window.requestAnimationFrame(function () {
        modules.forEach(function (module) {
          const wasLoaded = module.dataset.soundLoaded === "true";
          const isLoaded = module.classList.contains("is-loaded");
          module.dataset.soundLoaded = String(isLoaded);
          if (!wasLoaded && isLoaded) play("module", { context: "contact" });
        });
      });
    });
    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.attributeName !== "data-record-state") return;
        const recordState = form.dataset.recordState;
        if (recordState === "submitting") play("launch", { context: "contact" });
        else if (recordState === "failed") play("error", { context: "contact" });
        else if (["stored_private", "pending_moderation"].includes(recordState)) play("success", { context: "contact" });
      });
    });
    observer.observe(form, { attributes: true, attributeFilter: ["data-record-state"] });
  }

  function installControl() {
    if (document.querySelector("[data-universe-sound-toggle]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "universe-sound-toggle";
    button.dataset.universeSoundToggle = "";
    button.innerHTML = '<span class="universe-sound-toggle__wave" aria-hidden="true"><i></i><i></i><i></i></span><span data-universe-sound-label></span>';
    document.body.append(button);
    updateControls();
  }

  state.enabled = readPreference();
  window.UniverseSound = Object.freeze({
    enabled: function () { return state.enabled; },
    play,
    setEnabled,
    snapshot: function () {
      return {
        activeSources: state.active.size,
        context: pageContext(),
        contextState: state.context?.state || "uninitialized",
        enabled: state.enabled
      };
    }
  });

  function initialize() {
    updateDocumentState();
    installControl();
    bindInteractions();
    bindContactState();
    announceChange();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
