# Project Architecture Rules

Architectural constraints and implementation boundaries for ReleaseGuard.
Use this to anchor planning decisions and avoid re-litigating settled design choices.

---

## Core Architecture

- **Frontend:** React 19 + Vite 8 SPA in `client/`. No SSR.
- **Backend:** Node.js + Express 4 in `server/`. Single process, no clustering.
- **Communication:** REST (`/api/upload`, `/api/reports`) + SSE (`/api/analysis/:runId/stream`).
- **Persistence:** JSON files on disk in `data/reports/`. No database.
- **AI:** IBM watsonx.ai for release-note generation only (step 08). All other analysis is deterministic.
- **Build target:** The `npm run build` command builds the client only (`client/dist/`). The server is not compiled or bundled.

---

## Explicit MVP Exclusions

These are **intentional out-of-scope items** for the current release. Do not implement them:

| Exclusion                        | Rationale                                                  |
|----------------------------------|------------------------------------------------------------|
| Authentication / authorization   | Single-user local tool; no multi-user support needed       |
| Database (SQL, NoSQL, etc.)      | JSON-file persistence is sufficient for MVP scale          |
| CI/CD integration                | Out of hackathon scope                                     |
| GitHub API / repository cloning  | Bundle upload is the ingestion contract                    |
| Docker / containerisation        | No Docker requirement; `node --watch` is the dev story     |
| Advanced LLM usage               | watsonx.ai used only for release notes; no AI analysis     |
| Rollback automation              | Detection only; no automated deployment actions            |
| Historical trend analysis        | Past Reports loads individual existing reports; no charting|

---

## Inviolable Constraints

- **No new runtime dependencies on the client** without explicit justification. The current client dependencies are `react`, `react-dom`, and `react-markdown`.
- **Do not add a database.** Report persistence is `data/reports/<runId>.json`. If persistence needs grow, discuss before adding any DB layer.
- **Do not add authentication.** There is no login, session, or JWT layer. All `/api/*` routes are unauthenticated.
- **watsonx.ai is a graceful enhancement, not a hard dependency.** The pipeline must always complete and produce a report when watsonx credentials are absent. The fallback string is the authoritative behavior when credentials are missing or the API fails.
- **The pipeline is append-only.** Step results accumulate in `ctx.results` but steps do not modify each other's output. Adding a step means appending to the `STEPS` array in `pipeline/index.js` and adding the corresponding snapshot call in step 08.
- **SSE is one-way.** The server pushes events; the client never sends data back on the SSE connection. Do not add WebSocket or bidirectional streaming.
- **The bundle format is the public interface.** Changing the required files (`manifest.json`, `diff.patch`, `package.json`) or the manifest schema is a breaking change that affects every caller.

---

## Key Boundaries

### Upload → Analysis handoff

`POST /api/upload` validates the bundle and returns `{ runId }`. The client then opens `GET /api/analysis/:runId/stream` as a separate request. These are two independent HTTP transactions — there is no shared state between them other than the extracted bundle on disk in `data/runs/<runId>/`.

### Step 08 is the only persistence step

Only step 08 writes to `data/reports/`. No other step should call `writeReport()`. Reports are written once and never updated.

### Frontend has no test suite

The `client/` workspace intentionally has no test runner in the current MVP scope. Do not add component tests without also adding the Vitest + jsdom or Testing Library setup.

### Server-side code is not compiled

There is no TypeScript compilation, no Babel transpile, and no bundler for the server. The server runs directly with `node index.js`. Keep all server code as plain ESM JavaScript.
