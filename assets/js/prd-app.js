const STORAGE_KEY = "prd-template-progress-v1";

function safeText(value) {
    return value ?? "";
}

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (typeof text === "string") element.textContent = text;
    return element;
}

function getCompletionState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed);
    } catch {
        return new Set();
    }
}

function saveCompletionState(doneIds) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...doneIds]));
}

function renderFields(fields = []) {
    const wrap = createElement("div", "prd-fields section-grid two-col");
    fields.forEach((field) => {
        const card = createElement("article", "field-card");
        const title = createElement("h3", "prd-field-title", field.label);
        const copy = createElement("p", "prd-field-copy", field.description || "");
        card.append(title, copy);
        if (Array.isArray(field.examples) && field.examples.length) {
            field.examples.forEach((example) => {
                const sample = createElement("p", "prd-field-example", `Example: ${example}`);
                card.appendChild(sample);
            });
        }
        wrap.appendChild(card);
    });
    return wrap;
}

function renderCards(cards = []) {
    const wrap = createElement("div", "section-grid two-col");
    cards.forEach((entry) => {
        const card = createElement("article", "card");
        const title = createElement("h3", null, safeText(entry.title));
        const body = createElement("p", null, safeText(entry.body));
        card.append(title, body);
        if (entry.meta) {
            card.appendChild(createElement("p", "meta", safeText(entry.meta)));
        }
        wrap.appendChild(card);
    });
    return wrap;
}

function renderList(list = [], ordered = false) {
    const element = createElement(ordered ? "ol" : "ul", ordered ? "prd-steps" : "content-list");
    list.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        element.appendChild(li);
    });
    return element;
}

function renderTable(table) {
    const wrapper = createElement("div", "card");
    const tableEl = createElement("table", "data-table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    (table.headers || []).forEach((header) => {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = header;
        headRow.appendChild(th);
    });
    head.appendChild(headRow);

    const body = document.createElement("tbody");
    (table.rows || []).forEach((row) => {
        const tr = document.createElement("tr");
        row.forEach((cell) => {
            const td = document.createElement("td");
            td.textContent = safeText(cell);
            tr.appendChild(td);
        });
        body.appendChild(tr);
    });

    tableEl.append(head, body);
    wrapper.appendChild(tableEl);
    return wrapper;
}

function renderMetrics(metrics = []) {
    const grid = createElement("div", "metric-grid");
    metrics.forEach((metric) => {
        const card = createElement("article", "metric-card");
        card.append(
            createElement("p", "metric-label", safeText(metric.label)),
            createElement("p", "metric-value", safeText(metric.value)),
            createElement("p", "metric-sub", safeText(metric.support))
        );
        grid.appendChild(card);
    });
    return grid;
}

function sectionToMarkdown(section) {
    const chunks = [`## ${section.number}. ${section.title}`, "", safeText(section.summary)];

    if (Array.isArray(section.fields)) {
        section.fields.forEach((field) => {
            chunks.push("", `- **${field.label}:** ${safeText(field.description)}`);
            if (Array.isArray(field.examples) && field.examples.length) {
                field.examples.forEach((example) => chunks.push(`  - Example: ${example}`));
            }
        });
    }

    if (Array.isArray(section.cards)) {
        section.cards.forEach((card) => {
            chunks.push("", `- **${card.title}:** ${safeText(card.body)}`);
            if (card.meta) chunks.push(`  - ${card.meta}`);
        });
    }

    if (Array.isArray(section.list)) {
        chunks.push("");
        section.list.forEach((item) => chunks.push(`- ${item}`));
    }

    if (section.callout) {
        chunks.push("", `> ${section.callout}`);
    }

    if (section.secondaryCallout) {
        chunks.push("", `> ${section.secondaryCallout}`);
    }

    if (section.table) {
        chunks.push("", section.table.headers.join(" | "));
        chunks.push(section.table.headers.map(() => "---").join(" | "));
        (section.table.rows || []).forEach((row) => chunks.push(row.join(" | ")));
    }

    if (Array.isArray(section.metrics)) {
        chunks.push("");
        section.metrics.forEach((metric) => {
            chunks.push(`- **${metric.label}:** ${metric.value} (${metric.support})`);
        });
    }

    return chunks.join("\n").trim();
}

async function copyText(text, statusElement, doneMessage) {
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        if (statusElement) statusElement.textContent = doneMessage || "Copied.";
    } catch {
        if (statusElement) {
            statusElement.textContent = "Clipboard blocked. Use browser copy permissions and retry.";
        }
    }
}

