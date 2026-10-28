import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extractProfile, findSkills } from "../src/profile/extract.js";
import { docxToText } from "../src/profile/docx.js";
import { rankFits, scoreFit } from "../src/opportunities/fit.js";
import { createOpportunityApp } from "../src/app.js";

test("extracts only skills that appear, and does not treat JavaScript as Java", async () => {
  const extracted = await extractProfile({
    text: "I used Python and JavaScript during my MSc in Mathematics.",
  });
  assert.equal(extracted.ok, true);
  assert.ok(extracted.skills.includes("python"));
  assert.ok(extracted.skills.includes("javascript"));
  assert.equal(extracted.skills.includes("java"), false);
  assert.ok(extracted.education.some((line) => /msc/i.test(line)));
  assert.equal(findSkills("no technical terms here").length, 0);
});

test("rejects empty text and a PDF that is not a document", async () => {
  assert.equal((await extractProfile({ text: "   " })).ok, false);
  const broken = await extractProfile({ base64: Buffer.from("%PDF-1.7 not a real document").toString("base64") });
  assert.equal(broken.ok, false);
  assert.match(broken.error, /PDF|Paste/i);
  assert.throws(() => docxToText(Buffer.from("this is not a document")), /Paste the text/);
});

test("reads skill phrases from a DOCX document.xml entry", async () => {
  const xml = "<w:document><w:p><w:t>Used SQL and machine learning.</w:t></w:p></w:document>";
  const text = docxToText(storedZip("word/document.xml", xml));
  assert.match(text, /SQL and machine learning/);
  const extracted = await extractProfile({ text });
  assert.deepEqual(extracted.skills.filter((skill) => skill === "sql" || skill === "machine learning").sort(), [
    "machine learning",
    "sql",
  ]);
});

test("fit percentage uses only present fields and does not count missing data as a match", () => {
  const profile = { skills: ["python"], education: [], location: "", eligibility: "" };
  const cv = "Completed an MSc project using Python.";
  const scored = scoreFit({
    id: "quant",
    title: "Quantitative Intern",
    organisation: "HSBC",
    skills: ["Python; SQL"],
    requirements: ["Build models in Python"],
    eligibility: ["MSc student"],
    location: "London",
    deadline: "2027-04-01",
    url: "https://example.com/quant",
  }, profile, cv);
  assert.equal(scored.preliminary, false);
  assert.equal(scored.fitPercent, 50);
  assert.equal(scored.gaps.some((gap) => gap.name.toLowerCase() === "sql" && gap.kind === "desirable"), true);
  assert.match(scored.explanation, /not a probability of being hired/);
  assert.equal(scored.factors.some((factor) => /sql/i.test(factor) && /evidences it/i.test(factor)), false);
});

test("a listing without structured requirements gets a labelled preliminary score", () => {
  const scored = scoreFit({
    title: "Python intern",
    organisation: "Example",
    summary: "A Python internship.",
    skills: [],
    requirements: [],
    eligibility: [],
    location: "",
    url: "https://example.com/py",
  }, { skills: ["python"], education: [], location: "", eligibility: "" }, "Python coursework.");
  assert.equal(scored.preliminary, true);
  assert.match(scored.explanation, /Preliminary/);
  assert.equal(scored.fitPercent, 100);
});

test("ranking stays on the supplied catalogue and labels project advice as generated", async () => {
  const ranked = rankFits([
    {
      id: "quant",
      title: "Quantitative Intern",
      organisation: "HSBC",
      skills: ["Python; SQL"],
      requirements: ["Build models in Python"],
      eligibility: ["MSc student"],
      location: "London",
      url: "https://example.com/quant",
    },
    {
      id: "other",
      title: "Facilities assistant",
      organisation: "Other",
      skills: ["excel"],
      requirements: [],
      eligibility: [],
      location: "",
      url: "https://example.com/other",
    },
  ], { skills: ["python"], education: [], location: "", eligibility: "" }, "MSc project using Python.");
  assert.equal(ranked.best.organisation, "HSBC");
  assert.equal(ranked.recommendations.every((item) => item.demo === true), true);
  assert.equal(ranked.recommendations.every((item) => /not a verified/i.test(item.disclaimer)), true);
  assert.equal(ranked.recommendations.some((item) => item.category === "project"), true);
  assert.equal(ranked.recommendations.some((item) => item.skills.includes("sql")), true);

  const app = await createOpportunityApp({ zetaris: { fetch: () => Promise.reject(new Error("offline")) } });
  const matched = await app.matchCv({
    cvText: "I use JavaScript and Python.",
    profile: { skills: "javascript, python", education: "", location: "Manchester", eligibility: "undergraduate" },
  });
  assert.equal(matched.ok, true);
  assert.equal(matched.source, "local-catalog");
  assert.equal(JSON.stringify(matched).includes("discovery-candidates"), false);
  const source = readFileSync(new URL("../src/opportunities/fit.js", import.meta.url), "utf8");
  assert.equal(source.includes("discovery-candidates"), false);
});

function storedZip(name, content) {
  const data = Buffer.from(content);
  const nameBytes = Buffer.from(name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  return Buffer.concat([header, nameBytes, data]);
}
