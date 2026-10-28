/**
 * One shape for every discovered listing. Fields the source did not state
 * stay empty. review_status is always pending on a new record.
 */
import { randomUUID } from "node:crypto";
import { canonicalUrl } from "./urls.js";

const SOURCES = new Set(["greenhouse", "gradcracker", "trackr", "employer"]);
const VERIFICATION = new Set(["open", "unconfirmed", "closed"]);
const URL_STATUS = new Set(["accessible", "unreachable", "not_checked"]);

export function opportunityType(title) {
  const text = String(title ?? "").toLowerCase();
  if (/\bintern(ship)?s?\b/.test(text)) return "internship";
  if (/\bplacement\b/.test(text)) return "placement";
  if (/\bgraduate\b/.test(text)) return "graduate";
  return "unspecified";
}

export function buildCandidate(input, now = new Date()) {
  const errors = [];
  const title = text(input.title);
  const organisation = text(input.organisation);
  const source = text(input.source);
  if (!title) errors.push("title is required");
  if (!organisation) errors.push("organisation is required");
  if (!SOURCES.has(source)) errors.push("source is not one of greenhouse, gradcracker, trackr, or employer");

  const urlError = input.url ? "" : "url is required";
  if (urlError) errors.push(urlError);
  let url = "";
  if (input.url) {
    try {
      url = canonicalUrl(input.url);
    } catch {
      errors.push("url is not a valid absolute URL");
    }
  }

  const deadline = text(input.deadline);
  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    errors.push("deadline must be an empty string or YYYY-MM-DD");
  }

  const verification = text(input.verification_status) || "unconfirmed";
  if (!VERIFICATION.has(verification)) errors.push("verification_status must be open, unconfirmed, or closed");
  const urlStatus = text(input.url_status) || "not_checked";
  if (!URL_STATUS.has(urlStatus)) errors.push("url_status must be accessible, unreachable, or not_checked");

  if (errors.length) return { ok: false, errors };

  const stamp = now.toISOString();
  return {
    ok: true,
    candidate: {
      id: text(input.id) || `${source}:${randomUUID()}`,
      title,
      organisation,
      type: text(input.type) || opportunityType(title),
      location: text(input.location),
      remote: input.remote === true,
      skills: stringList(input.skills),
      interests: stringList(input.interests),
      eligibility: stringList(input.eligibility),
      deadline,
      requirements: stringList(input.requirements),
      url,
      summary: text(input.summary).slice(0, 500),
      source,
      external_id: text(input.external_id),
      verification_status: verification,
      url_status: urlStatus,
      review_status: "pending",
      discovered_at: stamp,
      updated_at: stamp,
      reviewed_at: null,
    },
  };
}

export function stringList(value) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return items.map((item) => text(item)).filter(Boolean).slice(0, 20);
}

function text(value) {
  return String(value ?? "").trim();
}
