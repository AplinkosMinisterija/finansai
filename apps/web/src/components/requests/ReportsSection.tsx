/**
 * Atsiskaitymų sekcija APPROVED prašymui (issue #2).
 *
 * Rodo pateiktų ataskaitų sąrašą + leidžia teikėjui (arba AM admin)
 * pridėti naują ataskaitą per dialog'ą. DRAFT atskaitymą galima edit'inti
 * arba ištrinti; SUBMITTED užrakintas.
 */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { CheckCircle2, FileBarChart, Loader2, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import type { RequestReport } from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';
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
  reportDelete,
  reportSubmit,
  reportUpsert,
  reportsList,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtEur } from '@/lib/requests';

export interface ReportsSectionProps {
  requestId: number;
  /** Ar prašymas patvirtintas — kitaip atsiskaitymo negalima pridėti. */
  isApproved: boolean;
  /** Ar dabar prisijungęs vartotojas yra teikėjas (priklauso request.tenant). */
  isSubmitterSide: boolean;
}

function formatPeriod(year: number, quarter: number | null): string {
  if (quarter === null) return `${year} m. (metinis)`;
  return `${year} m. Q${quarter}`;
}

export function ReportsSection({
  requestId,
  isApproved,
  isSubmitterSide,
}: ReportsSectionProps): JSX.Element {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [dialog, setDialog] = React.useState<{ mode: 'create' | 'edit'; report: RequestReport | null } | null>(null);

  const q = useQuery<RequestReport[]>({
    queryKey: ['reports', requestId],
    queryFn: () => reportsList(requestId),
    enabled: isApproved,
  });

  const submitMutation = useMutation({
    mutationFn: (id: number) => reportSubmit(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports', requestId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => reportDelete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports', requestId] });
    },
  });

  if (!isApproved) {
    return (
      <p className="text-xs text-muted-foreground">
        Atsiskaitymą galima pateikti tik patvirtintam prašymui.
      </p>
    );
  }

  const items = q.data ?? [];
  const canManage =
    isSubmitterSide || (user?.tenantIsApprover === true && user.role === 'admin');

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Ataskaitų dar nėra.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((r) => (
            <li
              key={r.id}
              className="flex items-start gap-3 rounded-md border border-border bg-background p-3"
            >
              <FileBarChart className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {formatPeriod(r.periodYear, r.periodQuarter)}
                  </span>
                  <Badge
                    variant={r.status === 'SUBMITTED' ? 'default' : 'secondary'}
                    className="text-[10px]"
                  >
                    {r.status === 'SUBMITTED' ? 'Pateikta' : 'Juodraštis'}
                  </Badge>
                  <span className="ml-auto text-sm font-medium tabular-nums">
                    {fmtEur(r.amountUsed)}
                  </span>
                </div>
                {r.description && (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                    {r.description}
                  </p>
                )}
                {r.submittedByName && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {r.submittedByName}
                    {r.submittedAt
                      ? ` · pateikta ${new Date(r.submittedAt).toLocaleDateString('lt-LT')}`
                      : ''}
                  </p>
                )}
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-1">
                  {r.status === 'DRAFT' && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDialog({ mode: 'edit', report: r })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => submitMutation.mutate(r.id)}
                        disabled={submitMutation.isPending}
                        title="Pateikti"
                      >
                        {submitMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => {
                          if (window.confirm('Ar tikrai ištrinti šį juodraštį?')) {
                            deleteMutation.mutate(r.id);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  {r.status === 'SUBMITTED' && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDialog({ mode: 'create', report: null })}
        >
          <Plus className="h-4 w-4" />
          Nauja ataskaita
        </Button>
      )}

      {dialog && (
        <ReportDialog
          requestId={requestId}
          mode={dialog.mode}
          report={dialog.report}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['reports', requestId] });
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

interface ReportDialogProps {
  requestId: number;
  mode: 'create' | 'edit';
  report: RequestReport | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSuccess: () => void;
}

function ReportDialog({
  requestId,
  mode,
  report,
  open,
  onOpenChange,
  onSuccess,
}: ReportDialogProps): JSX.Element {
  const now = new Date();
  const [periodYear, setPeriodYear] = React.useState<string>(
    report ? String(report.periodYear) : String(now.getFullYear()),
  );
  const [periodKind, setPeriodKind] = React.useState<'quarterly' | 'annual'>(
    report
      ? report.periodQuarter === null
        ? 'annual'
        : 'quarterly'
      : 'quarterly',
  );
  const [quarter, setQuarter] = React.useState<string>(
    report?.periodQuarter ? String(report.periodQuarter) : String(Math.floor(now.getMonth() / 3) + 1),
  );
  const [amountUsed, setAmountUsed] = React.useState<string>(
    report ? report.amountUsed : '0.00',
  );
  const [description, setDescription] = React.useState<string>(report?.description ?? '');
  const [error, setError] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      reportUpsert(requestId, {
        periodYear: Number.parseInt(periodYear, 10),
        periodQuarter: periodKind === 'annual' ? null : Number.parseInt(quarter, 10),
        amountUsed,
        description: description.trim() || null,
      }),
    onSuccess: () => onSuccess(),
    onError: (err: unknown) => {
      let msg = 'Nepavyko išsaugoti.';
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        if (data?.message) msg = data.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setError(msg);
    },
  });

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {mode === 'create' ? 'Nauja ataskaita' : 'Redaguoti ataskaitą'}
            </DialogTitle>
            <DialogDescription>
              Suvedukite atsiskaitymo periodą, panaudotą sumą ir trumpą aprašymą.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="rep-year">Metai</Label>
                <Input
                  id="rep-year"
                  type="number"
                  value={periodYear}
                  onChange={(e) => setPeriodYear(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rep-kind">Periodas</Label>
                <select
                  id="rep-kind"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={periodKind}
                  onChange={(e) => setPeriodKind(e.target.value as 'quarterly' | 'annual')}
                >
                  <option value="quarterly">Ketvirtinis</option>
                  <option value="annual">Metinis</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rep-q">Ketv.</Label>
                <select
                  id="rep-q"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
                  value={quarter}
                  onChange={(e) => setQuarter(e.target.value)}
                  disabled={periodKind === 'annual'}
                >
                  <option value="1">Q1</option>
                  <option value="2">Q2</option>
                  <option value="3">Q3</option>
                  <option value="4">Q4</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="rep-amount">Panaudota suma (€)</Label>
              <Input
                id="rep-amount"
                type="number"
                step="0.01"
                min={0}
                value={amountUsed}
                onChange={(e) => setAmountUsed(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="rep-desc">Aprašymas</Label>
              <textarea
                id="rep-desc"
                rows={4}
                maxLength={4000}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Kas atlikta, kam panaudotos lėšos, pastabos."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {error && (
              <div
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Atšaukti
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saugoma…
                </>
              ) : (
                'Išsaugoti juodraštį'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
