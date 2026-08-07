(() => {
  document.documentElement.classList.remove("no-js");
  document.documentElement.classList.add("js");

  const gallery = document.querySelector("[data-option-gallery]");
  if (!gallery) return;

  const regions = {
    dashboard: {
      index: "00",
      kicker: "[DASHBOARD / THREE ORBITAL ARCHITECTURES]",
      title: "One identity. Three spatial systems.",
      summary: "The original moving neural field remains the anchor; each option changes how the destinations occupy it.",
      options: [
        ["/", "[ORBITAL FIELD]", "Orbiting destinations become navigable worlds.", "Select at the body’s live orbital position, zoom into its region, then traverse by control, keyboard, swipe, or history.", "live"],
        ["/experiments/universe-options/dashboard/option-02.html", "[MECHANICAL ORRERY]", "A precise instrument of linked rotating arms.", "Destinations share synchronized mechanical time rather than free spatial paths.", "live"],
        ["/experiments/universe-options/dashboard/option-03.html", "[LIVING FRAMEWORK]", "Suspended architecture that continuously rebalances.", "Structural members carry content through one breathing, non-orbital field.", "live"]
      ]
    },
    work: {
      index: "01",
      kicker: "[WORK / FIVE PORTFOLIO HIERARCHIES]",
      title: "One flagship. Four production credentials. Everything else is proof.",
      summary: "Bitcoin.com Wallet owns every opening. ITVX, OCBC Business, openpay, and MySTC remain substantial and immediately scannable; earlier work collapses into a compact career-credit footnote.",
      options: [
        ["/experiments/universe-options/work-round-05/supernova-portfolio.html", "[SUPERNOVA PORTFOLIO]", "The original portfolio, re-themed as an active stellar event.", "Its composition, screenshots, and project hierarchy stay intact while shock fronts, ejecta, and dashboard geometry create the supernova field.", "live"],
        ["/experiments/universe-options/work-round-04/flagship-deck.html", "[FLAGSHIP DECK]", "A deliberately asymmetrical production deck.", "Bitcoin owns the left-hand field while the other four production credentials retain full role, system summary, and proof in one substantial rail.", "live"],
        ["/experiments/universe-options/work-round-04/flagship-gravity.html", "[FLAGSHIP GRAVITY]", "Production work held in one spatial field.", "Bitcoin is the central mass; four recognizable shipped systems remain readable around it while career credits become a quiet footer belt.", "live"],
        ["/experiments/universe-options/work-round-04/flagship-broadsheet.html", "[FLAGSHIP BROADSHEET]", "A bright editorial front page for production evidence.", "Bitcoin dominates the feature well and the four other shipped products form a full-copy credential ribbon before the compact archive rail.", "live"],
        ["/experiments/universe-options/work-round-02/project-worlds.html", "[PROJECT WORLDS / INTERACTION STUDY]", "Sixteen authored systems orbit one spatial atlas.", "The immersive zoom-and-navigation study remains available as a deliberately slower reference, not the scan-first portfolio front door.", "live"]
      ]
    },
    logs: {
      index: "02",
      kicker: "[LOGS / FOUR ARCHIVE PHYSICS]",
      title: "Tune, condense, trace, or orbit the writing.",
      summary: "All published entries, dates, categories, reading times, summaries, RSS, and direct links remain real.",
      options: [
        ["/experiments/universe-options/logs/01-radio-telescope.html", "[RADIO TELESCOPE · REFERENCE]", "Aim a receiver at real transmissions.", "The earlier tuned archive remains directly runnable as a design reference.", "live"],
        ["/blog/", "[NEBULA ARCHIVE · ADOPTED]", "Categories become a labeled signal cloud.", "The production Logs page keeps every entry scannable while search condenses matching posts.", "live"],
        ["/experiments/universe-options/logs/03-constellation-threads.html", "[CONSTELLATION THREADS]", "Trace shared ideas through time.", "Deterministic relationships connect equal-size posts through real metadata.", "live"],
        ["/experiments/universe-options/logs/05-spiral-galaxy-archive.html", "[SPIRAL GALAXY ARCHIVE]", "Let every idea keep its own gravity.", "Real entries occupy four spiral arms; search collides a companion galaxy into them and reforms only the matches as the remnant.", "live"]
      ]
    },
    about: {
      index: "03",
      kicker: "[ABOUT / THREE IDENTITY PHYSICS]",
      title: "A whole person, not a skills dashboard.",
      summary: "Evidence relationships stay evidence—not rankings—and professional and personal context remain intact.",
      options: [
        ["/about.html", "[NEBULA WORLD TREE]", "Trace a whole person through one branched spatial cloud.", "The same source-backed topology toggles between authored 3D depth and a front-facing map; assessments and sources stay intact.", "live"],
        ["/experiments/universe-options/about/02-constellation-observatory.html", "[CONSTELLATION OBSERVATORY]", "Aim at a capability and illuminate its receipts.", "The actual profile map becomes the page-wide observatory instrument.", "live"],
        ["/experiments/universe-options/about/03-binary-whole-person.html", "[BINARY WHOLE PERSON]", "Professional practice and personal curiosity share gravity.", "Two stable centers reveal supported bridges without turning life into a productivity metric.", "live"]
      ]
    },
    contact: {
      index: "04",
      kicker: "[CONTACT / THREE LAUNCH PHYSICS]",
      title: "Build the vehicle, not a console.",
      summary: "The form becomes the launch system. Transport states stay provably honest.",
      options: [
        ["/experiments/universe-options/contact/option-01-vehicle-assembly.html", "[VEHICLE ASSEMBLY BUILDING]", "Every valid field installs a real flight component.", "Guidance, return channel, payload, mission package, then launch.", "live"],
        ["/experiments/universe-options/contact/option-02-vertical-launch-complex.html", "[VERTICAL LAUNCH COMPLEX]", "The whole page is the tower and ascent corridor.", "Preflight stations release a completed vehicle into a page-height launch.", "live"],
        ["/experiments/universe-options/contact/option-03-payload-integration.html", "[PAYLOAD INTEGRATION BAY]", "Compose the message inside an open fairing.", "Private transmission and public satellite payloads assemble differently.", "live"]
      ]
    },
    resume: {
      index: "05",
      kicker: "[RÉSUMÉ / THREE RECORD PHYSICS]",
      title: "Scan the same record three ways.",
      summary: "Every direction remains fast, complete, printable, and truthful; no proficiency bars or invented evidence.",
      options: [
        ["/resume.html", "[FLIGHT RECORDER]", "A chronological engineering mission spine.", "Roles and selected projects occupy long, readable intervals along one recorder.", "live"],
        ["/experiments/universe-options/resume/mission-dossier.html", "[MISSION DOSSIER]", "Scan the complete record by supported signal.", "Android, architecture, leadership, fintech, reliability, cross-platform, and AI-assisted delivery illuminate in place.", "live"],
        ["/experiments/universe-options/resume/career-star-chart.html", "[CAREER STAR CHART]", "Trace signals across roles on a stable time field.", "A compact spatial chart remains coupled to the conventional résumé and disappears in print.", "live"]
      ]
    },
    articles: {
      index: "06",
      kicker: "[ARTICLES / THREE READING PHYSICS]",
      title: "Let the article type choose the instrument.",
      summary: "Technical, case-study, personal, travel, and photography writing keep real prose, metadata, figures, and static SEO.",
      options: [
        ["/blog/2026-08-06-how-i-rebuilt-my-homepage-as-an-interactive-orbital-system.html", "[MISSION DEBRIEF]", "Real headings become a restrained reading trajectory.", "Five content modes change the whole-page composition without forcing labels the writing cannot support.", "live"],
        ["/experiments/universe-options/articles/option-02-observatory-logbook.html", "[OBSERVATORY LOGBOOK]", "Figures, evidence, and metadata become one observation sequence.", "Readers aim at real artifacts while prose remains the dominant surface.", "live"],
        ["/experiments/universe-options/articles/option-03-controlled-deep-dive.html", "[CONTROLLED DEEP DIVE]", "Context gathers as the reader goes deeper.", "Actual links, figures, and related posts move into a stable depth field without trapping scroll.", "live"]
      ]
    },
    signals: {
      index: "07",
      kicker: "[SIGNALS / THREE PUBLIC-RECORD PHYSICS]",
      title: "Approved records, never fake testimonials.",
      summary: "Empty state is honest; stable IDs, moderation, privacy, and removability remain explicit in every option.",
      options: [
        ["/signals.html", "[SATELLITE REGISTRY]", "A thousand deterministic slots waiting for approved records.", "The full-screen empty field never invents a satellite or leaks private data.", "live"],
        ["/experiments/universe-options/signals/option-02-visitor-constellation.html", "[VISITOR CONSTELLATION]", "Connect an approved signal only to its real target.", "Pages and projects anchor equal-size public records without social-network inference.", "live"],
        ["/experiments/universe-options/signals/option-03-relay-field.html", "[RELAY FIELD]", "Trace approved transmissions from source region to stable slot.", "Received, approved, and removed states remain visibly distinct.", "live"]
      ]
    },
    transitions: {
      index: "08",
      kicker: "[CONTINUITY / THREE HANDOFF PHYSICS]",
      title: "Connect regions without delaying them.",
      summary: "Direct links, new tabs, history, refresh, reduced motion, and back/forward cache remain native.",
      options: [
        ["/", "[SIGNAL HANDOFF]", "A selected major object emits a sub-second route signal.", "The destination interprets one small arrival cue using its own physics.", "live"],
        ["/experiments/universe-options/transitions/option-02.html", "[OBJECT MORPH]", "Shared geometry changes role across the page boundary.", "A strict, skippable proxy proves continuity without a single-page rewrite.", "live"],
        ["/experiments/universe-options/transitions/option-03.html", "[INSTANT FIELD MAP]", "No cinematic—only persistent spatial orientation.", "The labeled map carries continuity while navigation stays immediate.", "live"]
      ]
    }
  };

  const controls = [...gallery.querySelectorAll("[data-region]")];
  const buildState = document.querySelector("[data-build-state]");
  const trajectories = gallery.querySelector("[data-option-trajectories]");
  const title = gallery.querySelector("[data-region-title]");
  const kicker = gallery.querySelector("[data-region-kicker]");
  const summary = gallery.querySelector("[data-region-summary]");
  const index = gallery.querySelector("[data-region-index]");
  const count = gallery.querySelector("[data-region-count]");
  const archiveRoutes = [...gallery.querySelectorAll("[data-archive-route]")];
  const uniqueArchiveRoutes = new Set(archiveRoutes.map((link) => new URL(link.href, window.location.href).pathname));
  if (buildState) buildState.textContent = `[${uniqueArchiveRoutes.size} / ${archiveRoutes.length} LAB ROUTES INDEXED]`;

  const render = (key, historyMode = "push") => {
    const region = regions[key] || regions.contact;
    controls.forEach((control) => control.setAttribute("aria-pressed", String(control.dataset.region === key)));
    index.textContent = region.index;
    count.textContent = `${String(region.options.length).padStart(2, "0")} DIRECTIONS`;
    kicker.textContent = region.kicker;
    title.textContent = region.title;
    summary.textContent = region.summary;
    trajectories.replaceChildren(...region.options.map(([href, label, heading, copy, status], optionIndex) => {
      const anchor = document.createElement("a");
      anchor.dataset.status = status;
      if (status === "live") {
        anchor.href = href;
      } else {
        anchor.setAttribute("aria-disabled", "true");
        anchor.tabIndex = -1;
      }
      anchor.innerHTML = `<span>0${optionIndex + 1}</span><div><small>${label}</small><strong>${heading}</strong><p>${copy}</p></div><em>${status === "live" ? "READY TO TEST" : "BUILDING"}</em>`;
      return anchor;
    }));
    if (historyMode !== "none") {
      const url = new URL(window.location.href);
      url.searchParams.set("region", key);
      history[historyMode === "replace" ? "replaceState" : "pushState"]({ region: key }, "", url);
    }
  };

  controls.forEach((control) => control.addEventListener("click", () => {
    render(control.dataset.region);
    gallery.querySelector(".option-stage").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }));
  addEventListener("popstate", () => render(new URL(window.location.href).searchParams.get("region") || "contact", "none"));
  render(new URL(window.location.href).searchParams.get("region") || "contact", "replace");
})();
