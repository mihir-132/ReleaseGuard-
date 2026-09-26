import { useState, useEffect } from 'react';

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
 *   events: Array<{ event: string, data: object }>,
 *   connected: boolean,
 *   error: string|null,
 * }}
 */
export function useSSE(runId) {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!runId) return;

    setEvents([]);
    setConnected(false);
    setError(null);

    const source = new EventSource(`/api/analysis/${runId}/stream`);

    source.onopen = () => {
      setConnected(true);
    };

    /**
     * Generic message handler — called for events that have a named `event`
     * field. We listen to all named events by overriding `addEventListener`
     * for each type we care about, but for simplicity we also handle the
     * raw `message` event in case the server sends unnamed events.
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
    for (const eventName of ['step', 'done', 'error']) {
      source.addEventListener(eventName, (e) => {
        try {
          const data = JSON.parse(e.data);
          setEvents((prev) => [...prev, { event: eventName, data }]);
        } catch {
          // Ignore non-JSON payloads.
        }
      });
    }

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

  return { events, connected, error };
}

export default useSSE;
