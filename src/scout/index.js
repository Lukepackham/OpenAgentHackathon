import { CONTRACT_TTL_MS, CAPABILITY_GRAPH, MODEL_PROFILES } from "./defaults.js";
import { guardRequest, loadPolicyPack, RateLimiter } from "./guard.js";
import { interpret } from "./interpret.js";
import { chooseModelProfile } from "./models.js";
import { loadRegistry } from "./registry.js";
import { buildToolPlan } from "./route.js";
import {
  bandFor,
  clarificationTrigger,
  detectMultiIntent,
  hasUnresolvedReference,
  scoreRegistry,
} from "./scoring.js";
import { issueContract, traceId, ulid, verifyContract } from "./contract.js";
import { Telemetry } from "./telemetry.js";

const DEV_SIGNING_KEY = "opportunity-scout-local-dev-integrity-key";

/**
 * Scout decides what a prompt is allowed to do. It does not run the action.
 * Call decide(), then pass executionContract to an executor that verifies it.
 */
export class Scout {
  constructor(options = {}) {
    this.registry = loadRegistry(options.intentRegistry);
    this.pack = loadPolicyPack(options.policyPack ?? "default");
    this.graph = options.capabilityGraph ?? CAPABILITY_GRAPH;
    this.profiles = options.modelProfiles ?? MODEL_PROFILES;
    this.secret = options.signingSecret || process.env.SCOUT_SIGNING_SECRET || DEV_SIGNING_KEY;
    this.ttlMs = options.ttlMs ?? CONTRACT_TTL_MS;
    this.stage2 = options.stage2 !== false;
    this.rateLimiter = new RateLimiter(options.rateLimit);
    this.telemetry = options.telemetry ?? new Telemetry();
    this.issued = new Map();
    this.recent = new Map();
    this.selfTest();
  }

  /** Sense only: top-k scored intents, used for live typing feedback. */
  async classify({ prompt, surface = "chat" }) {
    const candidates = scoreRegistry(prompt, this.registry, { stage2: this.stage2 }).map(publicCandidate);
    return { surface, candidates };
  }

  /**
   * Full pipeline: Sense, Interpret, Guard, Route, Recommend.
   * A block or a clarification returns no execution contract.
   */
  async decide(input) {
    const started = performance.now();
    const prompt = String(input?.prompt ?? "");
    const surface = input?.surface ?? "chat";
    const user = input?.user ?? { id: "anonymous", role: "student" };
    const context = input?.context;
    const id = traceId();
    const recentIntentIds = this.recent.get(user.id) ?? [];
    const sensed = detectMultiIntent(prompt, this.registry, {
      stage2: this.stage2,
      context,
      recentIntentIds,
    });
    const candidates = sensed.candidates;
    const top = candidates[0];
    const chosen = top?.band === "reject" ? this.intentById("GENERAL") : this.intentById(top.intent);
    const reading = interpret({ prompt, intent: chosen, context });
    const trigger = clarificationTrigger({
      candidate: top,
      second: candidates[1],
      missing: reading.missing,
      unresolved: hasUnresolvedReference(prompt),
    });

    const risk = guardRequest({
      prompt,
      intent: chosen,
      user,
      surface,
      pack: this.pack,
      rateLimiter: this.rateLimiter,
    });

    const decision = {
      traceId: id,
      candidates: candidates.map(publicCandidate),
      intent: {
        primary: { id: chosen.id, version: chosen.version },
        parameters: reading.parameters,
        references: reading.references,
        confidence: top?.score ?? 0,
        alternates: candidates.slice(1, 4).map(publicCandidate),
      },
      band: top?.band ?? "reject",
      risk: publicRisk(risk),
      secondaryIntents: sensed.intents.slice(1).map(publicCandidate),
      clarification: null,
      toolPlan: [],
      modelProfile: null,
      executionContract: null,
    };

    this.telemetry.record("scout.decision", {
      traceId: id,
      intent: chosen.id,
      band: decision.band,
      latencyMs: Math.round(performance.now() - started),
      stage2: this.stage2 ? "used" : "skipped",
      injection: risk.injection?.detected ? risk.injection.evidence : undefined,
    });

    if (risk.level === "block") {
      this.telemetry.record("contract.refused", { traceId: id, engine: "scout", reason: "guard-block" });
      return decision;
    }

    if (trigger) {
      decision.clarification = this.buildClarification(trigger, candidates, reading.missing, chosen);
      this.telemetry.record("scout.clarification", { traceId: id, trigger });
      if (trigger === "reject") decision.intent.primary = { id: "GENERAL", version: this.intentById("GENERAL").version };
      return decision;
    }

    const dataClass = risk.redactions.length ? "confidential" : "public";
    const modelProfile = chooseModelProfile({
      profiles: this.profiles,
      dataClass,
      riskClass: chosen.riskClass,
    });
    const routed = buildToolPlan({
      intent: mergeCapabilities(chosen, sensed.intents, this.registry),
      graph: this.graph,
      user,
      surface,
      parameters: reading.parameters,
      prompt: risk.redactedPrompt,
    });
    if (routed.missing.length) {
      decision.risk = {
        ...decision.risk,
        level: "block",
        reason: `No tool is available for: ${routed.missing.join(", ")}.`,
      };
      this.telemetry.record("contract.refused", { traceId: id, engine: "scout", reason: "unresolved-capability" });
      return decision;
    }

    const now = Date.now();
    const issuedAt = new Date(now).toISOString();
    const contract = issueContract(
      {
        contractId: ulid(now),
        traceId: id,
        intent: decision.intent,
        risk: {
          level: risk.level,
          flags: risk.flags,
          redactions: risk.redactions.map(({ kind }) => ({ kind })),
          approvals: [],
          approvalsRequired: risk.approvalsRequired,
        },
        toolPlan: routed.steps,
        modelProfile,
        scope: {
          user: { id: user.id, role: user.role },
          surface,
          capabilities: routed.steps.map((step) => step.capability),
        },
        issuedAt,
        expiresAt: new Date(now + this.ttlMs).toISOString(),
        registryVersion: this.registry.version,
        policyPackVersion: this.pack.version,
      },
      this.secret,
    );

    this.issued.set(contract.contractId, { contract, prompt, user, surface, context });
    this.remember(user.id, chosen.id);
    decision.toolPlan = routed.steps;
    decision.modelProfile = modelProfile;
    decision.executionContract = contract;
    this.telemetry.record("contract.issued", {
      traceId: id,
      contractId: contract.contractId,
      intent: chosen.id,
      risk: risk.level,
      profile: modelProfile.id,
    });
    return decision;
  }

