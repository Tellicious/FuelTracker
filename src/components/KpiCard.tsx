interface Props {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}

export function KpiCard({ label, value, sub, accent }: Props) {
  return (
    <div className={`kpi ${accent ? 'kpi-accent' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
