/**
 * Aprobacijos žingsnių sąrašas (issue #9, audit #2).
 *
 * Rodo workflow žingsnius su statusais: PENDING, APPROVED, REJECTED, RETURNED.
 * AAD scope: paprastai 1 žingsnis (AM admin). Visa AM: kelių žingsnių grandinė.
 *
 * Skirtingos „serijos" atskiriamos žingsnių sequence — kai prašymas po
 * RETURNED pateikiamas pakartotinai, sukuriama nauja serija (next sequence
 * range). Audit #2: žingsniai sugrupuojami pagal iteraciją (round), kur
 * round = `Math.ceil(sequence / levelsPerRound)`, o `levelsPerRound` —
 * unique `levelCode` count'as steps array'uje. Naujausia iteracija viršuje.
 */
import { CheckCircle2, Clock, RotateCcw, XCircle } from 'lucide-react';
import type { ApprovalStep, ApprovalStepStatus } from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_VISUALS: Record<ApprovalStepStatus, { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  PENDING: { label: 'Laukia', icon: Clock, cls: 'text-muted-foreground' },
  APPROVED: { label: 'Patvirtinta', icon: CheckCircle2, cls: 'text-emerald-600' },
  REJECTED: { label: 'Atmesta', icon: XCircle, cls: 'text-destructive' },
  RETURNED: { label: 'Grąžinta', icon: RotateCcw, cls: 'text-amber-600' },
};

function fmtDate(value: string | null): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('lt-LT', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

export interface ApprovalStepsListProps {
  steps: ApprovalStep[];
}

export function ApprovalStepsList({ steps }: ApprovalStepsListProps): JSX.Element {
  if (steps.length === 0) {
    return <p className="text-xs text-muted-foreground">Aprobacijos žingsnių nėra (prašymas dar nepateiktas).</p>;
  }

  // Iteracijos dydis = unique levelCode count'as. Jei tik 1 level — 1 step per round.
  const levelsPerRound = Math.max(1, new Set(steps.map((s) => s.levelCode)).size);
  const roundOf = (step: ApprovalStep): number => Math.ceil(step.sequence / levelsPerRound);

  // Sugrupuojam pagal round, naujausias viršuje. Per round'ą — sequence didėjančia tvarka.
  const grouped = new Map<number, ApprovalStep[]>();
  for (const step of steps) {
    const round = roundOf(step);
    const bucket = grouped.get(round) ?? [];
    bucket.push(step);
    grouped.set(round, bucket);
  }
  const rounds = Array.from(grouped.entries())
    .map(([round, items]) => ({
      round,
      items: [...items].sort((a, b) => a.sequence - b.sequence),
    }))
    .sort((a, b) => b.round - a.round);
  const newestRound = rounds[0]?.round;

  return (
    <div className="space-y-4">
      {rounds.map(({ round, items }) => (
        <div key={round} className="space-y-2">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Iteracija {round}
            </h4>
            {round === newestRound && rounds.length > 1 && (
              <Badge variant="secondary" className="text-[10px]">
                naujausia
              </Badge>
            )}
          </div>
          <ol className="space-y-2">
            {items.map((step) => {
              const v = STATUS_VISUALS[step.status];
              const Icon = v.icon;
              return (
                <li
                  key={step.id}
                  className={cn(
                    'flex items-start gap-3 rounded-md border border-border bg-background p-3',
                    step.status === 'PENDING' && 'border-primary/40 bg-primary/5',
                  )}
                >
                  <div className={cn('mt-0.5 shrink-0', v.cls)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        #{step.sequence} · {step.levelName}
                      </span>
                      <Badge
                        variant={
                          step.status === 'PENDING'
                            ? 'secondary'
                            : step.status === 'APPROVED'
                              ? 'default'
                              : step.status === 'REJECTED'
                                ? 'destructive'
                                : 'outline'
                        }
                        className="text-[10px]"
                      >
                        {v.label}
                      </Badge>
                    </div>
                    {step.decidedAt && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {step.decidedByName ?? '—'} · {fmtDate(step.decidedAt)}
                      </p>
                    )}
                    {step.comment && (
                      <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                        „{step.comment}"
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
