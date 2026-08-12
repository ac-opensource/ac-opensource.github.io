(function () {
  "use strict";

  var INDEX_URL = "/assets/data/search-index.json";
  var form = document.querySelector("[data-evidence-search-form]");
  var input = document.querySelector("[data-evidence-search-input]");
  var results = document.querySelector("[data-evidence-search-results]");
  var status = document.querySelector("[data-evidence-search-status]");
  var empty = document.querySelector("[data-evidence-search-empty]");
  if (!form || !input || !results || !status || !empty) return;

  document.documentElement.classList.replace("no-js", "has-js");
  var documents = [];
  var pendingQuery = null;
  var ready = false;

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
    query = String(query || "").slice(0, 160);
    var canonical = query.trim();
    var tokens = tokensFor(canonical);
    results.replaceChildren();
    input.value = query;
    if (!options || options.history !== false) syncQueryUrl(canonical);
    if (!canonical) {
      pendingQuery = ready ? null : "";
      empty.hidden = false;
      empty.textContent = "Try a capability, project, technology, or delivery concern.";
      status.textContent = ready ? "Enter a query to scan the public field." : "Loading the public field…";
      return;
    }
    if (!ready) {
      pendingQuery = canonical;
      empty.hidden = false;
      empty.textContent = "Preparing the published index…";
      status.textContent = "Loading the public field…";
      return;
    }
    pendingQuery = null;

    var ranked = documents.map(function (record) { return rank(record, canonical, tokens); })
      .filter(Boolean)
      .sort(function (left, right) {
        return right.score - left.score || left.documentRecord.title.localeCompare(right.documentRecord.title);
      })
      .slice(0, 40);

    ranked.forEach(function (match) {
      var record = match.documentRecord;
      var item = document.createElement("li");
      item.className = "evidence-result";
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
    if (!ranked.length) empty.textContent = "No published match. Try a broader capability or project name.";
    status.textContent = ranked.length + " published " + (ranked.length === 1 ? "match" : "matches") + " for “" + canonical + "”.";
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    render(input.value);
  });

  document.querySelectorAll("[data-search-suggestion]").forEach(function (button) {
    button.addEventListener("click", function () {
      render(button.dataset.searchSuggestion || "");
      input.focus();
    });
  });

  window.addEventListener("popstate", function () {
    render(new URLSearchParams(window.location.search).get("q") || "", { history: false });
  });

  var initialQuery = (new URLSearchParams(window.location.search).get("q") || "").slice(0, 160);
  input.value = initialQuery;
  if (new URLSearchParams(window.location.search).get("focus") === "1") input.focus();

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
        render(pendingQuery !== null ? pendingQuery : initialQuery, { history: false });
      } else {
        status.textContent = "Enter a query to scan the public field.";
      }
      if (!input.value && document.activeElement === document.body) input.focus();
    })
    .catch(function () {
      ready = false;
      results.replaceChildren();
      empty.hidden = false;
      empty.textContent = "The published index is unavailable. Browse Portfolio, About, Résumé, or Logs directly.";
      status.textContent = "Search index unavailable.";
    });
})();
