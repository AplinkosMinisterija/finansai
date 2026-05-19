/**
 * Pjūvis pagal lėšų kategoriją (issue #6).
 *
 * Horizontalus bar chart su trim spalvomis per kategoriją: prašyta, patvirtinta,
 * atmesta (sumos eurais). Padeda matyt kur daugiausia pinigų eina/grįžta.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CostCategoryStats } from '@biip-finansai/shared';

export interface CostCategoryChartProps {
  data: CostCategoryStats[];
  height?: number;
}

function fmtShort(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(Math.round(value));
}

function fmtTooltip(value: number | string): string {
  const num = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(num)) return '0 €';
  return `${num.toLocaleString('lt-LT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

const SERIES_LABELS: Record<string, string> = {
  requested: 'Prašyta',
  approved: 'Patvirtinta',
  rejected: 'Atmesta',
};

export function CostCategoryChart({ data, height = 360 }: CostCategoryChartProps): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 24, left: 8, bottom: 0 }}
        barCategoryGap={12}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={fmtShort}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          width={130}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(value, name) => [fmtTooltip(value as number), SERIES_LABELS[String(name)] ?? String(name)]}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          formatter={(value: string) => SERIES_LABELS[value] ?? value}
        />
        <Bar dataKey="requested" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} />
        <Bar dataKey="approved" fill="hsl(var(--chart-success))" radius={[0, 3, 3, 0]} />
        <Bar dataKey="rejected" fill="hsl(var(--destructive))" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
