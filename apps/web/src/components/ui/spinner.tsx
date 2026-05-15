import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASS = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
} as const;

/**
 * Minimalus spinner'is — naudojam route-level Suspense fallback'ams.
 * Inline SVG, jokios papildomos dependencies.
 */
export function Spinner({
  size = 'md',
  className,
  ...rest
}: SpinnerProps): JSX.Element {
  return (
    <div
      className={cn('inline-flex items-center justify-center', className)}
      {...rest}
    >
      <Loader2
        className={cn('animate-spin text-muted-foreground', SIZE_CLASS[size])}
        aria-hidden="true"
      />
      <span className="sr-only">Kraunama…</span>
    </div>
  );
}

export default Spinner;
