import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findDuplicate } from "../src/discovery/duplicates.js";
import { parseGreenhouseBoard } from "../src/discovery/greenhouse.js";
import { handleDiscoveryRequest } from "../src/discovery/http.js";
import { buildCandidate } from "../src/discovery/schema.js";
import { createDiscoveryService } from "../src/discovery/service.js";
import { canonicalUrl } from "../src/discovery/urls.js";
import { checkApplicationUrl } from "../src/discovery/verify.js";

const catalogPath = new URL("../src/opportunities/catalog.json", import.meta.url);
const fixedNow = new Date("2026-10-27T12:00:00Z");

test("parses a Greenhouse board without inventing missing fields", () => {
  const parsed = parseGreenhouseBoard("acme", { name: "Acme Engineering" }, {
    jobs: [
      {
        id: 101,
        title: "Software Engineering Intern",
        absolute_url: "https://boards.greenhouse.io/acme/jobs/101?utm_source=board",
        location: { name: "Manchester, UK" },
        metadata: [{ name: "Application deadline", value: "2026-11-20T00:00:00Z" }],
      },
      {
        id: 102,
        title: "Designer",
        absolute_url: "http://insecure.example/jobs/102",
      },
      {
        title: "Missing id",
        absolute_url: "https://boards.greenhouse.io/acme/jobs/0",
      },
    ],
  }, fixedNow);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.skipped, 2);
  assert.equal(parsed.candidates.length, 1);
  const candidate = parsed.candidates[0];
  assert.equal(candidate.id, "greenhouse:acme:101");
  assert.equal(candidate.organisation, "Acme Engineering");
  assert.equal(candidate.type, "internship");
  assert.equal(candidate.deadline, "2026-11-20");
  assert.equal(candidate.url, "https://boards.greenhouse.io/acme/jobs/101");
  assert.deepEqual(candidate.skills, []);
  assert.deepEqual(candidate.requirements, []);
  assert.equal(candidate.summary, "");
  assert.equal(candidate.verification_status, "open");
  assert.equal(candidate.review_status, "pending");
  assert.equal(candidate.url_status, "not_checked");

  const unnamed = parseGreenhouseBoard("acme", {}, { jobs: [] });
  assert.equal(unnamed.ok, false);
  assert.equal(unnamed.candidates.length, 0);
});

test("a new candidate stays pending even if the caller asks for approval", () => {
  const built = buildCandidate({
    title: "Graduate Engineer",
    organisation: "Acme Engineering",
    url: "https://careers.example.com/jobs/9",
    source: "employer",
    review_status: "approved",
    verification_status: "open",
  });
  assert.equal(built.ok, true);
  assert.equal(built.candidate.review_status, "pending");
  assert.equal(built.candidate.verification_status, "open");
  assert.equal(built.candidate.type, "graduate");
});

test("duplicate detection uses the canonical link, then title and employer when a link is missing", () => {
  assert.equal(
    canonicalUrl("https://boards.greenhouse.io/acme/jobs/101/?utm_source=board"),
    "https://boards.greenhouse.io/acme/jobs/101",
  );
  const saved = {
    id: "manual:1",
    title: "Software Intern",
    organisation: "Northwind Labs",
    url: "",
    source: "employer",
  };
  assert.equal(findDuplicate([saved], {
    title: "software intern",
    organisation: "Northwind Labs",
    url: "https://careers.example.com/jobs/1",
    source: "employer",
  }).id, "manual:1");
  assert.equal(findDuplicate([{ ...saved, url: "https://careers.example.com/jobs/1" }], {
    title: "Software Intern",
    organisation: "Northwind Labs",
    url: "https://careers.example.com/jobs/2",
    source: "employer",
  }), null);
});

test("an accessible link does not change an open verification status", async () => {
  const result = await checkApplicationUrl("https://careers.example.com/jobs/1", async () => response(200));
  assert.equal(result.url_status, "accessible");
  const missing = await checkApplicationUrl("https://careers.example.com/closed", async () => response(404));
  assert.equal(missing.url_status, "unreachable");
  const timedOut = await checkApplicationUrl("https://careers.example.com/slow", async () => {
    const error = new Error("timed out");
    error.name = "TimeoutError";
    throw error;
  });
  assert.equal(timedOut.url_status, "unreachable");
  const blocked = await checkApplicationUrl("https://127.0.0.1/admin", async () => {
    throw new Error("should not fetch");
  });
  assert.equal(blocked.url_status, "unreachable");
  assert.match(blocked.detail, /private network/);
});

