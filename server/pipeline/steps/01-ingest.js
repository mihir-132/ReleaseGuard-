/**
 * Step 01 — Ingest
 * Reads the bundle manifest and validates the run directory structure.
 * - Parses manifest.json
 * - Validates required manifest fields
 * - Confirms required bundle files exist
 * - Surfaces problems as critical findings
 * - Assigns ctx.manifest on success
 *
 * @param {import('../index.js').PipelineContext} ctx
 * @returns {Promise<{ findings: Array }>}
 */

import fs from 'fs';
import path from 'path';

/** Fields that must be present in manifest.json. */
const REQUIRED_MANIFEST_FIELDS = [
  'name',
  'version',
  'previousVersion',
  'releaseDate',
  'environment',
  'team',
  'description',
  'migrations',
  'configChanges',
  'testSuites',
];

/** Files that must exist at the bundle root. */
const REQUIRED_FILES = [
  'manifest.json',
  'diff.patch',
  'package.json',
];

export default async function ingest(ctx) {
  const findings = [];

  // ── 1. Confirm required bundle files exist ─────────────────────────────────
  for (const filename of REQUIRED_FILES) {
    const fullPath = path.join(ctx.bundlePath, filename);
    if (!fs.existsSync(fullPath)) {
      findings.push({
        id: `ingest-missing-file-${filename.replace(/[^a-z0-9]/gi, '-')}`,
        category: 'ingest',
        severity: 'critical',
        title: `Required bundle file missing: ${filename}`,
        detail: `The file "${filename}" was not found in the bundle root. Every release bundle must include this file.`,
        file: filename,
        line: null,
        recommendation: `Add "${filename}" to the release bundle before re-submitting.`,
      });
    }
  }

  // ── 2. Parse manifest.json ─────────────────────────────────────────────────
  const manifestPath = path.join(ctx.bundlePath, 'manifest.json');

  // If manifest.json is already flagged as missing, skip parse/validate.
  const manifestMissing = findings.some(
    (f) => f.id === 'ingest-missing-file-manifest-json'
  );
  if (manifestMissing) {
    return { findings };
  }

  let manifest;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    manifest = JSON.parse(raw);
  } catch (err) {
    findings.push({
      id: 'ingest-manifest-parse-error',
      category: 'ingest',
      severity: 'critical',
      title: 'manifest.json could not be parsed',
      detail: `Parsing manifest.json failed: ${err.message}`,
      file: 'manifest.json',
      line: null,
      recommendation: 'Ensure manifest.json contains valid JSON before re-submitting.',
    });
    return { findings };
  }

  // ── 3. Validate required manifest fields ──────────────────────────────────
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (manifest[field] === undefined || manifest[field] === null) {
      findings.push({
        id: `ingest-missing-field-${field}`,
        category: 'ingest',
        severity: 'critical',
        title: `Required manifest field missing: ${field}`,
        detail: `The field "${field}" is required in manifest.json but was not found.`,
        file: 'manifest.json',
        line: null,
        recommendation: `Add the "${field}" field to manifest.json before re-submitting.`,
      });
    }
  }

  // ── 4. Assign parsed manifest to context on clean parse ───────────────────
  ctx.manifest = manifest;

  return { findings };
}
