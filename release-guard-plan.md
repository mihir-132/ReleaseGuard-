# ReleaseGuard — Implementation Plan

## Top-Level Overview

ReleaseGuard is an AI-assisted release readiness platform built for the IBM Bob 2.0 Hackathon. It ingests a software release bundle (ZIP/tarball), runs a deterministic multi-step analysis pipeline with per-step progress streamed to the UI, and produces a consolidated release readiness report plus AI-generated release notes (via watsonx.ai).

**Stack:** React + Vite (frontend) · Node.js + Express (backend) · Server-Sent Events for streaming · JSON files for report persistence · watsonx.ai for release note generation.

**Scope boundary:** One developer, one hackathon. The MVP covers ingestion → analysis → report → release notes. Multi-user auth, CI/CD integration, database persistence, and advanced LLM usage are explicitly out of scope.

---

## Folder Structure

```
ReleaseGuard/
├── client/                        # React + Vite frontend
│   ├── public/
│   ├── src/
│   │   ├── components/            # UI components (Uploader, Pipeline, Report, etc.)
│   │   ├── hooks/                 # Custom React hooks (useSSE, useReport)
│   │   ├── api/                   # Thin fetch wrappers
│   │   ├── utils/                 # Formatting helpers, severity colours
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   └── vite.config.js
│
├── server/                        # Node.js + Express backend
│   ├── routes/
│   │   ├── upload.js              # POST /api/upload
│   │   ├── analysis.js            # GET  /api/analysis/:runId/stream (SSE)
│   │   └── reports.js             # GET  /api/reports/:runId
│   ├── pipeline/
│   │   ├── index.js               # Orchestrator — runs steps in order
│   │   ├── steps/
│   │   │   ├── 01-ingest.js
│   │   │   ├── 02-diff.js
│   │   │   ├── 03-dependencies.js
│   │   │   ├── 04-env-config.js
│   │   │   ├── 05-migrations.js
│   │   │   ├── 06-test-gap.js
│   │   │   ├── 07-deployment.js
│   │   │   └── 08-report.js
│   ├── ai/
│   │   └── watsonx.js             # watsonx.ai release-notes call
│   ├── storage/
│   │   └── reports.js             # Read/write JSON snapshots to disk
│   ├── sample-bundles/            # Synthetic release bundles for demo
│   │   └── v1.2.0/
│   │       ├── manifest.json
│   │       ├── diff.patch
│   │       ├── package.json
│   │       ├── package-lock.json
│   │       └── src/
│   ├── middleware/
│   │   └── upload.js              # Multer config for ZIP/tarball ingestion
│   └── index.js                   # Express entry point
│
├── data/
│   └── reports/                   # Persisted report JSON snapshots (gitignored)
│
├── sample-data/                   # Additional synthetic test fixtures
│
├── .env.example                   # Required env vars (WATSONX_API_KEY, etc.)
├── package.json                   # Root — defines workspaces or separate scripts
└── release-guard-plan.md
```

---

## Release Bundle Format

The uploaded ZIP/tarball must contain a root folder with this layout:

```
<bundle-root>/
├── manifest.json          # Required — release metadata
├── diff.patch             # Required — unified diff of all source changes
├── package.json           # Required — current package.json
├── package-lock.json      # Optional — for deep dependency analysis
└── src/                   # Optional — source snapshot (for test-gap scanning)
```

### manifest.json schema
```json
{
  "name": "my-service",
  "version": "1.2.0",
  "previousVersion": "1.1.3",
  "releaseDate": "2025-07-01",
  "environment": "production",
  "team": "Platform",
  "description": "Short release summary",
  "migrations": ["20250630_add_user_index.sql"],
  "configChanges": ["DATABASE_POOL_SIZE", "FEATURE_FLAG_NEW_CHECKOUT"],
  "testSuites": ["unit", "integration"]
}
```

---

## Data Flow