function attachMenuToggle() {
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

function observeSections() {
    const links = Array.from(document.querySelectorAll(".toc-link"));
    if (!links.length) return;

    const map = new Map(links.map((link) => [link.getAttribute("href")?.slice(1), link]));
    const navLinks = Array.from(document.querySelectorAll(".top-nav-link"));

    const observer = new IntersectionObserver(
        (entries) => {
            const visible = entries
                .filter((entry) => entry.isIntersecting)
                .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
            if (!visible) return;

            const id = visible.target.id;
            links.forEach((link) => link.setAttribute("aria-current", "false"));
            const active = map.get(id);
            if (active) active.setAttribute("aria-current", "true");

            navLinks.forEach((link) => {
                const href = link.getAttribute("href") || "";
                const isActive = href.startsWith("#") && href.slice(1) === id;
                link.classList.toggle("active", isActive);
            });
        },
        {
            rootMargin: "-45% 0px -45% 0px",
            threshold: [0.2, 0.4, 0.7]
        }
    );

    document.querySelectorAll(".section-shell").forEach((section) => observer.observe(section));
}

function updateProgress(doneIds, total, progressFill, progressCount) {
    const ratio = total === 0 ? 0 : (doneIds.size / total) * 100;
    progressFill.style.width = `${ratio}%`;
    progressCount.textContent = `${doneIds.size} of ${total} sections marked complete`;
}

function syncStateUI(doneIds, sections) {
    sections.forEach((section) => {
        const shell = document.getElementById(section.id);
        const checkbox = document.getElementById(`done-${section.id}`);
        const stateDot = document.querySelector(`[data-state-dot="${section.id}"]`);
        const isDone = doneIds.has(section.id);
        if (shell) shell.dataset.state = isDone ? "done" : "todo";
        if (checkbox) checkbox.checked = isDone;
        if (stateDot) stateDot.classList.toggle("done", isDone);
    });
}

function buildPage(data) {
    const yearTarget = document.getElementById("year");
    if (yearTarget) yearTarget.textContent = String(new Date().getFullYear());

    const heroKicker = document.getElementById("hero-kicker");
    const heroTitle = document.getElementById("hero-title");
    const heroLead = document.getElementById("hero-lead");
    const heroFacts = document.getElementById("hero-facts");
    const templateTitle = document.getElementById("template-title");

    if (heroKicker) heroKicker.textContent = safeText(data.hero?.kicker);
    if (heroTitle) heroTitle.textContent = safeText(data.title);
    if (heroLead) heroLead.textContent = safeText(data.hero?.lead || data.subtitle);
    if (templateTitle) templateTitle.textContent = safeText(data.title);

    if (heroFacts && Array.isArray(data.hero?.facts)) {
        heroFacts.innerHTML = "";
        data.hero.facts.forEach((fact) => {
            const card = createElement("article", "field-card");
            const value = createElement("strong", null, safeText(fact.value));
            const label = createElement("span", null, safeText(fact.label));
            const support = createElement("p", null, safeText(fact.support));
            card.append(value, label, support);
            heroFacts.appendChild(card);
        });
    }

    const sectionsHost = document.getElementById("template-sections");
    const tocHost = document.getElementById("template-toc");
    const statusText = document.getElementById("export-status");
    const progressFill = document.getElementById("progress-fill");
    const progressCount = document.getElementById("progress-count");
    const usageHost = document.getElementById("usage-steps");
    const usageTitle = document.getElementById("usage-title");

    if (!sectionsHost || !tocHost || !progressFill || !progressCount) return;

    const sections = Array.isArray(data.sections) ? data.sections : [];
    const doneIds = getCompletionState();

    sectionsHost.innerHTML = "";
    tocHost.innerHTML = "";

    sections.forEach((section) => {
        const shell = createElement("article", "section-shell section-anchor");
        shell.id = section.id;
        shell.dataset.state = doneIds.has(section.id) ? "done" : "todo";
        shell.setAttribute("aria-labelledby", `title-${section.id}`);

        const header = createElement("header", "section-head");
        const titleWrap = createElement("div", "section-title-wrap");
        const eyebrow = createElement("p", "section-eyebrow", `Section ${section.number}`);
        const title = createElement("h2", "section-title");
        title.id = `title-${section.id}`;
        title.textContent = safeText(section.title);
        const desc = createElement("p", "section-description", safeText(section.summary));
        titleWrap.append(eyebrow, title, desc);

        const controls = createElement("div", "section-controls");
        const copyButton = createElement("button", "btn btn-subtle btn-sm", "Copy section");
        copyButton.type = "button";
        copyButton.addEventListener("click", () => {
            copyText(sectionToMarkdown(section), statusText, `Copied ${section.number}. ${section.title}`);
        });

        const doneWrap = createElement("label", "section-toggle");
        const doneCheck = document.createElement("input");
        doneCheck.type = "checkbox";
        doneCheck.id = `done-${section.id}`;
        doneCheck.checked = doneIds.has(section.id);
        doneCheck.addEventListener("change", () => {
            if (doneCheck.checked) doneIds.add(section.id);
            else doneIds.delete(section.id);
            saveCompletionState(doneIds);
            syncStateUI(doneIds, sections);
            updateProgress(doneIds, sections.length, progressFill, progressCount);
        });
        const doneText = createElement("span", null, "Ready");
        doneWrap.append(doneCheck, doneText);

        controls.append(copyButton, doneWrap);
        header.append(titleWrap, controls);
        shell.appendChild(header);

        const body = createElement("div", "section-body");

        if (Array.isArray(section.fields)) body.appendChild(renderFields(section.fields));
        if (Array.isArray(section.cards)) body.appendChild(renderCards(section.cards));
        if (Array.isArray(section.list) && section.list.length) body.appendChild(renderList(section.list));
        if (section.callout) body.appendChild(createElement("p", "callout", section.callout));
        if (section.secondaryCallout) {
            const secondary = createElement("p", "callout", section.secondaryCallout);
            body.appendChild(secondary);
        }
        if (section.table) body.appendChild(renderTable(section.table));
        if (Array.isArray(section.metrics)) body.appendChild(renderMetrics(section.metrics));

        shell.appendChild(body);
        sectionsHost.appendChild(shell);

        const tocItem = document.createElement("li");
        const tocLink = createElement("a", "toc-link");
        tocLink.href = `#${section.id}`;
        tocLink.setAttribute("aria-current", "false");
        tocLink.innerHTML = `<span class="toc-step">${section.number}</span><span>${section.title}</span><span class="toc-state ${doneIds.has(section.id) ? "done" : ""}" data-state-dot="${section.id}"></span>`;
        tocItem.appendChild(tocLink);
        tocHost.appendChild(tocItem);
    });

    if (usageHost && Array.isArray(data.usage?.steps)) {
        usageHost.innerHTML = "";
        data.usage.steps.forEach((step) => {
            const item = document.createElement("li");
            item.textContent = step;
            usageHost.appendChild(item);
        });
    }
    if (usageTitle && data.usage?.title) usageTitle.textContent = data.usage.title;

    syncStateUI(doneIds, sections);
    updateProgress(doneIds, sections.length, progressFill, progressCount);

    const markdownOutput = () => {
        const parts = [
            `# ${safeText(data.title)}`,
            "",
            safeText(data.subtitle),
            "",
            ...sections.flatMap((section) => [sectionToMarkdown(section), ""]),
            `## ${safeText(data.usage?.title)}`,
            "",
            ...(Array.isArray(data.usage?.steps)
                ? data.usage.steps.map((step, index) => `${index + 1}. ${step}`)
                : [])
        ];
        return parts.join("\n").trim();
    };

    const copyAll = document.getElementById("copy-all");
    const downloadAll = document.getElementById("download-all");

    copyAll?.addEventListener("click", () => {
        copyText(markdownOutput(), statusText, "Copied full template as Markdown.");
    });

    downloadAll?.addEventListener("click", () => {
        const blob = new Blob([markdownOutput()], { type: "text/markdown;charset=utf-8" });
        const href = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = "project-prd-template.md";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(href);
        if (statusText) statusText.textContent = "Downloaded project-prd-template.md";
    });

    observeSections();
}

async function init() {
    attachMenuToggle();

    try {
        const response = await fetch("/assets/data/prd-template.json", { cache: "no-store" });
        if (!response.ok) throw new Error("Failed to load template data.");
        const data = await response.json();
        buildPage(data);
    } catch (error) {
        const host = document.getElementById("template-sections");
        if (host) {
            host.innerHTML = `<article class="card"><p>Unable to load template data. ${error.message}</p></article>`;
        }
    }
}

init();
