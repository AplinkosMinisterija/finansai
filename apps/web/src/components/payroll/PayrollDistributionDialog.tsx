/**
 * `PayrollDistributionDialog` — CRUD modal'as DU paskirstymui (Iter 13, FVM-5).
 *
 * Per kiekvieną profile'į galimi keli paskirstymai (skirtingiems finansavimo
 * šaltiniams). Kiekvienas paskirstymas turi:
 *  - funding_source pasirinkimą (tenant-scope'as backende)
 *  - paskirstymo_tipas radio (procentais | fiksuota)
 *  - reiksme (jei procentais — 0-100; jei fiksuota — > 0 €)
 *  - galioja_nuo / galioja_iki
 *
 * Backend validuoja `SUM(procentais.reiksme) per overlap'inantį periodą ≤ 100`
 * ir grąžina LT klaidos žinutę 400 atveju.
 *
 * SAUGUMAS: paveldima per puslapio gating'ą (route guard). Defense-in-depth —
 * jei vartotojas neturi prieigos, mutation blocked.
 */
import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import type {
  DistributionType,
  FundingSource,
  PayrollDistribution,
  PayrollDistributionCreateDTO,
  PayrollDistributionUpdateDTO,
  PayrollProfile,
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fundingSourcesApi, payrollApi } from '@/lib/api/fvm';
import { useAuth } from '@/lib/auth';
import { canViewPayroll } from '@/lib/roles';

const DISTRIBUTION_TYPES: readonly DistributionType[] = ['procentais', 'fiksuota'];

const DISTRIBUTION_TYPE_LABELS: Record<DistributionType, string> = {
  procentais: 'Procentais (%)',
  fiksuota: 'Fiksuota suma (€)',
};

interface FormState {
  fundingSourceId: string;
  paskirstymoTipas: DistributionType;
  reiksme: string;
  galiojaNuo: string;
  galiojaIki: string;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeAmountInput(input: string): string {
  const cleaned = input.replace(/\s/g, '').replace(',', '.');
  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num)) return '0.00';
  return num.toFixed(2);
}

function normalizePercentInput(input: string): string {
  const cleaned = input.replace(/\s/g, '').replace(',', '.');
  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num)) return '0.00';
  return num.toFixed(4);
}

function emptyForm(defaults: { galiojaNuo: string }): FormState {
  return {
    fundingSourceId: '',
    paskirstymoTipas: 'procentais',
    reiksme: '',
    galiojaNuo: defaults.galiojaNuo,
    galiojaIki: '',
  };
}

function fromDistribution(d: PayrollDistribution): FormState {
  return {
    fundingSourceId: String(d.fundingSourceId),
    paskirstymoTipas: d.paskirstymoTipas,
    reiksme: d.reiksme,
    galiojaNuo: d.galiojaNuo.slice(0, 10),
    galiojaIki: d.galiojaIki ? d.galiojaIki.slice(0, 10) : '',
  };
}

export interface PayrollDistributionDialogProps {
  mode: 'create' | 'edit';
  distribution: PayrollDistribution | null;
  /** Profile, kuriam priskirtas paskirstymas — privalomas tiek create, tiek edit. */
  profile: PayrollProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (d: PayrollDistribution) => void;
}

