/**
 * `PayrollList` — DU profile'ų lentelė (Iter 13, FVM-5).
 *
 * Stulpeliai: Vardas | Pareigos | Sutartis | Bruto + priedai | Galioja | Veiksmai.
 *
 * SAUGUMAS: komponentas pats permission'us NE-tikrina — tiketinamas tik per
 * tinkamai gate'intą puslapį (`DuPage` route guard). Veiksmų mygtukai paslepiami
 * per `canEdit` / `canDelete` prop'us iš kviečiančio puslapio.
 */
import * as React from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { ContractType, PayrollProfile } from '@biip-finansai/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  darbo: 'Darbo',
  paslaugu: 'Paslaugų',
  autorine: 'Autorinė',
};

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

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  // Display only YYYY-MM-DD portion (input is ISO 8601 date string).
  return value.slice(0, 10);
}

export interface PayrollListProps {
  profiles: PayrollProfile[];
  isLoading: boolean;
  isError: boolean;
  canEdit: boolean;
  canDelete: boolean;
  emptyMessage: string;
  onSelect: (p: PayrollProfile) => void;
  onEdit: (p: PayrollProfile) => void;
  onDelete: (p: PayrollProfile) => void;
}

export function PayrollList({
  profiles,
  isLoading,
  isError,
  canEdit,
  canDelete,
  emptyMessage,
  onSelect,
  onEdit,
  onDelete,
}: PayrollListProps): JSX.Element {
  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="payroll-skeleton">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-destructive">
          Nepavyko užkrauti DU profilių.
        </CardContent>
      </Card>
    );
  }

  if (profiles.length === 0) {
    return (
      <Card>
        <CardContent
          className="p-12 text-center text-sm text-muted-foreground"
          data-testid="payroll-empty"
        >
          {emptyMessage}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm" data-testid="payroll-table">
          <thead className="border-b border-border bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Vardas, pavardė</th>
              <th className="px-3 py-2 font-medium">Pareigos</th>
              <th className="px-3 py-2 font-medium">Sutartis</th>
              <th className="px-3 py-2 font-medium text-right">Bruto</th>
              <th className="px-3 py-2 font-medium text-right">Priedai</th>
              <th className="px-3 py-2 font-medium">Galioja</th>
              <th className="px-3 py-2 font-medium text-right">Veiksmai</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr
                key={p.id}
                data-testid={`payroll-row-${p.id}`}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40"
                onClick={() => onSelect(p)}
              >
                <td className="px-3 py-2">
                  <div className="font-medium">{p.vardasPavarde}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {p.tenantCode ?? `Tenant #${p.tenantId}`}
                    {p.userFullName ? ` · ${p.userFullName}` : ''}
                  </div>
                </td>
                <td className="px-3 py-2">{p.pareigos}</td>
                <td className="px-3 py-2 text-xs">
                  {CONTRACT_TYPE_LABELS[p.sutartiesTipas]}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {formatEur(p.atlyginimasBruto)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatEur(p.priedai)}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {formatDate(p.galiojaNuo)} – {formatDate(p.galiojaIki)}
                </td>
                <td
                  className="px-3 py-2 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="inline-flex gap-1">
                    {canEdit && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onEdit(p)}
                        title="Redaguoti"
                        data-testid={`edit-payroll-${p.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => onDelete(p)}
                        title="Ištrinti"
                        data-testid={`delete-payroll-${p.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export default PayrollList;
