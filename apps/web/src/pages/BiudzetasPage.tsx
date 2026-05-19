/**
 * Biudžeto valdymas (tik AM administratoriams) — issue #1.
 *
 * Vienas bendras AM biudžetas per metus, skaidomas pagal lėšų tipų klasifikatorių
 * (top-level item'us iš grupės „funding_type").
 *
 * UI:
 *  - Metų pasirinkimas (-1 .. +5 nuo dabartinių)
 *  - Bendra suma (totalAmount)
 *  - Lentelė: lėšų tipai → input'as su suma
 *  - Suvestinė: priskirta / nepriskirta / viršyta
 *  - „Išsaugoti" — upsert per backend transaction'ą
 */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Wallet } from 'lucide-react';
import type { Budget, ClassifierItem } from '@biip-finansai/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { budgetGetByYear, budgetUpsert, classifierItemsList } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { canManageBudget } from '@/lib/roles';
import { cn } from '@/lib/utils';

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

function normalizeAmount(input: string): string {
  // Leidžiam tiek 1234.56, tiek 1234,56 — saugom kaip 1234.56.
  const cleaned = input.replace(/\s/g, '').replace(',', '.');
  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num)) return '0.00';
  return num.toFixed(2);
}

export default function BiudzetasPage(): JSX.Element {
  const { user } = useAuth();
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = React.useState<number>(now.getFullYear());

  const fundingTypesQ = useQuery<ClassifierItem[]>({
    queryKey: ['classifierItems', { groupCode: 'funding_type' }],
    queryFn: () => classifierItemsList({ groupCode: 'funding_type' }),
  });

  const budgetQ = useQuery<Budget | null>({
    queryKey: ['budget', year],
    queryFn: () => budgetGetByYear(year),
  });

  const [totalAmount, setTotalAmount] = React.useState<string>('');
  const [notes, setNotes] = React.useState<string>('');
  const [allocations, setAllocations] = React.useState<Map<number, string>>(new Map());

  // Sync formos būsena, kai užkraunamas biudžetas arba pasikeičia metai.
  React.useEffect(() => {
    if (budgetQ.data) {
      setTotalAmount(budgetQ.data.totalAmount);
      setNotes(budgetQ.data.notes ?? '');
      const map = new Map<number, string>();
      for (const a of budgetQ.data.allocations) {
        map.set(a.classifierItemId, a.amount);
      }
      setAllocations(map);
    } else {
      setTotalAmount('0.00');
      setNotes('');
      setAllocations(new Map());
    }
  }, [budgetQ.data, year]);

  const upsertMutation = useMutation({
    mutationFn: (): Promise<Budget> =>
      budgetUpsert({
        year,
        totalAmount: normalizeAmount(totalAmount),
        notes: notes.trim() || null,
        allocations: Array.from(allocations.entries())
          .filter(([, amount]) => Number.parseFloat(amount || '0') !== 0)
          .map(([classifierItemId, amount]) => ({
            classifierItemId,
            amount: normalizeAmount(amount),
          })),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['budget', year] });
      void qc.invalidateQueries({ queryKey: ['budget'] });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error && 'response' in err
          ? ((err as { response?: { data?: { message?: string } } }).response?.data?.message ??
            null)
          : null;
      window.alert(msg ?? 'Nepavyko išsaugoti biudžeto.');
    },
  });

  if (!canManageBudget(user)) {
    return (
      <div className="mx-auto max-w-2xl p-4 md:p-6">
        <Card>
          <CardContent className="p-12 text-center text-sm text-muted-foreground">
            Šis puslapis prieinamas tik AM administratoriams.
          </CardContent>
        </Card>
      </div>
    );
  }

  const allItems = fundingTypesQ.data ?? [];
  const topLevel = allItems.filter((i) => i.parentId === null);
  const childrenByParent = new Map<number, ClassifierItem[]>();
  for (const it of allItems) {
    if (it.parentId === null) continue;
    if (!childrenByParent.has(it.parentId)) childrenByParent.set(it.parentId, []);
    childrenByParent.get(it.parentId)!.push(it);
  }

  // Skaičiavimai
  const totalAllocated = Array.from(allocations.values()).reduce(
    (acc, v) => acc + (Number.parseFloat(v || '0') || 0),
    0,
  );
  const totalAmountNum = Number.parseFloat(totalAmount || '0') || 0;
  const remaining = totalAmountNum - totalAllocated;
  const overspent = remaining < -0.005;
  const underspent = remaining > 0.005;

  const years: number[] = [];
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 5; y += 1) {
    years.push(y);
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Wallet className="h-6 w-6 text-muted-foreground" />
            Biudžetas
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Metinis AM biudžetas su skaidymu pagal lėšų tipus.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="bd-year" className="text-xs text-muted-foreground">
              Metai
            </Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number.parseInt(v, 10))}>
              <SelectTrigger id="bd-year" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {fundingTypesQ.isLoading || budgetQ.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-4 p-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="bd-total">Bendras biudžetas (€)</Label>
                <Input
                  id="bd-total"
                  inputMode="decimal"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  placeholder="1500000.00"
                />
                <p className="text-[11px] text-muted-foreground">
                  Pvz. 1500000.00 — galima ir kableliu (1500000,00).
                </p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="bd-notes">Pastabos</Label>
                <textarea
                  id="bd-notes"
                  rows={2}
                  maxLength={2000}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Šaltinis, sprendimo nr., ir t.t."
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Skaidymas pagal lėšų tipus
              </h2>
              {topLevel.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nėra „funding_type" klasifikatoriaus reikšmių. Pirma sukurkite jas
                  Klasifikatorių puslapyje.
                </p>
              ) : (
                <ul className="space-y-2">
                  {topLevel.map((top) => {
                    const value = allocations.get(top.id) ?? '';
                    const children = childrenByParent.get(top.id) ?? [];
                    const childTotal = children.reduce(
                      (acc, c) =>
                        acc + (Number.parseFloat(allocations.get(c.id) ?? '0') || 0),
                      0,
                    );
                    return (
                      <li key={top.id} className="space-y-1">
                        <AllocationRow
                          item={top}
                          value={value}
                          onChange={(v) =>
                            setAllocations((m) => {
                              const next = new Map(m);
                              next.set(top.id, v);
                              return next;
                            })
                          }
                          hint={
                            children.length > 0
                              ? `Sub-suma: ${formatEur(childTotal)}`
                              : undefined
                          }
                        />
                        {children.length > 0 && (
                          <ul className="ml-6 space-y-1 border-l pl-3">
                            {children.map((c) => (
                              <li key={c.id}>
                                <AllocationRow
                                  item={c}
                                  child
                                  value={allocations.get(c.id) ?? ''}
                                  onChange={(v) =>
                                    setAllocations((m) => {
                                      const next = new Map(m);
                                      next.set(c.id, v);
                                      return next;
                                    })
                                  }
                                />
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-4 p-4 sm:grid-cols-3">
              <Stat label="Biudžetas" value={formatEur(totalAmountNum)} />
              <Stat label="Paskirstyta" value={formatEur(totalAllocated)} />
              <Stat
                label={overspent ? 'Viršyta' : 'Likutis'}
                value={formatEur(Math.abs(remaining))}
                tone={overspent ? 'destructive' : underspent ? 'warning' : 'default'}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              size="lg"
              disabled={upsertMutation.isPending || overspent}
              onClick={() => upsertMutation.mutate()}
            >
              {upsertMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saugoma…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Išsaugoti
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface AllocationRowProps {
  item: ClassifierItem;
  value: string;
  onChange: (value: string) => void;
  child?: boolean;
  hint?: string;
}

function AllocationRow({ item, value, onChange, child, hint }: AllocationRowProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded px-2 py-1',
        child ? 'text-sm' : 'font-medium',
      )}
    >
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <code className="rounded bg-muted px-1 text-[11px] font-mono">{item.code}</code>
          <span>{item.name}</span>
        </div>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <Input
        inputMode="decimal"
        className="w-40 text-right"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
      />
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  tone?: 'default' | 'warning' | 'destructive';
}

function Stat({ label, value, tone = 'default' }: StatProps): JSX.Element {
  return (
    <div
      className={cn(
        'rounded-md border p-3',
        tone === 'destructive' && 'border-destructive/30 bg-destructive/5 text-destructive',
        tone === 'warning' && 'border-yellow-500/30 bg-yellow-500/5 text-yellow-700',
      )}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
