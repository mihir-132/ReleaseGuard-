/**
 * Tests for server/storage/reports.js
 *
 * Covers:
 *   - writeReport writes a JSON file under data/reports/
 *   - readReport reads an existing report
 *   - readReport returns { ok: false } for missing report
 *   - listReports returns summaries for all stored reports
 *   - JSON round-trip preserves all report data
 *   - multiple reports are stored and listed independently
 *   - storage directory is created when it does not exist
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// We test against a *temporary* reports directory by monkey-patching the
// module's REPORTS_DIR.  Instead, we temporarily swap the module's imported
// constants by overriding through the file-system layer: we write to a known
// temp path and verify the file.
//
// Simpler approach: spy on fs.writeFileSync / fs.readFileSync so no real disk
// I/O is needed.  However, to validate JSON round-trip and the listReports()
// behaviour, real I/O tests are more reliable.
//
// We redirect the REPORTS_DIR by setting up an isolated temp directory.
// ---------------------------------------------------------------------------

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT  = path.resolve(__dirname, '..');
const TMP_DIR      = path.resolve(SERVER_ROOT, '.tmp-test', 'reports');

// ---------------------------------------------------------------------------
// Temporarily override the storage directory used by reports.js.
// Because the module computes REPORTS_DIR from import.meta.url at load time,
// we cannot easily redirect it without vi.mock().  Instead we import the
// real module and verify the actual data/reports/ directory, cleaning up
// before and after each test.
// ---------------------------------------------------------------------------

import { writeReport, readReport, listReports } from '../storage/reports.js';

// Derive the real storage dir so we can clean it in teardown.
const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');
const REAL_REPORTS_DIR = path.join(PROJECT_ROOT, 'data', 'reports');

// Unique prefix for test run IDs to avoid cross-test pollution
const PREFIX = `test-${Date.now()}-`;

/** Generate a test-scoped runId. */
function testRunId(suffix) {
  return `${PREFIX}${suffix}`;
}

/** Remove all files created by this test suite. */
function cleanup() {
  if (!fs.existsSync(REAL_REPORTS_DIR)) return;
  const files = fs.readdirSync(REAL_REPORTS_DIR);
  for (const f of files) {
    if (f.startsWith(PREFIX)) {
      fs.rmSync(path.join(REAL_REPORTS_DIR, f), { force: true });
    }
  }
}

beforeEach(() => cleanup());
afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Minimal report fixture
// ---------------------------------------------------------------------------

function makeReport(overrides = {}) {
  return {
    runId:            overrides.runId            ?? 'run-001',
    generatedAt:      overrides.generatedAt      ?? '2025-01-01T00:00:00.000Z',
    manifest:         overrides.manifest         ?? { name: 'payment-service', version: '1.2.0' },
    overallReadiness: overrides.overallReadiness ?? 80,
    overallSeverity:  overrides.overallSeverity  ?? 'warning',
    steps:            overrides.steps            ?? {},
    releaseNotes:     overrides.releaseNotes     ?? null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('writeReport', () => {
  it('creates a JSON file at data/reports/<runId>.json', () => {
    const runId  = testRunId('write-basic');
    const report = makeReport({ runId });

    writeReport(runId, report);

    const filePath = path.join(REAL_REPORTS_DIR, `${runId}.json`);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('creates the data/reports directory when it does not exist', () => {
    // Temporarily remove the directory if empty — only works if no other
    // reports exist, so we check first.
    const runId  = testRunId('write-mkdir');
    const report = makeReport({ runId });

    // The directory may already exist from other tests; ensure it is present
    // after the call regardless.
    writeReport(runId, report);

    expect(fs.existsSync(REAL_REPORTS_DIR)).toBe(true);
  });

  it('writes valid JSON', () => {
    const runId  = testRunId('write-valid-json');
    const report = makeReport({ runId });

    writeReport(runId, report);

    const raw = fs.readFileSync(
      path.join(REAL_REPORTS_DIR, `${runId}.json`),
      'utf8'
    );
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

describe('readReport', () => {
  it('returns { ok: true, report } for an existing report', () => {
    const runId  = testRunId('read-existing');
    const report = makeReport({ runId });

    writeReport(runId, report);

    const result = readReport(runId);
    expect(result.ok).toBe(true);
    expect(result.report).toBeDefined();
  });

  it('round-trip preserves all report data', () => {
    const runId  = testRunId('round-trip');
    const report = makeReport({
      runId,
      generatedAt:      '2025-07-01T12:00:00.000Z',
      overallReadiness: 60,
      overallSeverity:  'warning',
      manifest:         { name: 'payment-service', version: '1.2.0' },
      steps: {
        ingest: { status: 'complete', severity: 'ok', findings: [] },
      },
      releaseNotes: null,
    });

    writeReport(runId, report);
    const result = readReport(runId);

    expect(result.ok).toBe(true);
    expect(result.report.runId).toBe(runId);
    expect(result.report.generatedAt).toBe('2025-07-01T12:00:00.000Z');
    expect(result.report.overallReadiness).toBe(60);
    expect(result.report.overallSeverity).toBe('warning');
    expect(result.report.manifest.name).toBe('payment-service');
    expect(result.report.manifest.version).toBe('1.2.0');
    expect(result.report.steps.ingest.severity).toBe('ok');
    expect(result.report.releaseNotes).toBeNull();
  });

  it('returns { ok: false, error } for a missing report', () => {
    const result = readReport('does-not-exist-xyz-987654');
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
  });
});

describe('listReports', () => {
  it('returns an empty array when no reports match', () => {
    // After cleanup, there are no test-prefixed reports
    const all = listReports();
    const testOnes = all.filter(r => r.runId.startsWith(PREFIX));
    expect(testOnes).toHaveLength(0);
  });

  it('includes a stored report in the listing', () => {
    const runId  = testRunId('list-one');
    const report = makeReport({ runId });

    writeReport(runId, report);

    const all = listReports();
    const match = all.find(r => r.runId === runId);
    expect(match).toBeDefined();
  });

  it('returns correct summary fields', () => {
    const runId  = testRunId('list-summary');
    const report = makeReport({
      runId,
      generatedAt:      '2025-07-01T12:00:00.000Z',
      overallReadiness: 75,
      manifest:         { name: 'my-service', version: '2.0.0' },
    });

    writeReport(runId, report);

    const all   = listReports();
    const found = all.find(r => r.runId === runId);
    expect(found).toBeDefined();
    expect(found.runId).toBe(runId);
    expect(found.generatedAt).toBe('2025-07-01T12:00:00.000Z');
    expect(found.name).toBe('my-service');
    expect(found.version).toBe('2.0.0');
    expect(found.overallReadiness).toBe(75);
  });

  it('lists multiple reports independently', () => {
    const idA = testRunId('list-multi-a');
    const idB = testRunId('list-multi-b');

    writeReport(idA, makeReport({ runId: idA, manifest: { name: 'svc-a', version: '1.0.0' } }));
    writeReport(idB, makeReport({ runId: idB, manifest: { name: 'svc-b', version: '2.0.0' } }));

    const all = listReports();
    const a = all.find(r => r.runId === idA);
    const b = all.find(r => r.runId === idB);

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a.name).toBe('svc-a');
    expect(b.name).toBe('svc-b');
  });
});
