/**
 * `ExpenseTypeBadge` — išlaidos tipo badge'as su LT etikete ir spalvomis.
 *
 * Tipai (FVM-4):
 *  - du          → default (akcentas — darbo užmokestis)
 *  - sutartis    → secondary (paslaugos, autorinė sutartis)
 *  - saskaita    → info (sąskaita-faktūra)
 *  - tiesiogine  → outline (kita / smulkios pirkimai)
 */
import * as React from 'react';
import type { ExpenseType } from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';

export const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = {
  du: 'DU',
  sutartis: 'Sutartis',
  saskaita: 'Sąskaita',
  tiesiogine: 'Tiesioginė',
};

const TYPE_VARIANTS: Record<
  ExpenseType,
  'default' | 'secondary' | 'info' | 'outline'
> = {
  du: 'default',
  sutartis: 'secondary',
  saskaita: 'info',
  tiesiogine: 'outline',
};

export interface ExpenseTypeBadgeProps {
  type: ExpenseType;
  className?: string;
}

export function ExpenseTypeBadge({
  type,
  className,
}: ExpenseTypeBadgeProps): JSX.Element {
  return (
    <Badge variant={TYPE_VARIANTS[type]} className={className}>
      {EXPENSE_TYPE_LABELS[type]}
    </Badge>
  );
}

export default ExpenseTypeBadge;
