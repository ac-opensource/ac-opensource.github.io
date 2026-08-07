(() => {
  "use strict";

  const posts = [
  {
    "slug": "2026-08-06-how-i-rebuilt-my-homepage-as-an-interactive-orbital-system",
    "title": "Rebuilding My Homepage as an Interactive Orbital System",
    "summary": "I’m not a web developer, but with Codex I turned a static portfolio into a working orbital interface—and spent more time shaping the product than wrestling with syntax.",
    "category": "technical",
    "date": "2026-08-06",
    "readingTime": "7 min read",
    "topics": [
      "accessibility",
      "ai-workflow",
      "cross-disciplinary-engineering",
      "product-engineering",
      "quality-engineering",
      "ux",
      "web-animation"
    ]
  },
  {
    "slug": "2026-07-22-its-not-okay-to-stay-not-okay",
    "title": "It’s Not Okay to Not Be Okay",
    "summary": "We have become fluent in naming what hurts. But awareness can become another form of avoidance when it never turns into care, accountability, or action.",
    "category": "reflection",
    "date": "2026-07-22",
    "readingTime": "8 min read",
    "topics": [
      "Cultural Critique",
      "Mental Health",
      "Personal Responsibility",
      "Self-Awareness"
    ]
  },
  {
    "slug": "2026-07-22-the-fortress-we-mistake-for-home",
    "title": "The Fortress We Mistake for Home",
    "summary": "A reflection on the defenses we build from old wounds, pride, and habit—and why real change begins when we stop guarding what keeps us trapped.",
    "category": "reflection",
    "date": "2026-07-22",
    "readingTime": "6 min read",
    "topics": [
      "Accountability",
      "Healing",
      "Personal Growth",
      "Self-Awareness"
    ]
  },
  {
    "slug": "2026-07-21-what-building-persons-finder-taught-me",
    "title": "What Building a Small Backend Taught Me About AI-Ready Engineering",
    "summary": "Lessons from a compact backend: explicit API contracts, append-only location history, PostGIS semantics, guarded AI prose, and evidence-based verification.",
    "category": "technical",
    "date": "2026-07-21",
    "readingTime": "8 min read",
    "topics": [
      "ai-engineering",
      "backend",
      "kotlin",
      "postgis",
      "privacy",
      "spring-boot",
      "systems-design",
      "testing"
    ]
  },
  {
    "slug": "2026-04-30-agents-that-leave-receipts",
    "title": "Agents That Leave Receipts",
    "summary": "A practical reflection on local agents, memory, verification, and the handoffs that let the next run trust what happened.",
    "category": "technical",
    "date": "2026-04-30",
    "readingTime": "7 min read",
    "topics": [
      "ai-workflow",
      "android",
      "delivery",
      "engineering-discipline",
      "local-agents",
      "memory-systems"
    ]
  },
  {
    "slug": "2026-04-09-how-i-use-mempalace-with-local-agents",
    "title": "How I Use MemPalace to Make Local Agents Better",
    "summary": "How I set up MemPalace as a practical tool for local agents: small taxonomy, verify-first retrieval, agent diaries, AAAK wake-up context, and why protocol matters more than storage.",
    "category": "technical",
    "date": "2026-04-09",
    "readingTime": "7 min read",
    "topics": [
      "ai-workflow",
      "local-agents",
      "mcp",
      "memory-systems",
      "mempalace"
    ]
  },
  {
    "slug": "2026-04-07-one-rust-core-across-android-and-ios",
    "title": "Deep Dive: One Rust Core Across Android and iOS",
    "summary": "How a Rust facade, UniFFI bindings, and platform packaging can give Android and iOS one domain core without duplicating behavior.",
    "category": "technical",
    "date": "2026-04-07",
    "readingTime": "8 min read",
    "topics": [
      "android",
      "architecture",
      "ffi",
      "ios",
      "mobile",
      "rust",
      "uniffi"
    ]
  },
  {
    "slug": "2026-03-26-career-trajectory-platform-ownership",
    "title": "Career Growth as Ownership, Not Just Job Titles",
    "summary": "A practical framework for reading engineering growth through scope, decision quality, operational responsibility, and durable outcomes.",
    "category": "technical",
    "date": "2026-03-26",
    "readingTime": "3 min read",
    "topics": [
      "career",
      "delivery",
      "engineering-growth",
      "leadership",
      "platform-ownership"
    ]
  },
  {
    "slug": "2026-03-26-cognitive-profile-deep-dive",
    "title": "Using Emergenetics and Harrison as Calibration Tools",
    "summary": "How I use two assessment profiles as prompts for better decisions and communication—without treating their scores as identity or proof of ability.",
    "category": "reflection",
    "date": "2026-03-26",
    "readingTime": "3 min read",
    "topics": [
      "emergenetics",
      "harrison",
      "leadership",
      "paradox",
      "self-awareness"
    ]
  },
  {
    "slug": "2026-03-26-e2e-and-visual-qa-for-personal-websites",
    "title": "End-to-End and Visual QA for Personal Websites",
    "summary": "A practical quality loop for static personal sites: verify the publication boundary, exercise critical routes, and review desktop and mobile rendering.",
    "category": "technical",
    "date": "2026-03-26",
    "readingTime": "3 min read",
    "topics": [
      "e2e",
      "frontend",
      "playwright",
      "qa",
      "quality"
    ]
  },
  {
    "slug": "2026-03-26-editable-blog-system-on-github-pages",
    "title": "Building an Editable Blog That Still Works on GitHub Pages",
    "summary": "How SQLite authoring, deterministic static generation, and a public-only build artifact create an editable blog without shipping a runtime database.",
    "category": "technical",
    "date": "2026-03-26",
    "readingTime": "3 min read",
    "topics": [
      "content-system",
      "github-pages",
      "seo",
      "site-architecture",
      "sqlite"
    ]
  },
  {
    "slug": "2026-03-26-from-mobile-developer-to-ai-accelerated-engineer",
    "title": "From Mobile Developer to AI-Accelerated Engineer",
    "summary": "How agentic tools widened my engineering workflow without replacing mobile depth, explicit ownership, or evidence-based delivery.",
    "category": "technical",
    "date": "2026-03-26",
    "readingTime": "3 min read",
    "topics": [
      "ai-workflow",
      "delivery",
      "engineering",
      "scope",
      "systems-thinking"
    ]
  },
  {
    "slug": "2026-03-26-prompt-patterns-for-production-ready-code",
    "title": "Prompt Patterns for Reviewable, Production-Ready Code",
    "summary": "A practical prompt structure for coding agents: live context, real constraints, side-effect boundaries, observable acceptance evidence, and reproducible handoffs.",
    "category": "technical",
    "date": "2026-03-26",
    "readingTime": "3 min read",
    "topics": [
      "ai-workflow",
      "delivery",
      "engineering",
      "prompting",
      "quality"
    ]
  },
  {
    "slug": "2024-10-08-running-ai-fleet-learnings",
    "title": "Running an Agent Fleet Without Losing the Plot",
    "summary": "Lessons from multi-agent engineering work: define output contracts, instrument repeated effort, match verification to risk, and preserve trustworthy handoffs.",
    "category": "technical",
    "date": "2025-09-28",
    "readingTime": "4 min read",
    "topics": [
      "AI Ops",
      "Prompt Engineering",
      "Team Process"
    ]
  },
  {
    "slug": "2024-11-02-sunrise-trail-runs",
    "title": "A Month in New Zealand",
    "summary": "Family holidays in Auckland, a compressed South Island road trip, and the surprise of catching the Aurora Australis.",
    "category": "hobby",
    "date": "2025-02-05",
    "readingTime": "4 min read",
    "topics": [
      "Family",
      "Reflection",
      "Travel"
    ]
  },
  {
    "slug": "case-study-mystc-scale-and-reliability",
    "title": "MySTC: Leading a Five-Person Android Team",
    "summary": "I led five senior Android engineers on MySTC, working in Kotlin and Java across account, ordering, support, and multilingual flows.",
    "category": "work",
    "date": "2025-02-05",
    "readingTime": "2 min read",
    "topics": [
      "Android",
      "Kotlin",
      "MySTC",
      "Telecom"
    ]
  },
  {
    "slug": "2024-11-21-quiet-systems-reflection",
    "title": "Quiet Systems: Reflection Rituals for Builders",
    "summary": "A personal essay about designing focus blocks, protecting rest, and keeping philosophy close to the shipping calendar.",
    "category": "reflection",
    "date": "2024-11-21",
    "readingTime": "2 min read",
    "topics": [
      "Creative Process",
      "Philosophy"
    ]
  },
  {
    "slug": "case-study-ocbc-banking-experience",
    "title": "OCBC Business: Android Banking Work",
    "summary": "I worked on OCBC Business for Android in Kotlin and XML, covering chart UI, identity-verification integration, network behavior, and focused unit tests.",
    "category": "work",
    "date": "2024-11-20",
    "readingTime": "1 min read",
    "topics": [
      "Android",
      "Fintech",
      "Kotlin",
      "OCBC"
    ]
  },
  {
    "slug": "2024-09-14-film-photography-gallery",
    "title": "Weekend Photo Experiments: Paradise Mist, Dobsonian Moon, and Lake Pukaki",
    "summary": "Three frames from one trip, one ongoing experiment: motion, moon detail, and mountain light across different gear and shooting constraints.",
    "category": "hobby",
    "date": "2024-09-14",
    "readingTime": "2 min read",
    "topics": [
      "Photography"
    ]
  },
  {
    "slug": "case-study-openpay-bnpl-experience",
    "title": "openpay: Checkout, Spend Limits, and Release Edges",
    "summary": "I worked on openpay's Android purchase flow, including spend-limit cards, merchant content, checkout state, and partner-dependent payment paths.",
    "category": "work",
    "date": "2024-09-01",
    "readingTime": "1 min read",
    "topics": [
      "Android",
      "BNPL",
      "Checkout",
      "Fintech",
      "openpay"
    ]
  },
  {
    "slug": "case-study-solo-whitelabel-delivery-platform",
    "title": "Solo: Android Across a White-Label Food Platform",
    "summary": "I worked in Solo's shared Kotlin and XML codebase, shipping Android features and production fixes used by multiple restaurant-branded apps.",
    "category": "work",
    "date": "2024-08-10",
    "readingTime": "2 min read",
    "topics": [
      "Android",
      "Food Delivery",
      "Solo",
      "Whitelabel"
    ]
  },
  {
    "slug": "case-study-owto-ride-hailing-platform",
    "title": "OWTO: Android, iOS, and the Backend Between Them",
    "summary": "I led delivery across OWTO's Android, iOS, and backend work and stayed hands-on with booking, GPS, payments, and the APIs connecting them.",
    "category": "work",
    "date": "2024-06-15",
    "readingTime": "2 min read",
    "topics": [
      "Android",
      "Backend",
      "Mobility",
      "OWTO",
      "iOS"
    ]
  },
  {
    "slug": "2024-05-22-building-with-kotlin-and-swift",
    "title": "Building Across Kotlin and Swift Without Blurring Platform Boundaries",
    "summary": "A practical way to divide shared domain behavior, state, packaging, and native UI responsibilities across Kotlin and Swift.",
    "category": "technical",
    "date": "2024-05-22",
    "readingTime": "3 min read",
    "topics": [
      "KMP",
      "SwiftUI"
    ]
  },
  {
    "slug": "case-study-popslide-engagement-and-monetization",
    "title": "Popslide: Experiments on a Lockscreen Product",
    "summary": "I built and evaluated Android experiment variants for Popslide and worked on lockscreen behavior, notifications, caching, and production state handling.",
    "category": "work",
    "date": "2023-11-30",
    "readingTime": "2 min read",
    "topics": [
      "Adtech",
      "Android",
      "Experimentation",
      "Popslide"
    ]
  },
  {
    "slug": "case-study-websafety-parental-controls",
    "title": "WebSafety: Parental Controls Meet Platform Limits",
    "summary": "I worked on WebSafety features across Java and Objective-C code, including GPS, synchronization, permissions, and platform behavior that wasn't always documented.",
    "category": "work",
    "date": "2023-06-22",
    "readingTime": "2 min read",
    "topics": [
      "Android",
      "Parental Controls",
      "Security",
      "WebSafety"
    ]
  },
  {
    "slug": "case-study-projectbass-crowdsourced-network-mapping",
    "title": "ProjectBASS: Crowdsourced Network Measurements",
    "summary": "I contributed Kotlin feature and maintenance work to ProjectBASS, an open-source Android app for collecting volunteer network measurements.",
    "category": "work",
    "date": "2022-10-05",
    "readingTime": "1 min read",
    "topics": [
      "Kotlin",
      "Network Mapping",
      "Open Source",
      "ProjectBASS"
    ]
  }
];
  window.AC_LOG_POSTS = Object.freeze(posts.map((post) => Object.freeze({
    ...post,
    topics: Object.freeze([...post.topics])
  })));
})();
