(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ContactTransport = Object.freeze(api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STATES = Object.freeze({
    IDLE: "idle",
    VALIDATING: "validating",
    HANDOFF: "handoff",
    SUBMITTING: "submitting",
    CONFIRMED: "confirmed",
    FAILED: "failed",
    PENDING_MODERATION: "pending_moderation"
  });
  const TARGETS = Object.freeze({
    dashboard: "/",
    portfolio: "/work.html",
    logs: "/blog/",
    about: "/about.html",
    contact: "/contact.html",
    resume: "/resume.html",
    skills: "/skills-graph.html"
  });
  const LEGACY_CONFIG_KEYS = ["enabled", "endpoint", "publicFeedEndpoint", "requestTimeoutMs", "version"];
  const CONFIG_KEYS = LEGACY_CONFIG_KEYS.concat("transport");
  const PRIVATE_KEYS = ["contextPath", "email", "intent", "name", "privateMessage", "version"];
  const PRIVATE_KEYS_V2 = PRIVATE_KEYS.concat("submissionId");
  const PUBLIC_KEYS = PRIVATE_KEYS.concat("public");
  const PUBLIC_KEYS_V2 = PRIVATE_KEYS_V2.concat("public");
  const PUBLIC_DETAIL_KEYS = ["consent", "display", "quote", "target"];
  const DISPLAY_KEYS = ["label", "mode"];
  const RESPONSE_KEYS = ["intent", "receiptId", "state", "version"];
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const RECEIPT_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
  const SUBMISSION_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
  const BIDI_OR_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/;

  function exactKeys(value, expected) {
    return Boolean(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) === JSON.stringify(Array.from(expected).sort())
    );
  }

  function assertText(value, label, limits) {
    const min = limits && limits.min !== undefined ? limits.min : 1;
    const max = limits && limits.max !== undefined ? limits.max : 1000;
    if (typeof value !== "string" || value !== value.trim() || value.length < min || value.length > max) {
      throw new Error(label + " must be trimmed text between " + min + " and " + max + " characters.");
    }
    if (BIDI_OR_CONTROL.test(value)) throw new Error(label + " contains unsafe control characters.");
    return value;
  }

  function locationOrigin(locationLike) {
    if (locationLike && typeof locationLike.origin === "string" && locationLike.origin !== "null") {
      return locationLike.origin;
    }
    const protocol = (locationLike && locationLike.protocol) || "https:";
    const host = (locationLike && (locationLike.host || locationLike.hostname)) || "invalid.local";
    return protocol + "//" + host;
  }

  function allowedAppsScriptAcknowledgementOrigin(origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== "https:") return false;
      const hostname = parsed.hostname.toLowerCase();
      return hostname === "script.google.com" ||
        hostname === "script.googleusercontent.com" ||
        hostname.endsWith(".script.googleusercontent.com") ||
        /^[a-z0-9-]+-script\.googleusercontent\.com$/.test(hostname);
    } catch (_error) {
      return false;
    }
  }

  function endpointUrl(value, locationLike, label) {
    if (typeof value !== "string") throw new Error(label + " must be a string.");
    if (!value) return "";
    if (value.startsWith("//")) throw new Error(label + " cannot be protocol-relative.");
    let parsed;
    try {
      parsed = new URL(value, locationOrigin(locationLike));
    } catch (_error) {
      throw new Error(label + " is not a valid URL.");
    }
    if (parsed.username || parsed.password || parsed.hash) {
      throw new Error(label + " cannot contain credentials or a fragment.");
    }
    if (parsed.protocol === "https:") return parsed.href;
    const exactLoopback =
      parsed.protocol === "http:" &&
      parsed.hostname === "127.0.0.1" &&
      locationLike &&
      locationLike.hostname === "127.0.0.1" &&
      parsed.origin === locationOrigin(locationLike);
    if (!exactLoopback) throw new Error(label + " must use HTTPS or the page's exact 127.0.0.1 origin.");
    return parsed.href;
  }

  function validateRuntimeConfig(config, locationLike) {
    const explicitTransport = exactKeys(config, CONFIG_KEYS);
    const legacyConfig = exactKeys(config, LEGACY_CONFIG_KEYS);
    if (!explicitTransport && !legacyConfig) throw new Error("Contact runtime config has unknown or missing fields.");
    if (config.version !== 1 || typeof config.enabled !== "boolean") {
      throw new Error("Contact runtime config version or enabled flag is invalid.");
    }
    if (!Number.isInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 1000 || config.requestTimeoutMs > 30000) {
      throw new Error("Contact runtime timeout must be an integer from 1000 to 30000 milliseconds.");
    }
    const endpoint = endpointUrl(config.endpoint, locationLike, "Contact endpoint");
    const publicFeedEndpoint = endpointUrl(config.publicFeedEndpoint, locationLike, "Public feed endpoint");
    const transport = explicitTransport
      ? config.transport
      : (config.enabled ? "json_endpoint" : "email_app");
    if (!["apps_script_iframe", "disabled", "email_app", "json_endpoint"].includes(transport)) {
      throw new Error("Contact runtime transport is invalid.");
    }
    if (!config.enabled && (endpoint || publicFeedEndpoint)) {
      throw new Error("Disabled runtime config must keep both endpoints blank.");
    }
    if (!config.enabled && explicitTransport && transport !== "disabled") {
      throw new Error("Explicit disabled runtime config must use the disabled transport.");
    }
    if (config.enabled && (transport === "disabled" || transport === "email_app" || !endpoint)) {
      throw new Error("Enabled runtime config requires a record transport and contact endpoint.");
    }
    if (legacyConfig && config.enabled && !publicFeedEndpoint) {
      throw new Error("Legacy enabled runtime config requires contact and public-feed endpoints.");
    }
    return Object.freeze(Object.assign({}, config, { endpoint, publicFeedEndpoint, transport }));
  }

  function validateContextPath(value) {
    assertText(value, "Context path", { min: 1, max: 240 });
    if (!value.startsWith("/") || value.startsWith("//") || /(?:https?:|mailto:|javascript:)/i.test(value)) {
      throw new Error("Context path must be a local absolute path.");
    }
    const parsed = new URL(value, "https://context.invalid");
    if (parsed.origin !== "https://context.invalid" || parsed.username || parsed.password || parsed.hash) {
      throw new Error("Context path is invalid.");
    }
    return parsed.pathname + parsed.search;
  }

  function validatePayload(payload) {
    const isPublic = payload && payload.intent === "public";
    const version = payload && payload.version;
    const expectedKeys = version === 2
      ? (isPublic ? PUBLIC_KEYS_V2 : PRIVATE_KEYS_V2)
      : (isPublic ? PUBLIC_KEYS : PRIVATE_KEYS);
    if (!exactKeys(payload, expectedKeys)) {
      throw new Error("Contact payload has unknown, private-leaking, or missing fields.");
    }
    if (![1, 2].includes(payload.version) || (payload.intent !== "private" && payload.intent !== "public")) {
      throw new Error("Contact payload version or intent is invalid.");
    }
    if (payload.version === 2 && !SUBMISSION_PATTERN.test(payload.submissionId || "")) {
      throw new Error("Submission ID is invalid.");
    }
    assertText(payload.name, "Name", { min: 2, max: 80 });
    assertText(payload.email, "Email", { min: 5, max: 254 });
    if (!EMAIL_PATTERN.test(payload.email)) throw new Error("Email is invalid.");
    assertText(payload.privateMessage, "Private message", { min: isPublic ? 0 : 1, max: 4000 });
    validateContextPath(payload.contextPath);
    if (isPublic) {
      if (!exactKeys(payload.public, PUBLIC_DETAIL_KEYS) || !exactKeys(payload.public.display, DISPLAY_KEYS)) {
        throw new Error("Public feedback must use the exact public payload shape.");
      }
      assertText(payload.public.quote, "Public quote", { min: 1, max: 280 });
      if (!Object.hasOwn(TARGETS, payload.public.target)) throw new Error("Public target is not allowlisted.");
      if (payload.public.display.mode !== "anonymous" && payload.public.display.mode !== "named") {
        throw new Error("Public display mode is invalid.");
      }
      if (payload.public.display.mode === "anonymous" && payload.public.display.label !== "Anonymous") {
        throw new Error("Anonymous feedback must use the Anonymous label.");
      }
      if (payload.public.display.mode === "named" && payload.public.display.label !== payload.name) {
        throw new Error("Named feedback must use the separately submitted name.");
      }
      if (payload.public.consent !== true) throw new Error("Explicit public-feedback consent is required.");
    }
    return payload;
  }

  function validateResponse(response, intent, expectedVersion) {
    if (!exactKeys(response, RESPONSE_KEYS)) throw new Error("Contact response has unknown or missing fields.");
    const version = expectedVersion === undefined ? 1 : expectedVersion;
    if (response.version !== version || response.intent !== intent || !RECEIPT_PATTERN.test(response.receiptId || "")) {
      throw new Error("Contact response version, intent, or opaque receipt is invalid.");
    }
    const expected = intent === "public" ? STATES.PENDING_MODERATION : STATES.CONFIRMED;
    if (response.state !== expected) {
      throw new Error(
        intent === "public"
          ? "Public submissions may only return pending_moderation."
          : "Private submissions may only return confirmed."
      );
    }
    return Object.freeze(Object.assign({}, response));
  }

  function buildMailto(payload, destination) {
    validatePayload(payload);
    assertText(destination, "Email destination", { min: 5, max: 254 });
    if (!EMAIL_PATTERN.test(destination)) throw new Error("Email destination is invalid.");
    const lines = [
      "Intent: " + (payload.intent === "public" ? "Public feedback review request" : "Private message"),
      "Name: " + payload.name,
      "Reply-to: " + payload.email
    ];
    if (payload.privateMessage) {
      lines.push(
        "",
        "Private message (never proposed for public display):",
        payload.privateMessage
      );
    }
    if (payload.intent === "public") {
      lines.push(
        "",
        "Separate public quote proposed for human review:",
        payload.public.quote,
        "Public target: " + payload.public.target + " (" + TARGETS[payload.public.target] + ")",
        "Display choice: " + payload.public.display.mode + " / " + payload.public.display.label,
        "Explicit consent for this exact quote, target, and display choice: YES",
        "Publication state: NOT PUBLIC — human moderation is required."
      );
    }
    const subject = payload.intent === "public"
      ? "Public feedback review request from " + payload.name
      : "Portfolio enquiry from " + payload.name;
    return "mailto:" + destination + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(lines.join("\n"));
  }

  function emit(listener, state, detail) {
    if (typeof listener === "function") listener(state, detail || {});
  }

  class UnavailableTransport {
    constructor() {
      this.kind = "unavailable";
    }
    async submit(payload, options) {
      validatePayload(payload);
      emit(options && options.onState, STATES.VALIDATING, { transport: this.kind });
      throw new Error("Contact record service is not configured.");
    }
  }

  class EmailAppTransport {
    constructor(options) {
      this.kind = "email_app";
      this.destination = options.destination;
      this.navigate = options.navigate;
    }
    async submit(payload, options) {
      const onState = options && options.onState;
      emit(onState, STATES.VALIDATING, { transport: this.kind });
      const uri = buildMailto(payload, this.destination);
      emit(onState, STATES.HANDOFF, { transport: this.kind, confirmed: false });
      this.navigate(uri);
      return Object.freeze({ state: STATES.HANDOFF, confirmed: false });
    }
  }

  class EndpointTransport {
    constructor(options) {
      this.kind = "configured_endpoint";
      this.config = options.config;
      this.fetchImpl = options.fetchImpl;
    }
    async submit(payload, options) {
      validatePayload(payload);
      const onState = options && options.onState;
      const callerSignal = options && options.signal;
      emit(onState, STATES.VALIDATING, { transport: this.kind });
      emit(onState, STATES.SUBMITTING, { transport: this.kind });
      const controller = new AbortController();
      const abortFromCaller = function () { controller.abort(callerSignal && callerSignal.reason); };
      if (callerSignal) callerSignal.addEventListener("abort", abortFromCaller, { once: true });
      const timeout = setTimeout(function () {
        controller.abort(new Error("CONTACT_REQUEST_TIMEOUT"));
      }, this.config.requestTimeoutMs);
      try {
        const response = await this.fetchImpl(this.config.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Contact endpoint returned HTTP " + response.status + ".");
        const contentType = (response.headers && response.headers.get("content-type")) || "";
        if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
          throw new Error("Contact endpoint returned a non-JSON response.");
        }
        const result = validateResponse(await response.json(), payload.intent, payload.version);
        emit(onState, result.state, result);
        return result;
      } finally {
        clearTimeout(timeout);
        if (callerSignal) callerSignal.removeEventListener("abort", abortFromCaller);
      }
    }
  }

  class AppsScriptIframeTransport {
    constructor(options) {
      this.kind = "apps_script_iframe";
      this.config = options.config;
      this.bridge = options.bridge;
    }
    async submit(payload, options) {
      validatePayload(payload);
      const onState = options && options.onState;
      emit(onState, STATES.VALIDATING, { transport: this.kind });
      emit(onState, STATES.SUBMITTING, { transport: this.kind });
      const response = await this.bridge(payload, {
        endpoint: this.config.endpoint,
        signal: options && options.signal,
        timeoutMs: this.config.requestTimeoutMs
      });
      const result = validateResponse(response, payload.intent, payload.version);
      emit(onState, result.state, result);
      return result;
    }
  }

  function create(options) {
    const config = validateRuntimeConfig(options.config, options.location);
    if (!config.enabled && config.transport === "email_app") {
      return new EmailAppTransport({ destination: options.destination, navigate: options.navigate });
    }
    if (!config.enabled) return new UnavailableTransport();
    if (config.transport === "apps_script_iframe") {
      if (typeof options.iframeBridge !== "function") {
        throw new Error("Apps Script iframe transport requires a bridge.");
      }
      return new AppsScriptIframeTransport({ config, bridge: options.iframeBridge });
    }
    if (typeof options.fetchImpl !== "function") throw new Error("Configured endpoint transport requires fetch.");
    return new EndpointTransport({ config, fetchImpl: options.fetchImpl });
  }

  return Object.freeze({
    STATES,
    TARGETS,
    allowedAppsScriptAcknowledgementOrigin,
    buildMailto,
    create,
    exactKeys,
    validatePayload,
    validateResponse,
    validateRuntimeConfig
  });
});
