/**
 * Step 07 — Deployment Readiness
 *
 * Scores a deployment-readiness checklist by consuming the structured results
 * from all prior pipeline steps (01–06).  No files are re-read; all data is
 * sourced from ctx.results.
 *
 * Checklist (5 items, 20 points each, total = 100):
 *   1. No critical dependency findings        (from 03-dependencies)
 *   2. All migrations have rollback companions (from 05-migrations)
 *   3. No new required env vars without defaults (from 04-env-config)
 *   4. Test gap < 30% of changed source files  (from 06-test-gap)
 *   5. No files deleted from src/api/ without replacement (from 02-diff)
 *
 * @param {import('../index.js').PipelineContext} ctx
 * @returns {Promise<{
 *   findings:       Array,
 *   checklist:      Array,
 *   readinessScore: number,
 * }>}
 */

// ---------------------------------------------------------------------------
// Finding counter (reset per run for deterministic IDs)
// ---------------------------------------------------------------------------

let _findingCounter = 0;

function nextId() {
  _findingCounter += 1;
  return `deploy-${String(_findingCounter).padStart(3, '0')}`;
}

function resetCounter() {
  _findingCounter = 0;
}

// ---------------------------------------------------------------------------
// Points per checklist item
// ---------------------------------------------------------------------------

const POINTS_PER_ITEM = 20;

// ---------------------------------------------------------------------------
// Checklist evaluators
// ---------------------------------------------------------------------------

/**
 * 1. No critical dependency findings.
 *
 * Reads the findings array from 03-dependencies and checks whether any
 * finding has severity === 'critical'.
 *
 * @param {object} ctx
 * @returns {{ passed: boolean, explanation: string }}
 */
function checkNoCriticalDeps(ctx) {
  const depResult = ctx.results?.['03-dependencies'];
  const findings  = Array.isArray(depResult?.findings) ? depResult.findings : [];
  const criticals = findings.filter(f => f.severity === 'critical');
  const passed    = criticals.length === 0;
  return {
    passed,
    explanation: passed
      ? 'No critical dependency findings.'
      : `${criticals.length} critical dependency finding(s) detected.`,
  };
}

/**
 * 2. All migrations have rollback companions.
 *
 * Reads the changes array from 05-migrations.  A checklist failure occurs
 * when any migration entry has rollbackPresent === false.
 *
 * @param {object} ctx
 * @returns {{ passed: boolean, explanation: string, missingRollbacks: string[] }}
 */
function checkMigrationRollbacks(ctx) {
  const migResult = ctx.results?.['05-migrations'];
  const changes   = Array.isArray(migResult?.changes) ? migResult.changes : [];

  // Zero migrations declared → pass (nothing to check)
  if (changes.length === 0) {
    return { passed: true, explanation: 'No migrations declared.', missingRollbacks: [] };
  }

  const missingRollbacks = changes
    .filter(c => c.rollbackPresent === false)
    .map(c => c.migration);

  const passed = missingRollbacks.length === 0;
  return {
    passed,
    explanation: passed
      ? 'All migrations have rollback companions.'
      : `${missingRollbacks.length} migration(s) missing rollback companion: ${missingRollbacks.join(', ')}.`,
    missingRollbacks,
  };
}

/**
 * 3. No new required env vars without defaults.
 *
 * Reads the changes array from 04-env-config.  A checklist failure occurs
 * when any key has covered === false.
 *
 * @param {object} ctx
 * @returns {{ passed: boolean, explanation: string, uncoveredKeys: string[] }}
 */
function checkEnvConfig(ctx) {
  const envResult   = ctx.results?.['04-env-config'];
  const changes     = Array.isArray(envResult?.changes) ? envResult.changes : [];

  // Zero config changes declared → pass
  if (changes.length === 0) {
    return { passed: true, explanation: 'No config changes declared.', uncoveredKeys: [] };
  }

  const uncoveredKeys = changes.filter(c => c.covered === false).map(c => c.key);
  const passed        = uncoveredKeys.length === 0;
  return {
    passed,
    explanation: passed
      ? 'All new config keys are documented in .env.example or previousConfigKeys.'
      : `${uncoveredKeys.length} required config key(s) lack documentation: ${uncoveredKeys.join(', ')}.`,
    uncoveredKeys,
  };
}