```
User uploads ZIP
      │
      ▼
POST /api/upload
  - Extract ZIP to temp dir
  - Validate bundle structure
  - Assign runId (UUID)
  - Start pipeline (async, non-blocking)
  - Return { runId }
      │
      ▼
Client opens SSE stream
GET /api/analysis/:runId/stream
      │
      ▼
Pipeline Orchestrator (server/pipeline/index.js)
  Runs steps 01–08 sequentially
  After each step: emits SSE event { step, status, findings }
      │
      ├── step 01: ingest        → parse manifest, validate bundle
      ├── step 02: diff          → parse patch, classify changed files
      ├── step 03: dependencies  → diff package.json deps, flag semver bumps
      ├── step 04: env-config    → check manifest configChanges
      ├── step 05: migrations    → detect SQL/migration files, flag risks
      ├── step 06: test-gap      → map changed files → missing/present tests
      ├── step 07: deployment    → checklist scoring (readiness %)
      └── step 08: report        → aggregate all findings → call watsonx.ai
                                 → write JSON snapshot to disk
                                 → emit final report event
      │
      ▼
Client renders live pipeline progress
  (each SSE event updates the corresponding step card)
      │
      ▼
Final report rendered in-page
  + GET /api/reports/:runId for retrieval
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/upload` | Accept ZIP/tarball, extract, return `{ runId }` |
| `GET` | `/api/analysis/:runId/stream` | SSE stream — emits one event per completed step |
| `GET` | `/api/reports/:runId` | Retrieve persisted JSON report |
| `GET` | `/api/reports` | List all past report IDs (for demo retrieval) |
| `GET` | `/api/health` | Liveness check |

### SSE Event Shape
```json
{
  "step": "dependencies",
  "status": "complete",
  "severity": "warning",
  "summary": "3 dependency changes detected; 1 major version bump",
  "findings": [ ... ]
}
```

`status` values: `running` | `complete` | `error`
`severity` values: `ok` | `info` | `warning` | `critical`

---

## Analysis Pipeline — Step Contracts

Each step is a module that exports an async function:

```js
// server/pipeline/steps/XX-name.js
module.exports = async function stepName(context) {
  // context.bundlePath  — extracted bundle root
  // context.manifest    — parsed manifest.json
  // context.runId       — UUID
  // context.emit(event) — sends SSE event to client
  return findings; // array of Finding objects
};
```

### Finding Object
```json
{
  "id": "dep-001",
  "category": "dependency",
  "severity": "warning",
  "title": "Major version bump: lodash 3.x → 4.x",
  "detail": "Breaking changes possible. Review lodash migration guide.",
  "file": "package.json",
  "line": null,
  "recommendation": "Run full regression suite before release."
}
```

### Per-Step Logic

**01-ingest:** Parse and validate `manifest.json`; confirm required files exist; surface missing fields as `critical` findings.

**02-diff:** Parse `diff.patch` (unified diff format); count changed files by type; identify files changed in high-risk areas (e.g. `auth/`, `db/`, `migrations/`); classify each as `added | modified | deleted`.

**03-dependencies:** Load previous `package.json` deps from the diff (or from a field in `manifest.json`); compare to current; flag `major`, `minor`, `patch` bumps; flag new or removed packages.

**04-env-config:** Read `manifest.configChanges`; flag any new required env vars; cross-check against a `.env.example` file in the bundle if present.

**05-migrations:** Read `manifest.migrations`; scan `src/` for files matching `*.sql`, `*migration*`, `*migrate*`; flag whether each migration has a rollback companion; flag irreversible patterns (`DROP TABLE`, `DELETE FROM`).

**06-test-gap:** Two-pass analysis. Pass 1 — collect all changed/added `.js`/`.ts` source files from step 02 diff findings; for each, check whether a corresponding test file exists in the bundle's `src/` tree (matching `*.test.*` or `*.spec.*`). Pass 2 — scan the diff itself for test-file changes (`*.test.*`, `*.spec.*` in the patch) and correlate them against the source files they cover; a source file is considered "covered" if either its sibling test file exists *or* a test file touching it appears in the diff. Flag changes that are covered, and separately flag changes that have no test coverage at all. Compute gap percentage from the uncovered set only.

**07-deployment:** Score a readiness checklist from the findings of all prior steps; compute an overall readiness percentage. Checklist items:
- No critical dependency findings
- All migrations have rollback companions
- No new required env vars without defaults
- Test gap < 30% of changed files
- No files deleted from `src/api/` without replacement

