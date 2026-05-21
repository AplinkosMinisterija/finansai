/**
 * `ProjectTypeBadge` — projekto tipo badge'as su LT etikete ir spalvomis.
 *
 * Tipai:
 *  - projektas     → outline (paprastas projektas)
 *  - spec_programa → default (specialioji programa — akcentuojama)
 *  - veikla        → secondary (skyriaus veikla)
 */
import * as React from 'react';
import type { ProjectType } from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  projektas: 'Projektas',
  spec_programa: 'Spec. programa',
  veikla: 'Veikla',
};

const TYPE_VARIANTS: Record<ProjectType, 'outline' | 'default' | 'secondary'> = {
  projektas: 'outline',
  spec_programa: 'default',
  veikla: 'secondary',
};

export interface ProjectTypeBadgeProps {
  type: ProjectType;
  className?: string;
}

export function ProjectTypeBadge({
  type,
  className,
}: ProjectTypeBadgeProps): JSX.Element {
  return (
    <Badge variant={TYPE_VARIANTS[type]} className={className}>
      {PROJECT_TYPE_LABELS[type]}
    </Badge>
  );
}

export default ProjectTypeBadge;
