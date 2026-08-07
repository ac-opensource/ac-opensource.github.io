(() => {
  "use strict";

  const app = document.querySelector("[data-mosaic]");
  const artifactRoot = document.querySelector("[data-mosaic-artifacts]");

  if (!app || !artifactRoot) return;

  const titleBase = document.title;
  const controls = [...app.querySelectorAll("button[data-composition]")];
  const compositionLabel = app.querySelector("[data-composition-label]");
  const fieldCount = app.querySelector("[data-field-count]");
  const fieldStatus = app.querySelector("[data-field-status]");
  const announcement = app.querySelector("[data-mosaic-status]");
  const annotation = app.querySelector("[data-mosaic-annotation]");
  const annotationTitle = app.querySelector("[data-annotation-title]");
  const annotationCoordinate = app.querySelector("[data-annotation-coordinate]");
  const annotationPlatform = app.querySelector("[data-annotation-platform]");
  const annotationCopy = app.querySelector("[data-annotation-copy]");
  const annotationBoundary = app.querySelector("[data-annotation-boundary]");
  const closeAnnotationButton = app.querySelector("[data-close-annotation]");
  const tether = app.querySelector("[data-mosaic-tether]");
  const tetherLine = tether?.querySelector("line");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const domainByProject = {
    "bitcoin-wallet": "Crypto · Self-custody",
    itvx: "Streaming · Playback",
    ocbc: "Banking · Identity",
    openpay: "Payments · BNPL",
    mystc: "Telecom · Account services",
    littlepay: "Transit payments",
    owto: "Ride hailing",
    popslide: "Rewards platform",
    websafety: "Parental safety",
    solo: "White-label food",
    projectbass: "Network mapping",
    ntu: "Digital identity",
    aqua: "Expedition travel",
    "persons-finder": "Geospatial search",
    orchestrum: "Agent orchestration",
    mempalace: "AI memory · Project mining"
  };

  const ownershipByProject = {
    "bitcoin-wallet": "Led the end-to-end Android implementation",
    itvx: "Built playback features · Media player team",
    ocbc: "Senior Mobile Engineer · RedAirship",
    openpay: "Senior Mobile Engineer · RedAirship",
    mystc: "Lead Developer · Led five engineers",
    littlepay: "Led Android delivery + technical direction",
    owto: "Led Android, iOS + Node/Postgres",
    popslide: "Led Android development",
    websafety: "Worked across mobile, web + backend",
    solo: "Shared Android platform engineering",
    projectbass: "Kotlin + Retrofit contributor",
    ntu: "Phone + wearable delivery",
    aqua: "Android feature delivery + production fixes",
    "persons-finder": "Built the Kotlin geospatial API",
    orchestrum: "Built the agent review workflow",
    mempalace: "Open-source project-mining contributor"
  };

  const boundaryByCategory = {
    production: "Production system · imagery and evidence are public; private implementation detail remains bounded.",
    archive: "Archive system · available public detail remains bounded; no private implementation detail is inferred.",
    public: "Public build · claims remain within the linked repository or merged contribution."
  };

  const defaultLayout = [
    { x: 0, y: 0, w: 25, h: 55 },
    { x: 27, y: 6, w: 18, h: 47 },
    { x: 47, y: 1, w: 17, h: 52 },
    { x: 66, y: 8, w: 16, h: 44 },
    { x: 84, y: 3, w: 16, h: 50 },
    { x: 1, y: 59, w: 14, h: 18 },
    { x: 17, y: 56, w: 14, h: 20 },
    { x: 33, y: 61, w: 15, h: 16 },
    { x: 50, y: 56, w: 16, h: 21 },
    { x: 68, y: 60, w: 14, h: 17 },
    { x: 84, y: 55, w: 16, h: 22 },
    { x: 5, y: 81, w: 18, h: 18 },
    { x: 25, y: 79, w: 14, h: 20 },
    { x: 42, y: 82, w: 17, h: 16 },
    { x: 62, y: 78, w: 15, h: 21 },
    { x: 80, y: 81, w: 19, h: 18 }
  ];

  const mobileWidths = [100, 52, 48, 47, 53, 44, 56, 51, 49, 58, 42, 46, 54, 63, 37, 100];
  const state = { composition: "all", project: null, order: [], layouts: new Map() };

  const records = [...document.querySelectorAll(".mosaic-record")];
  const projects = records.map((record, index) => {
    const headerContext = record.querySelector(":scope > header > p:first-child")?.textContent.trim() || "";
    const contextPrefix = `${record.dataset.ordinal} / 16 · ${record.dataset.category} · `;
    const visual = record.querySelector("[data-visual-kind]");
    const layers = [...record.querySelectorAll("[data-layer]")].map((layer) => ({
      kind: layer.dataset.layer,
      label: layer.querySelector("h3")?.textContent.trim() || layer.dataset.layer,
      paragraphs: [...layer.querySelectorAll(":scope > p:not(.mosaic-project__links)")].map((paragraph) => paragraph.textContent.trim()).filter(Boolean),
      links: [...layer.querySelectorAll("a")].map((link) => ({
        href: link.getAttribute("href"),
        label: link.textContent.trim(),
        target: link.getAttribute("target"),
        rel: link.getAttribute("rel")
      }))
    }));
    const links = layers.flatMap((layer) => layer.links);
    const reliability = layers.find((layer) => layer.kind === "reliability")?.paragraphs.join(" ") || "";
    const searchable = [headerContext, record.querySelector("[data-project-platform]")?.textContent, ...layers.flatMap((layer) => layer.paragraphs)].join(" ").toLowerCase();

    return {
      id: record.dataset.project,
      name: record.dataset.name,
      ordinal: record.dataset.ordinal,
      category: record.dataset.category,
      accent: record.dataset.accent,
      context: headerContext.replace(contextPrefix, ""),
      platform: record.querySelector("[data-project-platform]")?.textContent.trim() || "",
      domain: domainByProject[record.dataset.project] || headerContext.replace(contextPrefix, ""),
      ownership: ownershipByProject[record.dataset.project] || "Engineering delivery",
      visualKind: visual?.dataset.visualKind || "",
      images: visual ? [...visual.querySelectorAll("img")].map((image) => ({
        src: image.getAttribute("src"),
        alt: image.getAttribute("alt") || "",
        width: image.getAttribute("width"),
        height: image.getAttribute("height")
      })) : [],
      tokens: visual ? [...visual.querySelectorAll("span")].map((token) => token.textContent.trim()) : [],
      layers,
      links,
      reliability,
      searchable,
      index,
      element: null,
      titleButton: null
    };
  });

  const modeConfig = {
    all: { label: "Whole proof wall", description: "Recognizable products first", match: () => true },
    production: { label: "Production systems", description: "Production systems carry the editorial lead", match: (project) => project.category === "production" },
    archive: { label: "Archive depth", description: "Archive systems move into the lead band", match: (project) => project.category === "archive" },
    public: { label: "Public builds", description: "Public repositories move into the lead band", match: (project) => project.category === "public" },
    mobile: { label: "Mobile systems", description: "Mobile delivery moves into the lead band", match: (project) => project.category !== "public" },
    reliability: { label: "Reliability seams", description: "Explicit reliability work moves into the lead band", match: (project) => /resilien|harden|reliab|error|security|data sync|fix|tests?|ci result|precedence|compatib|variant/.test(project.reliability.toLowerCase()) },
    evidence: { label: "Evidence density", description: "Projects with multiple linked sources move into the lead band", match: (project) => project.links.length > 1 }
  };

  const createMedia = (project) => {
    const media = document.createElement("div");
    media.className = "mosaic-piece__media";

    if (project.images.length) {
      project.images.forEach((imageData, imageIndex) => {
        const image = document.createElement("img");
        image.src = imageData.src;
        image.alt = imageData.alt;
        if (imageData.width) image.width = Number(imageData.width);
        if (imageData.height) image.height = Number(imageData.height);
        image.loading = project.index < 5 && imageIndex === 0 ? "eager" : "lazy";
        image.decoding = "async";
        media.append(image);
      });
      return media;
    }

    const abstract = document.createElement("div");
    abstract.className = "mosaic-piece__abstract";
    abstract.setAttribute("aria-hidden", "true");
    (project.tokens.length ? project.tokens : [project.name]).forEach((tokenText) => {
      const token = document.createElement("span");
      token.textContent = tokenText;
      abstract.append(token);
    });
    media.append(abstract);
    return media;
  };

  const createPiece = (project) => {
    const piece = document.createElement("article");
    piece.className = "mosaic-piece";
    piece.dataset.project = project.id;
    piece.dataset.category = project.category;
    piece.dataset.visualKind = project.visualKind;
    piece.style.setProperty("--piece-accent", project.accent);
    piece.setAttribute("aria-label", `${project.ordinal} of ${projects.length}, ${project.name}. ${project.domain}.`);

    const body = document.createElement("div");
    body.className = "mosaic-piece__body";

    const domain = document.createElement("p");
    domain.className = "mosaic-piece__domain";
    domain.textContent = `${project.ordinal} · ${project.category} / ${project.domain}`;

    const title = document.createElement("button");
    title.type = "button";
    title.className = "mosaic-piece__title";
    title.dataset.openProject = project.id;
    title.textContent = project.name;
    title.setAttribute("aria-label", `${project.name}. ${project.ownership}. Open the project evidence note.`);

    const ownership = document.createElement("p");
    ownership.className = "mosaic-piece__ownership";
    ownership.textContent = project.ownership;

    const system = document.createElement("p");
    system.className = "mosaic-piece__system";
    system.textContent = project.platform;

    const proof = document.createElement("p");
    proof.className = "mosaic-piece__proof";
    const evidence = project.links[0];
    if (evidence) {
      const link = document.createElement("a");
      link.href = evidence.href;
      link.textContent = `${project.links.length} evidence source${project.links.length === 1 ? "" : "s"} ↗`;
      if (evidence.target) link.target = evidence.target;
      if (evidence.rel) link.rel = evidence.rel;
      proof.append(link);
    }
    const availability = document.createElement("span");
    availability.textContent = "Linked evidence";
    proof.append(availability);

    body.append(domain, title, ownership, system, proof);
    piece.append(createMedia(project), body);
    project.element = piece;
    project.titleButton = title;
    return piece;
  };

  projects.forEach((project) => artifactRoot.append(createPiece(project)));

  const compositionFor = (mode) => {
    if (mode === "all") {
      const layouts = new Map(projects.map((project, index) => [project.id, defaultLayout[index]]));
      return { order: [...projects], matches: [...projects], layouts };
    }

    const config = modeConfig[mode];
    const matches = projects.filter(config.match);
    const remaining = projects.filter((project) => !config.match(project));
    const order = [...matches, ...remaining];
    const layouts = new Map(order.map((project, index) => [project.id, defaultLayout[index]]));
    return { order, matches, layouts };
  };

  const setUrl = ({ replace = false } = {}) => {
    const url = new URL(window.location.href);
    if (state.composition === "all") url.searchParams.delete("composition");
    else url.searchParams.set("composition", state.composition);
    if (state.project) url.searchParams.set("project", state.project);
    else url.searchParams.delete("project");
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
  };

  const positionAnnotation = (project) => {
    const layout = state.layouts.get(project.id);
    if (!layout || !annotation || !tether || !tetherLine) return;
    const centerX = layout.x + layout.w / 2;
    const centerY = layout.y + layout.h / 2;
    const side = centerX > 63 ? "left" : "right";
    const noteX = side === "left" ? Math.max(36, layout.x - .8) : Math.min(69, layout.x + layout.w + .8);
    const noteY = Math.min(76, Math.max(24, centerY));

    annotation.dataset.side = side;
    annotation.style.setProperty("--note-x", noteX.toFixed(3));
    annotation.style.setProperty("--note-y", noteY.toFixed(3));
    tetherLine.setAttribute("x1", centerX.toFixed(3));
    tetherLine.setAttribute("y1", centerY.toFixed(3));
    tetherLine.setAttribute("x2", noteX.toFixed(3));
    tetherLine.setAttribute("y2", noteY.toFixed(3));
  };

  const renderAnnotation = (project) => {
    if (!annotation || !annotationCopy || !annotationTitle || !annotationCoordinate || !annotationPlatform || !annotationBoundary || !tether) return;
    projects.forEach((item) => item.element.classList.toggle("is-selected", item.id === project.id));
    annotationCoordinate.textContent = `${project.ordinal} / ${projects.length} · ${project.category} · ${project.domain}`;
    annotationTitle.textContent = project.name;
    annotationPlatform.textContent = `${project.ownership} · ${project.platform}`;
    annotationBoundary.textContent = boundaryByCategory[project.category];
    annotationCopy.replaceChildren();

    project.layers.forEach((layer) => {
      if (!layer.paragraphs.length && !layer.links.length) return;
      const section = document.createElement("section");
      const heading = document.createElement("h3");
      const content = document.createElement("div");
      heading.textContent = layer.label;
      layer.paragraphs.forEach((copy) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = copy;
        content.append(paragraph);
      });
      layer.links.forEach((linkData) => {
        const link = document.createElement("a");
        link.href = linkData.href;
        link.textContent = linkData.label;
        if (linkData.target) link.target = linkData.target;
        if (linkData.rel) link.rel = linkData.rel;
        content.append(link);
      });
      section.append(heading, content);
      annotationCopy.append(section);
    });

    annotation.hidden = false;
    tether.hidden = false;
    positionAnnotation(project);
    document.title = `${project.name} · Editorial Proof Wall`;
  };

  const selectProject = (projectId, { history = true, focusClose = false } = {}) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    state.project = project.id;
    renderAnnotation(project);
    if (history) setUrl();
    if (focusClose) closeAnnotationButton?.focus({ preventScroll: true });
    announcement.textContent = `${project.name} evidence note opened. All sixteen projects remain present.`;
  };

  const closeProject = ({ history = true, restoreFocus = true } = {}) => {
    const priorProject = projects.find((project) => project.id === state.project);
    state.project = null;
    projects.forEach((project) => project.element.classList.remove("is-selected"));
    if (annotation) annotation.hidden = true;
    if (tether) tether.hidden = true;
    document.title = titleBase;
    if (history) setUrl();
    if (restoreFocus && priorProject) priorProject.titleButton.focus({ preventScroll: true });
    announcement.textContent = "Project evidence note closed. All sixteen projects remain present.";
  };

  const applyComposition = (mode, { history = true, announce = true } = {}) => {
    const safeMode = modeConfig[mode] ? mode : "all";
    const composition = compositionFor(safeMode);
    const matchIds = new Set(composition.matches.map((project) => project.id));
    state.composition = safeMode;
    state.order = composition.order;
    state.layouts = composition.layouts;
    app.dataset.composition = safeMode;

    composition.order.forEach((project, visualIndex) => {
      const layout = composition.layouts.get(project.id);
      const isMatch = safeMode === "all" || matchIds.has(project.id);
      const isFeature = visualIndex < 5;
      project.element.dataset.match = String(isMatch);
      project.element.dataset.tier = isFeature ? "feature" : "compact";
      project.element.style.setProperty("--x", layout.x.toFixed(4));
      project.element.style.setProperty("--y", layout.y.toFixed(4));
      project.element.style.setProperty("--w", layout.w.toFixed(4));
      project.element.style.setProperty("--h", layout.h.toFixed(4));
      project.element.style.setProperty("--z", String(isMatch ? 8 : 4));
      project.element.style.setProperty("--mobile-w", String(mobileWidths[visualIndex]));
      artifactRoot.append(project.element);
    });

    controls.forEach((control) => control.setAttribute("aria-pressed", String(control.dataset.composition === safeMode)));
    compositionLabel.textContent = modeConfig[safeMode].label;
    fieldCount.textContent = `${projects.length} / ${projects.length} present`;
    if (safeMode === "all") {
      fieldStatus.textContent = "Five production anchors · eleven compact records · none hidden";
    } else {
      fieldStatus.textContent = `${composition.matches.length} emphasized · ${projects.length - composition.matches.length} retained · none hidden`;
    }

    if (state.project) {
      const selected = projects.find((project) => project.id === state.project);
      if (selected) positionAnnotation(selected);
    }
    if (history) setUrl();
    if (announce) announcement.textContent = `${modeConfig[safeMode].description}. ${composition.matches.length} emphasized; all sixteen projects remain readable.`;
  };

  controls.forEach((control, index) => {
    control.addEventListener("click", () => applyComposition(control.dataset.composition));
    control.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + controls.length) % controls.length;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % controls.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = controls.length - 1;
      controls[nextIndex].focus();
      controls[nextIndex].click();
    });
  });

  artifactRoot.addEventListener("click", (event) => {
    const opener = event.target.closest("[data-open-project]");
    const piece = event.target.closest(".mosaic-piece");
    if (!opener && (!piece || event.target.closest("a"))) return;
    const projectId = opener?.dataset.openProject || piece.dataset.project;
    const shouldToggleClosed = state.project === projectId;
    if (shouldToggleClosed) closeProject();
    else selectProject(projectId);
  });

  artifactRoot.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.project) {
      event.preventDefault();
      closeProject();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const currentProject = projects.find((project) => project.element.contains(event.target));
    if (!currentProject) return;
    const currentIndex = state.order.indexOf(currentProject);
    let nextIndex = currentIndex;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + state.order.length) % state.order.length;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % state.order.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = state.order.length - 1;
    event.preventDefault();
    state.order[nextIndex].titleButton.focus({ preventScroll: reducedMotion.matches });
  });

  closeAnnotationButton?.addEventListener("click", () => closeProject());

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.project) {
      event.preventDefault();
      closeProject();
    }
  });

  window.addEventListener("resize", () => {
    if (!state.project) return;
    const selected = projects.find((project) => project.id === state.project);
    if (selected) positionAnnotation(selected);
  });

  window.addEventListener("popstate", () => {
    const params = new URLSearchParams(window.location.search);
    const requestedMode = params.get("composition");
    const requestedProject = params.get("project");
    applyComposition(modeConfig[requestedMode] ? requestedMode : "all", { history: false, announce: false });
    if (projects.some((project) => project.id === requestedProject)) selectProject(requestedProject, { history: false });
    else if (state.project) closeProject({ history: false, restoreFocus: false });
  });

  const params = new URLSearchParams(window.location.search);
  const initialMode = modeConfig[params.get("composition")] ? params.get("composition") : "all";
  const initialProject = params.get("project");
  applyComposition(initialMode, { history: false, announce: false });
  if (projects.some((project) => project.id === initialProject)) selectProject(initialProject, { history: false });
  setUrl({ replace: true });
})();
