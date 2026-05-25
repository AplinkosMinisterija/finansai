/**
 * ClassifierSelect — dropdown'as su klasifikatoriaus reikšmėm.
 *
 * - Užkrauna nurodytą grupę per useClassifier.
 * - Default'inis režimas (legacy): value = item.code (saugomas DB lauke kaip string).
 * - Rodo: pavadinimas + (code) mažu šriftu.
 * - Palaiko optional 1-lygmens hierarchiją (top-level + sub).
 *
 * FVM Iter 10+ pridėtas `ClassifierSelectById` — analogiškas, bet grąžina
 * numeric `id` (FK į `classifier_items.id`). Naudoti naujiems FVM laukams,
 * kur DB tipas yra integer FK (ne text code).
 */
import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useClassifier, type ClassifierLookup } from '@/lib/classifiers';

type OrderedItem = {
  item: import('@biip-finansai/shared').ClassifierItem;
  isChild: boolean;
};

/**
 * Sudaro dropdown'o eilučių tvarką.
 *
 * UAT auditas P1: kai `showHierarchy`, anksčiau būdavo rodomi tik top-level
 * (parentId===null) + jų children TOJE PAČIOJE grupėje. Po PA-005 `source_program`
 * item'ai gavo `parentId`, rodantį į KITOS grupės (`funding_source_type`) item'ą —
 * tad jie tapdavo nei top-level, nei child → tyliai nukrisdavo (rodoma tik „Kita").
 * Fix: po hierarchijos surinkimo dar pridedam visus dar neįtrauktus item'us
 * („našlaičius", kurių tėvas ne šios grupės top-level) kaip top-level — niekas
 * nebenukrenta.
 */
export function buildOrderedItems(lookup: ClassifierLookup, showHierarchy: boolean): OrderedItem[] {
  if (!showHierarchy) {
    return lookup.items.map((item) => ({ item, isChild: false }));
  }
  const ordered: OrderedItem[] = [];
  const seen = new Set<number>();
  for (const top of lookup.topLevel) {
    ordered.push({ item: top, isChild: false });
    seen.add(top.id);
    const children = lookup.items.filter((i) => i.parentId === top.id);
    for (const c of children) {
      ordered.push({ item: c, isChild: true });
      seen.add(c.id);
    }
  }
  // Našlaičiai (tėvas ne šioje grupėje / neaktyvus) — rodomi kaip top-level.
  for (const it of lookup.items) {
    if (!seen.has(it.id)) ordered.push({ item: it, isChild: false });
  }
  return ordered;
}

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

  const currentValue = value === null || value === undefined || value === '' ? NONE_VALUE : value;

  const ordered = buildOrderedItems(lookup, showHierarchy);

  return (
    <Select value={currentValue} onValueChange={(v) => onChange(v === NONE_VALUE ? null : v)}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={placeholder ?? 'Pasirinkite…'} />
      </SelectTrigger>
      <SelectContent>
        {emptyLabel !== undefined && <SelectItem value={NONE_VALUE}>{emptyLabel}</SelectItem>}
        {ordered.map(({ item, isChild }) => (
          <SelectItem key={item.id} value={item.code}>
            <span className={isChild ? 'pl-3' : ''}>
              {item.name} <span className="text-[10px] text-muted-foreground">({item.code})</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface ClassifierSelectByIdProps {
  groupCode: string;
  /** Numeric ID (FK) arba null. */
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  /** Tuščio pasirinkimo eilutės etiketė. Jei undefined — privalomas. */
  emptyLabel?: string;
  placeholder?: string;
  id?: string;
  className?: string;
  /** Jei true — atskiria child item'us indentu. Default: true. */
  showHierarchy?: boolean;
  /**
   * Callback'as su gauto item'o pilnais duomenimis (code, name) — naudinga,
   * kai parent komponentui reikia ne tik ID, bet ir code'o, pvz., conditional
   * UI logikai (kategorija = spec_programa).
   */
  onItemChange?: (item: import('@biip-finansai/shared').ClassifierItem | null) => void;
}

/**
 * Numeric ID variantas — naudoti FVM laukams (`budget_category_id`,
 * `funding_source_type_id`, ...), kur DB tipas yra integer FK į `classifier_items.id`.
 */
export function ClassifierSelectById({
  groupCode,
  value,
  onChange,
  emptyLabel,
  placeholder,
  id,
  className,
  showHierarchy = true,
  onItemChange,
}: ClassifierSelectByIdProps): JSX.Element {
  const lookup = useClassifier(groupCode);

  const currentValue = value === null || value === undefined ? NONE_VALUE : String(value);

  const ordered = buildOrderedItems(lookup, showHierarchy);

  return (
    <Select
      value={currentValue}
      onValueChange={(v) => {
        if (v === NONE_VALUE) {
          onChange(null);
          onItemChange?.(null);
          return;
        }
        const parsed = Number.parseInt(v, 10);
        if (!Number.isFinite(parsed)) {
          onChange(null);
          onItemChange?.(null);
          return;
        }
        onChange(parsed);
        const item = lookup.items.find((it) => it.id === parsed) ?? null;
        onItemChange?.(item);
      }}
    >
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={placeholder ?? 'Pasirinkite…'} />
      </SelectTrigger>
      <SelectContent>
        {emptyLabel !== undefined && <SelectItem value={NONE_VALUE}>{emptyLabel}</SelectItem>}
        {ordered.map(({ item, isChild }) => (
          <SelectItem key={item.id} value={String(item.id)}>
            <span className={isChild ? 'pl-3' : ''}>
              {item.name} <span className="text-[10px] text-muted-foreground">({item.code})</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
