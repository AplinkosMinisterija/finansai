/**
 * Per-organizacija bar chart — patvirtinta vs prašyta (€).
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
import type { DashboardPerTenantStats } from '@biip-finansai/shared';
import { fmtEur } from '@/lib/requests';

export interface PerTenantBarChartProps {
  data: DashboardPerTenantStats[];
  height?: number;
}

export function PerTenantBarChart({ data, height = 320 }: PerTenantBarChartProps): JSX.Element {
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

  // Suri'kiuojam pagal totalRequested mažėjančiai
  const sorted = [...data].sort((a, b) => b.totalRequested - a.totalRequested);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={sorted}
        layout="vertical"
        margin={{ top: 8, right: 16, left: 32, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          tickFormatter={(v) => fmtEur(v)}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="tenantCode"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(value, name) => [
            fmtEur(Number(value)),
            name === 'totalRequested' ? 'Prašyta' : 'Patvirtinta',
          ]}
          labelFormatter={(label) => {
            const code = String(label);
            const item = sorted.find((d) => d.tenantCode === code);
            return item ? `${item.tenantCode} — ${item.tenantName}` : code;
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          formatter={(value: string) => (value === 'totalRequested' ? 'Prašyta' : 'Patvirtinta')}
        />
        <Bar dataKey="totalRequested" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} />
        <Bar dataKey="totalApproved" fill="hsl(var(--chart-success))" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
