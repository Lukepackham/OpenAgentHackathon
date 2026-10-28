import { POLICY_PACKS } from "./defaults.js";

/**
 * Five guard layers. Each returns pass, warn, or block.
 * Any block stops the pipeline. A warn lifts the risk one band above the
 * intent's risk-class floor. Risk is never reported below that floor.
 */
export function guardRequest({ prompt, intent, user, surface, pack, rateLimiter }) {
  const layers = [
    injectionLayer(prompt, pack),
    policyLayer({ prompt, intent, user, surface, pack }),
    scopeLayer({ intent, user, surface }),
    sensitivityLayer(prompt),
    rateLayer({ intent, user, surface, rateLimiter }),
  ];

  const blocks = layers.filter((layer) => layer.action === "block");
  const warns = layers.filter((layer) => layer.action === "warn");
  const redactions = layers.flatMap((layer) => layer.redactions ?? []);
  const flags = layers
    .filter((layer) => layer.action !== "pass")
    .map((layer) => ({
      layer: layer.layer,
      kind: layer.kind,
      action: layer.action,
      detail: layer.detail,
    }));

  if (blocks.length) {
    const block = blocks[0];
    return {
      level: "block",
      flags,
      redactions,
      reason: block.detail,
      approvalsRequired: [],
      redactedPrompt: applyRedactions(prompt, redactions),
      injection: block.injection ?? { detected: false },
    };
  }

  let level = intent?.riskClass ?? "low";
  for (const _warn of warns) level = lift(level);

  const approvalsRequired =
    intent && intent.riskClass === "high" ? [{ kind: "user-confirm" }] : [];

  return {
    level,
    flags,
    redactions,
    approvalsRequired,
    redactedPrompt: applyRedactions(prompt, redactions),
    injection: layers[0].injection ?? { detected: false },
  };
}

export function loadPolicyPack(spec) {
  const names = spec == null ? ["default"] : Array.isArray(spec) ? spec : [spec];
  const packs = names.map((name) => {
    if (POLICY_PACKS[name]) return { name, ...POLICY_PACKS[name] };
    throw new Error(`Unknown policy pack "${name}". Known packs: ${Object.keys(POLICY_PACKS).join(", ")}.`);
  });
  return {
    names,
    version: packs.map((pack) => `${pack.name}@${pack.version}`).join("+"),
    injections: packs.flatMap((pack) => compilePatterns(pack.injections ?? [])),
    rules: packs.flatMap((pack) => compileRules(pack.rules ?? [])),
  };
}

function compilePatterns(patterns) {
  return patterns.map((pattern) => ({
    ...pattern,
    re: new RegExp(pattern.source, "i"),
  }));
}

function compileRules(rules) {
  return rules.map((rule) => ({ ...rule, re: new RegExp(rule.source, "i") }));
}

function injectionLayer(prompt, pack) {
  for (const pattern of pack.injections) {
    if (pattern.re.test(prompt)) {
      return {
        layer: "injection",
        action: "block",
        kind: pattern.kind,
        detail: `Blocked this request before any tool could run (${pattern.label}).`,
        injection: {
          detected: true,
          kind: pattern.kind,
          score: 1,
          evidence: [pattern.label],
        },
      };
    }
  }
  return {
    layer: "injection",
    action: "pass",
    injection: { detected: false, kind: null, score: 0, evidence: [] },
  };
}

function policyLayer({ prompt, intent, user, surface, pack }) {
  if (intent) {
    const role = user?.role ?? "anonymous";
    const roleAllowed = intent.roles.includes("*") || intent.roles.includes(role);
    if (!roleAllowed) {
      return {
        layer: "policy",
        action: "block",
        kind: "role",
        detail: `The ${role} role cannot use ${intent.id}.`,
      };
    }
    if (!intent.surfaces.includes(surface)) {
      return {
        layer: "policy",
        action: "block",
        kind: "surface",
        detail: `${intent.id} is not available on the ${surface} surface.`,
      };
    }
  }

  for (const rule of pack.rules) {
    const intentOk = rule.intent === "*" || rule.intent === intent?.id;
    if (intentOk && rule.re.test(prompt) && rule.action === "block") {
      return { layer: "policy", action: "block", kind: rule.id, detail: rule.reason };
    }
  }
  return { layer: "policy", action: "pass" };
}

function scopeLayer({ intent, user, surface }) {
  if (!intent) return { layer: "scope", action: "pass" };
  const role = user?.role ?? "anonymous";
  const roleAllowed = intent.roles.includes("*") || intent.roles.includes(role);
  const surfaceAllowed = intent.surfaces.includes(surface);
  if (!roleAllowed || !surfaceAllowed) {
    return {
      layer: "scope",
      action: "warn",
      kind: "scope-drift",
      detail: "The intent does not fit this user or surface.",
    };
  }
  return { layer: "scope", action: "pass" };
}

function sensitivityLayer(prompt) {
  const redactions = [];
  const rules = [
    ["email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
    ["phone", /\b(?:\+?\d{1,3}[\s.-])?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g],
    ["ssn", /\b\d{3}-\d{2}-\d{4}\b/g],
  ];
  for (const [kind, re] of rules) {
    for (const match of prompt.matchAll(re)) {
      redactions.push({ kind, start: match.index, length: match[0].length });
    }
  }
  if (!redactions.length) return { layer: "sensitivity", action: "pass", redactions: [] };
  return {
    layer: "sensitivity",
    action: "warn",
    kind: "pii",
    detail: "Personal data was redacted before routing.",
    redactions,
  };
}

function rateLayer({ intent, user, surface, rateLimiter }) {
  if (!rateLimiter || !intent) return { layer: "rate", action: "pass" };
  const key = `${user?.id ?? "anonymous"}:${intent.id}:${surface}`;
  if (!rateLimiter.take(key)) {
    return {
      layer: "rate",
      action: "block",
      kind: "rate-limit",
      detail: "Too many requests for this action. Wait a moment and try again.",
    };
  }
  return { layer: "rate", action: "pass" };
}

function applyRedactions(prompt, redactions) {
  const ordered = [...redactions].sort((a, b) => b.start - a.start);
  let text = prompt;
  for (const redaction of ordered) {
    text =
      text.slice(0, redaction.start) +
      `[redacted-${redaction.kind}]` +
      text.slice(redaction.start + redaction.length);
  }
  return text;
}

function lift(level) {
  const order = ["low", "medium", "high"];
  const index = order.indexOf(level);
  if (index < 0) return "low";
  return order[Math.min(order.length - 1, index + 1)];
}

export class RateLimiter {
  constructor({ limit = 60, windowMs = 60_000 } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.buckets = new Map();
  }

  take(key, now = Date.now()) {
    const bucket = this.buckets.get(key) ?? [];
    const fresh = bucket.filter((stamp) => now - stamp < this.windowMs);
    if (fresh.length >= this.limit) {
      this.buckets.set(key, fresh);
      return false;
    }
    fresh.push(now);
    this.buckets.set(key, fresh);
    return true;
  }
}
