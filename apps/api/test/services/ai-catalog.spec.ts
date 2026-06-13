/**
 * AI katalogo `applyHydration` konversijų testai (Iter 18).
 *
 * applyHydration adaptuoja duomenų šaltinio rezultatą (kind) prie widget.type:
 * series→pie, categorical→bar ir t.t. Šios konversijos — kritinė vieta, todėl
 * testuojamos tiesiogiai (pure funkcija, be DB).
 */
import type { AiWidget } from '@biip-finansai/shared';
import { applyHydration, type HydrationResult } from '../../src/services/ai/catalog';

function widget(type: AiWidget['type'], extra: Partial<AiWidget> = {}): AiWidget {
  return { id: 'w', type, ...extra };
}

describe('applyHydration', () => {
  it('stat: užpildo value/subtitle/trend', () => {
    const r: HydrationResult = {
      kind: 'stat',
      value: '100 €',
      subtitle: 'sub',
      trend: { direction: 'up', text: 'auga', positive: true },
    };
    const w = applyHydration(widget('stat'), r);
    expect(w.value).toBe('100 €');
    expect(w.subtitle).toBe('sub');
    expect(w.trend?.text).toBe('auga');
  });

  it('series → bar/line/area: data+xKey+series', () => {
    const r: HydrationResult = {
      kind: 'series',
      data: [{ menuo: '2026-01', suma: 10 }],
      xKey: 'menuo',
      series: [{ key: 'suma' }],
      format: 'eur',
    };
    const w = applyHydration(widget('bar'), r);
    expect(w.xKey).toBe('menuo');
    expect(w.series?.[0]?.key).toBe('suma');
    expect(w.data).toHaveLength(1);
    expect(w.format).toBe('eur');
  });

  it('series → pie: konvertuoja į {name,value}', () => {
    const r: HydrationResult = {
      kind: 'series',
      data: [
        { statusas: 'Pateikti', kiekis: 3 },
        { statusas: 'Patvirtinti', kiekis: 5 },
      ],
      xKey: 'statusas',
      series: [{ key: 'kiekis' }],
    };
    const w = applyHydration(widget('pie'), r);
    expect(w.data).toEqual([
      { name: 'Pateikti', value: 3 },
      { name: 'Patvirtinti', value: 5 },
    ]);
  });

  it('categorical → pie: tiesioginis', () => {
    const r: HydrationResult = {
      kind: 'categorical',
      data: [{ name: 'DU', value: 60 }],
      format: 'eur',
    };
    const w = applyHydration(widget('pie'), r);
    expect(w.data).toEqual([{ name: 'DU', value: 60 }]);
  });

  it('categorical → bar: konvertuoja į xKey+series', () => {
    const r: HydrationResult = {
      kind: 'categorical',
      data: [{ name: 'DU', value: 60 }],
    };
    const w = applyHydration(widget('bar', { title: 'Kategorijos' }), r);
    expect(w.xKey).toBe('kategorija');
    expect(w.data?.[0]).toEqual({ kategorija: 'DU', suma: 60 });
    expect(w.series?.[0]?.key).toBe('suma');
  });

  it('table / progress / sankey / treemap: užpildo atitinkamus laukus', () => {
    const tbl = applyHydration(widget('table'), {
      kind: 'table',
      columns: [{ key: 'a', label: 'A' }],
      rows: [{ a: 1 }],
    });
    expect(tbl.columns).toHaveLength(1);
    expect(tbl.rows).toHaveLength(1);

    const prog = applyHydration(widget('progress'), {
      kind: 'progress',
      items: [{ label: 'X', value: 5, max: 10 }],
    });
    expect(prog.items).toHaveLength(1);

    const sankey = applyHydration(widget('sankey'), {
      kind: 'sankey',
      nodes: [{ name: 'A' }, { name: 'B' }],
      links: [{ source: 0, target: 1, value: 10 }],
    });
    expect(sankey.nodes).toHaveLength(2);
    expect(sankey.links).toHaveLength(1);

    const treemap = applyHydration(widget('treemap'), {
      kind: 'treemap',
      treemap: [{ name: 'src', children: [{ name: 'a', value: 5 }] }],
    });
    expect(treemap.treemap).toHaveLength(1);
  });
});
