/**
 * Rank the catalog against a student profile and the parameters Scout bound.
 * Every returned row explains the score in plain sentences and keeps the
 * original requirements, deadline, and application link.
 */
export function matchOpportunities(catalog, criteria = {}, now = new Date()) {
  const skills = lowerList(criteria.skills);
  const interests = lowerList(criteria.interests);
  const focusTokens = tokenize(criteria.focus);
  const location = String(criteria.location ?? "").toLowerCase();
  const type = criteria.type ? String(criteria.type).toLowerCase() : "";
  const eligibility = String(criteria.eligibility ?? "").toLowerCase();
  const remoteOk = criteria.remoteOk !== false;

  const ranked = catalog.map((opportunity) => scoreOne(opportunity, {
    skills,
    interests,
    focusTokens,
    location,
    type,
    eligibility,
    remoteOk,
    now,
  }));

  ranked.sort((a, b) => b.matchScore - a.matchScore || a.title.localeCompare(b.title));
  const useful = ranked.filter((item) => item.matchScore > 0);
  return (useful.length ? useful : ranked).slice(0, criteria.limit ?? 5);
}

function scoreOne(opportunity, criteria) {
  const reasons = [];
  let score = 0;
  const oppSkills = lowerList(opportunity.skills);
  const oppInterests = lowerList(opportunity.interests);
  const skillHits = oppSkills.filter((skill) => criteria.skills.includes(skill) || criteria.focusTokens.includes(skill));
  const interestHits = oppInterests.filter(
    (interest) => criteria.interests.includes(interest) || criteria.focusTokens.includes(interest),
  );

  if (skillHits.length) {
    score += 40 + skillHits.length * 8;
    reasons.push(`Uses ${listPhrase(skillHits)}, which matches your skills or search.`);
  }
  if (interestHits.length) {
    score += 15;
    reasons.push(`Lines up with your interest in ${listPhrase(interestHits)}.`);
  }

  const focusHit = criteria.focusTokens.some((token) =>
    `${opportunity.title} ${opportunity.organisation} ${opportunity.summary} ${opportunity.type}`.toLowerCase().includes(token),
  );
  if (focusHit && !skillHits.length && !interestHits.length) {
    score += 18;
    reasons.push(`The listing text mentions ${criteria.focusTokens.join(" ")}.`);
  }

  if (criteria.type && opportunity.type === criteria.type) {
    score += 20;
    reasons.push(`It is ${article(opportunity.type)} ${opportunity.type}, which is what you asked for.`);
  }

  const place = String(opportunity.location).toLowerCase();
  if (criteria.location && place.includes(criteria.location)) {
    score += 18;
    reasons.push(`Based in ${opportunity.location}, which matches your location.`);
  } else if (opportunity.remote && criteria.remoteOk) {
    score += 8;
    reasons.push("Remote, so your city does not rule it out.");
  }

  const eligible = eligibilityFit(opportunity, criteria.eligibility);
  if (eligible === "yes") {
    score += 12;
    reasons.push(`Open to ${criteria.eligibility || "students at your stage"}.`);
  } else if (eligible === "no") {
    score -= 25;
    reasons.push(`Listed for ${opportunity.eligibility.join(" or ")}, which may not include your stage.`);
  } else {
    reasons.push(`Eligibility listed as ${opportunity.eligibility.join(", ")}. Check it before you apply.`);
  }

  const deadline = new Date(`${opportunity.deadline}T23:59:59`);
  const open = Number.isNaN(deadline.getTime()) ? true : deadline >= criteria.now;
  if (open) {
    score += 6;
    reasons.push(`Deadline ${formatDate(opportunity.deadline)}.`);
  } else {
    score -= 30;
    reasons.push(`The deadline ${formatDate(opportunity.deadline)} has passed, so this is shown only as a closed example.`);
  }

  if (!reasons.length) reasons.push("Included as a nearby listing, but little in your profile overlaps it.");

  return {
    ...opportunity,
    matchScore: Math.max(0, Math.round(score)),
    reasons,
    open,
    requirements: opportunity.requirements ?? [],
    url: opportunity.url,
  };
}

function eligibilityFit(opportunity, eligibility) {
  if (!eligibility) return "unknown";
  const allowed = lowerList(opportunity.eligibility);
  if (allowed.includes("any-student") || allowed.includes(eligibility)) return "yes";
  if (eligibility === "undergraduate" && allowed.includes("penultimate")) return "yes";
  return "no";
}

function lowerList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

function tokenize(value) {
  return lowerList(String(value ?? "").split(/[^a-zA-Z0-9+#.]+/).join(","));
}

function listPhrase(items) {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function article(type) {
  return type === "internship" ? "an" : "a";
}

function formatDate(iso) {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(date);
}
