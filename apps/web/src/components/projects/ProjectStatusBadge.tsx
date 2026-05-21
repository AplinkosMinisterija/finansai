/**
 * `ProjectStatusBadge` — projekto statuso badge'as su LT etikete ir spalvomis.
 *
 * Naudoja shadcn `Badge` su skirtingais `variant`'ais pagal statusą:
 *  - planuojama → secondary (pilka)
 *  - vykdoma    → info       (mėlyna)
 *  - baigta     → success    (žalia)
 *  - uzdaryta   → muted      (silpna pilka)
 */
import * as React from 'react';
import type { ProjectStatus } from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planuojama: 'Planuojama',
  vykdoma: 'Vykdoma',
  baigta: 'Baigta',
  uzdaryta: 'Uždaryta',
};

const STATUS_VARIANTS: Record<ProjectStatus, 'secondary' | 'info' | 'success' | 'muted'> = {
  planuojama: 'secondary',
  vykdoma: 'info',
  baigta: 'success',
  uzdaryta: 'muted',
};

export interface ProjectStatusBadgeProps {
  status: ProjectStatus;
  className?: string;
}

export function ProjectStatusBadge({
  status,
  className,
}: ProjectStatusBadgeProps): JSX.Element {
  return (
    <Badge variant={STATUS_VARIANTS[status]} className={className}>
      {PROJECT_STATUS_LABELS[status]}
    </Badge>
  );
}

export default ProjectStatusBadge;
