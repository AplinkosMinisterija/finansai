/**
 * Projektų puslapis (Iter 11, FVM-3).
 *
 * Sąrašas visų projektų (3 FVM lygis) — projektai, spec.programos, veiklos.
 * Filtruojama pagal:
 *  - metus (year)
 *  - tipas (projektas | spec_programa | veikla)
 *  - statusą (planuojama | vykdoma | baigta | uzdaryta)
 *  - tenant (tik AM admin'ui)
 *
 * Permissions:
 *  - Visi prisijungę vartotojai mato (server-side scope'as)
 *  - AM admin + org_admin gali sukurti naują projektą
 *
 * UI: lentelė su pavadinimas / tipas / biudžetas / statusas / atsakingas /
 * veiksmais.
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Briefcase, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type {
  Project,
  ProjectListQuery,
  ProjectStatus,
  ProjectType,
  Tenant,
} from '@biip-finansai/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { canViewPayroll } from '@/lib/roles';
import { projectsApi } from '@/lib/api/fvm';
import { tenantsList } from '@/lib/api';
import { toast } from '@/lib/use-toast';
import { ProjectDialog } from '@/components/projects/ProjectDialog';
import { ProjectStatusBadge } from '@/components/projects/ProjectStatusBadge';
import { ProjectStatusChangeDialog } from '@/components/projects/ProjectStatusChangeDialog';
import { ProjectTypeBadge } from '@/components/projects/ProjectTypeBadge';

const ALL = '__all__';

function formatEur(value: string | number): string {
  const num = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(num)) return '0,00 €';
  return new Intl.NumberFormat('lt-LT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export default function ProjektaiPage(): JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isAmAdmin =
    user?.tenantIsApprover === true && user.role === 'admin';
  const isOrgAdmin =
    user?.tenantIsApprover === false && user.role === 'admin';
  const canCreate = isAmAdmin || isOrgAdmin;

  const now = new Date();
  const [year, setYear] = React.useState<number | null>(now.getFullYear());
  const [type, setType] = React.useState<ProjectType | null>(null);
  const [status, setStatus] = React.useState<ProjectStatus | null>(null);
  const [tenantId, setTenantId] = React.useState<number | null>(null);

  const [creatingDialogOpen, setCreatingDialogOpen] = React.useState(false);
  const [editingProject, setEditingProject] = React.useState<Project | null>(null);
  const [statusDialogProject, setStatusDialogProject] = React.useState<Project | null>(
    null,
  );

  const filters: ProjectListQuery = React.useMemo(() => {
    const q: ProjectListQuery = {};
    if (year !== null) q.year = year;
    if (type !== null) q.type = type;
    if (status !== null) q.status = status;
    if (tenantId !== null) q.tenantId = tenantId;
    return q;
  }, [year, type, status, tenantId]);

  const listQ = useQuery<Project[]>({
    queryKey: ['projects', filters],
    queryFn: () => projectsApi.list(filters),
  });

  const tenantsQ = useQuery<Tenant[]>({
    queryKey: ['tenants', { withCounts: false }],
    queryFn: () => tenantsList(false),
    enabled: isAmAdmin,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => projectsApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      toast({ title: 'Projektas ištrintas', variant: 'success' });
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

  function handleDelete(p: Project): void {
    if (!window.confirm(`Ar tikrai ištrinti projektą „${p.pavadinimas}"?`)) {
      return;
    }
    deleteMutation.mutate(p.id);
  }

  // SAUGUMO PATCH (Iter 13.x, docx §4.4) — defense-in-depth:
  // Backend'as jau filter'ina DU sistemos projektus per `canViewPayroll`,
  // bet papildomai išmetam frontend'e — apsauga nuo cache'o / regression'o.
  const rawProjects = listQ.data ?? [];
  const projects = canViewPayroll(user)
    ? rawProjects
    : rawProjects.filter((p) => !p.isDuSystem);
  const tenants = tenantsQ.data ?? [];
  const years: number[] = [];
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 5; y += 1) {
    years.push(y);
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Briefcase className="h-6 w-6 text-muted-foreground" />
            Projektai
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            3 FVM lygis: „Kas konkrečiai išleidžia?". Projektai, spec.programos
            ir veiklos, kurios faktiškai naudoja biudžetą.
          </p>
        </div>
        {canCreate && (
          <Button
            onClick={() => setCreatingDialogOpen(true)}
            data-testid="open-new-project"
          >
            <Plus className="h-4 w-4" />
            Naujas projektas
          </Button>
        )}
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label htmlFor="p-filter-year" className="text-xs text-muted-foreground">
              Metai
            </Label>
            <Select
              value={year === null ? ALL : String(year)}
              onValueChange={(v) =>
                setYear(v === ALL ? null : Number.parseInt(v, 10))
              }
            >
              <SelectTrigger id="p-filter-year" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Visi metai</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="p-filter-type" className="text-xs text-muted-foreground">
              Tipas
            </Label>
            <Select
              value={type ?? ALL}
              onValueChange={(v) =>
                setType(v === ALL ? null : (v as ProjectType))
              }
            >
              <SelectTrigger id="p-filter-type" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Visi tipai</SelectItem>
                <SelectItem value="projektas">Projektas</SelectItem>
                <SelectItem value="spec_programa">Spec. programa</SelectItem>
                <SelectItem value="veikla">Veikla</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="p-filter-status" className="text-xs text-muted-foreground">
              Statusas
            </Label>
            <Select
              value={status ?? ALL}
              onValueChange={(v) =>
                setStatus(v === ALL ? null : (v as ProjectStatus))
              }
            >
              <SelectTrigger id="p-filter-status" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Visi statusai</SelectItem>
                <SelectItem value="planuojama">Planuojama</SelectItem>
                <SelectItem value="vykdoma">Vykdoma</SelectItem>
                <SelectItem value="baigta">Baigta</SelectItem>
                <SelectItem value="uzdaryta">Uždaryta</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isAmAdmin && (
            <div className="space-y-1">
              <Label
                htmlFor="p-filter-tenant"
                className="text-xs text-muted-foreground"
              >
                Organizacija
              </Label>
              <Select
                value={tenantId === null ? ALL : String(tenantId)}
                onValueChange={(v) =>
                  setTenantId(v === ALL ? null : Number.parseInt(v, 10))
                }
              >
                <SelectTrigger id="p-filter-tenant" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Visos organizacijos</SelectItem>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name} ({t.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {listQ.isLoading ? (
        <div className="space-y-2" data-testid="projects-skeleton">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : listQ.isError ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">
            Nepavyko užkrauti projektų.
          </CardContent>
        </Card>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent
            className="p-12 text-center text-sm text-muted-foreground"
            data-testid="projects-empty"
          >
            {canCreate
              ? 'Nėra projektų. Sukurkite naują.'
              : 'Nėra projektų pagal pasirinktus filtrus.'}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table
              className="w-full text-sm"
              data-testid="projects-table"
            >
              <thead className="border-b border-border bg-muted/50">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Pavadinimas</th>
                  <th className="px-3 py-2 font-medium">Tipas</th>
                  <th className="px-3 py-2 font-medium text-right">Biudžetas</th>
                  <th className="px-3 py-2 font-medium">Statusas</th>
                  <th className="px-3 py-2 font-medium">Atsakingas</th>
                  <th className="px-3 py-2 font-medium text-right">Veiksmai</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const canEditRow = isAmAdmin || isOrgAdmin;
                  const canDeleteRow = isAmAdmin && p.statusas === 'planuojama';
                  return (
                    <tr
                      key={p.id}
                      data-testid={`project-row-${p.id}`}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40"
                      onClick={() => navigate(`/projektai/${p.id}`)}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{p.pavadinimas}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {p.tenantCode ?? `Tenant #${p.tenantId}`}
                          {p.budgetAllocationName
                            ? ` · ${p.budgetAllocationName}`
                            : ''}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <ProjectTypeBadge type={p.tipas} />
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {formatEur(p.biudzetas)}
                      </td>
                      <td className="px-3 py-2">
                        <ProjectStatusBadge status={p.statusas} />
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {p.atsakingasUserName ?? '—'}
                      </td>
                      <td
                        className="px-3 py-2 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex gap-1">
                          {canEditRow && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingProject(p)}
                              title="Redaguoti"
                              data-testid={`edit-project-${p.id}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {canEditRow && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setStatusDialogProject(p)}
                              title="Keisti statusą"
                              data-testid={`status-project-${p.id}`}
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {canDeleteRow && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleDelete(p)}
                              title="Ištrinti"
                              data-testid={`delete-project-${p.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {(creatingDialogOpen || editingProject !== null) && (
        <ProjectDialog
          mode={editingProject ? 'edit' : 'create'}
          project={editingProject}
          defaultTenantId={user?.tenantId ?? null}
          open={creatingDialogOpen || editingProject !== null}
          onOpenChange={(o) => {
            if (!o) {
              setCreatingDialogOpen(false);
              setEditingProject(null);
            }
          }}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['projects'] });
            toast({
              title: editingProject
                ? 'Projektas atnaujintas'
                : 'Projektas sukurtas',
              variant: 'success',
            });
            setCreatingDialogOpen(false);
            setEditingProject(null);
          }}
        />
      )}

      {statusDialogProject !== null && (
        <ProjectStatusChangeDialog
          project={statusDialogProject}
          open
          onOpenChange={(o) => {
            if (!o) setStatusDialogProject(null);
          }}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['projects'] });
            toast({ title: 'Statusas atnaujintas', variant: 'success' });
            setStatusDialogProject(null);
          }}
        />
      )}
    </div>
  );
}
