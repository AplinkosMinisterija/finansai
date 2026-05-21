/**
 * `FundingSourceCard` — vieno finansavimo šaltinio kortelė sąraše.
 *
 * Rodo:
 *  - pavadinimas + kodas
 *  - tipas (klasifikatoriaus item.name)
 *  - metai
 *  - metinė suma, paskirstyta, likutis
 *  - aktyvumo žyma
 *
 * Klikti — atveria detalų rodinį per `onSelect`. AM admin per parent puslapį
 * pamatys edit/delete mygtukus.
 */
import * as React from 'react';
import { Building2, Calendar, Pencil, Trash2 } from 'lucide-react';
import type { FundingSource } from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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

export interface FundingSourceCardProps {
  source: FundingSource;
  canEdit: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function FundingSourceCard({
  source,
  canEdit,
  onSelect,
  onEdit,
  onDelete,
}: FundingSourceCardProps): JSX.Element {
  const metineNum = Number.parseFloat(source.metineSuma) || 0;
  const allocatedNum = Number.parseFloat(source.allocatedAmount ?? '0') || 0;
  const remainingNum = metineNum - allocatedNum;

  return (
    <Card
      className={cn(
        'cursor-pointer transition-colors hover:bg-muted/40',
        !source.aktyvus && 'opacity-60',
      )}
      data-testid={`funding-source-card-${source.id}`}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <button
            type="button"
            className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            onClick={onSelect}
            aria-label={`Atidaryti šaltinį „${source.pavadinimas}"`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                {source.kodas}
              </code>
              <span className="font-medium">{source.pavadinimas}</span>
              {source.tipasName && (
                <Badge variant="secondary" className="text-[10px]">
                  {source.tipasName}
                </Badge>
              )}
              {!source.aktyvus && (
                <Badge variant="destructive" className="text-[10px]">
                  neaktyvus
                </Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {source.metai} m.
              </span>
              {source.tenantName && (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {source.tenantName}
                </span>
              )}
              <span>{source.allocationsCount ?? 0} paskirstymų</span>
            </div>
            {source.aprasymas && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {source.aprasymas}
              </p>
            )}
          </button>

          {canEdit && (
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onEdit}
                data-testid={`edit-funding-source-${source.id}`}
              >
                <Pencil className="h-4 w-4" />
                Redaguoti
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={onDelete}
                title="Ištrinti šaltinį"
                data-testid={`delete-funding-source-${source.id}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 text-sm">
          <Stat label="Metinė suma" value={formatEur(metineNum)} />
          <Stat label="Paskirstyta" value={formatEur(allocatedNum)} />
          <Stat
            label={remainingNum < -0.005 ? 'Viršyta' : 'Likutis'}
            value={formatEur(Math.abs(remainingNum))}
            tone={remainingNum < -0.005 ? 'destructive' : 'default'}
          />
        </div>
      </CardContent>
    </Card>
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
      className={cn(
        'rounded-md border p-2',
        tone === 'destructive' && 'border-destructive/30 bg-destructive/5 text-destructive',
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums">{value}</div>
    </div>
  );
}
