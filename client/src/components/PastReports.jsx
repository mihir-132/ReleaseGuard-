import { useState, useEffect } from 'react';

/**
 * PastReports — fetches GET /api/reports and renders a selectable list
 * of previously generated reports.
 *
 * @param {{ onSelect: (runId: string) => void }} props
 */
function PastReports({ onSelect }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    fetch('/api/reports')
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error || `Failed to load reports (HTTP ${res.status})`);
        }
        return json;
      })
      .then((data) => {
        // Sort newest-first by generatedAt
        const sorted = [...data].sort((a, b) => {
          if (!a.generatedAt) return 1;
          if (!b.generatedAt) return -1;
          return new Date(b.generatedAt) - new Date(a.generatedAt);
        });
        setReports(sorted);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="past-reports past-reports--loading">
        <p className="past-reports__status">Loading past reports…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="past-reports past-reports--error">
        <p className="past-reports__status past-reports__error" role="alert">
          Could not load reports: {error}
        </p>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="past-reports past-reports--empty">
        <p className="past-reports__status past-reports__empty">No past reports found.</p>
      </div>
    );
  }

  return (
    <div className="past-reports">
      <h2 className="past-reports__title">Past Reports</h2>
      <ul className="past-reports__list" role="list">
        {reports.map((r) => {
          const label =
            r.name && r.version
              ? `${r.name} v${r.version}`
              : r.name || r.runId;

          const date = r.generatedAt
            ? new Date(r.generatedAt).toLocaleString()
            : 'Unknown date';

          const readiness =
            r.overallReadiness != null ? `${r.overallReadiness}%` : '—';

          return (
            <li key={r.runId} className="past-reports__item">
              <button
                className="past-reports__btn"
                onClick={() => onSelect(r.runId)}
                title={`View report for run ${r.runId}`}
              >
                <span className="past-reports__name">{label}</span>
                <span className="past-reports__meta">
                  <span className="past-reports__date">{date}</span>
                  <span className="past-reports__readiness">{readiness} ready</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default PastReports;
