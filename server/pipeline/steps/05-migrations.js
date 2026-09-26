/**
 * Step 05 — Migrations
 *
 * Reads `manifest.migrations` (an array of filenames), locates each file
 * inside the bundle tree, inspects its SQL content for risky patterns, and
 * checks whether a rollback companion exists.
 *
 * Risky patterns detected (case-insensitive):
 *   DROP TABLE  → warning
 *   DELETE FROM → warning
 *
 * Rollback companion accepted (case-insensitive filename match):
 *   <stem>.down.sql
 *   <stem>.rollback.sql
 *   rollback_<stem>.sql
 *   rollback_<originalFilename>
 *
 * Returns:
 *   findings  — one finding per independent risk (risky SQL or missing rollback)
 *   changes   — one entry per migration with structured metadata
 *
 * @param {import('../index.js').PipelineContext} ctx
 * @returns {Promise<{ findings: Array, changes: Array }>}
 */

import fs   from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Risk pattern registry
// ---------------------------------------------------------------------------

/** @type {Array<{ pattern: RegExp, label: string }>} */
const RISK_PATTERNS = [
  { pattern: /drop\s+table/i,   label: 'DROP TABLE'   },
  { pattern: /delete\s+from/i,  label: 'DELETE FROM'  },
];

// ---------------------------------------------------------------------------
// Finding counter (reset per run for deterministic IDs)
// ---------------------------------------------------------------------------

let _findingCounter = 0;

function nextId() {
  _findingCounter += 1;
  return `mig-${String(_findingCounter).padStart(3, '0')}`;
}

function resetCounter() {
  _findingCounter = 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk the bundle directory tree and return the first file whose basename
 * (case-insensitive) matches `filename`.
 *
 * @param {string} root
 * @param {string} filename
 * @returns {string|null}  absolute path or null
 */
function findFileInTree(root, filename) {
  const lower = filename.toLowerCase();
  const dirs = [root];

  while (dirs.length > 0) {
    const dir = dirs.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        dirs.push(fullPath);
      } else if (entry.name.toLowerCase() === lower) {
        return fullPath;
      }
    }
  }

  return null;
}

/**
 * Given the stem of a migration filename, return all accepted rollback
 * companion basenames (lower-cased for comparison).
 *
 * @param {string} stem  - filename without extension  (e.g. "20250629_add_audit_log_table")
 * @param {string} originalFilename - full filename    (e.g. "20250629_add_audit_log_table.sql")
 * @returns {string[]}
 */
function rollbackNames(stem, originalFilename) {
  return [
    `${stem}.down.sql`,
    `${stem}.rollback.sql`,
    `rollback_${stem}.sql`,
    `rollback_${originalFilename}`,
  ].map(n => n.toLowerCase());
}

/**
 * Determine whether a rollback companion exists for a migration file.
 *
 * @param {string} migrationFilePath  - absolute path to the migration file
 * @param {string} originalFilename   - the original filename from the manifest
 * @returns {boolean}
 */
function hasRollback(migrationFilePath, originalFilename) {
  const dir  = path.dirname(migrationFilePath);
  const stem = originalFilename.replace(/\.sql$/i, '');
  const accepted = new Set(rollbackNames(stem, originalFilename));

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (accepted.has(entry.name.toLowerCase())) return true;
  }

  return false;
}

/**
 * Detect risky SQL patterns in `content`.
 * Returns an array of matched label strings (e.g. ["DELETE FROM"]).
 *
 * @param {string} content
 * @returns {string[]}
 */
function detectRisks(content) {
  const matched = [];
  for (const { pattern, label } of RISK_PATTERNS) {
    if (pattern.test(content)) {
      matched.push(label);
    }
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Finding builders
// ---------------------------------------------------------------------------

function riskyPatternFinding(filename, filePath, label) {
  return {
    id:             nextId(),
    category:       'migration',
    severity:       'warning',
    title:          `Risky SQL pattern in migration: ${label}`,
    detail:         `The migration file contains a "${label}" statement. ` +
                    `This is a destructive or irreversible operation that cannot be ` +
                    `automatically undone.`,
    file:           filePath,
    line:           null,
    recommendation: `Verify that the "${label}" in ${filename} is intentional. ` +
                    `Ensure a rollback strategy exists and the operation has been ` +
                    `reviewed before deploying to production.`,
  };
}

function missingRollbackFinding(filename, filePath) {
  return {
    id:             nextId(),
    category:       'migration',
    severity:       'warning',
    title:          `Migration has no rollback companion: ${filename}`,
    detail:         `No rollback companion was found for "${filename}". ` +
                    `Accepted companion names: <stem>.down.sql, <stem>.rollback.sql, ` +
                    `rollback_<stem>.sql.`,
    file:           filePath,
    line:           null,
    recommendation: `Create a rollback SQL file (e.g. "${filename.replace(/\.sql$/i, '')}.down.sql") ` +
                    `that safely reverses this migration.`,
  };
}

function missingFileFinding(filename) {
  return {
    id:             nextId(),
    category:       'migration',
    severity:       'warning',
    title:          `Migration file not found in bundle: ${filename}`,
    detail:         `The manifest lists "${filename}" as a migration but the file ` +
                    `could not be located anywhere inside the bundle.`,
    file:           filename,
    line:           null,
    recommendation: `Ensure "${filename}" is included in the release bundle.`,
  };
}

// ---------------------------------------------------------------------------
// Step entry point
// ---------------------------------------------------------------------------

export default async function migrations(ctx) {
  resetCounter();

  const migrationList = ctx.manifest?.migrations;

  // Gracefully handle missing / empty migrations data
  if (!Array.isArray(migrationList) || migrationList.length === 0) {
    return { findings: [], changes: [] };
  }

  const findings = [];
  const changes  = [];

  for (const entry of migrationList) {
    // Guard against non-string / empty entries
    if (typeof entry !== 'string' || !entry.trim()) continue;

    const filename    = entry.trim();
    const filePath    = findFileInTree(ctx.bundlePath, filename);
    const relFilePath = filePath
      ? path.relative(ctx.bundlePath, filePath).replace(/\\/g, '/')
      : filename;

    if (!filePath) {
      findings.push(missingFileFinding(filename));
      changes.push({
        migration:       filename,
        file:            null,
        found:           false,
        rollbackPresent: false,
        risks:           [],
      });
      continue;
    }

    // Read SQL content
    let content = '';
    let readable = true;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      readable = false;
    }

    const risks          = readable ? detectRisks(content) : [];
    const rollbackPresent = hasRollback(filePath, filename);

    // Emit a finding for each risky pattern
    for (const label of risks) {
      findings.push(riskyPatternFinding(filename, relFilePath, label));
    }

    // Emit a finding if no rollback companion exists
    if (!rollbackPresent) {
      findings.push(missingRollbackFinding(filename, relFilePath));
    }

    changes.push({
      migration:       filename,
      file:            relFilePath,
      found:           true,
      rollbackPresent,
      risks,
    });
  }

  return { findings, changes };
}
