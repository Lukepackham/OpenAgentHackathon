/**
 * HTTP surface for discovery. Changing routes require DISCOVERY_TOKEN.
 * The token is compared and then discarded. It is never written to a response.
 */
import { timingSafeEqual } from "node:crypto";

const REVIEW_FILTERS = new Set(["pending", "approved", "rejected"]);

export async function handleDiscoveryRequest({ method, pathname, searchParams, headers, body, service, env = process.env }) {
  try {
    if (method === "GET" && pathname === "/api/discovery/candidates") {
      const reviewStatus = searchParams?.get?.("review_status") ?? "";
      if (reviewStatus && !REVIEW_FILTERS.has(reviewStatus)) {
        return { status: 400, body: { ok: false, error: "review_status must be pending, approved, or rejected." } };
      }
      const listed = await service.list(reviewStatus);
      return { status: 200, body: { ok: true, ...listed } };
    }

    if (method !== "POST") return { status: 405, body: { ok: false, error: "Method not allowed" } };

    const auth = authorise(headers, env);
    if (!auth.ok) return { status: auth.status, body: { ok: false, error: auth.error } };

    if (pathname === "/api/discovery/run") {
      const report = await service.run();
      return { status: 200, body: report };
    }
    if (pathname === "/api/discovery/review") {
      const reviewed = await service.review({
        id: body?.id,
        reviewStatus: body?.review_status,
      });
      if (!reviewed.ok) return { status: reviewed.status, body: { ok: false, error: reviewed.error } };
      return { status: 200, body: { ok: true, candidate: reviewed.candidate } };
    }
    if (pathname === "/api/discovery/submit") {
      const submitted = await service.submit(body ?? {});
      if (!submitted.ok) return { status: submitted.status, body: { ok: false, error: submitted.error } };
      return {
        status: 200,
        body: {
          ok: true,
          added: submitted.added,
          updated: submitted.updated,
          candidate: submitted.candidate,
        },
      };
    }
    return { status: 404, body: { ok: false, error: "Not found" } };
  } catch {
    return { status: 500, body: { ok: false, error: "Discovery could not complete that request." } };
  }
}

function authorise(headers, env) {
  const expected = env?.DISCOVERY_TOKEN ?? "";
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "Set DISCOVERY_TOKEN before starting the app. Discovery did not change any files.",
    };
  }
  const provided = headerValue(headers, "x-discovery-token");
  if (!tokenMatches(provided, expected)) {
    return { ok: false, status: 401, error: "Discovery token was rejected." };
  }
  return { ok: true };
}

function headerValue(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  if (Array.isArray(value) || value == null) return "";
  return String(value);
}

function tokenMatches(provided, expected) {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
