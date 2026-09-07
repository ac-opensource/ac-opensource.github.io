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
    global.location.assign("/search.html?focus=1");
  }

  function revealCurrentMobileDestination() {
    var navigation = document.querySelector('#site-nav-mobile[aria-label="Mobile navigation"]');
    if (!(navigation instanceof HTMLElement) || navigation.scrollWidth <= navigation.clientWidth) return;
    var current = navigation.querySelector('[aria-current="page"]');
    if (!(current instanceof HTMLElement)) return;
    var destination = current.offsetLeft - ((navigation.clientWidth - current.offsetWidth) / 2);
    navigation.scrollLeft = Math.max(0, Math.min(destination, navigation.scrollWidth - navigation.clientWidth));
  }

  document.addEventListener("keydown", function (event) {
    if (event.defaultPrevented || event.altKey || event.shiftKey || targetIsEditable(event.target)) return;
    var slash = event.key === "/" && !event.ctrlKey && !event.metaKey;
    var command = event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey);
    if (!slash && !command) return;
    event.preventDefault();
    focusOrOpenSearch();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      global.requestAnimationFrame(revealCurrentMobileDestination);
    }, { once: true });
  } else {
    global.requestAnimationFrame(revealCurrentMobileDestination);
  }
})(window);
