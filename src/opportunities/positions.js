/**
 * Groups scored listings into career positions.
 * The fit percentage is the average of those listing scores.
 * It is not a probability of being hired.
 */
import { itemsForGaps } from "../learning/recommend.js";

const FAMILIES = [
  { id: "cybersecurity", title: "Cybersecurity analyst", pattern: /cyber|information security|security analyst/i },
  { id: "mechanical-engineering", title: "Mechanical engineer", pattern: /mechanical/i },
  { id: "product-design", title: "Product designer", pattern: /product design|\bux\b|user experience/i },
  { id: "audio", title: "Audio producer", pattern: /audio/i },
  { id: "marketing", title: "Marketing", pattern: /marketing/i },
  { id: "data-science", title: "Data scientist", pattern: /data scientist|machine learning|\bartificial intelligence\b/i },
  { id: "quantitative-finance", title: "Quantitative finance analyst", pattern: /quant/i },
  { id: "data-analyst", title: "Data analyst", pattern: /data analyst|data engineer|\banalytics\b|\binsights?\b/i },
  { id: "business-analyst", title: "Business analyst", pattern: /business analyst/i },
  { id: "software-engineer", title: "Software engineer", pattern: /software|developer|full[- ]?stack|front[- ]?end|back[- ]?end|\bengineer\b/i },
];

export function selectPositions(scoredJobs, profile) {
  const groups = new Map();
  for (const job of scoredJobs) {
    const family = familyFor(job.title);
    if (!groups.has(family.id)) groups.set(family.id, { ...family, jobs: [] });
    groups.get(family.id).jobs.push(job);
  }
  const built = [...groups.values()].map((group) => buildPosition(group, profile));
  built.sort(comparePositions);
  const supported = built.filter((position) => position.reach !== "exploratory");
  const chosen = supported.slice(0, 3);
  if (chosen.length < 3) {
    for (const extra of built.filter((position) => position.reach === "exploratory")) {
      if (chosen.length >= 3) break;
      chosen.push(extra);
    }
  }
  const note = chosen.length < 3
    ? `Only ${chosen.length} distinct career position${chosen.length === 1 ? "" : "s"} ${chosen.length === 1 ? "is" : "are"} supported by this catalogue.`
    : "";
  return { positions: chosen, note };
}

