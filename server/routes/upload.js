import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import upload from '../middleware/upload.js';

const router = Router();

// Resolved absolute path to the workspace data/runs/ directory.
// __dirname is not available in ESM; derive from import.meta.url.
const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '../..'
);
const RUNS_DIR = path.join(PROJECT_ROOT, 'data', 'runs');

// Required files at the bundle root level.
const REQUIRED_FILES = ['manifest.json', 'diff.patch', 'package.json'];

// Required manifest fields and their expected types.
const MANIFEST_REQUIRED = [
  { key: 'name',            type: 'string' },
  { key: 'version',         type: 'string' },
  { key: 'previousVersion', type: 'string' },
  { key: 'releaseDate',     type: 'string' },
  { key: 'environment',     type: 'string' },
  { key: 'team',            type: 'string' },
  { key: 'description',     type: 'string' },
];

/**
 * Validate a parsed manifest object.
 * Returns an array of finding strings. Empty array means valid.
 *
 * @param {object} manifest
 * @returns {string[]}
 */
export function validateManifest(manifest) {
  const findings = [];

  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    findings.push('manifest.json must be a JSON object.');
    return findings;
  }

  for (const { key, type } of MANIFEST_REQUIRED) {
    if (!(key in manifest)) {
      findings.push(`Missing required field: "${key}".`);
    } else if (typeof manifest[key] !== type) {
      findings.push(`Field "${key}" must be a ${type}, got ${typeof manifest[key]}.`);
    } else if (type === 'string' && manifest[key].trim() === '') {
      findings.push(`Field "${key}" must not be empty.`);
    }
  }

  // Optional arrays: warn if present but wrong type.
  for (const key of ['migrations', 'configChanges', 'testSuites']) {
    if (key in manifest && !Array.isArray(manifest[key])) {
      findings.push(`Field "${key}" must be an array if provided.`);
    }
  }

  return findings;
}

/**
 * Safely extract a ZIP buffer into destDir.
 * Rejects absolute paths and path traversal entries.
 *
 * @param {Buffer} buffer  - ZIP file bytes
 * @param {string} destDir - absolute path to extraction target
 * @throws {Error} if any entry is unsafe
 */
function safeExtract(buffer, destDir) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  for (const entry of entries) {
    const entryName = entry.entryName;

    // Reject absolute paths.
    if (path.isAbsolute(entryName)) {
      throw Object.assign(
        new Error(`Unsafe ZIP entry (absolute path): ${entryName}`),
        { status: 400 }
      );
    }

    // Resolve and confirm the output path stays inside destDir.
    const resolved = path.resolve(destDir, entryName);
    if (!resolved.startsWith(destDir + path.sep) && resolved !== destDir) {
      throw Object.assign(
        new Error(`Unsafe ZIP entry (path traversal): ${entryName}`),
        { status: 400 }
      );
    }
  }

  zip.extractAllTo(destDir, /*overwrite=*/ false);
}

/**
 * Detect the single top-level bundle-root directory inside destDir.
 * Returns the absolute path to that directory, or null if the structure
 * is not a single-root bundle.
 *
 * @param {string} destDir
 * @returns {string|null}
 */
function detectBundleRoot(destDir) {
  const entries = fs.readdirSync(destDir);
  if (entries.length !== 1) return null;

  const candidate = path.join(destDir, entries[0]);
  if (!fs.statSync(candidate).isDirectory()) return null;

  return candidate;
}

/**
 * Run multer middleware as a Promise so we can catch its errors in the route
 * handler and return clean JSON responses instead of falling through to
 * Express's default HTML error handler.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>} resolves on success, rejects with the Multer error
 */
export function runUploadMiddleware(req, res) {
  return new Promise((resolve, reject) => {
    upload.single('bundle')(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// POST /api/upload
router.post('/', async (req, res) => {
  // Run multer explicitly so we can catch its errors and return JSON.
  try {
    await runUploadMiddleware(req, res);
  } catch (err) {
    if (err instanceof multer.MulterError) {
      // Known multer limit violations → 413 for size, 400 for everything else.
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: `Upload error: ${err.message}` });
    }
    // fileFilter rejections arrive here as plain Errors.
    return res.status(400).json({ error: err.message });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Send a ZIP as field "bundle".' });
  }

  const runId = uuidv4();
  const runDir = path.join(RUNS_DIR, runId);

  // Ensure the runs base directory exists.
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.mkdirSync(runDir, { recursive: true });

  // --- Extract ZIP ---
  try {
    safeExtract(req.file.buffer, runDir);
  } catch (err) {
    // Clean up the empty run directory.
    fs.rmSync(runDir, { recursive: true, force: true });
    const status = err.status || 400;
    return res.status(status).json({ error: `ZIP extraction failed: ${err.message}` });
  }

  // --- Detect bundle root ---
  const bundleRoot = detectBundleRoot(runDir);
  if (!bundleRoot) {
    fs.rmSync(runDir, { recursive: true, force: true });
    return res.status(400).json({
      error:
        'Invalid bundle structure. The ZIP must contain exactly one top-level directory.',
    });
  }

  // --- Validate required files ---
  const missingFiles = REQUIRED_FILES.filter(
    (f) => !fs.existsSync(path.join(bundleRoot, f))
  );
  if (missingFiles.length > 0) {
    fs.rmSync(runDir, { recursive: true, force: true });
    return res.status(400).json({
      error: `Bundle is missing required file(s): ${missingFiles.join(', ')}.`,
    });
  }

  // --- Parse and validate manifest ---
  let manifest;
  try {
    const raw = fs.readFileSync(path.join(bundleRoot, 'manifest.json'), 'utf-8');
    manifest = JSON.parse(raw);
  } catch {
    fs.rmSync(runDir, { recursive: true, force: true });
    return res.status(400).json({ error: 'manifest.json is not valid JSON.' });
  }

  const findings = validateManifest(manifest);
  if (findings.length > 0) {
    fs.rmSync(runDir, { recursive: true, force: true });
    return res.status(400).json({
      error: `Invalid manifest: ${findings.join(' ')}`,
    });
  }

  return res.status(200).json({ runId, manifest });
});

export default router;
