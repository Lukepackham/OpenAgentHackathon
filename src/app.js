import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeContract, Scout } from "./scout/index.js";
import { matchOpportunities } from "./opportunities/match.js";
import { rankFits } from "./opportunities/fit.js";
import { loadOpportunitySource } from "./zetaris/client.js";

const here = dirname(fileURLToPath(import.meta.url));
const localCatalog = JSON.parse(readFileSync(join(here, "opportunities", "catalog.json"), "utf8"));
const intentRegistry = join(here, "opportunities", "intents.json");

/**
 * Wire Scout to the opportunity catalog. Search runs only after a verified
 * execution contract. Risky submits stop at the approval gate.
 */
export async function createOpportunityApp(options = {}) {
  const loaded = await loadOpportunitySource(options.zetaris);
  const catalog = loaded.opportunities ?? localCatalog.opportunities;
  const scout = new Scout({
    intentRegistry,
    policyPack: ["default", "student-safety"],
    signingSecret: options.signingSecret,
    rateLimit: options.rateLimit,
  });

  return {
    scout,
    catalog,
    zetaris: loaded.status,
    ask(body) {
      return handle(scout, catalog, normaliseProfile(body?.profile), body?.prompt, body?.user);
    },
    async confirm(contractId) {
      const decision = await scout.replan({
        parent: contractId,
        reason: "user-confirm",
        state: {
          approval: { kind: "user-confirm", at: new Date().toISOString(), confirmation: "yes" },
        },
      });
      return present(scout, catalog, decision, { confirmed: true });
    },
    async matchCv(body) {
      const profile = normaliseProfile(body?.profile);
      const cvText = String(body?.cvText ?? "").slice(0, 200_000);
      const decision = await scout.decide({
        prompt: "Find internships that match my confirmed skills",
        user: { id: body?.user?.id ?? "student-local", role: "student" },
        surface: "chat",
        context: { profile },
      });
      if (decision.risk.level === "block" || decision.clarification || !decision.executionContract) {
        return {
          ok: false,
          outcome: decision.risk.level === "block" ? "blocked" : decision.clarification ? "clarification" : "blocked",
          message: decision.risk.reason || decision.clarification?.question || "No execution contract was issued, so nothing was ranked.",
        };
      }
      const executed = executeContract(decision.executionContract, scout.secret, {
        "catalog.search": () => rankFits(catalog, profile, cvText),
        "profile.read": () => ({ skills: profile.skills, location: profile.location }),
      }, { telemetry: scout.telemetry, engine: "opportunity-scout" });
      if (!executed.ok) {
        return { ok: false, outcome: "blocked", message: `The executor refused the contract (${executed.reason}).` };
      }
      const fit = executed.outputs.find((step) => step.capability === "catalog.search")?.output;
      return {
        ok: true,
        outcome: "results",
        catalogueSize: catalog.length,
        source: loaded.status.source,
        fit,
      };
    },
  };
}

async function handle(scout, catalog, profile, prompt, user) {
  const decision = await scout.decide({
    prompt: String(prompt ?? ""),
    user: { id: user?.id ?? "student-local", role: user?.role ?? "student" },
    surface: "chat",
    context: { profile },
  });
  return present(scout, catalog, decision, { profile, confirmed: false });
}

