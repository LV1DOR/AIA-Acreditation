import { cn } from "../lib/utils.ts";

type ChartDatum = Record<string, string | number>;

export function DonutChart({ data, className, variant = "donut", category, value, valueFormatter = String, totalLabel, emptyLabel }: {
  data: ChartDatum[];
  className?: string;
  variant?: "pie" | "donut";
  category: string;
  value: string;
  valueFormatter?: (value: number) => string;
  totalLabel?: string;
  emptyLabel: string;
}) {
  const rows = data.map(row => ({ name: String(row[category]), amount: Number(row[value]) })).filter(row => row.amount > 0);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const colors = ["#d71931", "#171c22", "#686f78", "#949aa2", "#bec2c7", "#e1e3e6"];
  const radius = 39;
  const circumference = 2 * Math.PI * radius;
  let cursor = 0;
  if (!total) return <p className={cn("ops-empty-inline", className)}>{emptyLabel}</p>;
  return <div className={cn("donut-chart", className)}>
    <div className="donut-chart-plot">
      <svg viewBox="0 0 100 100" role="img" aria-label={rows.map(row => `${row.name}: ${valueFormatter(row.amount)}`).join(", ")}>
        <circle className="donut-chart-track" cx="50" cy="50" r={radius} fill="none" strokeWidth={variant === "pie" ? 78 : 18}/>
        {rows.map((row, index) => {
          const length = row.amount / total * circumference;
          const offset = -cursor;
          cursor += length;
          return <circle className="donut-chart-segment" key={row.name} cx="50" cy="50" r={radius} fill="none" stroke={colors[index % colors.length]} strokeWidth={variant === "pie" ? 78 : 18} strokeDasharray={`${Math.max(0, length - 1)} ${circumference - Math.max(0, length - 1)}`} strokeDashoffset={offset} transform="rotate(-90 50 50)"><title>{`${row.name}: ${valueFormatter(row.amount)} (${Math.round(row.amount / total * 100)}%)`}</title></circle>;
        })}
      </svg>
      {variant === "donut" && <span><strong>{valueFormatter(total)}</strong><small>{totalLabel}</small></span>}
    </div>
    <ul className="ops-chart-legend">{rows.map((row, index) => <li key={row.name}><i style={{ backgroundColor: colors[index % colors.length] }}/><span title={row.name}>{row.name}</span><strong>{valueFormatter(row.amount)}</strong><small>{Math.round(row.amount / total * 100)}%</small></li>)}</ul>
  </div>;
}
