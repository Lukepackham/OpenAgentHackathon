import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { demoCandidates, ensureDemoSeed } from "../src/discovery/demo-seed.js";
import { createCandidateStore } from "../src/discovery/store.js";
import { LEARNING_CATEGORIES, learningCatalogue } from "../src/learning/catalogue.js";
import { recommendationsForGaps } from "../src/learning/recommend.js";
import { extractProfile } from "../src/profile/extract.js";

test("the demo catalogue has five labelled entries in each category", () => {
  for (const category of LEARNING_CATEGORIES) {
    const items = learningCatalogue.filter((item) => item.category === category);
    assert.ok(items.length >= 5, category);
    assert.equal(items.every((item) => item.demo === true && /not a verified/i.test(item.disclaimer)), true);
  }
});

test("gap recommendations stay inside the demo catalogue and name the missing skill", () => {
  const picked = recommendationsForGaps([{ name: "sql", kind: "desirable" }]);
  assert.ok(picked.some((item) => item.skills.includes("sql") && item.relevance > 0));
  assert.equal(picked.every((item) => item.demo === true), true);
  assert.equal(picked.some((item) => /accredited qualification/i.test(item.title)), false);
});

test("a simple PDF yields its text and a broken PDF does not become an empty profile", async () => {
  const extracted = await extractProfile({ base64: makeSimplePdf("Python and SQL").toString("base64") });
  assert.equal(extracted.ok, true);
  assert.equal(extracted.format, "pdf");
  assert.ok(extracted.skills.includes("python"));
  assert.ok(extracted.skills.includes("sql"));
  const broken = await extractProfile({ base64: Buffer.from("%PDF-1.7 broken").toString("base64") });
  assert.equal(broken.ok, false);
  assert.ok(broken.error);
  assert.equal(broken.skills, undefined);
});

test("demo seeds add twenty labelled rows and leave an existing Greenhouse row alone", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scout-demo-"));
  const store = createCandidateStore(join(directory, "candidates.json"));
  await store.update(() => ({
    candidates: [{
      id: "greenhouse:gitlab:1",
      title: "Existing board role",
      organisation: "GitLab",
      url: "https://job-boards.greenhouse.io/gitlab/jobs/1",
      source: "greenhouse",
      review_status: "approved",
      skills: [],
      summary: "",
    }],
  }));
  await ensureDemoSeed(store, new Date("2026-10-27T00:00:00.000Z"));
  const stored = await store.load();
  const demo = stored.candidates.filter((item) => item.demo === true);
  assert.equal(demoCandidates().length, 20);
  assert.equal(demo.length, 20);
  assert.equal(demo.every((item) => item.summary.startsWith("Demo seed.")), true);
  assert.equal(demo.every((item) => item.url.startsWith("https://example.com/demo/jobs/")), true);
  const existing = stored.candidates.find((item) => item.id === "greenhouse:gitlab:1");
  assert.equal(existing.review_status, "approved");
  assert.equal(existing.organisation, "GitLab");
  const catalogue = await readFile(new URL("../src/opportunities/catalog.json", import.meta.url), "utf8");
  assert.equal(catalogue.includes("Harbour Analytics"), false);
});

function makeSimplePdf(text) {
  const stream = `BT /F1 12 Tf 20 80 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
