import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import {
  Briefcase,
  CheckCircle2,
  MessageCircle,
  Pencil,
  Send,
  Trash2,
  XCircle,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import { toast } from '@/lib/use-toast';
import type { FinancingRequestDetail, RequestCommentKind } from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth';
import {
  requestAddComment,
  requestDecision,
  requestDelete,
  requestGet,
  requestSubmit,
} from '@/lib/api';
import { classifierLabel, useClassifier } from '@/lib/classifiers';
import { ClassifierSelect, ClassifierSelectById } from '@/components/classifiers/ClassifierSelect';
import { AttachmentList } from '@/components/requests/AttachmentList';
import { ApprovalStepsList } from '@/components/requests/ApprovalStepsList';
import { ReportsSection } from '@/components/requests/ReportsSection';
import {
  canDecide,
  canDelete,
  canEdit,
  canSubmit,
  fmtDate,
  fmtDateTime,
  fmtEur,
  STATUS_LABELS,
  STATUS_VARIANTS,
  totalQuarterly,
  totalRequested,
} from '@/lib/requests';
import { ROLE_LABELS } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const KIND_LABELS: Record<RequestCommentKind, string> = {
  comment: 'Komentaras',
  status_change: 'Statuso pakeitimas',
  submitted: 'Pateikta AM',
  returned: 'Grąžinta pataisymui',
  approved: 'Patvirtinta',
  rejected: 'Atmesta',
};

const KIND_COLORS: Record<RequestCommentKind, string> = {
  comment: 'bg-muted text-foreground',
  status_change: 'bg-muted text-foreground',
  submitted: 'bg-primary/10 text-primary',
  returned: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100',
  approved: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100',
  rejected: 'bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-100',
};

export default function PrasymoDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const requestId = Number(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const q = useQuery<FinancingRequestDetail>({
    queryKey: ['requests', requestId],
    queryFn: () => requestGet(requestId),
    enabled: Number.isFinite(requestId) && requestId > 0,
  });

  const isLookup = useClassifier('is_system');
  const ptLookup = useClassifier('project_type');
  const spLookup = useClassifier('source_program');
  const budgetCategoryLookup = useClassifier('budget_category');
  const fundingSourceTypeLookup = useClassifier('funding_source_type');

  const convertMutation = useMutation({
    mutationFn: () => import('@/lib/api').then((m) => m.requestConvertToCurrentYear(requestId)),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['requests'] });
      navigate(`/prasymai/${r.id}/redaguoti`);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const [commentBody, setCommentBody] = React.useState('');
  type DecisionFormState = {
    open: 'approve' | 'reject' | 'return' | null;
    comment: string;
    grantedAmount: string;
    fundingSource: string;
    protocol: string;
    order: string;
    // UAT #42 (PA-006): įsakymo data — date picker.
    orderDate: string;
    // UAT #42 (PA-002): prioritetas + pirkimo stadija — AM sprendimo laukai.
    priority: string;
    procurementStage: string;
    // UAT #42 (PA-003): finansavimo šaltinio laukai — AM sprendimo laukai.
    fundingFromIt: string;
    otherFunds: string;
    otherFundsSource: string;
    // FVM Iter 10 (P03) — AM korekcija
    budgetCategoryId: number | null;
    budgetCategoryCode: string | null;
    fundingSourceTypeId: number | null;
    specProgramFundingType: import('@biip-finansai/shared').SpecProgramFundingType | null;
  };
  const EMPTY_DECISION_FORM: DecisionFormState = {
    open: null,
    comment: '',
    grantedAmount: '',
    fundingSource: '',
    protocol: '',
    order: '',
    orderDate: '',
    priority: '',
    procurementStage: '',
    fundingFromIt: '',
    otherFunds: '',
    otherFundsSource: '',
    budgetCategoryId: null,
    budgetCategoryCode: null,
    fundingSourceTypeId: null,
    specProgramFundingType: null,
  };
  const [decisionForm, setDecisionForm] = React.useState<DecisionFormState>(EMPTY_DECISION_FORM);
  const [error, setError] = React.useState<string | null>(null);

  const addComment = useMutation({
    mutationFn: (body: string) => requestAddComment(requestId, body),
    onSuccess: () => {
      setCommentBody('');
      void qc.invalidateQueries({ queryKey: ['requests', requestId] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const submitMutation = useMutation({
    mutationFn: () => requestSubmit(requestId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['requests', requestId] });
      void qc.invalidateQueries({ queryKey: ['requests'] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => requestDelete(requestId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['requests'] });
      navigate('/prasymai');
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const decisionMutation = useMutation({
    mutationFn: () => {
      if (!decisionForm.open) throw new Error('No decision');
      return requestDecision(requestId, {
        decision: decisionForm.open,
        comment: decisionForm.comment || undefined,
        grantedAmount: decisionForm.grantedAmount || undefined,
        fundingSource: decisionForm.fundingSource || undefined,
        protocol: decisionForm.protocol || undefined,
        order: decisionForm.order || undefined,
        // UAT #42 (PA-006): įsakymo data.
        orderDate: decisionForm.orderDate || null,
        // UAT #42 (PA-002): prioritetas + pirkimo stadija.
        priority: decisionForm.priority ? Number(decisionForm.priority) : null,
        procurementStage: decisionForm.procurementStage || null,
        // UAT #42 (PA-003): finansavimo šaltinio laukai.
        fundingFromIt: decisionForm.fundingFromIt || null,
        otherFunds: decisionForm.otherFunds || null,
        otherFundsSource: decisionForm.otherFundsSource || null,
        // FVM Iter 10 — AM korekcija per decision payload
        budgetCategoryId: decisionForm.budgetCategoryId,
        fundingSourceTypeId: decisionForm.fundingSourceTypeId,
        specProgramFundingType: decisionForm.specProgramFundingType,
      });
    },
    onSuccess: () => {
      setDecisionForm(EMPTY_DECISION_FORM);
      void qc.invalidateQueries({ queryKey: ['requests', requestId] });
      void qc.invalidateQueries({ queryKey: ['requests'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  /**
   * Atidaro decision dialog'ą su pre-filled institucijos pasirinkimu (FVM Iter 10).
   * AM mato kas buvo nurodyta ir gali pakeisti prieš patvirtinant.
   */
  function openDecisionDialog(
    mode: 'approve' | 'reject' | 'return',
    r: import('@biip-finansai/shared').FinancingRequestDetail,
  ): void {
    setDecisionForm({
      open: mode,
      comment: '',
      grantedAmount: '',
      fundingSource: r.decisionFundingSource ?? '',
      protocol: '',
      order: '',
      orderDate: r.decisionOrderDate ?? '',
      // UAT #42 (PA-002/003): pre-fill esamomis reikšmėmis (jei buvo nustatyta).
      priority: r.priority !== null ? String(r.priority) : '',
      procurementStage: r.procurementStage ?? '',
      fundingFromIt: r.fundingFromIt && Number(r.fundingFromIt) > 0 ? String(r.fundingFromIt) : '',
      otherFunds: r.otherFunds && Number(r.otherFunds) > 0 ? String(r.otherFunds) : '',
      otherFundsSource: r.otherFundsSource ?? '',
      budgetCategoryId: r.budgetCategoryId,
      budgetCategoryCode: r.budgetCategoryCode ?? null,
      fundingSourceTypeId: r.fundingSourceTypeId,
      specProgramFundingType: r.specProgramFundingType,
    });
  }

  const createFvmProjectMutation = useMutation({
    mutationFn: () => import('@/lib/api').then((m) => m.requestCreateFvmProject(requestId)),
    onSuccess: (resp) => {
      // Iter 11: backend real impl — grąžina status='created' su projektu.
      // Iter 10 backward compat'as: status='pending' tik jei backend yra senas.
      if (resp.status === 'created') {
        void qc.invalidateQueries({ queryKey: ['requests', requestId] });
        void qc.invalidateQueries({ queryKey: ['requests'] });
        void qc.invalidateQueries({ queryKey: ['projects'] });
        toast({
          title: 'Projektas sukurtas',
          description: `Projektas „${resp.project.pavadinimas}" sukurtas sėkmingai.`,
          variant: 'success',
        });
        navigate(`/projektai/${resp.project.id}`);
      } else {
        // pending — backend dar Iter 10; rodom info žinutę.
        setError(resp.message);
      }
    },
    onError: (err) => {
      const msg = getErrorMessage(err);
      setError(msg);
      toast({ title: msg, variant: 'error' });
    },
  });

  function getErrorMessage(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const data = err.response?.data as { message?: string } | undefined;
      if (data?.message) return data.message;
    }
    if (err instanceof Error) return err.message;
    return 'Įvyko klaida.';
  }

  if (!Number.isFinite(requestId) || requestId <= 0) {
    return (
      <Card className="mx-auto my-12 max-w-md">
        <CardContent className="p-6 text-center text-sm text-destructive">
          Klaidingas prašymo ID.
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
          Nepavyko užkrauti prašymo.
        </CardContent>
      </Card>
    );
  }

  const r = q.data;
  const totalReq = totalRequested(r);
  const totalQ = totalQuarterly(r);
  const canEditNow = canEdit(user, r);
  const canSubmitNow = canSubmit(user, r);
  const canDecideNow = canDecide(user, r);
  const canDeleteNow = canDelete(user, r);

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-4">
        <Link to="/prasymai" className="text-xs text-muted-foreground hover:text-foreground">
          ← Prašymai
        </Link>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {r.projectName || 'Be pavadinimo'}
            </h1>
            <Badge variant={STATUS_VARIANTS[r.status]}>{STATUS_LABELS[r.status]}</Badge>
            <Badge variant="outline">{r.tenantCode}</Badge>
            <Badge variant={r.year > new Date().getFullYear() ? 'secondary' : 'outline'}>
              {r.year}
              {r.year > new Date().getFullYear() ? ' planas' : ''}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Pateikė: {r.createdByName} · {r.tenantName}
            {r.submittedAt && <> · pateikta {fmtDateTime(r.submittedAt)}</>}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canEditNow && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/prasymai/${r.id}/redaguoti`}>
                <Pencil className="h-4 w-4" />
                Redaguoti
              </Link>
            </Button>
          )}
          {canSubmitNow && r.status === 'RETURNED' && (
            <Button
              size="sm"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
            >
              <Send className="h-4 w-4" />
              Pateikti pakartotinai
            </Button>
          )}
          {canDeleteNow && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (window.confirm('Ar tikrai ištrinti šį prašymą?')) {
                  deleteMutation.mutate();
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
              Ištrinti
            </Button>
          )}
          {(r.status === 'SUBMITTED' || r.status === 'APPROVED') &&
            r.year > new Date().getFullYear() &&
            (user?.tenantId === r.tenantId ||
              (user?.tenantIsApprover && user.role === 'admin')) && (
              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  if (
                    window.confirm(
                      `Sukurti einamųjų metų (${new Date().getFullYear()}) juodraštį iš šio plano? Visi laukai bus nukopijuoti, statusas — DRAFT.`,
                    )
                  ) {
                    convertMutation.mutate();
                  }
                }}
                disabled={convertMutation.isPending}
              >
                <Send className="h-4 w-4" />
                Perkelti į {new Date().getFullYear()} m. prašymą
              </Button>
            )}
        </div>
      </div>

      {error && (
        <div
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* AM decision actions */}
      {canDecideNow && (
        <Card className="mb-4 border-primary/40">
          <CardContent className="p-4">
            <p className="mb-3 text-sm font-medium">AM veiksmai šiam prašymui:</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => openDecisionDialog('approve', r)}
                className="bg-emerald-700 hover:bg-emerald-700/90"
              >
                <CheckCircle2 className="h-4 w-4" />
                Patvirtinti
              </Button>
              <Button size="sm" variant="outline" onClick={() => openDecisionDialog('return', r)}>
                <RotateCcw className="h-4 w-4" />
                Grąžinti pataisymui
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => openDecisionDialog('reject', r)}
              >
                <XCircle className="h-4 w-4" />
                Atmesti
              </Button>
            </div>

            {decisionForm.open && (
              <div className="mt-4 space-y-3 rounded-md border border-border bg-muted/30 p-3">
                <p className="text-sm font-medium">
                  {decisionForm.open === 'approve' && 'Patvirtinimo metaduomenys'}
                  {decisionForm.open === 'return' && 'Grąžinimas pataisymui'}
                  {decisionForm.open === 'reject' && 'Atmetimas'}
                </p>
                {decisionForm.open === 'approve' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="d-amount">Skirta suma (EUR)</Label>
                      <Input
                        id="d-amount"
                        type="number"
                        min={0}
                        step="0.01"
                        value={decisionForm.grantedAmount}
                        onChange={(e) =>
                          setDecisionForm((f) => ({ ...f, grantedAmount: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="d-source">Finansavimo šaltinis (programa)</Label>
                      <ClassifierSelect
                        id="d-source"
                        groupCode="source_program"
                        value={decisionForm.fundingSource}
                        onChange={(v) =>
                          setDecisionForm((f) => {
                            // UAT #42 (PA-005): pasirinkus programą — automatiškai
                            // nustatom finansavimo šaltinio tipą iš programos tėvo
                            // (jei programa turi parentId, rodantį į funding_source_type).
                            const prog = v === null ? null : (spLookup.byCode.get(v) ?? null);
                            return {
                              ...f,
                              fundingSource: v ?? '',
                              fundingSourceTypeId:
                                prog && prog.parentId !== null
                                  ? prog.parentId
                                  : f.fundingSourceTypeId,
                            };
                          })
                        }
                        emptyLabel="— Nepasirinkta —"
                        placeholder="Pasirinkite programą"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Programa nustato finansavimo šaltinio tipą (jei susieta).
                      </p>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="d-protocol">Posėdžio protokolas</Label>
                      <Input
                        id="d-protocol"
                        value={decisionForm.protocol}
                        onChange={(e) =>
                          setDecisionForm((f) => ({ ...f, protocol: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="d-order">Įsakymo nr.</Label>
                      <Input
                        id="d-order"
                        value={decisionForm.order}
                        onChange={(e) => setDecisionForm((f) => ({ ...f, order: e.target.value }))}
                      />
                    </div>
                    {/* UAT #42 (PA-006): įsakymo data — date picker (buvo laisvas tekstas). */}
                    <div className="space-y-1">
                      <Label htmlFor="d-order-date">Įsakymo data</Label>
                      <Input
                        id="d-order-date"
                        type="date"
                        value={decisionForm.orderDate}
                        onChange={(e) =>
                          setDecisionForm((f) => ({ ...f, orderDate: e.target.value }))
                        }
                      />
                    </div>
                    {/* UAT #42 (PA-002): prioritetas + pirkimo stadija — AM laukai. */}
                    <div className="space-y-1">
                      <Label htmlFor="d-priority">Prioritetas (1—5)</Label>
                      <Input
                        id="d-priority"
                        type="number"
                        min={1}
                        max={5}
                        value={decisionForm.priority}
                        onChange={(e) =>
                          setDecisionForm((f) => ({ ...f, priority: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="d-procurement">Pirkimo stadija</Label>
                      <select
                        id="d-procurement"
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={decisionForm.procurementStage}
                        onChange={(e) =>
                          setDecisionForm((f) => ({ ...f, procurementStage: e.target.value }))
                        }
                      >
                        <option value="">—</option>
                        <option value="Pradėtas">Pradėtas</option>
                        <option value="Vykdomas">Vykdomas</option>
                        <option value="Užbaigtas">Užbaigtas</option>
                      </select>
                    </div>
                    {/* UAT #42 (PA-003): finansavimo šaltinio laukai — AM laukai. */}
                    <div className="space-y-1">
                      <Label htmlFor="d-funding-from-it">Finansavimas iš IT (EUR)</Label>
                      <Input
                        id="d-funding-from-it"
                        type="number"
                        min={0}
                        step="0.01"
                        value={decisionForm.fundingFromIt}
                        onChange={(e) =>
                          setDecisionForm((f) => ({ ...f, fundingFromIt: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="d-other-funds">Kitos lėšos (EUR)</Label>
                      <Input
                        id="d-other-funds"
                        type="number"
                        min={0}
                        step="0.01"
                        value={decisionForm.otherFunds}
                        onChange={(e) =>
                          setDecisionForm((f) => ({ ...f, otherFunds: e.target.value }))
                        }
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label htmlFor="d-other-funds-source">Kitų lėšų šaltinis</Label>
                      <Input
                        id="d-other-funds-source"
                        value={decisionForm.otherFundsSource}
                        onChange={(e) =>
                          setDecisionForm((f) => ({ ...f, otherFundsSource: e.target.value }))
                        }
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label>Kanclerio potvarkis (PDF)</Label>
                      <AttachmentList
                        requestId={requestId}
                        kind="order_pdf"
                        canUpload
                        uploadKind="order_pdf"
                        uploadLabel="Įkelti potvarkio PDF"
                        emptyText="Dar neįkeltas potvarkio PDF."
                        requestStatus={r.status}
                      />
                    </div>

                    {/* FVM Iter 10 (P03) — AM korekcija */}
                    <div className="col-span-2 space-y-3 rounded-md border border-border bg-muted/30 p-3">
                      <p className="text-xs font-medium">
                        Biudžeto kategorizacija (galima koreguoti)
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Institucijos pasirinkimas pre-fill'inamas. AM gali pakeisti prieš
                        patvirtindama.
                      </p>
                      <div className="space-y-1">
                        <Label htmlFor="d-budget-category">Biudžeto kategorija</Label>
                        <ClassifierSelectById
                          id="d-budget-category"
                          groupCode="budget_category"
                          value={decisionForm.budgetCategoryId}
                          onChange={(v) =>
                            setDecisionForm((f) => {
                              const item =
                                v === null
                                  ? null
                                  : (budgetCategoryLookup.items.find((it) => it.id === v) ?? null);
                              const newCode = item?.code ?? null;
                              const isSpec = newCode === 'spec_programa';
                              return {
                                ...f,
                                budgetCategoryId: v,
                                budgetCategoryCode: newCode,
                                // Reset spec funding type jei kategorija nebe spec_programa
                                specProgramFundingType: isSpec ? f.specProgramFundingType : null,
                                fundingSourceTypeId: isSpec ? f.fundingSourceTypeId : null,
                              };
                            })
                          }
                          emptyLabel="— Nenurodyta —"
                          placeholder="Pasirinkite kategoriją"
                        />
                      </div>

                      {decisionForm.budgetCategoryCode === 'spec_programa' && (
                        <div className="space-y-2" data-testid="decision-spec-program-section">
                          <Label>Spec.prog. finansavimo tipas</Label>
                          <div role="radiogroup" className="space-y-1.5">
                            <DecisionFundingRadio
                              id="d-spft-atskiras"
                              checked={decisionForm.specProgramFundingType === 'atskiras'}
                              onChange={() =>
                                setDecisionForm((f) => ({
                                  ...f,
                                  specProgramFundingType: 'atskiras',
                                }))
                              }
                              label="Su atskiru finansavimu"
                            />
                            <DecisionFundingRadio
                              id="d-spft-biudzeto"
                              checked={decisionForm.specProgramFundingType === 'biudzeto_dalis'}
                              onChange={() =>
                                setDecisionForm((f) => ({
                                  ...f,
                                  specProgramFundingType: 'biudzeto_dalis',
                                  fundingSourceTypeId: null,
                                }))
                              }
                              label="Iš bendrojo biudžeto"
                            />
                            <DecisionFundingRadio
                              id="d-spft-none"
                              checked={decisionForm.specProgramFundingType === null}
                              onChange={() =>
                                setDecisionForm((f) => ({
                                  ...f,
                                  specProgramFundingType: null,
                                  fundingSourceTypeId: null,
                                }))
                              }
                              label="Nenurodyta"
                            />
                          </div>

                          {decisionForm.specProgramFundingType === 'atskiras' && (
                            <div className="space-y-1">
                              <Label htmlFor="d-funding-source-type">
                                Finansavimo šaltinio tipas
                              </Label>
                              <ClassifierSelectById
                                id="d-funding-source-type"
                                groupCode="funding_source_type"
                                value={decisionForm.fundingSourceTypeId}
                                onChange={(v) =>
                                  setDecisionForm((f) => ({
                                    ...f,
                                    fundingSourceTypeId: v,
                                  }))
                                }
                                emptyLabel="— Nenurodyta —"
                                placeholder="Pasirinkite šaltinio tipą"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <Label htmlFor="d-comment">
                    {decisionForm.open === 'reject' ? 'Priežastis (neprivaloma)' : 'Komentaras'}
                    {decisionForm.open === 'return' && <span className="text-destructive"> *</span>}
                  </Label>
                  <textarea
                    id="d-comment"
                    className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder={
                      decisionForm.open === 'reject'
                        ? 'Galite nurodyti priežastį, bet nebūtina.'
                        : ''
                    }
                    value={decisionForm.comment}
                    onChange={(e) => setDecisionForm((f) => ({ ...f, comment: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => decisionMutation.mutate()}
                    disabled={decisionMutation.isPending}
                  >
                    {decisionMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Patvirtinti veiksmą
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDecisionForm((f) => ({ ...f, open: null }))}
                  >
                    Atšaukti
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* FVM projekto sukūrimas — TIK AM tenant'as, TIK kai status=APPROVED (Iter 11, real impl).
          Jei projektas jau sukurtas (fvmProjectId != null) — rodom „Žiūrėti projektą" link'ą. */}
      {r.status === 'APPROVED' && user?.tenantIsApprover === true && (
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">FVM projektas</p>
                <p className="text-xs text-muted-foreground">
                  {r.fvmProjectId !== null
                    ? 'Iš šio prašymo jau sukurtas FVM projektas.'
                    : 'Iš patvirtinto prašymo automatiškai sukuriamas FVM projektas su biudžetu = patvirtinta suma.'}
                </p>
              </div>
              {r.fvmProjectId !== null ? (
                <Button asChild size="sm" variant="outline" data-testid="view-fvm-project-btn">
                  <Link to={`/projektai/${r.fvmProjectId}`}>
                    <Briefcase className="h-4 w-4" />
                    Žiūrėti projektą →
                  </Link>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  title="Sukurti spec.programos vykdymo projektą"
                  onClick={() => createFvmProjectMutation.mutate()}
                  disabled={createFvmProjectMutation.isPending}
                  data-testid="create-fvm-project-btn"
                >
                  {createFvmProjectMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Briefcase className="h-4 w-4" />
                  )}
                  Sukurti FVM projektą
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* UAT #42 (PA-008): prašymas + atsiskaitymas atskirti į tab'us. Abu tab'us
          mato tiek teikėjas, tiek AM. Atsiskaitymą AM gali tik peržiūrėti (PA-009). */}
      <Tabs defaultValue="prasymas">
        <TabsList>
          <TabsTrigger value="prasymas" data-testid="tab-prasymas">
            Prašymas
          </TabsTrigger>
          <TabsTrigger value="atsiskaitymas" data-testid="tab-atsiskaitymas">
            Atsiskaitymas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="prasymas">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-4">
              <Section title="Pagrindinė informacija">
                <KV label="Informacinė sistema">{classifierLabel(isLookup, r.systemCode)}</KV>
                <KV label="Projekto tipas">{classifierLabel(ptLookup, r.projectType)}</KV>
                <KV label="Prioritetas">{r.priority !== null ? String(r.priority) : '—'}</KV>
                <KV label="Pirkimo stadija">{r.procurementStage ?? '—'}</KV>
                <KV label="Aprašymas" wide>
                  <p className="whitespace-pre-wrap text-sm">{r.description || '—'}</p>
                </KV>
                <KV label="Planuojami darbai" wide>
                  <p className="whitespace-pre-wrap text-sm">{r.plannedWorks || '—'}</p>
                </KV>
              </Section>

              <Section title="Finansavimas">
                <KV label="DU">{fmtEur(r.costDu)}</KV>
                <KV label="Įranga / licencijos">{fmtEur(r.costEquipment)}</KV>
                <KV label="Kūrimas">{fmtEur(r.costCreation)}</KV>
                <KV label="Analizė">{fmtEur(r.costAnalysis)}</KV>
                <KV label="Vystymas">{fmtEur(r.costDevelopment)}</KV>
                <KV label="Palaikymas">{fmtEur(r.costMaintenance)}</KV>
                <KV label="Modernizavimas">{fmtEur(r.costModernization)}</KV>
                <KV label="Likvidavimas">{fmtEur(r.costDecommissioning)}</KV>
                <KV label="Iš viso prašoma" emph>
                  {fmtEur(totalReq)}
                </KV>
                <KV label="Finansavimas iš IT">{fmtEur(r.fundingFromIt)}</KV>
                <KV label="Kitos lėšos">{fmtEur(r.otherFunds)}</KV>
                <KV label="Kitų lėšų šaltinis">{r.otherFundsSource ?? '—'}</KV>
              </Section>

              {/* FVM Iter 10 — biudžeto informacija (read-only; redaguoja wizard'as). */}
              <Section title="Biudžeto informacija">
                <KV label="Biudžeto kategorija">
                  {r.budgetCategoryId === null
                    ? 'Nenurodyta'
                    : (r.budgetCategoryName ??
                      classifierItemNameByIdFromLookup(budgetCategoryLookup, r.budgetCategoryId))}
                </KV>
                {r.budgetCategoryCode === 'spec_programa' && (
                  <KV label="Spec.prog. finansavimo tipas">
                    {r.specProgramFundingType === null
                      ? 'Nenurodyta'
                      : r.specProgramFundingType === 'atskiras'
                        ? 'Su atskiru finansavimu'
                        : 'Iš bendrojo biudžeto'}
                  </KV>
                )}
                {r.specProgramFundingType === 'atskiras' && (
                  <KV label="Finansavimo šaltinio tipas">
                    {r.fundingSourceTypeId === null
                      ? '—'
                      : (r.fundingSourceTypeName ??
                        classifierItemNameByIdFromLookup(
                          fundingSourceTypeLookup,
                          r.fundingSourceTypeId,
                        ))}
                  </KV>
                )}
              </Section>

              <Section title="Ketvirtinis paskirstymas">
                <KV label="I ketv.">{fmtEur(r.q1Amount)}</KV>
                <KV label="II ketv.">{fmtEur(r.q2Amount)}</KV>
                <KV label="III ketv.">{fmtEur(r.q3Amount)}</KV>
                <KV label="IV ketv.">{fmtEur(r.q4Amount)}</KV>
                <KV label="Viso ketv." emph>
                  {fmtEur(totalQ)}
                </KV>
              </Section>

              <Section title="Atsakingi asmenys">
                <KV label="Atsakinga įstaiga">{r.responsibleInstitution ?? '—'}</KV>
                <KV label="Vykdo">{r.executorName ?? '—'}</KV>
                <KV label="El. paštas">{r.executorEmail ?? '—'}</KV>
                <KV label="Terminas">{fmtDate(r.implementationDeadline)}</KV>
                <KV label="Pastabos" wide>
                  <p className="whitespace-pre-wrap text-sm">{r.submitterNotes || '—'}</p>
                </KV>
              </Section>

              {(r.status === 'APPROVED' || r.status === 'REJECTED') && (
                <Section title="Sprendimas">
                  <KV label="Statusas">{STATUS_LABELS[r.status]}</KV>
                  <KV label="Sprendė">{r.decidedByName ?? '—'}</KV>
                  <KV label="Data">{fmtDateTime(r.decidedAt)}</KV>
                  <KV label="Skirta suma" emph>
                    {fmtEur(r.decisionGrantedAmount)}
                  </KV>
                  <KV label="Finansavimo šaltinis (programa)">
                    {classifierLabel(spLookup, r.decisionFundingSource)}
                  </KV>
                  <KV label="Protokolas">{r.decisionProtocol ?? '—'}</KV>
                  <KV label="Įsakymo nr.">{r.decisionOrder ?? '—'}</KV>
                  <KV label="Įsakymo data">{fmtDate(r.decisionOrderDate)}</KV>
                  <KV label="Potvarkio PDF" wide>
                    <AttachmentList
                      requestId={requestId}
                      kind="order_pdf"
                      canUpload={user?.tenantIsApprover === true && user.role === 'admin'}
                      uploadKind="order_pdf"
                      uploadLabel="Įkelti papildomą versiją"
                      emptyText="Potvarkio PDF nepriklijuotas."
                      requestStatus={r.status}
                    />
                  </KV>
                </Section>
              )}
            </div>

            <div className="space-y-4">
              <Card>
                <CardContent className="p-4">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                    <CheckCircle2 className="h-4 w-4" />
                    Aprobacijos eiga
                  </h3>
                  <ApprovalStepsList steps={r.approvalSteps ?? []} />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                    <MessageCircle className="h-4 w-4" />
                    Komentarai ir istorija
                  </h3>
                  <ul className="space-y-3" data-testid="comments-list">
                    {r.comments.length === 0 ? (
                      <li className="text-xs text-muted-foreground">Komentarų dar nėra.</li>
                    ) : (
                      r.comments.map((c) => (
                        <li key={c.id} className="rounded-md bg-muted/30 p-3 text-sm">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                                KIND_COLORS[c.kind],
                              )}
                            >
                              {KIND_LABELS[c.kind]}
                            </span>
                            <span className="text-xs font-medium">{c.authorName}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {ROLE_LABELS[c.authorRole]}
                            </span>
                          </div>
                          {c.body && <p className="whitespace-pre-wrap text-sm">{c.body}</p>}
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {fmtDateTime(c.createdAt)}
                          </p>
                        </li>
                      ))
                    )}
                  </ul>

                  <div className="mt-4 space-y-2 border-t border-border pt-3">
                    <Label htmlFor="new-comment">Pridėti komentarą</Label>
                    <textarea
                      id="new-comment"
                      className="min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                    />
                    <Button
                      size="sm"
                      disabled={!commentBody.trim() || addComment.isPending}
                      onClick={() => addComment.mutate(commentBody)}
                    >
                      Skelbti
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="atsiskaitymas">
          <Card>
            <CardContent className="p-4">
              <h3 className="mb-3 text-sm font-semibold">Atsiskaitymai</h3>
              {/* PA-008/PA-009: AM (tvirtintojas) mato pateiktus atsiskaitymus,
                  bet jų NEvaldo — `isSubmitterSide` lieka tik teikėjui. */}
              <ReportsSection
                requestId={requestId}
                isApproved={r.status === 'APPROVED'}
                isSubmitterSide={user?.tenantId === r.tenantId && user?.tenantIsApprover !== true}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
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
      <dd className={cn(wide ? 'col-span-2' : 'text-right tabular-nums', emph && 'font-semibold')}>
        {children}
      </dd>
    </>
  );
}

/**
 * Fallback'ininkas, kai backend negrąžino `budgetCategoryName` (legacy ar
 * lookup'as ne-prefetched). Naudoja React Query cache su lookup'u.
 */
function classifierItemNameByIdFromLookup(
  lookup: import('@/lib/classifiers').ClassifierLookup,
  id: number,
): string {
  const item = lookup.items.find((it) => it.id === id);
  return item?.name ?? `#${id}`;
}

function DecisionFundingRadio({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: () => void;
  label: string;
}): JSX.Element {
  return (
    <div className="flex items-start gap-2">
      <input
        type="radio"
        id={id}
        name="d-spec-program-funding"
        checked={checked}
        onChange={onChange}
        className="mt-1 h-4 w-4 cursor-pointer"
      />
      <Label htmlFor={id} className="cursor-pointer text-sm font-normal leading-snug">
        {label}
      </Label>
    </div>
  );
}
