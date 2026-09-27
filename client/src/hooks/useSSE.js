import { useState, useEffect } from 'react';

/** Ordered step names as emitted by the backend pipeline. */
export const STEP_NAMES = [
  '01-ingest',
  '02-diff',
  '03-dependencies',
  '04-env-config',
  '05-migrations',
  '06-test-gap',
  '07-deployment',
  '08-report',
];

/** Human-readable labels for each pipeline step. */
export const STEP_LABELS = {
  '01-ingest':       'Ingest Bundle',
  '02-diff':         'Diff Analysis',
  '03-dependencies': 'Dependency Check',
  '04-env-config':   'Env & Config',
  '05-migrations':   'DB Migrations',
  '06-test-gap':     'Test Coverage',
  '07-deployment':   'Deployment Checklist',
  '08-report':       'Report Generation',
};

/** Initial per-step state. */
function initialSteps() {
  return Object.fromEntries(
    STEP_NAMES.map((name) => [
      name,
      { status: 'pending', findings: [], severity: null, data: {} },
    ])
  );
}

/**
 * useSSE — connect to the analysis SSE stream for a given runId.
 *
 * Opens an EventSource to /api/analysis/:runId/stream and parses every
 * incoming JSON payload. Cleans up (closes the connection) when the
 * component unmounts or the runId changes.
 *
 * @param {string|null} runId - The run identifier. Pass null/undefined to
 *   keep the hook idle (no connection opened).
 *
 * @returns {{
 *   events:    Array<{ event: string, data: object }>,
 *   steps:     Record<string, { status: string, findings: Array, severity: string|null, data: object }>,
 *   isDone:    boolean,
 *   connected: boolean,
 *   error:     string|null,
 * }}
 */
export function useSSE(runId) {
  const [events, setEvents] = useState([]);
  const [steps, setSteps] = useState(initialSteps);
  const [isDone, setIsDone] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!runId) return;

    setEvents([]);
    setSteps(initialSteps());
    setIsDone(false);
    setConnected(false);
    setError(null);

    const source = new EventSource(`/api/analysis/${runId}/stream`);

    source.onopen = () => {
      setConnected(true);
    };

    /**
     * Generic unnamed message — kept for backwards compatibility.
     */
    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setEvents((prev) => [...prev, { event: 'message', data }]);
      } catch {
        // Ignore non-JSON messages.
      }
    };

    // Handle named SSE events: step, done, error.
    source.addEventListener('step', (e) => {
      try {
        const data = JSON.parse(e.data);
        setEvents((prev) => [...prev, { event: 'step', data }]);

        // Update per-step state.
        setSteps((prev) => {
          const name = data.step;
          if (!name) return prev;
          return {
            ...prev,
            [name]: {
              status:   data.status ?? 'running',
              findings: data.findings ?? prev[name]?.findings ?? [],
              severity: data.severity ?? prev[name]?.severity ?? null,
              data:     data,
            },
          };
        });
      } catch {
        // Ignore non-JSON payloads.
      }
    });

    source.addEventListener('done', (e) => {
      try {
        const data = JSON.parse(e.data);
        setEvents((prev) => [...prev, { event: 'done', data }]);
      } catch {
        // best-effort
      }
      setIsDone(true);
      setConnected(false);
      source.close();
    });

    source.addEventListener('error', (e) => {
      try {
        const data = JSON.parse(e.data);
        setEvents((prev) => [...prev, { event: 'error', data }]);
        setError(data.message ?? 'Pipeline error');
      } catch {
        setError('Pipeline error');
      }
    });

    source.onerror = () => {
      setConnected(false);
      setError('SSE connection error');
      source.close();
    };

    // Cleanup: close the EventSource when the component unmounts or runId changes.
    return () => {
      source.close();
      setConnected(false);
    };
  }, [runId]);

  return { events, steps, isDone, connected, error };
}

export default useSSE;
