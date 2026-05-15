/**
 * MultiSelect — shadcn-stiliaus daugiapasirinkimo dropdown'as.
 *
 * Naudojimas:
 *   <MultiSelect
 *     options={[{ value: '1', label: 'Org A' }, ...]}
 *     value={['1', '3']}
 *     onChange={setValue}
 *     placeholder="Pasirinkite organizacijas…"
 *     emptyLabel="Visos organizacijos"
 *   />
 *
 * Be papildomų deps (be Popover/cmdk) — naudoja paprastą click-outside hook'ą.
 */
import * as React from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Antrinė informacija, rodoma šalia (pvz., organizacijos kodas). */
  sublabel?: string;
}

export interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Etiketė rodoma kai value yra tuščias (semantiškai = „visi"). */
  emptyLabel?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Slėpti paieškos lauką, jei sąrašas trumpas. */
  hideSearch?: boolean;
  'aria-label'?: string;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Pasirinkite…',
  emptyLabel,
  disabled,
  id,
  className,
  hideSearch = false,
  'aria-label': ariaLabel,
}: MultiSelectProps): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Click-outside
  React.useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent): void {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = React.useMemo(
    () => options.filter((o) => value.includes(o.value)),
    [options, value],
  );

  const filtered = React.useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel ? o.sublabel.toLowerCase().includes(q) : false),
    );
  }, [options, query]);

  function toggle(v: string): void {
    if (value.includes(v)) {
      onChange(value.filter((x) => x !== v));
    } else {
      onChange([...value, v]);
    }
  }

  function clear(e: React.MouseEvent): void {
    e.stopPropagation();
    onChange([]);
  }

  const showEmptyLabel = value.length === 0 && emptyLabel !== undefined;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <div className="flex flex-1 flex-wrap items-center gap-1">
          {selected.length === 0 ? (
            <span className="text-muted-foreground">
              {showEmptyLabel ? emptyLabel : placeholder}
            </span>
          ) : (
            selected.map((o) => (
              <Badge
                key={o.value}
                variant="secondary"
                className="gap-1 pl-2 pr-1 text-[11px]"
              >
                {o.label}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Pašalinti ${o.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(o.value);
                  }}
                  className="ml-0.5 rounded-sm p-0.5 hover:bg-muted-foreground/20"
                >
                  <X className="h-3 w-3" />
                </span>
              </Badge>
            ))
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
          {selected.length > 0 && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Pašalinti viską"
              onClick={clear}
              className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
        </div>
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
          role="listbox"
        >
          {!hideSearch && options.length > 6 && (
            <div className="border-b border-border p-2">
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ieškoti…"
                className="h-8 w-full rounded-sm border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
          <ul className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">Nieko nerasta</li>
            ) : (
              filtered.map((o) => {
                const checked = value.includes(o.value);
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      onClick={() => toggle(o.value)}
                      role="option"
                      aria-selected={checked}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                        'hover:bg-accent hover:text-accent-foreground',
                        checked && 'bg-accent/50',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        tabIndex={-1}
                        aria-hidden
                        className="pointer-events-none"
                      />
                      <span className="flex-1 truncate">
                        {o.sublabel && (
                          <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">
                            {o.sublabel}
                          </span>
                        )}
                        {o.label}
                      </span>
                      {checked && <Check className="h-3.5 w-3.5 text-primary" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
