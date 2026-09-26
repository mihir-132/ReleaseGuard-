/**
 * Tests for Step 03 — Dependencies (server/pipeline/steps/03-dependencies.js)
 *
 * Covers:
 *   - lodash major bump is detected (3.x → 4.x)
 *   - major bump produces severity "warning"
 *   - newly added dependency produces severity "info"
 *   - removed dependency produces severity "info"
 *   - dependency change structure is returned
 *   - dependency findings conform to the Finding schema
 *   - missing package.json is handled safely
 *   - missing diff.patch is handled safely
 *   - invalid/malformed package.json is handled safely
 *   - uuid major bump (8 → 9) is also detected
 *   - stripe and zod appear as newly added
 *   - unchanged devDependencies produce no findings
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import dependencies from './03-dependencies.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_BUNDLE = path.resolve(__dirname, '../../sample-bundles/v1.2.0');
const TMP_DIR        = path.resolve(__dirname, '../../.tmp-test');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ctx pointing at bundlePath. */
function makeCtx(bundlePath) {
  return { bundlePath, manifest: null, runId: 'test-run', emit: vi.fn(), results: {} };
}

/**
 * Create a temporary bundle directory containing the provided files.
 * Pass `null` as a value to skip creating that file.
 * Returns { ctx, cleanup }.
 *
 * @param {{ 'package.json'?: string|null, 'diff.patch'?: string|null }} files
 */
