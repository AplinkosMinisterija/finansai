/**
 * AI spec localStorage persistencijos testai (Iter 17).
 */
import type { AiDashboardSpec } from '@biip-finansai/shared';
import { aiSpecStorageKey, clearSavedAiSpec, loadSavedAiSpec, saveAiSpec } from './ai-spec-storage';

const SPEC: AiDashboardSpec = {
  title: 'Išsaugotas vaizdas',
  widgets: [{ id: 'w1', type: 'stat', title: 'X', value: '42 €' }],
};

describe('ai-spec-storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('raktas per user id — skirtingi vartotojai nesidalina', () => {
    expect(aiSpecStorageKey(1)).not.toBe(aiSpecStorageKey(2));
    expect(aiSpecStorageKey(undefined)).toContain('anon');
  });

  it('save → load grąžina tą patį (validuotą) spec', () => {
    const key = aiSpecStorageKey(1);
    saveAiSpec(key, SPEC);
    const loaded = loadSavedAiSpec(key);
    expect(loaded?.title).toBe('Išsaugotas vaizdas');
    expect(loaded?.widgets[0]?.id).toBe('w1');
  });

  it('sugadintas storage turinys → null (be exception)', () => {
    const key = aiSpecStorageKey(1);
    window.localStorage.setItem(key, 'ne json {{{');
    expect(loadSavedAiSpec(key)).toBeNull();
    window.localStorage.setItem(key, JSON.stringify({ spec: { widgets: [] } }));
    expect(loadSavedAiSpec(key)).toBeNull();
  });

  it('clear pašalina įrašą', () => {
    const key = aiSpecStorageKey(1);
    saveAiSpec(key, SPEC);
    clearSavedAiSpec(key);
    expect(loadSavedAiSpec(key)).toBeNull();
  });
});
