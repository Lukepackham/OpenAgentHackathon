/**
 * Sample review-queue rows. They are labelled demo data and are never
 * written into the student-facing Zetaris catalogue.
 */
import { mergeCandidates } from "./duplicates.js";
import { buildCandidate } from "./schema.js";

const ROLES = [
  ["Data analyst intern", "Harbour Analytics (demo)", "London", "internship", ["python", "sql", "statistics"]],
  ["Quantitative research intern", "North Quay Research (demo)", "London", "internship", ["python", "quantitative analysis", "statistics"]],
  ["Machine learning intern", "Lumen Health (demo)", "Cambridge", "internship", ["machine learning", "python", "pandas"]],
  ["Software engineering intern", "Paperkite (demo)", "Manchester", "internship", ["javascript", "react", "git"]],
  ["Java backend intern", "Ledger Lane (demo)", "Leeds", "internship", ["java", "object-oriented programming", "sql"]],
  ["Cloud support intern", "Nimbus Desk (demo)", "Remote, UK", "internship", ["aws", "linux", "git"]],
  ["Azure data intern", "Fells Systems (demo)", "Edinburgh", "internship", ["azure", "sql", "python"]],
  ["Business analyst placement", "Civic Ledger (demo)", "Birmingham", "placement", ["excel", "sql", "communication"]],
  ["Frontend placement", "Brightroom (demo)", "Bristol", "placement", ["javascript", "css", "react"]],
  ["Data visualisation placement", "Chartwell Studio (demo)", "Cardiff", "placement", ["tableau", "data visualisation", "sql"]],
  ["Graduate data analyst", "Harbour Analytics (demo)", "London", "graduate", ["python", "sql", "excel"]],
  ["Graduate software engineer", "Paperkite (demo)", "Manchester", "graduate", ["java", "javascript", "git"]],
  ["Graduate cloud engineer", "Nimbus Desk (demo)", "Remote, UK", "graduate", ["aws", "docker", "python"]],
  ["Research assistant", "North Quay Research (demo)", "London", "internship", ["research", "statistics", "python"]],
  ["Product analyst intern", "Civic Ledger (demo)", "Birmingham", "internship", ["sql", "communication", "excel"]],
  ["AI engineering intern", "Lumen Health (demo)", "Cambridge", "internship", ["machine learning", "tensorflow", "python"]],
  ["Platform intern", "Fells Systems (demo)", "Edinburgh", "internship", ["docker", "linux", "git"]],
  ["Insights intern", "Chartwell Studio (demo)", "Cardiff", "internship", ["power bi", "excel", "data visualisation"]],
  ["Technology graduate", "Ledger Lane (demo)", "Leeds", "graduate", ["object-oriented programming", "java", "sql"]],
  ["Customer solutions analyst", "Brightroom (demo)", "Bristol", "graduate", ["communication", "excel", "sql"]],
];

export function demoCandidates(now = new Date()) {
  return ROLES.map(([title, organisation, location, type, skills], index) => {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const built = buildCandidate(
      {
        id: `demo:seed:${slug}`,
        title,
        organisation,
        source: "employer",
        type,
        location,
        remote: location.startsWith("Remote"),
        skills,
        requirements: [`Evidence of ${skills[0]} you can talk through`],
        summary: `Demo seed. ${title} is sample review-queue data, not a live opening and not part of the student job catalogue. The sample asks for ${skills.join(", ")}.`,
        url: `https://example.com/demo/jobs/${slug}`,
        external_id: `demo-${index + 1}`,
        deadline: index < 8 ? "2027-03-31" : "",
        verification_status: "unconfirmed",
        url_status: "not_checked",
      },
      now,
    );
    if (!built.ok) throw new Error(built.errors.join(" "));
    return { ...built.candidate, demo: true };
  });
}

export async function ensureDemoSeed(store, now = new Date()) {
  const incoming = demoCandidates(now);
  return store.update((current) => {
    const merged = mergeCandidates(current.candidates, incoming, now);
    return { candidates: merged.candidates };
  });
}
