(function (global) {
  "use strict";

  function targetIsEditable(target) {
    return target instanceof Element && Boolean(target.closest(
      "input, textarea, select, [contenteditable='true'], [role='textbox']"
    ));
  }

  function focusOrOpenSearch() {
    var searchInput = document.querySelector("[data-evidence-search-input]");
    if (searchInput instanceof HTMLElement) {
      searchInput.focus();
      if (typeof searchInput.select === "function") searchInput.select();
      return;
    }
    var link = document.querySelector("[data-site-search-link]");
    if (link instanceof HTMLElement) link.click();
    else global.location.assign("/search.html?focus=1");
  }

  document.addEventListener("keydown", function (event) {
    if (event.defaultPrevented || event.altKey || event.shiftKey || targetIsEditable(event.target)) return;
    var slash = event.key === "/" && !event.ctrlKey && !event.metaKey;
    var command = event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey);
    if (!slash && !command) return;
    event.preventDefault();
    focusOrOpenSearch();
  });
})(window);