/**
 * 4. Test gap < 30% of changed source files.
 *
 * Reads testGapPct from 06-test-gap.  The threshold is strictly less than 30.
 * Zero changed source files → pass (testGapPct will be 0).
 *
 * @param {object} ctx
 * @returns {{ passed: boolean, explanation: string, testGapPct: number }}
 */
function checkTestGap(ctx) {
  const gapResult  = ctx.results?.['06-test-gap'];
  const testGapPct = typeof gapResult?.testGapPct === 'number' ? gapResult.testGapPct : 0;
  const passed     = testGapPct < 30;
  return {
    passed,
    explanation: passed
      ? `Test gap is ${testGapPct}%, which is below the 30% threshold.`
      : `Test gap is ${testGapPct}%, which meets or exceeds the 30% threshold.`,
    testGapPct,
  };
}

/**
 * 5. No files deleted from src/api/ without replacement.
 *
 * Reads changedFiles from 02-diff.  Collects all deleted src/api/ files, then
 * checks whether any non-deleted file was added to src/api/ in the same diff.
 * If at least one src/api/ file was added (any name), deletions are considered
 * to have a replacement.  Files deleted with no corresponding src/api/ addition
 * are flagged.
 *
 * Deterministic: based solely on 02-diff changedFiles data.
 *
 * @param {object} ctx
 * @returns {{ passed: boolean, explanation: string, deletedWithoutReplacement: string[] }}
 */
function checkApiDeletions(ctx) {
  const diffResult  = ctx.results?.['02-diff'];
  const changedFiles = Array.isArray(diffResult?.changedFiles) ? diffResult.changedFiles : [];

  const deletedApiFiles = changedFiles
    .filter(f => f.status === 'deleted' && isInSrcApi(f.path))
    .map(f => f.path);

  if (deletedApiFiles.length === 0) {
    return {
      passed: true,
      explanation: 'No files deleted from src/api/.',
      deletedWithoutReplacement: [],
    };
  }

  // A replacement exists when at least one file was added to src/api/.
  const addedApiFiles = changedFiles
    .filter(f => f.status === 'added' && isInSrcApi(f.path));

  const hasReplacement = addedApiFiles.length > 0;

  const deletedWithoutReplacement = hasReplacement ? [] : deletedApiFiles;
  const passed = deletedWithoutReplacement.length === 0;

  return {
    passed,
    explanation: passed
      ? `${deletedApiFiles.length} src/api/ file(s) deleted but replacement(s) found: ${addedApiFiles.map(f => f.path).join(', ')}.`
      : `${deletedApiFiles.length} src/api/ file(s) deleted with no replacement in the diff: ${deletedApiFiles.join(', ')}.`,
    deletedWithoutReplacement,
  };
}

/**
 * Return true when the normalised path is inside src/api/.
 * @param {string} filePath
 * @returns {boolean}
 */
function isInSrcApi(filePath) {
  const normalised = filePath.replace(/\\/g, '/');
  return normalised.startsWith('src/api/') || normalised.includes('/src/api/');
}

// ---------------------------------------------------------------------------
// Finding builders
// ---------------------------------------------------------------------------

function deployFinding({ title, detail, recommendation }) {
  return {
    id:             nextId(),
    category:       'deployment',
    severity:       'warning',
    title,
    detail,
    file:           null,
    line:           null,
    recommendation,
  };
}

// ---------------------------------------------------------------------------
// Step entry point
// ---------------------------------------------------------------------------