**08-report:** Aggregate all findings into the consolidated report structure; call `watsonx.ai` to generate release notes; write JSON snapshot; emit `done` event.

---

## AI Integration — watsonx.ai

**Module:** `server/ai/watsonx.js`

**Used only in step 08** to generate human-readable release notes.

**Input to the model:** A structured prompt built from:
- `manifest.name`, `version`, `description`
- Summary of step 02 diff findings (N files changed, areas affected)
- Summary of step 03 dependency changes
- Summary of step 05 migration count
- Overall readiness score from step 07

**Output:** Markdown string — the release notes section of the final report.

**Env vars required:**
```
WATSONX_API_KEY=
WATSONX_PROJECT_ID=
WATSONX_URL=https://us-south.ml.cloud.ibm.com
WATSONX_MODEL_ID=ibm/granite-13b-instruct-v2
```

The module must gracefully degrade: if the API call fails, the report is generated without release notes and a warning finding is added.

---

## Report Structure

The persisted JSON snapshot (`data/reports/<runId>.json`):

```json
{
  "runId": "uuid",
  "generatedAt": "ISO-8601",
  "manifest": { ... },
  "overallReadiness": 78,
  "overallSeverity": "warning",
  "steps": {
    "ingest":       { "status": "complete", "severity": "ok",       "findings": [] },
    "diff":         { "status": "complete", "severity": "info",     "findings": [] },
    "dependencies": { "status": "complete", "severity": "warning",  "findings": [] },
    "envConfig":    { "status": "complete", "severity": "ok",       "findings": [] },
    "migrations":   { "status": "complete", "severity": "critical", "findings": [] },
    "testGap":      { "status": "complete", "severity": "warning",  "findings": [] },
    "deployment":   { "status": "complete", "severity": "warning",  "findings": [] }
  },
  "releaseNotes": "## Release Notes\n\n..."
}
```

---

## Frontend — Component Breakdown

All rendered on a single scrolling page (`App.jsx`).

| Component | Responsibility |
|-----------|----------------|
| `UploadPanel` | Drag-and-drop / file picker; calls `POST /api/upload`; transitions to pipeline view on success |
| `PipelineView` | Renders one `StepCard` per analysis step; opens SSE stream via `useSSE` hook |
| `StepCard` | Shows step name, spinner/check/error icon, severity badge, summary text, expandable findings list |
| `ReportView` | Renders after SSE `done` event; shows readiness score, all findings grouped by severity, release notes |
| `FindingItem` | Single finding row: severity icon, title, detail, recommendation |
| `ReadinessGauge` | Visual percentage gauge for overall readiness score |
| `PastReports` | Dropdown list from `GET /api/reports`; loads any past report by ID |

### Custom Hooks

- **`useSSE(runId)`** — opens `EventSource` for the given `runId`; returns `{ steps, done, error }`; closes stream on unmount or `done`
- **`useReport(runId)`** — fetches `/api/reports/:runId`; returns report JSON

---

## Synthetic Sample Data

A sample release bundle will be checked into `server/sample-bundles/v1.2.0/` and auto-zipped to `sample-data/v1.2.0-bundle.zip` as part of the project setup. This bundle is pre-crafted to exercise all eight analyzers (has a migration, a major dep bump, missing tests, a new env var, etc.) so every demo path produces interesting output.

---

## Testing Strategy

**Philosophy:** Test the pipeline logic; skip UI unit tests for hackathon scope.

- **Framework:** Vitest (co-located with `server/`)
- **What to test:**
  - Each pipeline step module in isolation (mock `context.emit`)
  - The report aggregator
  - The `manifest.json` validator
  - The bundle extraction / validation helper
- **Test data:** Use fixtures from `server/sample-bundles/` and `sample-data/`
- **Single-test command:** `npx vitest run --reporter=verbose <filename>`
- **Full test command:** `npx vitest run`

No frontend component tests in MVP scope.

---

## Deployment Approach

- **Development:** `vite dev` (client on `:5173`) proxied to Express (server on `:3000`) via Vite's `server.proxy` config
- **Production build:** `vite build` → `dist/` served as static files by the Express server (one process, one port)
- **Env vars:** `.env` file loaded via `dotenv` in Express; `.env.example` committed to repo
- **Hosting target:** Any Node.js host (Railway, Render, Fly.io) or local `node server/index.js` for demo
- **No Docker required** for hackathon demo

