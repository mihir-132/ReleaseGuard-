/**
 * Tests for Step 06 — Test Gap analyzer
 *
 * Fixture bundle: server/sample-bundles/v1.2.0/
 *
 * Expected results from the real v1.2.0 bundle:
 *   Changed/added source files (6 total):
 *     COVERED   (Pass 1 — sibling test exists in src/ tree):
 *       src/auth/jwt.js             → src/auth/jwt.test.js
 *       src/db/userRepository.js    → src/db/userRepository.test.js
 *       src/api/authRoutes.js       → src/api/authRoutes.test.js
 *
 *     UNCOVERED (no sibling, no diff test):
 *       src/auth/refreshTokenRotation.js
 *       src/db/pool.js
 *       src/api/checkoutRoutes.js
 *
 *   Test gap: 3 / 6 = 50%
 *
 * Note: deleted files (src/auth/session.js, src/api/legacyCheckout.js) are excluded.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path   from 'path';
import fs     from 'fs';
import { fileURLToPath } from 'url';

import testGap from './06-test-gap.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_BUNDLE = path.resolve(__dirname, '../../sample-bundles/v1.2.0');
const TMP_DIR        = path.resolve(__dirname, '../../.tmp-test');

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
  expect(finding.category).toBe('test-gap');
  expect(['warning', 'critical', 'info']).toContain(finding.severity);
  expect(typeof finding.title).toBe('string');
  expect(finding.title.length).toBeGreaterThan(0);
  expect(typeof finding.detail).toBe('string');
  expect(finding.detail.length).toBeGreaterThan(0);
  expect(typeof finding.recommendation).toBe('string');
  expect(finding.recommendation.length).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal PipelineContext.
 *
 * @param {string} bundlePath
 * @param {Array<{path:string,status:string}>} changedFiles  - Step 02 output
 * @param {object|null} manifest
 */
function makeCtx(bundlePath, changedFiles = [], manifest = null) {
  return {
    runId:      'test-run-06',
    bundlePath,
    manifest:   manifest ?? {},
    emit:       () => {},
    results: {
      '02-diff': { changedFiles, findings: [], counts: {} },
    },
  };
}

/**
 * Build a ctx with no 02-diff result at all (simulates missing diff data).
 */
function makeCtxNoDiff(bundlePath, manifest = null) {
  return {
    runId:      'test-run-06-nodiff',
    bundlePath,
    manifest:   manifest ?? {},
    emit:       () => {},
    results:    {},
  };
}

/**
 * Create a temporary bundle directory containing the given virtual files.
 *
 * @param {Record<string, string>} files - relative path → content ('' for empty)
 * @returns {{ bundlePath: string, cleanup: () => void }}
 */