export function familyFor(title) {
  const text = String(title ?? "");
  const found = FAMILIES.find((family) => family.pattern.test(text));
  if (found) return { id: found.id, title: found.title };
  const stem = text
    .replace(/\b(intern(ship)?|placement|graduate|junior|senior|summer|industrial)\b/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
  const words = stem.split(/\s+/).filter(Boolean).slice(0, 3);
  const label = words.length ? words.join(" ") : "unclassified listing";
  return { id: `other:${label}`, title: label.replace(/\b\w/g, (letter) => letter.toUpperCase()) };
}

function buildPosition(group, profile) {
  const jobs = [...group.jobs].sort((a, b) => b.fitPercent - a.fitPercent || a.title.localeCompare(b.title));
  const fitPercent = Math.round(jobs.reduce((sum, job) => sum + job.fitPercent, 0) / jobs.length);
  const preliminary = jobs.every((job) => job.preliminary);
  const evidenced = uniquePoints(jobs.flatMap((job) => (job.points ?? []).filter((point) => point.matched && point.origin === "skills")));
  const gaps = uniquePoints(jobs.flatMap((job) => (job.points ?? []).filter((point) => !point.matched && point.kind !== "schedule" && point.origin !== "location"))).slice(0, 6);
  const reach = reachFor(fitPercent, evidenced, preliminary);
  const learning = learningFor(gaps);
  return {
    id: group.id,
    title: group.title,
    fitPercent,
    preliminary,
    fitLabel: preliminary ? "Preliminary profile-to-role fit" : "Profile-to-role fit",
    explanation: explainPosition(jobs, fitPercent, preliminary),
    reach,
    reachLabel: reach === "near-term" ? "Realistic near-term target" : reach === "stretch" ? "Stretch position" : "Exploratory suggestion",
    why: whyPosition(group.title, jobs, evidenced, profile),
    evidenced,
    gaps,
    jobs: jobs.slice(0, 5).map(publicJob),
    jobCount: jobs.length,
    learning,
    plan: actionPlan(learning, jobs, gaps),
  };
}

function learningFor(gaps) {
  return {
    courses: [...itemsForGaps(gaps, "course"), ...itemsForGaps(gaps, "certificate"), ...itemsForGaps(gaps, "badge")]
      .sort((a, b) => b.relevance - a.relevance || a.title.localeCompare(b.title))
      .slice(0, 4),
    workshops: itemsForGaps(gaps, "workshop"),
    hackathons: itemsForGaps(gaps, "hackathon"),
    projects: itemsForGaps(gaps, "project"),
  };
}

function actionPlan(learning, jobs, gaps) {
  const gapName = gaps[0]?.name || "a listed requirement";
  const steps = [];
  const first = learning.courses[0] || learning.projects[0];
  if (first) {
    steps.push({
      when: "First",
      title: first.title,
      reason: `${first.why || first.detail} Start here because it is the closest catalogue match to ${gapName}.`,
    });
  }
  const next = learning.workshops[0] || learning.projects.find((item) => item.id !== first?.id) || learning.hackathons[0];
  if (next && next.id !== first?.id) {
    steps.push({
      when: "Next",
      title: next.title,
      reason: `${next.why || next.detail} Do this after the first step so the same gap is practised in a different way.`,
    });
  } else if (!learning.workshops.length && !learning.hackathons.length && learning.projects[0] && learning.projects[0].id !== first?.id) {
    steps.push({
      when: "Next",
      title: learning.projects[0].title,
      reason: "No relevant workshop or hackathon in the demo catalogue names this gap. This project brief is the direct alternative.",
    });
  }
  const job = jobs[0];
  if (job) {
    steps.push({
      when: "Afterwards",
      title: `Review ${job.title}`,
      reason: `This is the highest-scoring live listing in the group, at ${job.fitPercent}% profile-to-role fit. Use the evidence above when you read it. This is not an application and it is not a probability of being hired.`,
    });
  }
  return steps;
}

function explainPosition(jobs, fitPercent, preliminary) {
  const parts = jobs.slice(0, 3).map((job) => `${job.fitPercent}% for ${job.title}`);
  const base = `Averaged ${jobs.length} listing score${jobs.length === 1 ? "" : "s"} (${parts.join("; ")}), which comes to ${fitPercent}%. Each listing score is matched evidence points divided by the points that listing actually provides.`;
  const caution = preliminary
    ? " Preliminary: at least half of these listings lack enough structured fields for a full score."
    : "";
  return `${base}${caution} This is profile-to-role fit, not a probability of being hired. Missing listing fields were not treated as matches.`;
}

function whyPosition(title, jobs, evidenced, profile) {
  const skills = evidenced.map((item) => item.name);
  const skillText = skills.length
    ? `Your confirmed CV evidences ${skills.join(", ")}, which these listings name.`
    : "None of the confirmed CV skills appear in the skill fields of these listings.";
  const interestText = overlapText("interest", profile.interests, jobs, title);
  const goalText = overlapText("goal", profile.goals ? [profile.goals] : [], jobs, title);
  return `${title} groups ${jobs.length} listing${jobs.length === 1 ? "" : "s"} with similar titles. ${skillText}${interestText}${goalText}`;
}

function overlapText(label, values, jobs, title) {
  const items = (values ?? []).map((item) => String(item).trim()).filter(Boolean);
  if (!items.length) return "";
  const haystack = jobs.map((job) => `${job.title} ${job.summary ?? ""}`).join(" ").toLowerCase();
  const position = String(title ?? "").toLowerCase();
  const inListings = items.filter((item) => haystack.includes(item.toLowerCase()));
  const namesPosition = items.filter((item) => !inListings.includes(item) && item.toLowerCase().includes(position));
  if (inListings.length) return ` Your stated ${label} appears in the listing text: ${inListings.join(", ")}.`;
  if (namesPosition.length) return ` Your stated ${label} names this position. That is explained here and is not added as extra points in the percentage.`;
  return ` Your stated ${label} was not found in these listing titles or summaries, so it was not added to the score.`;
}

function reachFor(fitPercent, evidenced, preliminary) {
  if (preliminary || evidenced.length === 0) return "exploratory";
  if (fitPercent >= 50) return "near-term";
  return "stretch";
}

function comparePositions(a, b) {
  const rank = (position) => (position.reach === "exploratory" ? 1 : 0);
  return rank(a) - rank(b) || b.fitPercent - a.fitPercent || b.evidenced.length - a.evidenced.length || a.title.localeCompare(b.title);
}

function uniquePoints(points) {
  const seen = new Set();
  const result = [];
  for (const point of points) {
    const key = String(point.name ?? "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ name: point.name, kind: point.kind, reason: point.reason, origin: point.origin });
  }
  return result;
}

function publicJob(job) {
  return {
    id: job.id,
    title: job.title,
    organisation: job.organisation,
    location: job.location || "",
    deadline: job.deadline || "",
    url: job.url || "",
    fitPercent: job.fitPercent,
    fitLabel: job.fitLabel,
    summary: job.summary || "",
  };
}
