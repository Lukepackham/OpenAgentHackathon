/**
 * Bind intent parameters from the prompt and the caller-supplied context.
 * Interpret never changes scores. If a required parameter is missing, the
 * caller asks for clarification instead of guessing.
 */

const GENERIC = new Set(
  "find me my show looking opportunity opportunities internship internships placement placements hackathon hackathons job jobs entry level entrylevel open what should apply student for that can enter help with a the in on and or to of please some any match skills skill interest interests draft notes application submit now write short which better why does this is fit compare".split(
    " ",
  ),
);

export function interpret({ prompt, intent, context }) {
  const schema = intent.parameters ?? { type: "object", properties: {} };
  const properties = schema.properties ?? {};
  const parameters = {};

  for (const [name, spec] of Object.entries(properties)) {
    const value = bindOne(name, spec, prompt, context);
    if (value !== undefined) parameters[name] = value;
  }

  const missing = (schema.required ?? []).filter((name) => parameters[name] === undefined || parameters[name] === "");
  return {
    parameters,
    missing,
    references: findReferences(prompt),
  };
}

function bindOne(name, spec, prompt, context) {
  if (name === "focus") return bindFocus(prompt, context);
  if (name === "location") return bindLocation(prompt, context);
  if (name === "type" || (Array.isArray(spec.enum) && name === "opportunityType")) {
    return bindType(prompt) ?? (spec.enum ?? []).find((value) => prompt.toLowerCase().includes(String(value)));
  }
  if (name === "target") return bindTarget(prompt);
  if (name === "count" || spec.type === "integer") return bindInteger(prompt, spec);
  if (name === "value" || name === "valueMin") return bindMoney(prompt);
  if (name === "channel" && Array.isArray(spec.enum)) return bindChannel(prompt, spec.enum);
  if (name === "stage") return bindStage(prompt);
  if (name === "account") return bindAccount(prompt);
  if (name === "recipient") return bindRecipient(prompt);
  if (Array.isArray(spec.enum)) {
    return spec.enum.find((value) => prompt.toLowerCase().includes(String(value).toLowerCase()));
  }
  return undefined;
}

function bindFocus(prompt, context) {
  const profile = context?.profile ?? {};
  const fromProfile = [...asList(profile.skills), ...asList(profile.interests)];
  if (fromProfile.length) return fromProfile.join(", ");

  const type = bindType(prompt);
  const location = bindLocation(prompt, context);
  const withoutPlace = location ? prompt.replace(location, " ") : prompt;
  const words = normalizeWords(withoutPlace).filter((word) => !GENERIC.has(word) && word !== type);
  if (words.length) return words.join(" ");
  if (type) return type;
  return undefined;
}

function bindLocation(prompt, context) {
  if (context?.profile?.location) return String(context.profile.location);
  const match = prompt.match(/\bin\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/);
  return match?.[1];
}

function bindType(prompt) {
  const text = prompt.toLowerCase();
  if (text.includes("hackathon")) return "hackathon";
  if (text.includes("placement")) return "placement";
  if (text.includes("internship") || text.includes("internships") || text.includes("intern")) return "internship";
  if (text.includes("entry-level") || text.includes("entry level") || /\bjobs?\b/.test(text)) return "job";
  return undefined;
}

function bindTarget(prompt) {
  const named = prompt.match(/\b(?:for|to|about)\s+(?:the\s+)?([A-Z][^,.?!]+)/);
  if (named) return named[1].replace(/\s+(now|please)$/i, "").trim();
  const nouns = properNouns(prompt);
  if (nouns.length) return nouns.join(" ");
  return undefined;
}

function bindInteger(prompt, spec) {
  const match = prompt.match(/\b(\d{1,4})\b/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (spec.minimum != null && value < spec.minimum) return undefined;
  if (spec.maximum != null && value > spec.maximum) return undefined;
  return value;
}

function bindMoney(prompt) {
  const match = prompt.match(/\$(\d+(?:\.\d+)?)(\s*[kKmM])?/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "").trim().toLowerCase();
  if (unit === "k") return amount * 1000;
  if (unit === "m") return amount * 1000000;
  return amount;
}

function bindChannel(prompt, allowed) {
  const text = prompt.toLowerCase();
  if (text.includes("email") && allowed.includes("email")) return "email";
  if (text.includes("slack") && allowed.includes("slack")) return "slack";
  if (/\bcall\b/.test(text) && allowed.includes("call")) return "call";
  return undefined;
}

function bindStage(prompt) {
  const text = prompt.toLowerCase();
  if (text.includes("closed-won") || text.includes("closed won")) return "closed-won";
  if (text.includes("negotiation")) return "negotiation";
  return undefined;
}

function bindAccount(prompt) {
  const proper = properNouns(prompt);
  return proper.find((word) => !["Maya", "Tuesday", "Friday", "French"].includes(word));
}

function bindRecipient(prompt) {
  const match = prompt.match(/\b(?:to|email)\s+([A-Z][a-z]+)\b/);
  return match?.[1];
}

function findReferences(prompt) {
  const nouns = properNouns(prompt);
  const references = {};
  if (nouns[0]) references.primary = { name: nouns[0], id: null };
  return references;
}

function properNouns(prompt) {
  const skip = new Set(
  "Find Show Draft Write Email What The Give Move Send Summarize Research Compare Plan Pull Schedule Ignore Translate Handle Do Why Explain Help Apply Submit Which Because Please That This".split(
    " ",
  ),
);
  return (prompt.match(/\b[A-Z][A-Za-z0-9]+\b/g) ?? []).filter((word) => !skip.has(word));
}

function normalizeWords(text) {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function asList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}
