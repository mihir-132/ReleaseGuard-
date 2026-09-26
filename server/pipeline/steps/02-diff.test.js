/**
 * Tests for Step 02 — Diff (server/pipeline/steps/02-diff.js)
 *
 * Covers:
 *   - parsing multiple diff sections from a real patch file
 *   - added / modified / deleted classification
 *   - high-risk path detection
 *   - changed-file counts (added, modified, deleted, total)
 *   - findings conform to the Finding schema
 *   - high-risk files produce 'warning' findings
 *   - non-high-risk files produce no finding
 *   - missing diff.patch returns empty result gracefully
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import diff from './02-diff.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_BUNDLE = path.resolve(__dirname, '../../sample-bundles/v1.2.0');
const TMP_DIR = path.resolve(__dirname, '../../.tmp-test');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ctx pointing at bundlePath. */
function makeCtx(bundlePath) {
  return { bundlePath, manifest: null, runId: 'test-run', emit: vi.fn(), results: {} };
}

/**
 * Create a temporary bundle directory with the given diff.patch text.
 * Returns { ctx, cleanup }.
 */
function makeTempBundle(patchContent) {
  const dir = path.join(TMP_DIR, `diff-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  if (patchContent !== null) {
    fs.writeFileSync(path.join(dir, 'diff.patch'), patchContent, 'utf8');
  }
  return {
    ctx: makeCtx(dir),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// Finding schema validator
// ---------------------------------------------------------------------------
const FINDING_KEYS = ['id', 'category', 'severity', 'title', 'detail', 'file', 'line', 'recommendation'];

function assertFindingSchema(finding) {
  for (const key of FINDING_KEYS) {
    expect(finding, `finding missing key "${key}"`).toHaveProperty(key);
  }
}

// ---------------------------------------------------------------------------
// Tests against the real fixture bundle
// ---------------------------------------------------------------------------

describe('diff — real fixture bundle (sample-bundles/v1.2.0)', () => {
  it('returns an object with findings, changedFiles, and counts', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const result = await diff(ctx);
    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('changedFiles');
    expect(result).toHaveProperty('counts');
    expect(Array.isArray(result.findings)).toBe(true);
    expect(Array.isArray(result.changedFiles)).toBe(true);
  });

  it('counts match the actual number of entries in changedFiles', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { changedFiles, counts } = await diff(ctx);
    expect(counts.total).toBe(changedFiles.length);
    expect(counts.added + counts.modified + counts.deleted).toBe(counts.total);
  });

  it('detects added files from the fixture patch', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { changedFiles, counts } = await diff(ctx);
    // The fixture patch includes: src/auth/jwt.js, src/auth/refreshTokenRotation.js,
    // src/api/checkoutRoutes.js, src/api/authRoutes.js  — all new files
    expect(counts.added).toBeGreaterThan(0);
    const addedPaths = changedFiles.filter((f) => f.status === 'added').map((f) => f.path);
    expect(addedPaths).toContain('src/auth/jwt.js');
    expect(addedPaths).toContain('src/auth/refreshTokenRotation.js');
    expect(addedPaths).toContain('src/api/checkoutRoutes.js');
    expect(addedPaths).toContain('src/api/authRoutes.js');
  });

  it('detects deleted files from the fixture patch', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { changedFiles, counts } = await diff(ctx);
    // src/auth/session.js and src/api/legacyCheckout.js are deleted
    expect(counts.deleted).toBeGreaterThan(0);
    const deletedPaths = changedFiles.filter((f) => f.status === 'deleted').map((f) => f.path);
    expect(deletedPaths).toContain('src/auth/session.js');
    expect(deletedPaths).toContain('src/api/legacyCheckout.js');
  });

  it('detects modified files from the fixture patch', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { changedFiles, counts } = await diff(ctx);
    // package.json, src/db/pool.js, src/db/userRepository.js are modified
    expect(counts.modified).toBeGreaterThan(0);
    const modifiedPaths = changedFiles.filter((f) => f.status === 'modified').map((f) => f.path);
    expect(modifiedPaths).toContain('src/db/pool.js');
    expect(modifiedPaths).toContain('src/db/userRepository.js');
    expect(modifiedPaths).toContain('package.json');
  });

  it('flags src/auth files as high-risk', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { changedFiles } = await diff(ctx);
    const authFiles = changedFiles.filter((f) => f.path.startsWith('src/auth'));
    expect(authFiles.length).toBeGreaterThan(0);
    for (const f of authFiles) {
      expect(f.highRisk).toBe(true);
    }
  });

  it('flags src/db files as high-risk', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { changedFiles } = await diff(ctx);
    const dbFiles = changedFiles.filter((f) => f.path.startsWith('src/db'));
    expect(dbFiles.length).toBeGreaterThan(0);
    for (const f of dbFiles) {
      expect(f.highRisk).toBe(true);
    }
  });

  it('flags src/api files as high-risk', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { changedFiles } = await diff(ctx);
    const apiFiles = changedFiles.filter((f) => f.path.startsWith('src/api'));
    expect(apiFiles.length).toBeGreaterThan(0);
    for (const f of apiFiles) {
      expect(f.highRisk).toBe(true);
    }
  });

  it('does not flag package.json as high-risk', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { changedFiles } = await diff(ctx);
    const pkg = changedFiles.find((f) => f.path === 'package.json');
    expect(pkg).toBeDefined();
    expect(pkg.highRisk).toBe(false);
  });

  it('produces a warning finding for every high-risk changed file', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { findings, changedFiles } = await diff(ctx);
    const highRiskFiles = changedFiles.filter((f) => f.highRisk);
    expect(findings.length).toBe(highRiskFiles.length);
    for (const f of findings) {
      expect(f.severity).toBe('warning');
      expect(f.category).toBe('diff');
    }
  });

  it('every finding conforms to the Finding schema', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { findings } = await diff(ctx);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      assertFindingSchema(f);
    }
  });

  it('changedFiles entries include path, status, and highRisk', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { changedFiles } = await diff(ctx);
    for (const f of changedFiles) {
      expect(f).toHaveProperty('path');
      expect(f).toHaveProperty('status');
      expect(f).toHaveProperty('highRisk');
      expect(['added', 'modified', 'deleted']).toContain(f.status);
      expect(typeof f.highRisk).toBe('boolean');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests with synthetic patch strings
// ---------------------------------------------------------------------------

describe('diff — synthetic patch: multiple sections', () => {
  const patch = [
    'diff --git a/src/auth/login.js b/src/auth/login.js',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/auth/login.js',
    '@@ -0,0 +1,3 @@',
    '+const x = 1;',
    '',
    'diff --git a/src/db/schema.js b/src/db/schema.js',
    'index aaa..bbb 100644',
    '--- a/src/db/schema.js',
    '+++ b/src/db/schema.js',
    '@@ -1,1 +1,2 @@',
    ' const y = 2;',
    '+const z = 3;',
    '',
    'diff --git a/src/api/oldRoute.js b/src/api/oldRoute.js',
    'deleted file mode 100644',
    '--- a/src/api/oldRoute.js',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-const old = true;',
    '',
    'diff --git a/README.md b/README.md',
    'index ccc..ddd 100644',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1,1 +1,2 @@',
    ' # Docs',
    '+## New section',
  ].join('\n');

  it('parses all four sections', async () => {
    const { ctx, cleanup } = makeTempBundle(patch);
    try {
      const { changedFiles } = await diff(ctx);
      expect(changedFiles).toHaveLength(4);
    } finally {
      cleanup();
    }
  });

  it('classifies added, modified, and deleted correctly', async () => {
    const { ctx, cleanup } = makeTempBundle(patch);
    try {
      const { counts } = await diff(ctx);
      expect(counts.added).toBe(1);
      expect(counts.deleted).toBe(1);
      expect(counts.modified).toBe(2);
      expect(counts.total).toBe(4);
    } finally {
      cleanup();
    }
  });

  it('marks src/auth, src/db, src/api paths as high-risk', async () => {
    const { ctx, cleanup } = makeTempBundle(patch);
    try {
      const { changedFiles } = await diff(ctx);
      const byPath = Object.fromEntries(changedFiles.map((f) => [f.path, f]));
      expect(byPath['src/auth/login.js'].highRisk).toBe(true);
      expect(byPath['src/db/schema.js'].highRisk).toBe(true);
      expect(byPath['src/api/oldRoute.js'].highRisk).toBe(true);
      expect(byPath['README.md'].highRisk).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('generates a finding for each high-risk file and none for safe files', async () => {
    const { ctx, cleanup } = makeTempBundle(patch);
    try {
      const { findings, changedFiles } = await diff(ctx);
      const highRiskCount = changedFiles.filter((f) => f.highRisk).length;
      expect(findings).toHaveLength(highRiskCount); // 3
      const findingFiles = findings.map((f) => f.file);
      expect(findingFiles).toContain('src/auth/login.js');
      expect(findingFiles).toContain('src/db/schema.js');
      expect(findingFiles).toContain('src/api/oldRoute.js');
      expect(findingFiles).not.toContain('README.md');
    } finally {
      cleanup();
    }
  });

  it('all findings have severity "warning" and category "diff"', async () => {
    const { ctx, cleanup } = makeTempBundle(patch);
    try {
      const { findings } = await diff(ctx);
      for (const f of findings) {
        expect(f.severity).toBe('warning');
        expect(f.category).toBe('diff');
      }
    } finally {
      cleanup();
    }
  });

  it('all findings conform to the Finding schema', async () => {
    const { ctx, cleanup } = makeTempBundle(patch);
    try {
      const { findings } = await diff(ctx);
      for (const f of findings) {
        assertFindingSchema(f);
      }
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — status-specific path extraction
// ---------------------------------------------------------------------------

describe('diff — path extraction from +++ b/ and --- a/', () => {
  it('uses +++ b/<path> for added files', async () => {
    const patch = [
      'diff --git a/src/auth/newThing.js b/src/auth/newThing.js',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/auth/newThing.js',
      '@@ -0,0 +1 @@',
      '+const x = 1;',
    ].join('\n');
    const { ctx, cleanup } = makeTempBundle(patch);
    try {
      const { changedFiles } = await diff(ctx);
      expect(changedFiles[0].path).toBe('src/auth/newThing.js');
      expect(changedFiles[0].status).toBe('added');
    } finally {
      cleanup();
    }
  });

  it('uses --- a/<path> for deleted files', async () => {
    const patch = [
      'diff --git a/src/api/old.js b/src/api/old.js',
      'deleted file mode 100644',
      '--- a/src/api/old.js',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-const x = 1;',
    ].join('\n');
    const { ctx, cleanup } = makeTempBundle(patch);
    try {
      const { changedFiles } = await diff(ctx);
      expect(changedFiles[0].path).toBe('src/api/old.js');
      expect(changedFiles[0].status).toBe('deleted');
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — high-risk prefix variants
// ---------------------------------------------------------------------------

describe('diff — high-risk prefix detection', () => {
  const cases = [
    { path: 'auth/service.js',       expected: true,  label: 'bare auth/ prefix' },
    { path: 'db/connect.js',         expected: true,  label: 'bare db/ prefix' },
    { path: 'migrations/001.sql',    expected: true,  label: 'bare migrations/ prefix' },
    { path: 'src/auth/handler.js',   expected: true,  label: 'src/auth' },
    { path: 'src/db/pool.js',        expected: true,  label: 'src/db' },
    { path: 'src/api/routes.js',     expected: true,  label: 'src/api' },
    { path: 'package.json',          expected: false, label: 'root package.json' },
    { path: 'src/utils/helpers.js',  expected: false, label: 'non-risk src/utils' },
    { path: 'README.md',             expected: false, label: 'README' },
  ];

  for (const { path: filePath, expected, label } of cases) {
    it(`highRisk=${expected} for ${label} (${filePath})`, async () => {
      // Build a minimal patch for this one file.
      const patch = [
        `diff --git a/${filePath} b/${filePath}`,
        'index 000..111 100644',
        `--- a/${filePath}`,
        `+++ b/${filePath}`,
        '@@ -1,1 +1,2 @@',
        ' line',
        '+new line',
      ].join('\n');
      const { ctx, cleanup } = makeTempBundle(patch);
      try {
        const { changedFiles } = await diff(ctx);
        expect(changedFiles).toHaveLength(1);
        expect(changedFiles[0].highRisk).toBe(expected);
      } finally {
        cleanup();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Tests — missing diff.patch
// ---------------------------------------------------------------------------

describe('diff — missing diff.patch', () => {
  it('returns empty result without throwing when diff.patch is absent', async () => {
    const { ctx, cleanup } = makeTempBundle(null); // null = don't create the file
    try {
      const result = await diff(ctx);
      expect(result.findings).toHaveLength(0);
      expect(result.changedFiles).toHaveLength(0);
      expect(result.counts.total).toBe(0);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — counts
// ---------------------------------------------------------------------------

describe('diff — counts correctness', () => {
  it('counts.total equals changedFiles.length', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { changedFiles, counts } = await diff(ctx);
    expect(counts.total).toBe(changedFiles.length);
  });

  it('counts.added + counts.modified + counts.deleted === counts.total', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { counts } = await diff(ctx);
    expect(counts.added + counts.modified + counts.deleted).toBe(counts.total);
  });

  it('returns zero counts for an empty patch', async () => {
    const { ctx, cleanup } = makeTempBundle('');
    try {
      const { counts } = await diff(ctx);
      expect(counts).toEqual({ added: 0, modified: 0, deleted: 0, total: 0 });
    } finally {
      cleanup();
    }
  });
});
