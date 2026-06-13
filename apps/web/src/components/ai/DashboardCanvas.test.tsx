/**
 * AI dashboard drobės testai (Iter 17) — widget renderer'io smoke testai
 * visiems tipams + defensyvumas tuštiems/trūkstamiems laukams.
 */
import { render, screen } from '@testing-library/react';
import type { AiDashboardSpec } from '@biip-finansai/shared';
import { DashboardCanvas } from './DashboardCanvas';
import { formatValue } from './widgets';

const FULL_SPEC: AiDashboardSpec = {
  title: 'Testo apžvalga',
  subtitle: 'Iš testinių duomenų',
  widgets: [
    {
      id: 'stat1',
      type: 'stat',
      title: 'Biudžetas',
      value: '1 000 000 €',
      subtitle: '3 šaltiniai',
      trend: { direction: 'up', text: 'Auga', positive: true },
    },
    {
      id: 'bar1',
      type: 'bar',
      title: 'Mėnesiai',
      data: [
        { m: '2026-01', v: 10 },
        { m: '2026-02', v: 20 },
      ],
      xKey: 'm',
      series: [{ key: 'v', label: 'Suma' }],
      format: 'eur',
    },
    {
      id: 'pie1',
      type: 'pie',
      title: 'Kategorijos',
      data: [
        { name: 'DU', value: 60 },
        { name: 'Įranga', value: 40 },
      ],
    },
    {
      id: 'table1',
      type: 'table',
      title: 'Organizacijos',
      columns: [
        { key: 'org', label: 'Org' },
        { key: 'suma', label: 'Suma', format: 'eur', align: 'right' },
      ],
      rows: [{ org: 'AAD', suma: 1234.5 }],
    },
    {
      id: 'prog1',
      type: 'progress',
      title: 'Panaudojimas',
      items: [{ label: 'Eilutė A', value: 80, max: 100, format: 'percent' }],
    },
    {
      id: 'md1',
      type: 'markdown',
      title: 'Įžvalgos',
      content: '## Svarbu\nBiudžetas **viršytas**.\n- punktas vienas\n- punktas du',
    },
  ],
};

describe('DashboardCanvas', () => {
  it('atvaizduoja visus widget tipus', () => {
    render(<DashboardCanvas spec={FULL_SPEC} generation={0} />);

    expect(screen.getByText('Testo apžvalga')).toBeInTheDocument();
    expect(screen.getByText('Iš testinių duomenų')).toBeInTheDocument();

    // stat
    expect(screen.getByText('1 000 000 €')).toBeInTheDocument();
    expect(screen.getByText('Auga')).toBeInTheDocument();
    // table su EUR formatu
    expect(screen.getByText('AAD')).toBeInTheDocument();
    expect(screen.getByText('1 234,5 €')).toBeInTheDocument();
    // progress
    expect(screen.getByText('Eilutė A')).toBeInTheDocument();
    expect(screen.getByText(/80\s?%.*100\s?%/)).toBeInTheDocument();
    // markdown
    expect(screen.getByText('Svarbu')).toBeInTheDocument();
    expect(screen.getByText('viršytas')).toBeInTheDocument();
    expect(screen.getByText('punktas vienas')).toBeInTheDocument();
    // chart'ų kortelės (recharts jsdom'e nepiešia SVG turinio, bet kortelė yra)
    expect(screen.getByTestId('ai-widget-bar1')).toBeInTheDocument();
    expect(screen.getByTestId('ai-widget-pie1')).toBeInTheDocument();
  });

  it('atvaizduoja naujus tipus (sankey/treemap/radar) be crash', () => {
    const spec: AiDashboardSpec = {
      widgets: [
        {
          id: 'sk',
          type: 'sankey',
          title: 'Srautas',
          nodes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
          links: [
            { source: 0, target: 1, value: 100 },
            { source: 1, target: 2, value: 60 },
          ],
        },
        {
          id: 'tm',
          type: 'treemap',
          title: 'Hierarchija',
          treemap: [{ name: 'src', children: [{ name: 'a', value: 50 }] }],
        },
        {
          id: 'rd',
          type: 'radar',
          title: 'Radaras',
          data: [
            { ašis: 'DU', planuota: 100, faktine: 80 },
            { ašis: 'PP', planuota: 60, faktine: 40 },
          ],
          xKey: 'ašis',
          series: [{ key: 'planuota' }, { key: 'faktine' }],
        },
      ],
    };
    render(<DashboardCanvas spec={spec} generation={2} />);
    // recharts jsdom'e SVG nepiešia, bet kortelės + antraštės yra.
    expect(screen.getByTestId('ai-widget-sk')).toBeInTheDocument();
    expect(screen.getByTestId('ai-widget-tm')).toBeInTheDocument();
    expect(screen.getByTestId('ai-widget-rd')).toBeInTheDocument();
    expect(screen.getByText('Srautas')).toBeInTheDocument();
    expect(screen.getByText('Hierarchija')).toBeInTheDocument();
  });

  it('degeneruotus naujus tipus tyliai praleidžia', () => {
    const spec: AiDashboardSpec = {
      widgets: [
        { id: 'sk-bad', type: 'sankey' }, // be nodes/links
        { id: 'tm-bad', type: 'treemap' }, // be treemap
        { id: 'ok', type: 'stat', value: '5' },
      ],
    };
    render(<DashboardCanvas spec={spec} generation={3} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-widget-sk-bad')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-widget-tm-bad')).not.toBeInTheDocument();
  });

  it('kai nė vienas widget nepiešiamas (pvz. metai be duomenų) — rodo „nėra duomenų"', () => {
    const spec: AiDashboardSpec = {
      title: 'Biudžeto srautai (2025)',
      widgets: [
        { id: 'sk', type: 'sankey' }, // be nodes/links → nerenderable
        { id: 's', type: 'stat' }, // be value → nerenderable
      ],
    };
    render(<DashboardCanvas spec={spec} generation={5} />);
    expect(screen.getByText('Biudžeto srautai (2025)')).toBeInTheDocument();
    expect(screen.getByText(/duomenų nėra/i)).toBeInTheDocument();
  });

  it('nekrenta su minimaliu/degeneruotu spec', () => {
    const spec: AiDashboardSpec = {
      widgets: [
        // bar be data — renderer'is turi tyliai praleisti
        { id: 'broken', type: 'bar' },
        { id: 'ok', type: 'stat', value: '5' },
      ],
    };
    render(<DashboardCanvas spec={spec} generation={1} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-widget-broken')).not.toBeInTheDocument();
  });
});

describe('formatValue', () => {
  it('formatuoja eur/percent/number LT lokale', () => {
    expect(formatValue(1234567, 'eur')).toMatch(/1\s?234\s?567\s?€/);
    expect(formatValue(45.5, 'percent')).toBe('45,5%');
    expect(formatValue(null)).toBe('—');
    expect(formatValue('tekstas')).toBe('tekstas');
  });
});
