/**
 * Tests for Step 07 — Deployment Readiness
 *
 * Covers:
 *  1.  All five checklist items passing → score 100
 *  2.  Critical dependency failure
 *  3.  Migration rollback failure
 *  4.  Env/config failure
 *  5.  Test gap below 30% passes
 *  6.  Test gap exactly 30% fails (strictly < 30 is required)
 *  7.  Test gap above 30% fails
 *  8.  Deleted src/api/ file without replacement
 *  9.  Deleted src/api/ file WITH a replacement represented in diff data
 * 10.  Multiple checklist failures
 * 11.  Correct readiness score
 * 12.  Finding schema
 * 13.  Deterministic unique finding IDs
 * 14.  Missing/empty prior-step results
 * 15.  Stable checklist/result structure
 *
 * Real fixture bundle (server/sample-bundles/v1.2.0):
 *   Expected from the real Analyzers 01–06 pipeline results:
 *     Check 1 (no critical deps)          → PASS  (03 only emits warning/info)
 *     Check 2 (migration rollbacks)       → FAIL  (20250630_add_refresh_token_index has no rollback)
 *     Check 3 (env config)                → PASS  (all keys are in .env.example)
 *     Check 4 (test gap < 30%)            → FAIL  (06 returns 50%)
 *     Check 5 (no api/ deletions without replacement) → PASS (legacyCheckout deleted, checkoutRoutes added)
 *   readinessScore: 60
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path   from 'path';
import fs     from 'fs';
import { fileURLToPath } from 'url';

import deployment from './07-deployment.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_BUNDLE = path.resolve(__dirname, '../../sample-bundles/v1.2.0');

// ---------------------------------------------------------------------------
// Finding schema
// ---------------------------------------------------------------------------

const FINDING_KEYS = [
  'id', 'category', 'severity', 'title', 'detail', 'file', 'line', 'recommendation',
];

function assertFindingSchema(finding) {
  for (const key of FINDING_KEYS) {
    expect(finding, `finding should have key "${key}"`).toHaveProperty(key);
  }
  expect(typeof finding.id).toBe('string');
  expect(finding.id.length).toBeGreaterThan(0);
  expect(finding.category).toBe('deployment');
  expect(['warning', 'critical', 'info']).toContain(finding.severity);
  expect(typeof finding.title).toBe('string');
  expect(finding.title.length).toBeGreaterThan(0);
  expect(typeof finding.detail).toBe('string');
  expect(finding.detail.length).toBeGreaterThan(0);
  expect(typeof finding.recommendation).toBe('string');
  expect(finding.recommendation.length).toBeGreaterThan(0);
  expect(finding.file).toBeNull();
  expect(finding.line).toBeNull();
}

// ---------------------------------------------------------------------------
// Context builder helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal PipelineContext with the given overrides for step results.
 *
 * @param {object} resultsOverrides - partial step results to inject
 * @returns {object}
 */
function makeCtx(resultsOverrides = {}) {
  return {
    runId:      'test-run-07',
    bundlePath: FIXTURE_BUNDLE,
    manifest:   {},
    emit:       () => {},
    results:    resultsOverrides,
  };
}

/**
 * Build a standard "all passing" context.
 */
function makeAllPassCtx() {
  return makeCtx({
    '03-dependencies': {
      findings: [
        // Only non-critical findings — should not trigger check 1 failure
        { id: 'dep-001', severity: 'info',    category: 'dependency', title: 'New dep' },
        { id: 'dep-002', severity: 'warning', category: 'dependency', title: 'Major bump' },
      ],
      changes: [],
    },
    '05-migrations': {
      findings: [],
      changes: [
        { migration: 'mig001.sql', rollbackPresent: true, risks: [] },
        { migration: 'mig002.sql', rollbackPresent: true, risks: [] },
      ],
    },
    '04-env-config': {
      findings: [],
      changes: [
        { key: 'DB_URL',     covered: true },
        { key: 'JWT_SECRET', covered: true },
      ],
    },
    '06-test-gap': {
      findings: [],
      testGapPct: 0,
      totalSourceFiles: 5,
      covered:   ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js', 'src/e.js'],
      uncovered: [],
    },
    '02-diff': {
      findings: [],
      changedFiles: [
        { path: 'src/a.js',              status: 'modified' },
        { path: 'src/api/newRoute.js',   status: 'added'    },
      ],
      counts: {},
    },
  });
}

