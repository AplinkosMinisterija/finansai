/**
 * RequestWizard — multi-step prašymo forma (kaip GPAIS).
 * Naudojama tiek naujam prašymui (po create), tiek esamam DRAFT/RETURNED redagavimui.
 *
 * 5 žingsniai:
 *   1. Pagrindinė informacija
 *   2. Finansavimas
 *   3. Ketvirtinis paskirstymas (validacija — suma turi atitikti viso prašoma)
 *   4. Atsakingi asmenys
 *   5. Peržiūra + Pateikti
 *
 * Auto-save: po kiekvieno žingsnio (Toliau / Atgal) PATCH'ina į backend.
 * Submit: 5-am žingsnyje paspaudus „Pateikti" — POST /requests/:id/submit.
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { ChevronLeft, ChevronRight, Loader2, Send } from 'lucide-react';
import type {
  FinancingRequest,
  RequestPayload,
} from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestSubmit, requestUpdate } from '@/lib/api';
import { fmtEur } from '@/lib/requests';
import { ClassifierSelect } from '@/components/classifiers/ClassifierSelect';
import { classifierLabel, useClassifier } from '@/lib/classifiers';
import { cn } from '@/lib/utils';

interface StepDef {
  key: 'info' | 'financing' | 'quarterly' | 'responsible' | 'review';
  label: string;
}

const STEPS: StepDef[] = [
  { key: 'info', label: 'Pagrindinė informacija' },
  { key: 'financing', label: 'Finansavimas' },
  { key: 'quarterly', label: 'Ketvirtinis paskirstymas' },
  { key: 'responsible', label: 'Atsakingi asmenys' },
  { key: 'review', label: 'Peržiūra' },
];

interface FormState {
  projectName: string;
  systemCode: string;
  projectType: string;
  description: string;
  plannedWorks: string;
  priority: string;
  procurementStage: string;

  costDu: string;
  costEquipment: string;
  costCreation: string;
  costAnalysis: string;
  costDevelopment: string;
  costMaintenance: string;
  costModernization: string;
  costDecommissioning: string;
  fundingFromIt: string;
  otherFunds: string;
  otherFundsSource: string;

  q1Amount: string;
  q2Amount: string;
  q3Amount: string;
  q4Amount: string;

  responsibleInstitution: string;
  executorName: string;
  executorEmail: string;
  implementationDeadline: string;
  submitterNotes: string;
}

function s(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function fromRequest(r: FinancingRequest): FormState {
  return {
    projectName: r.projectName ?? '',
    systemCode: r.systemCode ?? '',
    projectType: r.projectType ?? '',
    description: r.description ?? '',
    plannedWorks: r.plannedWorks ?? '',
    priority: r.priority !== null ? String(r.priority) : '',
    procurementStage: r.procurementStage ?? '',
    costDu: s(r.costDu),
    costEquipment: s(r.costEquipment),
    costCreation: s(r.costCreation),
    costAnalysis: s(r.costAnalysis),
    costDevelopment: s(r.costDevelopment),
    costMaintenance: s(r.costMaintenance),
    costModernization: s(r.costModernization),
    costDecommissioning: s(r.costDecommissioning),
    fundingFromIt: s(r.fundingFromIt),
    otherFunds: s(r.otherFunds),
    otherFundsSource: r.otherFundsSource ?? '',
    q1Amount: s(r.q1Amount),
    q2Amount: s(r.q2Amount),
    q3Amount: s(r.q3Amount),
    q4Amount: s(r.q4Amount),
    responsibleInstitution: r.responsibleInstitution ?? '',
    executorName: r.executorName ?? '',
    executorEmail: r.executorEmail ?? '',
    implementationDeadline: r.implementationDeadline ?? '',
    submitterNotes: r.submitterNotes ?? '',
  };
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function toPayload(state: FormState): RequestPayload {
  return {
    projectName: state.projectName,
    systemCode: state.systemCode || null,
    projectType: state.projectType || null,
    description: state.description || null,
    plannedWorks: state.plannedWorks || null,
    priority: state.priority ? Number(state.priority) : null,
    procurementStage: state.procurementStage || null,

    costDu: num(state.costDu),
    costEquipment: num(state.costEquipment),
    costCreation: num(state.costCreation),
    costAnalysis: num(state.costAnalysis),
    costDevelopment: num(state.costDevelopment),
    costMaintenance: num(state.costMaintenance),
    costModernization: num(state.costModernization),
    costDecommissioning: num(state.costDecommissioning),
    fundingFromIt: num(state.fundingFromIt),
    otherFunds: num(state.otherFunds),
    otherFundsSource: state.otherFundsSource || null,

    q1Amount: num(state.q1Amount),
    q2Amount: num(state.q2Amount),
    q3Amount: num(state.q3Amount),
    q4Amount: num(state.q4Amount),

    responsibleInstitution: state.responsibleInstitution || null,
    executorName: state.executorName || null,
    executorEmail: state.executorEmail || null,
    implementationDeadline: state.implementationDeadline || null,
    submitterNotes: state.submitterNotes || null,
  };
}

function totalRequestedFrom(state: FormState): number {
  return (
    num(state.costEquipment) +
    num(state.costCreation) +
    num(state.costAnalysis) +
    num(state.costDevelopment) +
    num(state.costMaintenance) +
    num(state.costModernization) +
    num(state.costDecommissioning)
  );
}

function totalQuarterlyFrom(state: FormState): number {
  return (
    num(state.q1Amount) + num(state.q2Amount) + num(state.q3Amount) + num(state.q4Amount)
  );
}

export interface RequestWizardProps {
  request: FinancingRequest;
  onSaved: (r: FinancingRequest) => void;
}

export function RequestWizard({ request, onSaved }: RequestWizardProps): JSX.Element {
  const navigate = useNavigate();
  const [step, setStep] = React.useState(0);
  const [state, setState] = React.useState<FormState>(() => fromRequest(request));
  const [error, setError] = React.useState<string | null>(null);

  const update = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setState((prev) => ({ ...prev, [k]: e.target.value }));

  const totalReq = totalRequestedFrom(state);
  const totalQ = totalQuarterlyFrom(state);
  const quarterlyDiff = totalQ - totalReq;

  const isLookup = useClassifier('is_system');
  const ptLookup = useClassifier('project_type');

  const saveMutation = useMutation({
    mutationFn: (): Promise<FinancingRequest> => requestUpdate(request.id, toPayload(state)),
    onSuccess: (r) => onSaved(r),
    onError: (err) => setError(getErrorMessage(err)),
  });

  const submitMutation = useMutation({
    mutationFn: async (): Promise<FinancingRequest> => {
      await requestUpdate(request.id, toPayload(state));
      return requestSubmit(request.id);
    },
    onSuccess: (r) => {
      onSaved(r);
      navigate(`/prasymai/${r.id}`);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  function getErrorMessage(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const data = err.response?.data as { message?: string } | undefined;
      if (data?.message) return data.message;
    }
    if (err instanceof Error) return err.message;
    return 'Įvyko klaida.';
  }

  function validateStep(): string | null {
    setError(null);
    if (step === 0) {
      if (!state.projectName.trim()) return 'Projekto pavadinimas privalomas.';
    }
    if (step === 2) {
      if (Math.abs(quarterlyDiff) > 0.01) {
        return `Ketvirčių suma ${fmtEur(totalQ)} nesutampa su prašoma ${fmtEur(totalReq)}.`;
      }
    }
    if (step === 3) {
      if (state.executorEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(state.executorEmail)) {
        return 'Patikrinkite el. paštą.';
      }
    }
    return null;
  }

  async function next(): Promise<void> {
    const v = validateStep();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    await saveMutation.mutateAsync();
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }

  function back(): void {
    setStep((s) => Math.max(0, s - 1));
  }

  async function submit(): Promise<void> {
    const v = validateStep();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    await submitMutation.mutateAsync();
  }

  const filledCount = step + 1;

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {request.status === 'RETURNED' ? 'Pataisymas' : 'Naujas prašymas'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {request.projectName || 'Be pavadinimo'} ·{' '}
          {request.tenantCode}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        {/* Step sidebar */}
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
              Užpildyta {filledCount} iš {STEPS.length}
            </p>
            <ol className="space-y-1">
              {STEPS.map((s, i) => {
                const isActive = step === i;
                const isDone = step > i;
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => setStep(i)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm',
                        isActive
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-foreground hover:bg-muted',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : isDone
                              ? 'bg-primary/80 text-primary-foreground'
                              : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className="flex-1">{s.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>

        {/* Step content */}
        <Card>
          <CardContent className="space-y-4 p-6">
            {step === 0 && (
              <>
                <h2 className="text-lg font-semibold">{STEPS[0]?.label}</h2>
                <div className="space-y-2">
                  <Label htmlFor="projectName">Projekto pavadinimas *</Label>
                  <Input
                    id="projectName"
                    required
                    value={state.projectName}
                    onChange={update('projectName')}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="systemCode">Informacinė sistema</Label>
                    <ClassifierSelect
                      id="systemCode"
                      groupCode="is_system"
                      value={state.systemCode}
                      onChange={(v) => setState((s) => ({ ...s, systemCode: v ?? '' }))}
                      emptyLabel="— Nepasirinkta —"
                      placeholder="Pasirinkite IS"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="projectType">Projekto tipas</Label>
                    <ClassifierSelect
                      id="projectType"
                      groupCode="project_type"
                      value={state.projectType}
                      onChange={(v) => setState((s) => ({ ...s, projectType: v ?? '' }))}
                      emptyLabel="— Nepasirinkta —"
                      placeholder="Pasirinkite tipą"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Aprašymas</Label>
                  <textarea
                    id="description"
                    className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={state.description}
                    onChange={update('description')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plannedWorks">Planuojami atlikti darbai</Label>
                  <textarea
                    id="plannedWorks"
                    className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={state.plannedWorks}
                    onChange={update('plannedWorks')}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="priority">Prioritetas (1—5)</Label>
                    <Input
                      id="priority"
                      type="number"
                      min={1}
                      max={5}
                      value={state.priority}
                      onChange={update('priority')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="procurementStage">Pirkimo stadija</Label>
                    <select
                      id="procurementStage"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={state.procurementStage}
                      onChange={update('procurementStage')}
                    >
                      <option value="">—</option>
                      <option value="Pradėtas">Pradėtas</option>
                      <option value="Vykdomas">Vykdomas</option>
                      <option value="Užbaigtas">Užbaigtas</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <h2 className="text-lg font-semibold">{STEPS[1]?.label}</h2>
                <p className="text-xs text-muted-foreground">
                  Sumos eurais. Bendra suma „Iš viso prašoma" suskaičiuojama automatiškai.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <CostField label="DU (darbo užmokestis)" k="costDu" state={state} onChange={update} />
                  <CostField label="Įranga / licencijos" k="costEquipment" state={state} onChange={update} />
                  <CostField label="Kūrimas" k="costCreation" state={state} onChange={update} />
                  <CostField label="Analizė" k="costAnalysis" state={state} onChange={update} />
                  <CostField label="Vystymas" k="costDevelopment" state={state} onChange={update} />
                  <CostField label="Palaikymas" k="costMaintenance" state={state} onChange={update} />
                  <CostField label="Modernizavimas" k="costModernization" state={state} onChange={update} />
                  <CostField label="Likvidavimas" k="costDecommissioning" state={state} onChange={update} />
                </div>

                <div className="rounded-md bg-muted/50 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span>Iš viso prašoma (be DU)</span>
                    <span className="font-semibold tabular-nums">{fmtEur(totalReq)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <CostField label="Finansavimas iš IT" k="fundingFromIt" state={state} onChange={update} />
                  <CostField label="Kitos lėšos" k="otherFunds" state={state} onChange={update} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="otherFundsSource">Kitų lėšų šaltinis</Label>
                  <Input
                    id="otherFundsSource"
                    value={state.otherFundsSource}
                    onChange={update('otherFundsSource')}
                  />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2 className="text-lg font-semibold">{STEPS[2]?.label}</h2>
                <p className="text-xs text-muted-foreground">
                  Įveskite planuojamą lėšų panaudojimą pagal ketvirčius. Suma turi atitikti
                  „Iš viso prašoma" = {fmtEur(totalReq)}.
                </p>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <CostField label="I ketv." k="q1Amount" state={state} onChange={update} />
                  <CostField label="II ketv." k="q2Amount" state={state} onChange={update} />
                  <CostField label="III ketv." k="q3Amount" state={state} onChange={update} />
                  <CostField label="IV ketv." k="q4Amount" state={state} onChange={update} />
                </div>

                <div className="rounded-md bg-muted/50 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span>Ketvirčių suma</span>
                    <span className="font-semibold tabular-nums">{fmtEur(totalQ)}</span>
                  </div>
                  <div
                    className={cn(
                      'mt-1 flex items-center justify-between text-xs',
                      Math.abs(quarterlyDiff) > 0.01
                        ? 'text-destructive'
                        : 'text-muted-foreground',
                    )}
                  >
                    <span>Skirtumas su prašoma suma</span>
                    <span className="tabular-nums">{fmtEur(quarterlyDiff)}</span>
                  </div>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h2 className="text-lg font-semibold">{STEPS[3]?.label}</h2>
                <div className="space-y-2">
                  <Label htmlFor="responsibleInstitution">Atsakinga įstaiga</Label>
                  <Input
                    id="responsibleInstitution"
                    value={state.responsibleInstitution}
                    onChange={update('responsibleInstitution')}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="executorName">Projektą vykdantis asmuo</Label>
                    <Input id="executorName" value={state.executorName} onChange={update('executorName')} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="executorEmail">El. paštas</Label>
                    <Input
                      id="executorEmail"
                      type="email"
                      value={state.executorEmail}
                      onChange={update('executorEmail')}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="implementationDeadline">Projekto įgyvendinimo terminas</Label>
                  <Input
                    id="implementationDeadline"
                    type="date"
                    value={state.implementationDeadline}
                    onChange={update('implementationDeadline')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="submitterNotes">Pastabos</Label>
                  <textarea
                    id="submitterNotes"
                    className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={state.submitterNotes}
                    onChange={update('submitterNotes')}
                  />
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <h2 className="text-lg font-semibold">{STEPS[4]?.label}</h2>
                <p className="text-xs text-muted-foreground">
                  Patikrinkite duomenis ir paspauskite „Pateikti". Po pateikimo prašymas keliauja AM tvirtinimui.
                </p>
                <ReviewSection title="Pagrindinė informacija">
                  <KV label="Projektas">{state.projectName || '—'}</KV>
                  <KV label="IT sistema">{classifierLabel(isLookup, state.systemCode)}</KV>
                  <KV label="Tipas">{classifierLabel(ptLookup, state.projectType)}</KV>
                  <KV label="Prioritetas">{state.priority || '—'}</KV>
                  <KV label="Pirkimo stadija">{state.procurementStage || '—'}</KV>
                </ReviewSection>
                <ReviewSection title="Finansavimas">
                  <KV label="Įranga / licencijos">{fmtEur(state.costEquipment)}</KV>
                  <KV label="Kūrimas">{fmtEur(state.costCreation)}</KV>
                  <KV label="Analizė">{fmtEur(state.costAnalysis)}</KV>
                  <KV label="Vystymas">{fmtEur(state.costDevelopment)}</KV>
                  <KV label="Palaikymas">{fmtEur(state.costMaintenance)}</KV>
                  <KV label="Modernizavimas">{fmtEur(state.costModernization)}</KV>
                  <KV label="Likvidavimas">{fmtEur(state.costDecommissioning)}</KV>
                  <KV label="Iš viso prašoma" emph>{fmtEur(totalReq)}</KV>
                  <KV label="Finansavimas iš IT">{fmtEur(state.fundingFromIt)}</KV>
                  <KV label="Kitos lėšos">{fmtEur(state.otherFunds)}</KV>
                </ReviewSection>
                <ReviewSection title="Ketvirtinis paskirstymas">
                  <KV label="I ketv.">{fmtEur(state.q1Amount)}</KV>
                  <KV label="II ketv.">{fmtEur(state.q2Amount)}</KV>
                  <KV label="III ketv.">{fmtEur(state.q3Amount)}</KV>
                  <KV label="IV ketv.">{fmtEur(state.q4Amount)}</KV>
                  <KV label="Viso ketv." emph>{fmtEur(totalQ)}</KV>
                </ReviewSection>
                <ReviewSection title="Atsakingi asmenys">
                  <KV label="Atsakinga įstaiga">{state.responsibleInstitution || '—'}</KV>
                  <KV label="Vykdo">{state.executorName || '—'}</KV>
                  <KV label="El. paštas">{state.executorEmail || '—'}</KV>
                  <KV label="Terminas">{state.implementationDeadline || '—'}</KV>
                </ReviewSection>
              </>
            )}

            {error && (
              <div
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {error}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Footer actions */}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate('/prasymai')}
          >
            Atšaukti
          </Button>
          {step > 0 && (
            <Button type="button" variant="outline" onClick={back}>
              <ChevronLeft className="h-4 w-4" />
              Atgal
            </Button>
          )}
        </div>
        <div className="flex gap-2 sm:ml-auto">
          {step < STEPS.length - 1 ? (
            <Button
              type="button"
              onClick={() => {
                void next();
              }}
              disabled={saveMutation.isPending}
              data-testid="wizard-next"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Toliau
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => {
                void submit();
              }}
              disabled={submitMutation.isPending}
              data-testid="wizard-submit"
            >
              {submitMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Pateikti AM
            </Button>
          )}
        </div>
      </div>

      {request.status === 'RETURNED' && step === 0 && (
        <Badge variant="warning" className="mt-3">
          Prašymas buvo grąžintas pataisymui — peržiūrėkite komentarus prašymo detalėje
        </Badge>
      )}
    </div>
  );
}

function CostField({
  label,
  k,
  state,
  onChange,
}: {
  label: string;
  k: keyof FormState;
  state: FormState;
  onChange: (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => void;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <Label htmlFor={`f-${k}`}>{label}</Label>
      <Input
        id={`f-${k}`}
        type="number"
        min={0}
        step="0.01"
        value={state[k]}
        onChange={onChange(k)}
        className="tabular-nums"
      />
    </div>
  );
}

function ReviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-md border border-border p-3">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">{children}</dl>
    </section>
  );
}

function KV({
  label,
  emph,
  children,
}: {
  label: string;
  emph?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('text-right tabular-nums', emph && 'font-semibold')}>{children}</dd>
    </>
  );
}