function makeTempBundle(files) {
  const dir = path.join(
    TMP_DIR,
    `tgap-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  return {
    bundlePath: dir,
    cleanup:    () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// 1. Real synthetic v1.2.0 bundle
// ---------------------------------------------------------------------------

describe('testGap — real fixture bundle (sample-bundles/v1.2.0)', () => {
  let result;

  // Build changedFiles as step 02 would have produced them from the real diff.
  const fixtureChangedFiles = [
    { path: 'src/auth/jwt.js',               status: 'added'    },
    { path: 'src/auth/refreshTokenRotation.js', status: 'added' },
    { path: 'src/auth/session.js',           status: 'deleted'  },
    { path: 'src/db/pool.js',                status: 'modified' },
    { path: 'src/db/userRepository.js',      status: 'modified' },
    { path: 'src/api/checkoutRoutes.js',     status: 'added'    },
    { path: 'src/api/authRoutes.js',         status: 'added'    },
    { path: 'src/api/legacyCheckout.js',     status: 'deleted'  },
    { path: 'package.json',                  status: 'modified' },
  ];

  beforeEach(async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE, fixtureChangedFiles);
    result = await testGap(ctx);
  });

  it('returns the expected result shape', () => {
    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('covered');
    expect(result).toHaveProperty('uncovered');
    expect(result).toHaveProperty('totalSourceFiles');
    expect(result).toHaveProperty('testGapPct');
  });

  it('counts 6 total changed/added source files (excludes deleted + non-JS)', () => {
    // jwt.js, refreshTokenRotation.js, pool.js, userRepository.js,
    // checkoutRoutes.js, authRoutes.js  — 6 files
    // deleted: session.js, legacyCheckout.js  → excluded
    // package.json → not a .js/.ts source (no corresponding test pattern)
    // Actually package.json is filtered as non-source (extension not .js or .ts)
    expect(result.totalSourceFiles).toBe(6);
  });

  it('reports 3 covered files', () => {
    expect(result.covered).toHaveLength(3);
  });

  it('reports 3 uncovered files', () => {
    expect(result.uncovered).toHaveLength(3);
  });

  it('jwt.js is covered (has jwt.test.js sibling in tree)', () => {
    expect(result.covered).toContain('src/auth/jwt.js');
  });

  it('userRepository.js is covered (has userRepository.test.js sibling)', () => {
    expect(result.covered).toContain('src/db/userRepository.js');
  });

  it('authRoutes.js is covered (has authRoutes.test.js sibling)', () => {
    expect(result.covered).toContain('src/api/authRoutes.js');
  });

  it('refreshTokenRotation.js is uncovered', () => {
    expect(result.uncovered).toContain('src/auth/refreshTokenRotation.js');
  });

  it('pool.js is uncovered', () => {
    expect(result.uncovered).toContain('src/db/pool.js');
  });

  it('checkoutRoutes.js is uncovered', () => {
    expect(result.uncovered).toContain('src/api/checkoutRoutes.js');
  });

  it('calculates 50% test gap', () => {
    expect(result.testGapPct).toBe(50);
  });

  it('produces 3 findings (one per uncovered file)', () => {
    expect(result.findings).toHaveLength(3);
  });

  it('every finding has the correct category', () => {
    for (const f of result.findings) {
      expect(f.category).toBe('test-gap');
    }
  });

  it('every finding has severity warning', () => {
    for (const f of result.findings) {
      expect(f.severity).toBe('warning');
    }
  });

  it('all findings conform to the Finding schema', () => {
    for (const f of result.findings) {
      assertFindingSchema(f);
    }
  });

  it('finding IDs are deterministic and unique (tgap-001, tgap-002, tgap-003)', () => {
    const ids = result.findings.map(f => f.id);
    expect(ids).toContain('tgap-001');
    expect(ids).toContain('tgap-002');
    expect(ids).toContain('tgap-003');
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// 2. Fully covered set
// ---------------------------------------------------------------------------

describe('testGap — all source files covered', () => {
  let bundle;
  afterEach(() => bundle?.cleanup());

  it('returns no findings and 0% gap when every changed file has a sibling test', async () => {
    bundle = makeTempBundle({
      'src/utils/math.js':      'export const add = (a,b)=>a+b;',
      'src/utils/math.test.js': 'it("add", ()=>{});',
    });
    const changedFiles = [{ path: 'src/utils/math.js', status: 'added' }];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);

    const result = await testGap(ctx);

    expect(result.findings).toHaveLength(0);
    expect(result.covered).toContain('src/utils/math.js');
    expect(result.uncovered).toHaveLength(0);
    expect(result.testGapPct).toBe(0);
    expect(result.totalSourceFiles).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Fully uncovered set
// ---------------------------------------------------------------------------

describe('testGap — all source files uncovered', () => {
  let bundle;
  afterEach(() => bundle?.cleanup());

  it('returns a finding for every changed file and 100% gap', async () => {
    bundle = makeTempBundle({
      'src/utils/parser.js': 'export const parse = ()=>{};',
      'src/utils/logger.js': 'export const log = ()=>{};',
    });
    const changedFiles = [
      { path: 'src/utils/parser.js', status: 'added'    },
      { path: 'src/utils/logger.js', status: 'modified' },
    ];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);

    const result = await testGap(ctx);

    expect(result.findings).toHaveLength(2);
    expect(result.uncovered).toContain('src/utils/parser.js');
    expect(result.uncovered).toContain('src/utils/logger.js');
    expect(result.covered).toHaveLength(0);
    expect(result.testGapPct).toBe(100);
    expect(result.totalSourceFiles).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4. Mixed covered and uncovered
// ---------------------------------------------------------------------------

describe('testGap — mixed coverage', () => {
  let bundle;
  afterEach(() => bundle?.cleanup());

  it('correctly splits covered and uncovered', async () => {
    bundle = makeTempBundle({
      'src/a/service.js':      '',
      'src/a/service.test.js': '',
      'src/b/handler.js':      '',
      // handler has no test
    });
    const changedFiles = [
      { path: 'src/a/service.js', status: 'modified' },
      { path: 'src/b/handler.js', status: 'added'    },
    ];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);

    const result = await testGap(ctx);

    expect(result.covered).toContain('src/a/service.js');
    expect(result.uncovered).toContain('src/b/handler.js');
    expect(result.findings).toHaveLength(1);
    expect(result.testGapPct).toBe(50);
    expect(result.totalSourceFiles).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Sibling .test.js coverage (Pass 1)
// ---------------------------------------------------------------------------

describe('testGap — sibling .test.js provides Pass 1 coverage', () => {
  let bundle;
  afterEach(() => bundle?.cleanup());

  it('marks source file covered when foo.test.js exists in same directory', async () => {
    bundle = makeTempBundle({
      'src/core/processor.js':      '',
      'src/core/processor.test.js': '',
    });
    const changedFiles = [{ path: 'src/core/processor.js', status: 'added' }];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);

    const result = await testGap(ctx);

    expect(result.covered).toContain('src/core/processor.js');
    expect(result.findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Sibling .spec.js coverage (Pass 1)
// ---------------------------------------------------------------------------

describe('testGap — sibling .spec.js provides Pass 1 coverage', () => {
  let bundle;
  afterEach(() => bundle?.cleanup());

  it('marks source file covered when foo.spec.js exists in same directory', async () => {
    bundle = makeTempBundle({
      'src/core/validator.js':      '',
      'src/core/validator.spec.js': '',
    });
    const changedFiles = [{ path: 'src/core/validator.js', status: 'added' }];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);

    const result = await testGap(ctx);

    expect(result.covered).toContain('src/core/validator.js');
    expect(result.findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Test file changed in diff provides Pass 2 coverage
// ---------------------------------------------------------------------------

describe('testGap — changed test file in diff provides Pass 2 coverage', () => {
  let bundle;
  afterEach(() => bundle?.cleanup());

  it('covers a source file when its test counterpart appears in the diff', async () => {
    // The bundle src/ tree has NO test file for widget.js
    bundle = makeTempBundle({
      'src/ui/widget.js': '',
    });
    const changedFiles = [
      { path: 'src/ui/widget.js',      status: 'added'    },
      { path: 'src/ui/widget.test.js', status: 'modified' }, // test changed in diff
    ];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);

    const result = await testGap(ctx);

    expect(result.covered).toContain('src/ui/widget.js');
    expect(result.findings).toHaveLength(0);
    expect(result.testGapPct).toBe(0);
  });

  it('covers a source file when a .spec.js counterpart appears in the diff', async () => {
    bundle = makeTempBundle({ 'src/ui/button.js': '' });
    const changedFiles = [
      { path: 'src/ui/button.js',      status: 'added'    },
      { path: 'src/ui/button.spec.js', status: 'added'    },
    ];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);

    const result = await testGap(ctx);

    expect(result.covered).toContain('src/ui/button.js');
    expect(result.findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Unrelated test file does not mark unrelated sources as covered
// ---------------------------------------------------------------------------

describe('testGap — unrelated test file does not cover unrelated source', () => {
  let bundle;
  afterEach(() => bundle?.cleanup());

  it('a test file in a different directory does not cover a source in another dir', async () => {
    bundle = makeTempBundle({
      'src/a/thing.js':      '',
      'src/b/thing.test.js': '', // same stem but different directory
    });
    const changedFiles = [{ path: 'src/a/thing.js', status: 'added' }];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);

    const result = await testGap(ctx);

    // src/b/thing.test.js should NOT cover src/a/thing.js
    expect(result.uncovered).toContain('src/a/thing.js');
    expect(result.covered).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
  });

  it('a changed test in the diff for dir B does not cover source in dir A', async () => {
    bundle = makeTempBundle({ 'src/a/widget.js': '' });
    const changedFiles = [
      { path: 'src/a/widget.js',      status: 'added'    },
      { path: 'src/b/widget.test.js', status: 'modified' }, // different dir
    ];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);

    const result = await testGap(ctx);

    expect(result.uncovered).toContain('src/a/widget.js');
    expect(result.findings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 9. Test files themselves excluded from the source-file set
// ---------------------------------------------------------------------------

describe('testGap — test files excluded from source-file set', () => {
  let bundle;
  afterEach(() => bundle?.cleanup());

  it('does not treat .test.js files in the diff as source files needing coverage', async () => {
    bundle = makeTempBundle({
      'src/utils/helper.js': '',
    });
    const changedFiles = [
      { path: 'src/utils/helper.test.js', status: 'added' },   // test file — should be ignored as source
      { path: 'src/utils/helper.spec.ts', status: 'modified' }, // spec file — should be ignored as source
    ];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);

    const result = await testGap(ctx);

    expect(result.totalSourceFiles).toBe(0);
    expect(result.findings).toHaveLength(0);
    expect(result.covered).toHaveLength(0);
    expect(result.uncovered).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Empty diff input
// ---------------------------------------------------------------------------

describe('testGap — empty diff input', () => {
  it('returns empty results when changedFiles is an empty array', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE, []);
    const result = await testGap(ctx);

    expect(result.findings).toHaveLength(0);
    expect(result.covered).toHaveLength(0);
    expect(result.uncovered).toHaveLength(0);
    expect(result.totalSourceFiles).toBe(0);
    expect(result.testGapPct).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11. Missing diff data (no 02-diff in results)
// ---------------------------------------------------------------------------

describe('testGap — missing diff data', () => {
  it('returns empty results gracefully when ctx.results has no 02-diff key', async () => {
    const ctx = makeCtxNoDiff(FIXTURE_BUNDLE);
    const result = await testGap(ctx);

    expect(result.findings).toHaveLength(0);
    expect(result.totalSourceFiles).toBe(0);
    expect(result.testGapPct).toBe(0);
  });

  it('returns empty results when ctx.results itself is missing', async () => {
    const ctx = {
      runId:      'test-run',
      bundlePath: FIXTURE_BUNDLE,
      manifest:   {},
      emit:       () => {},
      // no results property
    };
    const result = await testGap(ctx);

    expect(result.findings).toHaveLength(0);
    expect(result.totalSourceFiles).toBe(0);
  });

  it('returns empty results when changedFiles is null', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE, null);
    // Override to set changedFiles to null
    ctx.results['02-diff'].changedFiles = null;
    const result = await testGap(ctx);

    expect(result.findings).toHaveLength(0);
    expect(result.totalSourceFiles).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 12. Missing src directory
// ---------------------------------------------------------------------------

describe('testGap — missing src/ directory', () => {
  let bundle;
  afterEach(() => bundle?.cleanup());

  it('handles a bundle with no src/ directory without throwing', async () => {
    bundle = makeTempBundle({ 'manifest.json': '{}' }); // no src/ dir
    const changedFiles = [{ path: 'src/utils/foo.js', status: 'added' }];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);

    const result = await testGap(ctx);

    // No test file can be found — all are uncovered
    expect(result.uncovered).toContain('src/utils/foo.js');
    expect(result.findings).toHaveLength(1);
    expect(result.testGapPct).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 13. TypeScript files
// ---------------------------------------------------------------------------

describe('testGap — TypeScript files', () => {
  let bundle;
  afterEach(() => bundle?.cleanup());

  it('identifies .ts source files as needing coverage', async () => {
    bundle = makeTempBundle({ 'src/api/service.ts': '' });
    const changedFiles = [{ path: 'src/api/service.ts', status: 'added' }];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);

    const result = await testGap(ctx);

    expect(result.totalSourceFiles).toBe(1);
    expect(result.uncovered).toContain('src/api/service.ts');
  });

  it('marks a .ts source file covered when a sibling .test.ts exists', async () => {
    bundle = makeTempBundle({
      'src/api/service.ts':      '',
      'src/api/service.test.ts': '',
    });
    const changedFiles = [{ path: 'src/api/service.ts', status: 'added' }];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);

    const result = await testGap(ctx);

    expect(result.covered).toContain('src/api/service.ts');
    expect(result.findings).toHaveLength(0);
  });

  it('marks a .ts source file covered by a changed .test.ts in the diff', async () => {
    bundle = makeTempBundle({ 'src/api/service.ts': '' });
    const changedFiles = [
      { path: 'src/api/service.ts',      status: 'added'    },
      { path: 'src/api/service.test.ts', status: 'modified' },
    ];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);

    const result = await testGap(ctx);

    expect(result.covered).toContain('src/api/service.ts');
    expect(result.findings).toHaveLength(0);
  });

  it('excludes .ts test files from the source-file set', async () => {
    bundle = makeTempBundle({ 'src/api/service.ts': '' });
    const changedFiles = [
      { path: 'src/api/service.spec.ts', status: 'added' }, // spec file — not a source
    ];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);

    const result = await testGap(ctx);

    expect(result.totalSourceFiles).toBe(0);
    expect(result.findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 14. Finding schema validation
// ---------------------------------------------------------------------------

describe('testGap — finding schema validation', () => {
  let bundle;
  afterEach(() => bundle?.cleanup());

  it('every finding has all required Finding schema keys', async () => {
    bundle = makeTempBundle({ 'src/x/foo.js': '' });
    const changedFiles = [
      { path: 'src/x/foo.js', status: 'added' },
      { path: 'src/x/bar.js', status: 'added' },
    ];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);
    const result = await testGap(ctx);

    for (const f of result.findings) {
      assertFindingSchema(f);
    }
  });

  it('finding.file matches the uncovered source file path', async () => {
    bundle = makeTempBundle({ 'src/x/foo.js': '' });
    const changedFiles = [{ path: 'src/x/foo.js', status: 'added' }];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);
    const result = await testGap(ctx);

    expect(result.findings[0].file).toBe('src/x/foo.js');
  });

  it('finding.line is null', async () => {
    bundle = makeTempBundle({ 'src/x/foo.js': '' });
    const changedFiles = [{ path: 'src/x/foo.js', status: 'added' }];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);
    const result = await testGap(ctx);

    expect(result.findings[0].line).toBeNull();
  });

  it('finding.id starts with "tgap-"', async () => {
    bundle = makeTempBundle({ 'src/x/foo.js': '' });
    const changedFiles = [{ path: 'src/x/foo.js', status: 'added' }];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);
    const result = await testGap(ctx);

    expect(result.findings[0].id).toMatch(/^tgap-/);
  });
});

// ---------------------------------------------------------------------------
// 15. Returned result structure
// ---------------------------------------------------------------------------

describe('testGap — returned result structure', () => {
  it('always returns findings, covered, uncovered, totalSourceFiles, testGapPct', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE, []);
    const result = await testGap(ctx);

    expect(Array.isArray(result.findings)).toBe(true);
    expect(Array.isArray(result.covered)).toBe(true);
    expect(Array.isArray(result.uncovered)).toBe(true);
    expect(typeof result.totalSourceFiles).toBe('number');
    expect(typeof result.testGapPct).toBe('number');
  });

  it('totalSourceFiles equals covered.length + uncovered.length', async () => {
    const fixtureChangedFiles = [
      { path: 'src/auth/jwt.js',               status: 'added'    },
      { path: 'src/auth/refreshTokenRotation.js', status: 'added' },
      { path: 'src/db/pool.js',                status: 'modified' },
      { path: 'src/db/userRepository.js',      status: 'modified' },
      { path: 'src/api/checkoutRoutes.js',     status: 'added'    },
      { path: 'src/api/authRoutes.js',         status: 'added'    },
    ];
    const ctx = makeCtx(FIXTURE_BUNDLE, fixtureChangedFiles);
    const result = await testGap(ctx);

    expect(result.totalSourceFiles).toBe(result.covered.length + result.uncovered.length);
  });
});

// ---------------------------------------------------------------------------
// 16. Correct test-gap percentage
// ---------------------------------------------------------------------------

describe('testGap — test-gap percentage calculation', () => {
  let bundle;
  afterEach(() => bundle?.cleanup());

  it('computes 0% when no source files changed', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE, []);
    const result = await testGap(ctx);
    expect(result.testGapPct).toBe(0);
  });

  it('computes 0% when all source files are covered', async () => {
    bundle = makeTempBundle({
      'src/a/x.js':      '',
      'src/a/x.test.js': '',
    });
    const changedFiles = [{ path: 'src/a/x.js', status: 'added' }];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);
    const result = await testGap(ctx);
    expect(result.testGapPct).toBe(0);
  });

  it('computes 100% when no source files are covered', async () => {
    bundle = makeTempBundle({ 'src/a/x.js': '' });
    const changedFiles = [{ path: 'src/a/x.js', status: 'added' }];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);
    const result = await testGap(ctx);
    expect(result.testGapPct).toBe(100);
  });

  it('computes 25% when 1 of 4 files is uncovered', async () => {
    bundle = makeTempBundle({
      'src/a.js':      '',
      'src/a.test.js': '',
      'src/b.js':      '',
      'src/b.test.js': '',
      'src/c.js':      '',
      'src/c.test.js': '',
      'src/d.js':      '',
      // d has no test
    });
    const changedFiles = [
      { path: 'src/a.js', status: 'modified' },
      { path: 'src/b.js', status: 'modified' },
      { path: 'src/c.js', status: 'modified' },
      { path: 'src/d.js', status: 'added' },
    ];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);
    const result = await testGap(ctx);
    expect(result.testGapPct).toBe(25);
  });

  it('computes 50% for the real fixture bundle', async () => {
    const fixtureChangedFiles = [
      { path: 'src/auth/jwt.js',               status: 'added'    },
      { path: 'src/auth/refreshTokenRotation.js', status: 'added' },
      { path: 'src/db/pool.js',                status: 'modified' },
      { path: 'src/db/userRepository.js',      status: 'modified' },
      { path: 'src/api/checkoutRoutes.js',     status: 'added'    },
      { path: 'src/api/authRoutes.js',         status: 'added'    },
    ];
    const ctx = makeCtx(FIXTURE_BUNDLE, fixtureChangedFiles);
    const result = await testGap(ctx);
    expect(result.testGapPct).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// 17. Multiple uncovered files — deterministic unique finding IDs
// ---------------------------------------------------------------------------

describe('testGap — deterministic unique finding IDs for multiple uncovered files', () => {
  let bundle;
  afterEach(() => bundle?.cleanup());

  it('produces unique IDs for each uncovered file', async () => {
    bundle = makeTempBundle({
      'src/a/one.js':   '',
      'src/a/two.js':   '',
      'src/a/three.js': '',
    });
    const changedFiles = [
      { path: 'src/a/one.js',   status: 'added' },
      { path: 'src/a/two.js',   status: 'added' },
      { path: 'src/a/three.js', status: 'added' },
    ];
    const ctx = makeCtx(bundle.bundlePath, changedFiles);
    const result = await testGap(ctx);

    expect(result.findings).toHaveLength(3);
    const ids = result.findings.map(f => f.id);
    // All IDs are unique
    expect(new Set(ids).size).toBe(3);
    // IDs follow the tgap-NNN pattern
    for (const id of ids) {
      expect(id).toMatch(/^tgap-\d{3}$/);
    }
  });

  it('IDs are reset between runs (deterministic across invocations)', async () => {
    bundle = makeTempBundle({ 'src/x/foo.js': '' });
    const changedFiles = [{ path: 'src/x/foo.js', status: 'added' }];
    const ctx1 = makeCtx(bundle.bundlePath, changedFiles);
    const ctx2 = makeCtx(bundle.bundlePath, changedFiles);

    const result1 = await testGap(ctx1);
    const result2 = await testGap(ctx2);

    expect(result1.findings[0].id).toBe('tgap-001');
    expect(result2.findings[0].id).toBe('tgap-001');
  });
});
