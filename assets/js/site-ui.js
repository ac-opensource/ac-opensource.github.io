(function () {
    function initMenu() {
        const trigger = document.getElementById("menu-toggle");
        const menu = document.getElementById("top-nav-links");
        if (!trigger || !menu) return;

        trigger.addEventListener("click", () => {
            const isOpen = menu.classList.toggle("open");
            trigger.setAttribute("aria-expanded", String(isOpen));
        });

        menu.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", () => {
                menu.classList.remove("open");
                trigger.setAttribute("aria-expanded", "false");
            });
        });
    }

    function setYear() {
        document.querySelectorAll("[data-year]").forEach((node) => {
            node.textContent = String(new Date().getFullYear());
        });
    }

    function markCurrentPath() {
        const path = window.location.pathname;
        document.querySelectorAll(".top-nav-link[data-match]").forEach((link) => {
            const match = link.getAttribute("data-match");
            if (!match) return;
            link.classList.toggle("active", path === match || path.startsWith(match + "/"));
        });
    }

    initMenu();
    setYear();
    markCurrentPath();
})();
