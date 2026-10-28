/**
 * Greenhouse publishes an unauthenticated job-board API.
 * A job in that list is a vacancy the employer is currently publishing.
 * https://developers.greenhouse.io/job-board.html
 */
import { buildCandidate, opportunityType } from "./schema.js";

const API = "https://boards-api.greenhouse.io/v1/boards";

export function assertBoardToken(board) {
  const token = String(board ?? "").trim();
  if (!token) {
    return { ok: false, error: "GREENHOUSE_BOARD is not set, so no employer board was queried." };
  }
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(token)) {
    return { ok: false, error: "GREENHOUSE_BOARD has characters the Greenhouse job-board API does not use. Nothing was queried." };
  }
  return { ok: true, token };
}

export function parseGreenhouseBoard(board, boardBody, jobsBody, now = new Date()) {
  const organisation = String(boardBody?.name ?? "").trim();
  if (!organisation) {
    return {
      ok: false,
      error: "Greenhouse did not return an organisation name, so no listings were saved.",
      candidates: [],
      skipped: 0,
    };
  }
  if (!Array.isArray(jobsBody?.jobs)) {
    return {
      ok: false,
      error: "Greenhouse returned an unexpected job list, so nothing was saved.",
      candidates: [],
      skipped: 0,
    };
  }

  const candidates = [];
  let skipped = 0;
  for (const job of jobsBody.jobs) {
    const built = jobToCandidate(board, organisation, job, now);
    if (!built.ok) {
      skipped += 1;
      continue;
    }
    candidates.push(built.candidate);
  }
  return { ok: true, candidates, skipped };
}

export async function fetchGreenhouseBoard({ board, fetchImpl, timeoutMs = 10000, now = new Date() }) {
  const checked = assertBoardToken(board);
  if (!checked.ok) return { ok: false, error: checked.error, candidates: [], skipped: 0 };

  const token = checked.token;
  try {
    const [boardResponse, jobsResponse] = await Promise.all([
      fetchImpl(`${API}/${encodeURIComponent(token)}`, requestOptions(timeoutMs)),
      fetchImpl(`${API}/${encodeURIComponent(token)}/jobs`, requestOptions(timeoutMs)),
    ]);
    if (!boardResponse.ok) {
      return failed(`Greenhouse board request failed (HTTP ${boardResponse.status}). No listings were saved.`);
    }
    if (!jobsResponse.ok) {
      return failed(`Greenhouse jobs request failed (HTTP ${jobsResponse.status}). No listings were saved.`);
    }
    const boardBody = await boardResponse.json();
    const jobsBody = await jobsResponse.json();
    return parseGreenhouseBoard(token, boardBody, jobsBody, now);
  } catch (error) {
    const reason = error?.name === "TimeoutError" ? "timed out" : "could not be reached";
    return failed(`Greenhouse ${reason}. No listings were saved.`);
  }
}

function jobToCandidate(board, organisation, job, now) {
  const title = String(job?.title ?? "").trim();
  const url = String(job?.absolute_url ?? "").trim();
  const externalId = job?.id == null ? "" : String(job.id);
  if (!title || !url || !externalId || !url.startsWith("https://")) return { ok: false };
  const location = String(job?.location?.name ?? "").trim();
  return buildCandidate(
    {
      id: `greenhouse:${board}:${externalId}`,
      title,
      organisation,
      type: opportunityType(title),
      location,
      remote: /\bremote\b/i.test(location),
      skills: [],
      interests: [],
      eligibility: [],
      deadline: deadlineFromMetadata(job?.metadata),
      requirements: [],
      url,
      summary: "",
      source: "greenhouse",
      external_id: externalId,
      verification_status: "open",
      url_status: "not_checked",
    },
    now,
  );
}

function deadlineFromMetadata(metadata) {
  const entries = metadataEntries(metadata);
  for (const entry of entries) {
    if (!/deadline|closing date|apply by/i.test(entry.name)) continue;
    const value = String(entry.value ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  }
  return "";
}

function metadataEntries(metadata) {
  if (Array.isArray(metadata)) {
    return metadata.map((entry) => ({
      name: String(entry?.name ?? entry?.label ?? ""),
      value: entry?.value ?? entry?.value_text ?? "",
    }));
  }
  if (metadata && typeof metadata === "object") {
    return Object.entries(metadata).map(([name, value]) => ({ name, value }));
  }
  return [];
}

function requestOptions(timeoutMs) {
  return {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json" },
  };
}

function failed(error) {
  return { ok: false, error, candidates: [], skipped: 0 };
}
