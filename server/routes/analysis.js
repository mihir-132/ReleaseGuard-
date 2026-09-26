/**
 * Analysis Router
 *
 * GET /api/analysis/:runId/stream
 *
 * Opens a Server-Sent Events connection and runs the analysis pipeline.
 * The pipeline starts only after the SSE connection headers are flushed,
 * so the client cannot miss any events.
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { runPipeline } from '../pipeline/index.js';

const router = Router();

// Derive the data/runs directory from this file's location.
const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '../..'
);
const RUNS_DIR = path.join(PROJECT_ROOT, 'data', 'runs');

/**
 * GET /api/analysis/:runId/stream
 *
 * Establishes an SSE stream for the given runId and immediately starts
 * the analysis pipeline. All step events are sent over the open connection.
 * A final `done` event is sent and the connection is closed when the
 * pipeline completes.
 */
router.get('/:runId/stream', async (req, res) => {
  const { runId } = req.params;

  // Locate the extracted bundle directory for this run.
  const runDir = path.join(RUNS_DIR, runId);
  if (!fs.existsSync(runDir)) {
    return res.status(404).json({ error: `Run not found: ${runId}` });
  }

  // Detect the bundle root (single top-level subdirectory inside runDir).
  const entries = fs.readdirSync(runDir);
  const bundlePath =
    entries.length === 1
      ? path.join(runDir, entries[0])
      : runDir;

  // --- Establish SSE connection ---
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Flush headers immediately so the client's EventSource is open before
  // the pipeline starts — this prevents any early events from being missed.
  res.flushHeaders();

  /**
   * Send a single SSE event.
   * @param {{ event: string, data: object }} eventObj
   */
  function emit({ event, data }) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // Clean up if the client disconnects early.
  let done = false;
  req.on('close', () => { done = true; });

  try {
    await runPipeline(runId, bundlePath, emit);
  } catch (err) {
    if (!done) {
      emit({ event: 'error', data: { message: err.message } });
    }
  }

  if (!done) {
    emit({ event: 'done', data: { runId } });
    res.end();
  }
});

export default router;
