interface Props {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}

// One stat tile used in the dashboard's top row and consumption matrix.
// Shows a small label above and a large value below, plus an optional
// sub-line. The `accent` flag colors the value in the system-green
// brand colour (used for the headline Tracked-km tile).
export function KpiCard({ label, value, sub, accent }: Props) {
  return (
    <div className={`kpi ${accent ? 'kpi-accent' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
