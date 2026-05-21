/**
 * `PayrollDistributionReport` — F14 ataskaitos lentelė. Permission-gated.
 *
 * Rodo:
 *  - Bendra suma (grandTotal) kortelėje viršuje
 *  - „Iš viso pagal šaltinį" suvestinė (totalsBySource)
 *  - Vienos eilutės per profilį, su per-source breakdown vidiniame sąraše
 *
 * SAUGUMAS: komponentė pati permission'us neaktivuoja — kviečiantis puslapis
 * tai padaro per `canViewPayroll`. Backend papildomai forsuoja per
 * `requireDuAccess` (defense-in-depth).
 */
import * as React from 'react';
import type {
  PayrollDistributionReport as PayrollDistributionReportData,
} from '@biip-finansai/shared';
import { Card, CardContent } from '@/components/ui/card';

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

export interface PayrollDistributionReportProps {
  data: PayrollDistributionReportData;
}

export function PayrollDistributionReport({
  data,
}: PayrollDistributionReportProps): JSX.Element {
  if (data.byProfile.length === 0) {
    return (
      <Card data-testid="payroll-distribution-empty">
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Šiame laikotarpyje DU išlaidų nėra.
        </CardContent>
      </Card>
    );
  }

  // Visi šaltiniai, su kuriais susiję bet kokie profiliai per pasirinktą laikotarpį,
  // gauti per `totalsBySource` (jau backend sortuotas pagal pavadinimą).
  const allSources = data.totalsBySource;

  return (
    <div className="space-y-4" data-testid="payroll-distribution-report">
      <Card className="border-primary/40">
        <CardContent className="p-4">
          <div className="text-xs text-muted-foreground">
            Iš viso DU per laikotarpį ({data.from} – {data.to})
          </div>
          <div className="mt-1 truncate text-xl font-semibold tabular-nums">
            {formatEur(data.grandTotal)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm"
              data-testid="payroll-distribution-table"
            >
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="text-left">
                  <th className="px-3 py-2 font-semibold">Darbuotojas</th>
                  {allSources.map((s) => (
                    <th
                      key={s.fundingSourceId}
                      className="px-3 py-2 text-right font-semibold"
                      title={s.fundingSourceName}
                    >
                      {s.fundingSourceCode}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold">
                    Iš viso
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.byProfile.map((profile) => {
                  // Per-profile sources lookup'as
                  const bySrc = new Map<number, string>();
                  for (const r of profile.bySource) {
                    bySrc.set(r.fundingSourceId, r.sumaPerLaikotarpi);
                  }
                  return (
                    <tr
                      key={profile.profileId}
                      data-testid={`payroll-distribution-row-${profile.profileId}`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{profile.vardasPavarde}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {profile.pareigos} · {profile.tenantCode}
                        </div>
                      </td>
                      {allSources.map((s) => {
                        const val = bySrc.get(s.fundingSourceId);
                        return (
                          <td
                            key={s.fundingSourceId}
                            className="px-3 py-2 text-right tabular-nums"
                          >
                            {val ? (
                              formatEur(val)
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {formatEur(profile.totalPerLaikotarpi)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-border bg-muted/30">
                <tr>
                  <td className="px-3 py-2 text-right font-semibold">Iš viso:</td>
                  {allSources.map((s) => (
                    <td
                      key={s.fundingSourceId}
                      className="px-3 py-2 text-right font-semibold tabular-nums"
                    >
                      {formatEur(s.total)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {formatEur(data.grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default PayrollDistributionReport;
