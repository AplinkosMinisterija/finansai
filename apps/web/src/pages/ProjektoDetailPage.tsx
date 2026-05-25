/**
 * Projekto detalės puslapis (Iter 11, FVM-3 + Iter 12, FVM-4).
 *
 * Rodo:
 *  - antraštę su pavadinimu + tipo + statuso badge'us
 *  - metaduomenis (tenant, biudžetas, datos, atsakingas)
 *  - susietą prašymą (jei spec_programa)
 *  - susietą biudžeto paskirstymą (su nuoroda į /biudzetas su filtru)
 *  - aprašymą
 *  - biudžeto suvestinę (planuota / panaudota / likutis) su progress bar'u ir
 *    isWarning / isOver flag'ais — kviečia `projects.summary` endpoint
 *  - „Išlaidos" sąrašas (Iter 12) — pridėti / redaguoti / ištrinti
 *
 * Veiksmai:
 *  - „Redaguoti" — AM admin + org_admin → atveria ProjectDialog
 *  - „Pakeisti statusą" — pagal valid transitions
 *  - „Ištrinti" — AM admin only + status = planuojama
 */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { ArrowLeft, ExternalLink, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import type { Project, ProjectSummary } from '@biip-finansai/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { projectsApi } from '@/lib/api/fvm';
import { toast } from '@/lib/use-toast';
import { cn } from '@/lib/utils';
import { BudgetWarningBanner } from '@/components/expenses/BudgetWarningBanner';
import { ExpensesSection } from '@/components/expenses/ExpensesSection';
import { ProjectDialog } from '@/components/projects/ProjectDialog';
import { ProjectStatusBadge } from '@/components/projects/ProjectStatusBadge';
import { ProjectStatusChangeDialog } from '@/components/projects/ProjectStatusChangeDialog';
import { ProjectTypeBadge } from '@/components/projects/ProjectTypeBadge';

function formatEur(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const num = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(num)) return '0,00 €';
  return new Intl.NumberFormat('lt-LT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('lt-LT', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function ProjektoDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const isAmAdmin = user?.tenantIsApprover === true && user.role === 'admin';
  const isOrgAdmin = user?.tenantIsApprover === false && user.role === 'admin';

  const [editing, setEditing] = React.useState(false);
  const [statusChanging, setStatusChanging] = React.useState(false);

  const q = useQuery<Project>({
    queryKey: ['projects', projectId],
    queryFn: () => projectsApi.get(projectId),
    enabled: Number.isFinite(projectId) && projectId > 0,
  });

  const summaryQ = useQuery<ProjectSummary>({
    queryKey: ['projects', projectId, 'summary'],
    queryFn: () => projectsApi.summary(projectId),
    enabled: Number.isFinite(projectId) && projectId > 0,
  });

  const deleteMutation = useMutation({
    mutationFn: () => projectsApi.remove(projectId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      toast({ title: 'Projektas ištrintas', variant: 'success' });
      navigate('/projektai');
    },
    onError: (err: unknown) => {
      let msg = 'Nepavyko ištrinti projekto.';
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        if (data?.message) msg = data.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      toast({ title: msg, variant: 'error' });
    },
  });

  if (!Number.isFinite(projectId) || projectId <= 0) {
    return (
      <Card className="mx-auto my-12 max-w-md">
        <CardContent className="p-6 text-center text-sm text-destructive">
          Klaidingas projekto ID.
        </CardContent>
      </Card>
    );
  }

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 p-4 md:p-6">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-60" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <Card className="mx-auto my-12 max-w-md">
        <CardContent className="p-6 text-center text-sm text-destructive">
          Nepavyko užkrauti projekto.
        </CardContent>
      </Card>
    );
  }

  const p = q.data;
  const canEdit = isAmAdmin || isOrgAdmin;
  const canDelete = isAmAdmin && p.statusas === 'planuojama';

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-4">
        <Link
          to="/projektai"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Projektai
        </Link>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{p.pavadinimas}</h1>
            <ProjectTypeBadge type={p.tipas} />
            <ProjectStatusBadge status={p.statusas} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {p.tenantName ?? `Tenant #${p.tenantId}`}
            {p.tenantCode ? ` (${p.tenantCode})` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
              data-testid="edit-project-btn"
            >
              <Pencil className="h-4 w-4" />
              Redaguoti
            </Button>
          )}
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStatusChanging(true)}
              data-testid="change-status-btn"
            >
              <RefreshCw className="h-4 w-4" />
              Pakeisti statusą
            </Button>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (window.confirm('Ar tikrai ištrinti šį projektą?')) {
                  deleteMutation.mutate();
                }
              }}
              data-testid="delete-project-btn"
            >
              <Trash2 className="h-4 w-4" />
              Ištrinti
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Section title="Metaduomenys">
            <KV label="Tipas">
              <ProjectTypeBadge type={p.tipas} />
            </KV>
            <KV label="Organizacija">{p.tenantName ?? `Tenant #${p.tenantId}`}</KV>
            <KV label="Biudžetas" emph>
              {formatEur(p.biudzetas)}
            </KV>
            <KV label="Statusas">
              <ProjectStatusBadge status={p.statusas} />
            </KV>
            <KV label="Pradžios data">{formatDate(p.pradziosData)}</KV>
            <KV label="Pabaigos data">{formatDate(p.pabaigosData)}</KV>
            <KV label="Atsakingas asmuo">{p.atsakingasUserName ?? '—'}</KV>
          </Section>

          <Section title="Susiję objektai">
            <KV label="Biudžeto paskirstymas" wide>
              {p.budgetAllocationName ? (
                <Link
                  to={`/biudzetas?allocationId=${p.budgetAllocationId}`}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  {p.budgetAllocationName}
                  <ExternalLink className="h-3 w-3" />
                </Link>
              ) : (
                `Paskirstymas #${p.budgetAllocationId}`
              )}
            </KV>
            {p.requestId !== null && (
              <KV label="Susietas prašymas" wide>
                <Link
                  to={`/prasymai/${p.requestId}`}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  data-testid="linked-request-link"
                >
                  {p.requestProjectName ?? `Prašymas #${p.requestId}`}
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </KV>
            )}
          </Section>

          {p.aprasymas && (
            <Card>
              <CardContent className="p-4">
                <h3 className="mb-2 text-sm font-semibold">Aprašymas</h3>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{p.aprasymas}</p>
              </CardContent>
            </Card>
          )}

          <ExpensesSection
            projectId={projectId}
            defaultAllocationId={p.budgetAllocationId}
            projectResponsibleUserId={p.atsakingasUserId}
            projectIsDuSystem={p.isDuSystem}
          />
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <h3 className="mb-3 text-sm font-semibold">Biudžeto suvestinė</h3>
              {summaryQ.isLoading ? (
                <Skeleton className="h-32" />
              ) : summaryQ.isError ? (
                <p className="text-sm text-destructive">Nepavyko užkrauti suvestinės.</p>
              ) : (
                <SummaryBox summary={summaryQ.data ?? null} />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {editing && (
        <ProjectDialog
          mode="edit"
          project={p}
          defaultTenantId={p.tenantId}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(false);
          }}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['projects'] });
            void qc.invalidateQueries({
              queryKey: ['projects', projectId, 'summary'],
            });
            toast({ title: 'Projektas atnaujintas', variant: 'success' });
            setEditing(false);
          }}
        />
      )}

      {statusChanging && (
        <ProjectStatusChangeDialog
          project={p}
          open
          onOpenChange={(o) => {
            if (!o) setStatusChanging(false);
          }}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['projects'] });
            void qc.invalidateQueries({
              queryKey: ['projects', projectId, 'summary'],
            });
            toast({ title: 'Statusas atnaujintas', variant: 'success' });
            setStatusChanging(false);
          }}
        />
      )}
    </div>
  );
}

interface SummaryBoxProps {
  summary: ProjectSummary | null;
}

function SummaryBox({ summary }: SummaryBoxProps): JSX.Element {
  if (!summary) {
    return <p className="text-sm text-muted-foreground">Nėra suvestinės duomenų.</p>;
  }
  return (
    <BudgetWarningBanner
      planuotaLabel="Biudžetas"
      panaudotaLabel="Panaudota"
      planuota={summary.biudzetas}
      panaudota={summary.panaudota}
      likutis={summary.likutis}
      percentUsed={summary.percentUsed}
      isWarning={summary.isWarning}
      isOver={summary.isOver}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="mb-3 text-sm font-semibold">{title}</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">{children}</dl>
      </CardContent>
    </Card>
  );
}

function KV({
  label,
  emph,
  wide,
  children,
}: {
  label: string;
  emph?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <>
      <dt className={cn('text-muted-foreground', wide && 'col-span-2 mt-2 font-medium')}>
        {label}
      </dt>
      <dd className={cn(wide ? 'col-span-2' : 'text-right', emph && 'font-semibold')}>
        {children}
      </dd>
    </>
  );
}
