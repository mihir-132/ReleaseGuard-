/**
 * ReadinessGauge — circular SVG gauge displaying 0–100% readiness.
 *
 * @param {{ value: number }} props  value is 0–100
 */
function ReadinessGauge({ value = 0 }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));

  // SVG circle geometry
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const progress = circumference - (clamped / 100) * circumference;

  // Colour based on readiness
  let color;
  if (clamped >= 80) color = '#22c55e';       // green
  else if (clamped >= 50) color = '#f59e0b';  // amber
  else color = '#ef4444';                      // red

  return (
    <div className="readiness-gauge" aria-label={`Readiness: ${clamped}%`}>
      <svg viewBox="0 0 120 120" className="readiness-gauge__svg">
        {/* Background track */}
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="var(--gauge-track, #2e303a)"
          strokeWidth="10"
        />
        {/* Progress arc */}
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={progress}
          strokeLinecap="round"
          transform="rotate(-90 60 60)"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="readiness-gauge__label">
        <span className="readiness-gauge__value" style={{ color }}>{clamped}%</span>
        <span className="readiness-gauge__sub">Readiness</span>
      </div>
    </div>
  );
}

export default ReadinessGauge;
