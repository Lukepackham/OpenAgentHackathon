import { BANDS, HIGH_RISK_PROCEED, TIE_WINDOW, WEIGHTS } from "./defaults.js";

const STOP = new Set(
  "a an the to of and or for me my i you we our your in on at with from about this that is are was were be do does did what whats should how why who when where please just".split(
    " ",
  ),
);

/**
 * Stage 1 is a trigger scan: exact example matches and weighted token overlap.
 * Stage 2, when no embedding model is configured, is token cosine against the
 * same examples. That keeps semantic similarity local and dependency-free.
 *
 * The published formula is
 *   0.40 lexical + 0.35 semantic + 0.20 contextual + 0.05 recency - riskPenalty.
 * Contextual history is omitted until the request actually carries memory.
 * Recency is included only for an intent used earlier in this session, as a
 * boost. A zero recency term is not mixed in, because that would dilute a
 * perfect example match from 1.0 to 0.94 and force every later high-risk
 * request to ask for clarification. When a signal is included, its published
 * weight is used and the active weights are scaled back onto 0..1.
 */
export function scoreRegistry(prompt, registry, { stage2 = true, context, recentIntentIds = [] } = {}) {
  const normalized = normalize(prompt);
  const promptTokens = tokenize(normalized);
  const documents = registry.intents.flatMap((intent) => intent.examples.map(normalize));
  const idf = buildIdf(documents);

  const scored = registry.intents.map((intent) => {
    let lexical = 0;
    let semantic = 0;
    let exact = false;
    let span = prompt;

    for (const example of intent.examples) {
      const exampleNorm = normalize(example);
      if (exampleNorm === normalized) {
        lexical = 1;
        semantic = 1;
        exact = true;
        span = example;
        break;
      }
      const exampleTokens = tokenize(exampleNorm);
      lexical = Math.max(lexical, coverage(promptTokens, exampleTokens, idf));
      if (stage2) semantic = Math.max(semantic, cosine(promptTokens, exampleTokens, idf));
    }

    const hasContext = Boolean(context?.memory || context?.workflow || context?.recentTurns);
    let contextual = 0;
    if (hasContext) {
      const memory = normalize(
        [context.memory, context.workflow, ...(context.recentTurns ?? [])].filter(Boolean).join(" "),
      );
      contextual = cosine(promptTokens, tokenize(memory), idf);
      if (context.workflow && context.workflow === intent.id) contextual = Math.max(contextual, 1);
    }

    const usedRecently = recentIntentIds.includes(intent.id);
    const recency = usedRecently ? 1 : 0;
    const riskPenalty = intent.riskClass === "high" && lexical < 0.95 ? 0.08 : 0;

    const parts = [
      { weight: WEIGHTS.lexical, value: lexical, active: true },
      { weight: WEIGHTS.semantic, value: semantic, active: stage2 },
      { weight: WEIGHTS.contextual, value: contextual, active: hasContext },
      { weight: WEIGHTS.recency, value: recency, active: usedRecently },
    ].filter((part) => part.active);

    const weightSum = parts.reduce((sum, part) => sum + part.weight, 0);
    const blended = parts.reduce((sum, part) => sum + part.weight * part.value, 0) / weightSum;
    const score = clamp(blended - riskPenalty);

    return {
      intent: intent.id,
      score,
      lexical,
      semantic,
      exact,
      span,
      riskClass: intent.riskClass,
      description: intent.description,
      band: bandFor(score),
    };
  });

  scored.sort((a, b) => b.score - a.score || a.intent.localeCompare(b.intent));
  return scored;
}

export function bandFor(score) {
  if (score >= BANDS.high) return "high";
  if (score >= BANDS.medium) return "medium";
  if (score >= BANDS.low) return "low";
  return "reject";
}

/**
 * Clarification triggers from the spec:
 * 1. low band, 2. medium-band tie, 3. missing required parameters or an
 * unresolved reference, 4. high-risk intent below 0.95.
 * Reject band also clarifies and falls back to GENERAL rather than guessing.
 */
export function clarificationTrigger({ candidate, second, missing, unresolved }) {
  if (!candidate) return "reject";
  if (unresolved && !candidate.exact) return "params";
  if (missing?.length) return "params";
  if (candidate.riskClass === "high" && candidate.score < HIGH_RISK_PROCEED) return "high-risk";
  if (candidate.band === "low") return "low-band";
  if (candidate.band === "reject") return "reject";
  if (
    candidate.band === "medium" &&
    second &&
    second.intent !== candidate.intent &&
    candidate.score - second.score <= TIE_WINDOW
  ) {
    return "tie";
  }
  return null;
}

export function hasUnresolvedReference(prompt) {
  return /\b(the thing|do the thing|we talked about|handle the \w+ situation|the situation)\b/i.test(prompt);
}

/**
 * A prompt that exactly matches one example is a single intent, even if it
 * contains the word "and". Otherwise, clauses that each hit a different
 * high-band intent become a multi-intent plan.
 */
export function detectMultiIntent(prompt, registry, options) {
  const whole = scoreRegistry(prompt, registry, options);
  if (whole[0]?.exact) return { candidates: whole, intents: [whole[0]] };

  const clauses = prompt
    .split(/\s+(?:and|,)\s+/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 8);

  if (clauses.length < 2) return { candidates: whole, intents: whole.slice(0, 1) };

  const hits = [];
  for (const clause of clauses) {
    const ranked = scoreRegistry(clause, registry, options);
    const top = ranked.find((candidate) => candidate.intent !== "GENERAL") ?? ranked[0];
    if (top && top.score >= BANDS.high) hits.push({ ...top, span: clause });
  }

  const unique = [];
  for (const hit of hits) {
    if (!unique.some((item) => item.intent === hit.intent)) unique.push(hit);
  }
  if (unique.length < 2) return { candidates: whole, intents: whole.slice(0, 1) };
  return { candidates: whole, intents: unique };
}

export function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenize(normalized) {
  return normalized.split(" ").filter((token) => token && !STOP.has(token));
}

function buildIdf(documents) {
  const df = new Map();
  for (const doc of documents) {
    for (const token of new Set(tokenize(doc))) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const n = documents.length || 1;
  const idf = new Map();
  for (const [token, count] of df) idf.set(token, Math.log((n + 1) / (count + 1)) + 1);
  return idf;
}

function weightOf(token, idf) {
  return idf.get(token) ?? 1;
}

function coverage(promptTokens, exampleTokens, idf) {
  if (!exampleTokens.length || !promptTokens.length) return 0;
  const prompt = new Set(promptTokens);
  let matched = 0;
  let total = 0;
  for (const token of exampleTokens) {
    const weight = weightOf(token, idf);
    total += weight;
    if (prompt.has(token)) matched += weight;
  }
  return total ? matched / total : 0;
}

function cosine(leftTokens, rightTokens, idf) {
  const left = vector(leftTokens, idf);
  const right = vector(rightTokens, idf);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) leftNorm += value * value;
  for (const [token, value] of right) {
    rightNorm += value * value;
    if (left.has(token)) dot += value * left.get(token);
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function vector(tokens, idf) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + weightOf(token, idf));
  return counts;
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}
