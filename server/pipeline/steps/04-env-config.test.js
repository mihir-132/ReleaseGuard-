/**
 * Tests for Step 04 — Env / Config (server/pipeline/steps/04-env-config.js)
 *
 * Covers:
 *   - detecting new configuration keys (fixture bundle)
 *   - warning severity for uncovered new keys
 *   - keys already in previousConfigKeys are not incorrectly flagged
 *   - .env.example coverage suppresses findings
 *   - multiple config changes produce one change entry each
 *   - empty configChanges returns no findings and no changes
 *   - missing manifest returns no findings and no changes
 *   - missing .env.example is handled safely (no crash)
 *   - malformed .env.example is handled safely
 *   - Finding schema conformity (all required keys present)
 *   - returned changes structure (key, inPreviousConfigKeys, inEnvExample, covered)
 *   - all three fixture-bundle keys are correctly classified
 *   - category is exactly "env-config"
 *   - secret values are not exposed in findings
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import envConfig from './04-env-config.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_BUNDLE = path.resolve(__dirname, '../../sample-bundles/v1.2.0');
const TMP_DIR        = path.resolve(__dirname, '../../.tmp-test');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ctx with the given bundlePath and manifest. */
function makeCtx(bundlePath, manifest = null) {
  return { bundlePath, manifest, runId: 'test-run', emit: vi.fn(), results: {} };
}

/**
 * Create a temporary bundle directory containing the provided files.
 * Pass `null` as a value to skip creating that file.
 *
 * @param {Record<string, string|null>} files
 * @param {object|null} manifest
 * @returns {{ ctx: object, cleanup: () => void }}
 */
