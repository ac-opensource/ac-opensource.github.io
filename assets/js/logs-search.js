(() => {
  "use strict";

  // Search console affordances for the Logs archive. The archive script owns
  // search state and rendering; this adds quick subjects, mirrors which one is
  // active, and offers a direct path from the galaxy to the matching entries.
  const tuner = document.getElementById("galaxy-tuner");
  const search = document.getElementById("galaxy-search");
  const hero = document.querySelector(".galaxy-hero");
  if (!tuner || !search || !hero) return;

  const feed = document.getElementById("blog-feed");
  const count = document.getElementById("galaxy-count");
  const suggestions = tuner.querySelector("[data-galaxy-suggestions]");
  const results = tuner.querySelector("[data-galaxy-results]");
  const resultsLabel = results?.querySelector("[data-galaxy-results-label]");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const normalize = (value) => String(value || "").trim().toLocaleLowerCase("en-US");

  const sync = () => {
    const query = normalize(search.value);
    suggestions?.querySelectorAll("button[data-suggest]").forEach((button) => {
      button.setAttribute("aria-pressed", String(normalize(button.dataset.suggest) === query));
    });
    if (!results) return;
    // The archive marks the galaxy "remnant" whenever a search or filter is active.
    const total = Number.parseInt(count?.textContent || "", 10);
    results.hidden = hero.dataset.merger !== "remnant" || !(total > 0);
    if (!results.hidden && resultsLabel) {
      resultsLabel.textContent = `${total} ${total === 1 ? "match" : "matches"}`;
      results.setAttribute("aria-label", `View ${total} matching ${total === 1 ? "entry" : "entries"}`);
    }
  };

  suggestions?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-suggest]");
    // Until the archive is ready its submit handler is not bound yet.
    if (!button || document.getElementById("galaxy-field")?.dataset.ready !== "true") return;
    // Choosing the active subject again clears it.
    search.value = button.getAttribute("aria-pressed") === "true" ? "" : button.dataset.suggest;
    if (typeof tuner.requestSubmit === "function") tuner.requestSubmit();
    else tuner.dispatchEvent(new Event("submit", { cancelable: true }));
    sync();
  });

  results?.addEventListener("click", (event) => {
    if (!feed) return;
    event.preventDefault();
    feed.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "start" });
    feed.focus({ preventScroll: true });
  });

  search.addEventListener("input", sync);
  tuner.addEventListener("reset", () => window.setTimeout(sync));
  new MutationObserver(sync).observe(hero, { attributes: true, attributeFilter: ["data-merger"] });
  if (count) new MutationObserver(sync).observe(count, { childList: true, characterData: true, subtree: true });
  if (suggestions) suggestions.hidden = false;
  sync();
})();
