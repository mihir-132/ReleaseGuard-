/**
 * Tests for Step 08 — Report Aggregation + Persistence
 *
 * Covers:
 *   - correct report shape
 *   - manifest preserved
 *   - runId preserved
 *   - generatedAt is ISO-compatible
 *   - overallReadiness comes from Step 07
 *   - overallSeverity precedence:
 *       no findings      → ok
 *       info only        → info
 *       warning + info   → warning
 *       critical + ...   → critical
 *   - findings from all prior analyzers represented in steps
 *   - stable step structure (all 7 step keys present)
 *   - releaseNotes is null before watsonx integration
 *   - missing/empty prior results handled safely
 *   - calls writeReport (storage is called)
 *   - real v1.2.0 synthetic fixture → overallReadiness=60, overallSeverity=warning
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path   from 'path';
import fs     from 'fs';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Mock storage so we don't write to disk during unit tests
// ---------------------------------------------------------------------------
vi.mock('../../storage/reports.js', () => ({
  writeReport: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock watsonx so tests don't make real HTTP calls
// ---------------------------------------------------------------------------
vi.mock('../../ai/watsonx.js', () => ({
  generateReleaseNotes: vi.fn().mockResolvedValue('## Mocked Release Notes'),
}));

import { writeReport }        from '../../storage/reports.js';
import { generateReleaseNotes } from '../../ai/watsonx.js';
import report from './08-report.js';

// ---------------------------------------------------------------------------
// Paths for the real fixture bundle
// ---------------------------------------------------------------------------

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_BUNDLE = path.resolve(__dirname, '../../sample-bundles/v1.2.0');

// ---------------------------------------------------------------------------
// Fixture manifest
// ---------------------------------------------------------------------------

const FIXTURE_MANIFEST = {
  name:            'payment-service',
  version:         '1.2.0',
  previousVersion: '1.1.3',
  releaseDate:     '2025-07-01',
  environment:     'production',
  team:            'Platform',
  description:     'Adds JWT refresh-token rotation…',
  migrations:      ['20250630_add_refresh_token_index.sql', '20250629_add_audit_log_table.sql'],
  configChanges:   ['JWT_REFRESH_SECRET', 'DATABASE_POOL_SIZE', 'FEATURE_FLAG_CHECKOUT_V2'],
  testSuites:      ['unit', 'integration'],
};

// ---------------------------------------------------------------------------
// Helper: build a minimal ctx
// ---------------------------------------------------------------------------

function makeCtx(overrides = {}) {
  return {
    runId:      overrides.runId      ?? 'test-run-001',
    bundlePath: overrides.bundlePath ?? FIXTURE_BUNDLE,
    manifest:   'manifest' in overrides ? overrides.manifest : FIXTURE_MANIFEST,
    emit:       vi.fn(),
    results:    overrides.results    ?? {},
  };
}

// ---------------------------------------------------------------------------
// Full v1.2.0 synthetic fixture results (matches 07-deployment.test.js spec)
// ---------------------------------------------------------------------------

const FIXTURE_RESULTS = {
  '01-ingest': {
    findings: [],
  },
  '02-diff': {
    findings: [],
    changedFiles: [
      { path: 'src/auth/jwt.js',                  status: 'added'    },
      { path: 'src/auth/refreshTokenRotation.js',  status: 'added'   },
      { path: 'src/auth/session.js',              status: 'deleted'  },
      { path: 'src/db/pool.js',                   status: 'modified' },
      { path: 'src/db/userRepository.js',         status: 'modified' },
      { path: 'src/api/checkoutRoutes.js',        status: 'added'    },
      { path: 'src/api/authRoutes.js',            status: 'added'    },
      { path: 'src/api/legacyCheckout.js',        status: 'deleted'  },
      { path: 'package.json',                     status: 'modified' },
    ],
    counts: {},
  },
  '03-dependencies': {
    findings: [
      { id: 'dep-major-001', severity: 'warning', category: 'dependency', title: 'Major bump: lodash' },
      { id: 'dep-major-002', severity: 'warning', category: 'dependency', title: 'Major bump: uuid'   },
      { id: 'dep-added-003', severity: 'info',    category: 'dependency', title: 'New dep: stripe'    },
      { id: 'dep-added-004', severity: 'info',    category: 'dependency', title: 'New dep: zod'       },
    ],
    changes: [],
  },
  '04-env-config': {
    findings: [],
    changes: [
      { key: 'JWT_REFRESH_SECRET',       covered: true },
      { key: 'DATABASE_POOL_SIZE',       covered: true },
      { key: 'FEATURE_FLAG_CHECKOUT_V2', covered: true },
    ],
  },
  '05-migrations': {
    findings: [],
    changes: [
      { migration: '20250630_add_refresh_token_index.sql', rollbackPresent: false, risks: ['DELETE FROM'] },
      { migration: '20250629_add_audit_log_table.sql',     rollbackPresent: true,  risks: []             },
    ],
  },
  '06-test-gap': {
    findings: [],
    testGapPct:       50,
    totalSourceFiles: 6,
    covered:   ['src/auth/jwt.js', 'src/db/userRepository.js', 'src/api/authRoutes.js'],
    uncovered: ['src/auth/refreshTokenRotation.js', 'src/db/pool.js', 'src/api/checkoutRoutes.js'],
  },
  '07-deployment': {
    findings: [
      { id: 'deploy-001', severity: 'warning', category: 'deployment', title: 'Migrations missing rollback companions' },
      { id: 'deploy-002', severity: 'warning', category: 'deployment', title: 'Test gap too high: 50%'                },
    ],
    checklist: [],
    readinessScore: 60,
  },
};

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests — report shape
// ---------------------------------------------------------------------------

describe('report — correct report shape', () => {
  it('returns the expected top-level keys', async () => {
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    const result = await report(ctx);

    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('report');
    expect(result).toHaveProperty('runId');
    expect(result).toHaveProperty('generatedAt');
    expect(result).toHaveProperty('overallReadiness');
    expect(result).toHaveProperty('overallSeverity');
  });

  it('report object contains all required top-level keys', async () => {
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    const { report: r } = await report(ctx);

    expect(r).toHaveProperty('runId');
    expect(r).toHaveProperty('generatedAt');
    expect(r).toHaveProperty('manifest');
    expect(r).toHaveProperty('overallReadiness');
    expect(r).toHaveProperty('overallSeverity');
    expect(r).toHaveProperty('steps');
    expect(r).toHaveProperty('releaseNotes');
  });

  it('steps contains all 7 step keys', async () => {
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    const { report: r } = await report(ctx);

    const expectedKeys = ['ingest', 'diff', 'dependencies', 'envConfig', 'migrations', 'testGap', 'deployment'];
    for (const key of expectedKeys) {
      expect(r.steps, `steps should have key "${key}"`).toHaveProperty(key);
    }
  });

  it('each step entry has status, severity, findings', async () => {
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    const { report: r } = await report(ctx);

    for (const [key, step] of Object.entries(r.steps)) {
      expect(step, `${key} should have status`).toHaveProperty('status');
      expect(step, `${key} should have severity`).toHaveProperty('severity');
      expect(step, `${key} should have findings`).toHaveProperty('findings');
      expect(Array.isArray(step.findings), `${key}.findings should be an array`).toBe(true);
    }
  });

  it('step aggregator produces no new findings of its own', async () => {
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    const result = await report(ctx);
    expect(result.findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests — manifest + runId preserved
// ---------------------------------------------------------------------------

describe('report — manifest and runId', () => {
  it('preserves runId', async () => {
    const ctx = makeCtx({ runId: 'abc-123', results: FIXTURE_RESULTS });
    const { report: r } = await report(ctx);
    expect(r.runId).toBe('abc-123');
  });

  it('preserves manifest reference', async () => {
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    const { report: r } = await report(ctx);
    expect(r.manifest).toEqual(FIXTURE_MANIFEST);
  });

  it('manifest is null when ctx.manifest is null', async () => {
    const ctx = makeCtx({ manifest: null, results: {} });
    const { report: r } = await report(ctx);
    expect(r.manifest).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — generatedAt
// ---------------------------------------------------------------------------

describe('report — generatedAt', () => {
  it('generatedAt is a non-empty string', async () => {
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    const { report: r } = await report(ctx);
    expect(typeof r.generatedAt).toBe('string');
    expect(r.generatedAt.length).toBeGreaterThan(0);
  });

  it('generatedAt is ISO-8601 parseable', async () => {
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    const { report: r } = await report(ctx);
    const parsed = new Date(r.generatedAt);
    expect(parsed instanceof Date).toBe(true);
    expect(isNaN(parsed.getTime())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — overallReadiness
// ---------------------------------------------------------------------------

describe('report — overallReadiness', () => {
  it('comes from Step 07 readinessScore', async () => {
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    const { report: r } = await report(ctx);
    expect(r.overallReadiness).toBe(60);
  });

  it('defaults to 0 when Step 07 result is missing', async () => {
    const ctx = makeCtx({ results: {} });
    const { report: r } = await report(ctx);
    expect(r.overallReadiness).toBe(0);
  });

  it('uses custom readinessScore from Step 07', async () => {
    const ctx = makeCtx({
      results: {
        '07-deployment': { findings: [], readinessScore: 100, checklist: [] },
      },
    });
    const { report: r } = await report(ctx);
    expect(r.overallReadiness).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Tests — overallSeverity precedence
// ---------------------------------------------------------------------------

describe('report — overallSeverity precedence', () => {
  it('returns "ok" when there are no findings', async () => {
    const ctx = makeCtx({ results: {} });
    const { report: r } = await report(ctx);
    expect(r.overallSeverity).toBe('ok');
  });

  it('returns "info" when only info findings exist', async () => {
    const ctx = makeCtx({
      results: {
        '01-ingest': { findings: [{ severity: 'info' }] },
      },
    });
    const { report: r } = await report(ctx);
    expect(r.overallSeverity).toBe('info');
  });

  it('returns "warning" when warning + info findings exist', async () => {
    const ctx = makeCtx({
      results: {
        '01-ingest':       { findings: [{ severity: 'info'    }] },
        '03-dependencies': { findings: [{ severity: 'warning' }] },
      },
    });
    const { report: r } = await report(ctx);
    expect(r.overallSeverity).toBe('warning');
  });

  it('returns "critical" when critical + warning + info findings exist', async () => {
    const ctx = makeCtx({
      results: {
        '01-ingest':       { findings: [{ severity: 'info'     }] },
        '03-dependencies': { findings: [{ severity: 'warning'  }] },
        '05-migrations':   { findings: [{ severity: 'critical' }] },
      },
    });
    const { report: r } = await report(ctx);
    expect(r.overallSeverity).toBe('critical');
  });

  it('returns "critical" from a single critical finding', async () => {
    const ctx = makeCtx({
      results: {
        '01-ingest': { findings: [{ severity: 'critical' }] },
      },
    });
    const { report: r } = await report(ctx);
    expect(r.overallSeverity).toBe('critical');
  });

  it('returns "ok" when all findings arrays are empty', async () => {
    const ctx = makeCtx({
      results: {
        '01-ingest':       { findings: [] },
        '02-diff':         { findings: [] },
        '03-dependencies': { findings: [] },
      },
    });
    const { report: r } = await report(ctx);
    expect(r.overallSeverity).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Tests — releaseNotes
// ---------------------------------------------------------------------------

describe('report — releaseNotes', () => {
  it('releaseNotes is set from generateReleaseNotes result', async () => {
    generateReleaseNotes.mockResolvedValueOnce('## AI Release Notes');
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    const { report: r } = await report(ctx);
    expect(r.releaseNotes).toBe('## AI Release Notes');
  });

  it('releaseNotes is a string (not null) after watsonx integration', async () => {
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    const { report: r } = await report(ctx);
    expect(typeof r.releaseNotes).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Tests — persistence
// ---------------------------------------------------------------------------

describe('report — persistence', () => {
  it('calls writeReport with the runId and the report', async () => {
    const ctx = makeCtx({ runId: 'persist-test-001', results: FIXTURE_RESULTS });
    await report(ctx);
    expect(writeReport).toHaveBeenCalledTimes(1);
    expect(writeReport).toHaveBeenCalledWith(
      'persist-test-001',
      expect.objectContaining({ runId: 'persist-test-001' })
    );
  });
});

// ---------------------------------------------------------------------------
// Tests — missing/empty prior results handled safely
// ---------------------------------------------------------------------------

describe('report — missing/empty prior results', () => {
  it('does not throw when ctx.results is empty {}', async () => {
    const ctx = makeCtx({ results: {} });
    await expect(report(ctx)).resolves.toBeDefined();
  });

  it('does not throw when individual step results are missing', async () => {
    const ctx = makeCtx({
      results: {
        '01-ingest': undefined,
        '02-diff':   null,
      },
    });
    await expect(report(ctx)).resolves.toBeDefined();
  });

  it('uses empty findings for a missing step', async () => {
    const ctx = makeCtx({ results: {} });
    const { report: r } = await report(ctx);
    expect(r.steps.ingest.findings).toEqual([]);
    expect(r.steps.diff.findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests — structured extras preserved in steps
// ---------------------------------------------------------------------------

describe('report — step structured extras', () => {
  it('preserves diff.changedFiles', async () => {
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    const { report: r } = await report(ctx);
    expect(Array.isArray(r.steps.diff.changedFiles)).toBe(true);
  });

  it('preserves migrations.changes', async () => {
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    const { report: r } = await report(ctx);
    expect(Array.isArray(r.steps.migrations.changes)).toBe(true);
  });

  it('preserves testGap.testGapPct', async () => {
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    const { report: r } = await report(ctx);
    expect(r.steps.testGap.testGapPct).toBe(50);
  });

  it('preserves deployment.readinessScore', async () => {
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    const { report: r } = await report(ctx);
    expect(r.steps.deployment.readinessScore).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// Tests — real v1.2.0 synthetic fixture
// ---------------------------------------------------------------------------

describe('report — real synthetic v1.2.0 fixture', () => {
  let result;
  let reportObj;

  beforeEach(async () => {
    vi.clearAllMocks();
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    result    = await report(ctx);
    reportObj = result.report;
  });

  it('overallReadiness is 60', () => {
    expect(reportObj.overallReadiness).toBe(60);
  });

  it('overallSeverity is "warning"', () => {
    // Fixture has warning findings from step 03 and step 07; no critical findings
    expect(reportObj.overallSeverity).toBe('warning');
  });

  it('manifest.name is payment-service', () => {
    expect(reportObj.manifest.name).toBe('payment-service');
  });

  it('manifest.version is 1.2.0', () => {
    expect(reportObj.manifest.version).toBe('1.2.0');
  });

  it('steps.dependencies has warning severity', () => {
    expect(reportObj.steps.dependencies.severity).toBe('warning');
  });

  it('steps.dependencies findings count matches fixture (4)', () => {
    expect(reportObj.steps.dependencies.findings).toHaveLength(4);
  });

  it('steps.deployment findings count matches fixture (2)', () => {
    expect(reportObj.steps.deployment.findings).toHaveLength(2);
  });

  it('steps.testGap.testGapPct is 50', () => {
    expect(reportObj.steps.testGap.testGapPct).toBe(50);
  });

  it('writeReport was called once', () => {
    expect(writeReport).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — Step 08 places generateReleaseNotes result into report.releaseNotes
// ---------------------------------------------------------------------------

describe('report — generateReleaseNotes integration', () => {
  it('calls generateReleaseNotes once per run', async () => {
    generateReleaseNotes.mockResolvedValueOnce('## Notes');
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    await report(ctx);
    expect(generateReleaseNotes).toHaveBeenCalledTimes(1);
  });

  it('passes summaryContext with correct name and version from manifest', async () => {
    generateReleaseNotes.mockResolvedValueOnce('## Notes');
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    await report(ctx);
    const [summaryCtx] = generateReleaseNotes.mock.calls[0];
    expect(summaryCtx.name).toBe('payment-service');
    expect(summaryCtx.version).toBe('1.2.0');
  });

  it('passes summaryContext with readinessScore from Step 07', async () => {
    generateReleaseNotes.mockResolvedValueOnce('## Notes');
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    await report(ctx);
    const [summaryCtx] = generateReleaseNotes.mock.calls[0];
    expect(summaryCtx.readinessScore).toBe(60);
  });

  it('places the returned string into report.releaseNotes', async () => {
    generateReleaseNotes.mockResolvedValueOnce('## Step08 Release Notes');
    const ctx = makeCtx({ results: FIXTURE_RESULTS });
    const { report: r } = await report(ctx);
    expect(r.releaseNotes).toBe('## Step08 Release Notes');
  });

  it('uses "unknown" for name/version when manifest is null', async () => {
    generateReleaseNotes.mockResolvedValueOnce('## Fallback');
    const ctx = makeCtx({ manifest: null, results: {} });
    await report(ctx);
    const [summaryCtx] = generateReleaseNotes.mock.calls[0];
    expect(summaryCtx.name).toBe('unknown');
    expect(summaryCtx.version).toBe('unknown');
  });
});
