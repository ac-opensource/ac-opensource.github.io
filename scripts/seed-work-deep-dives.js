const {
  openDatabase,
  ensureSchema,
  upsertPost
} = require("./lib/blog-db");

const POSTS = [
  {
    slug: "case-study-mystc-scale-and-reliability",
    title: "MySTC: Leading a Five-Person Android Team",
    published_date: "2025-02-05",
    reading_time: "2 min read",
    category: "work",
    topics: ["MySTC", "Android", "Kotlin", "Telecom"],
    summary:
      "I led five senior Android engineers on MySTC, working in Kotlin and Java across account, ordering, support, and multilingual flows.",
    hero_image: "/assets/images/work/img_mystc_app.png",
    hero_alt: "MySTC mobile app screenshot",
    hero_caption: "MySTC production app",
    body_html: `
      <h2>Five engineers, one busy Android app</h2>
      <p>I led a team of five senior Android engineers on MySTC. This was an established telecom app with account management, ordering, and support journeys already in production. We extended it while customers were using it.</p>
      <p>The Android code mixed Kotlin and Java and followed MVVM patterns. Firebase integrations were part of the stack, and some flows used SQLite-backed local data. A feature could touch an older Java class, a newer Kotlin module, a remote response, cached state, and translated layouts in the same change.</p>
      <h2>What the lead role looked like day to day</h2>
      <p>A lot of my time went into splitting work so five experienced engineers could move in parallel without inventing five versions of the same solution. I reviewed implementation boundaries, unblocked people when a dependency crossed teams, and stayed hands-on with performance and stability work.</p>
      <p>Multilingual behavior and unreliable connections were regular acceptance concerns. I checked that a change still made sense when text expanded or changed direction, and that the screen did something understandable when fresh data wasn't available. Those checks were part of the feature, not cleanup after it.</p>
      <p>The role combined technical leadership with hands-on delivery. I kept five experienced engineers aligned on the same architecture and release path while continuing to ship Android work alongside them.</p>
    `
  },
  {
    slug: "case-study-ocbc-banking-experience",
    title: "OCBC: Android Work in a Banking App",
    published_date: "2024-11-20",
    reading_time: "2 min read",
    category: "work",
    topics: ["OCBC", "Fintech", "Android", "Kotlin"],
    summary:
      "I worked on OCBC's Android app in Kotlin and XML, including chart UI, identity-verification integration, network behavior, and focused unit coverage.",
    hero_image: "/assets/images/work/img_ocbc_app.png",
    hero_alt: "OCBC mobile app screenshot",
    hero_caption: "OCBC production app",
    body_html: `
      <h2>The parts I touched</h2>
      <p>I worked on OCBC's Android app in Kotlin and XML. My scope included custom chart behavior, identity-verification integration, selected account-facing UI, and third-party SDK work.</p>
      <p>Identity verification was more than dropping an SDK into a screen. I had to account for its callbacks and lifecycle transitions within the bank's existing navigation and state. I also worked through concurrency and network-call issues where the order of responses could affect what the app displayed.</p>
      <p>I added or improved unit coverage around behavior that could be tested away from the UI. When a module made a feature hard to change, I reduced coupling in that area so the next change was easier to isolate and review.</p>
      <h2>Working inside an established product</h2>
      <p>Some of the UI was being modernized, but it still had to fit the conventions and release process of the existing app. That mattered most around identity and account state, where consistency was more valuable than introducing a second pattern.</p>
      <p>I shipped those Android features and integrations through the bank's existing release process, with tests around behavior that would have been difficult to verify from the screen alone.</p>
    `
  },
  {
    slug: "case-study-openpay-bnpl-experience",
    title: "openpay: Checkout, Spend Limits, and Release Edges",
    published_date: "2024-09-01",
    reading_time: "2 min read",
    category: "work",
    topics: ["openpay", "Fintech", "BNPL", "Android", "Checkout"],
    summary:
      "I worked on openpay's Android purchase flow, including spend-limit cards, merchant content, checkout state, and partner-dependent payment paths.",
    hero_image: "/assets/images/work/img_openpay_app.webp",
    hero_alt: "openpay app interface showing spend limits and merchant discovery cards",
    hero_caption: "openpay purchase experience",
    body_html: `
      <h2>Spend limits weren't just decoration</h2>
      <p>I worked on openpay's Android purchase journey. The visible pieces included spend-limit cards, merchant discovery content, and payment confirmation. The less visible work was making those screens agree about what was happening when data arrived late or a partner service returned something unexpected.</p>
      <p>Merchant screens carried a lot of content, so I worked on UI responsiveness in the home and merchant areas. I also refined loading and completion behavior so the app did not advance a payment step before it had a result.</p>
      <h2>The edges of checkout</h2>
      <p>Parts of checkout depended on systems outside the Android app. During release preparation I traced edge cases at those boundaries and tightened how the app represented partner responses, loading states, completion, and failure.</p>
      <p>I also worked on the layout and interaction details around the purchase flow. Those changes were small in code compared with an integration, but they were the part a customer saw first.</p>
      <p>My work covered the Android path from merchant discovery and available spend through checkout and confirmation, including the partner-response states between those screens.</p>
    `
  },
  {
    slug: "case-study-solo-whitelabel-delivery-platform",
    title: "Solo: Android Across a White-Label Food Platform",
    published_date: "2024-08-10",
    reading_time: "2 min read",
    category: "work",
    topics: ["Solo", "Food Delivery", "Android", "Whitelabel"],
    summary:
      "I worked in Solo's shared Kotlin and XML codebase, shipping Android features and production fixes used by multiple restaurant-branded apps.",
    hero_image: "/assets/images/work/img_solo_app.png",
    hero_alt: "Solo food delivery app screenshot",
    hero_caption: "Solo whitelabel app family",
    body_html: `
      <h2>It wasn't one restaurant app</h2>
      <p>Solo supplied a white-label food-ordering platform used by multiple restaurant brands. I worked in the shared Android codebase, which used Kotlin, XML layouts, and Retrofit for API calls. Brand identity and some behavior varied, but a lot of the ordering experience came from the same underlying implementation.</p>
      <p>That made a normal production fix less local than it first appeared. Before changing shared code, I had to trace whether the problem came from the base implementation, a brand configuration, or an API assumption. A condition added for the app in front of me could quietly become behavior for several other apps.</p>
      <h2>How I handled changes</h2>
      <p>I added Android features and fixed production issues in the shared codebase. I traced each change through the ordering and API paths, then kept it in the narrowest layer that owned the behavior. Where brand-specific behavior was already configurable, I used that mechanism instead of creating another one.</p>
      <p>Some modules were old and shared broadly, so a small, reviewable change was often safer than a wide migration. That mattered when one code path could affect several branded builds.</p>
      <p>The <a href="https://play.google.com/store/apps/developer?id=Solo+Technologies+Services&amp;hl=en">public developer catalogue</a> shows the breadth of the product family. My work sat in the shared Android platform behind those variants, where one feature or production fix had to behave across more than one restaurant brand.</p>
    `
  },
  {
    slug: "case-study-owto-ride-hailing-platform",
    title: "OWTO: Android, iOS, and the Backend Between Them",
    published_date: "2024-06-15",
    reading_time: "2 min read",
    category: "work",
    topics: ["OWTO", "Mobility", "Android", "iOS", "Backend"],
    summary:
      "I led delivery across OWTO's Android, iOS, and backend work and stayed hands-on with booking, GPS, payments, and the APIs connecting them.",
    hero_image: "/assets/images/work/img_owto_app.png",
    hero_alt: "OWTO ride-hailing app screenshot",
    hero_caption: "OWTO app booking flow",
    body_html: `
      <h2>I could follow one booking through the whole system</h2>
      <p>At OWTO I led delivery across the native Android and iOS apps and backend work. I was also hands-on. The clients used Kotlin and Swift, the backend used Node.js with Postgres, Firebase supported operational pieces, and the mobile architecture drew from Uber RIBs.</p>
      <p>A booking didn't belong to one screen or even one repository. The rider's location changed, the network dropped in and out, payment had its own result, and the server remained the shared source for both apps. When those states disagreed, the symptom often appeared on mobile even when the cause sat elsewhere.</p>
      <p>I worked on booking-path changes, GPS behavior, payment handling, and API contracts. Because my scope crossed the clients and backend, I could trace a problem past the first failing UI. If the contract was missing a state the apps needed, I could work on the contract instead of teaching Android and iOS to guess in different ways.</p>
      <p>The lead role also meant sequencing changes across people. A client release couldn't safely depend on an API behavior that wasn't deployed, and a backend change wasn't complete if neither native app could represent its new state. I planned those as one piece of delivery rather than separate tickets that happened to share a feature name.</p>
      <p>That cross-platform scope meant I could take a booking issue from its first mobile symptom through client state, API contract, and backend behavior, then plan the release across all three.</p>
    `
  },
  {
    slug: "case-study-popslide-engagement-and-monetization",
    title: "Popslide: Experiments on a Lockscreen Product",
    published_date: "2023-11-30",
    reading_time: "2 min read",
    category: "work",
    topics: ["Popslide", "Adtech", "Android", "Experimentation"],
    summary:
      "I built and evaluated Android experiment variants for Popslide and worked on lockscreen behavior, notifications, caching, and production state handling.",
    hero_image: "/assets/images/work/img_popslide_app.png",
    hero_alt: "Popslide app screenshot",
    hero_caption: "Popslide lockscreen and rewards experience",
    body_html: `
      <h2>The lockscreen changed the standard</h2>
      <p>Popslide mixed rewards, ads, and task-based interactions in an Android product that could appear on the lockscreen. I worked with Kotlin, lockscreen integration, notifications, Flux-style state, and Firebase services. Changes in this part of an app are hard to ignore because they sit outside the usual open-app-and-browse flow.</p>
      <p>I implemented A/B test variants and supported their rollout. I also worked on caching and notification behavior, where stale state or a repeated event could show up immediately. A variant had to coexist with the control path and with the Android lifecycle; it couldn't be treated as a completely separate demo screen.</p>
      <h2>An experiment left code behind</h2>
      <p>Part of my work was keeping rollouts reversible and refactoring fragile areas when they blocked the next change. After a test, the unused branch needed to be removed or deliberately retained. Otherwise temporary experiment code became another permanent path that future work had to understand.</p>
      <p>I kept changes close to the feature being shipped, cleaned up obsolete branches after experiments, and made the existing notification and lockscreen paths easier to follow.</p>
      <p>My work centered on Android experiment variants, rollout support, notifications, caching, and the cleanup needed to keep the next test from inheriting old behavior.</p>
    `
  },
  {
    slug: "case-study-websafety-parental-controls",
    title: "WebSafety: Parental Controls Meet Platform Limits",
    published_date: "2023-06-22",
    reading_time: "2 min read",
    category: "work",
    topics: ["WebSafety", "Security", "Parental Controls", "Android"],
    summary:
      "I worked on WebSafety features across Java and Objective-C code, including GPS, synchronization, permissions, and platform behavior that wasn't always documented.",
    hero_image: "/assets/images/work/img_websafety_app.jpg",
    hero_alt: "WebSafety app screenshot",
    hero_caption: "WebSafety monitoring dashboard",
    body_html: `
      <h2>The operating system got a vote</h2>
      <p>WebSafety was a parental-control product, so the requested behavior often ran into rules set by Android or iOS. I worked across Java and Objective-C code with backend dependencies that included AWS S3 and Elasticsearch. Some platform behavior was poorly documented, and some things a parent might reasonably ask for were simply restricted.</p>
      <p>I tested those cases against actual platform behavior. My work included GPS and synchronization paths, security-focused features, and permission-sensitive behavior. Background execution, delayed network access, and device-state changes all affected whether fresh information was available. The backend could only work with data the device was permitted to collect and upload.</p>
      <p>When an API behaved differently across versions, I had to establish what was actually repeatable before building product behavior on top of it. Sometimes that led to a supported implementation. Sometimes it meant a narrower feature or a fallback that admitted the data was unavailable.</p>
      <h2>Designing around platform limits</h2>
      <p>Android and iOS deliberately limit how much control one app can have over a device. I treated those boundaries as part of the product design.</p>
      <p>My work covered version-sensitive platform behavior, selected security-sensitive flows, and GPS and synchronization across changing device states. Permission handling and transparent degraded states were as important as the happy path.</p>
    `
  },
  {
    slug: "case-study-projectbass-crowdsourced-network-mapping",
    title: "ProjectBASS: Crowdsourced Network Measurements",
    published_date: "2022-10-05",
    reading_time: "2 min read",
    category: "work",
    topics: ["ProjectBASS", "Open Source", "Network Mapping", "Kotlin"],
    summary:
      "I contributed Kotlin feature and maintenance work to ProjectBASS, an open-source Android app for collecting volunteer network measurements.",
    hero_image: "/assets/images/work/img_projectbass_app.png",
    hero_alt: "ProjectBASS app screenshot",
    hero_caption: "ProjectBASS map visualization",
    body_html: `
      <h2>A map point came from a real phone</h2>
      <p>ProjectBASS was an open-source Android project built by volunteers. The app collected network measurements from phones and sent them through a Retrofit layer for aggregation. Different devices, carriers, locations, and radio conditions meant the input was never as tidy as the final map could look.</p>
      <p>I contributed Kotlin feature work and maintenance support in the public codebase, including network integration and discussions about which device measurements were useful to the community.</p>
      <h2>Small changes, shared data</h2>
      <p>This was volunteer software, so reviewable changes mattered. I followed the existing collection and API paths, changed the part connected to the issue, and left enough context for another contributor to understand what moved.</p>
      <p>The data also needed a careful boundary. A single measurement described one phone at one time. It did not prove that a whole neighbourhood or carrier always performed the same way. I kept device and carrier variation in mind when reasoning about what the client should collect and send.</p>
      <p>The work combined Android maintenance with a simple data principle: each point represented one phone at one moment, so the client had to collect and describe it carefully.</p>
    `
  }
];

function main() {
  const { db, dbPath } = openDatabase(process.env.BLOG_DB_PATH);

  try {
    ensureSchema(db);
    POSTS.forEach((post) => {
      upsertPost(db, {
        ...post,
        author: "Andrew Concepcion",
        status: "published"
      });
    });
    console.log(`Seeded ${POSTS.length} work deep-dive posts into ${dbPath}`);
  } finally {
    db.close();
  }
}

main();
