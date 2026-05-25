/**
 * Klasifikatorių lookup'as — UI'ui reikia konvertuoti saugotą `code` (DB lauke)
 * į žmogui draugišką pavadinimą iš klasifikatoriaus.
 *
 * Naudoja React Query cache, kad daug komponentų to paties klasifikatoriaus
 * neperkrautų pakartotinai.
 */
import { useQuery } from '@tanstack/react-query';
import type { ClassifierItem } from '@biip-finansai/shared';
import { classifierItemsList } from './api';

export interface ClassifierLookup {
  items: ClassifierItem[];
  byCode: Map<string, ClassifierItem>;
  /** Top-level (parentId === null) reikšmės, surūšiuotos. */
  topLevel: ClassifierItem[];
  isLoading: boolean;
}

const EMPTY_LOOKUP: ClassifierLookup = {
  items: [],
  byCode: new Map(),
  topLevel: [],
  isLoading: false,
};

export function useClassifier(groupCode: string): ClassifierLookup {
  const q = useQuery<ClassifierItem[]>({
    queryKey: ['classifierItems', { groupCode }],
    queryFn: () => classifierItemsList({ groupCode }),
    staleTime: 5 * 60 * 1000, // 5 min cache — klasifikatoriai keičiasi retai
  });
  if (!q.data) {
    return { ...EMPTY_LOOKUP, isLoading: q.isLoading };
  }
  const byCode = new Map<string, ClassifierItem>();
  for (const it of q.data) byCode.set(it.code, it);
  return {
    items: q.data,
    byCode,
    topLevel: q.data.filter((i) => i.parentId === null),
    isLoading: false,
  };
}

/** Iš saugoto code grąžina žmogui draugišką pavadinimą; fallback'as — pats code. */
export function classifierLabel(lookup: ClassifierLookup, code: string | null | undefined): string {
  if (!code) return '—';
  const it = lookup.byCode.get(code);
  return it?.name ?? code;
}

/**
 * UAT #42 (PA-007): trumpas label'as sąrašams/badge'ams — grąžina `code`
 * (Trumpinį, pvz. „IAMS"), o ne pilną pavadinimą. Naudoti IS sistemos
 * stulpeliuose, badge'uose ir kitur, kur reikia kompaktiško žymens. Detali
 * peržiūra naudoja `classifierLabel` (pilnas pavadinimas).
 */
export function classifierShortLabel(
  lookup: ClassifierLookup,
  code: string | null | undefined,
): string {
  if (!code) return '—';
  const it = lookup.byCode.get(code);
  return it?.code ?? code;
}
