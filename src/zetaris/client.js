import { randomUUID } from "node:crypto";

/**
 * Zetaris integration.
 *
 * The local platform (UI on port 3000, API on 8888/8889, JDBC on 10000) was
 * inspected before this client was written. GET /api/config answers without
 * credentials. Queries use the path the platform's own verify script uses:
 *   POST /api/auth/login
 *   POST /api/proxy/query/sql/start
 *
 * This module never reads the platform .env file and never writes credentials
 * into a status object. A query runs only when the caller passes a username,
 * password, and SQL string (normally ZETARIS_USERNAME, ZETARIS_PASSWORD, and
 * ZETARIS_OPPORTUNITIES_SQL). The shipped sample databases are not an
 * opportunity catalog, so the default is the local JSON catalog.
 */
export async function loadOpportunitySource(options = {}) {
  const inspected = await inspectZetaris(options);
  const rows = inspected.rows;
  const status = { ...inspected };
  delete status.rows;
  return {
    status,
    opportunities: Array.isArray(rows) && rows.length ? rows : null,
  };
}

export async function inspectZetaris(options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const uiUrl = String(options.uiUrl || process.env.ZETARIS_UI_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
  const status = {
    uiUrl,
    reachable: false,
    authenticated: false,
    source: "local-catalog",
    note: "",
  };

  let configResponse;
  try {
    configResponse = await fetchImpl(`${uiUrl}/api/config`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 1500),
    });
  } catch {
    status.note = "Zetaris UI is not reachable. Using the local catalog.";
    return status;
  }

  status.reachable = configResponse.ok;
  if (!configResponse.ok) {
    status.note = `Zetaris UI responded with HTTP ${configResponse.status}. Using the local catalog.`;
    return status;
  }

  const username = options.username ?? process.env.ZETARIS_USERNAME;
  const password = options.password ?? process.env.ZETARIS_PASSWORD;
  const sql = options.sql ?? process.env.ZETARIS_OPPORTUNITIES_SQL;
  if (!username || !password || !sql) {
    status.note =
      "Zetaris is reachable. Opportunity Scout is using the local catalog because ZETARIS_USERNAME, ZETARIS_PASSWORD, and ZETARIS_OPPORTUNITIES_SQL are not all set. Do not point this at the sample taxi or TPC-DS databases; those are not opportunity listings.";
    return status;
  }

  try {
    const rows = await queryOpportunities({ fetchImpl, uiUrl, username, password, sql });
    status.authenticated = true;
    status.source = "zetaris";
    status.rowCount = rows.length;
    status.note = rows.length
      ? "Loaded opportunities from the configured Zetaris SQL query."
      : "The Zetaris query succeeded but returned no rows. Using the local catalog.";
    status.rows = rows;
    return status;
  } catch (error) {
    status.note = `Zetaris is reachable, but the query was not used (${error.message}). Using the local catalog.`;
    return status;
  }
}

async function queryOpportunities({ fetchImpl, uiUrl, username, password, sql }) {
  const loginResponse = await fetchImpl(`${uiUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!loginResponse.ok) throw new Error(`login HTTP ${loginResponse.status}`);
  const login = await loginResponse.json();
  const token = login.idToken;
  const orgId = login.orgId;
  if (!token || orgId == null) throw new Error("login response was missing idToken or orgId");

  const queryResponse = await fetchImpl(`${uiUrl}/api/proxy/query/sql/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Org-ID": String(orgId),
      "X-Request-ID": randomUUID(),
    },
    body: JSON.stringify({ select: sql, pageLimit: 100 }),
  });
  if (!queryResponse.ok) throw new Error(`query HTTP ${queryResponse.status}`);
  const payload = await queryResponse.json();
  return extractRows(payload).map(normaliseRow).filter((row) => row.title && row.organisation);
}

function extractRows(payload) {
  const found = [];
  walk(payload, found);
  return found;
}

function walk(value, found) {
  if (!value || found.length) return;
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === "object" && !Array.isArray(item))) {
      found.push(...value.filter((item) => item && typeof item === "object"));
    }
    return;
  }
  if (typeof value === "object") {
    for (const nested of Object.values(value)) walk(nested, found);
  }
}

function normaliseRow(row) {
  const read = (...keys) => {
    for (const key of keys) {
      if (row[key] != null && row[key] !== "") return row[key];
    }
    return undefined;
  };
  const skills = splitList(read("skills", "SKILLS"));
  return {
    id: String(read("id", "ID") ?? randomUUID()),
    title: String(read("title", "TITLE") ?? ""),
    organisation: String(read("organisation", "organization", "ORGANISATION") ?? ""),
    type: String(read("type", "TYPE") ?? "internship").toLowerCase(),
    location: String(read("location", "LOCATION") ?? "Remote"),
    remote: String(read("remote", "REMOTE") ?? "false").toLowerCase() === "true",
    skills,
    interests: splitList(read("interests", "INTERESTS")),
    eligibility: splitList(read("eligibility", "ELIGIBILITY")) || ["any-student"],
    deadline: String(read("deadline", "DEADLINE") ?? ""),
    requirements: splitList(read("requirements", "REQUIREMENTS")),
    url: String(read("url", "URL") ?? ""),
    summary: String(read("summary", "SUMMARY") ?? ""),
  };
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}
