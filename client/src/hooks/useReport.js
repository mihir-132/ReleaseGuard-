import { useState, useEffect } from 'react';

/**
 * useReport — fetch the full report JSON for a completed run.
 *
 * @param {string|null} runId - The run identifier. Pass null to keep idle.
 * @returns {{ report: object|null, loading: boolean, error: string|null }}
 */
export function useReport(runId) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!runId) return;

    setReport(null);
    setLoading(true);
    setError(null);

    fetch(`/api/reports/${runId}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error || `Report fetch failed (HTTP ${res.status})`);
        }
        return json;
      })
      .then((data) => {
        setReport(data);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [runId]);

  return { report, loading, error };
}

export default useReport;
