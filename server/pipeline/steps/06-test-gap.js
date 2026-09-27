/**
 * Step 06 — Test Gap
 *
 * Two-pass analysis that identifies changed/added source files lacking test coverage.
 *
 * Pass 1 — Source/tree test matching:
 *   For each changed/added .js/.ts source file, look for a sibling test file
 *   in the bundle's src/ tree (*.test.* or *.spec.*).
 *
 * Pass 2 — Test file changes in the diff:
 *   Identify test files that appear in the diff and correlate them against
 *   the source files they cover (by shared basename stem).
 *
 * A source file is UNCOVERED only when neither pass provides coverage.
 *
 * Returns:
 *   findings        — one warning per uncovered source file
 *   covered         — array of covered source file paths
 *   uncovered       — array of uncovered source file paths
 *   totalSourceFiles — total changed/added source files analysed
 *   testGapPct      — percentage of source files lacking coverage (0–100)
 *
 * @param {import('../index.js').PipelineContext} ctx
 * @returns {Promise<{
 *   findings:         Array,
 *   covered:          string[],
 *   uncovered:        string[],
 *   totalSourceFiles: number,
 *   testGapPct:       number,
 * }>}
 */

import fs   from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Source file extensions we analyse. */
const SOURCE_EXTS = new Set(['.js', '.ts']);

/** Regex that matches a test/spec file basename. */
const TEST_FILE_RE = /\.(test|spec)\./;

// ---------------------------------------------------------------------------
// Finding counter (reset per run for deterministic IDs)
// ---------------------------------------------------------------------------

let _findingCounter = 0;

function nextId() {
  _findingCounter += 1;
  return `tgap-${String(_findingCounter).padStart(3, '0')}`;
}

function resetCounter() {
  _findingCounter = 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return true when the path is a JS/TS source file (not a test/spec file).
 * @param {string} filePath
 * @returns {boolean}
 */
function isSourceFile(filePath) {
  const base = path.basename(filePath);
  const ext  = path.extname(filePath);
  return SOURCE_EXTS.has(ext) && !TEST_FILE_RE.test(base);
}

/**
 * Return true when the path is a test or spec file.
 * @param {string} filePath
 * @returns {boolean}
 */
function isTestFile(filePath) {
  return TEST_FILE_RE.test(path.basename(filePath));
}

/**
 * Recursively collect all files under `dir`.
 * Returns relative paths (using forward slashes) from `rootDir`.
 *
 * @param {string} dir
 * @param {string} rootDir  - used to compute relative paths
 * @returns {string[]}
 */
function walkDir(dir, rootDir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, rootDir));
    } else {
      results.push(path.relative(rootDir, full).replace(/\\/g, '/'));
    }
  }
  return results;
}

/**
 * Given a source file path (relative, forward slashes), return the set of
 * sibling test file basenames (lower-cased) we would accept as coverage.
 *
 * e.g. "src/auth/jwt.js" → ["jwt.test.js", "jwt.spec.js",
 *                           "jwt.test.ts", "jwt.spec.ts", ...]
 *
 * We match any basename of the form `<stem>.(test|spec).<any ext>`.
 *
 * @param {string} srcPath
 * @returns {Set<string>}
 */
function siblingTestPatterns(srcPath) {
  const base    = path.basename(srcPath);
  const stem    = base.replace(/\.[^.]+$/, ''); // remove last extension
  const patterns = new Set();
  for (const kind of ['test', 'spec']) {
    // Match stem.test.<any ext> or stem.spec.<any ext>
    patterns.add(`${stem}.${kind}.`);
  }
  return patterns;
}

/**
 * Pass 1 — for each changed source file, check whether a sibling test file
 * exists anywhere in the bundle's src/ tree sharing the same directory.
 *
 * @param {string[]} changedSrcFiles  - relative forward-slash paths
 * @param {string[]} allBundleFiles   - relative forward-slash paths from bundle root
 * @returns {Set<string>}  paths that have a sibling test
 */
function pass1Coverage(changedSrcFiles, allBundleFiles) {
  const covered = new Set();

  for (const srcFile of changedSrcFiles) {
    const srcDir  = path.posix.dirname(srcFile);
    const patterns = siblingTestPatterns(srcFile);

    // Look for any file in the same directory whose basename starts with one
    // of the acceptable patterns.
    for (const bundleFile of allBundleFiles) {
      const fileDir  = path.posix.dirname(bundleFile);
      if (fileDir !== srcDir) continue;

      const fileBase = path.posix.basename(bundleFile).toLowerCase();
      for (const prefix of patterns) {
        if (fileBase.startsWith(prefix.toLowerCase())) {
          covered.add(srcFile);
          break;
        }
      }
      if (covered.has(srcFile)) break;
    }
  }

  return covered;
}

