# Opportunity Scout

A student opportunity finder for the Open Agent Hackathon 2026. It helps a student discover internships, placements, hackathons, and entry-level jobs, explains why each one matches, and shows requirements, deadlines, and application links.

Search does not run on the raw prompt. A local [Scout Intent](https://github.com/meterless/meterless/tree/main/engines/scout-intent) pipeline classifies the request, checks risk, chooses tools, and signs an execution contract. The catalog is read only after that contract verifies.

## Run it

```bash
npm test
npm start
```

Then open http://127.0.0.1:4173

The page is a profile plus a question. A clear request such as "Find software internships in Manchester" returns ranked listings. A request with no subject and an empty profile asks a clarification question. Injection, password, and "hack the portal" requests are refused before any listing is read. Submitting an application issues a high-risk contract and waits for confirmation. Confirming records that approval on a new contract and still does not contact an employer. The listings are sample data. Links point at `example.com`.

## How the request moves

1. **Sense** scores every intent in the registry. Exact example matches rank highest. The stage-2 term is token similarity, so the engine runs with no model download. If you later plug in an embedding model, it can replace that term.
2. **Interpret** fills parameters such as subject, location, and opportunity type. Missing required fields become a clarification question.
3. **Guard** checks injection, role and surface policy, scope, personal data, and rate limits. Personal data is redacted. A block stops the pipeline.
4. **Route** turns capabilities such as `catalog.search` into a tool plan. Local tools win ties.
5. **Recommend** picks a local model profile and signs the contract with HMAC-SHA256. The default lifetime is five minutes. The executor refuses unsigned, expired, tampered, unapproved, or out-of-scope contracts.

The engine is registry-driven. `src/opportunities/intents.json` is the student catalog. The same `Scout` class also loads the Meterless eval registry.

## Zetaris

The local Zetaris platform was inspected before choosing a connection. Its UI on port 3000, API on 8888/8889, and JDBC driver on 10000 were up. `GET /api/config` answers without credentials. Queries, in the platform's own verify script, are `POST /api/auth/login` and then `POST /api/proxy/query/sql/start`.

That platform's sample databases are the taxi and TPC-DS sets, not opportunities. Login with the platform env file was rejected, so this project does not read that file and does not copy its credentials.

Opportunity Scout therefore uses `src/opportunities/catalog.json` unless all three of these are set in the environment:

- `ZETARIS_USERNAME`
- `ZETARIS_PASSWORD`
- `ZETARIS_OPPORTUNITIES_SQL`

The SQL result needs columns such as `title`, `organisation`, `type`, `location`, `skills`, `deadline`, `requirements`, and `url`. If the query fails, the app says so and keeps the local catalog.

## Discovery

Discovery keeps a separate review file, `data/discovery-candidates.json`. It does not write to Zetaris and it does not change `src/opportunities/catalog.json`. Approving a candidate only changes that review file. Student search still uses the Zetaris query or the local catalogue.

Greenhouse is the automated source. It calls the public job-board API at `boards-api.greenhouse.io`. A job returned by that API is marked `verification_status: open`. A link that answers HTTP is marked `url_status: accessible`. Those are different facts. Every new candidate starts as `review_status: pending`.

The list endpoint does not include a deadline unless Greenhouse metadata names one as an ISO date. Skills, eligibility, and requirements stay empty rather than being guessed from the description. The list call checks at most 20 application links.

Gradcracker and Trackr are not fetched. Their terms or the lack of an authorised feed make automated collection unavailable. You can submit one listing you opened yourself.

Set the two variables in the same PowerShell window you use to start the app, then restart it:

```powershell
$env:DISCOVERY_TOKEN = "choose-a-long-random-string"
$env:GREENHOUSE_BOARD = "the-board-token-from-the-employer-job-board-url"
npm.cmd start
```

The board token is the name in `https://boards.greenhouse.io/the-board-token`. Leave `GREENHOUSE_BOARD` unset and the run reports that no board was queried.

```powershell
$headers = @{ "x-discovery-token" = $env:DISCOVERY_TOKEN }
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4173/api/discovery/run -Headers $headers
Invoke-RestMethod -Uri "http://127.0.0.1:4173/api/discovery/candidates?review_status=pending"
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4173/api/discovery/review -Headers $headers -ContentType "application/json" -Body '{"id":"greenhouse:board:101","review_status":"approved"}'
```

`review_status` is `approved` or `rejected`. Submit a listing you opened yourself with `POST /api/discovery/submit` and a JSON body containing `source` (`gradcracker`, `trackr`, or `employer`), `title`, `organisation`, and `url`.

Changing routes answer `503` until `DISCOVERY_TOKEN` is set, and `401` when the header does not match. The token is not printed.

## Tests

`npm test` covers:

- intent classification and parameter binding
- clarification when a request is vague or a required subject is missing
- blocking of prompt injection, disallowed roles, portal attacks, and passwords
- contract signature, expiry, and out-of-scope tool refusal
- opportunity explanations, including requirements, deadlines, and links
- the Zetaris client, with a fake query response and a live reachability probe that does not send credentials

The locked Scout v1 corpus (32 examples) was scored in-process with the same decision shape and metric definitions as the spec runner. Measured results:

| Metric | Result | Floor |
|---|---|---|
| intent_top1 | 1.000 | 0.85 |
| intent_top3_recall | 1.000 | 0.94 |
| injection_precision | 1.000 | 0.90 |
| injection_recall | 1.000 | 0.82 |
| tool_precision | 1.000 | 0.80 |
| clarification_rate | 0.0625 | max 0.25 |

The corpus has no user-override events, so override frequency is 0 because it was not measured. The spec folder was not modified.

## Layout

- `src/scout/` — the intent engine
- `src/opportunities/` — student intents, sample catalog, and matching
- `src/zetaris/client.js` — optional query client
- `src/discovery/` — Greenhouse import, manual submission, and the review file
- `src/app.js` — wires Scout to the catalog
- `src/server.js` and `public/` — the local page
