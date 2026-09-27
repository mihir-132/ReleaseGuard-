/**
 * Report Storage
 *
 * Persists and retrieves analysis report snapshots under data/reports/.
 * Each report is stored as <runId>.json.
 *
 * Exports:
 *   writeReport(runId, report) → void
 *   readReport(runId)          → { ok: true, report } | { ok: false, error }
 *   listReports()              → Array<{ runId, generatedAt, name, version, overallReadiness }>
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Storage directory
// ---------------------------------------------------------------------------

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const REPORTS_DIR  = path.join(PROJECT_ROOT, 'data', 'reports');

/**
 * Ensure the data/reports directory exists.
 * Called lazily before each write or read.
 */
function ensureDir() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

/**
 * Absolute path to a report file.
 * @param {string} runId
 * @returns {string}
 */
function reportPath(runId) {
  return path.join(REPORTS_DIR, `${runId}.json`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write a report snapshot to disk as JSON.
 *
 * @param {string} runId
 * @param {object} report
 */
export function writeReport(runId, report) {
  ensureDir();
  fs.writeFileSync(reportPath(runId), JSON.stringify(report, null, 2), 'utf8');
}

/**
 * Read a report by runId.
 *
 * @param {string} runId
 * @returns {{ ok: true, report: object } | { ok: false, error: string }}
 */
export function readReport(runId) {
  const filePath = reportPath(runId);
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `Report not found: ${runId}` };
  }
  try {
    const raw    = fs.readFileSync(filePath, 'utf8');
    const report = JSON.parse(raw);
    return { ok: true, report };
  } catch (err) {
    return { ok: false, error: `Failed to read report: ${err.message}` };
  }
}

/**
 * List all stored reports as summaries.
 *
 * @returns {Array<{ runId: string, generatedAt: string, name: string, version: string, overallReadiness: number }>}
 */
export function listReports() {
  ensureDir();
  const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json'));
  return files.map(file => {
    const runId = file.replace(/\.json$/, '');
    const result = readReport(runId);
    if (!result.ok) return null;
    const { report } = result;
    return {
      runId,
      generatedAt:     report.generatedAt    ?? null,
      name:            report.manifest?.name    ?? null,
      version:         report.manifest?.version ?? null,
      overallReadiness: report.overallReadiness ?? null,
    };
  }).filter(Boolean);
}
