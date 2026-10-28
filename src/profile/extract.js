/**
 * Pulls only terms and education lines that appear in the CV text.
 * A skill is reported when the text contains that phrase, not because it seems likely.
 */
import { docxToText } from "./docx.js";
import { pdfToText } from "./pdf.js";

const SKILL_PHRASES = [
  "object-oriented programming",
  "quantitative analysis",
  "data visualisation",
  "data visualization",
  "machine learning",
  "deep learning",
  "scikit-learn",
  "postgresql",
  "kubernetes",
  "typescript",
  "javascript",
  "tensorflow",
  "powerpoint",
  "power bi",
  "microsoft excel",
  "communication",
  "presentation",
  "leadership",
  "teamwork",
  "problem solving",
  "statistics",
  "research",
  "tableau",
  "pytorch",
  "pandas",
  "numpy",
  "docker",
  "django",
  "spring",
  "react",
  "angular",
  "vue",
  "node.js",
  "next.js",
  "mongodb",
  "sqlite",
  "mysql",
  "redis",
  "matlab",
  "python",
  "excel",
  "linux",
  "jupyter",
  "spark",
  "figma",
  "jira",
  "html",
  "css",
  "sql",
  "java",
  "git",
  "aws",
  "azure",
  "gcp",
  "php",
  "ruby",
  "scala",
  "kotlin",
  "swift",
  "rust",
  "c++",
  "c#",
  "go",
  "r",
].sort((a, b) => b.length - a.length);

const DEGREE = /\b(bsc|msc|phd|beng|meng|bachelor|masters?|degree|undergraduate|postgraduate)\b/i;

export async function extractProfile(input = {}) {
  let text = "";
  try {
    text = await readText(input);
  } catch (error) {
    return { ok: false, error: error.message || "The CV could not be read. Paste the text instead." };
  }
  if (!String(text).trim()) {
    return { ok: false, error: "No CV text was found. Paste the text or choose a TXT, DOCX, or PDF file." };
  }
  if (text.length > 200_000) return { ok: false, error: "That CV text is too large." };
  return {
    ok: true,
    format: input.format,
    skills: findSkills(text),
    education: findEducation(text),
    characterCount: text.length,
    text,
  };
}

export function findSkills(text) {
  const found = [];
  const haystack = ` ${text.toLowerCase()} `;
  for (const phrase of SKILL_PHRASES) {
    if (phrase === "r") {
      if (/\br\b/i.test(text)) found.push("r");
      continue;
    }
    if (phrase === "java" && haystack.includes("javascript")) {
      const withoutJavascript = haystack.replaceAll("javascript", " ");
      if (!hasPhrase(withoutJavascript, "java")) continue;
    }
    if (hasPhrase(haystack, phrase)) found.push(phrase === "data visualization" ? "data visualisation" : phrase);
  }
  return [...new Set(found)];
}

export function findEducation(text) {
  return text
    .split(/[\n.]+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 2 && line.length < 240 && DEGREE.test(line))
    .slice(0, 4);
}

async function readText(input) {
  if (input.base64) {
    const buffer = Buffer.from(String(input.base64), "base64");
    if (!buffer.length) throw new Error("The uploaded file was empty. Paste the CV text instead.");
    if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
      input.format = "pdf";
      return pdfToText(buffer);
    }
    input.format = "docx";
    return docxToText(buffer);
  }
  input.format = input.format ?? "text";
  return String(input.text ?? "");
}

function hasPhrase(haystack, phrase) {
  const pattern = new RegExp(`(?:^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`, "i");
  return pattern.test(haystack);
}
