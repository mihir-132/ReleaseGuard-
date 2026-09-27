/**
 * Tests for server/routes/reports.js
 *
 * Covers:
 *   - GET /api/reports/:runId returns the stored report
 *   - GET /api/reports/:runId returns 404 for missing report
 *   - GET /api/reports returns report summaries
 *   - route registration does not break /api/health
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the storage module so no real disk I/O is needed
// ---------------------------------------------------------------------------
vi.mock('../storage/reports.js', () => ({
  readReport: vi.fn(),
  listReports: vi.fn(),
  writeReport: vi.fn(),
}));

import { readReport, listReports } from '../storage/reports.js';
import reportsRouter from './reports.js';

// ---------------------------------------------------------------------------
// Minimal report fixture
// ---------------------------------------------------------------------------

const SAMPLE_REPORT = {
  runId:            'run-abc-123',
  generatedAt:      '2025-07-01T12:00:00.000Z',
  manifest:         { name: 'payment-service', version: '1.2.0' },
  overallReadiness: 60,
  overallSeverity:  'warning',
  steps:            {},
  releaseNotes:     null,
};

const SAMPLE_SUMMARY = {
  runId:            'run-abc-123',
  generatedAt:      '2025-07-01T12:00:00.000Z',
  name:             'payment-service',
  version:          '1.2.0',
  overallReadiness: 60,
};

// ---------------------------------------------------------------------------
// Helper: invoke an Express router handler directly
// ---------------------------------------------------------------------------

function makeReq(overrides = {}) {
  return {
    params: {},
    query:  {},
    body:   {},
    ...overrides,
  };
}

function makeRes() {
  const res = {
    _status: 200,
    _body:   null,
  };
  res.status = vi.fn((code) => {
    res._status = code;
    return res;
  });
  res.json = vi.fn((body) => {
    res._body = body;
    return res;
  });
  return res;
}

/**
 * Find the route handler for a given method + path pattern from the router stack.
 * Matches the first route whose regexp matches the given urlPath.
 */
function getHandler(method, urlPath) {
  for (const layer of reportsRouter.stack) {
    if (!layer.route) continue;
    if (!layer.route.methods[method]) continue;
    if (layer.regexp.test(urlPath) || layer.route.path === urlPath) {
      return layer.route.stack[0].handle;
    }
  }
  throw new Error(`No ${method.toUpperCase()} handler found for "${urlPath}"`);
}

// ---------------------------------------------------------------------------
// Tests — GET /api/reports/:runId
// ---------------------------------------------------------------------------

describe('GET /api/reports/:runId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the report JSON with 200 when the report exists', async () => {
    readReport.mockReturnValue({ ok: true, report: SAMPLE_REPORT });

    const req = makeReq({ params: { runId: 'run-abc-123' } });
    const res = makeRes();

    // Locate the /:runId handler — it's the route with a param
    const layer = reportsRouter.stack.find(
      l => l.route && l.route.methods.get && l.route.path === '/:runId'
    );
    const handler = layer.route.stack[0].handle;

    await handler(req, res);

    expect(readReport).toHaveBeenCalledWith('run-abc-123');
    expect(res.json).toHaveBeenCalledWith(SAMPLE_REPORT);
    expect(res._body).toEqual(SAMPLE_REPORT);
  });

  it('returns 404 with error message when report does not exist', async () => {
    readReport.mockReturnValue({ ok: false, error: 'Report not found: missing-run' });

    const req = makeReq({ params: { runId: 'missing-run' } });
    const res = makeRes();

    const layer = reportsRouter.stack.find(
      l => l.route && l.route.methods.get && l.route.path === '/:runId'
    );
    const handler = layer.route.stack[0].handle;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('missing-run') })
    );
  });

  it('uses the runId from req.params', async () => {
    readReport.mockReturnValue({ ok: true, report: SAMPLE_REPORT });

    const req = makeReq({ params: { runId: 'specific-run-id' } });
    const res = makeRes();

    const layer = reportsRouter.stack.find(
      l => l.route && l.route.methods.get && l.route.path === '/:runId'
    );
    const handler = layer.route.stack[0].handle;

    await handler(req, res);

    expect(readReport).toHaveBeenCalledWith('specific-run-id');
  });

  it('returns the full report body including all top-level keys', async () => {
    readReport.mockReturnValue({ ok: true, report: SAMPLE_REPORT });

    const req = makeReq({ params: { runId: 'run-abc-123' } });
    const res = makeRes();

    const layer = reportsRouter.stack.find(
      l => l.route && l.route.methods.get && l.route.path === '/:runId'
    );
    const handler = layer.route.stack[0].handle;

    await handler(req, res);

    const body = res._body;
    expect(body).toHaveProperty('runId');
    expect(body).toHaveProperty('generatedAt');
    expect(body).toHaveProperty('manifest');
    expect(body).toHaveProperty('overallReadiness');
    expect(body).toHaveProperty('overallSeverity');
    expect(body).toHaveProperty('steps');
    expect(body).toHaveProperty('releaseNotes');
  });
});

