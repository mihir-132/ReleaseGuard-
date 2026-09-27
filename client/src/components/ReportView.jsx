import ReactMarkdown from 'react-markdown';
import { useReport } from '../hooks/useReport.js';
import ReadinessGauge from './ReadinessGauge.jsx';
import FindingItem from './FindingItem.jsx';

const SEVERITY_ORDER = ['critical', 'warning', 'info', 'ok'];

const SEVERITY_SECTION_LABEL = {
  critical: '🔴 Critical Findings',
  warning:  '🟡 Warnings',
  info:     '🔵 Informational',
  ok:       '🟢 OK',
};

/**
 * Collect all findings from all steps and group them by severity.
 *
 * @param {object} steps - report.steps map
 * @returns {Record<string, Array>}
 */
function groupFindingsBySeverity(steps) {
  const groups = { critical: [], warning: [], info: [], ok: [] };
  if (!steps) return groups;

  for (const step of Object.values(steps)) {
    if (!Array.isArray(step.findings)) continue;
    for (const f of step.findings) {
      const sev = f.severity ?? 'info';
      if (groups[sev]) groups[sev].push(f);
      else groups.info.push(f);
    }
  }

  return groups;
}

/**
 * Trigger a browser download of the report JSON.
 */
function downloadReport(report, runId) {
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: 'application/json',
  });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `releaseguard-report-${runId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * ReportView — full report display rendered after pipeline completion.
 *
 * @param {{ runId: string }} props
 */
function ReportView({ runId }) {
  const { report, loading, error } = useReport(runId);

  if (loading) {
    return (
      <div className="report-view report-view--loading">
        <p>Loading report…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="report-view report-view--error">
        <p className="report-error" role="alert">Report error: {error}</p>
      </div>
    );
  }

  if (!report) return null;

  const { manifest, overallReadiness, overallSeverity, steps, releaseNotes, runId: rId, generatedAt } = report;
  const findings = groupFindingsBySeverity(steps);
  const effectiveRunId = rId ?? runId;

  return (
    <div className="report-view">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="report-header">
        <div className="report-header__meta">
          <h2 className="report-header__title">Release Report</h2>
          {manifest && (
            <p className="report-header__app">
              <strong>{manifest.name}</strong>{' '}
              <span className="report-version">v{manifest.version}</span>
            </p>
          )}
          {generatedAt && (
            <p className="report-header__date">
              Generated: {new Date(generatedAt).toLocaleString()}
            </p>
          )}
        </div>

        <div className="report-header__gauge">
          <ReadinessGauge value={overallReadiness} />
          {overallSeverity && (
            <span className={`severity-badge severity-badge--${overallSeverity} report-severity`}>
              Overall: {overallSeverity}
            </span>
          )}
        </div>
      </div>

      {/* ── Findings by severity ───────────────────────────────────── */}
      {SEVERITY_ORDER.map((sev) => {
        const items = findings[sev];
        if (!items || items.length === 0) return null;
        return (
          <section key={sev} className="report-section">
            <h3 className="report-section__title">{SEVERITY_SECTION_LABEL[sev]}</h3>
            <div className="report-section__findings">
              {items.map((f, i) => (
                <FindingItem key={i} finding={f} />
              ))}
            </div>
          </section>
        );
      })}

      {/* ── AI Release Notes ──────────────────────────────────────── */}
      {releaseNotes && (
        <section className="report-section report-section--notes">
          <h3 className="report-section__title">AI Release Notes</h3>
          <div className="report-markdown">
            <ReactMarkdown>{releaseNotes}</ReactMarkdown>
          </div>
        </section>
      )}

      {/* ── Download ──────────────────────────────────────────────── */}
      <div className="report-actions">
        <button
          className="btn-download"
          onClick={() => downloadReport(report, effectiveRunId)}
        >
          ↓ Download Report JSON
        </button>
      </div>
    </div>
  );
}

export default ReportView;
