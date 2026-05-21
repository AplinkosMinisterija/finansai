/**
 * `BudgetExecutionReport` testai (Iter 14, FVM-6).
 *
 * Tikrina renderer'į:
 *  1. Atvaizduoja totalius, šaltinį, kategorijos eilutes ir warning flag'us
 *     (`isWarning` → warning badge, `isOver` → „Viršyta" badge).
 *  2. Empty state — kai `bySource` tuščias.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BudgetExecutionReport as BudgetExecutionReportData } from '@biip-finansai/shared';
import { BudgetExecutionReport } from '../BudgetExecutionReport';

function makeReport(
  overrides: Partial<BudgetExecutionReportData> = {},
): BudgetExecutionReportData {
  return {
    year: 2026,
    generatedAt: '2026-05-22T10:00:00Z',
    tenantId: null,
    tenantName: null,
    totalPlanuota: '10000.00',
    totalFaktine: '8500.00',
    totalLikutis: '1500.00',
    bySource: [
      {
        fundingSourceId: 1,
        fundingSourceName: 'VB 2026 m. asignavimai',
        fundingSourceTypeCode: 'vb',
        fundingSourceTypeName: 'Valstybės biudžetas',
        planuota: '10000.00',
        faktine: '8500.00',
        likutis: '1500.00',
        percentUsed: 85,
        byCategory: [
          {
            categoryItemId: 10,
            categoryCode: 'du',
            categoryName: 'DU',
            allocationName: 'DU paskirstymas',
            planuota: '5000.00',
            faktine: '4500.00',
            likutis: '500.00',
            percentUsed: 90,
            isWarning: true,
            isOver: false,
          },
          {
            categoryItemId: 11,
            categoryCode: 'prekes',
            categoryName: 'Prekės',
            allocationName: 'Kanceliarijos prekės',
            planuota: '5000.00',
            faktine: '5500.00',
            likutis: '-500.00',
            percentUsed: 110,
            isWarning: false,
            isOver: true,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('BudgetExecutionReport', () => {
  it('renderina ataskaitą su mock duomenimis + warning ir over flagais', () => {
    render(<BudgetExecutionReport data={makeReport()} />);

    // Totalai
    expect(screen.getByText(/Iš viso planuota/i)).toBeInTheDocument();
    expect(screen.getByText(/Iš viso faktinė/i)).toBeInTheDocument();
    expect(screen.getByText(/Iš viso likutis/i)).toBeInTheDocument();

    // Source sekcija — source pavadinimas ir tipas atskirai
    expect(screen.getByTestId('budget-source-1')).toBeInTheDocument();
    expect(screen.getByText('VB 2026 m. asignavimai')).toBeInTheDocument();
    expect(screen.getByText('Valstybės biudžetas')).toBeInTheDocument();

    // Kategorijos eilutės
    expect(screen.getByTestId('budget-category-row-10')).toBeInTheDocument();
    expect(screen.getByTestId('budget-category-row-11')).toBeInTheDocument();
    expect(screen.getByText('DU paskirstymas')).toBeInTheDocument();
    expect(screen.getByText('Kanceliarijos prekės')).toBeInTheDocument();

    // Warning + over badge'ai
    expect(screen.getByTestId('budget-warning-badge-10')).toBeInTheDocument();
    expect(screen.getByTestId('budget-over-badge-11')).toBeInTheDocument();
    expect(screen.getByText(/Viršyta/i)).toBeInTheDocument();
  });

  it('atvaizduoja empty state, kai bySource tuščias', () => {
    render(
      <BudgetExecutionReport
        data={makeReport({
          bySource: [],
          totalPlanuota: '0.00',
          totalFaktine: '0.00',
          totalLikutis: '0.00',
        })}
      />,
    );

    expect(screen.getByTestId('budget-execution-empty')).toBeInTheDocument();
    expect(
      screen.getByText(/Nėra duomenų ataskaitai už pasirinktus metus/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('budget-source-1')).toBeNull();
  });
});