---

## Implementation Order

Complete sub-tasks in this order to always have a runnable demo at each checkpoint:

1. **Project scaffolding** — init workspaces, install deps, wire Vite proxy
2. **Release bundle format + sample data** — define schema, create synthetic bundle, write ZIP fixture
3. **Ingestion endpoint** — POST /api/upload, extract ZIP, validate structure, assign runId
4. **Pipeline orchestrator + SSE stream** — skeleton orchestrator, SSE route, emit heartbeat per step
5. **Pipeline steps 01–07** — implement deterministic analyzers one by one
6. **Report aggregation (step 08) + persistence** — aggregate, write JSON, serve GET /api/reports/:runId
7. **watsonx.ai integration** — implement `server/ai/watsonx.js`, wire into step 08
8. **Frontend — upload + live pipeline view** — UploadPanel, PipelineView, StepCard, useSSE
9. **Frontend — report view** — ReportView, ReadinessGauge, FindingItem, release notes render
10. **Past reports + polish** — PastReports component, error states, loading states
11. **Tests** — Vitest for each pipeline step
12. **AGENTS.md update** — document final commands, patterns, gotchas

---

## Explicit MVP Exclusions

The following are **out of scope** to keep the hackathon deliverable manageable:

| Excluded | Reason |
|----------|--------|
| User authentication / multi-tenancy | Not needed for demo; adds significant complexity |
| Database (SQL/NoSQL) | JSON file snapshots are sufficient |
| CI/CD pipeline integration (GitHub Actions webhooks, etc.) | Out of scope for prototype |
| LLM usage beyond release notes | Adds cost/latency risk; deterministic analyzers are more reliable for demo |
| Real git repo cloning / GitHub API | Bundle upload covers the same ground safely |
| Rollback automation | Read-only analysis tool; no deployment execution |
| Frontend unit tests | Hackathon time constraint |
| Docker / container packaging | Not needed for local/Render demo |
| Diff visualization (syntax-highlighted side-by-side) | Nice-to-have; cut for time |
| Historical trend analysis across releases | Requires database; out of scope |

---

## Sub-Tasks

### Sub-Task 1 — Project Scaffolding
**Status:** [ ] pending

**Intent:** Establish the monorepo layout, install all dependencies, and wire up the Vite dev proxy so `client` and `server` can communicate during development.

**Expected Outcomes:**
- `client/` and `server/` folders exist with correct `package.json` files
- `npm run dev` starts both Vite and Express concurrently
- `GET /api/health` returns `{ ok: true }` through the Vite proxy
- `.env.example` is committed

**Todo List:**
1. Create root `package.json` with `workspaces` and `scripts` (`dev`, `build`, `test`)
2. Scaffold `client/` with Vite + React template
3. Scaffold `server/` with Express + `dotenv` + `multer` + `uuid` + `adm-zip`
4. Add Vitest to `server/`
5. Configure `client/vite.config.js` proxy (`/api` → `http://localhost:3000`)
6. Create `server/index.js` with `GET /api/health`
7. Add `concurrently` to root, wire `npm run dev`
8. Create `.env.example` with all required vars
9. Add `data/reports/` to `.gitignore`

**Relevant Context:** Vite proxy config lives in `client/vite.config.js` under `server.proxy`.

---

### Sub-Task 2 — Release Bundle Format + Sample Data
**Status:** [ ] pending

**Intent:** Define the canonical bundle schema and create a synthetic ZIP fixture that exercises every analyzer, so the demo always produces interesting output.

**Expected Outcomes:**
- `server/sample-bundles/v1.2.0/` contains all required files
- `sample-data/v1.2.0-bundle.zip` is a valid, extractable ZIP of that folder
- `manifest.json` references migrations, config changes, and test suites
- `diff.patch` touches auth, db, and API files (high-risk areas)
- `package.json` shows a major dep bump (e.g. lodash 3→4) and a new package
- At least one migration file lacks a rollback companion
- At least two changed source files have no corresponding test file

