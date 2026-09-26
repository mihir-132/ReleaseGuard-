/**
 * Step 02 — Diff
 * Parses diff.patch (unified diff format), classifies each changed file as
 * added | modified | deleted, flags files in high-risk path areas, and returns
 * structured data that downstream steps (e.g. 06-test-gap) can consume.
 *
 * @param {import('../index.js').PipelineContext} ctx
 * @returns {Promise<{ findings: Array, changedFiles: Array, counts: Object }>}
 */

import fs from 'fs';
import path from 'path';

/**
 * Path prefixes considered high-risk.
 * A file is high-risk when its normalised path starts with or contains one
 * of these segments.
 */
const HIGH_RISK_PREFIXES = [
  'auth/',
  'db/',
  'migrations/',
  'src/auth',
  'src/db',
  'src/api',
];

/**
 * Determine whether a file path falls inside a high-risk area.
 * @param {string} filePath  - normalised forward-slash path
 * @returns {boolean}
 */
function isHighRisk(filePath) {
  const normalised = filePath.replace(/\\/g, '/');
  return HIGH_RISK_PREFIXES.some(
    (prefix) => normalised.startsWith(prefix) || normalised.includes('/' + prefix)
  );
}

/**
 * Parse a unified diff string into per-file change records.
 *
 * Each record:
 *   { path, status, highRisk }
 *
 * @param {string} patchText
 * @returns {Array<{ path: string, status: 'added'|'modified'|'deleted', highRisk: boolean }>}
 */
function parsePatch(patchText) {
  // Split on the "diff --git" header lines; the first element before the first
  // header will be empty — filter it out.
  const sections = patchText.split(/^(?=diff --git )/m).filter((s) => s.trim());

  const files = [];

  for (const section of sections) {
    const lines = section.split('\n');

    // ── Determine status ───────────────────────────────────────────────────
    const isNewFile = lines.some((l) => l.startsWith('new file mode'));
    const isDeletedFile = lines.some((l) => l.startsWith('deleted file mode'));

    let status;
    if (isNewFile) {
      status = 'added';
    } else if (isDeletedFile) {
      status = 'deleted';
    } else {
      status = 'modified';
    }

    // ── Extract file path ──────────────────────────────────────────────────
    // For added/modified files: prefer "+++ b/<path>".
    // For deleted files: use "--- a/<path>".
    let filePath = null;

    for (const line of lines) {
      if (status !== 'deleted' && line.startsWith('+++ b/')) {
        filePath = line.slice(6).trim();
        break;
      }
      if (status === 'deleted' && line.startsWith('--- a/')) {
        filePath = line.slice(6).trim();
        break;
      }
    }

    // Fallback: parse the "diff --git a/<x> b/<x>" header line directly.
    if (!filePath) {
      const headerMatch = lines[0].match(/^diff --git a\/.+ b\/(.+)$/);
      if (headerMatch) {
        filePath = headerMatch[1].trim();
      }
    }

    if (!filePath) continue;

    files.push({ path: filePath, status, highRisk: isHighRisk(filePath) });
  }

  return files;
}

/**
 * Build a Finding for a high-risk changed file.
 * @param {Object} file
 * @param {number} index  - used to make the id unique
 * @returns {Object}
 */
function highRiskFinding(file, index) {
  const actionMap = {
    added:    'added to',
    modified: 'modified in',
    deleted:  'deleted from',
  };
  const action = actionMap[file.status] ?? file.status;
  return {
    id: `diff-high-risk-${index}`,
    category: 'diff',
    severity: 'warning',
    title: `High-risk file ${file.status}: ${file.path}`,
    detail: `The file "${file.path}" was ${action} a high-risk area (auth, db, or API). ` +
            `Changes here should receive thorough review and testing.`,
    file: file.path,
    line: null,
    recommendation:
      'Ensure a reviewer with domain knowledge approves this change. ' +
      'Verify tests cover the affected code paths.',
  };
}

export default async function diff(ctx) {
  const patchPath = path.join(ctx.bundlePath, 'diff.patch');

  // If diff.patch is missing (e.g. step 01 already flagged it) return gracefully.
  if (!fs.existsSync(patchPath)) {
    return { findings: [], changedFiles: [], counts: { added: 0, modified: 0, deleted: 0, total: 0 } };
  }

  const patchText = fs.readFileSync(patchPath, 'utf8');
  const changedFiles = parsePatch(patchText);

  // ── Counts ───────────────────────────────────────────────────────────────
  const counts = { added: 0, modified: 0, deleted: 0, total: changedFiles.length };
  for (const f of changedFiles) {
    counts[f.status] = (counts[f.status] ?? 0) + 1;
  }

  // ── Findings ─────────────────────────────────────────────────────────────
  const findings = [];
  let highRiskIndex = 1;
  for (const file of changedFiles) {
    if (file.highRisk) {
      findings.push(highRiskFinding(file, highRiskIndex++));
    }
  }

  return { findings, changedFiles, counts };
}
