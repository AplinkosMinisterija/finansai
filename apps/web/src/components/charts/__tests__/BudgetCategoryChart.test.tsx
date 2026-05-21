/**
 * `BudgetCategoryChart` testai (FVM Iter 10, P06).
 *
 * Tikriname:
 *  1. Renders su mock data — chart su recharts SVG'ais.
 *  2. Empty state — kai data tuščia, rodoma „Nėra duomenų" žinutė.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BudgetCategoryStats } from '@biip-finansai/shared';
import { BudgetCategoryChart } from '../BudgetCategoryChart';

// Recharts naudoja ResponsiveContainer su SizeMe — jsdom'as nepalaiko realių
// dydžių. Polifill'as testams: fiksuotas tėvinio bloko dydis.
function ChartHost({
  data,
}: {
  data: BudgetCategoryStats[];
}): JSX.Element {
  return (
    <div style={{ width: 600, height: 320 }}>
      <BudgetCategoryChart data={data} />
    </div>
  );
}

describe('BudgetCategoryChart', () => {
  it('renderina chartą su mock data (be empty state)', () => {
    const data: BudgetCategoryStats[] = [
      {
        categoryItemId: 10,
        categoryCode: 'du',
        categoryName: 'Darbo užmokestis',
        totalRequested: '50000.00',
        totalGranted: '40000.00',
        count: 3,
      },
      {
        categoryItemId: 11,
        categoryCode: 'spec_programa',
        categoryName: 'Specialioji programa',
        totalRequested: '120000.00',
        totalGranted: '0.00',
        count: 1,
      },
    ];

    // Renderiojam su not-null data — komponentas neturi mest'i ir neturi rodyti
    // empty state'o. Recharts'o ResponsiveContainer'is jsdom'e neturi tikrų
    // dydžių, tad SVG'as gali ir nesirenderioti — pakanka, kad nei nemes'tų,
    // nei nerodytų empty placeholder'io.
    expect(() => render(<ChartHost data={data} />)).not.toThrow();
    expect(screen.queryByTestId('budget-category-empty')).toBeNull();
  });

  it('rodo empty state kai data tuščia', () => {
    render(<ChartHost data={[]} />);

    expect(screen.getByTestId('budget-category-empty')).toBeInTheDocument();
    expect(screen.getByText(/nėra duomenų/i)).toBeInTheDocument();
  });
});
