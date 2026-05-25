/**
 * `buildOrderedItems` testai (UAT auditas P1).
 *
 * Regresijos apsauga: po PA-005 `source_program` item'ai gauna `parentId`,
 * rodantį į KITOS grupės (`funding_source_type`) item'ą. Anksčiau toks item'as
 * nukrisdavo iš dropdown'o (nei top-level, nei in-group child). Dabar „našlaičiai"
 * rodomi kaip top-level.
 */
import { describe, expect, it } from 'vitest';
import type { ClassifierItem } from '@biip-finansai/shared';
import { buildOrderedItems } from '../ClassifierSelect';
import type { ClassifierLookup } from '@/lib/classifiers';

function item(over: Partial<ClassifierItem> & { id: number; code: string }): ClassifierItem {
  return {
    groupId: 1,
    parentId: null,
    name: over.code,
    sortOrder: over.id,
    active: true,
    ...over,
  };
}

function lookupOf(items: ClassifierItem[]): ClassifierLookup {
  return {
    items,
    byCode: new Map(items.map((i) => [i.code, i])),
    topLevel: items.filter((i) => i.parentId === null),
    isLoading: false,
  };
}

describe('buildOrderedItems', () => {
  it('PA-005 regresija: cross-group parentId item NENUKRENTA (rodomas kaip top-level)', () => {
    // 4 programos su parentId → funding_source_type (ID 900+, ne šioje grupėje) + 1 be tėvo.
    const programs = [
      item({ id: 1, code: 'AM_IT_BUDGET', parentId: 900 }),
      item({ id: 2, code: 'AM_TRAINING_BUDGET', parentId: 900 }),
      item({ id: 3, code: 'EU_FUNDS', parentId: 901 }),
      item({ id: 4, code: 'OTHER', parentId: null }),
    ];
    const ordered = buildOrderedItems(lookupOf(programs), true);
    const codes = ordered.map((o) => o.item.code);
    // VISOS programos turi būti renderinamos (anksčiau liko tik OTHER).
    expect(codes).toEqual(
      expect.arrayContaining(['AM_IT_BUDGET', 'AM_TRAINING_BUDGET', 'EU_FUNDS', 'OTHER']),
    );
    expect(ordered).toHaveLength(4);
  });

  it('tikra hierarchija: top-level + jų children su isChild', () => {
    const items = [
      item({ id: 1, code: 'IT', parentId: null }),
      item({ id: 2, code: 'IT_LICENSES', parentId: 1 }),
      item({ id: 3, code: 'TRAINING', parentId: null }),
    ];
    const ordered = buildOrderedItems(lookupOf(items), true);
    expect(ordered.map((o) => [o.item.code, o.isChild])).toEqual([
      ['IT', false],
      ['IT_LICENSES', true],
      ['TRAINING', false],
    ]);
  });

  it('showHierarchy=false: plokščias sąrašas, visi isChild=false', () => {
    const items = [
      item({ id: 1, code: 'A', parentId: null }),
      item({ id: 2, code: 'B', parentId: 1 }),
    ];
    const ordered = buildOrderedItems(lookupOf(items), false);
    expect(ordered.map((o) => o.item.code)).toEqual(['A', 'B']);
    expect(ordered.every((o) => !o.isChild)).toBe(true);
  });
});