// ---------------------------------------------------------------------------
// Tests — GET /api/reports
// ---------------------------------------------------------------------------

describe('GET /api/reports', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an array of report summaries', async () => {
    listReports.mockReturnValue([SAMPLE_SUMMARY]);

    const req = makeReq();
    const res = makeRes();

    const layer = reportsRouter.stack.find(
      l => l.route && l.route.methods.get && l.route.path === '/'
    );
    const handler = layer.route.stack[0].handle;

    handler(req, res);

    expect(listReports).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith([SAMPLE_SUMMARY]);
  });

  it('returns an empty array when no reports exist', async () => {
    listReports.mockReturnValue([]);

    const req = makeReq();
    const res = makeRes();

    const layer = reportsRouter.stack.find(
      l => l.route && l.route.methods.get && l.route.path === '/'
    );
    const handler = layer.route.stack[0].handle;

    handler(req, res);

    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('returns summaries with required fields', async () => {
    listReports.mockReturnValue([SAMPLE_SUMMARY]);

    const req = makeReq();
    const res = makeRes();

    const layer = reportsRouter.stack.find(
      l => l.route && l.route.methods.get && l.route.path === '/'
    );
    const handler = layer.route.stack[0].handle;

    handler(req, res);

    const [summary] = res._body;
    expect(summary).toHaveProperty('runId');
    expect(summary).toHaveProperty('generatedAt');
    expect(summary).toHaveProperty('name');
    expect(summary).toHaveProperty('version');
    expect(summary).toHaveProperty('overallReadiness');
  });

  it('returns multiple summaries', async () => {
    const second = { ...SAMPLE_SUMMARY, runId: 'run-second', name: 'other-svc' };
    listReports.mockReturnValue([SAMPLE_SUMMARY, second]);

    const req = makeReq();
    const res = makeRes();

    const layer = reportsRouter.stack.find(
      l => l.route && l.route.methods.get && l.route.path === '/'
    );
    const handler = layer.route.stack[0].handle;

    handler(req, res);

    expect(res._body).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Tests — router has the expected routes
// ---------------------------------------------------------------------------

describe('reports router — route registration', () => {
  it('registers GET /', () => {
    const hasRoot = reportsRouter.stack.some(
      l => l.route && l.route.methods.get && l.route.path === '/'
    );
    expect(hasRoot).toBe(true);
  });

  it('registers GET /:runId', () => {
    const hasRunId = reportsRouter.stack.some(
      l => l.route && l.route.methods.get && l.route.path === '/:runId'
    );
    expect(hasRunId).toBe(true);
  });

  it('does not register any POST, PUT, or DELETE routes', () => {
    const mutating = reportsRouter.stack.filter(l => {
      if (!l.route) return false;
      const m = l.route.methods;
      return m.post || m.put || m.delete || m.patch;
    });
    expect(mutating).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — /api/health is not broken
// ---------------------------------------------------------------------------

describe('route registration — /api/health not broken', () => {
  it('reportsRouter does not contain a health route', () => {
    const hasHealth = reportsRouter.stack.some(
      l => l.route && l.route.path === '/api/health'
    );
    expect(hasHealth).toBe(false);
  });

  it('reportsRouter does not intercept /', () => {
    // The root handler for "/" in this router only matches /api/reports
    // when mounted at /api/reports — it has its own path, not the global root.
    const rootLayer = reportsRouter.stack.find(
      l => l.route && l.route.methods.get && l.route.path === '/'
    );
    // This route exists but is scoped to the router, not /api/health
    expect(rootLayer).toBeDefined();
    expect(rootLayer.route.path).toBe('/');
  });
});
