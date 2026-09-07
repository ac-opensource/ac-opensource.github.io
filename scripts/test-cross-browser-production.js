const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium, firefox, webkit } = require("playwright");

const HOST = "127.0.0.1";
const DIST_ROOT = path.resolve(__dirname, "..", "dist");
const MIME_TYPES = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8"
};

const engines = [
  { name: "chromium", type: chromium },
  { name: "firefox", type: firefox },
  { name: "webkit", type: webkit }
];

const profiles = [
  {
    name: "desktop",
    viewport: { width: 1366, height: 900 },
    reducedMotion: "no-preference"
  },
  {
    name: "mobile-reduced-motion",
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce"
  }
];

function representativePostPath() {
  const manifestPath = path.join(DIST_ROOT, "blog", "posts.json");
  const preferredSlug = "case-study-bitcoin-wallet-multichain-android-systems";
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const published = Array.isArray(manifest) ? manifest.filter((post) => post?.slug) : [];
  const post = published.find(({ slug }) => slug === preferredSlug) || published[0];
  if (!post) throw new Error("dist/blog/posts.json does not contain a published post.");
  return `/blog/${encodeURIComponent(post.slug)}.html`;
}

function resolveRequestPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const withIndex = relativePath.endsWith("/") ? `${relativePath}index.html` : relativePath;
  const resolved = path.resolve(DIST_ROOT, withIndex);
  const relative = path.relative(DIST_ROOT, resolved);
  return relative.startsWith("..") || path.isAbsolute(relative) ? null : resolved;
}

function createStaticServer() {
  return http.createServer((request, response) => {
    if (!request.url || !["GET", "HEAD"].includes(request.method || "")) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }

    let filePath;
    try {
      filePath = resolveRequestPath(request.url);
    } catch (_error) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Bad request");
      return;
    }

    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const stat = fs.statSync(filePath);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": stat.size,
      "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(filePath).pipe(response);
  });
}

function visibleLinkSnapshot() {
  const isVisibleInViewport = (element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && Number.parseFloat(style.opacity) > 0
      && bounds.width > 0
      && bounds.height > 0
      && bounds.right > 0
      && bounds.left < innerWidth
      && bounds.bottom > 0
      && bounds.top < innerHeight;
  };
  const visibleLinks = (href) => Array.from(document.querySelectorAll(`a[href="${href}"]`))
    .filter(isVisibleInViewport)
    .map((link) => link.textContent.trim());

  return {
    contact: visibleLinks("/contact.html"),
    resume: visibleLinks("/resume.html")
  };
}

async function waitForRouteReady(page) {
  await page.waitForFunction(() => document.readyState === "complete", null, { timeout: 10000 });
  await page.waitForFunction(() => {
    const phase = document.documentElement.dataset.bigBang;
    return phase !== "pending" && phase !== "running" && phase !== "revealing";
  }, null, { timeout: 5000 });
  await page.waitForTimeout(150);
}

