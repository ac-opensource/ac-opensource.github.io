(() => {
  "use strict";

  const root = document.querySelector("[data-xray]");
  const fallbackProjects = [...document.querySelectorAll(".xray-fallback__project")];
  if (!root || fallbackProjects.length !== 16) return;

  const layerOrder = ["all", "problem", "system", "platform", "reliability", "evidence"];
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  const boundaryByCategory = Object.freeze({
    production: "Production system · imagery and evidence are public; private implementation detail remains bounded.",
    archive: "Archive system · available public detail remains bounded; no private implementation detail is inferred.",
    public: "Public build · claims remain within the linked repository or merged contribution."
  });

  const readProject = (article) => {
    const layers = new Map([...article.querySelectorAll("[data-layer]")].map((section) => [section.dataset.layer, {
      label: section.querySelector("h3")?.textContent.trim() || section.dataset.layer,
      paragraphs: [...section.querySelectorAll(":scope > p:not(.xray-fallback__links)")].map((paragraph) => paragraph.textContent.trim()),
      links: [...section.querySelectorAll(".xray-fallback__links a")].map((anchor) => ({
        href: anchor.getAttribute("href"),
        label: anchor.textContent.trim(),
        rel: anchor.getAttribute("rel"),
        target: anchor.getAttribute("target")
      }))
    }]));
    const visual = article.querySelector(".xray-fallback__visual, .xray-fallback__abstract");
    return {
      accent: article.dataset.accent,
      category: article.dataset.category,
      context: article.querySelector("header > p:first-child")?.textContent.split("·").slice(2).join("·").trim() || "",
      id: article.dataset.project,
      layers,
      name: article.dataset.name,
      ordinal: article.dataset.ordinal,
      visual: {
        images: [...visual.querySelectorAll("img")].map((image) => ({
          alt: image.getAttribute("alt") || "",
          height: image.getAttribute("height") || "",
          src: image.getAttribute("src") || "",
          width: image.getAttribute("width") || ""
        })),
        kind: visual.dataset.visualKind || "abstract",
        tokens: [...visual.querySelectorAll(":scope > span")].map((span) => span.textContent.trim())
      }
    };
  };

  const projects = fallbackProjects.map(readProject);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const slices = new Map([...root.querySelectorAll("[data-xray-layer]")].map((section) => [section.dataset.xrayLayer, section]));
  const elements = {
    boundary: root.querySelector("[data-project-boundary]"),
    category: root.querySelector("[data-project-category]"),
    context: root.querySelector("[data-project-context]"),
    controls: root.querySelector("[data-project-controls]"),
    index: root.querySelector("[data-instrument-index]"),
    layerControls: root.querySelector("[data-layer-controls]"),
    name: root.querySelector("[data-instrument-name]"),
    ordinal: root.querySelector("[data-project-ordinal]"),
    status: root.querySelector("[data-xray-status]"),
    title: root.querySelector("[data-project-title]"),
    visual: root.querySelector("[data-project-visual]")
  };
  if ([...Object.values(elements), ...slices.values()].some((element) => !element)) return;

  const state = { project: projects[0].id, layer: "all" };
  const nodeById = new Map();

  const renderVisual = (project) => {
    elements.visual.replaceChildren();
    elements.visual.dataset.visualKind = project.visual.kind;
    if (project.visual.images.length) {
      project.visual.images.forEach((record, index) => {
        const image = document.createElement("img");
        image.src = record.src;
        image.alt = record.alt;
        if (record.width) image.width = Number(record.width);
        if (record.height) image.height = Number(record.height);
        image.decoding = "async";
        image.loading = index === 0 ? "eager" : "lazy";
        elements.visual.append(image);
      });
      return;
    }
    const abstract = document.createElement("div");
    abstract.className = "xray-visual__abstract";
    abstract.setAttribute("aria-label", `${project.name} project representation`);
    const tokens = project.visual.tokens.length ? project.visual.tokens : [project.name];
    tokens.forEach((token) => {
      const span = document.createElement("span");
      span.textContent = token;
      abstract.append(span);
    });
    elements.visual.append(abstract);
  };

  const renderLayers = (project) => {
    slices.forEach((section, kind) => {
      const layer = project.layers.get(kind);
      if (!layer) return;
      section.dataset.active = String(state.layer === kind);
      section.querySelector("[data-layer-code]").textContent = layer.label;
      const content = section.querySelector("[data-layer-content]");
      content.replaceChildren();
      layer.paragraphs.forEach((copy) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = copy;
        content.append(paragraph);
      });
      layer.links.forEach((record) => {
        const anchor = document.createElement("a");
        anchor.href = record.href;
        anchor.textContent = record.label;
        if (record.target) anchor.target = record.target;
        if (record.rel) anchor.rel = record.rel;
        content.append(anchor);
      });
    });
  };

  const renderControls = (project) => {
    elements.layerControls.querySelectorAll("button[data-layer-mode]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.layerMode === state.layer));
    });
    nodeById.forEach((button, id) => button.setAttribute("aria-pressed", String(id === project.id)));
    const selectedNode = nodeById.get(project.id);
    selectedNode?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest", inline: "center" });
  };

  const render = () => {
    const project = projectById.get(state.project) || projects[0];
    root.style.setProperty("--project-accent", project.accent);
    root.dataset.layerFocus = state.layer;
    root.dataset.project = project.id;
    root.dataset.projectCategory = project.category;
    elements.ordinal.textContent = project.ordinal;
    elements.category.textContent = project.category;
    elements.title.textContent = project.name;
    elements.context.textContent = project.context;
    elements.boundary.textContent = boundaryByCategory[project.category];
    elements.index.textContent = `${project.ordinal} / 16`;
    elements.name.textContent = project.name;
    elements.status.textContent = `${project.name} · ${state.layer === "all" ? "combined cutaway" : `${state.layer} layer isolated`}`;
    document.title = `${project.name} · Systems X-Ray`;
    renderVisual(project);
    renderLayers(project);
    renderControls(project);
  };

  const writeUrl = (mode = "push") => {
    const url = new URL(window.location.href);
    if (state.project === projects[0].id) url.searchParams.delete("project");
    else url.searchParams.set("project", state.project);
    if (state.layer === "all") url.searchParams.delete("layer");
    else url.searchParams.set("layer", state.layer);
    const historyState = { systemsXray: true, project: state.project, layer: state.layer };
    window.history[mode === "replace" ? "replaceState" : "pushState"](historyState, "", url);
  };

  const restoreFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    state.project = projectById.has(params.get("project")) ? params.get("project") : projects[0].id;
    state.layer = layerOrder.includes(params.get("layer")) ? params.get("layer") : "all";
    render();
  };

  const chooseProject = (id, historyMode = "push") => {
    if (!projectById.has(id) || state.project === id) return;
    state.project = id;
    render();
    writeUrl(historyMode);
  };

  const chooseLayer = (layer, historyMode = "push") => {
    if (!layerOrder.includes(layer) || state.layer === layer) return;
    state.layer = layer;
    render();
    writeUrl(historyMode);
  };

  projects.forEach((project) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "xray-project-node";
    button.dataset.project = project.id;
    button.setAttribute("aria-label", `${project.ordinal} of 16, ${project.name}, ${project.category}`);
    button.setAttribute("aria-pressed", "false");
    button.textContent = project.ordinal;
    button.addEventListener("click", () => chooseProject(project.id));
    nodeById.set(project.id, button);
    elements.controls.append(button);
  });

  elements.controls.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const buttons = [...nodeById.values()];
    const current = Math.max(0, buttons.indexOf(document.activeElement));
    const next = event.key === "Home" ? 0
      : event.key === "End" ? buttons.length - 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (current - 1 + buttons.length) % buttons.length
          : (current + 1) % buttons.length;
    buttons[next].focus();
    chooseProject(buttons[next].dataset.project);
    event.preventDefault();
  });

  elements.layerControls.querySelectorAll("button[data-layer-mode]").forEach((button) => {
    button.addEventListener("click", () => chooseLayer(button.dataset.layerMode));
  });

  elements.layerControls.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const buttons = [...elements.layerControls.querySelectorAll("button[data-layer-mode]")];
    const current = Math.max(0, buttons.indexOf(document.activeElement));
    const next = event.key === "Home" ? 0
      : event.key === "End" ? buttons.length - 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (current - 1 + buttons.length) % buttons.length
          : (current + 1) % buttons.length;
    buttons[next].focus();
    chooseLayer(buttons[next].dataset.layerMode);
    event.preventDefault();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.layer !== "all") chooseLayer("all");
  });
  window.addEventListener("popstate", restoreFromUrl);

  restoreFromUrl();
  writeUrl("replace");
})();
