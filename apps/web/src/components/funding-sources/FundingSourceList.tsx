/**
 * `FundingSourceList` — finansavimo šaltinių sąrašas su filtrais.
 *
 * Filters:
 *  - year (per puslapio query param)
 *  - type (klasifikatorius `funding_source_type`)
 *  - active toggle
 *
 * Renders kortelių grid. Empty state'as ir loading'as paliekam parent'ui —
 * čia tik konkretus list rendering pagal pateiktus data.
 */
import * as React from 'react';
import type { FundingSource } from '@biip-finansai/shared';
import { FundingSourceCard } from './FundingSourceCard';

export interface FundingSourceListProps {
  sources: FundingSource[];
  canEdit: boolean;
  onSelect: (source: FundingSource) => void;
  onEdit: (source: FundingSource) => void;
  onDelete: (source: FundingSource) => void;
}

export function FundingSourceList({
  sources,
  canEdit,
  onSelect,
  onEdit,
  onDelete,
}: FundingSourceListProps): JSX.Element {
  return (
    <ul className="space-y-3" data-testid="funding-source-list">
      {sources.map((s) => (
        <li key={s.id}>
          <FundingSourceCard
            source={s}
            canEdit={canEdit}
            onSelect={() => onSelect(s)}
            onEdit={() => onEdit(s)}
            onDelete={() => onDelete(s)}
          />
        </li>
      ))}
    </ul>
  );
}