async function inspectRoute({ baseUrl, browserName, context, profile, route }) {
  const label = `${browserName}/${profile.name}/${route.name} (${route.path})`;
  const issues = [];
  const page = await context.newPage();

  page.on("pageerror", (error) => issues.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") issues.push(`console error: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(baseUrl)) {
      issues.push(`same-origin request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText || "unknown"})`);
    }
  });
  page.on("response", (response) => {
    if (response.url().startsWith(baseUrl) && response.status() >= 400) {
      issues.push(`same-origin response ${response.status()}: ${response.url()}`);
    }
  });

  try {
    const response = await page.goto(`${baseUrl}${route.path}`, {
      timeout: 20000,
      waitUntil: "domcontentloaded"
    });
    if (!response || !response.ok()) {
      issues.push(`navigation returned ${response ? response.status() : "no response"}`);
    }

    await waitForRouteReady(page);

    const snapshot = await page.evaluate(async () => {
      const main = document.querySelector("main");
      const heading = document.querySelector("h1");
      const headingStyle = heading ? getComputedStyle(heading) : null;
      const headingBounds = heading?.getBoundingClientRect();
      const activeAnimations = document.getAnimations({ subtree: true })
        .filter((animation) => animation.playState === "running")
        .map((animation) => {
          const timing = animation.effect?.getComputedTiming();
          return {
            duration: timing?.duration,
            name: animation.animationName || "unnamed",
            target: animation.effect?.target?.className || animation.effect?.target?.tagName || "unknown"
          };
        });
      const initialScrollX = scrollX;
      const initialScrollY = scrollY;
      scrollTo(100000, initialScrollY);
      await new Promise(requestAnimationFrame);
      const maxHorizontalScroll = scrollX;
      scrollTo(initialScrollX, initialScrollY);

      return {
        activeAnimations,
        bigBangOverlayCount: document.querySelectorAll("[data-big-bang-loader]").length,
        bigBangState: document.documentElement.dataset.bigBang || "inactive",
        documentTitle: document.title.trim(),
        headingText: heading?.textContent.trim() || "",
        headingVisible: Boolean(
          headingStyle
          && headingBounds
          && headingStyle.display !== "none"
          && headingStyle.visibility !== "hidden"
          && Number.parseFloat(headingStyle.opacity) > 0
          && headingBounds.width > 0
          && headingBounds.height > 0
        ),
        mainCount: document.querySelectorAll("main").length,
        mainTextLength: main?.textContent.trim().length || 0,
        maxHorizontalScroll,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        reducedMotionMatches: matchMedia("(prefers-reduced-motion: reduce)").matches,
        rootScrollBehavior: getComputedStyle(document.documentElement).scrollBehavior
      };
    });

    if (!snapshot.documentTitle) issues.push("document title is empty");
    if (snapshot.mainCount !== 1) issues.push(`expected one main landmark, found ${snapshot.mainCount}`);
    if (snapshot.mainTextLength < 40) issues.push(`main landmark has only ${snapshot.mainTextLength} characters`);
    if (!snapshot.headingText) issues.push("H1 is missing or empty");
    if (!snapshot.headingVisible) issues.push("H1 is not visibly rendered");
    if (snapshot.maxHorizontalScroll > 1) {
      issues.push(`horizontal overflow is ${snapshot.overflow}px (scrollable to ${snapshot.maxHorizontalScroll}px)`);
    }

    if (route.name === "case-study") {
      const caseStudyHero = await page.evaluate(() => {
        const title = document.querySelector("#post-title")?.getBoundingClientRect();
        const hero = document.querySelector(".work-post-hero")?.getBoundingClientRect();
        return {
          hero: hero && { bottom: hero.bottom, height: hero.height, top: hero.top },
          title: title && { bottom: title.bottom, height: title.height, top: title.top },
          viewportHeight: innerHeight
        };
      });
      if (!caseStudyHero.title || caseStudyHero.title.height > caseStudyHero.viewportHeight * 0.6) {
        issues.push(`case-study title overwhelms the first screen: ${JSON.stringify(caseStudyHero)}`);
      }
      if (!caseStudyHero.hero || caseStudyHero.hero.top >= caseStudyHero.viewportHeight) {
        issues.push(`case-study product proof begins below the first screen: ${JSON.stringify(caseStudyHero)}`);
      }
    }

    const routeLinks = await page.evaluate(visibleLinkSnapshot);
    if (routeLinks.resume.length === 0) issues.push("no visible in-viewport Resume link");
    if (routeLinks.contact.length === 0) issues.push("no visible in-viewport Contact link");

    if (profile.reducedMotion === "reduce") {
      if (!snapshot.reducedMotionMatches) issues.push("prefers-reduced-motion did not match");
      if (snapshot.rootScrollBehavior !== "auto") {
        issues.push(`reduced-motion root scroll behavior is ${snapshot.rootScrollBehavior}`);
      }
      if (snapshot.activeAnimations.length > 0) {
        issues.push(`reduced-motion left active animations: ${JSON.stringify(snapshot.activeAnimations)}`);
      }
      if (route.path === "/work.html" && (
        snapshot.bigBangOverlayCount !== 0
        || ["pending", "running", "revealing"].includes(snapshot.bigBangState)
      )) {
        issues.push(`reduced-motion activated Big Bang loader (${snapshot.bigBangState})`);
      }
    }

    if (route.kind === "contact") {
      const contact = await page.evaluate(() => ({
        emailField: document.querySelectorAll("#contact-email[type='email']").length,
        form: document.querySelectorAll("#contact-form").length,
        mailto: document.querySelectorAll("a[href^='mailto:']").length,
        nameField: document.querySelectorAll("#contact-name").length
      }));
      if (contact.form !== 1 || contact.nameField !== 1 || contact.emailField !== 1 || contact.mailto < 1) {
        issues.push(`contact actions are incomplete: ${JSON.stringify(contact)}`);
      }
    }

    if (route.kind === "resume") {
      const resume = await page.evaluate(async () => {
        const link = document.querySelector("a[href='/resume_concepcion_andrew.pdf']");
        if (!link) return { link: false, status: 0, type: "" };
        const response = await fetch(link.getAttribute("href"), { cache: "no-store" });
        const bytes = (await response.arrayBuffer()).byteLength;
        return {
          bytes,
          link: true,
          status: response.status,
          type: response.headers.get("content-type") || ""
        };
      });
      if (!resume.link || resume.status !== 200 || !resume.type.startsWith("application/pdf") || resume.bytes < 1000) {
        issues.push(`resume PDF is not reachable: ${JSON.stringify(resume)}`);
      }
    }
  } catch (error) {
    issues.push(`inspection failed: ${error.message}`);
  } finally {
    await page.close();
  }

  return issues.map((issue) => `${label}: ${issue}`);
}

