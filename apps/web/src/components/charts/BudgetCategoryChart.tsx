/**
 * Pjūvis pagal biudžeto kategoriją (FVM Iter 10, docx §3.4 / P06).
 *
 * Horizontalus bar chart su trim spalvomis per kategoriją:
 *  - Prašyta (totalRequested) — primary spalva
 *  - Patvirtinta (totalGranted) — success spalva
 *
 * Naudoja `budgetCategoryStats` iš `DashboardData`. Empty state — kai
 * dataset'as tuščias (visi prašymai be FVM laukų arba viso neturi prašymų).
 *
 * Skiriasi nuo `CostCategoryChart`:
 *  - `BudgetCategoryChart` — FVM lygmens kategorija (du / spec_programa / ...)
 *  - `CostCategoryChart` — cost field-based (costDu / costEquipment / ...)
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
import type { BudgetCategoryStats } from '@biip-finansai/shared';

export interface BudgetCategoryChartProps {
  data: BudgetCategoryStats[];
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
  totalRequested: 'Prašyta',
  totalGranted: 'Patvirtinta',
};

interface ChartRow {
  categoryItemId: number;
  categoryCode: string;
  categoryName: string;
  totalRequested: number;
  totalGranted: number;
  count: number;
}

function toChartRows(data: BudgetCategoryStats[]): ChartRow[] {
  return data.map((d) => ({
    categoryItemId: d.categoryItemId,
    categoryCode: d.categoryCode,
    categoryName: d.categoryName,
    totalRequested: Number.parseFloat(d.totalRequested) || 0,
    totalGranted: Number.parseFloat(d.totalGranted) || 0,
    count: d.count,
  }));
}

export function BudgetCategoryChart({
  data,
  height = 320,
}: BudgetCategoryChartProps): JSX.Element {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-border bg-muted/20 p-8 text-sm text-muted-foreground"
        data-testid="budget-category-empty"
        style={{ minHeight: Math.min(160, height) }}
      >
        Nėra duomenų
      </div>
    );
  }

  const rows = toChartRows(data);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 8, right: 24, left: 8, bottom: 0 }}
        barCategoryGap={12}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="hsl(var(--border))"
          horizontal={false}
        />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={fmtShort}
        />
        <YAxis
          type="category"
          dataKey="categoryName"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          width={150}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(value, name) => [
            fmtTooltip(value as number),
            SERIES_LABELS[String(name)] ?? String(name),
          ]}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          formatter={(value: string) => SERIES_LABELS[value] ?? value}
        />
        <Bar
          dataKey="totalRequested"
          fill="hsl(var(--primary))"
          radius={[0, 3, 3, 0]}
        />
        <Bar
          dataKey="totalGranted"
          fill="hsl(var(--chart-success))"
          radius={[0, 3, 3, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
