/**
 * FindingItem — renders a single pipeline finding.
 *
 * @param {{ finding: { severity: string, title: string, detail?: string, recommendation?: string } }} props
 */
function FindingItem({ finding }) {
  const { severity = 'info', title, detail, recommendation } = finding;

  return (
    <div className={`finding-item finding-item--${severity}`}>
      <span className={`finding-badge finding-badge--${severity}`}>{severity}</span>
      <div className="finding-body">
        <p className="finding-title">{title}</p>
        {detail && <p className="finding-detail">{detail}</p>}
        {recommendation && (
          <p className="finding-recommendation">
            <strong>Recommendation:</strong> {recommendation}
          </p>
        )}
      </div>
    </div>
  );
}

export default FindingItem;
