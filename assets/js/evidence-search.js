(function () {
  "use strict";

  var INDEX_URL = "/assets/data/search-index.json";
  var form = document.querySelector("[data-evidence-search-form]");
  var input = document.querySelector("[data-evidence-search-input]");
  var results = document.querySelector("[data-evidence-search-results]");
  var status = document.querySelector("[data-evidence-search-status]");
  var empty = document.querySelector("[data-evidence-search-empty]");
  var navigation = document.querySelector("[data-search-navigation]");
  var resultsRegion = document.querySelector(".evidence-search__results");
  var resultsTitle = document.getElementById("results-title");
  var readout = document.querySelector("[data-search-readout]");
  var searchLink = document.querySelector("[data-site-search-link]");
  if (!form || !input || !results || !status || !empty || !navigation) return;

  document.documentElement.classList.replace("no-js", "has-js");
  if (searchLink) {
    searchLink.setAttribute("href", "#evidence-query");
    searchLink.setAttribute("aria-label", "Focus evidence search");
  }
  var documents = [];
  var pendingQuery = null;
  var pendingReveal = false;
  var ready = false;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var routeMotionTimer = 0;

  function setPhase(phase, count) {
    navigation.dataset.searchPhase = phase;
    if (!readout) return;
    readout.textContent = {
      idle: "INDEX READY",
      loading: "INDEXING",
      results: String(count || 0) + " MATCHES",
      empty: "NO MATCH",
      error: "INDEX UNAVAILABLE"
    }[phase] || "INDEX READY";
  }

  function clearRouteMotion() {
    window.clearTimeout(routeMotionTimer);
    routeMotionTimer = 0;
    delete navigation.dataset.searchMotion;
  }

  function signalRouteMotion() {
    clearRouteMotion();
    if (reduceMotion.matches) return;
    // Restart the short route-acquisition sequence for an intentional query.
    // The geometry remains static at rest; there is no ambient animation loop.
    void navigation.offsetWidth;
    navigation.dataset.searchMotion = "routing";
    routeMotionTimer = window.setTimeout(clearRouteMotion, 720);
  }

  function revealResults() {
    if (!resultsRegion) return;
    window.requestAnimationFrame(function () {
      var topbar = document.querySelector(".search-topbar");
      // Reserve the same header space whether the current shell scrolls or
      // sticks. This keeps the result heading clear during shared-nav changes.
      var topOffset = topbar ? topbar.getBoundingClientRect().height + 16 : 16;
      var targetTop = window.scrollY + resultsRegion.getBoundingClientRect().top - topOffset;
      window.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
      if (resultsTitle) resultsTitle.focus({ preventScroll: true });
    });
  }

  if (typeof reduceMotion.addEventListener === "function") {
    reduceMotion.addEventListener("change", function (event) {
      if (event.matches) clearRouteMotion();
    });
  }

  function normalize(value) {
    return String(value || "").toLowerCase();
  }

  function tokensFor(query) {
    return [...new Set(normalize(query).match(/[a-z0-9+#.]+/g) || [])].filter(function (token) {
      return token.length > 1;
    });
  }

  function occurrences(haystack, needle) {
    if (!needle) return 0;
    var count = 0;
    var from = 0;
    while ((from = haystack.indexOf(needle, from)) >= 0) {
      count += 1;
      from += needle.length;
    }
    return count;
  }

  function sectionScore(section, phrase, tokens) {
    var title = normalize(section.title);
    var text = normalize(section.text);
    var score = title.includes(phrase) ? 72 : 0;
    tokens.forEach(function (token) {
      score += occurrences(title, token) * 18;
      score += Math.min(occurrences(text, token), 8) * 3;
    });
    return score;
  }

  function rank(documentRecord, query, tokens) {
    var phrase = normalize(query).trim();
    var title = normalize(documentRecord.title);
    var description = normalize(documentRecord.description);
    var allText = [title, description].concat(documentRecord.sections.map(function (section) {
      return normalize(section.text);
    })).join(" ");
    if (!tokens.length || !tokens.every(function (token) { return allText.includes(token); })) return null;

    var bestSection = documentRecord.sections[0];
    var bestSectionScore = -1;
    documentRecord.sections.forEach(function (section) {
      var score = sectionScore(section, phrase, tokens);
      if (score > bestSectionScore) {
        bestSection = section;
        bestSectionScore = score;
      }
    });
    var score = bestSectionScore + (title.includes(phrase) ? 100 : 0) + (description.includes(phrase) ? 35 : 0);
    tokens.forEach(function (token) {
      score += occurrences(title, token) * 28;
      score += occurrences(description, token) * 7;
    });
    return { documentRecord: documentRecord, section: bestSection, score: score };
  }

  function snippetFor(text, tokens) {
    var source = String(text || "").replace(/\s+/g, " ").trim();
    var normalized = normalize(source);
    var positions = tokens.map(function (token) { return normalized.indexOf(token); }).filter(function (index) { return index >= 0; });
    var center = positions.length ? Math.min.apply(Math, positions) : 0;
    var start = Math.max(0, center - 95);
    var end = Math.min(source.length, start + 250);
    if (start > 0) {
      var boundary = source.indexOf(" ", start);
      start = boundary >= 0 && boundary < center ? boundary + 1 : start;
    }
    if (end < source.length) {
      var lastSpace = source.lastIndexOf(" ", end);
      end = lastSpace > start ? lastSpace : end;
    }
    return (start ? "…" : "") + source.slice(start, end) + (end < source.length ? "…" : "");
  }

  function appendHighlighted(node, text, tokens) {
    var source = String(text || "");
    var lowered = normalize(source);
    var cursor = 0;
    while (cursor < source.length) {
      var next = null;
      tokens.forEach(function (token) {
        var index = lowered.indexOf(token, cursor);
        if (index >= 0 && (!next || index < next.index || (index === next.index && token.length > next.token.length))) {
          next = { index: index, token: token };
        }
      });
      if (!next) {
        node.append(document.createTextNode(source.slice(cursor)));
        break;
      }
      if (next.index > cursor) node.append(document.createTextNode(source.slice(cursor, next.index)));
      var mark = document.createElement("mark");
      mark.textContent = source.slice(next.index, next.index + next.token.length);
      node.append(mark);
      cursor = next.index + next.token.length;
    }
  }

  function syncQueryUrl(query) {
    var canonical = String(query || "").trim();
    var url = new URL(window.location.href);
    var current = url.searchParams.get("q") || "";
    var hadFocusRequest = url.searchParams.has("focus");
    if (canonical) url.searchParams.set("q", canonical);
    else url.searchParams.delete("q");
    url.searchParams.delete("focus");
    if (current === canonical) {
      if (hadFocusRequest) window.history.replaceState({ q: canonical || null }, "", url);
      return;
    }
    window.history.pushState({ q: canonical || null }, "", url);
  }

  function render(query, options) {
    options = options || {};
    query = String(query || "").slice(0, 160);
    var canonical = query.trim();
    var tokens = tokensFor(canonical);
    results.replaceChildren();
    input.value = query;
    if (options.history !== false) syncQueryUrl(canonical);
    if (!canonical) {
      pendingQuery = ready ? null : "";
      empty.hidden = false;
      empty.textContent = "Try a capability, system, project, or delivery outcome.";
      status.textContent = ready ? "Set a destination to scan the published field." : "Loading the published route field…";
      clearRouteMotion();
      setPhase(ready ? "idle" : "loading");
      if (options.reveal) input.focus({ preventScroll: true });
      return;
    }
    if (!ready) {
      pendingQuery = canonical;
      pendingReveal = pendingReveal || options.reveal === true;
      empty.hidden = false;
      empty.textContent = "Preparing the published route index…";
      status.textContent = "Loading the published route field…";
      clearRouteMotion();
      setPhase("loading");
      return;
    }
    pendingQuery = null;

    var ranked = documents.map(function (record) { return rank(record, canonical, tokens); })
      .filter(Boolean)
      .sort(function (left, right) {
        return right.score - left.score || left.documentRecord.title.localeCompare(right.documentRecord.title);
      })
      .slice(0, 40);

    ranked.forEach(function (match, index) {
      var record = match.documentRecord;
      var item = document.createElement("li");
      item.className = "evidence-result";
      item.style.setProperty("--result-index", String(Math.min(index, 5)));
      var meta = document.createElement("p");
      meta.className = "evidence-result__meta";
      meta.textContent = record.type + (record.date ? " · " + record.date : "");
      var body = document.createElement("div");
      var heading = document.createElement("h3");
      var link = document.createElement("a");
      link.href = record.url + (match.section.id ? "#" + encodeURIComponent(match.section.id) : "");
      appendHighlighted(link, record.title, tokens);
      heading.append(link);
      body.append(heading);
      if (match.section.title && normalize(match.section.title) !== normalize(record.title)) {
        var section = document.createElement("p");
        section.className = "evidence-result__section";
        appendHighlighted(section, match.section.title, tokens);
        body.append(section);
      }
      var snippet = document.createElement("p");
      snippet.className = "evidence-result__snippet";
      appendHighlighted(snippet, snippetFor(match.section.text || record.description, tokens), tokens);
      body.append(snippet);
      var arrow = document.createElement("span");
      arrow.className = "evidence-result__arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "↗";
      item.append(meta, body, arrow);
      results.append(item);
    });

    empty.hidden = ranked.length > 0;
    if (!ranked.length) empty.textContent = "No published match. Try a broader capability, system, or project name.";
    status.textContent = ranked.length + " published " + (ranked.length === 1 ? "match" : "matches") + " for “" + canonical + "”.";
    setPhase(ranked.length ? "results" : "empty", ranked.length);
    signalRouteMotion();
    if (options.reveal) revealResults();
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    render(input.value, { reveal: true });
  });

  document.querySelectorAll("[data-search-suggestion]").forEach(function (button) {
    button.addEventListener("click", function () {
      render(button.dataset.searchSuggestion || "", { reveal: true });
      input.focus({ preventScroll: true });
    });
  });

  window.addEventListener("popstate", function () {
    render(new URLSearchParams(window.location.search).get("q") || "", { history: false });
  });

  var initialQuery = (new URLSearchParams(window.location.search).get("q") || "").slice(0, 160);
  input.value = initialQuery;
  if (new URLSearchParams(window.location.search).get("focus") === "1") {
    input.focus({ preventScroll: true });
  }

  fetch(INDEX_URL, { credentials: "same-origin", cache: "no-cache" })
    .then(function (response) {
      if (!response.ok) throw new Error("Published index request failed.");
      return response.json();
    })
    .then(function (payload) {
      if (!payload || payload.version !== 1 || !Array.isArray(payload.documents)) {
        throw new Error("Published index format is invalid.");
      }
      documents = payload.documents.filter(function (record) {
        return record && /^\/(?!\/)/.test(record.url) && Array.isArray(record.sections);
      });
      ready = true;
      if (pendingQuery !== null || initialQuery) {
        var revealPendingResults = pendingReveal;
        pendingReveal = false;
        render(pendingQuery !== null ? pendingQuery : initialQuery, {
          history: false,
          reveal: revealPendingResults
        });
      } else {
        status.textContent = "Set a destination to scan the published field.";
        setPhase("idle");
      }
    })
    .catch(function () {
      ready = false;
      clearRouteMotion();
      results.replaceChildren();
      empty.hidden = false;
      empty.textContent = "The published index is unavailable. Browse Portfolio, About, Résumé, or Logs directly.";
      status.textContent = "Search index unavailable.";
      setPhase("error");
    });
})();
