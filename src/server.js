import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpportunityApp } from "./app.js";
import { handleDiscoveryRequest } from "./discovery/http.js";
import { createDiscoveryService } from "./discovery/service.js";
import { extractProfile } from "./profile/extract.js";
import { ensureDemoSeed } from "./discovery/demo-seed.js";
import { LEARNING_DISCLAIMER, learningCatalogue } from "./learning/catalogue.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(root, "../public");
const port = Number(process.env.PORT ?? 4173);
const app = await createOpportunityApp();
const discovery = createDiscoveryService();
await ensureDemoSeed(discovery.store);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname.startsWith("/api/discovery")) {
      const body = request.method === "POST" ? await readBody(request) : {};
      const result = await handleDiscoveryRequest({
        method: request.method,
        pathname: url.pathname,
        searchParams: url.searchParams,
        headers: request.headers,
        body,
        service: discovery,
      });
      return sendJson(response, result.status, result.body);
    }
    if (request.method === "GET" && url.pathname === "/api/status") {
      return sendJson(response, 200, { ok: true, zetaris: app.zetaris });
    }
    if (request.method === "POST" && url.pathname === "/api/ask") {
      const body = await readBody(request);
      const result = await app.ask(body);
      result.zetaris = app.zetaris;
      return sendJson(response, 200, result);
    }
    if (request.method === "POST" && url.pathname === "/api/confirm") {
      const body = await readBody(request);
      if (!body.contractId) return sendJson(response, 400, { error: "contractId is required" });
      const result = await app.confirm(body.contractId);
      result.zetaris = app.zetaris;
      return sendJson(response, 200, result);
    }
    if (request.method === "GET" && url.pathname === "/api/learning") {
      return sendJson(response, 200, {
        ok: true,
        disclaimer: LEARNING_DISCLAIMER,
        catalogue: learningCatalogue,
      });
    }
    if (request.method === "POST" && url.pathname === "/api/cv/extract") {
      const body = await readBody(request, 1_500_000);
      const extracted = await extractProfile(body);
      if (!extracted.ok) return sendJson(response, 400, extracted);
      return sendJson(response, 200, {
        ok: true,
        format: extracted.format,
        skills: extracted.skills,
        education: extracted.education,
        characterCount: extracted.characterCount,
        text: extracted.text,
      });
    }
    if (request.method === "POST" && url.pathname === "/api/cv/match") {
      const body = await readBody(request, 1_500_000);
      const result = await app.matchCv(body);
      result.zetaris = app.zetaris;
      return sendJson(response, 200, result);
    }
    if (request.method === "GET") return sendFile(response, url.pathname);
    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Bad request" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Opportunity Scout listening on http://127.0.0.1:${port}`);
});

async function readBody(request, limit = 100_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

async function sendFile(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const target = resolve(publicDir, `.${requested}`);
  if (target !== publicDir && !target.startsWith(publicDir + sep)) {
    return sendJson(response, 404, { error: "Not found" });
  }
  try {
    const body = await readFile(target);
    response.writeHead(200, {
      "Content-Type": types[extname(target)] ?? "application/octet-stream",
      "Content-Length": body.length,
    });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}