function makeTempBundle(files, manifest = null) {
  const dir = path.join(
    TMP_DIR,
    `env-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    if (content !== null && content !== undefined) {
      fs.writeFileSync(path.join(dir, name), content, 'utf8');
    }
  }
  return {
    ctx:     makeCtx(dir, manifest),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// Finding schema validator
// ---------------------------------------------------------------------------
const FINDING_KEYS = [
  'id', 'category', 'severity', 'title', 'detail', 'file', 'line', 'recommendation',
];

function assertFindingSchema(finding) {
  for (const key of FINDING_KEYS) {
    expect(finding, `finding missing key "${key}"`).toHaveProperty(key);
  }
}

// ---------------------------------------------------------------------------
// Tests — real fixture bundle (sample-bundles/v1.2.0)
// ---------------------------------------------------------------------------

describe('env-config — real fixture bundle (sample-bundles/v1.2.0)', () => {
  it('returns findings and changes arrays', async () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_BUNDLE, 'manifest.json'), 'utf8')
    );
    const ctx = makeCtx(FIXTURE_BUNDLE, manifest);
    const result = await envConfig(ctx);

    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('changes');
    expect(Array.isArray(result.findings)).toBe(true);
    expect(Array.isArray(result.changes)).toBe(true);
  });

  it('produces exactly one change entry per configChanges key', async () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_BUNDLE, 'manifest.json'), 'utf8')
    );
    const ctx = makeCtx(FIXTURE_BUNDLE, manifest);
    const { changes } = await envConfig(ctx);

    // The fixture has 3 configChanges keys
    expect(changes).toHaveLength(3);
    const keys = changes.map((c) => c.key);
    expect(keys).toContain('JWT_REFRESH_SECRET');
    expect(keys).toContain('DATABASE_POOL_SIZE');
    expect(keys).toContain('FEATURE_FLAG_CHECKOUT_V2');
  });

  it('produces no findings because all keys are covered by .env.example', async () => {
    // All three configChanges keys appear in the fixture .env.example,
    // so no warnings should fire.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_BUNDLE, 'manifest.json'), 'utf8')
    );
    const ctx = makeCtx(FIXTURE_BUNDLE, manifest);
    const { findings } = await envConfig(ctx);

    expect(findings).toHaveLength(0);
  });

  it('marks all fixture keys as covered (via .env.example)', async () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_BUNDLE, 'manifest.json'), 'utf8')
    );
    const ctx = makeCtx(FIXTURE_BUNDLE, manifest);
    const { changes } = await envConfig(ctx);

    for (const change of changes) {
      expect(change.covered).toBe(true);
      expect(change.inEnvExample).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — detecting new configuration keys (synthetic bundles)
// ---------------------------------------------------------------------------

describe('env-config — detecting new configuration keys', () => {
  it('flags a key that is in configChanges but absent from both previous and .env.example', async () => {
    const manifest = {
      configChanges:     ['NEW_SECRET_KEY'],
      previousConfigKeys: [],
    };
    const { ctx, cleanup } = makeTempBundle({}, manifest);
    try {
      const { findings } = await envConfig(ctx);
      expect(findings).toHaveLength(1);
      expect(findings[0].title).toMatch('NEW_SECRET_KEY');
    } finally {
      cleanup();
    }
  });

  it('produces a WARNING severity for uncovered new keys', async () => {
    const manifest = {
      configChanges:     ['UNCOVERED_KEY'],
      previousConfigKeys: [],
    };
    const { ctx, cleanup } = makeTempBundle({}, manifest);
    try {
      const { findings } = await envConfig(ctx);
      expect(findings[0].severity).toBe('warning');
    } finally {
      cleanup();
    }
  });

  it('sets category to "env-config"', async () => {
    const manifest = {
      configChanges:     ['UNCOVERED_KEY'],
      previousConfigKeys: [],
    };
    const { ctx, cleanup } = makeTempBundle({}, manifest);
    try {
      const { findings } = await envConfig(ctx);
      expect(findings[0].category).toBe('env-config');
    } finally {
      cleanup();
    }
  });

  it('produces one finding per uncovered key', async () => {
    const manifest = {
      configChanges:     ['KEY_A', 'KEY_B', 'KEY_C'],
      previousConfigKeys: [],
    };
    const { ctx, cleanup } = makeTempBundle({}, manifest);
    try {
      const { findings } = await envConfig(ctx);
      expect(findings).toHaveLength(3);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — previousConfigKeys coverage
// ---------------------------------------------------------------------------

describe('env-config — keys present in previousConfigKeys are not flagged', () => {
  it('suppresses finding when key exists in previousConfigKeys', async () => {
    const manifest = {
      configChanges:     ['EXISTING_KEY'],
      previousConfigKeys: ['EXISTING_KEY'],
    };
    const { ctx, cleanup } = makeTempBundle({}, manifest);
    try {
      const { findings, changes } = await envConfig(ctx);
      expect(findings).toHaveLength(0);
      expect(changes[0].inPreviousConfigKeys).toBe(true);
      expect(changes[0].covered).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('only flags keys absent from previousConfigKeys', async () => {
    const manifest = {
      configChanges:     ['OLD_KEY', 'NEW_KEY'],
      previousConfigKeys: ['OLD_KEY'],
    };
    const { ctx, cleanup } = makeTempBundle({}, manifest);
    try {
      const { findings } = await envConfig(ctx);
      expect(findings).toHaveLength(1);
      expect(findings[0].title).toMatch('NEW_KEY');
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — .env.example coverage
// ---------------------------------------------------------------------------

describe('env-config — .env.example coverage', () => {
  it('suppresses finding when key appears in .env.example', async () => {
    const manifest = {
      configChanges:     ['MY_FEATURE_FLAG'],
      previousConfigKeys: [],
    };
    const envExample = `# feature flags\nMY_FEATURE_FLAG=false\n`;
    const { ctx, cleanup } = makeTempBundle({ '.env.example': envExample }, manifest);
    try {
      const { findings, changes } = await envConfig(ctx);
      expect(findings).toHaveLength(0);
      expect(changes[0].inEnvExample).toBe(true);
      expect(changes[0].covered).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('still flags a key that is commented-out in .env.example', async () => {
    // A commented-out key is NOT considered coverage
    const manifest = {
      configChanges:     ['COMMENTED_KEY'],
      previousConfigKeys: [],
    };
    const envExample = `# COMMENTED_KEY=some_value\n`;
    const { ctx, cleanup } = makeTempBundle({ '.env.example': envExample }, manifest);
    try {
      const { findings } = await envConfig(ctx);
      expect(findings).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it('handles missing .env.example safely — flags uncovered keys', async () => {
    const manifest = {
      configChanges:     ['MISSING_ENV_KEY'],
      previousConfigKeys: [],
    };
    // No .env.example file in the bundle
    const { ctx, cleanup } = makeTempBundle({}, manifest);
    try {
      const { findings } = await envConfig(ctx);
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('warning');
    } finally {
      cleanup();
    }
  });

  it('handles malformed .env.example safely — no crash, key still flagged', async () => {
    const manifest = {
      configChanges:     ['SOME_KEY'],
      previousConfigKeys: [],
    };
    // Malformed: no assignments, just garbage
    const envExample = `!@#$%^&*()\n====\n>>><<<\n`;
    const { ctx, cleanup } = makeTempBundle({ '.env.example': envExample }, manifest);
    try {
      const { findings } = await envConfig(ctx);
      // Key is not in the malformed file, so it must still be flagged
      expect(findings).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it('parses .env.example keys without capturing values', async () => {
    // Ensures the implementation never puts secret values into findings
    const manifest = {
      configChanges:     ['SECRET_KEY'],
      previousConfigKeys: [],
    };
    const secretValue = 'super-secret-value-1234';
    const envExample  = `SECRET_KEY=${secretValue}\n`;
    const { ctx, cleanup } = makeTempBundle({ '.env.example': envExample }, manifest);
    try {
      const { findings, changes } = await envConfig(ctx);
      // Key is covered by .env.example — no finding
      expect(findings).toHaveLength(0);
      // The change record must not contain the secret value
      const change = changes[0];
      expect(JSON.stringify(change)).not.toContain(secretValue);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — empty / missing configuration data
// ---------------------------------------------------------------------------

describe('env-config — empty / missing configuration data', () => {
  it('returns empty findings and changes when configChanges is empty', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE, { configChanges: [], previousConfigKeys: [] });
    const { findings, changes } = await envConfig(ctx);
    expect(findings).toHaveLength(0);
    expect(changes).toHaveLength(0);
  });

  it('returns empty findings and changes when manifest is null', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE, null);
    const { findings, changes } = await envConfig(ctx);
    expect(findings).toHaveLength(0);
    expect(changes).toHaveLength(0);
  });

  it('returns empty findings when manifest has no configChanges field', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE, { previousConfigKeys: ['SOME_KEY'] });
    const { findings, changes } = await envConfig(ctx);
    expect(findings).toHaveLength(0);
    expect(changes).toHaveLength(0);
  });

  it('handles missing previousConfigKeys field gracefully', async () => {
    const manifest = { configChanges: ['ORPHAN_KEY'] };
    const { ctx, cleanup } = makeTempBundle({}, manifest);
    try {
      const { findings } = await envConfig(ctx);
      expect(findings).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it('ignores non-string entries in configChanges', async () => {
    const manifest = {
      configChanges:     [null, 42, '', 'VALID_KEY'],
      previousConfigKeys: [],
    };
    const { ctx, cleanup } = makeTempBundle({}, manifest);
    try {
      const { changes } = await envConfig(ctx);
      // Only the valid string 'VALID_KEY' should appear (empty string is skipped)
      expect(changes).toHaveLength(1);
      expect(changes[0].key).toBe('VALID_KEY');
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — Finding schema conformity
// ---------------------------------------------------------------------------

describe('env-config — Finding schema conformity', () => {
  it('every finding contains all required schema keys', async () => {
    const manifest = {
      configChanges:     ['KEY_ONE', 'KEY_TWO'],
      previousConfigKeys: [],
    };
    const { ctx, cleanup } = makeTempBundle({}, manifest);
    try {
      const { findings } = await envConfig(ctx);
      expect(findings.length).toBeGreaterThan(0);
      for (const finding of findings) {
        assertFindingSchema(finding);
      }
    } finally {
      cleanup();
    }
  });

  it('finding id is unique across multiple findings', async () => {
    const manifest = {
      configChanges:     ['KEY_A', 'KEY_B', 'KEY_C'],
      previousConfigKeys: [],
    };
    const { ctx, cleanup } = makeTempBundle({}, manifest);
    try {
      const { findings } = await envConfig(ctx);
      const ids = findings.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      cleanup();
    }
  });

  it('finding id starts with "env-"', async () => {
    const manifest = {
      configChanges:     ['SOME_KEY'],
      previousConfigKeys: [],
    };
    const { ctx, cleanup } = makeTempBundle({}, manifest);
    try {
      const { findings } = await envConfig(ctx);
      expect(findings[0].id).toMatch(/^env-/);
    } finally {
      cleanup();
    }
  });

  it('finding file field is ".env.example"', async () => {
    const manifest = {
      configChanges:     ['SOME_KEY'],
      previousConfigKeys: [],
    };
    const { ctx, cleanup } = makeTempBundle({}, manifest);
    try {
      const { findings } = await envConfig(ctx);
      expect(findings[0].file).toBe('.env.example');
    } finally {
      cleanup();
    }
  });

  it('finding line field is null', async () => {
    const manifest = {
      configChanges:     ['SOME_KEY'],
      previousConfigKeys: [],
    };
    const { ctx, cleanup } = makeTempBundle({}, manifest);
    try {
      const { findings } = await envConfig(ctx);
      expect(findings[0].line).toBeNull();
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — returned changes structure
// ---------------------------------------------------------------------------

describe('env-config — returned changes structure', () => {
  it('change entry has key, inPreviousConfigKeys, inEnvExample, covered fields', async () => {
    const manifest = {
      configChanges:     ['CHECK_KEY'],
      previousConfigKeys: [],
    };
    const { ctx, cleanup } = makeTempBundle({}, manifest);
    try {
      const { changes } = await envConfig(ctx);
      expect(changes[0]).toMatchObject({
        key:                  'CHECK_KEY',
        inPreviousConfigKeys: expect.any(Boolean),
        inEnvExample:         expect.any(Boolean),
        covered:              expect.any(Boolean),
      });
    } finally {
      cleanup();
    }
  });

  it('covered is true when key is in previousConfigKeys', async () => {
    const manifest = {
      configChanges:     ['PREV_KEY'],
      previousConfigKeys: ['PREV_KEY'],
    };
    const { ctx, cleanup } = makeTempBundle({}, manifest);
    try {
      const { changes } = await envConfig(ctx);
      expect(changes[0].covered).toBe(true);
      expect(changes[0].inPreviousConfigKeys).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('covered is false when key is in neither previous nor .env.example', async () => {
    const manifest = {
      configChanges:     ['NAKED_KEY'],
      previousConfigKeys: [],
    };
    const { ctx, cleanup } = makeTempBundle({}, manifest);
    try {
      const { changes } = await envConfig(ctx);
      expect(changes[0].covered).toBe(false);
      expect(changes[0].inPreviousConfigKeys).toBe(false);
      expect(changes[0].inEnvExample).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('multiple config changes produce the correct number of change entries', async () => {
    const manifest = {
      configChanges:     ['A', 'B', 'C', 'D'],
      previousConfigKeys: ['B'],
    };
    const envExample = 'C=\n';
    const { ctx, cleanup } = makeTempBundle({ '.env.example': envExample }, manifest);
    try {
      const { changes, findings } = await envConfig(ctx);
      expect(changes).toHaveLength(4);
      // Only A and D are uncovered
      expect(findings).toHaveLength(2);
      const uncoveredKeys = findings.map((f) => f.title).join(' ');
      expect(uncoveredKeys).toMatch('A');
      expect(uncoveredKeys).toMatch('D');
    } finally {
      cleanup();
    }
  });

  it('IDs are deterministic: same input produces same IDs on repeated calls', async () => {
    const manifest = {
      configChanges:     ['KEY_X', 'KEY_Y'],
      previousConfigKeys: [],
    };
    const { ctx: ctx1, cleanup: cleanup1 } = makeTempBundle({}, manifest);
    const { ctx: ctx2, cleanup: cleanup2 } = makeTempBundle({}, manifest);
    try {
      const result1 = await envConfig(ctx1);
      const result2 = await envConfig(ctx2);
      expect(result1.findings.map((f) => f.id)).toEqual(result2.findings.map((f) => f.id));
    } finally {
      cleanup1();
      cleanup2();
    }
  });
});
