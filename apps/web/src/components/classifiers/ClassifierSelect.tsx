/**
 * ClassifierSelect — dropdown'as su klasifikatoriaus reikšmėm.
 *
 * - Užkrauna nurodytą grupę per useClassifier.
 * - Reikšmės value = item.code (saugomas DB lauke kaip string).
 * - Rodo: pavadinimas + (code) mažu šriftu.
 * - Palaiko optional 1-lygmens hierarchiją (top-level + sub).
 */
import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useClassifier } from '@/lib/classifiers';

export interface ClassifierSelectProps {
  groupCode: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  /** Tuščio pasirinkimo eilutės etiketė. Jei undefined — privalomas. */
  emptyLabel?: string;
  placeholder?: string;
  id?: string;
  className?: string;
  /** Jei true — atskiria child item'us indentu. Default: true. */
  showHierarchy?: boolean;
}

const NONE_VALUE = '__none__';

export function ClassifierSelect({
  groupCode,
  value,
  onChange,
  emptyLabel,
  placeholder,
  id,
  className,
  showHierarchy = true,
}: ClassifierSelectProps): JSX.Element {
  const lookup = useClassifier(groupCode);

  const currentValue =
    value === null || value === undefined || value === '' ? NONE_VALUE : value;

  // Stable order: top-level, paskui jų children. Backend grąžina jau pagal sort.
  const ordered: { item: import('@biip-finansai/shared').ClassifierItem; isChild: boolean }[] = [];
  if (showHierarchy) {
    for (const top of lookup.topLevel) {
      ordered.push({ item: top, isChild: false });
      const children = lookup.items.filter((i) => i.parentId === top.id);
      for (const c of children) ordered.push({ item: c, isChild: true });
    }
  } else {
    for (const it of lookup.items) ordered.push({ item: it, isChild: false });
  }

  return (
    <Select
      value={currentValue}
      onValueChange={(v) => onChange(v === NONE_VALUE ? null : v)}
    >
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={placeholder ?? 'Pasirinkite…'} />
      </SelectTrigger>
      <SelectContent>
        {emptyLabel !== undefined && (
          <SelectItem value={NONE_VALUE}>{emptyLabel}</SelectItem>
        )}
        {ordered.map(({ item, isChild }) => (
          <SelectItem key={item.id} value={item.code}>
            <span className={isChild ? 'pl-3' : ''}>
              {item.name}{' '}
              <span className="text-[10px] text-muted-foreground">({item.code})</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
