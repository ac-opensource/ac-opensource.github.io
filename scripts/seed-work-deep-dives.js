const {
  openDatabase,
  ensureSchema,
  upsertPost
} = require("./lib/blog-db");

const POSTS = [
  {
    slug: "case-study-mystc-scale-and-reliability",
    title: "Case Study: MySTC at Telecom Scale",
    published_date: "2025-02-05",
    reading_time: "9 min read",
    category: "work",
    topics: ["MySTC", "Android", "Kotlin", "Telecom"],
    summary:
      "How we delivered high-traffic telecom account flows with tighter performance budgets, multi-language support, and predictable release execution.",
    hero_image: "/assets/images/work/img_mystc_app.png",
    hero_alt: "MySTC mobile app screenshot",
    hero_caption: "MySTC production app",
    body_html: `
      <h2>Context</h2>
      <p>MySTC serves core customer journeys at telecom scale. The app had to support account lifecycle operations, ordering flows, and support workflows while keeping interaction latency stable on mid-range devices.</p>
      <h2>Stack</h2>
      <ul>
        <li>Kotlin, Java, MVVM</li>
        <li>Firebase for operational integrations</li>
        <li>SQLite-backed offline pathways for selected flows</li>
      </ul>
      <h2>Key Challenges</h2>
      <ul>
        <li>Data synchronization across volatile network conditions</li>
        <li>Multi-language parity and layout resilience</li>
      </ul>
      <h2>Contributions</h2>
      <ul>
        <li>Led a team of five senior Android engineers</li>
        <li>Defined delivery sequencing for major feature enhancements</li>
        <li>Drove targeted performance and stability improvements</li>
      </ul>
      <h2>Outcome</h2>
      <p>We improved release confidence through better modular boundaries and stronger validation loops, reducing integration friction while keeping customer-critical flows reliable.</p>
    `
  },
  {
    slug: "case-study-ocbc-banking-experience",
    title: "Case Study: OCBC Mobile Banking Delivery",
    published_date: "2024-11-20",
    reading_time: "8 min read",
    category: "work",
    topics: ["OCBC", "Fintech", "Android", "Kotlin"],
    summary:
      "Delivery notes from a banking app environment where trust, performance, and safe iteration all matter simultaneously.",
    hero_image: "/assets/images/work/img_ocbc_app.png",
    hero_alt: "OCBC mobile app screenshot",
    hero_caption: "OCBC production app",
    body_html: `
      <h2>Context</h2>
      <p>Banking apps demand consistency and precision under strict reliability constraints. The goal was to improve core financial workflows while preserving user trust and regression safety.</p>
      <h2>Stack</h2>
      <ul>
        <li>Kotlin + XML UI surfaces</li>
        <li>Firebase integrations and analytics hooks</li>
      </ul>
      <h2>Key Challenges</h2>
      <ul>
        <li>Chart customizations for financial visualizations</li>
        <li>Identity verification flow handling</li>
        <li>Concurrency edge cases in high-touch transactions</li>
        <li>Network call efficiency under constrained conditions</li>
      </ul>
      <h2>Contributions</h2>
      <ul>
        <li>Integrated third-party SDKs with guarded rollout strategy</li>
        <li>Refactored selected modules to reduce coupling</li>
        <li>Supported UI modernization and unit-test coverage improvements</li>
      </ul>
      <h2>Outcome</h2>
      <p>The team shipped iterative improvements without breaking critical user paths, balancing quality controls with product velocity.</p>
    `
  },
  {
    slug: "case-study-solo-whitelabel-delivery-platform",
    title: "Case Study: Solo Whitelabel Delivery Platform",
    published_date: "2024-08-10",
    reading_time: "7 min read",
    category: "work",
    topics: ["Solo", "Food Delivery", "Android", "Whitelabel"],
    summary:
      "Scaling one codebase across multiple food brands while preserving brand-specific behavior and keeping deployment overhead manageable.",
    hero_image: "/assets/images/work/img_solo_app.png",
    hero_alt: "Solo food delivery app screenshot",
    hero_caption: "Solo whitelabel app family",
    body_html: `
      <h2>Context</h2>
      <p>Solo supports multiple delivery brands through a whitelabel platform model. Product and engineering needed predictable customization without fragmenting the codebase.</p>
      <h2>Stack</h2>
      <ul>
        <li>Kotlin + XML layouts</li>
        <li>Retrofit-based API integration patterns</li>
      </ul>
      <h2>Key Challenges</h2>
      <ul>
        <li>Legacy integration constraints from older modules</li>
        <li>API consistency across varied partner requirements</li>
      </ul>
      <h2>Contributions</h2>
      <ul>
        <li>Implemented production fixes and shipping features across brands</li>
        <li>Reduced risk on rollout by improving implementation consistency</li>
      </ul>
      <h2>Outcome</h2>
      <p>The platform maintained delivery momentum while supporting brand-level variation with fewer brittle custom forks.</p>
    `
  },
  {
    slug: "case-study-owto-ride-hailing-platform",
    title: "Case Study: OWTO Ride-Hailing Platform",
    published_date: "2024-06-15",
    reading_time: "10 min read",
    category: "work",
    topics: ["OWTO", "Mobility", "Android", "iOS", "Backend"],
    summary:
      "Leading full-stack mobile and backend delivery for a ride-hailing product focused on booking reliability and operational execution.",
    hero_image: "/assets/images/work/img_owto_app.png",
    hero_alt: "OWTO ride-hailing app screenshot",
    hero_caption: "OWTO app booking flow",
    body_html: `
      <h2>Context</h2>
      <p>OWTO required dependable booking behavior in a highly dynamic transport environment. The scope covered native mobile apps and backend API support.</p>
      <h2>Stack</h2>
      <ul>
        <li>Kotlin + Swift client layers</li>
        <li>Firebase operational integrations</li>
        <li>Node.js + Postgres backend services</li>
        <li>Uber RIB-inspired architecture patterns</li>
      </ul>
      <h2>Key Challenges</h2>
      <ul>
        <li>Real-time GPS updates under variable network quality</li>
        <li>Payment integration reliability and failure handling</li>
      </ul>
      <h2>Contributions</h2>
      <ul>
        <li>Led cross-functional delivery across Android, iOS, and backend</li>
        <li>Implemented booking-path improvements and algorithm refinements</li>
        <li>Helped shape API contracts for app reliability</li>
      </ul>
      <h2>Outcome</h2>
      <p>Core booking and dispatch experiences became more predictable, and release management improved through tighter ownership boundaries.</p>
    `
  },
  {
    slug: "case-study-popslide-engagement-and-monetization",
    title: "Case Study: Popslide Engagement and Monetization",
    published_date: "2023-11-30",
    reading_time: "8 min read",
    category: "work",
    topics: ["Popslide", "Adtech", "Android", "Experimentation"],
    summary:
      "Operational lessons from balancing retention, monetization, and product stability in an ad-and-task rewards app.",
    hero_image: "/assets/images/work/img_popslide_app.png",
    hero_alt: "Popslide app screenshot",
    hero_caption: "Popslide lockscreen and rewards experience",
    body_html: `
      <h2>Context</h2>
      <p>Popslide combines cashback mechanics with ad/task interactions, including lockscreen-facing surfaces. The product needed robust experimentation without degrading app quality.</p>
      <h2>Stack</h2>
      <ul>
        <li>Kotlin + Android lockscreen integration</li>
        <li>Notifications infrastructure</li>
        <li>Flux-style state patterns and Firebase services</li>
      </ul>
      <h2>Key Challenges</h2>
      <ul>
        <li>Engagement optimization with controlled user experience risk</li>
        <li>Ad delivery reliability at scale</li>
      </ul>
      <h2>Contributions</h2>
      <ul>
        <li>Implemented and evaluated A/B test variants</li>
        <li>Shipped feature rollouts with safer guardrails</li>
        <li>Refactored fragile areas to reduce regressions</li>
      </ul>
      <h2>Outcome</h2>
      <p>Experiment velocity improved while maintaining operational stability for monetization-critical surfaces.</p>
    `
  },
  {
    slug: "case-study-websafety-parental-controls",
    title: "Case Study: WebSafety Parental Controls",
    published_date: "2023-06-22",
    reading_time: "9 min read",
    category: "work",
    topics: ["WebSafety", "Security", "Parental Controls", "Android"],
    summary:
      "Building parental control features with strict privacy and platform constraints, including hard technical limits on mobile operating systems.",
    hero_image: "/assets/images/work/img_websafety_app.jpg",
    hero_alt: "WebSafety app screenshot",
    hero_caption: "WebSafety monitoring dashboard",
    body_html: `
      <h2>Context</h2>
      <p>WebSafety focused on parent-facing safety controls for child devices. The system had to be dependable while respecting security and privacy boundaries.</p>
      <h2>Stack</h2>
      <ul>
        <li>Java + Objective-C legacy integrations</li>
        <li>AWS S3 and ElasticSearch backend dependencies</li>
      </ul>
      <h2>Key Challenges</h2>
      <ul>
        <li>Undocumented API behavior and platform limitations</li>
        <li>GPS and sync reliability across device states</li>
        <li>Security and compliance-sensitive handling</li>
      </ul>
      <h2>Contributions</h2>
      <ul>
        <li>Explored practical implementation paths for restricted scenarios</li>
        <li>Implemented security-focused features and hardened flows</li>
      </ul>
      <h2>Outcome</h2>
      <p>The product delivered higher control fidelity for parents while respecting operational and compliance constraints.</p>
    `
  },
  {
    slug: "case-study-projectbass-crowdsourced-network-mapping",
    title: "Case Study: ProjectBASS Community Network Mapping",
    published_date: "2022-10-05",
    reading_time: "6 min read",
    category: "work",
    topics: ["ProjectBASS", "Open Source", "Network Mapping", "Kotlin"],
    summary:
      "Community-built signal and bandwidth mapping designed to collect useful field data through volunteer contributions.",
    hero_image: "/assets/images/work/img_projectbass_app.png",
    hero_alt: "ProjectBASS app screenshot",
    hero_caption: "ProjectBASS map visualization",
    body_html: `
      <h2>Context</h2>
      <p>ProjectBASS was built by volunteers for volunteers to gather network quality measurements from real locations and real carriers.</p>
      <h2>Stack</h2>
      <ul>
        <li>Kotlin client implementation</li>
        <li>Retrofit network layer</li>
      </ul>
      <h2>Key Challenges</h2>
      <ul>
        <li>Consistent data aggregation from heterogeneous devices</li>
        <li>Carrier and environment variability</li>
      </ul>
      <h2>Contributions</h2>
      <ul>
        <li>Open-source feature work and maintenance support</li>
        <li>Community collaboration on quality and data usefulness</li>
      </ul>
      <h2>Outcome</h2>
      <p>The app improved visibility into field network conditions and proved out a practical crowdsourcing model for connectivity insights.</p>
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