**Todo List:**
1. Create `server/sample-bundles/v1.2.0/manifest.json` per the schema above
2. Create a realistic `diff.patch` (unified diff) touching `src/auth/`, `src/db/`, `src/api/`
3. Create `server/sample-bundles/v1.2.0/package.json` with the dep bump
4. Create `server/sample-bundles/v1.2.0/src/` with a few source and test files
5. Create a migration file without a rollback (e.g. `20250630_add_index.sql`)
6. Write a small Node.js script or npm script to zip the bundle into `sample-data/`

**Relevant Context:** Bundle format spec in the "Release Bundle Format" section above.

---

### Sub-Task 3 — Ingestion Endpoint
**Status:** [ ] pending

**Intent:** Accept a ZIP/tarball upload, extract it to a temp directory, validate its structure, and return a `runId` that ties subsequent API calls together.

**Expected Outcomes:**
- `POST /api/upload` accepts `multipart/form-data` with a `bundle` file field
- Extracted contents live at `data/runs/<runId>/`
- Response is `{ runId, manifest }` on success
- Response is `{ error }` with appropriate HTTP status on malformed bundles
- Manifest validation rejects missing required fields

**Todo List:**
1. Create `server/middleware/upload.js` (Multer, disk storage, file type validation)
2. Create `server/routes/upload.js`
3. Implement bundle extractor: unzip to `data/runs/<runId>/`, detect root folder
4. Implement `validateManifest(manifest)` — check required fields, return findings array
5. Register route in `server/index.js`
6. Write Vitest tests for `validateManifest` using fixture manifests

**Relevant Context:** `adm-zip` handles ZIP extraction in Node.js without native binaries.

---

### Sub-Task 4 — Pipeline Orchestrator + SSE Stream
**Status:** [ ] pending

**Intent:** Build the skeleton that runs steps in sequence and streams each step's result to the client via Server-Sent Events. Step implementations are stubs at this point.

**Expected Outcomes:**
- `GET /api/analysis/:runId/stream` returns `Content-Type: text/event-stream`
- Client receives one SSE event per step as each completes
- Pipeline runs steps 01–08 in order; stub steps emit `{ step, status: "complete", findings: [] }`
- SSE stream closes with a `done` event after all steps complete
- `useSSE` React hook consumes the stream correctly

**Todo List:**
1. Create `server/pipeline/index.js` — `runPipeline(runId, emit)` function
2. Create stub files for steps 01–08 (each returns empty findings)
3. Create `server/routes/analysis.js` — SSE route that calls `runPipeline`
4. Implement `context` object passed to each step
5. Register route in `server/index.js`
6. Create `client/src/hooks/useSSE.js`
7. Create a minimal `PipelineView` component that logs events to console

