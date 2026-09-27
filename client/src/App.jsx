import { useState } from 'react';
import UploadPanel from './components/UploadPanel.jsx';
import PipelineView from './components/PipelineView.jsx';
import ReportView from './components/ReportView.jsx';
import { useSSE } from './hooks/useSSE.js';
import './App.css';

/**
 * AppContent — inner component that owns pipeline/report state.
 * Separated so that useSSE only runs once a runId exists.
 */
function AppContent({ runId, onReset }) {
  const { isDone } = useSSE(runId);

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
        {isDone && <ReportView runId={runId} />}
      </main>
    </div>
  );
}

function App() {
  const [runId, setRunId] = useState(null);

  if (!runId) {
    return (
      <div className="app-upload">
        <UploadPanel onUpload={setRunId} />
      </div>
    );
  }

  return <AppContent runId={runId} onReset={() => setRunId(null)} />;
}

export default App;
