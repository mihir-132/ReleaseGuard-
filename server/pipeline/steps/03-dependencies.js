/**
 * Step 03 — Dependencies
 * Compares package.json dependencies between the previous and current release.
 *
 * Strategy:
 *   - Current state:  read <bundlePath>/package.json directly
 *   - Previous state: reconstruct from the removed lines (-) in the
 *                     package.json section of <bundlePath>/diff.patch
 *
 * Outputs:
 *   findings  — warning for major bumps, info for added/removed packages
 *   changes   — structured array of every dependency change (consumed by
 *                later steps / report generation)
 *
 * @param {import('../index.js').PipelineContext} ctx
 * @returns {Promise<{ findings: Array, changes: Array }>}
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Semver helpers
// ---------------------------------------------------------------------------

/**
 * Strip common range prefixes (^, ~, >=, >, =) and return the bare version
 * string.  Returns null when the input cannot be reduced to a dotted version.
 *
 * @param {string} raw
 * @returns {string|null}
 */
function stripRange(raw) {
  if (typeof raw !== 'string') return null;
  const stripped = raw.replace(/^[\^~>=<]+/, '').trim();
  // Accept versions like "1", "1.2", "1.2.3", "1.2.3-beta.1"
  if (/^\d+(\.\d+)*(-[\w.]+)?$/.test(stripped)) return stripped;
  return null;
}

/**
 * Parse a version string into [major, minor, patch] integers.
 * Missing segments default to 0.  Returns null for non-parseable strings.
 *
 * @param {string} version  - bare version string (no range prefixes)
 * @returns {[number, number, number]|null}
 */
function parseVersion(version) {
  if (!version) return null;
  // Strip pre-release / build metadata for numeric comparison
  const core = version.split('-')[0].split('+')[0];
  const parts = core.split('.').map(Number);
  if (parts.some(isNaN)) return null;
  const [major = 0, minor = 0, patch = 0] = parts;
  return [major, minor, patch];
}

/**
 * Classify the semver change between two bare version strings.
 *
 * @param {string} prev
 * @param {string} curr
 * @returns {'major'|'minor'|'patch'|'unchanged'|'unparseable'}
 */
function classifyChange(prev, curr) {
  const p = parseVersion(prev);
  const c = parseVersion(curr);
  if (!p || !c) return 'unparseable';
  if (p[0] !== c[0]) return 'major';
  if (p[1] !== c[1]) return 'minor';
  if (p[2] !== c[2]) return 'patch';
  return 'unchanged';
}

// ---------------------------------------------------------------------------
// Diff parsing — extract the previous package.json content from removed lines
// ---------------------------------------------------------------------------

/**
 * Parse the package.json portion of a unified diff and extract, per
 * dependency group, two maps:
 *   - removedVersions: { name → prevVersion }  packages that were on a `-` line
 *   - addedNames:      Set<name>                packages that are brand-new
 *                                               (on a `+` line, never on a `-`)
 *
 * The parser tracks which dependency group context it is in ("dependencies"
 * or "devDependencies") by looking for the group opening line, so it never
 * accidentally captures top-level metadata fields (e.g. "version", "name").
 *
 * @param {string} patchText
 * @returns {{
 *   removedVersions: { dependencies: Object, devDependencies: Object },
 *   addedNames:      { dependencies: Set, devDependencies: Set }
 * }}
 */
