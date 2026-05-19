/**
 * Combo: paraiškų kiekis pagal statusą + atitinkamos sumos (issue #6).
 *
 * Bar — kiekis (left Y-axis), Line — suma (right Y-axis).
 * Padaro dvilypę perspektyvą: kiek paraiškų ir kiek pinigų jose.
 */
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface StatusCountAmountPoint {
  status: string;
  label: string;
  count: number;
  amount: number;
}

export interface StatusCountAmountChartProps {
  data: StatusCountAmountPoint[];
  height?: number;
}

function fmtShort(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(Math.round(value));
}

function fmtAmountTooltip(value: number | string): string {
  const num = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(num)) return '0 €';
  return `${num.toLocaleString('lt-LT', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} €`;
}

export function StatusCountAmountChart({
  data,
  height = 260,
}: StatusCountAmountChartProps): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          yAxisId="count"
          allowDecimals={false}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          width={32}
        />
        <YAxis
          yAxisId="amount"
          orientation="right"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          width={50}
          tickFormatter={fmtShort}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(value, name) => {
            if (name === 'amount') return [fmtAmountTooltip(value as number), 'Suma'];
            return [String(value), 'Kiekis'];
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          formatter={(value: string) => (value === 'amount' ? 'Suma €' : 'Kiekis')}
        />
        <Bar
          yAxisId="count"
          dataKey="count"
          fill="hsl(var(--primary))"
          radius={[3, 3, 0, 0]}
        />
        <Line
          yAxisId="amount"
          type="monotone"
          dataKey="amount"
          stroke="hsl(var(--chart-success))"
          strokeWidth={2}
          dot={{ r: 4 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
