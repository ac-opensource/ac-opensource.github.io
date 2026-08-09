(function () {
  "use strict";

  if (document.querySelector("[data-universe-route-map]")) return;

  const destinations = [
    { id: "home", number: "00", label: "Home", href: "/", x: "55%", y: "57%", depth: 1, magnification: "1.0×" },
    { id: "about", number: "01", label: "About", href: "/about.html", x: "22%", y: "69%", depth: 4.5, magnification: "1.6×" },
    { id: "profile", number: "02", label: "Skills", href: "/about.html#profile-map", x: "35%", y: "38%", depth: 7.4, magnification: "3.2×" },
    { id: "work", number: "03", label: "Work", href: "/work.html", x: "50%", y: "31%", depth: 3.1, magnification: "2.4×" },
    { id: "projects", number: "04", label: "Production", href: "/work.html#production-work", x: "70%", y: "47%", depth: 8.8, magnification: "5.6×" },
    { id: "threads", number: "05", label: "Threads", href: "/blog/", x: "88%", y: "69%", depth: 6.5, magnification: "2.8×" },
    { id: "contact", number: "06", label: "Contact", href: "/contact.html", x: "74%", y: "78%", depth: 4, magnification: "1.8×" },
  ];
  const CARRIED_EXPANSION_KEY = "ac.universe-field-map.carry-expanded.v1";
  const byId = new Map(destinations.map((destination) => [destination.id, destination]));
  let currentId = "home";
  let resizeFrame = 0;
  let carriedExpansion = false;
  let expansionChangedOnArrival = false;

  function normalizedPath() {
    return window.location.pathname.replace(/\/index\.html$/, "/");
  }

  function activeDestination() {
    const path = normalizedPath();
    const hash = window.location.hash;
    if (path === "/" || path === "") return "home";
    if (path === "/about.html") return hash === "#profile-map" || hash === "#profile-map-evidence" ? "profile" : "about";
    if (path === "/work.html") return hash === "#production-work" ? "projects" : "work";
    if (path.startsWith("/blog/")) return "threads";
    if (path === "/contact.html" || path === "/signals.html") return "contact";
    if (path === "/resume.html") return "work";
    return "home";
  }

  const nav = document.createElement("nav");
  nav.className = "universe-route-map";
  nav.dataset.universeRouteMap = "";
  nav.dataset.mapExpanded = "false";
  nav.dataset.slewState = "tracking";
  nav.setAttribute("aria-label", "Universe destinations");
  nav.innerHTML = `
    <button class="universe-route-map__toggle" type="button" data-universe-map-toggle aria-expanded="false" aria-controls="universe-route-map-field" aria-label="Open sky map">
      <span>MAP</span><b aria-hidden="true">+</b>
    </button>
    <span class="universe-route-map__field" id="universe-route-map-field" data-universe-map-field aria-hidden="true">
      <svg class="universe-route-map__sky" viewBox="0 0 380 128" preserveAspectRatio="none" aria-hidden="true">
        <path class="universe-route-map__horizon" d="M20 103 Q190 -1 360 103" />
        <path class="universe-route-map__declination" d="M48 87 Q190 28 334 84" />
        <path class="universe-route-map__ticks" d="M70 74v6M118 49v6M166 34v6M214 34v6M262 49v6M310 74v6" />
      </svg>
      <span class="universe-route-map__readout" aria-hidden="true">
        <small data-universe-slew-state-label>LOCKED</small>
        <strong data-universe-slew-label>HOME</strong>
        <b data-universe-slew-meta>AZ 000° · Z 1.0 · MAG 1.0×</b>
      </span>
      <span class="universe-route-map__sightline" aria-hidden="true"></span>
      <span class="universe-route-map__telescope" aria-hidden="true">
        <i class="universe-route-map__barrel"></i>
        <i class="universe-route-map__eyepiece"></i>
        <i class="universe-route-map__objective"></i>
      </span>
      <span class="universe-route-map__mount" aria-hidden="true"><i></i></span>
      <span class="universe-route-map__announcer" data-universe-slew-announcer aria-live="polite"></span>
    </span>
  `;
  const field = nav.querySelector("[data-universe-map-field]");
  const toggle = nav.querySelector("[data-universe-map-toggle]");

  currentId = activeDestination();
  destinations.forEach((destination) => {
    const link = document.createElement("a");
    link.href = destination.href;
    link.dataset.mapId = destination.id;
    link.dataset.depth = destination.depth.toFixed(1);
    link.dataset.magnification = destination.magnification;
    link.style.setProperty("--map-x", destination.x);
    link.style.setProperty("--map-y", destination.y);
    link.innerHTML = `<span>${destination.number}</span><strong>${destination.label}</strong>`;
    link.setAttribute("aria-label", `${destination.label}, depth ${destination.depth.toFixed(1)}, magnification ${destination.magnification}`);
    if (destination.id === currentId) link.setAttribute("aria-current", "location");
    field.append(link);
  });

  function takeCarriedExpansion() {
    try {
      const carried = document.documentElement.dataset.universeMotion === "arrive"
        && window.sessionStorage.getItem(CARRIED_EXPANSION_KEY) === "1";
      window.sessionStorage.removeItem(CARRIED_EXPANSION_KEY);
      return carried;
    } catch (_error) {
      return false;
    }
  }

  function carryExpansion() {
    try {
      if (nav.dataset.mapExpanded === "true") window.sessionStorage.setItem(CARRIED_EXPANSION_KEY, "1");
      else window.sessionStorage.removeItem(CARRIED_EXPANSION_KEY);
    } catch (_error) {
      // The map remains usable when session storage is unavailable.
    }
  }

  function setExpanded(expanded, { announce = false, immediate = false } = {}) {
    if (immediate) nav.dataset.mapResizeImmediate = "true";
    nav.dataset.mapExpanded = expanded ? "true" : "false";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", expanded ? "Minimize sky map" : "Open sky map");
    toggle.querySelector("b").textContent = expanded ? "−" : "+";
    field.setAttribute("aria-hidden", String(!expanded));
    if (announce) {
      nav.querySelector("[data-universe-slew-announcer]").textContent = expanded
        ? "Sky map expanded."
        : "Sky map minimized.";
    }
    if (immediate) {
      nav.getBoundingClientRect();
      window.requestAnimationFrame(() => delete nav.dataset.mapResizeImmediate);
    }
    window.setTimeout(() => pointAt(nav.dataset.slewTarget || currentId, nav.dataset.slewState || "tracking", false), 280);
  }

  function mountRouteMap() {
    nav.dataset.universeRouteMapMode = "floating";
    if (nav.parentElement !== document.body) document.body.append(nav);
    document.body.classList.remove("has-integrated-universe-route-map");
    window.requestAnimationFrame(() => pointAt(
      nav.dataset.slewTarget || currentId,
      nav.dataset.slewState || "tracking",
      false
    ));
  }

  function bearingFor(deltaX, deltaY) {
    return (Math.atan2(deltaY, deltaX) * 180 / Math.PI + 90 + 360) % 360;
  }

  function pointAt(id, state = "aiming", announce = false) {
    const destination = byId.get(id) || byId.get(currentId);
    const target = nav.querySelector(`[data-map-id="${destination.id}"]`);
    const mount = nav.querySelector(".universe-route-map__mount");
    if (!target || !mount || !nav.isConnected) return;

    const targetBounds = target.getBoundingClientRect();
    const mountBounds = mount.getBoundingClientRect();
    const startX = mountBounds.left + mountBounds.width / 2;
    const startY = mountBounds.top + mountBounds.height * 0.36;
    const endX = targetBounds.left + targetBounds.width / 2;
    const endY = targetBounds.top + Math.min(13, targetBounds.height * 0.3);
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
    const sightlineLength = Math.max(26, Math.hypot(deltaX, deltaY) - 5);
    const bearing = bearingFor(deltaX, deltaY);

    nav.dataset.slewTarget = destination.id;
    nav.dataset.slewState = state;
    nav.style.setProperty("--scope-angle", `${angle.toFixed(2)}deg`);
    nav.style.setProperty("--sightline-length", `${sightlineLength.toFixed(2)}px`);
    nav.querySelector("[data-universe-slew-state-label]").textContent = {
      aiming: "TARGET",
      slewing: "SEEKING",
      tracking: "LOCKED",
    }[state] || "FIELD";
    nav.querySelector("[data-universe-slew-label]").textContent = destination.label.toUpperCase();
    nav.querySelector("[data-universe-slew-meta]").textContent = `AZ ${String(Math.round(bearing)).padStart(3, "0")}° · Z ${destination.depth.toFixed(1)} · MAG ${destination.magnification}`;
    nav.querySelectorAll("[data-map-id]").forEach((link) => {
      if (link.dataset.mapId === destination.id) link.dataset.slewActive = "true";
      else delete link.dataset.slewActive;
    });
    if (announce) {
      nav.querySelector("[data-universe-slew-announcer]").textContent = `Pointing toward ${destination.label}, depth ${destination.depth.toFixed(1)}, magnification ${destination.magnification}.`;
    }
  }

  function syncCurrent() {
    currentId = activeDestination();
    nav.querySelectorAll("[data-map-id]").forEach((link) => {
      if (link.dataset.mapId === currentId) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
    pointAt(currentId, "tracking", false);
  }

  nav.querySelectorAll("[data-map-id]").forEach((link) => {
    const aim = () => pointAt(link.dataset.mapId, "aiming", false);
    link.addEventListener("pointerenter", aim);
    link.addEventListener("focus", () => pointAt(link.dataset.mapId, "aiming", true));
    link.addEventListener("click", () => pointAt(link.dataset.mapId, "slewing", false));
  });
  toggle.addEventListener("click", () => {
    expansionChangedOnArrival = true;
    setExpanded(nav.dataset.mapExpanded !== "true", { announce: true });
  });
  nav.addEventListener("pointerleave", () => pointAt(currentId, "tracking", false));
  nav.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (!nav.contains(document.activeElement)) pointAt(currentId, "tracking", false);
    });
  });

  document.addEventListener("universe-perspective:depart", (event) => {
    carryExpansion();
    mountRouteMap();
    if (event.detail?.mapId && byId.has(event.detail.mapId)) pointAt(event.detail.mapId, "slewing", false);
  });
  document.addEventListener("universe-perspective:settled", () => {
    mountRouteMap();
    if (carriedExpansion && !expansionChangedOnArrival) setExpanded(false, { immediate: true });
    carriedExpansion = false;
  });
  window.addEventListener("hashchange", syncCurrent);
  window.addEventListener("resize", () => {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(() => pointAt(nav.dataset.slewTarget || currentId, nav.dataset.slewState, false));
  });
  nav.addEventListener("transitionend", (event) => {
    if ((event.propertyName === "width" || event.propertyName === "height") && nav.dataset.mapExpanded === "true") {
      pointAt(nav.dataset.slewTarget || currentId, nav.dataset.slewState || "tracking", false);
    }
  });

  carriedExpansion = takeCarriedExpansion();
  setExpanded(carriedExpansion);
  mountRouteMap();
  document.body.classList.add("has-universe-route-map");

  window.UniverseRouteMap = Object.freeze({
    snapshot() {
      return Object.freeze({
        current: currentId,
        depth: byId.get(currentId)?.depth || null,
        expanded: nav.dataset.mapExpanded === "true",
        mode: "floating",
        state: nav.dataset.slewState,
        target: nav.dataset.slewTarget,
        targetDepth: byId.get(nav.dataset.slewTarget)?.depth || null,
        targetCount: nav.querySelectorAll("[data-map-id]").length,
      });
    },
  });
})();
