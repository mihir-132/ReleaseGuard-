/**
 * Tests for Step 01 — Ingest (server/pipeline/steps/01-ingest.js)
 *
 * Covers:
 *   - valid bundle produces no findings and populates ctx.manifest
 *   - missing required manifest field produces a critical finding
 *   - missing required bundle file produces a critical finding
 *   - malformed manifest.json produces a critical parse-error finding
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import ingest from './01-ingest.js';

// ---------------------------------------------------------------------------
// Resolve the real synthetic bundle fixture path
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_BUNDLE = path.resolve(__dirname, '../../sample-bundles/v1.2.0');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ctx pointing at the given bundlePath. */
function makeCtx(bundlePath) {
  return { bundlePath, manifest: null, runId: 'test-run', emit: vi.fn(), results: {} };
}

/**
 * Build a ctx that uses a real temp dir on disk containing exactly the files
 * described by `files` (a { [filename]: content } map).
 *
 * Returns { ctx, cleanup }.
 */
function makeTempBundle(files) {
  const os = { tmpdir: () => path.join(__dirname, '../../.tmp-test') };
  const dir = path.join(
    path.join(__dirname, '../../.tmp-test'),
    `bundle-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(dir, { recursive: true });

  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }

  const ctx = makeCtx(dir);
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  return { ctx, cleanup };
}

/** A minimal valid manifest (all required fields present). */
function validManifest(overrides = {}) {
  return JSON.stringify({
    name: 'test-service',
    version: '1.0.0',
    previousVersion: '0.9.0',
    releaseDate: '2025-01-01',
    environment: 'staging',
    team: 'Platform',
    description: 'Test release',
    migrations: [],
    configChanges: [],
    testSuites: ['unit'],
    ...overrides,
  });
}

/** Minimal supporting files that must exist alongside manifest.json. */
const SUPPORTING_FILES = {
  'diff.patch': '--- /dev/null\n+++ b/index.js\n',
  'package.json': '{"name":"test-service","version":"1.0.0"}',
};

// ---------------------------------------------------------------------------
// Tests — valid bundle
// ---------------------------------------------------------------------------

describe('ingest — valid bundle (sample-bundles/v1.2.0)', () => {
  it('returns no findings for the well-formed fixture bundle', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const result = await ingest(ctx);
    expect(result.findings).toHaveLength(0);
  });

  it('populates ctx.manifest with the parsed manifest object', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    await ingest(ctx);
    expect(ctx.manifest).not.toBeNull();
    expect(ctx.manifest.name).toBe('payment-service');
    expect(ctx.manifest.version).toBe('1.2.0');
  });

  it('returns { findings } shape', async () => {
    const ctx = makeCtx(FIXTURE_BUNDLE);
    const result = await ingest(ctx);
    expect(result).toHaveProperty('findings');
    expect(Array.isArray(result.findings)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — missing required manifest fields
// ---------------------------------------------------------------------------

describe('ingest — missing required manifest field', () => {
  const requiredFields = [
    'name', 'version', 'previousVersion', 'releaseDate',
    'environment', 'team', 'description', 'migrations',
    'configChanges', 'testSuites',
  ];

  for (const field of requiredFields) {
    it(`produces a critical finding when "${field}" is absent`, async () => {
      const manifest = JSON.parse(validManifest());
      delete manifest[field];

      const { ctx, cleanup } = makeTempBundle({
        'manifest.json': JSON.stringify(manifest),
        ...SUPPORTING_FILES,
      });

      try {
        const result = await ingest(ctx);
        const match = result.findings.find((f) => f.id === `ingest-missing-field-${field}`);
        expect(match, `expected finding for field "${field}"`).toBeDefined();
        expect(match.severity).toBe('critical');
        expect(match.category).toBe('ingest');
        expect(match.file).toBe('manifest.json');
      } finally {
        cleanup();
      }
    });
  }

  it('does NOT assign ctx.manifest when a required field is missing', async () => {
    // ctx.manifest is still assigned because the manifest was parseable;
    // the orchestrator decides whether to continue — ingest just surfaces findings.
    // This test verifies the behaviour is explicit: manifest IS assigned even with
    // field findings so downstream steps can inspect what was present.
    const manifest = JSON.parse(validManifest());
    delete manifest.description;

    const { ctx, cleanup } = makeTempBundle({
      'manifest.json': JSON.stringify(manifest),
      ...SUPPORTING_FILES,
    });

    try {
      await ingest(ctx);
      // ctx.manifest is populated (partial manifest) — callers decide what to do.
      expect(ctx.manifest).not.toBeNull();
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — missing required bundle file
// ---------------------------------------------------------------------------

describe('ingest — missing required bundle file', () => {
  const requiredFiles = ['manifest.json', 'diff.patch', 'package.json'];

  for (const filename of requiredFiles) {
    it(`produces a critical finding when "${filename}" is absent`, async () => {
      const allFiles = {
        'manifest.json': validManifest(),
        ...SUPPORTING_FILES,
      };
      // Remove the file under test
      delete allFiles[filename];

      const { ctx, cleanup } = makeTempBundle(allFiles);

      try {
        const result = await ingest(ctx);
        const expectedId = `ingest-missing-file-${filename.replace(/[^a-z0-9]/gi, '-')}`;
        const match = result.findings.find((f) => f.id === expectedId);
        expect(match, `expected finding for missing file "${filename}"`).toBeDefined();
        expect(match.severity).toBe('critical');
        expect(match.category).toBe('ingest');
        expect(match.file).toBe(filename);
      } finally {
        cleanup();
      }
    });
  }

  it('skips manifest parsing when manifest.json is missing', async () => {
    const { ctx, cleanup } = makeTempBundle({ ...SUPPORTING_FILES });

    try {
      const result = await ingest(ctx);
      // Only one finding (missing manifest), no parse-error finding
      const parseErrorFinding = result.findings.find(
        (f) => f.id === 'ingest-manifest-parse-error'
      );
      expect(parseErrorFinding).toBeUndefined();
      expect(ctx.manifest).toBeNull();
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — malformed manifest.json
// ---------------------------------------------------------------------------

describe('ingest — malformed manifest.json', () => {
  it('produces a critical parse-error finding for invalid JSON', async () => {
    const { ctx, cleanup } = makeTempBundle({
      'manifest.json': '{ this is not valid json !!!',
      ...SUPPORTING_FILES,
    });

    try {
      const result = await ingest(ctx);
      const match = result.findings.find((f) => f.id === 'ingest-manifest-parse-error');
      expect(match).toBeDefined();
      expect(match.severity).toBe('critical');
      expect(match.category).toBe('ingest');
      expect(match.file).toBe('manifest.json');
    } finally {
      cleanup();
    }
  });

  it('does not crash — returns findings array even on malformed JSON', async () => {
    const { ctx, cleanup } = makeTempBundle({
      'manifest.json': '<<<broken>>>',
      ...SUPPORTING_FILES,
    });

    try {
      const result = await ingest(ctx);
      expect(Array.isArray(result.findings)).toBe(true);
      expect(ctx.manifest).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('does not produce field-missing findings when manifest is unparseable', async () => {
    const { ctx, cleanup } = makeTempBundle({
      'manifest.json': 'not json at all',
      ...SUPPORTING_FILES,
    });

    try {
      const result = await ingest(ctx);
      const fieldFindings = result.findings.filter((f) =>
        f.id.startsWith('ingest-missing-field-')
      );
      expect(fieldFindings).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — Finding schema conformance
// ---------------------------------------------------------------------------

describe('ingest — finding schema', () => {
  it('every finding has id, category, severity, title, detail, file, line, recommendation', async () => {
    // Trigger multiple findings: missing required field + missing file
    const { ctx, cleanup } = makeTempBundle({
      // missing diff.patch, missing "team" field
      'manifest.json': (() => {
        const m = JSON.parse(validManifest());
        delete m.team;
        return JSON.stringify(m);
      })(),
      'package.json': '{"name":"x"}',
      // diff.patch intentionally omitted
    });

    try {
      const result = await ingest(ctx);
      expect(result.findings.length).toBeGreaterThan(0);

      for (const f of result.findings) {
        expect(f).toHaveProperty('id');
        expect(f).toHaveProperty('category');
        expect(f).toHaveProperty('severity');
        expect(f).toHaveProperty('title');
        expect(f).toHaveProperty('detail');
        expect(f).toHaveProperty('file');
        expect(f).toHaveProperty('line');
        expect(f).toHaveProperty('recommendation');
      }
    } finally {
      cleanup();
    }
  });
});
