/**
 * `ProjectDialog` — CRUD modal'as projektams (3 FVM lygis, Iter 11).
 *
 * Form'os laukai:
 *  - pavadinimas (privalomas)
 *  - tipas (projektas | spec_programa | veikla) — disabled redagavime
 *  - tenant (organizacija) — AM admin gali pasirinkti; org_admin'ui užfiksuotas savo tenant'as
 *  - budget_allocation_id (privaloma; grupuota per funding_source)
 *  - biudžetas (> 0, decimal)
 *  - pradžios_data / pabaigos_data (jei abi nurodytos → pradžia <= pabaiga)
 *  - atsakingas_user_id (užkrauna pagal pasirinktą tenant'ą)
 *  - aprasymas (textarea)
 *  - request_id (rodomas TIK kai tipas = spec_programa) — paieška per
 *    APPROVED prašymus su budgetCategoryCode = `spec_programa`
 *
 * Backend validuoja papildomai (allocation priklauso tenant'ui, spec_programa
 * reikalauja approved request'o ir t.t.).
 */
import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import type {
  BudgetAllocation,
  FinancingRequest,
  PaginatedResponse,
  Project,
  ProjectCreateDTO,
  ProjectType,
  ProjectUpdateDTO,
  Tenant,
  User,
} from '@biip-finansai/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { requestsList, tenantsList, usersList } from '@/lib/api';
import { budgetAllocationsApi, fundingSourcesApi, projectsApi } from '@/lib/api/fvm';
import { useAuth } from '@/lib/auth';
import { PROJECT_TYPE_LABELS } from './ProjectTypeBadge';

interface FormState {
  tenantId: string;
  budgetAllocationId: string;
  requestId: string;
  pavadinimas: string;
  tipas: ProjectType | '';
  biudzetas: string;
  pradziosData: string;
  pabaigosData: string;
  atsakingasUserId: string;
  aprasymas: string;
}

function emptyForm(defaults: { tenantId: number | null }): FormState {
  return {
    tenantId: defaults.tenantId !== null ? String(defaults.tenantId) : '',
    budgetAllocationId: '',
    requestId: '',
    pavadinimas: '',
    tipas: '',
    biudzetas: '',
    pradziosData: '',
    pabaigosData: '',
    atsakingasUserId: '',
    aprasymas: '',
  };
}

function fromProject(p: Project): FormState {
  return {
    tenantId: String(p.tenantId),
    budgetAllocationId: String(p.budgetAllocationId),
    requestId: p.requestId !== null ? String(p.requestId) : '',
    pavadinimas: p.pavadinimas,
    tipas: p.tipas,
    biudzetas: p.biudzetas,
    pradziosData: p.pradziosData ?? '',
    pabaigosData: p.pabaigosData ?? '',
    atsakingasUserId: p.atsakingasUserId !== null ? String(p.atsakingasUserId) : '',
    aprasymas: p.aprasymas ?? '',
  };
}

function normalizeAmountInput(input: string): string {
  const cleaned = input.replace(/\s/g, '').replace(',', '.');
  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num)) return '0.00';
  return num.toFixed(2);
}

export interface ProjectDialogProps {
  mode: 'create' | 'edit';
  project: Project | null;
  /** Numatytasis tenant_id (paprastai prisijungusio vartotojo tenant'as). */
  defaultTenantId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (project: Project) => void;
}

