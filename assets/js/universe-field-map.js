(function () {
  "use strict";

  if (document.querySelector("[data-universe-route-map]")) return;

  const destinations = [
    { id: "home", number: "00", label: "Home", href: "/", x: "50%", y: "52%", mobileX: "8%" },
    { id: "about", number: "01", label: "About", href: "/about.html", x: "12%", y: "70%", mobileX: "22%" },
    { id: "profile", number: "02", label: "Skills", href: "/about.html#profile-map", x: "25%", y: "24%", mobileX: "36%" },
    { id: "work", number: "03", label: "Work", href: "/work.html", x: "44%", y: "15%", mobileX: "50%" },
    { id: "projects", number: "04", label: "Projects", href: "/work.html#public-builds", x: "71%", y: "26%", mobileX: "64%" },
    { id: "threads", number: "05", label: "Threads", href: "/blog/", x: "87%", y: "69%", mobileX: "78%" },
    { id: "contact", number: "06", label: "Contact", href: "/contact.html", x: "59%", y: "88%", mobileX: "92%" }
  ];

  function normalizedPath() {
    return window.location.pathname.replace(/\/index\.html$/, "/");
  }

  function activeDestination() {
    const path = normalizedPath();
    const hash = window.location.hash;
    if (path === "/" || path === "") return "home";
    if (path === "/about.html") return hash === "#profile-map" || hash === "#profile-map-evidence" ? "profile" : "about";
    if (path === "/work.html") return hash === "#public-builds" ? "projects" : "work";
    if (path.startsWith("/blog/")) return "threads";
    if (path === "/contact.html" || path === "/signals.html") return "contact";
    if (path === "/resume.html") return "work";
    return "home";
  }

  const nav = document.createElement("nav");
  nav.className = "universe-route-map";
  nav.dataset.universeRouteMap = "";
  nav.setAttribute("aria-label", "Universe destinations");
  nav.innerHTML = '<svg viewBox="0 0 380 128" aria-hidden="true"><path d="M190 65 48 87M190 65 92 30M190 65 166 19M190 65 276 33M190 65 334 84M190 65 218 112M48 87 92 30 166 19 276 33 334 84 218 112 48 87" /></svg>';

  const current = activeDestination();
  destinations.forEach((destination) => {
    const link = document.createElement("a");
    link.href = destination.href;
    link.dataset.mapId = destination.id;
    link.style.setProperty("--map-x", destination.x);
    link.style.setProperty("--map-y", destination.y);
    link.style.setProperty("--mobile-x", destination.mobileX);
    link.innerHTML = `<span>${destination.number}</span><strong>${destination.label}</strong>`;
    link.setAttribute("aria-label", `${destination.label}: ${destination.href}`);
    if (destination.id === current) link.setAttribute("aria-current", "location");
    nav.append(link);
  });

  const integratedHost = document.querySelector("[data-universe-route-map-host]");
  const mobileFloatingQuery = integratedHost?.dataset.universeRouteMapMobile === "floating"
    ? window.matchMedia("(max-width: 760px)")
    : null;
  const mountRouteMap = () => {
    const integrated = Boolean(integratedHost) && !mobileFloatingQuery?.matches;
    if (integrated) {
      nav.dataset.universeRouteMapMode = "integrated";
      integratedHost.append(nav);
      document.body.classList.add("has-integrated-universe-route-map");
    } else {
      delete nav.dataset.universeRouteMapMode;
      document.body.append(nav);
      document.body.classList.remove("has-integrated-universe-route-map");
    }
  };
  mountRouteMap();
  mobileFloatingQuery?.addEventListener?.("change", mountRouteMap);
  document.body.classList.add("has-universe-route-map");

  window.addEventListener("hashchange", () => {
    const active = activeDestination();
    nav.querySelectorAll("[data-map-id]").forEach((link) => {
      if (link.dataset.mapId === active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  });
})();