function parsePkgDiffChanges(patchText) {
  const empty = () => ({
    dependencies:    {},
    devDependencies: {},
  });
  const emptySet = () => ({
    dependencies:    new Set(),
    devDependencies: new Set(),
  });

  const sections = patchText.split(/^(?=diff --git )/m);
  const pkgSection = sections.find((s) =>
    /^diff --git a\/package\.json b\/package\.json/m.test(s)
  );
  if (!pkgSection) return { removedVersions: empty(), addedNames: emptySet() };

  // Regex to match an indented JSON dep entry: "pkg-name": "^1.2.3"
  const depLineRe = /^\s{2,}"([\w@/.-]+)"\s*:\s*"([^"]+)"/;
  // Regex to detect a group opening line: "dependencies": { or "devDependencies": {
  const groupOpenRe = /^\s+"(dependencies|devDependencies)"\s*:\s*\{/;

  const removedVersions = empty();
  const addedNames      = emptySet();
  // Track which names were also removed (to determine brand-new vs changed)
  const removedNames    = { dependencies: new Set(), devDependencies: new Set() };

  let inHunk        = false;
  let currentGroup  = null; // 'dependencies' | 'devDependencies' | null
  let groupDepth    = 0;    // brace nesting depth inside the group

  for (const line of pkgSection.split('\n')) {
    if (line.startsWith('@@ ')) {
      inHunk       = true;
      currentGroup = null;
      groupDepth   = 0;
      continue;
    }
    if (!inHunk) continue;

    // Strip the diff prefix character for content analysis
    const prefix  = line[0]; // '-', '+', ' ', or something else
    const content = (prefix === '-' || prefix === '+' || prefix === ' ')
      ? line.slice(1)
      : line;

    // Track group context (using context + added + removed lines)
    if (prefix === ' ' || prefix === '-' || prefix === '+') {
      if (currentGroup === null) {
        const gm = content.match(groupOpenRe);
        if (gm) {
          currentGroup = gm[1];
          groupDepth   = 1;
          continue;
        }
      } else {
        // Count braces to detect end of the group block
        for (const ch of content) {
          if (ch === '{') groupDepth++;
          if (ch === '}') groupDepth--;
        }
        if (groupDepth <= 0) {
          currentGroup = null;
          groupDepth   = 0;
          continue;
        }
      }
    }

    if (!currentGroup) continue;

    const depMatch = content.match(depLineRe);
    if (!depMatch) continue;
    const [, name, version] = depMatch;

    if (prefix === '-') {
      removedVersions[currentGroup][name] = version;
      removedNames[currentGroup].add(name);
    } else if (prefix === '+') {
      addedNames[currentGroup].add(name);
    }
  }

  // Remove names that also appeared on `-` lines — they are version changes,
  // not brand-new additions.
  for (const group of ['dependencies', 'devDependencies']) {
    for (const name of removedNames[group]) {
      addedNames[group].delete(name);
    }
  }

  return { removedVersions, addedNames };
}

/**
 * Parse a package.json string into its dependency maps.
 * Returns { dependencies: {}, devDependencies: {} } on any error.
 *
 * @param {string} text
 * @returns {{ dependencies: Object, devDependencies: Object }}
 */