export function PayrollDistributionDialog({
  mode,
  distribution,
  profile,
  open,
  onOpenChange,
  onSuccess,
}: PayrollDistributionDialogProps): JSX.Element {
  const { user } = useAuth();
  const hasAccess = canViewPayroll(user);

  const [state, setState] = React.useState<FormState>(
    distribution
      ? fromDistribution(distribution)
      : emptyForm({ galiojaNuo: profile.galiojaNuo.slice(0, 10) || todayIso() }),
  );
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValidationError(null);
    setServerError(null);
    setState(
      distribution
        ? fromDistribution(distribution)
        : emptyForm({
            galiojaNuo: profile.galiojaNuo.slice(0, 10) || todayIso(),
          }),
    );
  }, [distribution, profile, open]);

  // Filtruojam tik to paties tenant'o šaltinius kaip profile.
  const sourcesQ = useQuery<FundingSource[]>({
    queryKey: ['fundingSources', { tenantId: profile.tenantId }],
    queryFn: () => fundingSourcesApi.list({ tenantId: profile.tenantId }),
    enabled: hasAccess,
  });

  const mutation = useMutation({
    mutationFn: async (): Promise<PayrollDistribution> => {
      if (!hasAccess) {
        throw new Error('Neturite teisės valdyti DU duomenų.');
      }
      const fundingSourceId = Number.parseInt(state.fundingSourceId, 10);
      const reiksme =
        state.paskirstymoTipas === 'procentais'
          ? normalizePercentInput(state.reiksme)
          : normalizeAmountInput(state.reiksme);
      const galiojaIki = state.galiojaIki === '' ? null : state.galiojaIki;

      if (mode === 'create') {
        const body: PayrollDistributionCreateDTO = {
          payrollProfileId: profile.id,
          fundingSourceId,
          paskirstymoTipas: state.paskirstymoTipas,
          reiksme,
          galiojaNuo: state.galiojaNuo,
          galiojaIki,
        };
        return payrollApi.createDistribution(body);
      }
      if (!distribution) throw new Error('Nėra paskirstymo, kurį atnaujinti.');
      const patch: PayrollDistributionUpdateDTO = {
        fundingSourceId,
        paskirstymoTipas: state.paskirstymoTipas,
        reiksme,
        galiojaNuo: state.galiojaNuo,
        galiojaIki,
      };
      return payrollApi.updateDistribution(distribution.id, patch);
    },
    onSuccess: (d) => onSuccess(d),
    onError: (err: unknown) => {
      let msg = 'Nepavyko išsaugoti paskirstymo.';
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
    if (state.fundingSourceId === '') {
      return 'Pasirinkite finansavimo šaltinį.';
    }
    const reiksmeNum = Number.parseFloat(state.reiksme.replace(',', '.'));
    if (!Number.isFinite(reiksmeNum) || reiksmeNum <= 0) {
      return 'Reikšmė turi būti didesnė už 0.';
    }
    if (state.paskirstymoTipas === 'procentais' && reiksmeNum > 100) {
      return 'Procentai negali viršyti 100.';
    }
    if (state.galiojaNuo === '') {
      return 'Įveskite galiojimo pradžios datą.';
    }
    if (state.galiojaIki !== '' && state.galiojaIki < state.galiojaNuo) {
      return 'Galiojimo pabaigos data negali būti ankstesnė už pradžios datą.';
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
  const sources = sourcesQ.data ?? [];
  const errorMsg = serverError ?? validationError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {isCreate ? 'Naujas DU paskirstymas' : 'Redaguoti paskirstymą'}
            </DialogTitle>
            <DialogDescription>
              {profile.vardasPavarde} — paskirstymas tarp finansavimo šaltinių.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="pd-source">Finansavimo šaltinis</Label>
              <Select
                value={state.fundingSourceId}
                onValueChange={(v) =>
                  setState((s) => ({ ...s, fundingSourceId: v }))
                }
              >
                <SelectTrigger id="pd-source" data-testid="distribution-source-trigger">
                  <SelectValue placeholder="Pasirinkite finansavimo šaltinį" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.pavadinimas} ({s.kodas}, {s.metai})
                    </SelectItem>
                  ))}
                  {sources.length === 0 && (
                    <div className="px-2 py-3 text-xs text-muted-foreground">
                      Šiame tenant'e nėra finansavimo šaltinių.
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Paskirstymo tipas</Label>
              <div
                role="radiogroup"
                aria-label="Paskirstymo tipas"
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                data-testid="distribution-tipas-radiogroup"
              >
                {DISTRIBUTION_TYPES.map((t) => (
                  <label
                    key={t}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-border p-2 text-sm hover:bg-muted/50"
                  >
                    <input
                      type="radio"
                      name="distribution-tipas"
                      value={t}
                      checked={state.paskirstymoTipas === t}
                      onChange={() =>
                        setState((s) => ({ ...s, paskirstymoTipas: t }))
                      }
                      className="h-4 w-4"
                    />
                    {DISTRIBUTION_TYPE_LABELS[t]}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pd-reiksme">
                Reikšmė {state.paskirstymoTipas === 'procentais' ? '(%)' : '(€)'}
              </Label>
              <Input
                id="pd-reiksme"
                inputMode="decimal"
                required
                placeholder={state.paskirstymoTipas === 'procentais' ? '50' : '750.00'}
                value={state.reiksme}
                onChange={(e) =>
                  setState((s) => ({ ...s, reiksme: e.target.value }))
                }
                data-testid="distribution-reiksme-input"
              />
              <p className="text-[11px] text-muted-foreground">
                {state.paskirstymoTipas === 'procentais'
                  ? 'Procentinė dalis nuo mėnesio bendros sumos (0-100). Bendra SUM(%) per persidengiantį periodą ≤ 100.'
                  : 'Fiksuota suma eurais per mėnesį.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pd-galioja-nuo">Galioja nuo</Label>
                <Input
                  id="pd-galioja-nuo"
                  type="date"
                  required
                  value={state.galiojaNuo}
                  onChange={(e) =>
                    setState((s) => ({ ...s, galiojaNuo: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pd-galioja-iki">Galioja iki (neprivaloma)</Label>
                <Input
                  id="pd-galioja-iki"
                  type="date"
                  value={state.galiojaIki}
                  onChange={(e) =>
                    setState((s) => ({ ...s, galiojaIki: e.target.value }))
                  }
                />
              </div>
            </div>

            {errorMsg && (
              <div
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
                data-testid="distribution-dialog-error"
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
            <Button type="submit" disabled={mutation.isPending || !hasAccess}>
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

export default PayrollDistributionDialog;
