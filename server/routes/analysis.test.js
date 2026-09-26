/**
 * Tests for GET /api/analysis/:runId/stream (SSE response).
 *
 * Verifies:
 *   - correct SSE headers are set
 *   - a "running" and "complete" event are written per step
 *   - a final "done" event is written
 *   - events are formatted as `event: <name>\ndata: <JSON>\n\n`
 *   - 404 is returned for unknown runIds
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Mock the pipeline so we control what gets emitted without real I/O.
// ---------------------------------------------------------------------------
vi.mock('../pipeline/index.js', () => ({
  runPipeline: vi.fn(async (_runId, _bundlePath, emit) => {
    emit({ event: 'step', data: { step: '01-ingest', status: 'running' } });
    emit({ event: 'step', data: { step: '01-ingest', status: 'complete', findings: [] } });
    return { '01-ingest': { findings: [] } };
  }),
}));

import { default as analysisRouter } from '../routes/analysis.js';

// ---------------------------------------------------------------------------
// Spy on fs methods — spies are easier to set up for built-in ESM modules.
// ---------------------------------------------------------------------------
let existsSyncSpy;
let readdirSyncSpy;

beforeEach(() => {
  existsSyncSpy  = vi.spyOn(fs, 'existsSync');
  readdirSyncSpy = vi.spyOn(fs, 'readdirSync');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: build a minimal req/res pair that captures SSE writes.
// ---------------------------------------------------------------------------
function makeSSEMocks({ runId = 'test-run-123', runExists = true } = {}) {
  const written = [];

  const req = {
    params: { runId },
    on: vi.fn(),
  };

  const res = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk) => written.push(chunk)),
    end: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };

  existsSyncSpy.mockReturnValue(runExists);
  if (runExists) {
    readdirSyncSpy.mockReturnValue(['bundle-root']);
  }

  return { req, res, written };
}

/**
 * Extract the route handler from the router's stack.
 * The analysis router has one route: GET /:runId/stream
 */
function getRouteHandler() {
  const layer = analysisRouter.stack.find(
    (l) => l.route && l.route.methods.get
  );
  return layer.route.stack[0].handle;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/analysis/:runId/stream — SSE headers', () => {
  it('sets Content-Type to text/event-stream', async () => {
    const { req, res } = makeSSEMocks();
    await getRouteHandler()(req, res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
  });

  it('sets Cache-Control to no-cache', async () => {
    const { req, res } = makeSSEMocks();
    await getRouteHandler()(req, res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
  });

  it('sets Connection to keep-alive', async () => {
    const { req, res } = makeSSEMocks();
    await getRouteHandler()(req, res);
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
  });

  it('calls flushHeaders to open the SSE connection before the pipeline runs', async () => {
    const { req, res } = makeSSEMocks();
    await getRouteHandler()(req, res);
    expect(res.flushHeaders).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/analysis/:runId/stream — event format', () => {
  it('writes events using the SSE wire format: event:\\ndata:\\n\\n', async () => {
    const { req, res, written } = makeSSEMocks();
    await getRouteHandler()(req, res);

    for (const chunk of written) {
      // Each chunk must match the SSE format.
      expect(chunk).toMatch(/^event: [\w-]+\ndata: \{.*\}\n\n$/);
    }
  });

  it('writes a "running" step event before the "complete" step event', async () => {
    const { req, res, written } = makeSSEMocks();
    await getRouteHandler()(req, res);

    const stepChunks = written.filter((c) => c.startsWith('event: step'));
    expect(stepChunks.length).toBeGreaterThanOrEqual(2);

    const firstData  = JSON.parse(stepChunks[0].match(/data: (.+)/)[1]);
    const secondData = JSON.parse(stepChunks[1].match(/data: (.+)/)[1]);

    expect(firstData.status).toBe('running');
    expect(secondData.status).toBe('complete');
    expect(secondData.findings).toEqual([]);
  });

  it('writes a final "done" event', async () => {
    const { req, res, written } = makeSSEMocks();
    await getRouteHandler()(req, res);

    const lastChunk = written[written.length - 1];
    expect(lastChunk).toMatch(/^event: done\n/);

    const doneData = JSON.parse(lastChunk.match(/data: (.+)/)[1]);
    expect(doneData).toMatchObject({ runId: 'test-run-123' });
  });

  it('calls res.end() after emitting the done event', async () => {
    const { req, res } = makeSSEMocks();
    await getRouteHandler()(req, res);
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/analysis/:runId/stream — 404 for unknown run', () => {
  it('returns 404 JSON when the runId directory does not exist', async () => {
    const { req, res } = makeSSEMocks({ runExists: false });
    await getRouteHandler()(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('test-run-123') })
    );
  });
});
