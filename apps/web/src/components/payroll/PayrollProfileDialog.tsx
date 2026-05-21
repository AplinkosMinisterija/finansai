/**
 * `PayrollProfileDialog` — CRUD modal'as DU profiliui (Iter 13, FVM-5).
 *
 * Form'os laukai:
 *  - vardas_pavarde (privalomas, max 200)
 *  - pareigos (privalomas, max 200)
 *  - sutarties_tipas (radio: darbo | paslaugu | autorine)
 *  - atlyginimas_bruto (decimal, > 0, palaiko `.` ir `,`)
 *  - priedai (decimal, >= 0; default 0)
 *  - galioja_nuo (date, privalomas)
 *  - galioja_iki (date, neprivalomas; jei nurodyta — turi būti >= galioja_nuo)
 *  - tenant — AM admin gali pasirinkti; org_admin'ui užfiksuotas savo tenant'as
 *  - user_id (neprivalomas dropdown'as — to paties tenant'o vartotojai)
 *
 * SAUGUMAS: dialog'as VISIŠKAI neuždaromas org_user'iui per puslapio gating'ą
 * (`canViewPayroll` route guard pasirūpina, kad org_user'is į /du nepatektų).
 * Vis dėlto, kai dialog'as atvertas, papildomai sanity-check'inam permission'us
 * (defense in depth).
 *
 * Per ADR-003: tik bruto + priedai, BE Sodra/GPM apskaitos. Form'oje nėra
 * mokesčių laukų.
 */
import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import type {
  ContractType,
  PaginatedResponse,
  PayrollProfile,
  PayrollProfileCreateDTO,
  PayrollProfileUpdateDTO,
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { tenantsList, usersList } from '@/lib/api';
import { payrollApi } from '@/lib/api/fvm';
import { useAuth } from '@/lib/auth';
import { canViewPayroll } from '@/lib/roles';

const CONTRACT_TYPES: readonly ContractType[] = ['darbo', 'paslaugu', 'autorine'];

const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  darbo: 'Darbo sutartis',
  paslaugu: 'Paslaugų sutartis',
  autorine: 'Autorinė sutartis',
};

