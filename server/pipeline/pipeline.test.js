/**
 * Tests for the pipeline orchestrator (server/pipeline/index.js).
 *
 * Verifies:
 *   - steps execute in order 01 → 08
 *   - a "running" event is emitted before each step
 *   - a "complete" event with findings is emitted after each step
 *   - accumulated results are returned
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock all 8 step modules so tests are isolated from their implementations.
// Each mock returns { findings: [] } synchronously.
// ---------------------------------------------------------------------------
vi.mock('../pipeline/steps/01-ingest.js',       () => ({ default: vi.fn(async () => ({ findings: [] })) }));
vi.mock('../pipeline/steps/02-diff.js',          () => ({ default: vi.fn(async () => ({ findings: [] })) }));
vi.mock('../pipeline/steps/03-dependencies.js',  () => ({ default: vi.fn(async () => ({ findings: [] })) }));
vi.mock('../pipeline/steps/04-env-config.js',    () => ({ default: vi.fn(async () => ({ findings: [] })) }));
vi.mock('../pipeline/steps/05-migrations.js',    () => ({ default: vi.fn(async () => ({ findings: [] })) }));
vi.mock('../pipeline/steps/06-test-gap.js',      () => ({ default: vi.fn(async () => ({ findings: [] })) }));
vi.mock('../pipeline/steps/07-deployment.js',    () => ({ default: vi.fn(async () => ({ findings: [] })) }));
vi.mock('../pipeline/steps/08-report.js',        () => ({ default: vi.fn(async () => ({ findings: [] })) }));

import { runPipeline } from '../pipeline/index.js';

import step01 from '../pipeline/steps/01-ingest.js';
import step02 from '../pipeline/steps/02-diff.js';
import step03 from '../pipeline/steps/03-dependencies.js';
import step04 from '../pipeline/steps/04-env-config.js';
import step05 from '../pipeline/steps/05-migrations.js';
import step06 from '../pipeline/steps/06-test-gap.js';
import step07 from '../pipeline/steps/07-deployment.js';
import step08 from '../pipeline/steps/08-report.js';

const STEP_NAMES = [
  '01-ingest',
  '02-diff',
  '03-dependencies',
  '04-env-config',
  '05-migrations',
  '06-test-gap',
  '07-deployment',
  '08-report',
];

const STEP_FNS = [step01, step02, step03, step04, step05, step06, step07, step08];

describe('runPipeline — step ordering', () => {
  it('calls all 8 steps exactly once', async () => {
    const emit = vi.fn();
    await runPipeline('run-1', '/fake/bundle', emit);

    for (const fn of STEP_FNS) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it('calls steps in the correct order (01 → 08)', async () => {
    const callOrder = [];
    for (const fn of STEP_FNS) {
      fn.mockImplementation(async () => {
        callOrder.push(fn);
        return { findings: [] };
      });
    }

    const emit = vi.fn();
    await runPipeline('run-order', '/fake/bundle', emit);

    expect(callOrder).toEqual(STEP_FNS);
  });
});

describe('runPipeline — emitted events', () => {
  it('emits a "running" event before each step', async () => {
    const emit = vi.fn();
    await runPipeline('run-2', '/fake/bundle', emit);

    const runningEvents = emit.mock.calls
      .map(([e]) => e)
      .filter((e) => e.event === 'step' && e.data.status === 'running');

    expect(runningEvents).toHaveLength(8);
    expect(runningEvents.map((e) => e.data.step)).toEqual(STEP_NAMES);
  });

  it('emits a "complete" event with findings after each step', async () => {
    const emit = vi.fn();
    await runPipeline('run-3', '/fake/bundle', emit);

    const completeEvents = emit.mock.calls
      .map(([e]) => e)
      .filter((e) => e.event === 'step' && e.data.status === 'complete');

    expect(completeEvents).toHaveLength(8);
    for (const e of completeEvents) {
      expect(e.data).toMatchObject({
        step: expect.any(String),
        status: 'complete',
        findings: [],
      });
    }
  });

  it('emits events interleaved: running then complete for each step', async () => {
    const emit = vi.fn();
    await runPipeline('run-4', '/fake/bundle', emit);

    const stepEvents = emit.mock.calls
      .map(([e]) => e)
      .filter((e) => e.event === 'step');

    // Expect 16 total events: 2 per step × 8 steps
    expect(stepEvents).toHaveLength(16);

    for (let i = 0; i < 8; i++) {
      const running  = stepEvents[i * 2];
      const complete = stepEvents[i * 2 + 1];

      expect(running.data.step).toBe(STEP_NAMES[i]);
      expect(running.data.status).toBe('running');

      expect(complete.data.step).toBe(STEP_NAMES[i]);
      expect(complete.data.status).toBe('complete');
    }
  });
});

describe('runPipeline — accumulated results', () => {
  it('returns all step results keyed by step name', async () => {
    const emit = vi.fn();
    const results = await runPipeline('run-5', '/fake/bundle', emit);

    expect(Object.keys(results)).toEqual(STEP_NAMES);
    for (const name of STEP_NAMES) {
      expect(results[name]).toEqual({ findings: [] });
    }
  });

  it('passes accumulated results to each subsequent step via ctx.results', async () => {
    const receivedResults = [];

    for (const fn of STEP_FNS) {
      fn.mockImplementation(async (ctx) => {
        receivedResults.push({ ...ctx.results });
        return { findings: [] };
      });
    }

    const emit = vi.fn();
    await runPipeline('run-6', '/fake/bundle', emit);

    // First step sees empty results
    expect(Object.keys(receivedResults[0])).toHaveLength(0);

    // Second step sees result from step 1
    expect(receivedResults[1]).toHaveProperty('01-ingest');

    // Last step sees results from all 7 preceding steps
    expect(Object.keys(receivedResults[7])).toHaveLength(7);
  });
});
