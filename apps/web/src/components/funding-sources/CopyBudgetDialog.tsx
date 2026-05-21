/**
 * `CopyBudgetDialog` — biudžeto kopijavimo modalas (Iter 15, F16).
 *
 * Leidžia AM administratoriui per vieną veiksmą sukurti kitų metų biudžeto
 * struktūrą pagal praėjusių metų: kopijuoja visus tenant scope funding
 * sources + budget allocations iš `sourceYear` į `targetYear`. Visa
 * transakcijoje serveryje.
 *
 * Form'os laukai:
 *  - sourceYear (number, default current_year - 1)
 *  - targetYear (number, default current_year)
 *  - tenantId — neprivalomas; tuščia reiškia „visi tenant'ai"
 *
 * Backend error mapping (LT žinutės — backend grąžina):
 *  - 400 COPY_SAME_YEAR — kai sourceYear === targetYear
 *  - 400 COPY_SOURCE_EMPTY — kai šaltinio metai tušti
 *  - 409 COPY_TARGET_NOT_EMPTY — kai tikslo metai jau turi įrašų
 *  - 403 — kai vartotojas ne AM admin
 *
 * SAUGUMAS: dialog'as renderinamas tik AM admin'ui per `canManageBudget`
 * page lygmenyje. Backend papildomai forsuoja per `requireAmAdmin`.
 */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { AlertTriangle, Copy, Loader2 } from 'lucide-react';
import type { CopyBudgetResponse, Tenant } from '@biip-finansai/shared';
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
import { tenantsList } from '@/lib/api';
import { fundingSourcesApi } from '@/lib/api/fvm';
import { useAuth } from '@/lib/auth';
import { canManageBudget } from '@/lib/roles';
import { toast } from '@/lib/use-toast';

const ALL_TENANTS = '__all__';

export interface CopyBudgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Numatytasis šaltinio metai. Jei nepateikta — naudojam dabartinių metų - 1.
   */
  defaultSourceYear?: number;
  /**
   * Numatytasis tikslo metai. Jei nepateikta — naudojam dabartinių metų.
   */
  defaultTargetYear?: number;
}

