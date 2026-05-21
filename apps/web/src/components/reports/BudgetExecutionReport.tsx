/**
 * `BudgetExecutionReport` — F12 ataskaitos JSON renderer'is.
 *
 * Rodo:
 *  - Total cards (planuota / faktinė / likutis) viršuje
 *  - bySource sekcijas su byCategory subrows kiekvienai allocation'ai
 *  - Warning badge'us pagal `isWarning` / `isOver` flag'us
 *
 * Permission gating: pati komponentė neturi DU filter'io — tai daro backend
 * pagal `canViewPayroll(me)`. UI tiesiog parodo tai, ką gavo.
 */
import * as React from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react';
import type {
  BudgetExecutionReport as BudgetExecutionReportData,
} from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';
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

export interface BudgetExecutionReportProps {
  data: BudgetExecutionReportData;
}

export function BudgetExecutionReport({
  data,
}: BudgetExecutionReportProps): JSX.Element {
  const [expanded, setExpanded] = React.useState<Set<number>>(() => {
    // Initialiai išskleidžiame VISAS šaltinių sekcijas, kad UI iškart būtų informatyvus.
    return new Set(data.bySource.map((s) => s.fundingSourceId));
  });

  function toggleSource(fsId: number): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fsId)) next.delete(fsId);
      else next.add(fsId);
      return next;
    });
  }

  if (data.bySource.length === 0) {
    return (
      <Card data-testid="budget-execution-empty">
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Nėra duomenų ataskaitai už pasirinktus metus.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="budget-execution-report">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TotalCard label="Iš viso planuota" value={data.totalPlanuota} />
        <TotalCard label="Iš viso faktinė" value={data.totalFaktine} tone="primary" />
        <TotalCard
          label="Iš viso likutis"
          value={data.totalLikutis}
          tone={Number.parseFloat(data.totalLikutis) < 0 ? 'destructive' : 'success'}
        />
      </div>

      {data.bySource.map((section) => {
        const isOpen = expanded.has(section.fundingSourceId);
        const sectionLikutisNum = Number.parseFloat(section.likutis);
        return (
          <Card
            key={section.fundingSourceId}
            data-testid={`budget-source-${section.fundingSourceId}`}
          >
            <button
              type="button"
              onClick={() => toggleSource(section.fundingSourceId)}
              className="flex w-full items-center gap-2 border-b border-border px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={isOpen}
              aria-controls={`source-content-${section.fundingSourceId}`}
            >
              {isOpen ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{section.fundingSourceName}</div>
                <div className="text-[11px] text-muted-foreground">
                  {section.fundingSourceTypeName}
                </div>
              </div>
              <div className="hidden gap-4 sm:flex">
                <SectionStat label="Planuota" value={section.planuota} />
                <SectionStat label="Faktinė" value={section.faktine} tone="primary" />
                <SectionStat
                  label="Likutis"
                  value={section.likutis}
                  tone={sectionLikutisNum < 0 ? 'destructive' : 'default'}
                />
                <SectionStat
                  label="%"
                  value={`${section.percentUsed.toFixed(1)}%`}
                />
              </div>
            </button>
            {isOpen && (
              <CardContent
                id={`source-content-${section.fundingSourceId}`}
                className="p-0"
              >
                {section.byCategory.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">
                    Šiame šaltinyje paskirstymų nėra.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table
                      className="w-full text-sm"
                      data-testid={`budget-source-table-${section.fundingSourceId}`}
                    >
                      <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <tr className="text-left">
                          <th className="px-3 py-2 font-semibold">Kategorija</th>
                          <th className="px-3 py-2 font-semibold">Pavadinimas</th>
                          <th className="px-3 py-2 text-right font-semibold">
                            Planuota
                          </th>
                          <th className="px-3 py-2 text-right font-semibold">
                            Faktinė
                          </th>
                          <th className="px-3 py-2 text-right font-semibold">
                            Likutis
                          </th>
                          <th className="px-3 py-2 text-right font-semibold">
                            % panaud.
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {section.byCategory.map((row) => {
                          const likutisNum = Number.parseFloat(row.likutis);
                          return (
                            <tr
                              key={row.categoryItemId}
                              data-testid={`budget-category-row-${row.categoryItemId}`}
                              data-tone={
                                row.isOver
                                  ? 'destructive'
                                  : row.isWarning
                                    ? 'warning'
                                    : 'default'
                              }
                            >
                              <td className="px-3 py-2">
                                <Badge variant="secondary" className="text-[10px]">
                                  {row.categoryName}
                                </Badge>
                              </td>
                              <td className="px-3 py-2 font-medium">
                                {row.allocationName}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatEur(row.planuota)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatEur(row.faktine)}
                              </td>
                              <td
                                className={cn(
                                  'px-3 py-2 text-right tabular-nums',
                                  likutisNum < 0 && 'font-medium text-destructive',
                                )}
                              >
                                {formatEur(row.likutis)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {row.isOver ? (
                                  <Badge
                                    variant="destructive"
                                    className="text-[10px]"
                                    data-testid={`budget-over-badge-${row.categoryItemId}`}
                                  >
                                    <AlertTriangle className="h-3 w-3" />
                                    Viršyta
                                  </Badge>
                                ) : row.isWarning ? (
                                  <Badge
                                    variant="warning"
                                    className="text-[10px]"
                                    data-testid={`budget-warning-badge-${row.categoryItemId}`}
                                  >
                                    <TriangleAlert className="h-3 w-3" />
                                    {row.percentUsed.toFixed(1)}%
                                  </Badge>
                                ) : (
                                  <span className="tabular-nums text-xs text-muted-foreground">
                                    {row.percentUsed.toFixed(1)}%
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

interface TotalCardProps {
  label: string;
  value: string;
  tone?: 'default' | 'primary' | 'success' | 'destructive';
}

function TotalCard({
  label,
  value,
  tone = 'default',
}: TotalCardProps): JSX.Element {
  const toneCls = {
    default: '',
    primary: 'border-primary/40',
    success: 'border-emerald-500/40',
    destructive: 'border-destructive/40',
  }[tone];

  return (
    <Card className={toneCls}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 truncate text-xl font-semibold tabular-nums">
          {formatEur(value)}
        </div>
      </CardContent>
    </Card>
  );
}

interface SectionStatProps {
  label: string;
  value: string;
  tone?: 'default' | 'primary' | 'destructive';
}

function SectionStat({
  label,
  value,
  tone = 'default',
}: SectionStatProps): JSX.Element {
  const valueCls = {
    default: '',
    primary: 'text-primary',
    destructive: 'text-destructive',
  }[tone];
  // Jei skaitinė reikšmė be valiutos (pvz., procentas), nepakeičiam string'o.
  const display = /^[-+]?\d+(?:[.,]\d+)?$/.test(value) ? formatEur(value) : value;
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn('font-semibold tabular-nums', valueCls)}>{display}</div>
    </div>
  );
}

export default BudgetExecutionReport;
