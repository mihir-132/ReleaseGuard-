# Project Coding Rules

Non-obvious, project-specific guidance for agents writing or modifying code in this repository.
Generic programming advice does not belong here.

---

## Module System

- The server uses **ES Modules** (`server/package.json` sets `"type": "module"`).
- Use `import` / `export` syntax for all server-side files. Never use `require()` or `module.exports`.
- Always include `.js` extensions on local ESM imports (`import foo from './foo.js'`).
- `__dirname` and `__filename` are not available in ESM.
  - Use `path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))` for path resolution when the path must work on Windows (routes, analysis router).
  - Or use `path.dirname(fileURLToPath(import.meta.url))` (requires `import { fileURLToPath } from 'url'`) — used in `storage/reports.js`.

---

## Environment Variables and watsonx Credentials

- All watsonx credentials are consumed via `process.env` at **call time** inside `generateReleaseNotes()`, not at module import time. This keeps the module testable without complex mocking.
- `WATSONX_API_KEY` and `WATSONX_PROJECT_ID` are both required for live calls. Omitting either causes an immediate graceful fallback with a `console.warn` — the pipeline still completes.
- Never hardcode, default, or log credential values. Both `.env` files are gitignored; `.env.example` (repo root) shows the shape.
- Credentials go in `server/.env`. `dotenv/config` in `server/index.js` resolves `.env` relative to `process.cwd()`, which is `server/` when the server starts. A root `.env` is **not** read by the server.
- Do not add `dotenv` imports inside individual modules — `dotenv/config` is imported once in `server/index.js`.

---

## SSE Stream Lifecycle

- `res.flushHeaders()` is called before `runPipeline()` starts so the client's `EventSource` is fully open before any events are emitted. Do not reorder this.
- All SSE writes must be guarded by the `done` flag set in `req.on('close', ...)` to avoid writing to a closed socket.
- SSE event format: `event: <name>\ndata: <JSON>\n\n` — both `event:` and `data:` lines required for named events.
- The `done` SSE event signals pipeline completion; the server then calls `res.end()`. The `error` SSE event is for pipeline-level errors, not HTTP errors.

---

## Report Persistence

- Reports are written by step 08 (`server/pipeline/steps/08-report.js`) via `writeReport(runId, report)` from `storage/reports.js`.
- Storage path is `data/reports/<runId>.json` relative to the project root — resolved using `fileURLToPath` at module load.
- `data/reports/` and `data/runs/` are gitignored runtime directories. Do not reference them in source as if they are committed.
- `listReports()` reads every `*.json` in `data/reports/` and returns summaries. There is no database index; scanning is acceptable for MVP scale.

---

## Upload and Bundle Validation

- The upload route (`server/routes/upload.js`) uses multer with in-memory storage and a 10 MB file-size limit.
- `safeExtract()` rejects ZIP entries with absolute paths or path-traversal sequences before extraction.
- The bundle ZIP must contain exactly one top-level directory. `detectBundleRoot()` enforces this.
- Required files inside that directory: `manifest.json`, `diff.patch`, `package.json`.
- Manifest validation is exported as `validateManifest()` and tested independently.

---

## Pipeline Steps

- Each step exports a single default async function with signature `(ctx) => Promise<{ findings, ...extras }>`.
- Steps communicate via `ctx.results[stepName]` — each step stores its full return value there for downstream steps.
- Step 08 is the only step that makes external network calls (watsonx.ai IAM token + generation endpoint). All other steps are purely local/deterministic.
- The `materializeReleaseNote()` function validates that the watsonx response contains no numeric claims outside the verified source data. Any such mismatch throws and triggers the fallback.

---

## Frontend

- The Vite dev server proxies all `/api/*` requests to `http://localhost:3000` (configured in `client/vite.config.js`). In production, set up a reverse proxy or serve client static files from Express.
- `useSSE.js` manages the `EventSource` lifecycle. It listens for named events: `step`, `done`, `error`. The generic `onmessage` handler is kept only for backwards compatibility.
- The `past-report` view (`PastReportContent` in `App.jsx`) loads a persisted report via `useReport(runId)` and **does not open an SSE connection**. Never add SSE logic to that view.
- There is no component-test suite for the client. Do not add a `test` script to `client/package.json` without also setting up a test framework (e.g. Vitest + jsdom).

---

## Testing

- Tests live alongside source files (e.g. `pipeline/steps/01-ingest.test.js`).
- Vitest config (`server/vitest.config.js`) excludes `sample-bundles/` and `node_modules/`.
- Run all server tests: `npm test` (from root) or `npx vitest run` (from `server/`).
- Run a single test file from `server/`: `npx vitest run <relative/path/to/file.test.js>`.
- `--passWithNoTests` is set so an empty test suite does not fail CI.
