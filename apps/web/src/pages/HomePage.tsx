import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileEdit,
  FileText,
  Inbox,
  Plus,
  Users,
  XCircle,
  Clock,
  Wallet,
  PiggyBank,
  Activity,
  CornerUpLeft,
} from 'lucide-react';
import type {
  DashboardActivityItem,
  DashboardData,
  FinancingRequest,
} from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MonthlyTrendChart } from '@/components/charts/MonthlyTrendChart';
import { useAuth } from '@/lib/auth';
import { dashboardGet } from '@/lib/api';
import {
  canCreate,
  fmtDateTime,
  fmtEur,
  STATUS_LABELS,
  STATUS_VARIANTS,
  totalRequested,
} from '@/lib/requests';
import { roleLabel } from '@/lib/roles';
import { cn } from '@/lib/utils';

export default function HomePage(): JSX.Element {
  const { user } = useAuth();
  const q = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: () => dashboardGet(),
    staleTime: 30_000,
  });

  const isApprover = user?.tenantIsApprover === true;
  const isSubmitter = user?.tenantIsApprover === false;
  const canCreateRequest = canCreate(user);

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
        <Skeleton className="h-16 w-1/2" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-60" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <Card className="mx-auto my-12 max-w-md">
        <CardContent className="p-6 text-center text-sm text-destructive">
          Nepavyko užkrauti pradžios duomenų.
        </CardContent>
      </Card>
    );
  }

  const d = q.data;
  const s = d.stats;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Sveiki, {user?.fullName ?? 'naudotojau'}!
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {user ? (
              <>
                {roleLabel(user)} · {user.tenantName} · {d.year} m.
              </>
            ) : (
              'Finansavimo prašymų sistema'
            )}
          </p>
        </div>
        {canCreateRequest && (
          <Button asChild>
            <Link to="/prasymai">
              <Plus className="h-4 w-4" />
              Naujas prašymas
            </Link>
          </Button>
        )}
      </div>

      {/* Stat cards — role-tailored */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {isApprover ? (
          <>
            <StatCard
              icon={<Inbox className="h-4 w-4" />}
              tone="primary"
              label="Laukia mano tvirtinimo"
              value={s.byStatus.SUBMITTED}
              hint={s.byStatus.SUBMITTED > 0 ? 'Peržiūrėti →' : 'Šiuo metu nieko'}
              to={s.byStatus.SUBMITTED > 0 ? '/prasymai?status=SUBMITTED' : undefined}
            />
            <StatCard
              icon={<Wallet className="h-4 w-4" />}
              label={`Prašoma ${d.year} m.`}
              valueRaw={fmtEur(s.totalRequestedThisYear)}
              hint={`${s.totalRequests} prašym${s.totalRequests === 1 ? 'as' : 'ai'} viso`}
            />
            <StatCard
              icon={<PiggyBank className="h-4 w-4" />}
              tone="success"
              label={`Skirta ${d.year} m.`}
              valueRaw={fmtEur(s.totalApprovedThisYear)}
              hint={`${s.byStatus.APPROVED} patvirtint${s.byStatus.APPROVED === 1 ? 'as' : 'i'}`}
            />
            <StatCard
              icon={<Users className="h-4 w-4" />}
              label="Vartotojai"
              value={s.usersCount}
              hint="Visos organizacijos"
              to="/vartotojai"
            />
          </>
        ) : user?.role === 'admin' ? (
          <>
            <StatCard
              icon={<FileEdit className="h-4 w-4" />}
              label="Juodraščiai"
              value={s.byStatus.DRAFT}
              hint="Mūsų org."
              to={s.byStatus.DRAFT > 0 ? '/prasymai?status=DRAFT' : undefined}
            />
            <StatCard
              icon={<Clock className="h-4 w-4" />}
              tone="primary"
              label="Laukia AM atsakymo"
              value={s.byStatus.SUBMITTED}
              hint="Pateikti"
              to={s.byStatus.SUBMITTED > 0 ? '/prasymai?status=SUBMITTED' : undefined}
            />
            <StatCard
              icon={<AlertTriangle className="h-4 w-4" />}
              tone={s.byStatus.RETURNED > 0 ? 'warning' : 'default'}
              label="Reikia pataisyti"
              value={s.byStatus.RETURNED}
              hint={s.byStatus.RETURNED > 0 ? 'AM grąžino' : 'Viskas tvarkoj'}
              to={s.byStatus.RETURNED > 0 ? '/prasymai?status=RETURNED' : undefined}
            />
            <StatCard
              icon={<PiggyBank className="h-4 w-4" />}
              tone="success"
              label={`Skirta ${d.year} m.`}
              valueRaw={fmtEur(s.totalApprovedThisYear)}
              hint={`${s.byStatus.APPROVED} patvirtint${s.byStatus.APPROVED === 1 ? 'as' : 'i'}`}
            />
          </>
        ) : (
          // org. specialistas
          <>
            <StatCard
              icon={<FileEdit className="h-4 w-4" />}
              label="Mano juodraščiai"
              value={s.byStatus.DRAFT}
              hint="Pildomi"
              to={s.byStatus.DRAFT > 0 ? '/prasymai?status=DRAFT' : undefined}
            />
            <StatCard
              icon={<Clock className="h-4 w-4" />}
              tone="primary"
              label="Pateikti"
              value={s.byStatus.SUBMITTED}
              hint="Laukia AM"
              to={s.byStatus.SUBMITTED > 0 ? '/prasymai?status=SUBMITTED' : undefined}
            />
            <StatCard
              icon={<AlertTriangle className="h-4 w-4" />}
              tone={s.byStatus.RETURNED > 0 ? 'warning' : 'default'}
              label="Pataisymui"
              value={s.byStatus.RETURNED}
              hint={s.byStatus.RETURNED > 0 ? 'AM grąžino' : '—'}
              to={s.byStatus.RETURNED > 0 ? '/prasymai?status=RETURNED' : undefined}
            />
            <StatCard
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone="success"
              label="Patvirtinti"
              value={s.byStatus.APPROVED}
              hint={fmtEur(s.totalApprovedThisYear)}
            />
          </>
        )}
      </div>

      {/* Main content: 2 columns */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left primary action zone — 2 cols */}
        <div className="space-y-4 lg:col-span-2">
          {isApprover && (
            <ActionableSection
              title="Laukia mano tvirtinimo"
              icon={<Inbox className="h-4 w-4" />}
              items={d.pendingReview}
              emptyHint="Šiuo metu prašymų laukiančių tvirtinimo nėra."
              urgent
            />
          )}
          {isSubmitter && d.actionable.length > 0 && (
            <ActionableSection
              title="Reikalauja mano veiksmų"
              icon={<AlertTriangle className="h-4 w-4" />}
              items={d.actionable}
              emptyHint="—"
              urgent
            />
          )}
          {isSubmitter && d.actionable.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                  <CheckCircle2 className="h-6 w-6 text-emerald-700 dark:text-emerald-300" />
                </div>
                <div>
                  <p className="font-medium">Viskas tvarkoj</p>
                  <p className="text-sm text-muted-foreground">
                    Nei juodraščių, nei grąžintų pataisymui prašymų.
                  </p>
                </div>
                <Button asChild size="sm">
                  <Link to="/prasymai">
                    <Plus className="h-4 w-4" />
                    Naujas prašymas
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Mėnesinis trendas — kompaktiškas */}
          {d.monthlyTrend.some((m) => m.submitted > 0 || m.approved > 0) && (
            <Card>
              <CardContent className="p-4">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Activity className="h-4 w-4" />
                  12 mėn. dinamika
                  <Link
                    to="/statistika"
                    className="ml-auto text-[11px] font-normal text-muted-foreground hover:text-foreground"
                  >
                    Visa statistika →
                  </Link>
                </h3>
                <MonthlyTrendChart data={d.monthlyTrend} height={160} compact />
              </CardContent>
            </Card>
          )}

          {/* Per-tenant breakdown (AM) */}
          {isApprover && d.perTenantBreakdown && d.perTenantBreakdown.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <FileText className="h-4 w-4" />
                  Per organizaciją
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground">
                        <th className="pb-2 text-left font-normal">Org.</th>
                        <th className="pb-2 text-right font-normal">Iš viso</th>
                        <th className="pb-2 text-center font-normal">Pateikti</th>
                        <th className="pb-2 text-center font-normal">Grąžinti</th>
                        <th className="pb-2 text-center font-normal">Patvirtinti</th>
                        <th className="pb-2 text-right font-normal">Skirta {d.year}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.perTenantBreakdown.map((t) => (
                        <tr
                          key={t.tenantId}
                          className="border-t border-border"
                          data-testid={`tenant-row-${t.tenantCode}`}
                        >
                          <td className="py-2">
                            <div className="font-medium">{t.tenantCode}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {t.tenantName}
                            </div>
                          </td>
                          <td className="py-2 text-right tabular-nums">{t.total}</td>
                          <td className="py-2 text-center">
                            {t.byStatus.SUBMITTED > 0 ? (
                              <Badge variant="default" className="text-[10px]">
                                {t.byStatus.SUBMITTED}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-2 text-center">
                            {t.byStatus.RETURNED > 0 ? (
                              <Badge variant="warning" className="text-[10px]">
                                {t.byStatus.RETURNED}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-2 text-center">
                            {t.byStatus.APPROVED > 0 ? (
                              <Badge variant="success" className="text-[10px]">
                                {t.byStatus.APPROVED}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {fmtEur(t.totalApproved)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Quick links */}
          <Card>
            <CardContent className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4" />
                Greitos nuorodos
              </h3>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                <QuickLink to="/prasymai" label="Visi prašymai" />
                <QuickLink to="/prasymai?status=DRAFT" label="Juodraščiai" />
                <QuickLink to="/prasymai?status=SUBMITTED" label="Pateikti" />
                {isApprover && <QuickLink to="/prasymai?status=APPROVED" label="Patvirtinti" />}
                {isApprover && <QuickLink to="/prasymai?status=REJECTED" label="Atmesti" />}
                <QuickLink to="/vartotojai" label="Vartotojai" />
                <QuickLink to="/docs/" label="Dokumentacija" external />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right side: recent activity */}
        <div>
          <Card>
            <CardContent className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Activity className="h-4 w-4" />
                Naujausi įvykiai
              </h3>
              {d.recentActivity.length === 0 ? (
                <p className="text-xs text-muted-foreground">Įvykių dar nėra.</p>
              ) : (
                <ul className="space-y-3" data-testid="recent-activity">
                  {d.recentActivity.map((a, i) => (
                    <ActivityRow key={`${a.requestId}-${i}`} item={a} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value?: number;
  valueRaw?: string;
  hint?: string;
  tone?: 'default' | 'primary' | 'success' | 'warning';
  to?: string;
}

function StatCard({ icon, label, value, valueRaw, hint, tone = 'default', to }: StatCardProps): JSX.Element {
  const toneCls = {
    default: '',
    primary: 'border-primary/40',
    success: 'border-emerald-500/40',
    warning: 'border-amber-500/40',
  }[tone];

  const valueDisplay = valueRaw ?? (value !== undefined ? String(value) : '—');

  const inner = (
    <Card className={cn('h-full transition-colors', toneCls, to && 'hover:bg-muted/40 cursor-pointer')}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {icon}
            {label}
          </span>
          {to && <ChevronRight className="h-3 w-3" />}
        </div>
        <div className={cn('mt-1.5 text-2xl font-semibold tabular-nums', tone === 'primary' && 'text-primary')}>
          {valueDisplay}
        </div>
        {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );

  if (to) {
    return <Link to={to}>{inner}</Link>;
  }
  return inner;
}

interface ActionableSectionProps {
  title: string;
  icon: React.ReactNode;
  items: FinancingRequest[];
  emptyHint: string;
  urgent?: boolean;
}

function ActionableSection({
  title,
  icon,
  items,
  emptyHint,
  urgent,
}: ActionableSectionProps): JSX.Element {
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          <div className="mb-2 flex justify-center">{icon}</div>
          {emptyHint}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className={cn(urgent && 'border-primary/40')}>
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
          <Badge variant="default" className="ml-auto text-[10px]">
            {items.length}
          </Badge>
        </h3>
        <ul className="divide-y divide-border">
          {items.map((r) => (
            <li key={r.id}>
              <Link
                to={`/prasymai/${r.id}`}
                className="flex items-center gap-3 py-3 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none rounded-md -mx-2 px-2"
                data-testid={`actionable-${r.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{r.projectName}</span>
                    <Badge variant={STATUS_VARIANTS[r.status]} className="text-[10px]">
                      {STATUS_LABELS[r.status]}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {r.tenantCode}
                    </Badge>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {r.createdByName} · prašoma {fmtEur(totalRequested(r))}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const KIND_ICONS: Record<DashboardActivityItem['kind'], React.ReactNode> = {
  comment: <Activity className="h-3 w-3" />,
  status_change: <Activity className="h-3 w-3" />,
  submitted: <Inbox className="h-3 w-3" />,
  returned: <CornerUpLeft className="h-3 w-3" />,
  approved: <CheckCircle2 className="h-3 w-3" />,
  rejected: <XCircle className="h-3 w-3" />,
};

const KIND_COLORS: Record<DashboardActivityItem['kind'], string> = {
  comment: 'bg-muted text-foreground',
  status_change: 'bg-muted text-foreground',
  submitted: 'bg-primary/10 text-primary',
  returned: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100',
  approved: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100',
  rejected: 'bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-100',
};

const KIND_VERBS: Record<DashboardActivityItem['kind'], string> = {
  comment: 'pridėjo komentarą',
  status_change: 'pakeitė statusą',
  submitted: 'pateikė',
  returned: 'grąžino pataisymui',
  approved: 'patvirtino',
  rejected: 'atmetė',
};

function ActivityRow({ item }: { item: DashboardActivityItem }): JSX.Element {
  return (
    <li>
      <Link
        to={`/prasymai/${item.requestId}`}
        className="block rounded-md -mx-1 px-1 py-1 hover:bg-muted/40"
      >
        <div className="flex items-start gap-2">
          <span
            className={cn(
              'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
              KIND_COLORS[item.kind],
            )}
            aria-hidden="true"
          >
            {KIND_ICONS[item.kind]}
          </span>
          <div className="min-w-0 flex-1 text-xs">
            <div className="flex flex-wrap items-center gap-1">
              <span className="font-medium">{item.authorName}</span>
              <span className="text-muted-foreground">{KIND_VERBS[item.kind]}</span>
              <Badge variant="outline" className="text-[9px]">
                {item.tenantCode}
              </Badge>
            </div>
            <div className="truncate text-muted-foreground">{item.projectName}</div>
            {item.body && (
              <div className="mt-1 line-clamp-2 text-[11px] text-foreground">
                {item.body}
              </div>
            )}
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {fmtDateTime(item.createdAt)}
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}

function QuickLink({
  to,
  label,
  external,
}: {
  to: string;
  label: string;
  external?: boolean;
}): JSX.Element {
  const cls =
    'flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-muted/40';
  if (external) {
    return (
      <a href={to} className={cls}>
        <span>{label}</span>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
      </a>
    );
  }
  return (
    <Link to={to} className={cls}>
      <span>{label}</span>
      <ChevronRight className="h-3 w-3 text-muted-foreground" />
    </Link>
  );
}