test("discovery run saves Greenhouse jobs and leaves the student catalogue unchanged", async () => {
  const before = readFileSync(catalogPath);
  const { service, filePath, calls } = await testService();
  const report = await service.run();
  assert.equal(report.ok, true);
  assert.equal(report.greenhouse.added, 1);
  assert.equal(report.greenhouse.fetched, 1);
  assert.equal(report.limitations.map((item) => item.source).join(","), "gradcracker,trackr");
  assert.equal(report.limitations.every((item) => item.automated === false), true);
  assert.equal(calls.some((url) => url.includes("gradcracker") || url.includes("trackr")), false);

  const stored = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(stored.candidates[0].review_status, "pending");
  assert.equal(stored.candidates[0].verification_status, "open");
  assert.equal(stored.candidates[0].url_status, "unreachable");
  assert.equal(stored.candidates[0].deadline, "");
  assert.equal(stored.candidates[0].remote, true);
  assert.deepEqual(readFileSync(catalogPath), before);

  await service.review({ id: stored.candidates[0].id, reviewStatus: "approved" });
  const second = await service.run();
  assert.equal(second.greenhouse.added, 0);
  assert.equal(second.greenhouse.updated, 1);
  const again = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(again.candidates.length, 1);
  assert.equal(again.candidates[0].review_status, "approved");
});

test("a failed Greenhouse request writes no candidate file", async () => {
  const { service, filePath } = await testService({
    jobsStatus: 503,
  });
  const report = await service.run();
  assert.equal(report.ok, false);
  assert.match(report.greenhouse.error, /HTTP 503/);
  await assert.rejects(readFile(filePath, "utf8"));
});

test("Gradcracker and Trackr cannot be fetched, and a pasted listing stays unconfirmed", async () => {
  const { service, calls } = await testService();
  const rejected = await service.submit({
    source: "trackr",
    title: "Technology Intern",
    organisation: "Example Bank",
    url: "https://127.0.0.1/secret",
  });
  assert.equal(rejected.ok, false);
  assert.equal(calls.length, 0);

  const submitted = await service.submit({
    source: "employer",
    title: "Placement Analyst",
    organisation: "Harbour Careers",
    url: "https://careers.example.com/roles/placement",
    deadline: "2026-12-01",
    verification_status: "open",
  });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.candidate.review_status, "pending");
  assert.equal(submitted.candidate.verification_status, "unconfirmed");
  assert.equal(submitted.candidate.url_status, "accessible");
  assert.equal(submitted.candidate.deadline, "2026-12-01");
});

test("changing discovery routes require a token and only the review file changes", async () => {
  const { service, filePath } = await testService();
  const missing = await handleDiscoveryRequest({
    method: "POST",
    pathname: "/api/discovery/run",
    headers: {},
    body: {},
    service,
    env: {},
  });
  assert.equal(missing.status, 503);
  assert.equal(JSON.stringify(missing.body).includes("choose-a-long"), false);
  await assert.rejects(readFile(filePath, "utf8"));

  const wrong = await handleDiscoveryRequest({
    method: "POST",
    pathname: "/api/discovery/review",
    headers: { "x-discovery-token": "nope" },
    body: { id: "greenhouse:acme:101", review_status: "approved" },
    service,
    env: { DISCOVERY_TOKEN: "local-test-token" },
  });
  assert.equal(wrong.status, 401);
  assert.equal(JSON.stringify(wrong.body).includes("local-test-token"), false);

  await service.run();
  const reviewed = await handleDiscoveryRequest({
    method: "POST",
    pathname: "/api/discovery/review",
    headers: { "x-discovery-token": "local-test-token" },
    body: { id: "greenhouse:acme:101", review_status: "rejected" },
    service,
    env: { DISCOVERY_TOKEN: "local-test-token" },
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.candidate.review_status, "rejected");
  assert.equal(reviewed.body.candidate.verification_status, "open");
  const stored = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(stored.candidates[0].review_status, "rejected");

  const listed = await handleDiscoveryRequest({
    method: "GET",
    pathname: "/api/discovery/candidates",
    searchParams: new URLSearchParams("review_status=rejected"),
    headers: {},
    service,
    env: {},
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.count, 1);
});

async function testService({ jobsStatus = 200 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "opportunity-scout-discovery-"));
  const filePath = join(directory, "candidates.json");
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const target = String(url);
    if (target.endsWith("/jobs")) return response(jobsStatus, greenhouseJobs());
    if (target.includes("boards-api.greenhouse.io")) return response(200, { name: "Acme Engineering" });
    if (target.startsWith("https://boards.greenhouse.io/")) return response(404);
    if (target.startsWith("https://careers.example.com/")) return response(200);
    throw new Error(`unexpected fetch ${target}`);
  };
  const service = createDiscoveryService({
    env: { GREENHOUSE_BOARD: "acme" },
    fetch: fetchImpl,
    storePath: filePath,
    now: fixedNow,
    urlCheckLimit: 5,
  });
  return { service, filePath, calls };
}

function greenhouseJobs() {
  return {
    jobs: [
      {
        id: 101,
        title: "Software Engineering Intern",
        absolute_url: "https://boards.greenhouse.io/acme/jobs/101",
        location: { name: "Remote - UK" },
        metadata: null,
      },
    ],
  };
}

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    body: { cancel: async () => undefined },
  };
}