// ---------------------------------------------------------------------------
// 1. All five checklist items passing
// ---------------------------------------------------------------------------

describe('deployment — all checklist items passing', () => {
  let result;

  beforeAll(async () => {
    result = await deployment(makeAllPassCtx());
  });

  it('returns findings, checklist, and readinessScore', () => {
    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('checklist');
    expect(result).toHaveProperty('readinessScore');
  });

  it('produces no findings when all items pass', () => {
    expect(result.findings).toHaveLength(0);
  });

  it('readinessScore is 100 when all items pass', () => {
    expect(result.readinessScore).toBe(100);
  });

  it('all five checklist items have passed = true', () => {
    expect(result.checklist).toHaveLength(5);
    for (const item of result.checklist) {
      expect(item.passed).toBe(true);
    }
  });

  it('each checklist item contributes 20 points', () => {
    for (const item of result.checklist) {
      expect(item.points).toBe(20);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Critical dependency failure
// ---------------------------------------------------------------------------

describe('deployment — critical dependency failure', () => {
  let result;

  beforeAll(async () => {
    const ctx = makeCtx({
      ...makeAllPassCtx().results,
      '03-dependencies': {
        findings: [
          { id: 'dep-crit-001', severity: 'critical', category: 'dependency', title: 'Vulnerable dep' },
        ],
        changes: [],
      },
    });
    result = await deployment(ctx);
  });

  it('check 1 fails', () => {
    expect(result.checklist[0].passed).toBe(false);
    expect(result.checklist[0].points).toBe(0);
  });

  it('produces a finding for critical deps', () => {
    const depFinding = result.findings.find(f => f.title.includes('Critical dependency'));
    expect(depFinding).toBeDefined();
  });

  it('readinessScore is 80 (4 of 5 items pass)', () => {
    expect(result.readinessScore).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// 3. Migration rollback failure
// ---------------------------------------------------------------------------

describe('deployment — migration rollback failure', () => {
  let result;

  beforeAll(async () => {
    const ctx = makeCtx({
      ...makeAllPassCtx().results,
      '05-migrations': {
        findings: [],
        changes: [
          { migration: 'add_users.sql',  rollbackPresent: true  },
          { migration: 'drop_temp.sql',  rollbackPresent: false },
        ],
      },
    });
    result = await deployment(ctx);
  });

  it('check 2 fails', () => {
    expect(result.checklist[1].passed).toBe(false);
    expect(result.checklist[1].points).toBe(0);
  });

  it('produces a finding mentioning the missing rollback file', () => {
    const mig = result.findings.find(f => f.title.includes('rollback'));
    expect(mig).toBeDefined();
    expect(mig.detail).toContain('drop_temp.sql');
  });

  it('readinessScore is 80', () => {
    expect(result.readinessScore).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// 4. Env/config failure
// ---------------------------------------------------------------------------

describe('deployment — env/config failure', () => {
  let result;

  beforeAll(async () => {
    const ctx = makeCtx({
      ...makeAllPassCtx().results,
      '04-env-config': {
        findings: [],
        changes: [
          { key: 'NEW_SECRET', covered: false },
          { key: 'OLD_KEY',    covered: true  },
        ],
      },
    });
    result = await deployment(ctx);
  });

  it('check 3 fails', () => {
    expect(result.checklist[2].passed).toBe(false);
    expect(result.checklist[2].points).toBe(0);
  });

  it('produces a finding mentioning the uncovered key', () => {
    const envFinding = result.findings.find(f => f.title.includes('config key'));
    expect(envFinding).toBeDefined();
    expect(envFinding.detail).toContain('NEW_SECRET');
  });

  it('readinessScore is 80', () => {
    expect(result.readinessScore).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// 5. Test gap below 30% passes
// ---------------------------------------------------------------------------

describe('deployment — test gap 29% passes', () => {
  let result;

  beforeAll(async () => {
    const ctx = makeCtx({
      ...makeAllPassCtx().results,
      '06-test-gap': { findings: [], testGapPct: 29, totalSourceFiles: 10 },
    });
    result = await deployment(ctx);
  });

  it('check 4 passes at 29%', () => {
    expect(result.checklist[3].passed).toBe(true);
  });

  it('produces no test-gap finding at 29%', () => {
    const gapFinding = result.findings.find(f => f.title.includes('Test gap'));
    expect(gapFinding).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. Test gap exactly 30% fails
// ---------------------------------------------------------------------------

describe('deployment — test gap exactly 30% fails', () => {
  let result;

  beforeAll(async () => {
    const ctx = makeCtx({
      ...makeAllPassCtx().results,
      '06-test-gap': { findings: [], testGapPct: 30, totalSourceFiles: 10 },
    });
    result = await deployment(ctx);
  });

  it('check 4 fails at exactly 30%', () => {
    expect(result.checklist[3].passed).toBe(false);
  });

  it('produces a test-gap finding at exactly 30%', () => {
    const gapFinding = result.findings.find(f => f.title.includes('Test gap'));
    expect(gapFinding).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Test gap above 30% fails
// ---------------------------------------------------------------------------

describe('deployment — test gap 50% fails', () => {
  let result;

  beforeAll(async () => {
    const ctx = makeCtx({
      ...makeAllPassCtx().results,
      '06-test-gap': { findings: [], testGapPct: 50, totalSourceFiles: 6 },
    });
    result = await deployment(ctx);
  });

  it('check 4 fails at 50%', () => {
    expect(result.checklist[3].passed).toBe(false);
    expect(result.checklist[3].points).toBe(0);
  });

  it('produces a test-gap finding mentioning 50%', () => {
    const gapFinding = result.findings.find(f => f.title.includes('50%'));
    expect(gapFinding).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Deleted src/api/ file WITHOUT replacement
// ---------------------------------------------------------------------------

describe('deployment — deleted src/api/ file without replacement', () => {
  let result;

  beforeAll(async () => {
    const ctx = makeCtx({
      ...makeAllPassCtx().results,
      '02-diff': {
        findings: [],
        changedFiles: [
          { path: 'src/api/oldRoutes.js', status: 'deleted'  },
          { path: 'src/db/pool.js',       status: 'modified' },
        ],
        counts: {},
      },
    });
    result = await deployment(ctx);
  });

  it('check 5 fails when no replacement is present', () => {
    expect(result.checklist[4].passed).toBe(false);
    expect(result.checklist[4].points).toBe(0);
  });

  it('produces a finding mentioning the deleted file', () => {
    const apiFinding = result.findings.find(f => f.title.includes('src/api/'));
    expect(apiFinding).toBeDefined();
    expect(apiFinding.detail).toContain('src/api/oldRoutes.js');
  });
});

// ---------------------------------------------------------------------------
// 9. Deleted src/api/ file WITH a replacement
// ---------------------------------------------------------------------------

describe('deployment — deleted src/api/ file WITH replacement', () => {
  let result;

  beforeAll(async () => {
    const ctx = makeCtx({
      ...makeAllPassCtx().results,
      '02-diff': {
        findings: [],
        changedFiles: [
          { path: 'src/api/legacyCheckout.js', status: 'deleted' },
          { path: 'src/api/checkoutRoutes.js', status: 'added'   },
        ],
        counts: {},
      },
    });
    result = await deployment(ctx);
  });

  it('check 5 passes when a replacement is present', () => {
    expect(result.checklist[4].passed).toBe(true);
  });

  it('produces no api-deletion finding when a replacement exists', () => {
    const apiFinding = result.findings.find(f => f.title.includes('src/api/'));
    expect(apiFinding).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 10. Multiple checklist failures
// ---------------------------------------------------------------------------

describe('deployment — multiple checklist failures', () => {
  let result;

  beforeAll(async () => {
    const ctx = makeCtx({
      '03-dependencies': {
        findings: [{ id: 'dep-crit-001', severity: 'critical', category: 'dependency', title: 'Bad dep' }],
        changes:  [],
      },
      '05-migrations': {
        findings: [],
        changes:  [{ migration: 'bad.sql', rollbackPresent: false }],
      },
      '04-env-config': {
        findings: [],
        changes:  [{ key: 'MISSING_KEY', covered: false }],
      },
      '06-test-gap': {
        findings: [],
        testGapPct: 80,
        totalSourceFiles: 10,
      },
      '02-diff': {
        findings: [],
        changedFiles: [
          { path: 'src/api/gone.js', status: 'deleted' },
        ],
        counts: {},
      },
    });
    result = await deployment(ctx);
  });

  it('all 5 checklist items fail', () => {
    for (const item of result.checklist) {
      expect(item.passed).toBe(false);
    }
  });

  it('readinessScore is 0', () => {
    expect(result.readinessScore).toBe(0);
  });

  it('produces 5 findings', () => {
    expect(result.findings).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// 11. Correct readiness score
// ---------------------------------------------------------------------------

describe('deployment — readiness score arithmetic', () => {
  it('score = 60 when 3 items pass and 2 fail', async () => {
    // Pass: dep-check, env-check, api-check
    // Fail: migration-check, test-gap-check
    const ctx = makeCtx({
      ...makeAllPassCtx().results,
      '05-migrations': {
        findings: [],
        changes:  [{ migration: 'x.sql', rollbackPresent: false }],
      },
      '06-test-gap': {
        findings: [],
        testGapPct: 50,
        totalSourceFiles: 4,
      },
    });
    const result = await deployment(ctx);
    expect(result.readinessScore).toBe(60);
  });

  it('score = 40 when 2 items pass and 3 fail', async () => {
    const ctx = makeCtx({
      '03-dependencies': {
        findings: [{ id: 'd', severity: 'critical', category: 'dependency', title: 't' }],
        changes:  [],
      },
      '05-migrations': {
        findings: [],
        changes:  [{ migration: 'x.sql', rollbackPresent: false }],
      },
      '04-env-config': {
        findings: [],
        changes:  [{ key: 'X', covered: false }],
      },
      '06-test-gap': {
        findings: [],
        testGapPct: 0,
        totalSourceFiles: 5,
      },
      '02-diff': {
        findings: [],
        changedFiles: [
          { path: 'src/api/old.js', status: 'added' },
        ],
        counts: {},
      },
    });
    const result = await deployment(ctx);
    expect(result.readinessScore).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// 12. Finding schema
// ---------------------------------------------------------------------------

describe('deployment — finding schema', () => {
  it('all findings conform to the Finding schema', async () => {
    const ctx = makeCtx({
      '03-dependencies': {
        findings: [{ id: 'd', severity: 'critical', category: 'dependency', title: 't' }],
        changes:  [],
      },
      '05-migrations': {
        findings: [],
        changes:  [{ migration: 'x.sql', rollbackPresent: false }],
      },
      '04-env-config': {
        findings: [],
        changes:  [{ key: 'X', covered: false }],
      },
      '06-test-gap': {
        findings: [],
        testGapPct: 50,
        totalSourceFiles: 4,
      },
      '02-diff': {
        findings: [],
        changedFiles: [{ path: 'src/api/gone.js', status: 'deleted' }],
        counts: {},
      },
    });
    const result = await deployment(ctx);
    expect(result.findings.length).toBeGreaterThan(0);
    for (const finding of result.findings) {
      assertFindingSchema(finding);
    }
  });
});

// ---------------------------------------------------------------------------
// 13. Deterministic unique finding IDs
// ---------------------------------------------------------------------------

describe('deployment — deterministic unique finding IDs', () => {
  it('same input produces same IDs on repeated invocations', async () => {
    const buildCtx = () => makeCtx({
      '03-dependencies': {
        findings: [{ id: 'd', severity: 'critical', category: 'dependency', title: 't' }],
        changes:  [],
      },
      '05-migrations': {
        findings: [],
        changes:  [{ migration: 'x.sql', rollbackPresent: false }],
      },
      '04-env-config': {
        findings: [],
        changes:  [{ key: 'X', covered: false }],
      },
      '06-test-gap': {
        findings: [],
        testGapPct: 50,
        totalSourceFiles: 4,
      },
      '02-diff': {
        findings: [],
        changedFiles: [{ path: 'src/api/gone.js', status: 'deleted' }],
        counts: {},
      },
    });

    const r1 = await deployment(buildCtx());
    const r2 = await deployment(buildCtx());

    const ids1 = r1.findings.map(f => f.id);
    const ids2 = r2.findings.map(f => f.id);
    expect(ids1).toEqual(ids2);
  });

  it('finding IDs are unique within a single run', async () => {
    const ctx = makeCtx({
      '03-dependencies': {
        findings: [{ id: 'd', severity: 'critical', category: 'dependency', title: 't' }],
        changes:  [],
      },
      '05-migrations': {
        findings: [],
        changes:  [{ migration: 'x.sql', rollbackPresent: false }],
      },
      '04-env-config': {
        findings: [],
        changes:  [{ key: 'X', covered: false }],
      },
      '06-test-gap': {
        findings: [],
        testGapPct: 50,
        totalSourceFiles: 4,
      },
      '02-diff': {
        findings: [],
        changedFiles: [{ path: 'src/api/gone.js', status: 'deleted' }],
        counts: {},
      },
    });
    const result = await deployment(ctx);
    const ids = result.findings.map(f => f.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('finding IDs follow the deploy-NNN pattern', async () => {
    const ctx = makeCtx({
      '05-migrations': {
        findings: [],
        changes:  [{ migration: 'x.sql', rollbackPresent: false }],
      },
    });
    const result = await deployment(ctx);
    for (const finding of result.findings) {
      expect(finding.id).toMatch(/^deploy-\d{3}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// 14. Missing/empty prior-step results
// ---------------------------------------------------------------------------

describe('deployment — missing/empty prior-step results', () => {
  it('handles completely empty results gracefully', async () => {
    const ctx = makeCtx({});
    const result = await deployment(ctx);
    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('checklist');
    expect(result).toHaveProperty('readinessScore');
    expect(Array.isArray(result.findings)).toBe(true);
    expect(result.checklist).toHaveLength(5);
    expect(typeof result.readinessScore).toBe('number');
  });

  it('defaults testGapPct to 0 when 06-test-gap is missing → check 4 passes', async () => {
    const ctx = makeCtx({});
    const result = await deployment(ctx);
    expect(result.checklist[3].passed).toBe(true);
  });

  it('passes check 1 when 03-dependencies result is missing', async () => {
    const ctx = makeCtx({});
    const result = await deployment(ctx);
    expect(result.checklist[0].passed).toBe(true);
  });

  it('passes check 2 when 05-migrations result is missing (no migrations)', async () => {
    const ctx = makeCtx({});
    const result = await deployment(ctx);
    expect(result.checklist[1].passed).toBe(true);
  });

  it('passes check 3 when 04-env-config result is missing (no config changes)', async () => {
    const ctx = makeCtx({});
    const result = await deployment(ctx);
    expect(result.checklist[2].passed).toBe(true);
  });

  it('passes check 5 when 02-diff result is missing (no deletions)', async () => {
    const ctx = makeCtx({});
    const result = await deployment(ctx);
    expect(result.checklist[4].passed).toBe(true);
  });

  it('readinessScore is 100 when all results are missing (defaults to all-pass)', async () => {
    const ctx = makeCtx({});
    const result = await deployment(ctx);
    expect(result.readinessScore).toBe(100);
  });

  it('handles null ctx.results gracefully', async () => {
    const ctx = { runId: 'x', bundlePath: FIXTURE_BUNDLE, manifest: {}, emit: () => {}, results: null };
    const result = await deployment(ctx);
    expect(result.checklist).toHaveLength(5);
  });

  it('handles empty changedFiles array for 02-diff', async () => {
    const ctx = makeCtx({ '02-diff': { findings: [], changedFiles: [], counts: {} } });
    const result = await deployment(ctx);
    expect(result.checklist[4].passed).toBe(true);
  });

  it('handles empty changes array for 05-migrations', async () => {
    const ctx = makeCtx({ '05-migrations': { findings: [], changes: [] } });
    const result = await deployment(ctx);
    expect(result.checklist[1].passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 15. Stable checklist/result structure
// ---------------------------------------------------------------------------

describe('deployment — stable checklist/result structure', () => {
  let result;

  beforeAll(async () => {
    result = await deployment(makeAllPassCtx());
  });

  it('checklist has exactly 5 items', () => {
    expect(result.checklist).toHaveLength(5);
  });

  it('each checklist item has id, name, passed, points, explanation', () => {
    for (const item of result.checklist) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('passed');
      expect(item).toHaveProperty('points');
      expect(item).toHaveProperty('explanation');
      expect(typeof item.id).toBe('string');
      expect(typeof item.name).toBe('string');
      expect(typeof item.passed).toBe('boolean');
      expect(typeof item.points).toBe('number');
      expect(typeof item.explanation).toBe('string');
    }
  });

  it('checklist IDs are stable', () => {
    expect(result.checklist[0].id).toBe('deploy-check-01');
    expect(result.checklist[1].id).toBe('deploy-check-02');
    expect(result.checklist[2].id).toBe('deploy-check-03');
    expect(result.checklist[3].id).toBe('deploy-check-04');
    expect(result.checklist[4].id).toBe('deploy-check-05');
  });

  it('checklist names match the spec', () => {
    expect(result.checklist[0].name).toBe('No critical dependency findings');
    expect(result.checklist[1].name).toBe('All migrations have rollback companions');
    expect(result.checklist[2].name).toBe('No new required env vars without defaults');
    expect(result.checklist[3].name).toBe('Test gap < 30% of changed source files');
    expect(result.checklist[4].name).toBe('No files deleted from src/api/ without replacement');
  });

  it('readinessScore is a number between 0 and 100', () => {
    expect(result.readinessScore).toBeGreaterThanOrEqual(0);
    expect(result.readinessScore).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Real fixture bundle — integration with prior steps
// ---------------------------------------------------------------------------

describe('deployment — real synthetic v1.2.0 fixture', () => {
  let result;

  /**
   * Build a context that mimics what the real pipeline produces from the
   * v1.2.0 fixture bundle (based on documented step outputs from the test
   * comments in 05-migrations.test.js and 06-test-gap.test.js).
   *
   *   03-dependencies: only warning/info findings (lodash major bump, etc.)
   *   05-migrations: one migration missing rollback (20250630_add_refresh_token_index.sql)
   *   04-env-config: all keys covered (all 3 keys are in .env.example)
   *   06-test-gap: testGapPct = 50 (3/6 uncovered)
   *   02-diff: legacyCheckout.js deleted, checkoutRoutes.js added
   */
  const fixtureResults = {
    '03-dependencies': {
      findings: [
        { id: 'dep-major-001', severity: 'warning', category: 'dependency', title: 'Major bump: lodash' },
        { id: 'dep-major-002', severity: 'warning', category: 'dependency', title: 'Major bump: uuid' },
        { id: 'dep-added-003', severity: 'info',    category: 'dependency', title: 'New dep: stripe' },
        { id: 'dep-added-004', severity: 'info',    category: 'dependency', title: 'New dep: zod' },
      ],
      changes: [],
    },
    '05-migrations': {
      findings: [],
      changes: [
        { migration: '20250630_add_refresh_token_index.sql', rollbackPresent: false, risks: ['DELETE FROM'] },
        { migration: '20250629_add_audit_log_table.sql',     rollbackPresent: true,  risks: []             },
      ],
    },
    '04-env-config': {
      findings: [],
      changes: [
        { key: 'JWT_REFRESH_SECRET',      covered: true },
        { key: 'DATABASE_POOL_SIZE',      covered: true },
        { key: 'FEATURE_FLAG_CHECKOUT_V2',covered: true },
      ],
    },
    '06-test-gap': {
      findings: [],
      testGapPct: 50,
      totalSourceFiles: 6,
      covered:   ['src/auth/jwt.js', 'src/db/userRepository.js', 'src/api/authRoutes.js'],
      uncovered: ['src/auth/refreshTokenRotation.js', 'src/db/pool.js', 'src/api/checkoutRoutes.js'],
    },
    '02-diff': {
      findings: [],
      changedFiles: [
        { path: 'src/auth/jwt.js',                 status: 'added'    },
        { path: 'src/auth/refreshTokenRotation.js', status: 'added'   },
        { path: 'src/auth/session.js',             status: 'deleted'  },
        { path: 'src/db/pool.js',                  status: 'modified' },
        { path: 'src/db/userRepository.js',        status: 'modified' },
        { path: 'src/api/checkoutRoutes.js',       status: 'added'    },
        { path: 'src/api/authRoutes.js',           status: 'added'    },
        { path: 'src/api/legacyCheckout.js',       status: 'deleted'  },
        { path: 'package.json',                    status: 'modified' },
      ],
      counts: {},
    },
  };

  beforeAll(async () => {
    result = await deployment(makeCtx(fixtureResults));
  });

  it('returns expected shape', () => {
    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('checklist');
    expect(result).toHaveProperty('readinessScore');
  });

  it('check 1 (no critical deps) PASSES — only warning/info findings from step 03', () => {
    expect(result.checklist[0].passed).toBe(true);
  });

  it('check 2 (migration rollbacks) FAILS — 20250630 has no rollback', () => {
    expect(result.checklist[1].passed).toBe(false);
  });

  it('check 3 (env config) PASSES — all keys are in .env.example', () => {
    expect(result.checklist[2].passed).toBe(true);
  });

  it('check 4 (test gap < 30%) FAILS — testGapPct is 50', () => {
    expect(result.checklist[3].passed).toBe(false);
  });

  it('check 5 (no api deletions without replacement) PASSES — checkoutRoutes.js added', () => {
    expect(result.checklist[4].passed).toBe(true);
  });

  it('readinessScore is 60 (checks 1, 3, 5 pass = 3×20)', () => {
    expect(result.readinessScore).toBe(60);
  });

  it('produces exactly 2 deployment findings (migration + test-gap)', () => {
    expect(result.findings).toHaveLength(2);
  });

  it('migration finding mentions the missing-rollback migration', () => {
    const mig = result.findings.find(f => f.title.includes('rollback'));
    expect(mig).toBeDefined();
    expect(mig.detail).toContain('20250630_add_refresh_token_index.sql');
  });

  it('test-gap finding mentions 50%', () => {
    const gap = result.findings.find(f => f.title.includes('50%'));
    expect(gap).toBeDefined();
  });

  it('all findings conform to the Finding schema', () => {
    for (const finding of result.findings) {
      assertFindingSchema(finding);
    }
  });
});
