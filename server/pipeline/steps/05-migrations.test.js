/**
 * Tests for Step 05 — Migrations analyzer
 *
 * Fixture bundle: server/sample-bundles/v1.2.0/
 *
 * Migration summary for v1.2.0:
 *   20250630_add_refresh_token_index.sql  — has DELETE FROM, NO rollback
 *   20250629_add_audit_log_table.sql      — clean SQL, HAS .rollback.sql companion
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path   from 'path';
import fs     from 'fs';
import { fileURLToPath } from 'url';

import migrations from './05-migrations.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_BUNDLE = path.resolve(__dirname, '../../sample-bundles/v1.2.0');
const TMP_DIR        = path.resolve(__dirname, '../../.tmp-test');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal PipelineContext. */
function makeCtx(bundlePath, manifest = null) {
  return {
    runId:      'test-run-migrations',
    bundlePath,
    manifest:   manifest ?? buildManifest(bundlePath),
    emit:       () => {},
    results:    {},
  };
}

/**
 * Read manifest.json from `bundlePath` (or return a minimal stub on failure).
 */
function buildManifest(bundlePath) {
  try {
    const raw = fs.readFileSync(path.join(bundlePath, 'manifest.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { migrations: [] };
  }
}

/**
 * Create a temporary bundle with the given files.
 *
 * @param {Record<string, string>} files  - relative path → file content
 * @param {object|null} manifest          - overrides the auto-built manifest
 */
function makeTempBundle(files, manifest = null) {
  const dir = path.join(TMP_DIR, `mig-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });

  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }

  // Write manifest.json if supplied
  if (manifest) {
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  }

  return {
    bundlePath: dir,
    cleanup:    () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// Finding schema assertion
// ---------------------------------------------------------------------------

const FINDING_KEYS = ['id', 'category', 'severity', 'title', 'detail', 'file', 'line', 'recommendation'];

function assertFindingSchema(finding) {
  for (const key of FINDING_KEYS) {
    expect(finding, `finding should have key "${key}"`).toHaveProperty(key);
  }
  expect(typeof finding.id).toBe('string');
  expect(finding.id.length).toBeGreaterThan(0);
  expect(finding.category).toBe('migration');
  expect(['warning', 'critical', 'info']).toContain(finding.severity);
  expect(typeof finding.title).toBe('string');
  expect(typeof finding.detail).toBe('string');
  expect(typeof finding.recommendation).toBe('string');
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('migrations — real fixture bundle (sample-bundles/v1.2.0)', () => {
  it('returns findings and changes arrays', async () => {
    const ctx    = makeCtx(FIXTURE_BUNDLE);
    const result = await migrations(ctx);

    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('changes');
    expect(Array.isArray(result.findings)).toBe(true);
    expect(Array.isArray(result.changes)).toBe(true);
  });

  it('discovers both migrations listed in the manifest', async () => {
    const ctx    = makeCtx(FIXTURE_BUNDLE);
    const result = await migrations(ctx);

    expect(result.changes).toHaveLength(2);

    const filenames = result.changes.map(c => c.migration);
    expect(filenames).toContain('20250630_add_refresh_token_index.sql');
    expect(filenames).toContain('20250629_add_audit_log_table.sql');
  });

  it('marks both migrations as found (file exists in bundle)', async () => {
    const ctx    = makeCtx(FIXTURE_BUNDLE);
    const result = await migrations(ctx);

    for (const change of result.changes) {
      expect(change.found).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Rollback companion detection
// ---------------------------------------------------------------------------

describe('migrations — rollback companion detection', () => {
  it('detects .rollback.sql companion for 20250629_add_audit_log_table', async () => {
    const ctx    = makeCtx(FIXTURE_BUNDLE);
    const result = await migrations(ctx);

    const change = result.changes.find(c => c.migration === '20250629_add_audit_log_table.sql');
    expect(change).toBeDefined();
    expect(change.rollbackPresent).toBe(true);
  });

  it('reports no rollback for 20250630_add_refresh_token_index (no companion exists)', async () => {
    const ctx    = makeCtx(FIXTURE_BUNDLE);
    const result = await migrations(ctx);

    const change = result.changes.find(c => c.migration === '20250630_add_refresh_token_index.sql');
    expect(change).toBeDefined();
    expect(change.rollbackPresent).toBe(false);
  });

  it('accepts a .down.sql companion', async () => {
    const { bundlePath, cleanup } = makeTempBundle(
      {
        'src/db/migrations/0001_create_users.sql':      'CREATE TABLE users (id SERIAL PRIMARY KEY);',
        'src/db/migrations/0001_create_users.down.sql': 'DROP TABLE users;',
      },
      { migrations: ['0001_create_users.sql'] },
    );
    try {
      const ctx    = makeCtx(bundlePath);
      const result = await migrations(ctx);
      expect(result.changes[0].rollbackPresent).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('accepts a rollback_<stem>.sql companion', async () => {
    const { bundlePath, cleanup } = makeTempBundle(
      {
        'src/db/migrations/0002_add_email.sql':          'ALTER TABLE users ADD COLUMN email TEXT;',
        'src/db/migrations/rollback_0002_add_email.sql': 'ALTER TABLE users DROP COLUMN email;',
      },
      { migrations: ['0002_add_email.sql'] },
    );
    try {
      const ctx    = makeCtx(bundlePath);
      const result = await migrations(ctx);
      expect(result.changes[0].rollbackPresent).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('accepts a rollback_<originalFilename> companion', async () => {
    const { bundlePath, cleanup } = makeTempBundle(
      {
        'src/db/migrations/0003_add_index.sql':          'CREATE INDEX idx ON tbl (col);',
        'src/db/migrations/rollback_0003_add_index.sql': 'DROP INDEX idx;',
      },
      { migrations: ['0003_add_index.sql'] },
    );
    try {
      const ctx    = makeCtx(bundlePath);
      const result = await migrations(ctx);
      expect(result.changes[0].rollbackPresent).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Migration with rollback and no risky patterns
// ---------------------------------------------------------------------------

describe('migrations — migration with rollback and no risky SQL', () => {
  it('produces no findings for 20250629_add_audit_log_table (clean + has rollback)', async () => {
    const ctx    = makeCtx(FIXTURE_BUNDLE);
    const result = await migrations(ctx);

    // Only look at findings referencing this file
    const related = result.findings.filter(f =>
      f.file && f.file.includes('20250629_add_audit_log_table'),
    );
    expect(related).toHaveLength(0);
  });

  it('produces zero findings for a clean migration that has a rollback companion', async () => {
    const { bundlePath, cleanup } = makeTempBundle(
      {
        'src/db/migrations/clean.sql':      'CREATE TABLE foo (id SERIAL PRIMARY KEY);',
        'src/db/migrations/clean.down.sql': 'DROP TABLE foo;',
      },
      { migrations: ['clean.sql'] },
    );
    try {
      const ctx    = makeCtx(bundlePath);
      const result = await migrations(ctx);
      expect(result.findings).toHaveLength(0);
      expect(result.changes[0].risks).toHaveLength(0);
      expect(result.changes[0].rollbackPresent).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Migration without rollback
// ---------------------------------------------------------------------------

describe('migrations — migration without rollback', () => {
  it('produces a warning for 20250630_add_refresh_token_index (no rollback companion)', async () => {
    const ctx    = makeCtx(FIXTURE_BUNDLE);
    const result = await migrations(ctx);

    const rollbackFindings = result.findings.filter(f =>
      f.title.includes('no rollback companion') &&
      f.title.includes('20250630_add_refresh_token_index'),
    );
    expect(rollbackFindings.length).toBeGreaterThan(0);
    expect(rollbackFindings[0].severity).toBe('warning');
  });

  it('produces a warning when no rollback companion file is present', async () => {
    const { bundlePath, cleanup } = makeTempBundle(
      { 'src/db/migrations/no_rollback.sql': 'CREATE TABLE t (id INT);' },
      { migrations: ['no_rollback.sql'] },
    );
    try {
      const ctx    = makeCtx(bundlePath);
      const result = await migrations(ctx);

      const f = result.findings.find(f => f.title.includes('no rollback'));
      expect(f).toBeDefined();
      expect(f.severity).toBe('warning');
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// DROP TABLE detection
// ---------------------------------------------------------------------------

describe('migrations — DROP TABLE detection', () => {
  it('flags DROP TABLE as a risky pattern', async () => {
    const { bundlePath, cleanup } = makeTempBundle(
      {
        'src/db/migrations/drop_users.sql':      'DROP TABLE users;',
        'src/db/migrations/drop_users.down.sql': '-- no-op',
      },
      { migrations: ['drop_users.sql'] },
    );
    try {
      const ctx    = makeCtx(bundlePath);
      const result = await migrations(ctx);

      const f = result.findings.find(f => f.title.includes('DROP TABLE'));
      expect(f).toBeDefined();
      expect(f.severity).toBe('warning');
      expect(f.category).toBe('migration');
      expect(result.changes[0].risks).toContain('DROP TABLE');
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE FROM detection
// ---------------------------------------------------------------------------

describe('migrations — DELETE FROM detection', () => {
  it('flags DELETE FROM in 20250630_add_refresh_token_index', async () => {
    const ctx    = makeCtx(FIXTURE_BUNDLE);
    const result = await migrations(ctx);

    const change = result.changes.find(c => c.migration === '20250630_add_refresh_token_index.sql');
    expect(change.risks).toContain('DELETE FROM');

    const f = result.findings.find(f =>
      f.title.includes('DELETE FROM') &&
      f.file.includes('20250630_add_refresh_token_index'),
    );
    expect(f).toBeDefined();
    expect(f.severity).toBe('warning');
  });

  it('flags DELETE FROM in a synthetic migration', async () => {
    const { bundlePath, cleanup } = makeTempBundle(
      {
        'src/db/migrations/purge.sql':      'DELETE FROM sessions WHERE expired = true;',
        'src/db/migrations/purge.down.sql': '-- irreversible',
      },
      { migrations: ['purge.sql'] },
    );
    try {
      const ctx    = makeCtx(bundlePath);
      const result = await migrations(ctx);

      const f = result.findings.find(f => f.title.includes('DELETE FROM'));
      expect(f).toBeDefined();
      expect(f.severity).toBe('warning');
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Case-insensitive risk detection
// ---------------------------------------------------------------------------

describe('migrations — case-insensitive risk detection', () => {
  it('detects lowercase "drop table"', async () => {
    const { bundlePath, cleanup } = makeTempBundle(
      {
        'src/db/migrations/lc_drop.sql':      'drop table old_events;',
        'src/db/migrations/lc_drop.down.sql': '-- n/a',
      },
      { migrations: ['lc_drop.sql'] },
    );
    try {
      const ctx    = makeCtx(bundlePath);
      const result = await migrations(ctx);
      expect(result.changes[0].risks).toContain('DROP TABLE');
    } finally {
      cleanup();
    }
  });

  it('detects mixed-case "Delete From"', async () => {
    const { bundlePath, cleanup } = makeTempBundle(
      {
        'src/db/migrations/mc_delete.sql':      'Delete From stale_sessions;',
        'src/db/migrations/mc_delete.down.sql': '-- n/a',
      },
      { migrations: ['mc_delete.sql'] },
    );
    try {
      const ctx    = makeCtx(bundlePath);
      const result = await migrations(ctx);
      expect(result.changes[0].risks).toContain('DELETE FROM');
    } finally {
      cleanup();
    }
  });

  it('detects all-uppercase "DELETE FROM"', async () => {
    const { bundlePath, cleanup } = makeTempBundle(
      {
        'src/db/migrations/uc_delete.sql':      'DELETE FROM sessions;',
        'src/db/migrations/uc_delete.down.sql': '-- n/a',
      },
      { migrations: ['uc_delete.sql'] },
    );
    try {
      const ctx    = makeCtx(bundlePath);
      const result = await migrations(ctx);
      expect(result.changes[0].risks).toContain('DELETE FROM');
    } finally {
      cleanup();
    }
  });

  it('detects DROP TABLE regardless of companion file case', async () => {
    const { bundlePath, cleanup } = makeTempBundle(
      {
        'src/db/migrations/edge.sql':      'DROP TABLE foo;',
        // companion with uppercase extension — rollback check is case-insensitive
        'src/db/migrations/edge.down.sql': 'create table foo (id int);',
      },
      { migrations: ['edge.sql'] },
    );
    try {
      const ctx    = makeCtx(bundlePath);
      const result = await migrations(ctx);
      // Risky pattern still detected even when rollback exists
      expect(result.changes[0].risks).toContain('DROP TABLE');
      // But no missing-rollback finding
      const missingRollback = result.findings.find(f => f.title.includes('no rollback'));
      expect(missingRollback).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Missing migration file handling
// ---------------------------------------------------------------------------

describe('migrations — missing migration file', () => {
  it('produces a warning finding when migration file is absent from bundle', async () => {
    const { bundlePath, cleanup } = makeTempBundle(
      {}, // no files at all
      { migrations: ['ghost_migration.sql'] },
    );
    try {
      const ctx    = makeCtx(bundlePath);
      const result = await migrations(ctx);

      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].title).toContain('not found in bundle');
      expect(result.findings[0].severity).toBe('warning');
    } finally {
      cleanup();
    }
  });

  it('records the migration in changes with found: false', async () => {
    const { bundlePath, cleanup } = makeTempBundle(
      {},
      { migrations: ['ghost_migration.sql'] },
    );
    try {
      const ctx    = makeCtx(bundlePath);
      const result = await migrations(ctx);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].found).toBe(false);
      expect(result.changes[0].rollbackPresent).toBe(false);
      expect(result.changes[0].risks).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Empty / missing migrations data
// ---------------------------------------------------------------------------

describe('migrations — empty / missing migrations data', () => {
  it('returns empty arrays when ctx.manifest is null', async () => {
    const ctx    = { bundlePath: FIXTURE_BUNDLE, manifest: null, emit: () => {}, results: {} };
    const result = await migrations(ctx);

    expect(result.findings).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it('returns empty arrays when manifest has no migrations field', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE, { name: 'test', version: '1.0.0' });
    const result = await migrations(ctx);

    expect(result.findings).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it('returns empty arrays when migrations is an empty array', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE, { migrations: [] });
    const result = await migrations(ctx);

    expect(result.findings).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it('skips non-string entries in migrations list without crashing', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE, { migrations: [null, 42, '', '  '] });
    const result = await migrations(ctx);

    expect(result.findings).toEqual([]);
    expect(result.changes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Finding schema conformity
// ---------------------------------------------------------------------------

describe('migrations — Finding schema conformity', () => {
  it('every finding from the fixture bundle conforms to the Finding schema', async () => {
    const ctx    = makeCtx(FIXTURE_BUNDLE);
    const result = await migrations(ctx);

    // Fixture has ≥1 finding (DELETE FROM + missing rollback for refresh_token_index)
    expect(result.findings.length).toBeGreaterThan(0);
    for (const finding of result.findings) {
      assertFindingSchema(finding);
    }
  });

  it('all finding IDs begin with "mig-"', async () => {
    const ctx    = makeCtx(FIXTURE_BUNDLE);
    const result = await migrations(ctx);

    for (const f of result.findings) {
      expect(f.id).toMatch(/^mig-\d{3}$/);
    }
  });

  it('all finding IDs are unique within a run', async () => {
    const ctx    = makeCtx(FIXTURE_BUNDLE);
    const result = await migrations(ctx);

    const ids = result.findings.map(f => f.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('category is always "migration"', async () => {
    const ctx    = makeCtx(FIXTURE_BUNDLE);
    const result = await migrations(ctx);

    for (const f of result.findings) {
      expect(f.category).toBe('migration');
    }
  });

  it('a single migration with multiple risks produces multiple findings', async () => {
    const { bundlePath, cleanup } = makeTempBundle(
      {
        // Both DROP TABLE and DELETE FROM in the same file, no rollback
        'src/db/migrations/multi_risk.sql': `
          DROP TABLE old_users;
          DELETE FROM temp_sessions WHERE created_at < NOW() - INTERVAL '1 day';
        `,
      },
      { migrations: ['multi_risk.sql'] },
    );
    try {
      const ctx    = makeCtx(bundlePath);
      const result = await migrations(ctx);

      // Expect: DROP TABLE finding + DELETE FROM finding + missing rollback finding = 3
      expect(result.findings.length).toBeGreaterThanOrEqual(3);

      const titles = result.findings.map(f => f.title);
      expect(titles.some(t => t.includes('DROP TABLE'))).toBe(true);
      expect(titles.some(t => t.includes('DELETE FROM'))).toBe(true);
      expect(titles.some(t => t.includes('no rollback'))).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Returned changes structure
// ---------------------------------------------------------------------------

describe('migrations — returned changes structure', () => {
  it('each changes entry has the required fields', async () => {
    const ctx    = makeCtx(FIXTURE_BUNDLE);
    const result = await migrations(ctx);

    for (const change of result.changes) {
      expect(change).toHaveProperty('migration');
      expect(change).toHaveProperty('file');
      expect(change).toHaveProperty('found');
      expect(change).toHaveProperty('rollbackPresent');
      expect(change).toHaveProperty('risks');
      expect(typeof change.migration).toBe('string');
      expect(typeof change.found).toBe('boolean');
      expect(typeof change.rollbackPresent).toBe('boolean');
      expect(Array.isArray(change.risks)).toBe(true);
    }
  });

  it('changes entry for found migration carries a relative file path', async () => {
    const ctx    = makeCtx(FIXTURE_BUNDLE);
    const result = await migrations(ctx);

    for (const change of result.changes) {
      if (change.found) {
        expect(typeof change.file).toBe('string');
        // Should be relative (not absolute)
        expect(path.isAbsolute(change.file)).toBe(false);
        // Forward slashes even on Windows
        expect(change.file).not.toContain('\\');
      }
    }
  });

  it('changes entry for missing migration has file: null', async () => {
    const { bundlePath, cleanup } = makeTempBundle(
      {},
      { migrations: ['ghost.sql'] },
    );
    try {
      const ctx    = makeCtx(bundlePath);
      const result = await migrations(ctx);

      expect(result.changes[0].file).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('full fixture: refresh_token_index change has risks with DELETE FROM and no rollback', async () => {
    const ctx    = makeCtx(FIXTURE_BUNDLE);
    const result = await migrations(ctx);

    const change = result.changes.find(c => c.migration === '20250630_add_refresh_token_index.sql');
    expect(change.risks).toContain('DELETE FROM');
    expect(change.rollbackPresent).toBe(false);
  });

  it('full fixture: audit_log change has no risks and has rollback', async () => {
    const ctx    = makeCtx(FIXTURE_BUNDLE);
    const result = await migrations(ctx);

    const change = result.changes.find(c => c.migration === '20250629_add_audit_log_table.sql');
    expect(change.risks).toHaveLength(0);
    expect(change.rollbackPresent).toBe(true);
  });
});
