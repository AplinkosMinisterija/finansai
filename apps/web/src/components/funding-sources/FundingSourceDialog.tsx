/**
 * `FundingSourceDialog` — CRUD modal finansavimo šaltiniui.
 *
 * Naudoja shadcn/ui Dialog + Input + Label + Checkbox primitives.
 * Validation:
 *  - pavadinimas: privalomas
 *  - kodas: privalomas
 *  - tipas: privalomas (klasifikatorius `funding_source_type`)
 *  - tenant: privalomas (per default — AM admin tenant)
 *  - metai: > 2000 ir <= 3000
 *  - metinė suma: > 0
 *
 * Backend validuoja unique (tenant_id, kodas, metai) ir grąžina LT error
 * žinutę 409 atveju.
 */
import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import type {
  ClassifierItem,
  FundingSource,
  FundingSourceCreateDTO,
  FundingSourceUpdateDTO,
  Tenant,
} from '@biip-finansai/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { classifierItemsList, tenantsList } from '@/lib/api';
import { fundingSourcesApi } from '@/lib/api/fvm';
import { yearOptions } from '@/lib/years';

interface FormState {
  tenantId: string;
  pavadinimas: string;
  kodas: string;
  tipasClassifierItemId: string;
  metai: string;
  metineSuma: string;
  aprasymas: string;
  aktyvus: boolean;
}

function emptyForm(defaults: { tenantId: number | null; year: number }): FormState {
  return {
    tenantId: defaults.tenantId !== null ? String(defaults.tenantId) : '',
    pavadinimas: '',
    kodas: '',
    tipasClassifierItemId: '',
    metai: String(defaults.year),
    metineSuma: '',
    aprasymas: '',
    aktyvus: true,
  };
}

function fromSource(fs: FundingSource): FormState {
  return {
    tenantId: String(fs.tenantId),
    pavadinimas: fs.pavadinimas,
    kodas: fs.kodas,
    tipasClassifierItemId: String(fs.tipasClassifierItemId),
    metai: String(fs.metai),
    metineSuma: fs.metineSuma,
    aprasymas: fs.aprasymas ?? '',
    aktyvus: fs.aktyvus,
  };
}

function normalizeAmountInput(input: string): string {
  const cleaned = input.replace(/\s/g, '').replace(',', '.');
  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num)) return '0.00';
  return num.toFixed(2);
}

