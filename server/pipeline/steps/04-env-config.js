/**
 * Step 04 — Env / Config
 * Identifies configuration keys that are newly required by this release but
 * lack coverage in `manifest.previousConfigKeys` or `<bundlePath>/.env.example`.
 *
 * Strategy:
 *   1. Read `ctx.manifest.configChanges`  — keys introduced by this release.
 *   2. Read `ctx.manifest.previousConfigKeys` — keys that already existed.
 *   3. Read `<bundlePath>/.env.example` — keys documented in the example file.
 *   4. A key is "newly required" when it is in configChanges but absent from
 *      both previousConfigKeys and the .env.example key set.
 *   5. Each newly required key produces a WARNING finding.
 *
 * Outputs:
 *   findings  — one warning per uncovered new key
 *   changes   — array of every config key analysed with its coverage status
 *
 * @param {import('../index.js').PipelineContext} ctx
 * @returns {Promise<{ findings: Array, changes: Array }>}
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// .env.example parser
// ---------------------------------------------------------------------------

/**
 * Parse a .env.example file and return the Set of key names found in it.
 * Only non-commented assignment lines are considered (KEY=value).
 * Never returns values — only key names.
 *
 * Returns an empty Set when the text is empty or unparseable.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
function parseEnvExampleKeys(text) {
  const keys = new Set();
  if (!text || typeof text !== 'string') return keys;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    // Skip blank lines and comments
    if (!line || line.startsWith('#')) continue;
    // Match KEY=... or KEY = ...
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    // A valid env key: uppercase/lowercase letters, digits, underscores
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      keys.add(key);
    }
  }

  return keys;
}

// ---------------------------------------------------------------------------
// Finding builder
// ---------------------------------------------------------------------------

let _findingCounter = 0;

function nextId() {
  _findingCounter += 1;
  return `env-${String(_findingCounter).padStart(3, '0')}`;
}

/**
 * Reset the per-run finding counter to keep IDs deterministic.
 */
function resetCounter() {
  _findingCounter = 0;
}

/**
 * Build a WARNING finding for a newly required config key with no coverage.
 *
 * @param {string} key
 * @returns {Object}
 */
function uncoveredKeyFinding(key) {
  return {
    id: nextId(),
    category: 'env-config',
    severity: 'warning',
    title: `New required config key not documented: ${key}`,
    detail:
      `"${key}" appears in configChanges for this release but is not present ` +
      `in previousConfigKeys or .env.example. Deployers may not know this key ` +
      `is required, risking misconfiguration.`,
    file: '.env.example',
    line: null,
    recommendation:
      `Add "${key}" to .env.example with a placeholder value and a comment ` +
      `explaining its purpose before deploying.`,
  };
}

// ---------------------------------------------------------------------------
// Step entry point
// ---------------------------------------------------------------------------

export default async function envConfig(ctx) {
  resetCounter();

  // ── 1. Read config lists from manifest ────────────────────────────────────
  const configChanges    = ctx.manifest?.configChanges    ?? [];
  const previousConfigKeys = ctx.manifest?.previousConfigKeys ?? [];

  // Normalise: ensure arrays; tolerate non-array values gracefully
  const currentKeys  = Array.isArray(configChanges)      ? configChanges      : [];
  const previousKeys = Array.isArray(previousConfigKeys) ? previousConfigKeys : [];

  // ── 2. Read .env.example from the bundle (if present) ─────────────────────
  const envExamplePath = path.join(ctx.bundlePath, '.env.example');
  let envExampleKeys   = new Set();

  if (fs.existsSync(envExamplePath)) {
    try {
      const text = fs.readFileSync(envExamplePath, 'utf8');
      envExampleKeys = parseEnvExampleKeys(text);
    } catch {
      // Unreadable — treat as no coverage; the warning will still fire.
    }
  }

  // ── 3. Build lookup sets for quick membership tests ───────────────────────
  const previousSet = new Set(previousKeys);

  // ── 4. Classify every key in configChanges ────────────────────────────────
  const findings = [];
  const changes  = [];

  for (const key of currentKeys) {
    if (typeof key !== 'string' || !key.trim()) continue;

    const inPrevious   = previousSet.has(key);
    const inEnvExample = envExampleKeys.has(key);
    const covered      = inPrevious || inEnvExample;

    changes.push({
      key,
      inPreviousConfigKeys: inPrevious,
      inEnvExample:         inEnvExample,
      covered,
    });

    if (!covered) {
      findings.push(uncoveredKeyFinding(key));
    }
  }

  return { findings, changes };
}
