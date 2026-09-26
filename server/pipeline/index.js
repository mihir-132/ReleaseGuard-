/**
 * Pipeline Orchestrator
 *
 * runPipeline(runId, emit) executes steps 01–08 in sequence.
 * Each step receives a shared context object and the emit function.
 * Events are emitted as the pipeline progresses.
 *
 * @typedef {Object} PipelineContext
 * @property {string}   runId       - Unique run identifier
 * @property {string}   bundlePath  - Absolute path to the extracted bundle root
 * @property {object|null} manifest - Parsed manifest.json (populated by step 01)
 * @property {function} emit        - SSE emit function: emit(eventObj)
 * @property {Object}   results     - Accumulated step results keyed by step name
 */

import step01 from './steps/01-ingest.js';
import step02 from './steps/02-diff.js';
import step03 from './steps/03-dependencies.js';
import step04 from './steps/04-env-config.js';
import step05 from './steps/05-migrations.js';
import step06 from './steps/06-test-gap.js';
import step07 from './steps/07-deployment.js';
import step08 from './steps/08-report.js';

/** Ordered pipeline step definitions. */
const STEPS = [
  { name: '01-ingest',      fn: step01 },
  { name: '02-diff',        fn: step02 },
  { name: '03-dependencies',fn: step03 },
  { name: '04-env-config',  fn: step04 },
  { name: '05-migrations',  fn: step05 },
  { name: '06-test-gap',    fn: step06 },
  { name: '07-deployment',  fn: step07 },
  { name: '08-report',      fn: step08 },
];

/**
 * Run the full analysis pipeline.
 *
 * @param {string}   runId      - Unique run identifier
 * @param {string}   bundlePath - Absolute path to the extracted bundle root
 * @param {function} emit       - SSE emit callback: emit({ event, data })
 * @returns {Promise<Object>}   - Accumulated results from all steps
 */
export async function runPipeline(runId, bundlePath, emit) {
  /** @type {PipelineContext} */
  const ctx = {
    runId,
    bundlePath,
    manifest: null,
    emit,
    results: {},
  };

  for (const { name, fn } of STEPS) {
    // Notify the client the step is starting.
    emit({ event: 'step', data: { step: name, status: 'running' } });

    const result = await fn(ctx);

    // Store the result in the shared context so later steps can read it.
    ctx.results[name] = result;

    // Notify the client the step finished.
    emit({
      event: 'step',
      data: {
        step: name,
        status: 'complete',
        findings: result.findings ?? [],
      },
    });
  }

  return ctx.results;
}
