/**
 * A repeated listing updates the candidate already on file.
 * An approved or rejected decision is left as the reviewer set it.
 */
import { safeCanonicalUrl } from "./urls.js";

export function findDuplicate(candidates, candidate) {
  const url = safeCanonicalUrl(candidate.url);
  const externalId = String(candidate.external_id ?? "");
  return (
    candidates.find((item) => {
      if (url && safeCanonicalUrl(item.url) === url) return true;
      if (externalId && item.source === candidate.source && String(item.external_id ?? "") === externalId) return true;
      const incomingHasUrl = Boolean(url);
      const existingHasUrl = Boolean(safeCanonicalUrl(item.url));
      if (!incomingHasUrl || !existingHasUrl) return nameKey(item) === nameKey(candidate) && nameKey(candidate) !== "::";
      return false;
    }) ?? null
  );
}

export function mergeCandidates(existing, incoming, now = new Date()) {
  const candidates = existing.map((item) => ({ ...item }));
  let added = 0;
  let updated = 0;
  for (const item of incoming) {
    const match = findDuplicate(candidates, item);
    if (!match) {
      candidates.push({ ...item, review_status: "pending" });
      added += 1;
      continue;
    }
    const index = candidates.indexOf(match);
    candidates[index] = applyUpdate(match, item, now);
    updated += 1;
  }
  return { candidates, added, updated };
}

function applyUpdate(current, incoming, now) {
  return {
    ...current,
    title: incoming.title || current.title,
    organisation: incoming.organisation || current.organisation,
    type: incoming.type || current.type,
    location: incoming.location || current.location,
    remote: incoming.remote === true,
    skills: preferList(incoming.skills, current.skills),
    interests: preferList(incoming.interests, current.interests),
    eligibility: preferList(incoming.eligibility, current.eligibility),
    deadline: incoming.deadline || current.deadline,
    requirements: preferList(incoming.requirements, current.requirements),
    url: incoming.url || current.url,
    summary: incoming.summary || current.summary,
    source: incoming.source || current.source,
    external_id: incoming.external_id || current.external_id,
    verification_status: incoming.verification_status || current.verification_status,
    url_status: incoming.url_status || current.url_status,
    review_status: current.review_status,
    discovered_at: current.discovered_at,
    reviewed_at: current.reviewed_at ?? null,
    updated_at: now.toISOString(),
  };
}

function preferList(incoming, current) {
  return Array.isArray(incoming) && incoming.length ? incoming : current;
}

function nameKey(candidate) {
  return `${normalise(candidate.organisation)}::${normalise(candidate.title)}`;
}

function normalise(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
