/**
 * Step 08 — Report Aggregation + Persistence
 *
 * Collects findings and structured outputs from all prior pipeline steps
 * (01–07), builds a consolidated report, persists it via storage/reports.js,
 * and returns the report as the step result.
 *
 * Does NOT re-run any analyzer and does NOT re-read the bundle.
 * Does NOT generate release notes (watsonx integration is a separate task).
 *
 * @param {import('../index.js').PipelineContext} ctx
 * @returns {Promise<{
 *   findings:         Array,
 *   report:           object,
 *   runId:            string,
 *   generatedAt:      string,
 *   overallReadiness: number,
 *   overallSeverity:  string,
 * }>}
 */

import { writeReport } from '../../storage/reports.js';

// ---------------------------------------------------------------------------
// Severity ordering (higher index = more severe)
// ---------------------------------------------------------------------------

const SEVERITY_ORDER = ['ok', 'info', 'warning', 'critical'];

/**
 * Return the worst severity across all provided finding arrays.
 * Falls back to 'ok' when there are no findings.
 *
 * @param {Array[]} findingGroups - zero or more arrays of finding objects
 * @returns {'ok'|'info'|'warning'|'critical'}
 */
function computeOverallSeverity(findingGroups) {
  let maxIndex = 0; // index of 'ok'

  for (const findings of findingGroups) {
    if (!Array.isArray(findings)) continue;
    for (const finding of findings) {
      const idx = SEVERITY_ORDER.indexOf(finding.severity);
      if (idx > maxIndex) {
        maxIndex = idx;
        // Short-circuit: nothing worse than critical
        if (maxIndex === SEVERITY_ORDER.length - 1) return 'critical';
      }
    }
  }

  return SEVERITY_ORDER[maxIndex];
}

/**
 * Extract a safe step snapshot from ctx.results, preserving status, severity,
 * findings and step-specific structured data where already present.
 *
 * @param {object} results - ctx.results
 * @param {string} key     - pipeline step key, e.g. '01-ingest'
 * @param {string} alias   - human-readable alias used in the report
 * @param {string[]} extras - additional property names to copy from the result
 * @returns {object}
 */
function stepSnapshot(results, key, extras = []) {
  const result   = results?.[key] ?? {};
  const findings = Array.isArray(result.findings) ? result.findings : [];

  // Determine per-step severity from its own findings
  const severity = computeOverallSeverity([findings]);

  const snapshot = {
    status: 'complete',
    severity,
    findings,
  };

  for (const prop of extras) {
    if (Object.prototype.hasOwnProperty.call(result, prop)) {
      snapshot[prop] = result[prop];
    }
  }

  return snapshot;
}

// ---------------------------------------------------------------------------
// Step entry point
// ---------------------------------------------------------------------------

export default async function report(ctx) {
  const { runId, manifest, results } = ctx;

  // ── 1. Extract per-step snapshots ─────────────────────────────────────────
  const steps = {
    ingest:       stepSnapshot(results, '01-ingest'),
    diff:         stepSnapshot(results, '02-diff', ['changedFiles', 'counts']),
    dependencies: stepSnapshot(results, '03-dependencies', ['changes']),
    envConfig:    stepSnapshot(results, '04-env-config', ['changes']),
    migrations:   stepSnapshot(results, '05-migrations', ['changes']),
    testGap:      stepSnapshot(results, '06-test-gap', ['testGapPct', 'totalSourceFiles', 'covered', 'uncovered']),
    deployment:   stepSnapshot(results, '07-deployment', ['checklist', 'readinessScore']),
  };

  // ── 2. Collect all findings for overall severity ───────────────────────────
  const allFindingGroups = Object.values(steps).map(s => s.findings);
  const overallSeverity  = computeOverallSeverity(allFindingGroups);

  // ── 3. Overall readiness comes from Step 07 ───────────────────────────────
  const deployResult    = results?.['07-deployment'] ?? {};
  const overallReadiness = typeof deployResult.readinessScore === 'number'
    ? deployResult.readinessScore
    : 0;

  // ── 4. Build the consolidated report ─────────────────────────────────────
  const generatedAt = new Date().toISOString();

  const consolidatedReport = {
    runId,
    generatedAt,
    manifest:        manifest ?? null,
    overallReadiness,
    overallSeverity,
    steps,
    releaseNotes:    null,   // watsonx integration not yet implemented
  };

  // ── 5. Persist ────────────────────────────────────────────────────────────
  writeReport(runId, consolidatedReport);

  // ── 6. Return step result ─────────────────────────────────────────────────
  return {
    findings:        [],   // aggregation step itself produces no new findings
    report:          consolidatedReport,
    runId,
    generatedAt,
    overallReadiness,
    overallSeverity,
  };
}
