import { useState } from 'react';
import { STEP_LABELS } from '../hooks/useSSE.js';
import FindingItem from './FindingItem.jsx';

/** Spinner SVG — lightweight, no external dependency. */
function Spinner() {
  return (
    <svg className="spinner" viewBox="0 0 24 24" aria-label="Loading" role="img">
      <circle cx="12" cy="12" r="10" fill="none" strokeWidth="3" />
    </svg>
  );
}

/** Severity → display label map */
const SEVERITY_LABEL = {
  critical: '🔴 Critical',
  warning:  '🟡 Warning',
  info:     '🔵 Info',
  ok:       '🟢 OK',
};

/**
 * StepCard — displays the state of a single pipeline step.
 *
 * @param {{
 *   name:     string,
 *   index:    number,
 *   status:   'pending'|'running'|'complete'|'error',
 *   findings: Array,
 *   severity: string|null,
 * }} props
 */
function StepCard({ name, index, status, findings = [], severity }) {
  const [expanded, setExpanded] = useState(false);
  const label    = STEP_LABELS[name] ?? name;
  const hasItems = findings.length > 0;

  // Derive severity from findings if not provided by the backend yet.
  const effectiveSeverity = severity ?? (hasItems ? findings[0]?.severity : null);

  return (
    <div className={`step-card step-card--${status}`}>
      <div className="step-card__header">
        <span className="step-card__number">{String(index + 1).padStart(2, '0')}</span>
        <span className="step-card__label">{label}</span>

        <div className="step-card__right">
          {status === 'running' && <Spinner />}
          {status === 'complete' && effectiveSeverity && (
            <span className={`severity-badge severity-badge--${effectiveSeverity}`}>
              {SEVERITY_LABEL[effectiveSeverity] ?? effectiveSeverity}
            </span>
          )}
          {status === 'complete' && hasItems && (
            <button
              className="step-card__toggle"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {findings.length} finding{findings.length !== 1 ? 's' : ''}{' '}
              {expanded ? '▲' : '▼'}
            </button>
          )}
          {status === 'complete' && !hasItems && (
            <span className="step-card__ok">✓ No issues</span>
          )}
          {status === 'error' && (
            <span className="severity-badge severity-badge--critical">Error</span>
          )}
        </div>
      </div>

      {expanded && hasItems && (
        <div className="step-card__findings">
          {findings.map((f, i) => (
            <FindingItem key={i} finding={f} />
          ))}
        </div>
      )}
    </div>
  );
}

export default StepCard;