export default async function deployment(ctx) {
  resetCounter();

  // ── Evaluate all five checklist items ──────────────────────────────────────
  const depCheck  = checkNoCriticalDeps(ctx);
  const migCheck  = checkMigrationRollbacks(ctx);
  const envCheck  = checkEnvConfig(ctx);
  const gapCheck  = checkTestGap(ctx);
  const apiCheck  = checkApiDeletions(ctx);

  // ── Build structured checklist ────────────────────────────────────────────
  const checklist = [
    {
      id:          'deploy-check-01',
      name:        'No critical dependency findings',
      passed:      depCheck.passed,
      points:      depCheck.passed ? POINTS_PER_ITEM : 0,
      explanation: depCheck.explanation,
    },
    {
      id:          'deploy-check-02',
      name:        'All migrations have rollback companions',
      passed:      migCheck.passed,
      points:      migCheck.passed ? POINTS_PER_ITEM : 0,
      explanation: migCheck.explanation,
    },
    {
      id:          'deploy-check-03',
      name:        'No new required env vars without defaults',
      passed:      envCheck.passed,
      points:      envCheck.passed ? POINTS_PER_ITEM : 0,
      explanation: envCheck.explanation,
    },
    {
      id:          'deploy-check-04',
      name:        'Test gap < 30% of changed source files',
      passed:      gapCheck.passed,
      points:      gapCheck.passed ? POINTS_PER_ITEM : 0,
      explanation: gapCheck.explanation,
    },
    {
      id:          'deploy-check-05',
      name:        'No files deleted from src/api/ without replacement',
      passed:      apiCheck.passed,
      points:      apiCheck.passed ? POINTS_PER_ITEM : 0,
      explanation: apiCheck.explanation,
    },
  ];

  // ── Compute readiness score ───────────────────────────────────────────────
  const readinessScore = checklist.reduce((sum, item) => sum + item.points, 0);

  // ── Build findings for failed checklist items ─────────────────────────────
  const findings = [];

  if (!migCheck.passed) {
    findings.push(deployFinding({
      title:          'Migrations missing rollback companions',
      detail:         `The following migration(s) do not have a rollback companion file: ` +
                      `${migCheck.missingRollbacks.join(', ')}. ` +
                      `A missing rollback means the migration cannot be safely reversed if deployment fails.`,
      recommendation: 'Create a rollback companion (e.g. <name>.down.sql) for each migration listed above.',
    }));
  }

  if (!envCheck.passed) {
    findings.push(deployFinding({
      title:          'New required config keys lack documentation',
      detail:         `The following config key(s) appear in configChanges but are not covered by ` +
                      `.env.example or previousConfigKeys: ${envCheck.uncoveredKeys.join(', ')}. ` +
                      `Deployers may not provision these keys, causing runtime failures.`,
      recommendation: 'Add each undocumented key to .env.example with a placeholder value and explanation.',
    }));
  }

  if (!gapCheck.passed) {
    findings.push(deployFinding({
      title:          `Test gap too high: ${gapCheck.testGapPct}% of changed source files lack coverage`,
      detail:         `The test gap (${gapCheck.testGapPct}%) meets or exceeds the 30% threshold. ` +
                      `Deploying without adequate test coverage increases the risk of undetected regressions.`,
      recommendation: 'Add or update test files to cover the changed source files flagged by Analyzer 06.',
    }));
  }

  if (!apiCheck.passed) {
    findings.push(deployFinding({
      title:          'src/api/ files deleted without replacement',
      detail:         `The following src/api/ file(s) were deleted with no replacement found in the diff: ` +
                      `${apiCheck.deletedWithoutReplacement.join(', ')}. ` +
                      `Removing API files without a replacement may break existing consumers.`,
      recommendation: 'Provide a replacement implementation or confirm the endpoint removal is intentional and documented.',
    }));
  }

  if (!depCheck.passed) {
    findings.push(deployFinding({
      title:          'Critical dependency findings detected',
      detail:         'One or more critical-severity dependency findings were produced by Analyzer 03. ' +
                      'Critical dependency issues must be resolved before deployment.',
      recommendation: 'Review and resolve all critical dependency findings reported by Analyzer 03.',
    }));
  }

  return { findings, checklist, readinessScore };
}