function makeTempBundle(files) {
  const dir = path.join(
    TMP_DIR,
    `dep-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    if (content !== null && content !== undefined) {
      fs.writeFileSync(path.join(dir, name), content, 'utf8');
    }
  }
  return {
    ctx:     makeCtx(dir),
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
// Synthetic diff helpers
// ---------------------------------------------------------------------------

/**
 * Minimal unified diff for a package.json change.
 * prev and curr are plain JSON strings (may be single-line or multi-line).
 * Normalises to pretty-printed JSON before building the diff so that
 * individual dependency entries appear on their own lines — matching the
 * real-world format and allowing the depLineRe regex to work correctly.
 */
function makePkgDiff(prevJson, currJson) {
  // Re-format to indented JSON so each dep is on its own line
  const prevFmt = JSON.stringify(JSON.parse(prevJson), null, 2);
  const currFmt = JSON.stringify(JSON.parse(currJson), null, 2);
  const prevLines = prevFmt.split('\n').map((l) => `-${l}`);
  const currLines = currFmt.split('\n').map((l) => `+${l}`);
  return [
    'diff --git a/package.json b/package.json',
    'index aaa..bbb 100644',
    '--- a/package.json',
    '+++ b/package.json',
    `@@ -1,${prevLines.length} +1,${currLines.length} @@`,
    ...prevLines,
    ...currLines,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Tests — real fixture bundle (sample-bundles/v1.2.0)
// ---------------------------------------------------------------------------

describe('dependencies — real fixture bundle (sample-bundles/v1.2.0)', () => {
  it('returns an object with findings and changes', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const result = await dependencies(ctx);
    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('changes');
    expect(Array.isArray(result.findings)).toBe(true);
    expect(Array.isArray(result.changes)).toBe(true);
  });

  it('detects the lodash major bump (3.x → 4.x)', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { findings } = await dependencies(ctx);
    const lodashFinding = findings.find(
      (f) => f.title.toLowerCase().includes('lodash')
    );
    expect(lodashFinding, 'expected a finding for lodash').toBeDefined();
    expect(lodashFinding.severity).toBe('warning');
  });

  it('lodash change entry has change="major" in changes', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { changes } = await dependencies(ctx);
    const lodash = changes.find((c) => c.name === 'lodash');
    expect(lodash, 'expected a changes entry for lodash').toBeDefined();
    expect(lodash.change).toBe('major');
    expect(lodash.prev).toMatch(/3\./);
    expect(lodash.curr).toMatch(/4\./);
  });

  it('detects the uuid major bump (8.x → 9.x)', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { findings } = await dependencies(ctx);
    const uuidFinding = findings.find(
      (f) => f.title.toLowerCase().includes('uuid')
    );
    expect(uuidFinding, 'expected a finding for uuid').toBeDefined();
    expect(uuidFinding.severity).toBe('warning');
  });

  it('stripe appears as newly added with severity "info"', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { findings } = await dependencies(ctx);
    const stripeFinding = findings.find(
      (f) => f.title.toLowerCase().includes('stripe') && f.severity === 'info'
    );
    expect(stripeFinding, 'expected an info finding for stripe').toBeDefined();
  });

  it('zod appears as newly added with severity "info"', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { findings } = await dependencies(ctx);
    const zodFinding = findings.find(
      (f) => f.title.toLowerCase().includes('zod') && f.severity === 'info'
    );
    expect(zodFinding, 'expected an info finding for zod').toBeDefined();
  });

  it('stripe and zod changes have change="added" in changes', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { changes } = await dependencies(ctx);
    const stripe = changes.find((c) => c.name === 'stripe');
    const zod    = changes.find((c) => c.name === 'zod');
    expect(stripe?.change).toBe('added');
    expect(zod?.change).toBe('added');
  });

  it('unchanged devDependencies produce no findings', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { findings } = await dependencies(ctx);
    const devFindings = findings.filter(
      (f) => f.detail && f.detail.includes('devDependencies')
    );
    // eslint, supertest, vitest all unchanged — expect no warnings for them
    expect(devFindings).toHaveLength(0);
  });

  it('all findings conform to the Finding schema', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { findings } = await dependencies(ctx);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      assertFindingSchema(f);
    }
  });

  it('all findings have category "dependency"', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { findings } = await dependencies(ctx);
    for (const f of findings) {
      expect(f.category).toBe('dependency');
    }
  });

  it('all findings have file "package.json"', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { findings } = await dependencies(ctx);
    for (const f of findings) {
      expect(f.file).toBe('package.json');
    }
  });

  it('changes entries include name, group, change, prev, curr', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const { changes } = await dependencies(ctx);
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) {
      expect(c).toHaveProperty('name');
      expect(c).toHaveProperty('group');
      expect(c).toHaveProperty('change');
      expect(c).toHaveProperty('prev');
      expect(c).toHaveProperty('curr');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — major bump finding detail
// ---------------------------------------------------------------------------

describe('dependencies — major bump severity and content', () => {
  it('produces severity "warning" for a major bump', async () => {
    const prev = JSON.stringify({ dependencies: { react: '^17.0.0' } });
    const curr = JSON.stringify({ dependencies: { react: '^18.0.0' } });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      'diff.patch':   makePkgDiff(prev, curr),
    });
    try {
      const { findings } = await dependencies(ctx);
      const f = findings.find((x) => x.title.includes('react'));
      expect(f).toBeDefined();
      expect(f.severity).toBe('warning');
      expect(f.category).toBe('dependency');
    } finally {
      cleanup();
    }
  });

  it('title includes old major and new major', async () => {
    const prev = JSON.stringify({ dependencies: { mylib: '^2.1.0' } });
    const curr = JSON.stringify({ dependencies: { mylib: '^3.0.0' } });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      'diff.patch':   makePkgDiff(prev, curr),
    });
    try {
      const { findings } = await dependencies(ctx);
      const f = findings.find((x) => x.title.includes('mylib'));
      expect(f).toBeDefined();
      expect(f.title).toMatch(/2\.x/);
      expect(f.title).toMatch(/3\.x/);
    } finally {
      cleanup();
    }
  });

  it('produces no finding for a minor bump', async () => {
    const prev = JSON.stringify({ dependencies: { lib: '^1.0.0' } });
    const curr = JSON.stringify({ dependencies: { lib: '^1.1.0' } });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      'diff.patch':   makePkgDiff(prev, curr),
    });
    try {
      const { findings } = await dependencies(ctx);
      expect(findings).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it('produces no finding for a patch bump', async () => {
    const prev = JSON.stringify({ dependencies: { lib: '^1.0.0' } });
    const curr = JSON.stringify({ dependencies: { lib: '^1.0.1' } });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      'diff.patch':   makePkgDiff(prev, curr),
    });
    try {
      const { findings } = await dependencies(ctx);
      expect(findings).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it('produces no finding for an unchanged dependency', async () => {
    const pkg = JSON.stringify({ dependencies: { lib: '^1.0.0' } });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': pkg,
      'diff.patch': [
        'diff --git a/package.json b/package.json',
        'index aaa..bbb 100644',
        '--- a/package.json',
        '+++ b/package.json',
        '@@ -1,1 +1,1 @@',
        ' {"dependencies":{"lib":"^1.0.0"}}',
      ].join('\n'),
    });
    try {
      const { findings } = await dependencies(ctx);
      expect(findings).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — newly added dependency
// ---------------------------------------------------------------------------

describe('dependencies — newly added dependency', () => {
  it('produces severity "info" for a newly added dependency', async () => {
    const prev = JSON.stringify({ dependencies: {} });
    const curr = JSON.stringify({ dependencies: { newpkg: '^1.0.0' } });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      'diff.patch':   makePkgDiff(prev, curr),
    });
    try {
      const { findings } = await dependencies(ctx);
      const f = findings.find((x) => x.title.includes('newpkg'));
      expect(f).toBeDefined();
      expect(f.severity).toBe('info');
      expect(f.category).toBe('dependency');
    } finally {
      cleanup();
    }
  });

  it('change entry has change="added", prev=null', async () => {
    const prev = JSON.stringify({ dependencies: {} });
    const curr = JSON.stringify({ dependencies: { brandnew: '^2.0.0' } });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      'diff.patch':   makePkgDiff(prev, curr),
    });
    try {
      const { changes } = await dependencies(ctx);
      const c = changes.find((x) => x.name === 'brandnew');
      expect(c).toBeDefined();
      expect(c.change).toBe('added');
      expect(c.prev).toBeNull();
      expect(c.curr).toBe('^2.0.0');
    } finally {
      cleanup();
    }
  });

  it('added dependency finding conforms to Finding schema', async () => {
    const prev = JSON.stringify({ dependencies: {} });
    const curr = JSON.stringify({ dependencies: { addedlib: '^5.0.0' } });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      'diff.patch':   makePkgDiff(prev, curr),
    });
    try {
      const { findings } = await dependencies(ctx);
      for (const f of findings) {
        assertFindingSchema(f);
      }
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — removed dependency
// ---------------------------------------------------------------------------

describe('dependencies — removed dependency', () => {
  it('produces severity "info" for a removed dependency', async () => {
    const prev = JSON.stringify({ dependencies: { oldpkg: '^2.0.0' } });
    const curr = JSON.stringify({ dependencies: {} });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      'diff.patch':   makePkgDiff(prev, curr),
    });
    try {
      const { findings } = await dependencies(ctx);
      const f = findings.find((x) => x.title.includes('oldpkg'));
      expect(f).toBeDefined();
      expect(f.severity).toBe('info');
      expect(f.category).toBe('dependency');
    } finally {
      cleanup();
    }
  });

  it('change entry has change="removed", curr=null', async () => {
    const prev = JSON.stringify({ dependencies: { gone: '^3.0.0' } });
    const curr = JSON.stringify({ dependencies: {} });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      'diff.patch':   makePkgDiff(prev, curr),
    });
    try {
      const { changes } = await dependencies(ctx);
      const c = changes.find((x) => x.name === 'gone');
      expect(c).toBeDefined();
      expect(c.change).toBe('removed');
      expect(c.prev).toBe('^3.0.0');
      expect(c.curr).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('removed dependency finding conforms to Finding schema', async () => {
    const prev = JSON.stringify({ dependencies: { removedlib: '^1.2.3' } });
    const curr = JSON.stringify({ dependencies: {} });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      'diff.patch':   makePkgDiff(prev, curr),
    });
    try {
      const { findings } = await dependencies(ctx);
      for (const f of findings) {
        assertFindingSchema(f);
      }
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — devDependencies
// ---------------------------------------------------------------------------

describe('dependencies — devDependencies group', () => {
  it('detects a major bump in devDependencies', async () => {
    const prev = JSON.stringify({ devDependencies: { jest: '^27.0.0' } });
    const curr = JSON.stringify({ devDependencies: { jest: '^29.0.0' } });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      'diff.patch':   makePkgDiff(prev, curr),
    });
    try {
      const { findings, changes } = await dependencies(ctx);
      const f = findings.find((x) => x.title.includes('jest'));
      expect(f).toBeDefined();
      expect(f.severity).toBe('warning');
      const c = changes.find((x) => x.name === 'jest');
      expect(c?.change).toBe('major');
      expect(c?.group).toBe('devDependencies');
    } finally {
      cleanup();
    }
  });

  it('newly added devDependency produces info finding', async () => {
    const prev = JSON.stringify({ devDependencies: {} });
    const curr = JSON.stringify({ devDependencies: { prettier: '^3.0.0' } });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      'diff.patch':   makePkgDiff(prev, curr),
    });
    try {
      const { findings } = await dependencies(ctx);
      const f = findings.find((x) => x.title.includes('prettier'));
      expect(f).toBeDefined();
      expect(f.severity).toBe('info');
      expect(f.detail).toContain('devDependencies');
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — missing / invalid input handled safely
// ---------------------------------------------------------------------------

describe('dependencies — missing input handled safely', () => {
  it('returns { findings: [], changes: [] } when package.json is missing', async () => {
    const { ctx, cleanup } = makeTempBundle({
      'diff.patch': 'diff --git a/README.md b/README.md\n',
      // no package.json
    });
    try {
      const result = await dependencies(ctx);
      expect(result.findings).toHaveLength(0);
      expect(result.changes).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it('returns { findings, changes } when diff.patch is missing (no changes detected)', async () => {
    const curr = JSON.stringify({ dependencies: { express: '^4.0.0' } });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      // no diff.patch — no previous state signal, so no changes can be inferred
    });
    try {
      const result = await dependencies(ctx);
      expect(result).toHaveProperty('findings');
      expect(result).toHaveProperty('changes');
      expect(Array.isArray(result.findings)).toBe(true);
      expect(Array.isArray(result.changes)).toBe(true);
      // Without a diff, all deps are treated as unchanged (prev = curr)
      expect(result.findings).toHaveLength(0);
      const expressChange = result.changes.find((c) => c.name === 'express');
      expect(expressChange?.change).toBe('unchanged');
    } finally {
      cleanup();
    }
  });

  it('does not crash when package.json contains invalid JSON', async () => {
    const { ctx, cleanup } = makeTempBundle({
      'package.json': '{ NOT VALID JSON !!!',
      'diff.patch':   'diff --git a/package.json b/package.json\n',
    });
    try {
      const result = await dependencies(ctx);
      expect(result).toHaveProperty('findings');
      expect(result).toHaveProperty('changes');
    } finally {
      cleanup();
    }
  });

  it('does not crash when diff.patch contains only unrelated sections', async () => {
    const curr = JSON.stringify({ dependencies: { lodash: '^4.0.0' } });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      'diff.patch': [
        'diff --git a/README.md b/README.md',
        'index 000..111 100644',
        '--- a/README.md',
        '+++ b/README.md',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ].join('\n'),
    });
    try {
      const result = await dependencies(ctx);
      // No previous package.json section in the diff → no previous state signal
      // lodash is treated as unchanged (prev = curr, no diff signal)
      expect(result).toHaveProperty('findings');
      expect(result).toHaveProperty('changes');
      const lodash = result.changes.find((c) => c.name === 'lodash');
      expect(lodash?.change).toBe('unchanged');
    } finally {
      cleanup();
    }
  });

  it('handles a version that cannot be parsed as semver without crashing', async () => {
    const prev = JSON.stringify({ dependencies: { weirdpkg: 'git+https://github.com/org/repo.git' } });
    const curr = JSON.stringify({ dependencies: { weirdpkg: 'git+https://github.com/org/repo.git#v2' } });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      'diff.patch':   makePkgDiff(prev, curr),
    });
    try {
      const result = await dependencies(ctx);
      expect(result).toHaveProperty('findings');
      expect(result).toHaveProperty('changes');
      // No warning — classified as 'unparseable', which produces no finding
      const warnings = result.findings.filter((f) => f.severity === 'warning');
      expect(warnings).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it('handles both inputs missing gracefully', async () => {
    const { ctx, cleanup } = makeTempBundle({});
    try {
      const result = await dependencies(ctx);
      expect(result.findings).toHaveLength(0);
      expect(result.changes).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — changes structure
// ---------------------------------------------------------------------------

describe('dependencies — changes structure', () => {
  it('changes array records the group name correctly', async () => {
    const prev = JSON.stringify({
      dependencies:    { pkgA: '^1.0.0' },
      devDependencies: { pkgB: '^1.0.0' },
    });
    const curr = JSON.stringify({
      dependencies:    { pkgA: '^2.0.0' },
      devDependencies: { pkgB: '^2.0.0' },
    });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      'diff.patch':   makePkgDiff(prev, curr),
    });
    try {
      const { changes } = await dependencies(ctx);
      const a = changes.find((c) => c.name === 'pkgA');
      const b = changes.find((c) => c.name === 'pkgB');
      expect(a?.group).toBe('dependencies');
      expect(b?.group).toBe('devDependencies');
    } finally {
      cleanup();
    }
  });

  it('minor change is recorded correctly with change="minor"', async () => {
    const prev = JSON.stringify({ dependencies: { lib: '^1.0.0' } });
    const curr = JSON.stringify({ dependencies: { lib: '^1.1.0' } });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      'diff.patch':   makePkgDiff(prev, curr),
    });
    try {
      const { changes } = await dependencies(ctx);
      const c = changes.find((x) => x.name === 'lib');
      expect(c?.change).toBe('minor');
    } finally {
      cleanup();
    }
  });

  it('patch change is recorded correctly with change="patch"', async () => {
    const prev = JSON.stringify({ dependencies: { lib: '^1.0.0' } });
    const curr = JSON.stringify({ dependencies: { lib: '^1.0.1' } });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': curr,
      'diff.patch':   makePkgDiff(prev, curr),
    });
    try {
      const { changes } = await dependencies(ctx);
      const c = changes.find((x) => x.name === 'lib');
      expect(c?.change).toBe('patch');
    } finally {
      cleanup();
    }
  });

  it('unchanged dependency is recorded with change="unchanged"', async () => {
    const pkgJson = JSON.stringify({ dependencies: { stable: '^1.0.0' } });
    const { ctx, cleanup } = makeTempBundle({
      'package.json': pkgJson,
      'diff.patch': [
        'diff --git a/package.json b/package.json',
        'index aaa..bbb 100644',
        '--- a/package.json',
        '+++ b/package.json',
        '@@ -1,1 +1,1 @@',
        ' {"dependencies":{"stable":"^1.0.0"}}',
      ].join('\n'),
    });
    try {
      const { changes } = await dependencies(ctx);
      const c = changes.find((x) => x.name === 'stable');
      expect(c?.change).toBe('unchanged');
    } finally {
      cleanup();
    }
  });
});
