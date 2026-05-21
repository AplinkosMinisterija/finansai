/**
 * `ComputeMonthDialog` — mėnesio DU compute trigger (Iter 13, FVM-5).
 *
 * Vartotojas pasirenka mėnesį (YYYY-MM), gauna idempotency įspėjimą, ir paspaudžia
 * „Apskaičiuoti". Backend:
 *   1. Suranda visus aktyvius profilius nurodytame mėnesyje (per visus tenant'us)
 *   2. Ištrina ankstesnius DU expense'us per šitą mėnesį (jei buvo paleista anksčiau)
 *   3. Sukuria naujus expense'us per kiekvieną distribution
 *   4. Grąžina suvestinę (profilesProcessed, expensesCreated, totalAmount)
 *
 * SAUGUMAS: TIK AM admin'as. Backend forsuoja per `requireDuAccess`; UI papildomai
 * paslepia visą šią dialog'ą per `canComputePayroll`.
 */
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { AlertTriangle, Calculator, Loader2 } from 'lucide-react';
import type { ComputeMonthResponse } from '@biip-finansai/shared';
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
import { payrollApi } from '@/lib/api/fvm';
import { useAuth } from '@/lib/auth';
import { canComputePayroll } from '@/lib/roles';

function currentMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

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

export interface ComputeMonthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (response: ComputeMonthResponse) => void;
}

export function ComputeMonthDialog({
  open,
  onOpenChange,
  onSuccess,
}: ComputeMonthDialogProps): JSX.Element {
  const { user } = useAuth();
  const hasAccess = canComputePayroll(user);

  const [month, setMonth] = React.useState<string>(currentMonth());
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ComputeMonthResponse | null>(null);

  React.useEffect(() => {
    if (open) {
      setMonth(currentMonth());
      setValidationError(null);
      setServerError(null);
      setResult(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async (): Promise<ComputeMonthResponse> => {
      if (!hasAccess) {
        throw new Error('Neturite teisės skaičiuoti DU.');
      }
      return payrollApi.computeMonth(month);
    },
    onSuccess: (response) => {
      setResult(response);
      onSuccess(response);
    },
    onError: (err: unknown) => {
      let msg = 'Nepavyko apskaičiuoti mėnesio DU.';
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        if (data?.message) msg = data.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setServerError(msg);
    },
  });

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setServerError(null);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setValidationError('Pasirinkite mėnesį (YYYY-MM formatu).');
      return;
    }
    setValidationError(null);
    mutation.mutate();
  }

  const errorMsg = serverError ?? validationError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-muted-foreground" />
              Apskaičiuoti mėnesio DU
            </DialogTitle>
            <DialogDescription>
              Sukuriama / atnaujinama DU išlaidos pagal aktyvius profilius ir jų
              paskirstymus.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="compute-month">Mėnuo</Label>
              <Input
                id="compute-month"
                type="month"
                required
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                data-testid="compute-month-input"
              />
              <p className="text-[11px] text-muted-foreground">
                Formatas: YYYY-MM. Pavyzdys: {currentMonth()}.
              </p>
            </div>

            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-900 dark:text-amber-200"
              role="note"
              data-testid="compute-idempotency-notice"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong className="font-medium">Idempotentiškas veiksmas.</strong>
                {' '}Jeigu šis mėnuo jau buvo apskaičiuotas, ankstesnės DU išlaidos
                bus pakeistos naujomis pagal šiandien galiojančius profilius ir
                paskirstymus.
              </div>
            </div>

            {result && (
              <div
                className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm"
                role="status"
                data-testid="compute-result"
              >
                <div className="font-medium text-emerald-900 dark:text-emerald-200">
                  Mėnuo {result.month} apskaičiuotas.
                </div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  Profilių: {result.profilesProcessed} · Išlaidų sukurta:{' '}
                  {result.expensesCreated} · Bendra suma:{' '}
                  <span className="font-semibold tabular-nums">
                    {formatEur(result.totalAmount)}
                  </span>
                </div>
              </div>
            )}

            {errorMsg && (
              <div
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
                data-testid="compute-dialog-error"
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
              Uždaryti
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !hasAccess}
              data-testid="compute-submit"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Skaičiuojama…
                </>
              ) : result ? (
                'Skaičiuoti dar kartą'
              ) : (
                'Apskaičiuoti'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ComputeMonthDialog;