export function CopyBudgetDialog({
  open,
  onOpenChange,
  defaultSourceYear,
  defaultTargetYear,
}: CopyBudgetDialogProps): JSX.Element {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAmAdmin = canManageBudget(user) && user?.tenantIsApprover === true;
  const now = new Date();
  const initSourceYear = defaultSourceYear ?? now.getFullYear() - 1;
  const initTargetYear = defaultTargetYear ?? now.getFullYear();

  const [sourceYear, setSourceYear] = React.useState<string>(String(initSourceYear));
  const [targetYear, setTargetYear] = React.useState<string>(String(initTargetYear));
  const [tenantSel, setTenantSel] = React.useState<string>(ALL_TENANTS);
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CopyBudgetResponse | null>(null);

  React.useEffect(() => {
    if (open) {
      setSourceYear(String(initSourceYear));
      setTargetYear(String(initTargetYear));
      setTenantSel(ALL_TENANTS);
      setValidationError(null);
      setServerError(null);
      setResult(null);
    }
  }, [open, initSourceYear, initTargetYear]);

  // Tenant pickeris matomas tik AM admin'ui — kitiem rolems šis dialog'as
  // apskritai nerenderinamas. Vis tiek query daromas conditional'iai, kad
  // testai galėtų mock'inti ir non-AM rolėms nepasiūlytų neprasidirbusių
  // tenant'ų.
  const tenantsQ = useQuery<Tenant[]>({
    queryKey: ['tenants', { withCounts: false }],
    queryFn: () => tenantsList(false),
    enabled: open && isAmAdmin,
  });

  const mutation = useMutation({
    mutationFn: async (): Promise<CopyBudgetResponse> => {
      const src = Number.parseInt(sourceYear, 10);
      const tgt = Number.parseInt(targetYear, 10);
      const body: { sourceYear: number; targetYear: number; tenantId?: number } = {
        sourceYear: src,
        targetYear: tgt,
      };
      if (tenantSel !== ALL_TENANTS) {
        body.tenantId = Number.parseInt(tenantSel, 10);
      }
      return fundingSourcesApi.copyFromYear(body);
    },
    onSuccess: (response) => {
      setResult(response);
      toast({
        title: 'Biudžetas nukopijuotas',
        description: `Sukurta ${response.copiedSources} šaltinių ir ${response.copiedAllocations} paskirstymų ${response.targetYear} metams.`,
        variant: 'success',
      });
      void qc.invalidateQueries({ queryKey: ['fundingSources'] });
      void qc.invalidateQueries({ queryKey: ['budgetAllocations'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: unknown) => {
      let msg = 'Nepavyko nukopijuoti biudžeto.';
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
    if (!isAmAdmin) {
      return 'Neturite teisės kopijuoti biudžeto.';
    }
    const src = Number.parseInt(sourceYear, 10);
    const tgt = Number.parseInt(targetYear, 10);
    if (!Number.isFinite(src) || src < 2001 || src > 3000) {
      return 'Šaltinio metai turi būti tarp 2001 ir 3000.';
    }
    if (!Number.isFinite(tgt) || tgt < 2001 || tgt > 3000) {
      return 'Tikslo metai turi būti tarp 2001 ir 3000.';
    }
    if (src === tgt) {
      return 'Šaltinio ir tikslo metai turi skirtis.';
    }
    return null;
  }

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setServerError(null);
    setResult(null);
    const err = validate();
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    mutation.mutate();
  }

  const tenants = tenantsQ.data ?? [];
  const errorMsg = serverError ?? validationError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="h-5 w-5 text-muted-foreground" />
              Kopijuoti biudžetą iš praėjusių metų
            </DialogTitle>
            <DialogDescription>
              Bus sukurtos finansavimo šaltinių ir paskirstymų kopijos tikslo
              metams.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="copy-source-year">Šaltinio metai</Label>
                <Input
                  id="copy-source-year"
                  type="number"
                  min={2001}
                  max={3000}
                  required
                  value={sourceYear}
                  onChange={(e) => setSourceYear(e.target.value)}
                  data-testid="copy-source-year-input"
                />
                <p className="text-[11px] text-muted-foreground">
                  Iš kurių metų kopijuojama (pvz. {now.getFullYear() - 1}).
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="copy-target-year">Tikslo metai</Label>
                <Input
                  id="copy-target-year"
                  type="number"
                  min={2001}
                  max={3000}
                  required
                  value={targetYear}
                  onChange={(e) => setTargetYear(e.target.value)}
                  data-testid="copy-target-year-input"
                />
                <p className="text-[11px] text-muted-foreground">
                  Į kuriuos metus kopijuojama (turi būti tušti).
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="copy-tenant">Organizacija</Label>
              <Select
                value={tenantSel}
                onValueChange={(v) => setTenantSel(v)}
              >
                <SelectTrigger id="copy-tenant" data-testid="copy-tenant-select">
                  <SelectValue placeholder="Pasirinkite organizaciją" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TENANTS}>Visos organizacijos</SelectItem>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name} ({t.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Jei nepasirinkta — kopijuojama visiems tenant'ams, kuriuose yra
                šaltiniai šaltinio metais.
              </p>
            </div>

            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-900 dark:text-amber-200"
              role="note"
              data-testid="copy-confirm-notice"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong className="font-medium">Patvirtinkite veiksmą.</strong>
                {' '}Tai sukurs naują biudžeto kopiją {targetYear} metams pagal{' '}
                {sourceYear} metų duomenis. Įsitikinkite, kad {targetYear} dar
                tušti — kitaip operacija atmetama (409 Conflict).
              </div>
            </div>

            {result && (
              <div
                className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm"
                role="status"
                data-testid="copy-result"
              >
                <div className="font-medium text-emerald-900 dark:text-emerald-200">
                  Sėkmingai nukopijuota į {result.targetYear} metus.
                </div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  Šaltinių sukurta: <strong>{result.copiedSources}</strong> ·
                  paskirstymų sukurta: <strong>{result.copiedAllocations}</strong>.
                </div>
              </div>
            )}

            {errorMsg && (
              <div
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
                data-testid="copy-dialog-error"
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
              disabled={mutation.isPending || !isAmAdmin}
              data-testid="copy-submit"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Kopijuojama…
                </>
              ) : result ? (
                'Kopijuoti dar kartą'
              ) : (
                'Kopijuoti'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default CopyBudgetDialog;
