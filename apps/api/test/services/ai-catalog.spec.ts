/**
 * AI katalogo `applyHydration` konversijų testai (Iter 18).
 *
 * applyHydration adaptuoja duomenų šaltinio rezultatą (kind) prie widget.type:
 * series→pie, categorical→bar ir t.t. Šios konversijos — kritinė vieta, todėl
 * testuojamos tiesiogiai (pure funkcija, be DB).
 */
import type { AiWidget } from '@biip-finansai/shared';
import type { Context } from 'moleculer';
import { applyHydration, hydrateSpec, type HydrationResult } from '../../src/services/ai/catalog';
import type { AuthMeta } from '../../src/services/auth.service';

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

describe('hydrateSpec — globalūs metai (spec.year override)', () => {
  /** Fake ctx, kuris įrašo broker.call'us ir grąžina kanonines reikšmes. */
  function makeFakeCtx(
    calls: Array<{ action: string; params: unknown }>,
  ): Context<unknown, AuthMeta> {
    return {
      meta: { user: { id: 1 } },
      broker: {
        call: (action: string, params: unknown) => {
          calls.push({ action, params });
          if (action === 'requests.list') {
            return Promise.resolve({ items: [], total: 0, page: 1, pageSize: 200 });
          }
          if (action === 'dashboard.fvmSummary') {
            return Promise.resolve({
              year: (params as { year: number }).year,
              generatedAt: '',
              budgetTotals: {
                planuota: '0',
                faktine: '0',
                likutis: '0',
                percentUsed: 0,
                isWarning: false,
                isOver: false,
              },
              topWarnings: [],
              upcomingDeadlines: [],
              activeProjectsCount: 0,
              completedProjectsCount: 0,
              totalSourcesCount: 0,
              totalAllocationsCount: 0,
            });
          }
          return Promise.resolve({});
        },
      },
    } as unknown as Context<unknown, AuthMeta>;
  }

  it('spec.year perrašo kiekvieno dataRef year (net jei widget nurodė kitą)', async () => {
    const calls: Array<{ action: string; params: unknown }> = [];
    const ctx = makeFakeCtx(calls);
    await hydrateSpec(
      ctx,
      {
        year: 2025,
        widgets: [
          {
            id: 'm',
            type: 'stat',
            dataRef: { source: 'metric', params: { metric: 'islaidos_faktine', year: 2026 } },
          },
        ],
      },
      2030,
    );
    const fvmCall = calls.find((c) => c.action === 'dashboard.fvmSummary');
    expect(fvmCall).toBeDefined();
    // Globalūs 2025 nugali ir widget'o 2026, ir default 2030.
    expect((fvmCall?.params as { year: number }).year).toBe(2025);
  });

  it('be spec.year — naudoja widget year, kitaip default', async () => {
    const calls: Array<{ action: string; params: unknown }> = [];
    const ctx = makeFakeCtx(calls);
    await hydrateSpec(
      ctx,
      {
        widgets: [
          {
            id: 'm',
            type: 'stat',
            dataRef: { source: 'metric', params: { metric: 'islaidos_faktine', year: 2026 } },
          },
        ],
      },
      2030,
    );
    const fvmCall = calls.find((c) => c.action === 'dashboard.fvmSummary');
    expect((fvmCall?.params as { year: number }).year).toBe(2026);
  });

  it('prašymų šaltiniai metų-jautrūs — requests.list gauna globalų year', async () => {
    const calls: Array<{ action: string; params: unknown }> = [];
    const ctx = makeFakeCtx(calls);
    await hydrateSpec(
      ctx,
      {
        year: 2025,
        widgets: [{ id: 's', type: 'bar', dataRef: { source: 'requests_by_status' } }],
      },
      2030,
    );
    const reqCall = calls.find((c) => c.action === 'requests.list');
    expect(reqCall).toBeDefined();
    expect((reqCall?.params as { year: number }).year).toBe(2025);
  });
});
