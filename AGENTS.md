# AGENTS.md

Project-specific guidance for agents working in this repository.

---

## Stack

- **Frontend:** React 19 + Vite 8, in `client/`
- **Backend:** Node.js + Express 4, in `server/`
- **Streaming:** Server-Sent Events (SSE) — `GET /api/analysis/:runId/stream`
- **Persistence:** JSON-file snapshots in `data/reports/` (one file per run)
- **AI:** watsonx.ai (`/ml/v1/text/chat`) for release-note generation only; all other analysis is deterministic

---

## Commands

All commands are run from the **repository root** unless otherwise noted.

### Development

```sh
npm run dev          # Starts both frontend (port 5173) and backend (port 3000) concurrently
```

- Frontend: `http://localhost:5173` (Vite dev server with `/api` proxy to `:3000`)
- Backend:  `http://localhost:3000` (Express, hot-reloaded via `node --watch`)

### Build

```sh
npm run build        # Vite production build of the client only (outputs to client/dist/)
```

### Tests

```sh
npm test             # Runs the server test suite (vitest run --passWithNoTests)
```

Single-test invocation (from the repository root):

```sh
npm run test --workspace=server -- <relative-path-inside-server>
# Examples:
npm run test --workspace=server -- ai/watsonx.test.js
npm run test --workspace=server -- pipeline/steps/08-report.test.js
```

Alternatively, from inside `server/`:

```sh
npx vitest run <relative-path-inside-server>
# Example:
npx vitest run ai/watsonx.test.js
```

> **Note:** The client has no component-test suite in the current MVP scope.

### Lint (client only)

```sh
npm run lint --workspace=client   # oxlint on the client source
```

---

## Architecture

### Request Flow

```
Browser → POST /api/upload            → upload.js   → extracts ZIP, validates, returns runId
Browser → GET  /api/analysis/:runId/stream → analysis.js → SSE + runPipeline()
Browser → GET  /api/reports/:runId    → reports.js  → reads data/reports/<runId>.json
Browser → GET  /api/reports           → reports.js  → lists all report summaries
```

### Eight-Step Analysis Pipeline (`server/pipeline/`)

| Step | File            | What it does                                      |
|------|-----------------|---------------------------------------------------|
| 01   | `01-ingest.js`  | Parses `manifest.json`, validates bundle contents |
| 02   | `02-diff.js`    | Parses `diff.patch`, counts changed files         |
| 03   | `03-dependencies.js` | Compares `package.json` versions             |
| 04   | `04-env-config.js`   | Scans for env var and config changes         |
| 05   | `05-migrations.js`   | Detects DB migration files                   |
| 06   | `06-test-gap.js`     | Estimates test coverage gap                  |
| 07   | `07-deployment.js`   | Builds deployment checklist + readiness score|
| 08   | `08-report.js`       | Aggregates, calls watsonx.ai, persists JSON  |

Each step receives a shared `PipelineContext` and emits `step` SSE events (status: `running` → `complete`).

### SSE Stream Lifecycle

1. Client opens `EventSource` → server flushes headers immediately (before pipeline starts) to avoid missing events.
2. Backend emits `{ event: 'step', data: { step, status, findings } }` for each step start and completion.
3. On success, backend emits `{ event: 'done', data: { runId } }` and closes the response.
4. On pipeline error, backend emits `{ event: 'error', data: { message } }`.
5. If the client disconnects early, a `req.on('close')` guard prevents further writes.

### Report Persistence

- Reports are written to `data/reports/<runId>.json` by step 08.
- `data/reports/` is **gitignored** — it is runtime state, not source.
- `data/runs/` holds extracted ZIP bundles per run — also gitignored.
- The `Past Reports` view loads an existing report by `runId` via `GET /api/reports/:runId` **without re-running the pipeline**.

### watsonx.ai Integration

- Used **only** in step 08 for generating a Markdown release note.
- Endpoint: `POST {WATSONX_URL}/ml/v1/text/chat?version=2023-05-29`
- Default model: `ibm/granite-4-h-small` (overridable via `WATSONX_MODEL_ID`)
- Default base URL: `https://us-south.ml.cloud.ibm.com` (overridable via `WATSONX_URL`)
- Credentials are **environment variables only** — never committed.
- Gracefully falls back to a deterministic summary when credentials are absent or any API call fails.

---

## Environment Variables

The server loads its `.env` from `server/.env` (dotenv resolves relative to the server's working directory).
Copy `.env.example` from the repository root to `server/.env` before running the server.

| Variable             | Required | Default                                | Purpose                              |
|----------------------|----------|----------------------------------------|--------------------------------------|
| `WATSONX_API_KEY`    | No*      | —                                      | IBM Cloud API key for IAM token      |
| `WATSONX_PROJECT_ID` | No*      | —                                      | watsonx.ai project ID                |
| `WATSONX_URL`        | No       | `https://us-south.ml.cloud.ibm.com`    | watsonx.ai regional endpoint         |
| `WATSONX_MODEL_ID`   | No       | `ibm/granite-4-h-small`                | Model used for text/chat generation  |
| `PORT`               | No       | `3000`                                 | Express server port                  |

\* Omitting `WATSONX_API_KEY` or `WATSONX_PROJECT_ID` activates the fallback — the pipeline still completes successfully.

---

## Project-Specific Gotchas

- **ESM throughout the server.** `server/package.json` sets `"type": "module"`. Use `import`/`export` everywhere. Never use `require()` or `module.exports`. Always include `.js` extensions in local ESM imports.
- **`__dirname` is not available in ESM.** Use `path.dirname(new URL(import.meta.url).pathname)` (with the Windows-drive-letter fix `replace(/^\/([A-Za-z]:)/, '$1')`) or `path.dirname(fileURLToPath(import.meta.url))`.
- **Vitest config excludes `sample-bundles/`** — those are synthetic test fixtures for the demo payment-service, not server unit tests.
- **No client test suite.** The `client/` workspace has no `test` script. Running `npm test` from the root targets the server workspace only.
- **Vite proxy.** In dev, all `/api/*` requests from `:5173` are proxied to `http://localhost:3000`. In production the client static files must be served alongside the API or a reverse proxy must be configured.
- **watsonx credentials are read at call time**, not at module load time, so tests can inject them via `process.env` overrides without module-cache issues.
- **`materializeReleaseNote` validates** that the model output contains only numbers already present in the verified release data. This guard prevents hallucinated numeric claims.
- **Upload bundle format.** The ZIP must contain exactly one top-level directory with `manifest.json`, `diff.patch`, and `package.json` at its root.
