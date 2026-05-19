/**
 * Aprobacijos žingsnių sąrašas (issue #9).
 *
 * Rodo workflow žingsnius su statusais: PENDING, APPROVED, REJECTED, RETURNED.
 * AAD scope: paprastai 1 žingsnis (AM admin). Visa AM: kelių žingsnių grandinė.
 *
 * Skirtingos „serijos" atskiriamos žingsnių sequence — kai prašymas po
 * RETURNED pateikiamas pakartotinai, sukuriama nauja serija (next sequence
 * range). UI rodo visas, naujausią viršuje.
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

  const ordered = [...steps].sort((a, b) => b.sequence - a.sequence);

  return (
    <ol className="space-y-2">
      {ordered.map((step) => {
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
  );
}
