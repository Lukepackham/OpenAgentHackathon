/**
 * Built-in policy packs, model profiles, scoring weights, and the capability graph.
 * These are data. The pipeline code reads them; it does not hard-code CRM or
 * student intents. Intent catalogs are loaded separately.
 */

export const WEIGHTS = {
  lexical: 0.4,
  semantic: 0.35,
  contextual: 0.2,
  recency: 0.05,
};

export const BANDS = {
  high: 0.8,
  medium: 0.55,
  low: 0.4,
};

/** High-risk intents below this confidence must be clarified, not acted on. */
export const HIGH_RISK_PROCEED = 0.95;

/** Two medium-band intents closer than this are a tie and need clarification. */
export const TIE_WINDOW = 0.05;

export const CONTRACT_TTL_MS = 5 * 60 * 1000;

/**
 * Local-first model profiles. Remote profiles are listed so the router can
 * reject them for confidential data. No API keys live here.
 */
export const MODEL_PROFILES = {
  defaultChain: "local-first",
  profiles: [
    {
      id: "local-fast",
      provider: "local",
      model: "token-similarity",
      context: 8192,
      cost: { in: 0, out: 0 },
      latency: { p95Ms: 20 },
      capabilities: ["text", "json-mode"],
      dataClasses: ["public", "internal"],
      local: true,
    },
    {
      id: "local-capable",
      provider: "local",
      model: "local-capable",
      context: 32000,
      cost: { in: 0, out: 0 },
      latency: { p95Ms: 400 },
      capabilities: ["text", "json-mode"],
      dataClasses: ["public", "internal", "confidential", "restricted"],
      local: true,
    },
    {
      id: "default-fast",
      provider: "remote",
      model: "remote-fast",
      context: 128000,
      cost: { in: 0.0001, out: 0.0004 },
      latency: { p95Ms: 800 },
      capabilities: ["text", "function-calling"],
      dataClasses: ["public"],
      local: false,
    },
  ],
};

/**
 * Each capability names concrete tools. The router picks one tool per capability.
 * `local: true` wins ties. Opportunity tools and the CRM tools from the Scout
 * eval fixtures share this graph so one engine can serve both registries.
 */
export const CAPABILITY_GRAPH = {
  "world.query": [
    { toolId: "local.world.read", local: true, latencyMs: 20, cost: 0, permissions: [] },
  ],
  "memory.recall": [
    { toolId: "local.memory.recall", local: true, latencyMs: 15, cost: 0, permissions: [] },
  ],
  "swarm.run": [
    { toolId: "local.swarm.run", local: true, latencyMs: 80, cost: 0, permissions: [] },
  ],
  "email.draft": [
    { toolId: "local.email.draft", local: true, latencyMs: 30, cost: 0, permissions: [] },
  ],
  "email.send": [
    { toolId: "local.email.send", local: true, latencyMs: 50, cost: 0, permissions: [] },
  ],
  "world.assert": [
    { toolId: "local.world.write", local: true, latencyMs: 40, cost: 0, permissions: [] },
  ],
  "markovian.chain": [
    { toolId: "local.markovian.chain", local: true, latencyMs: 60, cost: 0, permissions: [] },
  ],
  "calendar.create": [
    { toolId: "local.calendar.create", local: true, latencyMs: 25, cost: 0, permissions: [] },
  ],
  "approval.require": [
    { toolId: "local.approval.gate", local: true, latencyMs: 5, cost: 0, permissions: [] },
  ],
  "catalog.search": [
    { toolId: "local.opportunity.catalog", local: true, latencyMs: 10, cost: 0, permissions: [] },
  ],
  "profile.read": [
    { toolId: "local.student.profile", local: true, latencyMs: 5, cost: 0, permissions: [] },
  ],
};

const instructionOverride = {
  kind: "pattern",
  label: "instruction-override",
  source: "ignore\\s+(all\\s+|any\\s+|the\\s+)?(previous|prior|above)\\s+instructions|ignore\\s+previous",
};

const disregardRules = {
  kind: "role-drift",
  label: "disregard-rules",
  source: "disregard\\s+(the\\s+|all\\s+)?(rules|instructions|user|previous)",
};

const roleMarkers = {
  kind: "role-drift",
  label: "role-marker",
  source: "<\\s*/?\\s*system\\s*>|\\[\\s*/?\\s*inst\\s*\\]|you\\s+are\\s+now\\s+|unrestricted\\s+mode|pretend\\s+to\\s+be\\s+the\\s+system",
};

const toolEscape = {
  kind: "tool-ref",
  label: "out-of-band-tool",
  source: "internal_admin_panel|grant\\s+me\\s+admin|drop\\s+the\\s+\\w+\\s+table",
};

const secretReveal = {
  kind: "pattern",
  label: "secret-reveal",
  source: "reveal\\s+(all\\s+)?(stored\\s+)?(api\\s+keys|credentials|passwords|secrets)",
};

const unicodeRlo = {
  kind: "pattern",
  label: "unicode-rlo",
  source: "\\\\u202e|\\u202e",
};

export const POLICY_PACKS = {
  default: {
    version: "1",
    injections: [instructionOverride, disregardRules, roleMarkers, toolEscape, secretReveal, unicodeRlo],
    rules: [],
  },
  "adversarial-tight": {
    version: "1",
    injections: [unicodeRlo, disregardRules, roleMarkers, toolEscape],
    rules: [],
  },
  "student-safety": {
    version: "1",
    injections: [
      {
        kind: "pattern",
        label: "other-student-pii",
        source: "other\\s+students?'?\\s+(phone|address|emails?|passwords?|records?|data|details)",
      },
      {
        kind: "tool-ref",
        label: "attack-portal",
        source: "\\b(hack|phish)\\b[\\s\\S]{0,48}\\b(portal|password|account|credentials?)",
      },
      {
        kind: "pattern",
        label: "credential-theft",
        source: "\\b(steal|exfiltrate)\\b[\\s\\S]{0,40}\\b(passwords?|credentials?|tokens?)",
      },
    ],
    rules: [
      {
        id: "mass-submit",
        intent: "application.submit",
        source: "\\ball\\b",
        action: "block",
        reason: "Refusing a request to submit applications to every employer at once.",
      },
      {
        id: "password-in-request",
        intent: "*",
        source: "\\b(my\\s+password|password\\s*[:=]|using\\s+(this\\s+)?password)\\b",
        action: "block",
        reason: "Refusing a request that includes a password. Opportunity Scout never asks for or stores passwords.",
      },
    ],
  },
};