interface FormState {
  tenantId: string;
  userId: string;
  vardasPavarde: string;
  pareigos: string;
  sutartiesTipas: ContractType;
  atlyginimasBruto: string;
  priedai: string;
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

function emptyForm(defaults: { tenantId: number | null }): FormState {
  return {
    tenantId: defaults.tenantId !== null ? String(defaults.tenantId) : '',
    userId: '',
    vardasPavarde: '',
    pareigos: '',
    sutartiesTipas: 'darbo',
    atlyginimasBruto: '',
    priedai: '0.00',
    galiojaNuo: todayIso(),
    galiojaIki: '',
  };
}

function fromProfile(p: PayrollProfile): FormState {
  return {
    tenantId: String(p.tenantId),
    userId: p.userId !== null ? String(p.userId) : '',
    vardasPavarde: p.vardasPavarde,
    pareigos: p.pareigos,
    sutartiesTipas: p.sutartiesTipas,
    atlyginimasBruto: p.atlyginimasBruto,
    priedai: p.priedai,
    galiojaNuo: p.galiojaNuo.slice(0, 10),
    galiojaIki: p.galiojaIki ? p.galiojaIki.slice(0, 10) : '',
  };
}

export interface PayrollProfileDialogProps {
  mode: 'create' | 'edit';
  profile: PayrollProfile | null;
  /** Numatytasis tenant_id (paprastai prisijungusio vartotojo tenant'as). */
  defaultTenantId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (profile: PayrollProfile) => void;
}

export function PayrollProfileDialog({
  mode,
  profile,
  defaultTenantId,
  open,
  onOpenChange,
  onSuccess,
}: PayrollProfileDialogProps): JSX.Element {
  const { user } = useAuth();
  const isAmAdmin =
    user?.tenantIsApprover === true && user.role === 'admin';
  // Defense-in-depth: dialog'as neturi būti pasiekiamas org_user'iui per puslapį,
  // bet papildomai blokuojam mutation'us jei permission'as kažkaip neatpažintas.
  const hasAccess = canViewPayroll(user);

  const [state, setState] = React.useState<FormState>(
    profile ? fromProfile(profile) : emptyForm({ tenantId: defaultTenantId }),
  );
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValidationError(null);
    setServerError(null);
    setState(
      profile ? fromProfile(profile) : emptyForm({ tenantId: defaultTenantId }),
    );
  }, [profile, defaultTenantId, open]);

  const tenantsQ = useQuery<Tenant[]>({
    queryKey: ['tenants', { withCounts: false }],
    queryFn: () => tenantsList(false),
    enabled: isAmAdmin && hasAccess,
  });

  const tenantIdNum =
    state.tenantId === '' ? null : Number.parseInt(state.tenantId, 10);
  const usersQ = useQuery<PaginatedResponse<User>>({
    queryKey: ['users', { tenantId: tenantIdNum }],
    queryFn: () =>
      usersList({ tenantId: tenantIdNum ?? undefined, pageSize: 200 }),
    enabled: tenantIdNum !== null && hasAccess,
  });

  const mutation = useMutation({
    mutationFn: async (): Promise<PayrollProfile> => {
      if (!hasAccess) {
        throw new Error('Neturite teisės valdyti DU duomenų.');
      }
      const tenantId = Number.parseInt(state.tenantId, 10);
      const userId = state.userId === '' ? null : Number.parseInt(state.userId, 10);
      const atlyginimasBruto = normalizeAmountInput(state.atlyginimasBruto);
      const priedai = normalizeAmountInput(state.priedai);
      const galiojaIki = state.galiojaIki === '' ? null : state.galiojaIki;

      if (mode === 'create') {
        const body: PayrollProfileCreateDTO = {
          tenantId,
          userId,
          vardasPavarde: state.vardasPavarde.trim(),
          pareigos: state.pareigos.trim(),
          sutartiesTipas: state.sutartiesTipas,
          atlyginimasBruto,
          priedai,
          galiojaNuo: state.galiojaNuo,
          galiojaIki,
        };
        return payrollApi.createProfile(body);
      }
      if (!profile) throw new Error('Nėra profilio, kurį atnaujinti.');
      const patch: PayrollProfileUpdateDTO = {
        userId,
        vardasPavarde: state.vardasPavarde.trim(),
        pareigos: state.pareigos.trim(),
        sutartiesTipas: state.sutartiesTipas,
        atlyginimasBruto,
        priedai,
        galiojaNuo: state.galiojaNuo,
        galiojaIki,
      };
      return payrollApi.updateProfile(profile.id, patch);
    },
    onSuccess: (p) => onSuccess(p),
    onError: (err: unknown) => {
      let msg = 'Nepavyko išsaugoti DU profilio.';
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
    if (state.vardasPavarde.trim() === '') return 'Įveskite vardą ir pavardę.';
    if (state.pareigos.trim() === '') return 'Įveskite pareigas.';
    if (state.tenantId === '') return 'Pasirinkite organizaciją.';
    const brutoNum = Number.parseFloat(normalizeAmountInput(state.atlyginimasBruto));
    if (!Number.isFinite(brutoNum) || brutoNum <= 0) {
      return 'Bruto atlyginimas turi būti didesnis už 0.';
    }
    const priedaiNum = Number.parseFloat(normalizeAmountInput(state.priedai));
    if (!Number.isFinite(priedaiNum) || priedaiNum < 0) {
      return 'Priedai negali būti neigiami.';
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
  const tenants = tenantsQ.data ?? [];
  const usersData = usersQ.data?.items ?? [];
  const errorMsg = serverError ?? validationError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {isCreate
                ? 'Naujas DU profilis'
                : `Redaguoti — ${profile?.vardasPavarde ?? ''}`}
            </DialogTitle>
            <DialogDescription>
              {isCreate
                ? 'Užpildykite darbuotojo finansinį profilį. Tik bruto + priedai (BE Sodra/GPM).'
                : 'Atnaujinkite DU profilio duomenis.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pp-vardas">Vardas, pavardė</Label>
                <Input
                  id="pp-vardas"
                  required
                  maxLength={200}
                  placeholder="Vardas Pavardenis"
                  value={state.vardasPavarde}
                  onChange={(e) =>
                    setState((s) => ({ ...s, vardasPavarde: e.target.value }))
                  }
                  data-testid="payroll-vardas-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pp-pareigos">Pareigos</Label>
                <Input
                  id="pp-pareigos"
                  required
                  maxLength={200}
                  placeholder="Pvz., Vyriausiasis specialistas"
                  value={state.pareigos}
                  onChange={(e) =>
                    setState((s) => ({ ...s, pareigos: e.target.value }))
                  }
                  data-testid="payroll-pareigos-input"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Sutarties tipas</Label>
              <div
                role="radiogroup"
                aria-label="Sutarties tipas"
                className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                data-testid="payroll-sutartis-radiogroup"
              >
                {CONTRACT_TYPES.map((t) => (
                  <label
                    key={t}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-border p-2 text-sm hover:bg-muted/50"
                  >
                    <input
                      type="radio"
                      name="payroll-sutartis"
                      value={t}
                      checked={state.sutartiesTipas === t}
                      onChange={() =>
                        setState((s) => ({ ...s, sutartiesTipas: t }))
                      }
                      className="h-4 w-4"
                    />
                    {CONTRACT_TYPE_LABELS[t]}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pp-tenant">Organizacija</Label>
                <Select
                  value={state.tenantId}
                  onValueChange={(v) =>
                    setState((s) => ({ ...s, tenantId: v, userId: '' }))
                  }
                  disabled={!isAmAdmin || !isCreate}
                >
                  <SelectTrigger id="pp-tenant" data-testid="payroll-tenant-trigger">
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
              <div className="space-y-2">
                <Label htmlFor="pp-user">Susietas vartotojas (neprivalomas)</Label>
                <Select
                  value={state.userId === '' ? '__none__' : state.userId}
                  onValueChange={(v) =>
                    setState((s) => ({ ...s, userId: v === '__none__' ? '' : v }))
                  }
                  disabled={state.tenantId === ''}
                >
                  <SelectTrigger id="pp-user" data-testid="payroll-user-trigger">
                    <SelectValue placeholder="Pasirinkite vartotoją" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Be sistemos paskyros —</SelectItem>
                    {usersData.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Galima palikti tuščią — vardas/pavardė saugomi atskirai.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pp-bruto">Bruto atlyginimas (€)</Label>
                <Input
                  id="pp-bruto"
                  inputMode="decimal"
                  required
                  placeholder="1500.00"
                  value={state.atlyginimasBruto}
                  onChange={(e) =>
                    setState((s) => ({ ...s, atlyginimasBruto: e.target.value }))
                  }
                  data-testid="payroll-bruto-input"
                />
                <p className="text-[11px] text-muted-foreground">
                  Tik bruto suma (be Sodra/GPM). Galima ir kableliu (1500,00).
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pp-priedai">Priedai (€)</Label>
                <Input
                  id="pp-priedai"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={state.priedai}
                  onChange={(e) =>
                    setState((s) => ({ ...s, priedai: e.target.value }))
                  }
                  data-testid="payroll-priedai-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pp-galioja-nuo">Galioja nuo</Label>
                <Input
                  id="pp-galioja-nuo"
                  type="date"
                  required
                  value={state.galiojaNuo}
                  onChange={(e) =>
                    setState((s) => ({ ...s, galiojaNuo: e.target.value }))
                  }
                  data-testid="payroll-nuo-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pp-galioja-iki">Galioja iki (neprivaloma)</Label>
                <Input
                  id="pp-galioja-iki"
                  type="date"
                  value={state.galiojaIki}
                  onChange={(e) =>
                    setState((s) => ({ ...s, galiojaIki: e.target.value }))
                  }
                  data-testid="payroll-iki-input"
                />
                <p className="text-[11px] text-muted-foreground">
                  Tuščia = vis dar galioja.
                </p>
              </div>
            </div>

            {errorMsg && (
              <div
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
                data-testid="payroll-dialog-error"
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

export default PayrollProfileDialog;
