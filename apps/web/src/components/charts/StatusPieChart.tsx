/**
 * Donut chart — prašymai pagal būseną.
 */
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { RequestStatus } from '@biip-finansai/shared';
import { STATUS_LABELS } from '@/lib/requests';

export interface StatusPieChartProps {
  byStatus: Record<RequestStatus, number>;
  height?: number;
}

interface Slice {
  status: RequestStatus;
  label: string;
  value: number;
  color: string;
}

const STATUS_COLORS: Record<RequestStatus, string> = {
  DRAFT: 'hsl(var(--muted-foreground))',
  SUBMITTED: 'hsl(var(--primary))',
  RETURNED: 'hsl(var(--chart-warning))',
  APPROVED: 'hsl(var(--chart-success))',
  REJECTED: 'hsl(var(--destructive))',
};

export function StatusPieChart({ byStatus, height = 240 }: StatusPieChartProps): JSX.Element {
  const data: Slice[] = (Object.keys(byStatus) as RequestStatus[])
    .filter((s) => byStatus[s] > 0)
    .map((s) => ({
      status: s,
      label: STATUS_LABELS[s],
      value: byStatus[s],
      color: STATUS_COLORS[s],
    }));

  if (data.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-xs text-muted-foreground"
      >
        Duomenų dar nėra.
      </div>
    );
  }

  const total = data.reduce((acc, d) => acc + d.value, 0);

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={48}
            outerRadius={84}
            paddingAngle={2}
          >
            {data.map((slice) => (
              <Cell key={slice.status} fill={slice.color} stroke="hsl(var(--background))" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 6,
              fontSize: 12,
            }}
            formatter={(value, name) => {
              const n = Number(value);
              return [`${n} (${Math.round((n / total) * 100)}%)`, String(name)];
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* Centre total */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-semibold tabular-nums">{total}</div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          iš viso
        </div>
      </div>
    </div>
  );
}

export function StatusLegend({ byStatus }: { byStatus: Record<RequestStatus, number> }): JSX.Element {
  const items = (Object.keys(byStatus) as RequestStatus[])
    .filter((s) => byStatus[s] > 0)
    .map((s) => ({ status: s, label: STATUS_LABELS[s], value: byStatus[s], color: STATUS_COLORS[s] }));

  if (items.length === 0) return <></>;

  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((it) => (
        <li key={it.status} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: it.color }} />
          <span className="flex-1 text-muted-foreground">{it.label}</span>
          <span className="font-medium tabular-nums">{it.value}</span>
        </li>
      ))}
    </ul>
  );
}