export function ProjectDialog({
  mode,
  project,
  defaultTenantId,
  open,
  onOpenChange,
  onSuccess,
}: ProjectDialogProps): JSX.Element {
  const { user } = useAuth();
  const isAmAdmin =
    user?.tenantIsApprover === true && user.role === 'admin';

  const [state, setState] = React.useState<FormState>(
    project ? fromProject(project) : emptyForm({ tenantId: defaultTenantId }),
  );
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValidationError(null);
    setServerError(null);
    setState(
      project ? fromProject(project) : emptyForm({ tenantId: defaultTenantId }),
    );
  }, [project, defaultTenantId, open]);

  const tenantsQ = useQuery<Tenant[]>({
    queryKey: ['tenants', { withCounts: false }],
    queryFn: () => tenantsList(false),
    enabled: isAmAdmin,
  });

  const allocationsQ = useQuery<BudgetAllocation[]>({
    queryKey: ['budgetAllocations', { all: true }],
    queryFn: () => budgetAllocationsApi.list({}),
  });

  // Funding sources — užkrauname kad galėtume grupuoti allocation'us.
  const sourcesQ = useQuery({
    queryKey: ['fundingSources', { all: true }],
    queryFn: () => fundingSourcesApi.list({}),
  });

  // Atsakingi: užkrauname users iš pasirinkto tenant'o.
  const tenantIdNum = state.tenantId === '' ? null : Number.parseInt(state.tenantId, 10);
  const usersQ = useQuery<PaginatedResponse<User>>({
    queryKey: ['users', { tenantId: tenantIdNum }],
    queryFn: () =>
      usersList({ tenantId: tenantIdNum ?? undefined, pageSize: 100 }),
    enabled: tenantIdNum !== null,
  });

  // Spec.programa: užkrauname APPROVED prašymus su budgetCategoryCode = spec_programa.
  const showRequestSelect = state.tipas === 'spec_programa';
  const approvedRequestsQ = useQuery<PaginatedResponse<FinancingRequest>>({
    queryKey: ['requests', { status: 'APPROVED', forSpecProgramaProject: true }],
    queryFn: () => requestsList({ status: 'APPROVED', pageSize: 200 }),
    enabled: showRequestSelect,
  });

  const mutation = useMutation({
    mutationFn: async (): Promise<Project> => {
      const tenantId = Number.parseInt(state.tenantId, 10);
      const budgetAllocationId = Number.parseInt(state.budgetAllocationId, 10);
      const requestId =
        state.requestId === ''
          ? null
          : Number.parseInt(state.requestId, 10);
      const atsakingasUserId =
        state.atsakingasUserId === ''
          ? null
          : Number.parseInt(state.atsakingasUserId, 10);
      const biudzetas = normalizeAmountInput(state.biudzetas);
      const pradziosData = state.pradziosData === '' ? null : state.pradziosData;
      const pabaigosData = state.pabaigosData === '' ? null : state.pabaigosData;
      const aprasymas = state.aprasymas.trim() === '' ? null : state.aprasymas.trim();

      if (mode === 'create') {
        if (state.tipas === '') {
          throw new Error('Tipas privalomas.');
        }
        const body: ProjectCreateDTO = {
          tenantId,
          budgetAllocationId,
          requestId: state.tipas === 'spec_programa' ? requestId : null,
          pavadinimas: state.pavadinimas.trim(),
          tipas: state.tipas,
          biudzetas,
          pradziosData,
          pabaigosData,
          atsakingasUserId,
          aprasymas,
        };
        return projectsApi.create(body);
      }
      if (!project) throw new Error('Nėra projekto, kurį atnaujinti.');
      const patch: ProjectUpdateDTO = {
        budgetAllocationId,
        pavadinimas: state.pavadinimas.trim(),
        biudzetas,
        pradziosData,
        pabaigosData,
        atsakingasUserId,
        aprasymas,
      };
      return projectsApi.update(project.id, patch);
    },
    onSuccess: (p) => onSuccess(p),
    onError: (err: unknown) => {
      let msg = 'Nepavyko išsaugoti projekto.';
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        if (data?.message) msg = data.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setServerError(msg);
    },
  });

  function validate(): string | null {
    if (state.pavadinimas.trim() === '') return 'Įveskite pavadinimą.';
    if (mode === 'create' && state.tipas === '') return 'Pasirinkite projekto tipą.';
    if (state.tenantId === '') return 'Pasirinkite organizaciją.';
    if (state.budgetAllocationId === '') {
      return 'Pasirinkite biudžeto paskirstymą.';
    }
    const sumaNum = Number.parseFloat(normalizeAmountInput(state.biudzetas));
    if (!Number.isFinite(sumaNum) || sumaNum <= 0) {
      return 'Biudžetas turi būti didesnis už 0.';
    }
    if (state.pradziosData !== '' && state.pabaigosData !== '') {
      if (state.pradziosData > state.pabaigosData) {
        return 'Pradžios data negali būti vėlesnė už pabaigos datą.';
      }
    }
    return null;
  }

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setServerError(null);
    const err = validate();
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    mutation.mutate();
  }

  const isCreate = mode === 'create';
  const tenants = tenantsQ.data ?? [];
  const allocations = allocationsQ.data ?? [];
  const sources = sourcesQ.data ?? [];
  const usersData = usersQ.data?.items ?? [];
  const approvedRequests = approvedRequestsQ.data?.items ?? [];

  // Grupuojam allocations per funding_source pavadinimą.
  const allocationsBySource: Map<number, BudgetAllocation[]> = new Map();
  for (const a of allocations) {
    const arr = allocationsBySource.get(a.fundingSourceId) ?? [];
    arr.push(a);
    allocationsBySource.set(a.fundingSourceId, arr);
  }
  const sourceLookup = new Map(sources.map((s) => [s.id, s]));

  // Filter spec.programa prašymus, kurie dar neturi projekto IR yra spec_programa kategorijos.
  const eligibleRequests = approvedRequests.filter(
    (r) =>
      r.budgetCategoryCode === 'spec_programa' &&
      (project?.requestId === r.id || r.fvmProjectId === null),
  );

  const errorMsg = serverError ?? validationError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {isCreate
                ? 'Naujas projektas'
                : `Redaguoti — ${project?.pavadinimas ?? ''}`}
            </DialogTitle>
            <DialogDescription>
              {isCreate
                ? 'Užpildykite duomenis ir paspauskite „Sukurti".'
                : 'Atnaujinkite projekto duomenis. Tipo keisti negalima.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="p-pavadinimas">Pavadinimas</Label>
              <Input
                id="p-pavadinimas"
                required
                maxLength={300}
                placeholder="Pvz., IT modernizavimas 2026"
                value={state.pavadinimas}
                onChange={(e) =>
                  setState((s) => ({ ...s, pavadinimas: e.target.value }))
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="p-tipas">Tipas</Label>
                <Select
                  value={state.tipas}
                  onValueChange={(v) =>
                    setState((s) => ({
                      ...s,
                      tipas: v as ProjectType,
                      // jei keičiam į ne-spec_programa — išvalom request_id
                      requestId: v === 'spec_programa' ? s.requestId : '',
                    }))
                  }
                  disabled={!isCreate}
                >
                  <SelectTrigger id="p-tipas" data-testid="project-tipas-trigger">
                    <SelectValue placeholder="Pasirinkite tipą" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="projektas">
                      {PROJECT_TYPE_LABELS.projektas}
                    </SelectItem>
                    <SelectItem value="spec_programa">
                      {PROJECT_TYPE_LABELS.spec_programa}
                    </SelectItem>
                    <SelectItem value="veikla">
                      {PROJECT_TYPE_LABELS.veikla}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {!isCreate && (
                  <p className="text-[11px] text-muted-foreground">
                    Tipo keisti negalima — sukurkite naują projektą.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-tenant">Organizacija</Label>
                <Select
                  value={state.tenantId}
                  onValueChange={(v) =>
                    setState((s) => ({
                      ...s,
                      tenantId: v,
                      atsakingasUserId: '',
                    }))
                  }
                  disabled={!isAmAdmin || !isCreate}
                >
                  <SelectTrigger id="p-tenant">
                    <SelectValue placeholder="Pasirinkite organizaciją" />
                  </SelectTrigger>
                  <SelectContent>
                    {isAmAdmin
                      ? tenants.map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>
                            {t.name} ({t.code})
                          </SelectItem>
                        ))
                      : user !== null && (
                          <SelectItem value={String(user.tenantId)}>
                            {user.tenantName} ({user.tenantCode})
                          </SelectItem>
                        )}
                  </SelectContent>
                </Select>
                {!isAmAdmin && (
                  <p className="text-[11px] text-muted-foreground">
                    Organizacija užfiksuota jūsų tenant'ui.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="p-allocation">Biudžeto paskirstymas</Label>
              <Select
                value={state.budgetAllocationId}
                onValueChange={(v) =>
                  setState((s) => ({ ...s, budgetAllocationId: v }))
                }
              >
                <SelectTrigger
                  id="p-allocation"
                  data-testid="project-allocation-trigger"
                >
                  <SelectValue placeholder="Pasirinkite biudžeto paskirstymą" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(allocationsBySource.entries()).map(([sId, arr]) => {
                    const src = sourceLookup.get(sId);
                    const groupLabel = src
                      ? `${src.pavadinimas} (${src.kodas}, ${src.metai})`
                      : `Šaltinis #${sId}`;
                    return (
                      <SelectGroup key={sId}>
                        <SelectLabel>{groupLabel}</SelectLabel>
                        {arr.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>
                            {a.pavadinimas}
                            {a.categoryName ? ` · ${a.categoryName}` : ''}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                  {allocations.length === 0 && (
                    <div className="px-2 py-3 text-xs text-muted-foreground">
                      Nėra paskirstymų. Sukurkite biudžeto paskirstymą per
                      „Finansavimo šaltiniai".
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="p-biudzetas">Biudžetas (€)</Label>
                <Input
                  id="p-biudzetas"
                  inputMode="decimal"
                  required
                  placeholder="100000.00"
                  value={state.biudzetas}
                  onChange={(e) =>
                    setState((s) => ({ ...s, biudzetas: e.target.value }))
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  Galima ir kableliu (100000,00).
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-atsakingas">Atsakingas asmuo</Label>
                <Select
                  value={state.atsakingasUserId === '' ? '__none__' : state.atsakingasUserId}
                  onValueChange={(v) =>
                    setState((s) => ({
                      ...s,
                      atsakingasUserId: v === '__none__' ? '' : v,
                    }))
                  }
                  disabled={state.tenantId === ''}
                >
                  <SelectTrigger id="p-atsakingas">
                    <SelectValue placeholder="Pasirinkite atsakingą" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Nenurodyta —</SelectItem>
                    {usersData.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="p-pradzia">Pradžios data</Label>
                <Input
                  id="p-pradzia"
                  type="date"
                  value={state.pradziosData}
                  onChange={(e) =>
                    setState((s) => ({ ...s, pradziosData: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-pabaiga">Pabaigos data</Label>
                <Input
                  id="p-pabaiga"
                  type="date"
                  value={state.pabaigosData}
                  onChange={(e) =>
                    setState((s) => ({ ...s, pabaigosData: e.target.value }))
                  }
                />
              </div>
            </div>

            {showRequestSelect && (
              <div
                className="space-y-2 rounded-md border border-border p-3"
                data-testid="project-request-section"
              >
                <Label htmlFor="p-request">Susietas prašymas (Spec. programa)</Label>
                <Select
                  value={state.requestId === '' ? '__none__' : state.requestId}
                  onValueChange={(v) =>
                    setState((s) => ({
                      ...s,
                      requestId: v === '__none__' ? '' : v,
                    }))
                  }
                  disabled={!isCreate}
                >
                  <SelectTrigger id="p-request">
                    <SelectValue placeholder="Pasirinkite prašymą" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Be prašymo —</SelectItem>
                    {eligibleRequests.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.projectName || `Prašymas #${r.id}`} ({r.tenantCode}, {r.year})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Galimi tik patvirtinti spec.programos prašymai, dar neturintys
                  susieto projekto.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="p-aprasymas">Aprašymas</Label>
              <textarea
                id="p-aprasymas"
                rows={3}
                maxLength={4000}
                placeholder="Trumpas projekto aprašymas"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={state.aprasymas}
                onChange={(e) =>
                  setState((s) => ({ ...s, aprasymas: e.target.value }))
                }
              />
            </div>

            {errorMsg && (
              <div
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {errorMsg}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Atšaukti
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saugoma…
                </>
              ) : isCreate ? (
                'Sukurti'
              ) : (
                'Išsaugoti'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ProjectDialog;