function present(scout, catalog, decision, { profile, confirmed }) {
  const base = {
    zetaris: undefined,
    traceId: decision.traceId,
    band: decision.band,
    confidence: Math.round(decision.intent.confidence * 1000) / 1000,
    intent: decision.intent.primary.id,
    parameters: decision.intent.parameters,
    risk: {
      level: decision.risk.level,
      reason: decision.risk.reason ?? null,
      flags: decision.risk.flags,
    },
    clarification: decision.clarification,
    contract: summariseContract(decision.executionContract),
    outcome: { kind: "blocked", message: "", opportunities: [] },
  };

  if (decision.risk.level === "block") {
    base.outcome = {
      kind: "blocked",
      message: decision.risk.reason ?? "This request was blocked.",
      opportunities: [],
    };
    return base;
  }

  if (decision.clarification) {
    if (decision.clarification.missing?.includes("focus")) {
      decision.clarification.question = "I still need a skill, interest, or subject before I can search.";
      decision.clarification.options = [
        { label: "Internships", intent: "opportunity.search", prompt: "Find internships that match my skills" },
        { label: "Placements", intent: "opportunity.search", prompt: "Find placements in data" },
        { label: "Hackathons", intent: "opportunity.search", prompt: "Show me hackathons I can enter" },
        { label: "Entry-level jobs", intent: "opportunity.search", prompt: "What entry-level jobs are open?" },
      ];
    }
    base.clarification = decision.clarification;
    base.outcome = {
      kind: "clarification",
      message: decision.clarification.question,
      opportunities: [],
    };
    return base;
  }

  const contract = decision.executionContract;
  if (!contract) {
    base.outcome = {
      kind: "blocked",
      message: "No execution contract was issued, so nothing was searched.",
      opportunities: [],
    };
    return base;
  }
  const needsApproval = (contract.risk.approvalsRequired ?? []).length > (contract.risk.approvals ?? []).length;
  if (needsApproval && !confirmed) {
    base.outcome = {
      kind: "needs-approval",
      message: "This would submit an application. Nothing has been sent. Confirm only if you want the demo to record your approval. It still will not contact an employer.",
      opportunities: [],
    };
    return base;
  }

  const executed = executeContract(contract, scout.secret, handlers(catalog, profile), {
    telemetry: scout.telemetry,
    engine: "opportunity-scout",
    profile,
  });
  if (!executed.ok) {
    base.outcome = {
      kind: "blocked",
      message: `The executor refused the contract (${executed.reason}).`,
      opportunities: [],
    };
    return base;
  }

  const search = executed.outputs.find((step) => step.capability === "catalog.search");
  const opportunities = search?.output ?? [];
  if (decision.intent.primary.id === "application.submit") {
    base.outcome = {
      kind: "acknowledged",
      message: confirmed
        ? "Your confirmation was stored on a new signed contract. This demo does not send applications to employers."
        : "Nothing was sent.",
      opportunities,
    };
    return base;
  }
  if (decision.intent.primary.id === "application.draft") {
    const target = opportunities[0];
    base.outcome = {
      kind: "draft",
      message: target
        ? draftNote(target, profile)
        : "I could not find that listing in the catalog, so I did not invent an application.",
      opportunities,
    };
    return base;
  }

  base.outcome = {
    kind: "results",
    message: opportunities.length
      ? "These listings matched the signed search. Each note says why."
      : "No listings matched. Try another skill or location.",
    opportunities,
  };
  return base;
}

function handlers(catalog, profile) {
  return {
    "catalog.search": (input) =>
      matchOpportunities(catalog, {
        focus: input.focus || input.target,
        type: input.type,
        location: input.location ?? profile?.location,
        skills: profile?.skills,
        interests: profile?.interests,
        eligibility: profile?.eligibility,
        remoteOk: profile?.remoteOk,
      }),
    "profile.read": () => ({
      skills: profile?.skills ?? [],
      interests: profile?.interests ?? [],
      location: profile?.location ?? "",
      eligibility: profile?.eligibility ?? "",
    }),
    "approval.require": () => ({ recorded: true, sentToEmployer: false }),
  };
}

function draftNote(opportunity, profile) {
  const skills = (profile?.skills ?? []).join(", ") || "the skills on your profile";
  return [
    `Draft notes for ${opportunity.title} at ${opportunity.organisation}. Edit these before you use them.`,
    `Opening: I am a ${profile?.eligibility || "student"} interested in ${opportunity.type} work, with experience in ${skills}.`,
    `Why this listing: ${opportunity.reasons[0] ?? opportunity.summary}`,
    `Requirements to mention: ${opportunity.requirements.join("; ")}.`,
    `Deadline: ${opportunity.deadline}. Application link: ${opportunity.url}.`,
    "This is a draft only. It has not been sent.",
  ].join("\n");
}

function summariseContract(contract) {
  if (!contract) return null;
  return {
    contractId: contract.contractId,
    expiresAt: contract.expiresAt,
    intent: contract.intent.primary.id,
    confidence: contract.intent.confidence,
    risk: contract.risk.level,
    capabilities: contract.scope.capabilities,
    approvalsRequired: contract.risk.approvalsRequired ?? [],
    approvals: contract.risk.approvals ?? [],
    signature: contract.signature,
    signedBy: contract.signedBy,
  };
}

function normaliseProfile(profile = {}) {
  return {
    skills: asList(profile.skills),
    interests: asList(profile.interests),
    education: educationList(profile.education),
    location: String(profile.location ?? "").trim(),
    eligibility: String(profile.eligibility ?? "").trim(),
    goals: String(profile.goals ?? "").trim(),
    remoteOk: profile.remoteOk !== false,
  };
}

function educationList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "").split("\n").map((item) => item.trim()).filter(Boolean);
}

function asList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}
