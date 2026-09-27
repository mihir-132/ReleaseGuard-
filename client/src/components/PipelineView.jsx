import { useSSE, STEP_NAMES } from '../hooks/useSSE.js';
import StepCard from './StepCard.jsx';

/**
 * PipelineView — live pipeline progress display.
 *
 * Connects to the SSE stream for the given runId and renders all 8 steps,
 * updating each card as events arrive.
 *
 * @param {{ runId: string }} props
 */
function PipelineView({ runId }) {
  const { steps, isDone, connected, error } = useSSE(runId);

  return (
    <div className="pipeline-view">
      <div className="pipeline-view__header">
        <h2 className="pipeline-view__title">Analyzing Release</h2>
        <p className="pipeline-view__run-id">
          Run ID: <code>{runId}</code>
        </p>
        <div className="pipeline-view__status">
          {isDone ? (
            <span className="pipeline-status pipeline-status--done">✓ Analysis complete</span>
          ) : connected ? (
            <span className="pipeline-status pipeline-status--running">● Running…</span>
          ) : error ? (
            <span className="pipeline-status pipeline-status--error">✕ {error}</span>
          ) : (
            <span className="pipeline-status pipeline-status--connecting">Connecting…</span>
          )}
        </div>
      </div>

      {error && !isDone && (
        <p className="pipeline-view__error" role="alert">{error}</p>
      )}

      <div className="pipeline-steps">
        {STEP_NAMES.map((name, index) => {
          const step = steps[name];
          return (
            <StepCard
              key={name}
              name={name}
              index={index}
              status={step.status}
              findings={step.findings}
              severity={step.severity}
            />
          );
        })}
      </div>
    </div>
  );
}

export default PipelineView;
