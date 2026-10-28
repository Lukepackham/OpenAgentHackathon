/**
 * Runs a Greenhouse import, records reviewer submissions, and
 * approves or rejects candidates. The only file it writes is the candidate store.
 */
import { fileURLToPath } from "node:url";
import { mergeCandidates } from "./duplicates.js";
import { fetchGreenhouseBoard } from "./greenhouse.js";
import { sourceLimitations } from "./limits.js";
import { buildCandidate } from "./schema.js";
import { createCandidateStore } from "./store.js";
import { blockedUrlReason } from "./urls.js";
import { checkApplicationUrls } from "./verify.js";

const defaultStorePath = fileURLToPath(new URL("../../data/discovery-candidates.json", import.meta.url));

export function createDiscoveryService(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const store = options.store ?? createCandidateStore(options.storePath ?? defaultStorePath);
  const urlCheckLimit = options.urlCheckLimit ?? 20;
  const now = () => options.now ?? new Date();

  return {
    store,
    limitations: sourceLimitations,
    async run() {
      const fetched = await fetchGreenhouseBoard({
        board: env.GREENHOUSE_BOARD,
        fetchImpl,
        now: now(),
      });
      if (!fetched.ok) {
        return {
          ok: false,
          greenhouse: { ok: false, error: fetched.error, fetched: 0, skipped: 0, added: 0, updated: 0 },
          limitations: sourceLimitations(),
        };
      }
      const checked = await checkApplicationUrls(fetched.candidates, fetchImpl, urlCheckLimit);
      let added = 0;
      let updated = 0;
      if (checked.candidates.length) {
        await store.update((current) => {
          const merged = mergeCandidates(current.candidates, checked.candidates, now());
          added = merged.added;
          updated = merged.updated;
          return { candidates: merged.candidates };
        });
      }
      return {
        ok: true,
        greenhouse: {
          ok: true,
          fetched: fetched.candidates.length,
          skipped: fetched.skipped,
          added,
          updated,
          url_checks: checked.url_checks,
          url_checks_skipped: checked.url_checks_skipped,
        },
        limitations: sourceLimitations(),
      };
    },
    async list(reviewStatus) {
      const data = await store.load();
      const candidates = reviewStatus
        ? data.candidates.filter((item) => item.review_status === reviewStatus)
        : data.candidates;
      return { candidates, count: candidates.length };
    },
    async review({ id, reviewStatus }) {
      if (reviewStatus !== "approved" && reviewStatus !== "rejected") {
        return { ok: false, status: 400, error: "review_status must be approved or rejected." };
      }
      if (!id) return { ok: false, status: 400, error: "id is required." };
      const current = await store.load();
      if (!current.candidates.some((item) => item.id === id)) {
        return { ok: false, status: 404, error: "No discovery candidate has that id." };
      }
      let updated = null;
      await store.update((data) => {
        const candidates = data.candidates.map((item) => {
          if (item.id !== id) return item;
          updated = {
            ...item,
            review_status: reviewStatus,
            reviewed_at: now().toISOString(),
            updated_at: now().toISOString(),
          };
          return updated;
        });
        return { candidates };
      });
      return { ok: true, candidate: publicCandidate(updated) };
    },
    async submit(input) {
      const source = String(input?.source ?? "").trim();
      if (source === "greenhouse") {
        return { ok: false, status: 400, error: "Greenhouse listings come from the job-board API. Submit is for a listing you opened yourself." };
      }
      const built = buildCandidate(
        {
          ...input,
          source,
          verification_status: "unconfirmed",
          url_status: "not_checked",
        },
        now(),
      );
      if (!built.ok) return { ok: false, status: 400, error: built.errors.join(" ") };
      const allowed = allowedManualHost(source, built.candidate.url);
      if (!allowed.ok) return { ok: false, status: 400, error: allowed.error };
      const blocked = blockedUrlReason(built.candidate.url);
      if (blocked) return { ok: false, status: 400, error: blocked };

      const checked = await checkApplicationUrls([built.candidate], fetchImpl, 1);
      const candidate = checked.candidates[0];
      let result = null;
      await store.update((current) => {
        const merged = mergeCandidates(current.candidates, [candidate], now());
        result = merged;
        return { candidates: merged.candidates };
      });
      return {
        ok: true,
        added: result.added,
        updated: result.updated,
        candidate: publicCandidate(result.candidates.find((item) => item.url === candidate.url) ?? candidate),
      };
    },
  };
}

export function publicCandidate(candidate) {
  return {
    id: candidate.id,
    title: candidate.title,
    organisation: candidate.organisation,
    type: candidate.type,
    location: candidate.location,
    remote: candidate.remote,
    skills: candidate.skills,
    interests: candidate.interests,
    eligibility: candidate.eligibility,
    deadline: candidate.deadline,
    requirements: candidate.requirements,
    url: candidate.url,
    summary: candidate.summary,
    source: candidate.source,
    external_id: candidate.external_id,
    verification_status: candidate.verification_status,
    url_status: candidate.url_status,
    review_status: candidate.review_status,
    demo: candidate.demo === true,
    discovered_at: candidate.discovered_at,
    updated_at: candidate.updated_at,
    reviewed_at: candidate.reviewed_at ?? null,
  };
}

function allowedManualHost(source, url) {
  const host = new URL(url).hostname.toLowerCase();
  if (source === "gradcracker") {
    return host === "gradcracker.com" || host === "www.gradcracker.com"
      ? { ok: true }
      : { ok: false, error: "A Gradcracker submission must use a gradcracker.com application link." };
  }
  if (source === "trackr") {
    const allowed = host === "the-trackr.com" || host === "www.the-trackr.com" || host === "app.the-trackr.com";
    return allowed
      ? { ok: true }
      : { ok: false, error: "A Trackr submission must use a the-trackr.com application link." };
  }
  if (source === "employer") {
    if (host === "gradcracker.com" || host.endsWith(".gradcracker.com") || host === "the-trackr.com" || host.endsWith(".the-trackr.com")) {
      return { ok: false, error: "Use the gradcracker or trackr source for those sites." };
    }
    return { ok: true };
  }
  return { ok: false, error: "Submit source must be gradcracker, trackr, or employer." };
}
