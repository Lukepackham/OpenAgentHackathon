/**
 * Picks demo-catalogue items that name a missing skill.
 * A relevance score is overlap with the gap, not a chance of being hired.
 */
import { LEARNING_CATEGORIES, learningCatalogue } from "./catalogue.js";

const EXTRAS = [
  [/quantitative/, ["quantitative analysis", "statistics", "python"]],
  [/object-oriented|\boop\b/, ["object-oriented programming", "java", "python"]],
  [/visuali[sz]ation|\bcharts?\b/, ["data visualisation"]],
  [/machine learning|\bml\b/, ["machine learning", "python"]],
  [/\baws\b|amazon web services/, ["aws"]],
  [/\bazure\b/, ["azure"]],
  [/\bsql\b|database/, ["sql"]],
];

export function recommendationsForGaps(gaps, catalogue = learningCatalogue) {
  const { direct, wanted } = gapSkills(gaps);
  const ranked = catalogue
    .map((item) => scoreItem(item, direct, wanted))
    .sort((a, b) => b.relevance - a.relevance || a.title.localeCompare(b.title));
  const picked = [];
  for (const category of LEARNING_CATEGORIES) {
    const best = ranked.find((item) => item.category === category && item.relevance > 0);
    if (best) picked.push(best);
  }
  return picked.slice(0, 6);
}

export function itemsForGaps(gaps, category, catalogue = learningCatalogue, limit = 3) {
  const { direct, wanted } = gapSkills(gaps);
  return catalogue
    .filter((item) => item.category === category)
    .map((item) => scoreItem(item, direct, wanted))
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || a.title.localeCompare(b.title))
    .slice(0, limit);
}

export function gapSkills(gaps) {
  const direct = new Set();
  const wanted = new Set();
  for (const gap of gaps ?? []) {
    const name = String(gap.name ?? gap ?? "").toLowerCase();
    if (!name) continue;
    direct.add(name);
    wanted.add(name);
    for (const [pattern, skills] of EXTRAS) {
      if (pattern.test(name)) {
        for (const skill of skills) wanted.add(skill);
      }
    }
  }
  return { direct: [...direct], wanted: [...wanted] };
}

function skillNamed(text, skill) {
  if (text === skill) return true;
  const pattern = new RegExp(`(?:^|[^a-z0-9])${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`, "i");
  return pattern.test(text);
}

function scoreItem(item, direct, wanted) {
  const skills = item.skills.map((skill) => skill.toLowerCase());
  const matched = skills.filter((skill) => wanted.some((need) => skillNamed(need, skill)));
  const stated = matched.filter((skill) => direct.some((need) => skillNamed(need, skill)));
  const related = matched.filter((skill) => !stated.includes(skill));
  const relevance = skills.length ? Math.round((matched.length / skills.length) * 100) : 0;
  const addresses = stated[0] || related[0] || "the target role";
  const why = stated.length
    ? `Relevant because the target role lists ${stated.join(", ")} and the confirmed profile does not show it. ${item.disclaimer}`
    : related.length
      ? `Relevant because it practises ${related.join(", ")}, which is related to a gap on the target role. That does not mean the confirmed profile is missing ${related.join(", ")}. ${item.disclaimer}`
      : `Shown from the demo catalogue. It does not name a skill missing from this profile. ${item.disclaimer}`;
  return {
    ...item,
    kind: item.category,
    label: "Demo catalogue",
    relevance,
    addresses,
    detail: `${item.description} ${item.disclaimer}`,
    why,
  };
}
