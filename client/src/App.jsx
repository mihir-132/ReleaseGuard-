import { useState } from 'react';
import UploadPanel from './components/UploadPanel.jsx';
import PipelineView from './components/PipelineView.jsx';
import ReportView from './components/ReportView.jsx';
import PastReports from './components/PastReports.jsx';
import { useSSE } from './hooks/useSSE.js';
import { useReport } from './hooks/useReport.js';
import './App.css';

// ─── PastReportContent ────────────────────────────────────────────────────────
// Displays a previously generated report without opening any SSE connection.
// Uses useReport to fetch the persisted JSON directly from /api/reports/:runId.
function PastReportContent({ runId, onReset, onBackToList }) {
  const { report, loading, error } = useReport(runId);

  return (
    <div className="app-content">
      <header className="app-header">
        <span className="app-logo">🛡</span>
        <span className="app-brand">ReleaseGuard</span>
        <button className="btn-ghost" onClick={onBackToList}>
          ← Past Reports
        </button>
        <button className="btn-reset" onClick={onReset} title="Start new analysis">
          ✕ New Analysis
        </button>
      </header>

      <main className="app-main">
        {loading && (
          <div className="report-view report-view--loading">
            <p>Loading report…</p>
          </div>
        )}
        {!loading && error && (
          <div className="report-view report-view--error">
            <p className="report-error" role="alert">Report error: {error}</p>
          </div>
        )}
        {!loading && !error && report && (
          <ReportView runId={runId} />
        )}
        {!loading && !error && !report && (
          <div className="report-view report-view--error">
            <p className="report-error" role="alert">Report data is unavailable.</p>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── AppContent ───────────────────────────────────────────────────────────────
// Active analysis view: SSE pipeline + report once done.
function AppContent({ runId, onReset }) {
  const { isDone, error: sseError } = useSSE(runId);

  return (
    <div className="app-content">
      <header className="app-header">
        <span className="app-logo">🛡</span>
        <span className="app-brand">ReleaseGuard</span>
        <button className="btn-reset" onClick={onReset} title="Start new analysis">
          ✕ New Analysis
        </button>
      </header>

      <main className="app-main">
        <PipelineView runId={runId} />
        {sseError && !isDone && (
          <div className="sse-error-banner" role="alert">
            Analysis error: {sseError}
          </div>
        )}
        {isDone && <ReportView runId={runId} />}
      </main>
    </div>
  );
}

// ─── UploadView ───────────────────────────────────────────────────────────────
// Landing page: upload form + link to past reports.
function UploadView({ onUpload, onViewPastReports }) {
  return (
    <div className="app-upload">
      <div className="upload-panel-wrapper">
        <UploadPanel onUpload={onUpload} />
        <div className="upload-past-link">
          <button className="btn-text-link" onClick={onViewPastReports}>
            View past reports →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PastReportsView ──────────────────────────────────────────────────────────
// Full-page past-reports list.
function PastReportsView({ onSelect, onBack }) {
  return (
    <div className="app-content">
      <header className="app-header">
        <span className="app-logo">🛡</span>
        <span className="app-brand">ReleaseGuard</span>
        <button className="btn-reset" onClick={onBack} title="Back to upload">
          ← New Analysis
        </button>
      </header>
      <main className="app-main">
        <PastReports onSelect={onSelect} />
      </main>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

/**
 * App view modes:
 *   'upload'       — landing / new analysis (UploadPanel + link to past reports)
 *   'analysis'     — active SSE pipeline + report (AppContent)
 *   'past-list'    — list of past reports (PastReportsView)
 *   'past-report'  — single past report view, NO SSE (PastReportContent)
 */
function App() {
  const [view, setView] = useState('upload');
  // runId is set during an active analysis OR when browsing a past report.
  const [runId, setRunId] = useState(null);

  const handleUpload = (id) => {
    setRunId(id);
    setView('analysis');
  };

  const handleReset = () => {
    setRunId(null);
    setView('upload');
  };

  const handleViewPastReports = () => {
    setRunId(null);
    setView('past-list');
  };

  const handleSelectPastReport = (id) => {
    setRunId(id);
    setView('past-report');
  };

  if (view === 'analysis') {
    return <AppContent runId={runId} onReset={handleReset} />;
  }

  if (view === 'past-list') {
    return (
      <PastReportsView
        onSelect={handleSelectPastReport}
        onBack={handleReset}
      />
    );
  }

  if (view === 'past-report') {
    return (
      <PastReportContent
        runId={runId}
        onReset={handleReset}
        onBackToList={handleViewPastReports}
      />
    );
  }

  // Default: 'upload'
  return (
    <UploadView
      onUpload={handleUpload}
      onViewPastReports={handleViewPastReports}
    />
  );
}

export default App;
