# Project Documentation Context

Context to help answer questions about the ReleaseGuard codebase accurately.

---

## What this project is

ReleaseGuard is an AI-assisted release readiness platform. It accepts a ZIP-format **release bundle** uploaded via a browser UI, runs an eight-step deterministic analysis pipeline, streams progress to the browser via SSE, and produces a consolidated release-readiness report with an AI-generated Markdown release note (watsonx.ai).

---

## Repository Layout

```
ReleaseGuard/
├── client/                    # React 19 + Vite 8 frontend (SPA)
│   └── src/
│       ├── components/        # UI: UploadPanel, PipelineView, ReportView,
│       │                      #     StepCard, FindingItem, ReadinessGauge,
│       │                      #     PastReports
│       ├── hooks/             # useSSE.js, useReport.js
│       └── api/               # upload.js (thin fetch wrapper)
├── server/                    # Node.js + Express 4 backend (plain ESM)
│   ├── routes/                # upload.js, analysis.js, reports.js
│   ├── pipeline/
│   │   ├── index.js           # Orchestrator
│   │   └── steps/             # 01-ingest through 08-report
│   ├── ai/watsonx.js          # watsonx.ai release-note generation
│   ├── storage/reports.js     # JSON-file read/write/list
│   ├── middleware/upload.js   # Multer config
│   └── index.js               # Express entry point (port 3000)
├── data/                      # Runtime only — gitignored
│   ├── reports/               # Persisted <runId>.json report snapshots
│   └── runs/                  # Extracted upload bundles
├── .env.example               # Env var template; copy it to server/.env for the backend
├── release-guard-plan.md      # Original implementation plan
└── AGENTS.md                  # Primary developer/agent reference
```

---

## Key Files to Know

| File | Role |
|------|------|
| `AGENTS.md` (root) | Primary reference: commands, architecture, gotchas |
| `.env.example` | All recognised environment variables with defaults |
| `server/ai/watsonx.js` | Only file that calls an external API |
| `server/pipeline/steps/08-report.js` | Only step that writes to disk |
| `server/routes/analysis.js` | SSE endpoint — flushHeaders pattern is critical |
| `client/src/hooks/useSSE.js` | All SSE event names and frontend state shape |
| `client/vite.config.js` | Proxy config (`/api` → `:3000`) |
| `release-guard-plan.md` | Background context; not updated post-implementation |

---

## Non-Obvious Facts

- **`data/` is entirely gitignored.** It is created at runtime. There are no committed report files or run directories.
- **`sample-bundles/` inside `server/` are demo fixtures** for a synthetic `payment-service` release — they are not test files for the ReleaseGuard server itself and are excluded from Vitest.
- **There is no client test suite.** `npm test` runs server tests only (Vitest). The client has no `test` script.
- **`npm run build` builds the client only.** It runs `vite build` in `client/` and outputs to `client/dist/`. The server is never compiled.
- **watsonx.ai credentials are entirely optional.** The pipeline completes and produces a full report even without them — step 08 falls back to a deterministic summary string.
- **The `past-report` view does NOT re-run the pipeline.** It fetches the already-persisted JSON via `GET /api/reports/:runId`. SSE is never opened for past reports.
- **The SSE stream closes itself.** After the `done` event, the server calls `res.end()` and the client's `EventSource` is closed by the `useSSE` hook.
- **Two `__dirname` patterns exist in the server.** `routes/upload.js` and `routes/analysis.js` use the `new URL(import.meta.url).pathname.replace(...)` pattern; `storage/reports.js` uses `fileURLToPath`. Both are correct for their context.
- **`release-guard-plan.md`** is the original design document. Some implementation details may differ from the final code — treat the source code as authoritative.
