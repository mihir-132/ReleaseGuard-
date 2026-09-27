/**
 * Reports Router
 *
 * GET /api/reports/:runId  — return the full persisted report JSON
 * GET /api/reports         — return report summaries
 */

import { Router } from 'express';
import { readReport, listReports } from '../storage/reports.js';

const router = Router();

/**
 * GET /api/reports/:runId
 *
 * Returns the full JSON report for the given runId.
 * Responds 404 when no such report exists.
 */
router.get('/:runId', (req, res) => {
  const { runId } = req.params;
  const result    = readReport(runId);

  if (!result.ok) {
    return res.status(404).json({ error: result.error });
  }

  return res.json(result.report);
});

/**
 * GET /api/reports
 *
 * Returns an array of report summaries:
 *   [{ runId, generatedAt, name, version, overallReadiness }]
 */
router.get('/', (_req, res) => {
  const summaries = listReports();
  return res.json(summaries);
});

export default router;
