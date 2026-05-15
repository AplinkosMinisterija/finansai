/**
 * Mėnesinis trendas — pateikti vs patvirtinti per 12 mėn.
 *
 * Du barai per mėnesį (submitted, approved). Custom tooltip su LT label'ais.
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

export interface MonthlyTrendPoint {
  month: string; // YYYY-MM
  submitted: number;
  approved: number;
}

export interface MonthlyTrendChartProps {
  data: MonthlyTrendPoint[];
  height?: number;
  compact?: boolean;
}

const MONTH_LABELS = [
  'Sau', 'Vas', 'Kov', 'Bal', 'Geg', 'Bir',
  'Lie', 'Rgp', 'Rgs', 'Spa', 'Lap', 'Grd',
];

function formatMonth(value: string): string {
  const [y, m] = value.split('-');
  const monthIdx = Number(m) - 1;
  if (!Number.isFinite(monthIdx) || monthIdx < 0 || monthIdx > 11) return value;
  return `${MONTH_LABELS[monthIdx]} ${y?.slice(2)}`;
}

export function MonthlyTrendChart({
  data,
  height = 240,
  compact = false,
}: MonthlyTrendChartProps): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="month"
          tickFormatter={formatMonth}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          width={32}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 6,
            fontSize: 12,
          }}
          labelFormatter={(value) => formatMonth(String(value))}
          formatter={(value, name) => [
            String(value),
            name === 'submitted' ? 'Pateikta' : 'Patvirtinta',
          ]}
        />
        {!compact && (
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            formatter={(value: string) => (value === 'submitted' ? 'Pateikta' : 'Patvirtinta')}
          />
        )}
        <Bar dataKey="submitted" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
        <Bar dataKey="approved" fill="hsl(var(--chart-success))" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
