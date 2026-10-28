/**
 * Profile-to-role fit. Each point comes from a field the listing actually has.
 * A blank field is skipped. It is never counted as a match.
 * The percentage is not a probability of being hired.
 */
import { recommendationsForGaps } from "../learning/recommend.js";
import { selectPositions } from "./positions.js";
import { findSkills } from "../profile/extract.js";

const STOP = new Set("a an the and or to of for in on with that this from your you are be is as at by or weeks week".split(" "));

export function rankFits(catalog, profile, cvText = "") {
  const evidenceText = `${cvText}\n${profile.skills.join(" ")}\n${profile.education.join(" ")}`;
  const ranked = catalog.map((opportunity) => scoreFit(opportunity, profile, evidenceText));
  ranked.sort((a, b) => b.fitPercent - a.fitPercent || a.title.localeCompare(b.title));
  const best = ranked[0] ?? null;
  return {
    catalogueSize: catalog.length,
    best,
    recommendations: best ? advise(best.gaps) : [],
    ...selectPositions(ranked, profile),
  };
}

export function scoreFit(opportunity, profile, evidenceText) {
  const points = evidencePoints(opportunity, profile, evidenceText);
  const preliminary = points.length < 2;
  const used = points.length ? points : titleSummaryPoints(opportunity, profile, evidenceText);
  const matched = used.filter((point) => point.matched);
  const total = used.length;
  const fitPercent = total ? Math.round((matched.length / total) * 100) : 0;
  const gaps = used
    .filter((point) => !point.matched && point.kind !== "schedule")
    .slice(0, 4)
    .map(publicGap);
  return {
    id: opportunity.id,
    title: opportunity.title,
    organisation: opportunity.organisation,
    location: opportunity.location || "",
    deadline: opportunity.deadline || "",
    url: opportunity.url || "",
    type: opportunity.type || "",
    summary: opportunity.summary || "",
    fitPercent,
    preliminary,
    fitLabel: preliminary ? "Preliminary profile-to-role fit" : "Profile-to-role fit",
    explanation: explain(matched.length, total, preliminary, used),
    factors: matched.map((point) => point.reason),
    gaps,
    points: used.map(publicPoint),
  };
}

function evidencePoints(opportunity, profile, evidenceText) {
  const points = [];
  for (const skill of splitField(opportunity.skills)) {
    const matched = evidenced(skill, profile);
    points.push({
      origin: "skills",
      kind: "desirable",
      name: skill,
      matched,
      reason: matched
        ? `The skills field lists ${skill}, and your confirmed profile evidences it.`
        : `The skills field lists ${skill}. That does not mean you lack it; the CV text supplied does not show it.`,
    });
  }
  for (const requirement of splitField(opportunity.requirements)) {
    if (isSchedule(requirement)) {
      points.push({
        origin: "requirements",
        kind: "schedule",
        name: requirement,
        matched: requirementEvidenced(requirement, evidenceText),
        reason: `The requirements field states “${requirement}”.`,
      });
      continue;
    }
    const matched = requirementEvidenced(requirement, evidenceText);
    points.push({
      origin: "requirements",
      kind: "required",
      name: shorten(requirement),
      matched,
      reason: matched
        ? `A requirement is evidenced in the CV text: ${shorten(requirement)}.`
        : `The requirements field includes “${shorten(requirement)}”, and the CV text does not show it.`,
    });
  }
  const eligibility = splitField(opportunity.eligibility).join("; ");
  if (eligibility) {
    const matched = requirementEvidenced(eligibility, evidenceText);
    points.push({
      origin: "eligibility",
      kind: "required",
      name: shorten(eligibility),
      matched,
      reason: matched
        ? "The stated eligibility overlaps text in the confirmed profile."
        : `Eligibility is stated as “${shorten(eligibility)}”, and the confirmed profile does not show that wording.`,
    });
  }
  if (profile.location && opportunity.location) {
    const matched = String(opportunity.location).toLowerCase().includes(profile.location.toLowerCase());
    points.push({
      origin: "location",
      kind: "desirable",
      name: opportunity.location,
      matched,
      reason: matched
        ? `The listing location includes ${profile.location}.`
        : `The listing is in ${opportunity.location}, which does not include ${profile.location}.`,
    });
  }
  return points;
}

function titleSummaryPoints(opportunity, profile, evidenceText) {
  const listing = `${opportunity.title ?? ""} ${opportunity.summary ?? ""}`;
  const hits = findSkills(listing).filter((skill) => evidenced(skill, profile));
  if (!hits.length) {
    return [{
      origin: "title-summary",
      kind: "desirable",
      name: "listing text",
      matched: false,
      reason: "The title and summary do not repeat a confirmed skill, and the listing has little structured requirement data.",
    }];
  }
  return hits.map((skill) => ({
    origin: "title-summary",
    kind: "desirable",
    name: skill,
    matched: true,
    reason: `The title or summary mentions ${skill}. This is a preliminary overlap, not a full requirement match.`,
  }));
}

function advise(gaps) {
  return recommendationsForGaps(gaps.filter((gap) => gap.kind !== "schedule"));
}

function evidenced(skill, profile) {
  const wanted = canonical(skill);
  return profile.skills.some((item) => canonical(item) === wanted);
}

function requirementEvidenced(requirement, evidenceText) {
  const skills = findSkills(requirement);
  if (skills.length && skills.every((skill) => findSkills(evidenceText).includes(skill))) return true;
  const tokens = significantTokens(requirement);
  if (!tokens.length) return false;
  const haystack = evidenceText.toLowerCase();
  const hits = tokens.filter((token) => haystack.includes(token));
  return hits.length / tokens.length >= 0.6;
}

function isSchedule(text) {
  return /\b(week|weeks|commencing|deadline|closing|april|june|july)\b/i.test(text) && findSkills(text).length === 0;
}

export function splitField(value) {
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((item) => String(item ?? "").split(/[;\n|]/))
    .map((item) => item.trim())
    .filter(Boolean);
}

function significantTokens(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((token) => token.length > 3 && !STOP.has(token) && !/^\d+$/.test(token));
}

function canonical(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function shorten(value) {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

function explain(matched, total, preliminary, points) {
  const sources = [...new Set(points.map((point) => point.origin))].join(", ");
  const base = `Matched ${matched} of ${total} evidence points from the listing (${sources || "no structured fields"}).`;
  if (preliminary && points.some((point) => point.origin === "title-summary")) {
    return `${base} Preliminary score: the listing does not include structured skills, requirements, or eligibility, so only title and summary overlap is used. This is profile-to-role fit, not a probability of being hired.`;
  }
  if (preliminary) {
    return `${base} Preliminary score: fewer than two structured evidence points were available. This is profile-to-role fit, not a probability of being hired.`;
  }
  return `${base} This is profile-to-role fit, not a probability of being hired. Missing listing fields were not treated as matches.`;
}

function publicGap(point) {
  return { name: point.name, kind: point.kind, reason: point.reason };
}

function publicPoint(point) {
  return { name: point.name, kind: point.kind, matched: point.matched, origin: point.origin, reason: point.reason };
}