async function main() {
  const requiredFiles = [
    path.join(DIST_ROOT, "index.html"),
    path.join(DIST_ROOT, "blog", "posts.json")
  ];
  for (const requiredFile of requiredFiles) {
    if (!fs.existsSync(requiredFile)) {
      throw new Error(`Missing ${path.relative(path.dirname(DIST_ROOT), requiredFile)}. Run npm run build first.`);
    }
  }

  const routes = [
    { path: "/", name: "home" },
    { path: "/work.html", name: "work" },
    { path: "/about.html", name: "about" },
    { path: "/blog/", name: "logs" },
    { path: representativePostPath(), name: "case-study" },
    { path: "/contact.html", name: "contact", kind: "contact" },
    { path: "/resume.html", name: "resume", kind: "resume" }
  ];

  const server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  if (!port) throw new Error("Cross-browser server did not allocate a port.");
  const baseUrl = `http://${HOST}:${port}`;
  const failures = [];

  try {
    for (const engine of engines) {
      const browser = await engine.type.launch({ headless: true });
      try {
        for (const profile of profiles) {
          const context = await browser.newContext({
            reducedMotion: profile.reducedMotion,
            viewport: profile.viewport
          });
          try {
            for (const route of routes) {
              failures.push(...await inspectRoute({
                baseUrl,
                browserName: engine.name,
                context,
                profile,
                route
              }));
            }
          } finally {
            await context.close();
          }
          console.log(`  ${engine.name} / ${profile.name}: ${routes.length} routes checked`);
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  if (failures.length > 0) {
    throw new Error(`Cross-browser production smoke failed:\n- ${failures.join("\n- ")}`);
  }

  const routeChecks = engines.length * profiles.length * routes.length;
  console.log(
    `Cross-browser production smoke passed: ${engines.length} engines × ${profiles.length} profiles × ${routes.length} routes = ${routeChecks} route checks.`
  );
  console.log("Verified runtime errors, landmarks, navigation reachability, overflow, Resume/Contact actions, and reduced motion.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
