/**
 * Finansavimo šaltinių puslapis (Iter 9, FVM-1).
 *
 * Visi prisijungę vartotojai mato sąrašą. AM administratoriai gali kurti,
 * redaguoti, trinti šaltinius bei paskirstymus.
 *
 * UI:
 *  - Antraštė + filtras (metai dropdown), „Naujas šaltinis" mygtukas (AM admin)
 *  - Kortelių sąrašas su FundingSourceCard
 *  - Klikti kortelę → atveria detalų rodinį (Dialog), kuriame:
 *      - Šaltinio meta (read-only AM specialistui, edit form'a AM admin'ui)
 *      - AllocationsSection (paskirstymų sąrašas)
 *
 * Backend: /api/funding-sources (žr. `apps/api/src/services/api.service.ts`).
 */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Plus, Wallet } from 'lucide-react';
import type { FundingSource } from '@biip-finansai/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { FundingSourceCard } from '@/components/funding-sources/FundingSourceCard';
import { FundingSourceDialog } from '@/components/funding-sources/FundingSourceDialog';
import { AllocationsSection } from '@/components/funding-sources/AllocationsSection';
import { useAuth } from '@/lib/auth';
import { canManageBudget } from '@/lib/roles';
import { fundingSourcesApi } from '@/lib/api/fvm';

const ALL_YEARS = '__all__';

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

export default function FinansavimoSaltiniaiPage(): JSX.Element {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = canManageBudget(user);
  const now = new Date();
  const [year, setYear] = React.useState<number | null>(now.getFullYear());

  const [creatingDialogOpen, setCreatingDialogOpen] = React.useState(false);
  const [editingSource, setEditingSource] = React.useState<FundingSource | null>(null);
  const [detailSource, setDetailSource] = React.useState<FundingSource | null>(null);

  const listQ = useQuery<FundingSource[]>({
    queryKey: ['fundingSources', { year }],
    queryFn: () => fundingSourcesApi.list(year === null ? {} : { year }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => fundingSourcesApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fundingSources'] });
    },
    onError: (err: unknown) => {
      let msg = 'Nepavyko ištrinti finansavimo šaltinio.';
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        if (data?.message) msg = data.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      window.alert(msg);
    },
  });

  function handleDelete(s: FundingSource): void {
    if ((s.allocationsCount ?? 0) > 0) {
      window.alert(
        `Negalima ištrinti „${s.pavadinimas}" — yra ${s.allocationsCount} paskirstymų. ` +
          'Pirma ištrinkite paskirstymus.',
      );
      return;
    }
    if (!window.confirm(`Ar tikrai ištrinti finansavimo šaltinį „${s.pavadinimas}"?`)) {
      return;
    }
    deleteMutation.mutate(s.id);
  }

  const sources = listQ.data ?? [];
  const years: number[] = [];
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 5; y += 1) {
    years.push(y);
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Wallet className="h-6 w-6 text-muted-foreground" />
            Finansavimo šaltiniai
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            1 FVM lygis: „Iš kur pinigai?". Kiekvienas šaltinis skaidomas į biudžeto
            paskirstymus.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="fs-year" className="text-xs text-muted-foreground">
              Metai
            </Label>
            <Select
              value={year === null ? ALL_YEARS : String(year)}
              onValueChange={(v) =>
                setYear(v === ALL_YEARS ? null : Number.parseInt(v, 10))
              }
            >
              <SelectTrigger id="fs-year" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_YEARS}>Visi metai</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canEdit && (
            <Button
              onClick={() => setCreatingDialogOpen(true)}
              data-testid="open-new-funding-source"
            >
              <Plus className="h-4 w-4" />
              Naujas šaltinis
            </Button>
          )}
        </div>
      </div>

      {listQ.isLoading ? (
        <div className="space-y-2" data-testid="funding-sources-skeleton">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : listQ.isError ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">
            Nepavyko užkrauti finansavimo šaltinių.
          </CardContent>
        </Card>
      ) : sources.length === 0 ? (
        <Card>
          <CardContent
            className="p-12 text-center text-sm text-muted-foreground"
            data-testid="funding-sources-empty"
          >
            {canEdit
              ? 'Nėra šaltinių. Sukurkite naują.'
              : 'Nėra šaltinių pasirinktiems metams.'}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3" data-testid="funding-source-list">
          {sources.map((s) => (
            <li key={s.id}>
              <FundingSourceCard
                source={s}
                canEdit={canEdit}
                onSelect={() => setDetailSource(s)}
                onEdit={() => setEditingSource(s)}
                onDelete={() => handleDelete(s)}
              />
            </li>
          ))}
        </ul>
      )}

      {(creatingDialogOpen || editingSource !== null) && (
        <FundingSourceDialog
          mode={editingSource ? 'edit' : 'create'}
          source={editingSource}
          defaultTenantId={user?.tenantId ?? null}
          defaultYear={year ?? now.getFullYear()}
          open={creatingDialogOpen || editingSource !== null}
          onOpenChange={(o) => {
            if (!o) {
              setCreatingDialogOpen(false);
              setEditingSource(null);
            }
          }}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['fundingSources'] });
            setCreatingDialogOpen(false);
            setEditingSource(null);
          }}
        />
      )}

      {detailSource !== null && (
        <SourceDetailDialog
          source={detailSource}
          canEdit={canEdit}
          open
          onOpenChange={(o) => {
            if (!o) setDetailSource(null);
          }}
          onEdit={() => {
            setEditingSource(detailSource);
            setDetailSource(null);
          }}
        />
      )}
    </div>
  );
}

interface SourceDetailDialogProps {
  source: FundingSource;
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
}

function SourceDetailDialog({
  source,
  canEdit,
  open,
  onOpenChange,
  onEdit,
}: SourceDetailDialogProps): JSX.Element {
  const metineNum = Number.parseFloat(source.metineSuma) || 0;
  const allocatedNum = Number.parseFloat(source.allocatedAmount ?? '0') || 0;
  const remainingNum = metineNum - allocatedNum;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
              {source.kodas}
            </code>
            <span>{source.pavadinimas}</span>
          </DialogTitle>
          <DialogDescription>
            {source.tipasName ?? '—'} · {source.metai} m. ·{' '}
            {source.tenantName ?? `Tenant #${source.tenantId}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Stat label="Metinė suma" value={formatEur(metineNum)} />
            <Stat label="Paskirstyta" value={formatEur(allocatedNum)} />
            <Stat
              label={remainingNum < -0.005 ? 'Viršyta' : 'Likutis'}
              value={formatEur(Math.abs(remainingNum))}
              tone={remainingNum < -0.005 ? 'destructive' : 'default'}
            />
          </div>

          {source.aprasymas && (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {source.aprasymas}
            </p>
          )}

          <AllocationsSection source={source} canEdit={canEdit} />
        </div>

        <DialogFooter>
          {canEdit && (
            <Button type="button" variant="outline" onClick={onEdit}>
              Redaguoti šaltinį
            </Button>
          )}
          <Button type="button" onClick={() => onOpenChange(false)}>
            Uždaryti
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface StatProps {
  label: string;
  value: string;
  tone?: 'default' | 'destructive';
}

function Stat({ label, value, tone = 'default' }: StatProps): JSX.Element {
  return (
    <div
      className={
        'rounded-md border p-2 ' +
        (tone === 'destructive'
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : '')
      }
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums">{value}</div>
    </div>
  );
}
