import { describe, it, expect, vi } from 'vitest';
import { validateManifest } from '../routes/upload.js';

// NOTE: runUploadMiddleware and multer error-handling tests use vi.mock below.

// ---------------------------------------------------------------------------
// validateManifest
// ---------------------------------------------------------------------------

const validManifest = {
  name: 'payment-service',
  version: '1.2.0',
  previousVersion: '1.1.3',
  releaseDate: '2025-07-01',
  environment: 'production',
  team: 'Platform',
  description: 'Short release summary',
};

describe('validateManifest — valid manifest', () => {
  it('returns no findings for a minimal valid manifest', () => {
    expect(validateManifest(validManifest)).toEqual([]);
  });

  it('returns no findings when optional arrays are present and valid', () => {
    const m = {
      ...validManifest,
      migrations: ['20250630_add_refresh_token_index.sql'],
      configChanges: ['DATABASE_POOL_SIZE'],
      testSuites: ['unit', 'integration'],
    };
    expect(validateManifest(m)).toEqual([]);
  });
});

describe('validateManifest — missing required fields', () => {
  const requiredFields = [
    'name',
    'version',
    'previousVersion',
    'releaseDate',
    'environment',
    'team',
    'description',
  ];

  for (const field of requiredFields) {
    it(`reports a finding when "${field}" is missing`, () => {
      const m = { ...validManifest };
      delete m[field];
      const findings = validateManifest(m);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.some((f) => f.includes(field))).toBe(true);
    });
  }

  it('reports findings for all missing fields at once', () => {
    const findings = validateManifest({});
    expect(findings.length).toBe(requiredFields.length);
  });
});

describe('validateManifest — wrong field types', () => {
  it('reports a finding when "name" is a number', () => {
    const findings = validateManifest({ ...validManifest, name: 42 });
    expect(findings.some((f) => f.includes('name'))).toBe(true);
  });

  it('reports a finding when "version" is an object', () => {
    const findings = validateManifest({ ...validManifest, version: {} });
    expect(findings.some((f) => f.includes('version'))).toBe(true);
  });
});

describe('validateManifest — empty required strings', () => {
  it('reports a finding when "description" is an empty string', () => {
    const findings = validateManifest({ ...validManifest, description: '   ' });
    expect(findings.some((f) => f.includes('description'))).toBe(true);
  });
});

describe('validateManifest — optional array fields wrong type', () => {
  it('reports a finding when "migrations" is a string instead of array', () => {
    const findings = validateManifest({ ...validManifest, migrations: 'one.sql' });
    expect(findings.some((f) => f.includes('migrations'))).toBe(true);
  });

  it('reports a finding when "configChanges" is an object', () => {
    const findings = validateManifest({ ...validManifest, configChanges: {} });
    expect(findings.some((f) => f.includes('configChanges'))).toBe(true);
  });
});

describe('validateManifest — non-object input', () => {
  it('returns a finding for null', () => {
    expect(validateManifest(null).length).toBeGreaterThan(0);
  });

  it('returns a finding for an array', () => {
    expect(validateManifest([]).length).toBeGreaterThan(0);
  });

  it('returns a finding for a string', () => {
    expect(validateManifest('bad').length).toBeGreaterThan(0);
  });
});