export interface FundingSourceDialogProps {
  mode: 'create' | 'edit';
  source: FundingSource | null;
  /** Numatytasis tenant_id (paprastai AM admin tenant). */
  defaultTenantId: number | null;
  /** Numatytieji metai (iš puslapio filtro). */
  defaultYear: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function FundingSourceDialog({
  mode,
  source,
  defaultTenantId,
  defaultYear,
  open,
  onOpenChange,
  onSuccess,
}: FundingSourceDialogProps): JSX.Element {
  const [state, setState] = React.useState<FormState>(
    source ? fromSource(source) : emptyForm({ tenantId: defaultTenantId, year: defaultYear }),
  );
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setValidationError(null);
    setServerError(null);
    setState(
      source ? fromSource(source) : emptyForm({ tenantId: defaultTenantId, year: defaultYear }),
    );
  }, [source, defaultTenantId, defaultYear, open]);

  const tenantsQ = useQuery<Tenant[]>({
    queryKey: ['tenants', { withCounts: false }],
    queryFn: () => tenantsList(false),
  });

  const typesQ = useQuery<ClassifierItem[]>({
    queryKey: ['classifierItems', { groupCode: 'funding_source_type' }],
    queryFn: () => classifierItemsList({ groupCode: 'funding_source_type' }),
    staleTime: 5 * 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: async (): Promise<FundingSource> => {
      const tenantId = Number.parseInt(state.tenantId, 10);
      const tipasClassifierItemId = Number.parseInt(state.tipasClassifierItemId, 10);
      const metai = Number.parseInt(state.metai, 10);
      const metineSuma = normalizeAmountInput(state.metineSuma);
      if (mode === 'create') {
        const body: FundingSourceCreateDTO = {
          tenantId,
          pavadinimas: state.pavadinimas.trim(),
          kodas: state.kodas.trim(),
          tipasClassifierItemId,
          metai,
          metineSuma,
          aprasymas: state.aprasymas.trim() || null,
          aktyvus: state.aktyvus,
        };
        return fundingSourcesApi.create(body);
      }
      if (!source) throw new Error('No source to update');
      const patch: FundingSourceUpdateDTO = {
        pavadinimas: state.pavadinimas.trim(),
        kodas: state.kodas.trim(),
        tipasClassifierItemId,
        metai,
        metineSuma,
        aprasymas: state.aprasymas.trim() || null,
        aktyvus: state.aktyvus,
      };
      return fundingSourcesApi.update(source.id, patch);
    },
    onSuccess: () => onSuccess(),
    onError: (err: unknown) => {
      let msg = 'Nepavyko išsaugoti.';
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
    if (state.kodas.trim() === '') return 'Įveskite kodą.';
    if (state.tenantId === '') return 'Pasirinkite organizaciją.';
    if (state.tipasClassifierItemId === '') {
      return 'Pasirinkite finansavimo šaltinio tipą.';
    }
    const metai = Number.parseInt(state.metai, 10);
    if (!Number.isFinite(metai) || metai <= 2000) {
      return 'Metai turi būti didesni nei 2000.';
    }
    const sumaNum = Number.parseFloat(normalizeAmountInput(state.metineSuma));
    if (!Number.isFinite(sumaNum) || sumaNum <= 0) {
      return 'Metinė suma turi būti didesnė už 0.';
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
  const types = (typesQ.data ?? []).filter((t) => t.active);
  const errorMsg = serverError ?? validationError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {isCreate ? 'Naujas finansavimo šaltinis' : `Redaguoti — ${source?.kodas ?? ''}`}
            </DialogTitle>
            <DialogDescription>
              {isCreate
                ? 'Užpildykite duomenis ir paspauskite „Sukurti".'
                : 'Atnaujinkite finansavimo šaltinio duomenis.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2 col-span-1">
                <Label htmlFor="fs-kodas">Kodas</Label>
                <Input
                  id="fs-kodas"
                  required
                  maxLength={50}
                  placeholder="VB-2026"
                  value={state.kodas}
                  onChange={(e) => setState((s) => ({ ...s, kodas: e.target.value }))}
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="fs-pavadinimas">Pavadinimas</Label>
                <Input
                  id="fs-pavadinimas"
                  required
                  maxLength={200}
                  placeholder="Valstybės biudžetas 2026"
                  value={state.pavadinimas}
                  onChange={(e) => setState((s) => ({ ...s, pavadinimas: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="fs-tenant">Organizacija</Label>
                <Select
                  value={state.tenantId}
                  onValueChange={(v) => setState((s) => ({ ...s, tenantId: v }))}
                >
                  <SelectTrigger id="fs-tenant">
                    <SelectValue placeholder="Pasirinkite organizaciją" />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name} ({t.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fs-tipas">Tipas</Label>
                <Select
                  value={state.tipasClassifierItemId}
                  onValueChange={(v) => setState((s) => ({ ...s, tipasClassifierItemId: v }))}
                >
                  <SelectTrigger id="fs-tipas">
                    <SelectValue placeholder="Pasirinkite tipą" />
                  </SelectTrigger>
                  <SelectContent>
                    {types.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name} ({t.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="fs-metai">Metai</Label>
                <Select
                  value={state.metai}
                  onValueChange={(v) => setState((s) => ({ ...s, metai: v }))}
                >
                  <SelectTrigger id="fs-metai">
                    <SelectValue placeholder="Pasirinkite metus" />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions({
                      include: state.metai === '' ? null : Number.parseInt(state.metai, 10),
                    }).map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fs-suma">Metinė suma (€)</Label>
                <Input
                  id="fs-suma"
                  inputMode="decimal"
                  required
                  placeholder="1500000.00"
                  value={state.metineSuma}
                  onChange={(e) => setState((s) => ({ ...s, metineSuma: e.target.value }))}
                />
                <p className="text-[11px] text-muted-foreground">
                  Galima ir kableliu (1500000,00).
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fs-aprasymas">Aprašymas</Label>
              <textarea
                id="fs-aprasymas"
                rows={2}
                maxLength={4000}
                placeholder="Trumpas aprašymas, sprendimo nr., ir t.t."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={state.aprasymas}
                onChange={(e) => setState((s) => ({ ...s, aprasymas: e.target.value }))}
              />
            </div>

            <div className="flex items-start gap-2 rounded-md border border-border p-3">
              <Checkbox
                id="fs-aktyvus"
                checked={state.aktyvus}
                onCheckedChange={(checked) =>
                  setState((s) => ({ ...s, aktyvus: checked === true }))
                }
              />
              <div className="flex-1">
                <Label htmlFor="fs-aktyvus" className="cursor-pointer text-sm">
                  Aktyvus
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Neaktyvūs šaltiniai nesirodo bendruose sąrašuose, bet duomenys išlieka.
                </p>
              </div>
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