/**
 * Pass 2 — inspect changed test files in the diff; correlate each with a
 * source file by matching the stem (everything before ".test." / ".spec.").
 *
 * A test file "src/auth/jwt.test.js" covers "src/auth/jwt.js" (same dir, same stem).
 *
 * @param {string[]} changedSrcFiles    - relative forward-slash paths
 * @param {Array<{path:string,status:string}>} diffFiles  - from Step 02 changedFiles
 * @returns {Set<string>}  source file paths covered by a changed test file
 */
function pass2Coverage(changedSrcFiles, diffFiles) {
  const covered = new Set();

  // Build a map: srcDir/stem → srcFilePath for quick lookup
  const stemMap = new Map();
  for (const srcFile of changedSrcFiles) {
    const srcDir  = path.posix.dirname(srcFile);
    const base    = path.posix.basename(srcFile);
    const stem    = base.replace(/\.[^.]+$/, '').toLowerCase();
    stemMap.set(`${srcDir}/${stem}`, srcFile);
  }

  for (const diffFile of diffFiles) {
    if (diffFile.status === 'deleted') continue;
    const filePath = diffFile.path.replace(/\\/g, '/');
    if (!isTestFile(filePath)) continue;

    // Extract stem from test file: "jwt.test.js" → "jwt"
    const testBase = path.posix.basename(filePath);
    // Remove ".test.<ext>" or ".spec.<ext>"
    const testStemMatch = testBase.match(/^(.+?)\.(test|spec)\./i);
    if (!testStemMatch) continue;

    const testStem = testStemMatch[1].toLowerCase();
    const testDir  = path.posix.dirname(filePath);
    const key = `${testDir}/${testStem}`;

    if (stemMap.has(key)) {
      covered.add(stemMap.get(key));
    }
  }

  return covered;
}

// ---------------------------------------------------------------------------
// Finding builder
// ---------------------------------------------------------------------------

function uncoveredFinding(filePath) {
  return {
    id:             nextId(),
    category:       'test-gap',
    severity:       'warning',
    title:          `No test coverage for changed file: ${filePath}`,
    detail:         `The source file "${filePath}" was changed or added in this release ` +
                    `but no corresponding test file was found in the bundle's src/ tree ` +
                    `and no test file in the diff covers it.`,
    file:           filePath,
    line:           null,
    recommendation: `Add or update a test file alongside "${filePath}" ` +
                    `(e.g. "${filePath.replace(/(\.[^.]+)$/, '.test$1')}") ` +
                    `to ensure the changed behaviour is verified before release.`,
  };
}

// ---------------------------------------------------------------------------
// Step entry point
// ---------------------------------------------------------------------------

export default async function testGap(ctx) {
  resetCounter();

  // ── 1. Read changed files from Step 02 result ─────────────────────────────
  const diffResult = ctx.results?.['02-diff'];
  const diffFiles  = Array.isArray(diffResult?.changedFiles) ? diffResult.changedFiles : [];

  // ── 2. Identify changed/added source files (exclude test files + deleted) ──
  const changedSrcFiles = diffFiles
    .filter(f => f.status !== 'deleted' && isSourceFile(f.path))
    .map(f => f.path.replace(/\\/g, '/'));

  if (changedSrcFiles.length === 0) {
    return {
      findings:         [],
      covered:          [],
      uncovered:        [],
      totalSourceFiles: 0,
      testGapPct:       0,
    };
  }

  // ── 3. Walk the bundle src/ tree for Pass 1 ───────────────────────────────
  const srcDir = path.join(ctx.bundlePath, 'src');
  const allBundleFiles = fs.existsSync(srcDir) ? walkDir(srcDir, ctx.bundlePath) : [];

  // ── 4. Pass 1 — sibling test in tree ─────────────────────────────────────
  const pass1Covered = pass1Coverage(changedSrcFiles, allBundleFiles);

  // ── 5. Pass 2 — changed test files in the diff ───────────────────────────
  const pass2Covered = pass2Coverage(changedSrcFiles, diffFiles);

  // ── 6. Build covered / uncovered sets ────────────────────────────────────
  const covered   = [];
  const uncovered = [];

  for (const srcFile of changedSrcFiles) {
    if (pass1Covered.has(srcFile) || pass2Covered.has(srcFile)) {
      covered.push(srcFile);
    } else {
      uncovered.push(srcFile);
    }
  }

  // ── 7. Build findings ────────────────────────────────────────────────────
  const findings = uncovered.map(f => uncoveredFinding(f));

  // ── 8. Compute gap percentage ─────────────────────────────────────────────
  const total      = changedSrcFiles.length;
  const testGapPct = total > 0 ? Math.round((uncovered.length / total) * 100) : 0;

  return { findings, covered, uncovered, totalSourceFiles: total, testGapPct };
}
