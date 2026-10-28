import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Load a Scout intent registry from a parsed object, a JSON file, or a directory
 * of JSON files. An intent with no examples is rejected: examples are both the
 * classifier seeds and the eval fixtures.
 */
export function loadRegistry(source) {
  const raw = typeof source === "string" ? readRegistryPath(source) : source;
  if (!raw || !Array.isArray(raw.intents)) {
    throw new Error("Intent registry must be an object with an intents array.");
  }
  const intents = raw.intents.map(validateIntent);
  if (!intents.some((intent) => intent.id === "GENERAL")) {
    throw new Error("Intent registry must include a GENERAL fallback intent.");
  }
  return {
    version: Number(raw.version ?? 1),
    intents,
  };
}

function readRegistryPath(path) {
  const info = statSync(path);
  if (info.isDirectory()) {
    const intents = [];
    let version = 1;
    for (const name of readdirSync(path)) {
      if (!name.endsWith(".json")) continue;
      const parsed = JSON.parse(readFileSync(join(path, name), "utf8"));
      if (Array.isArray(parsed.intents)) {
        version = parsed.version ?? version;
        intents.push(...parsed.intents);
      } else {
        intents.push(parsed);
      }
    }
    return { version, intents };
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function validateIntent(intent) {
  if (!intent.id || !intent.category || !intent.description) {
    throw new Error(`Intent ${intent.id ?? "(missing id)"} is missing id, category, or description.`);
  }
  if (!Array.isArray(intent.examples) || intent.examples.length === 0) {
    throw new Error(`Intent ${intent.id} has no examples, so it cannot be classified.`);
  }
  return {
    id: intent.id,
    category: intent.category,
    description: intent.description,
    parameters: intent.parameters ?? { type: "object", properties: {} },
    capabilities: intent.capabilities ?? [],
    riskClass: intent.riskClass ?? "low",
    surfaces: intent.surfaces ?? ["chat"],
    roles: intent.roles ?? ["*"],
    examples: intent.examples,
    version: Number(intent.version ?? 1),
  };
}
