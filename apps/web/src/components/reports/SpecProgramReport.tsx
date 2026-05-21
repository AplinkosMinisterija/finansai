/**
 * `SpecProgramReport` — F13 ataskaitos lentelė.
 *
 * Stulpeliai: prašymas | tenant | prašyta | patvirtinta | panaudota | likutis | %
 *            | projekto statusas.
 *
 * Kiekvienoje eilutėje rodomas vieno APPROVED spec.programos prašymo
 * agreguotas progresas (sumos iš `prašyta`, `patvirtinta`, `panaudota`).
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type {
  SpecProgramReport as SpecProgramReportData,
} from '@biip-finansai/shared';
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

const PROJECT_STATUS_LABELS: Record<
  Exclude<
    NonNullable<SpecProgramReportData['items'][number]['projektoStatusas']>,
    never
  >,
  string
> = {
  planuojama: 'Planuojama',
  vykdoma: 'Vykdoma',
  baigta: 'Baigta',
  uzdaryta: 'Uždaryta',
};

export interface SpecProgramReportProps {
  data: SpecProgramReportData;
}

export function SpecProgramReport({
  data,
}: SpecProgramReportProps): JSX.Element {
  if (data.items.length === 0) {
    return (
      <Card data-testid="spec-program-empty">
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Šiems metams patvirtintų spec. programų prašymų nėra.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="spec-program-report">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TotalCard label="Prašyta" value={data.totalPrasyta} />
        <TotalCard label="Patvirtinta" value={data.totalPatvirtinta} tone="primary" />
        <TotalCard label="Panaudota" value={data.totalPanaudota} tone="success" />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="spec-program-table">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="text-left">
                  <th className="px-3 py-2 font-semibold">Prašymas</th>
                  <th className="px-3 py-2 font-semibold">Organizacija</th>
                  <th className="px-3 py-2 text-right font-semibold">Prašyta</th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Patvirtinta
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">Panaudota</th>
                  <th className="px-3 py-2 text-right font-semibold">Likutis</th>
                  <th className="px-3 py-2 text-right font-semibold">%</th>
                  <th className="px-3 py-2 font-semibold">Projektas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.map((item) => {
                  const likutisNum = Number.parseFloat(item.likutis);
                  return (
                    <tr
                      key={item.requestId}
                      data-testid={`spec-program-row-${item.requestId}`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">
                          {item.requestProjectName}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          #{item.requestId}
                          {item.specProgramFundingType ? (
                            <>
                              {' · '}
                              {item.specProgramFundingType === 'atskiras'
                                ? 'Atskiras finansavimas'
                                : 'Biudžeto dalis'}
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{item.tenantName}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {item.tenantCode}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatEur(item.prasyta)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatEur(item.patvirtinta)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatEur(item.panaudota)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right tabular-nums',
                          likutisNum < 0 && 'font-medium text-destructive',
                        )}
                      >
                        {formatEur(item.likutis)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {item.percentUsed.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2">
                        {item.projektoId && item.projektoStatusas ? (
                          <Badge variant="secondary" className="text-[10px]">
                            #{item.projektoId} ·{' '}
                            {PROJECT_STATUS_LABELS[item.projektoStatusas]}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Nesukurtas
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface TotalCardProps {
  label: string;
  value: string;
  tone?: 'default' | 'primary' | 'success';
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

export default SpecProgramReport;