  /** Issue a fresh contract in the same trace when a step cannot be finished. */
  async replan({ parent, reason, state }) {
    const prior = this.issued.get(parent);
    if (!prior) throw new Error(`Unknown parent contract ${parent}.`);
    const decision = await this.decide({
      prompt: prior.prompt,
      user: prior.user,
      surface: prior.surface,
      context: { ...prior.context, replan: state },
    });
    if (!decision.executionContract) return decision;
    const rebuilt = {
      ...decision.executionContract,
      parentId: parent,
      traceId: prior.contract.traceId,
      risk: {
        ...decision.executionContract.risk,
        approvals: state?.approval ? [state.approval] : decision.executionContract.risk.approvals,
      },
    };
    delete rebuilt.signature;
    const resigned = issueContract(rebuilt, this.secret);
    this.issued.set(resigned.contractId, { ...prior, contract: resigned });
    decision.executionContract = resigned;
    decision.traceId = resigned.traceId;
    this.telemetry.record("contract.issued", {
      traceId: resigned.traceId,
      contractId: resigned.contractId,
      parentId: parent,
      reason,
      intent: resigned.intent.primary.id,
      risk: resigned.risk.level,
      profile: resigned.modelProfile.id,
    });
    return decision;
  }

  verify(contract) {
    return verifyContract(contract, this.secret);
  }

  intentById(id) {
    const found = this.registry.intents.find((intent) => intent.id === id);
    if (!found) throw new Error(`Intent ${id} is not in the registry.`);
    return found;
  }

  remember(userId, intentId) {
    const history = this.recent.get(userId) ?? [];
    history.push(intentId);
    this.recent.set(userId, history.slice(-8));
  }

  buildClarification(trigger, candidates, missing, chosen) {
    const options = candidates
      .filter((candidate) => candidate.intent !== "GENERAL")
      .slice(0, 4)
      .map((candidate) => {
        const intent = this.intentById(candidate.intent);
        return {
          label: intent.description,
          intent: intent.id,
          prompt: intent.examples[0],
        };
      });
    const questions = {
      params: missing?.length
        ? `I still need ${missing.join(", ")} before I can do that.`
        : "That request is missing a concrete subject, so I will not guess.",
      "low-band": "I am not sure which action you want. Pick the closest one.",
      tie: "Two readings are too close. Which one did you mean?",
      "high-risk": `${chosen.id} is high risk and the match is not confident enough to continue.`,
      reject: "I am not confident enough to act, so this falls back to a safe general reply.",
    };
    return { trigger, question: questions[trigger] ?? questions.reject, options, missing: missing ?? [] };
  }

  /** Fail loudly if a full-registry scan is slower than the 16 ms stage-1 budget. */
  selfTest() {
    const probe = this.registry.intents.find((intent) => intent.examples[0])?.examples[0] ?? "hello";
    for (let i = 0; i < 5; i++) scoreRegistry(probe, this.registry, { stage2: this.stage2 });
    const started = performance.now();
    scoreRegistry(probe, this.registry, { stage2: this.stage2 });
    const elapsed = performance.now() - started;
    if (elapsed > 16) {
      throw new Error(`Stage-1 registry scan took ${elapsed.toFixed(2)} ms, above the 16 ms budget.`);
    }
  }
}

function publicCandidate(candidate) {
  return {
    intent: candidate.intent,
    score: round(candidate.score),
    band: candidate.band ?? bandFor(candidate.score),
    span: candidate.span,
  };
}

function publicRisk(risk) {
  return {
    level: risk.level,
    flags: risk.flags,
    redactions: (risk.redactions ?? []).map(({ kind }) => ({ kind })),
    approvalsRequired: risk.approvalsRequired ?? [],
    reason: risk.reason,
    redactedPrompt: risk.redactedPrompt,
  };
}

function mergeCapabilities(primary, intents, registry) {
  if (!intents || intents.length < 2) return primary;
  const capabilities = [...primary.capabilities];
  for (const hit of intents.slice(1)) {
    const other = registry.intents.find((intent) => intent.id === hit.intent);
    for (const capability of other?.capabilities ?? []) {
      if (!capabilities.includes(capability)) capabilities.push(capability);
    }
  }
  return { ...primary, capabilities };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

export { executeContract, issueContract, verifyContract } from "./contract.js";
