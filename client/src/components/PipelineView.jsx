import { useSSE } from '../hooks/useSSE.js';

/**
 * PipelineView — minimal component to display live pipeline events.
 *
 * Connects to the SSE stream for the given runId and logs/renders each
 * event as it arrives. This is a development-only view; polished UI
 * will be built in a later sub-task.
 *
 * @param {{ runId: string|null }} props
 */
function PipelineView({ runId }) {
  const { events, connected, error } = useSSE(runId);

  if (!runId) {
    return <p>No run selected.</p>;
  }

  return (
    <div>
      <p>
        Run: <code>{runId}</code> — {connected ? 'connected' : 'disconnected'}
      </p>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <ul>
        {events.map((e, i) => (
          <li key={i}>
            <strong>{e.event}</strong>: <code>{JSON.stringify(e.data)}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default PipelineView;
