/**
 * Statistikos puslapis — grafikai pagal vartotojo scope.
 *
 * Sekcijos:
 *  - Mėnesinis trendas (pateikta vs patvirtinta per 12 mėn)
 *  - Pagal būseną (donut)
 *  - Pagal organizaciją (tik AM) — Patvirtinta vs Prašyta €
 *  - Bendros sumos (cards)
 */
import { useQuery } from '@tanstack/react-query';
import { Activity, BarChart3, Layers, PieChart, TrendingDown, TrendingUp } from 'lucide-react';
import type { DashboardData } from '@biip-finansai/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MonthlyTrendChart } from '@/components/charts/MonthlyTrendChart';
import {
  StatusLegend,
  StatusPieChart,
} from '@/components/charts/StatusPieChart';
import { PerTenantBarChart } from '@/components/charts/PerTenantBarChart';
import { StatusCountAmountChart } from '@/components/charts/StatusCountAmountChart';
import { CostCategoryChart } from '@/components/charts/CostCategoryChart';
import { BudgetCategoryChart } from '@/components/charts/BudgetCategoryChart';
import { dashboardGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtEur } from '@/lib/requests';

export default function StatistikaPage(): JSX.Element {
  const { user } = useAuth();
  const q = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: () => dashboardGet(),
    staleTime: 30_000,
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
        <Skeleton className="h-12 w-1/2" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <Card className="mx-auto my-12 max-w-md">
        <CardContent className="p-6 text-center text-sm text-destructive">
          Nepavyko užkrauti statistikos.
        </CardContent>
      </Card>
    );
  }

  const d = q.data;
  const s = d.stats;
  const isApprover = user?.tenantIsApprover === true;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Statistika</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {d.year} m. apžvalga
          {!isApprover && user ? ` — ${user.tenantName}` : ''}
        </p>
      </div>

      {/* Suvestinė — money cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryCard
          icon={<Activity className="h-4 w-4" />}
          label={`Prašymai ${d.year} m.`}
          value={String(s.totalRequests)}
          hint="Iš viso"
        />
        <SummaryCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Prašoma"
          value={fmtEur(s.totalRequestedThisYear)}
          hint="Visi statusai"
          tone="primary"
        />
        <SummaryCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Skirta"
          value={fmtEur(s.totalApprovedThisYear)}
          hint={`${s.byStatus.APPROVED} patvirtinti`}
          tone="success"
        />
        <SummaryCard
          icon={<TrendingDown className="h-4 w-4" />}
          label="Atmesta"
          value={fmtEur(s.totalRejectedThisYear)}
          hint={`${s.byStatus.REJECTED} atmesti`}
          tone="destructive"
        />
        <SummaryCard
          icon={<Activity className="h-4 w-4" />}
          label="Vid. per patvirtintą"
          value={fmtEur(
            s.byStatus.APPROVED > 0
              ? s.totalApprovedThisYear / s.byStatus.APPROVED
              : 0,
          )}
          hint={s.byStatus.APPROVED > 0 ? 'Patvirtintų' : '—'}
        />
      </div>

      {/* Kiekis + suma per statusą — combo chart (#6) */}
      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4" />
            Pagal būseną — kiekiai ir sumos
          </h2>
          <StatusCountAmountChart
            data={[
              {
                status: 'SUBMITTED',
                label: 'Pateikti',
                count: s.byStatus.SUBMITTED,
                amount: s.amountsByStatus.SUBMITTED,
              },
              {
                status: 'RETURNED',
                label: 'Grąžinti',
                count: s.byStatus.RETURNED,
                amount: s.amountsByStatus.RETURNED,
              },
              {
                status: 'APPROVED',
                label: 'Patvirtinti',
                count: s.byStatus.APPROVED,
                amount: s.amountsByStatus.APPROVED,
              },
              {
                status: 'REJECTED',
                label: 'Atmesti',
                count: s.byStatus.REJECTED,
                amount: s.amountsByStatus.REJECTED,
              },
            ]}
            height={260}
          />
        </CardContent>
      </Card>

      {/* Pjūvis pagal lėšų kategoriją (#6) */}
      {d.costCategories.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Layers className="h-4 w-4" />
              Pagal lėšų kategoriją (€)
            </h2>
            <CostCategoryChart
              data={d.costCategories}
              height={Math.max(280, d.costCategories.length * 36 + 80)}
            />
          </CardContent>
        </Card>
      )}

      {/* Pjūvis pagal FVM biudžeto kategoriją (Iter 10, P06 docx §3.4) */}
      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Layers className="h-4 w-4" />
            Pagal biudžeto kategoriją (€)
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            FVM lygmens kategorija (du, spec.programa, prekės_paslaugos, ...).
            Į pjūvį įtraukti tik prašymai su nustatyta biudžeto kategorija.
          </p>
          <BudgetCategoryChart
            data={d.budgetCategoryStats}
            height={Math.max(
              260,
              d.budgetCategoryStats.length * 40 + 80,
            )}
          />
        </CardContent>
      </Card>

      {/* Monthly trend full-width */}
      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4" />
            12 mėn. dinamika
          </h2>
          <MonthlyTrendChart data={d.monthlyTrend} height={280} />
        </CardContent>
      </Card>

      {/* Status pie + summary side-by-side */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardContent className="p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <PieChart className="h-4 w-4" />
              Pagal būseną
            </h2>
            <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
              <StatusPieChart byStatus={s.byStatus} height={220} />
              <StatusLegend byStatus={s.byStatus} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4" />
              Naujausi įvykiai
            </h2>
            {d.recentActivity.length === 0 ? (
              <p className="text-xs text-muted-foreground">Įvykių dar nėra.</p>
            ) : (
              <ul className="space-y-2 text-xs" data-testid="stats-activity">
                {d.recentActivity.slice(0, 6).map((a, i) => (
                  <li
                    key={`${a.requestId}-${i}`}
                    className="border-l-2 border-primary/30 pl-2"
                  >
                    <div className="font-medium">{a.projectName}</div>
                    <div className="text-muted-foreground">
                      {a.tenantCode} · {a.kind}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Per-tenant chart — tik AM admin/specialistui */}
      {isApprover && d.perTenantBreakdown && d.perTenantBreakdown.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <BarChart3 className="h-4 w-4" />
              Pagal organizaciją (€)
            </h2>
            <PerTenantBarChart data={d.perTenantBreakdown} height={Math.max(240, d.perTenantBreakdown.length * 32 + 80)} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface SummaryCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'primary' | 'success' | 'destructive';
}

function SummaryCard({ icon, label, value, hint, tone = 'default' }: SummaryCardProps): JSX.Element {
  const toneCls = {
    default: '',
    primary: 'border-primary/40',
    success: 'border-emerald-500/40',
    destructive: 'border-destructive/40',
  }[tone];

  return (
    <Card className={toneCls}>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="mt-1.5 truncate text-xl font-semibold tabular-nums">
          {value}
        </div>
        {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
