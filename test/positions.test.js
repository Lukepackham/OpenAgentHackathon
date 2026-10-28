import assert from "node:assert/strict";
import { test } from "node:test";
import { rankFits } from "../src/opportunities/fit.js";

const profile = {
  skills: ["python", "javascript"],
  interests: ["web"],
  education: [],
  location: "",
  eligibility: "",
  goals: "I want to become a software engineer",
};

test("similar titles become one career position and the top three stay distinct", () => {
  const ranked = rankFits([
    job("swe-1", "Software Engineering Intern", ["javascript", "python"], "Northwind"),
    job("swe-2", "Graduate Software Engineer", ["javascript"], "Northwind"),
    job("data", "Data Analyst Placement", ["sql", "python"], "Harbour"),
    job("quant", "Quantitative Finance Intern", ["python", "statistics"], "HSBC"),
    job("market", "Marketing Intern", ["communication"], "Bright"),
  ], profile, "I use JavaScript and Python on web projects.");
  assert.equal(ranked.positions.length, 3);
  assert.equal(new Set(ranked.positions.map((position) => position.id)).size, 3);
  assert.equal(ranked.positions[0].id, "software-engineer");
  assert.equal(ranked.positions[0].jobCount, 2);
  assert.equal(ranked.positions[0].reach, "near-term");
  assert.match(ranked.positions[0].explanation, /not a probability of being hired/);
  assert.match(ranked.positions[0].why, /software engineer/i);
  assert.ok(ranked.positions[0].evidenced.some((item) => item.name === "javascript"));
  assert.equal(ranked.positions.some((position) => position.id === "marketing"), false);
});

test("a position roadmap uses that position's gaps and skips unrelated workshops", () => {
  const ranked = rankFits([
    job("data", "Data Analyst Placement", ["sql"], "Harbour"),
    job("design", "Product Design Intern", ["figma"], "Studio"),
  ], { skills: ["python"], interests: [], education: [], location: "", eligibility: "", goals: "" }, "Python coursework.");
  const data = ranked.positions.find((position) => position.id === "data-analyst");
  const design = ranked.positions.find((position) => position.id === "product-design");
  assert.ok(data);
  assert.ok(design);
  assert.equal(data.learning.workshops.some((item) => item.skills.includes("sql")), true);
  assert.equal(data.learning.workshops.some((item) => item.skills.includes("react")), false);
  assert.equal(data.learning.hackathons.every((item) => item.relevance > 0), true);
  assert.notEqual(data.plan[0]?.title, design.plan[0]?.title);
  assert.match(data.gaps[0].reason, /does not show it|does not show/i);
});

test("thin evidence does not invent a third position", () => {
  const ranked = rankFits([
    job("data-1", "Data Analyst Placement", ["python"], "Harbour"),
    job("data-2", "Insights Analyst Intern", ["python"], "Harbour"),
  ], { skills: ["python"], interests: [], education: [], location: "", eligibility: "", goals: "" }, "Python.");
  assert.equal(ranked.positions.length, 1);
  assert.match(ranked.note, /Only 1 distinct/);
  assert.equal(ranked.positions[0].reach === "exploratory" || ranked.positions[0].fitPercent > 0, true);
});

function job(id, title, skills, organisation) {
  return {
    id,
    title,
    organisation,
    skills,
    requirements: [],
    eligibility: [],
    location: "London",
    url: `https://example.com/${id}`,
    summary: title,
  };
}