**Relevant Context:** Express SSE pattern: set headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`; write `data: <JSON>\n\n` per event. `EventSource` API on the client.

---

### Sub-Task 5 — Pipeline Steps 01–07
**Status:** [ ] pending

**Intent:** Replace the stubs with real deterministic analyzer logic, one step at a time.

**Expected Outcomes:**
- Each step returns a `findings` array conforming to the Finding schema
- Steps are independently testable with fixture data
- Running against the synthetic bundle produces varied severities across steps
- Step 07 produces a numeric readiness score (0–100)

**Todo List:**
1. **01-ingest.js** — parse manifest, validate required fields, surface missing entries
2. **02-diff.js** — parse unified diff (split on `diff --git` headers), classify each file, flag high-risk paths
3. **03-dependencies.js** — parse prev/current `package.json` deps; compute semver delta per package; flag major bumps as `warning`, new/removed packages as `info`
4. **04-env-config.js** — read `manifest.configChanges`; flag any key not present in `manifest.previousConfigKeys` (or `.env.example` in bundle) as `warning`
5. **05-migrations.js** — scan `manifest.migrations`; check for `DROP`/`DELETE` patterns; check for rollback file companion (`*.down.sql` or `rollback_*.sql`)
6. **06-test-gap.js** — Pass 1: collect changed/added `.js`/`.ts` files from step 02 findings; check for sibling `*.test.*` / `*.spec.*` files in `src/`. Pass 2: scan step 02 diff data for any test-file changes; correlate against source files to mark them "covered". Compute gap percentage from files with no coverage in either pass.
7. **07-deployment.js** — score checklist against aggregated findings from all prior steps; return readiness integer + checklist items array
8. Write Vitest tests for each step using fixtures from `server/sample-bundles/`

**Relevant Context:** Steps receive a `context` object (see Pipeline Orchestrator section). Diff parsing: split on `^diff --git` lines; `+++ b/<path>` gives the new filename; `+` lines are additions, `-` lines are deletions.

---

### Sub-Task 6 — Report Aggregation + Persistence
**Status:** [ ] pending

**Intent:** Implement step 08, which collects all findings, writes the JSON snapshot to disk, and serves it via the reports API.

**Expected Outcomes:**
- `data/reports/<runId>.json` is written after pipeline completes
- `GET /api/reports/:runId` returns the full report JSON
- `GET /api/reports` returns `[{ runId, generatedAt, manifest.name, manifest.version, overallReadiness }]`
- Report JSON matches the schema defined in "Report Structure"

**Todo List:**
1. Create `server/storage/reports.js` — `writeReport(runId, report)` and `readReport(runId)` and `listReports()`
2. Implement `server/pipeline/steps/08-report.js` — aggregate findings, compute `overallSeverity`, call `storage.writeReport`
3. Create `server/routes/reports.js`
4. Register routes in `server/index.js`
5. Write Vitest tests for the aggregator and storage module

**Relevant Context:** `overallSeverity` is the worst severity across all step findings. `overallReadiness` comes from step 07.

---

### Sub-Task 7 — watsonx.ai Integration
**Status:** [ ] pending

**Intent:** Call watsonx.ai in step 08 to generate human-readable release notes from the aggregated analysis summary.

**Expected Outcomes:**
- `server/ai/watsonx.js` exports `generateReleaseNotes(summaryContext)` → Markdown string
- If `WATSONX_API_KEY` is missing or call fails, function returns a fallback string and logs a warning
- Release notes appear in the final report JSON under `releaseNotes`
- Prompt is concise (< 500 tokens input) and produces a 150–300 word markdown release note

**Todo List:**
1. Add `@ibm-cloud/watsonx-ai` (or raw `node-fetch` POST) to `server/package.json`
2. Implement `server/ai/watsonx.js` — build prompt from summaryContext, call `/ml/v1/text/generation` endpoint, parse response
3. Define `summaryContext` shape: `{ name, version, diffSummary, depSummary, migrationCount, readinessScore }`
4. Wire call into `08-report.js` — call before writing snapshot
5. Add graceful degradation (try/catch → fallback message)
6. Document required env vars in `.env.example`
7. Write a Vitest test that mocks the HTTP call and verifies the prompt structure

**Relevant Context:** watsonx.ai text generation endpoint: `POST {WATSONX_URL}/ml/v1/text/generation?version=2023-05-29`. Auth header: `Authorization: Bearer <IAM_token>`. The `server/ai/watsonx.js` module should handle IAM token exchange from `WATSONX_API_KEY`.

---

### Sub-Task 8 — Frontend: Upload + Live Pipeline View
**Status:** [ ] pending

**Intent:** Build the upload UI and the live pipeline progress view driven by the SSE stream.

**Expected Outcomes:**
- User can drag-and-drop or select a ZIP file
- After upload, the page transitions to show a pipeline with 8 step cards
- Each card updates in real time as SSE events arrive (spinner → check/warning/error icon)
- Each card is expandable to show findings detail
- Severity badges use consistent colour coding (ok=green, info=blue, warning=amber, critical=red)

**Todo List:**
1. Create `client/src/api/upload.js` — wraps `fetch POST /api/upload`
2. Create `UploadPanel` component (drag-and-drop zone + file input fallback)
3. Finalize `useSSE` hook (open stream, parse events, return `{ steps, isDone, error }`)
4. Create `PipelineView` component — renders 8 `StepCard` components from `steps` state
5. Create `StepCard` component — status icon, severity badge, summary, expandable findings list
6. Create `FindingItem` component — severity icon, title, detail, recommendation
7. Wire `App.jsx`: show `UploadPanel` initially; show `PipelineView` once `runId` is set

**Relevant Context:** Tailwind CSS or plain CSS modules; pick one and stay consistent. SSE `EventSource` does not support custom headers — pass `runId` as a URL param. The `done` event signals stream closure.

---

### Sub-Task 9 — Frontend: Report View
**Status:** [ ] pending

**Intent:** Render the consolidated report once the pipeline completes, including the readiness gauge, grouped findings, and AI-generated release notes.

**Expected Outcomes:**
- `ReportView` renders below the pipeline after the SSE `done` event
- Readiness score shown as a visual gauge / percentage badge
- Findings grouped by severity (critical first)
- Release notes rendered as markdown
- "Download Report" button triggers JSON download

**Todo List:**
1. Create `client/src/hooks/useReport.js` — fetches `/api/reports/:runId` on mount
2. Create `ReportView` component — orchestrates sub-components
3. Create `ReadinessGauge` — SVG arc or simple CSS progress indicator showing 0–100%
4. Add findings-by-severity grouping logic
5. Add a markdown renderer (use `marked` or `react-markdown`) for release notes
6. Add "Download Report" button — `JSON.stringify` + Blob download
7. Wire into `App.jsx` — render `ReportView` below `PipelineView` when `isDone`

**Relevant Context:** `marked` is a lightweight dependency (~50kb); `react-markdown` is heavier but handles edge cases better. Either is acceptable for hackathon.

---

### Sub-Task 10 — Past Reports + Polish
**Status:** [ ] pending

**Intent:** Allow retrieval of any previously generated report and add final UX polish.

**Expected Outcomes:**
- A "Past Reports" dropdown lists previous runs by name/version/date
- Selecting a past report loads and renders `ReportView` without re-running the pipeline
- Error states handled gracefully (upload failure, stream error, missing bundle files)
- Loading spinners present during upload and initial pipeline start
- Page works on a 1280px-wide screen without horizontal scroll

**Todo List:**
1. Create `PastReports` component — fetches `GET /api/reports` on mount, renders select element
2. On select, set `runId` state and call `useReport` directly (skip pipeline)
3. Add error boundary / error state to `UploadPanel` and `PipelineView`
4. Add loading skeleton to `ReportView` while `useReport` fetches
5. Final responsive CSS pass

---

### Sub-Task 11 — Tests
**Status:** [ ] pending

**Intent:** Establish a Vitest test suite covering the pipeline logic so regressions are caught.

**Expected Outcomes:**
- All pipeline step modules have at least one passing test
- `validateManifest` is tested for happy path and missing-field cases
- Report aggregator is tested for severity roll-up logic
- `npm test` (or `npx vitest run`) exits 0
- No tests require real network calls (watsonx is mocked)

**Todo List:**
1. Confirm Vitest config in `server/package.json`
2. Write / verify tests for `01-ingest` through `07-deployment`
3. Write / verify tests for `08-report` aggregator
4. Write / verify tests for `storage/reports.js`
5. Verify watsonx mock test
6. Run full suite; fix any failures

---

### Sub-Task 12 — AGENTS.md Update
**Status:** [ ] pending

**Intent:** Capture the final non-obvious project knowledge so future agents can work productively.

**Expected Outcomes:**
- `AGENTS.md` contains correct final commands
- Mode-specific files in `.bob/rules-*/` contain architecture and pattern gotchas
- No obvious/generic information remains

**Todo List:**
1. Update `AGENTS.md` with final `dev`, `build`, `test`, single-test commands
2. Update `.bob/rules-agent/AGENTS.md` with coding gotchas discovered during build
3. Update `.bob/rules-plan/AGENTS.md` with architectural constraints
4. Update `.bob/rules-ask/AGENTS.md` with documentation context

---

## Key Design Decisions (Recorded)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Streaming mechanism | Server-Sent Events | Simpler than WebSockets; one-directional; native browser `EventSource` API |
| Report storage | JSON files on disk | No database dependency; sufficient for hackathon; easy to inspect |
| LLM scope | watsonx.ai for release notes only | Deterministic analyzers are more reliable for demo; limits cost/latency risk |
| Bundle format | ZIP with defined folder layout | Portable; tooling is universal; matches real-world artifact packaging |
| Frontend layout | Single scrolling page | Lower complexity; better for live demo with screen sharing |
| Diff parsing | Client-supplied patch file | Avoids git dependency on server; bundle is self-contained |