function parsePkgDeps(text) {
  const empty = { dependencies: {}, devDependencies: {} };
  if (!text || !text.trim()) return empty;
  try {
    const parsed = JSON.parse(text);
    return {
      dependencies:    parsed.dependencies    ?? {},
      devDependencies: parsed.devDependencies ?? {},
    };
  } catch {
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Finding builders
// ---------------------------------------------------------------------------

let _findingCounter = 0;

function nextId(prefix) {
  _findingCounter += 1;
  return `${prefix}-${String(_findingCounter).padStart(3, '0')}`;
}

/**
 * Reset the per-run finding counter.  Called at the start of each step
 * invocation to keep IDs deterministic.
 */
function resetCounter() {
  _findingCounter = 0;
}

function majorBumpFinding(name, prevRaw, currRaw, group) {
  const prev = stripRange(prevRaw) ?? prevRaw;
  const curr = stripRange(currRaw) ?? currRaw;
  const prevMajor = (parseVersion(prev) ?? [])[0] ?? '?';
  const currMajor = (parseVersion(curr) ?? [])[0] ?? '?';
  return {
    id: nextId('dep-major'),
    category: 'dependency',
    severity: 'warning',
    title: `Major version bump: ${name} ${prevMajor}.x → ${currMajor}.x`,
    detail:
      `${name} was upgraded from ${prevRaw} to ${currRaw} (${group}). ` +
      `A major version change may include breaking API changes.`,
    file: 'package.json',
    line: null,
    recommendation:
      `Review the ${name} migration guide and run the full regression suite ` +
      `before deploying.`,
  };
}

function addedDepFinding(name, version, group) {
  return {
    id: nextId('dep-added'),
    category: 'dependency',
    severity: 'info',
    title: `New dependency added: ${name}`,
    detail: `${name}@${version} was added to ${group}.`,
    file: 'package.json',
    line: null,
    recommendation:
      `Verify that ${name} is intentionally included and that its licence is ` +
      `compatible with the project.`,
  };
}

function removedDepFinding(name, version, group) {
  return {
    id: nextId('dep-removed'),
    category: 'dependency',
    severity: 'info',
    title: `Dependency removed: ${name}`,
    detail: `${name}@${version} was removed from ${group}.`,
    file: 'package.json',
    line: null,
    recommendation:
      `Confirm that no code still references ${name} before deploying.`,
  };
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

/**
 * Compare one group of dependencies (e.g. "dependencies" or "devDependencies").
 *
 * @param {string} group   - group name for display
 * @param {Object} prev    - { name: rawVersion } from previous package.json
 * @param {Object} curr    - { name: rawVersion } from current package.json
 * @returns {{ findings: Array, changes: Array }}
 */
function analyseGroup(group, prev, curr) {
  const findings = [];
  const changes  = [];

  const allNames = new Set([...Object.keys(prev), ...Object.keys(curr)]);

  for (const name of [...allNames].sort()) {
    const prevRaw = prev[name];
    const currRaw = curr[name];

    if (prevRaw === undefined) {
      // New dependency
      findings.push(addedDepFinding(name, currRaw, group));
      changes.push({ name, group, change: 'added', prev: null, curr: currRaw });
      continue;
    }

    if (currRaw === undefined) {
      // Removed dependency
      findings.push(removedDepFinding(name, prevRaw, group));
      changes.push({ name, group, change: 'removed', prev: prevRaw, curr: null });
      continue;
    }

    // Both sides present — compute semver delta
    const prevBare = stripRange(prevRaw);
    const currBare = stripRange(currRaw);
    const semverChange = classifyChange(prevBare, currBare);

    changes.push({ name, group, change: semverChange, prev: prevRaw, curr: currRaw });

    if (semverChange === 'major') {
      findings.push(majorBumpFinding(name, prevRaw, currRaw, group));
    }
    // minor / patch / unchanged / unparseable → no finding
  }

  return { findings, changes };
}

// ---------------------------------------------------------------------------
// Step entry point
// ---------------------------------------------------------------------------

export default async function dependencies(ctx) {
  resetCounter();

  const pkgPath   = path.join(ctx.bundlePath, 'package.json');
  const patchPath = path.join(ctx.bundlePath, 'diff.patch');

  // ── 1. Read current package.json ──────────────────────────────────────────
  let currDeps = { dependencies: {}, devDependencies: {} };
  if (fs.existsSync(pkgPath)) {
    try {
      currDeps = parsePkgDeps(fs.readFileSync(pkgPath, 'utf8'));
    } catch {
      // Unreadable — treat as empty; step 01 will have already flagged this.
    }
  }

  // ── 2. Extract dependency changes from the diff ───────────────────────────
  //
  // The diff is partial — it only shows changed hunks, not the whole file.
  // parsePkgDiffChanges returns per-group maps of:
  //   - removedVersions: packages that appeared on `-` lines (prev version)
  //   - addedNames:      packages that are brand-new (on `+`, never on `-`)
  //
  // To build the full previous state for each group we:
  //   a) Start from the current deps (packages present in both versions).
  //   b) Override with removed versions found in the diff (changed packages).
  //   c) Exclude packages that are brand-new in this release.
  //   d) Re-add any packages that existed before but are now fully removed.

  let diffChanges = {
    removedVersions: { dependencies: {}, devDependencies: {} },
    addedNames:      { dependencies: new Set(), devDependencies: new Set() },
  };

  if (fs.existsSync(patchPath)) {
    try {
      const patchText = fs.readFileSync(patchPath, 'utf8');
      diffChanges = parsePkgDiffChanges(patchText);
    } catch {
      // Unreadable diff — treat as no previous state signal.
    }
  }

  // ── 3. Build previous dependency maps ────────────────────────────────────
  //
  // For each group, the previous map is:
  //   - All packages in current deps, EXCEPT those that are brand-new.
  //   - For packages that changed version, use the old version from the diff.
  //   - For packages not in the diff at all (unchanged), use the current version.
  //   - Plus any packages removed entirely (in removedVersions but not in curr).

  function buildPrevGroup(group, currGroup) {
    const removedVersions = diffChanges.removedVersions[group] ?? {};
    const addedNames      = diffChanges.addedNames[group]      ?? new Set();
    const prev = {};

    for (const [name, currVer] of Object.entries(currGroup)) {
      if (addedNames.has(name)) continue; // brand-new in this release
      prev[name] = removedVersions[name] ?? currVer;
    }

    // Re-add packages that existed before but are now removed entirely.
    for (const [name, prevVer] of Object.entries(removedVersions)) {
      if (!(name in currGroup)) {
        prev[name] = prevVer;
      }
    }

    return prev;
  }

  // ── 4. Analyse each dependency group ──────────────────────────────────────
  const allFindings = [];
  const allChanges  = [];

  for (const group of ['dependencies', 'devDependencies']) {
    const prev = buildPrevGroup(group, currDeps[group] ?? {});
    const curr = currDeps[group] ?? {};

    const { findings, changes } = analyseGroup(group, prev, curr);
    allFindings.push(...findings);
    allChanges.push(...changes);
  }

  return { findings: allFindings, changes: allChanges };
}
