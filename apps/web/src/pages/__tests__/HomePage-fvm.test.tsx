/**
 * `HomePage` FVM dashboard sekcijos testai (Iter 15, F15).
 *
 * Tikriname:
 *  1. Renders FVM summary section su mock data — totals, warnings ir
 *     upcoming deadlines.
 *  2. Year picker keičia užklausos parametrus (invalidate / refetch).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type {
  AuthUser,
  BudgetWarningsResponse,
  DashboardData,
  FvmSummaryResponse,
} from '@biip-finansai/shared';
import HomePage from '../HomePage';
import { makeAuthValue, renderWithProviders } from '@/test-utils';

const dashboardGetMock = vi.fn();
const fvmSummaryMock = vi.fn();
const budgetSummaryMock = vi.fn();

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    dashboardGet: () => dashboardGetMock(),
  };
});

vi.mock('@/lib/api/fvm', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/fvm')>('@/lib/api/fvm');
  return {
    ...actual,
    dashboardApi: {
      fvmSummary: (...args: unknown[]) => fvmSummaryMock(...args),
    },
    expensesApi: {
      ...actual.expensesApi,
      budgetSummary: (...args: unknown[]) => budgetSummaryMock(...args),
    },
  };
});

// Recharts'o ResponsiveContainer'is jsdom'e nemato dydžių — paslepiam
// trend chart'ą iš testų, kad nereiktų polifill'inti.
vi.mock('@/components/charts/MonthlyTrendChart', () => ({
  MonthlyTrendChart: () => <div data-testid="monthly-trend-chart-mock" />,
}));

const AM_ADMIN: AuthUser = {
  id: 1,
  username: 'demo',
  fullName: 'Demo Vartotojas',
  email: 'demo@am.lt',
  role: 'admin',
  tenantId: 1,
  tenantCode: 'AM',
  tenantName: 'Aplinkos ministerija',
  tenantIsApprover: true,
  amScopeOrgIds: null,
  approvalLevelCodes: [],
};

function makeDashboard(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    role: 'admin',
    tenantIsApprover: true,
    year: 2026,
    stats: {
      totalRequests: 0,
      byStatus: { DRAFT: 0, SUBMITTED: 0, RETURNED: 0, APPROVED: 0, REJECTED: 0, NEAKTUALU: 0 },
      amountsByStatus: { SUBMITTED: 0, RETURNED: 0, APPROVED: 0, REJECTED: 0 },
      totalRequestedThisYear: 0,
      totalApprovedThisYear: 0,
      totalRejectedThisYear: 0,
      usersCount: 0,
    },
    actionable: [],
    pendingReview: [],
    recentActivity: [],
    perTenantBreakdown: [],
    monthlyTrend: [],
    costCategories: [],
    budgetCategoryStats: [],
    ...overrides,
  };
}

function makeSummary(overrides: Partial<FvmSummaryResponse> = {}): FvmSummaryResponse {
  return {
    year: 2026,
    generatedAt: '2026-05-22T10:00:00Z',
    budgetTotals: {
      planuota: '1000000.00',
      faktine: '450000.00',
      likutis: '550000.00',
      percentUsed: 45,
      isWarning: false,
      isOver: false,
    },
    topWarnings: [],
    upcomingDeadlines: [
      {
        type: 'project_end',
        id: 42,
        name: 'IT modernizavimas',
        date: '2026-06-10',
        daysUntil: 19,
      },
    ],
    activeProjectsCount: 7,
    completedProjectsCount: 3,
    totalSourcesCount: 4,
    totalAllocationsCount: 12,
    ...overrides,
  };
}

const EMPTY_WARNINGS: BudgetWarningsResponse = { year: 2026, items: [] };

describe('HomePage — FVM Dashboard sekcija (Iter 15)', () => {
  beforeEach(() => {
    dashboardGetMock.mockReset();
    fvmSummaryMock.mockReset();
    budgetSummaryMock.mockReset();

    dashboardGetMock.mockResolvedValue(makeDashboard());
    fvmSummaryMock.mockResolvedValue(makeSummary());
    budgetSummaryMock.mockResolvedValue(EMPTY_WARNINGS);
  });

  it('renderina FVM summary section su totals, deadlines ir statistikomis', async () => {
    renderWithProviders(<HomePage />, {
      authValue: makeAuthValue({ user: AM_ADMIN }),
    });

    // Section heading'as su antrašte „Biudžeto suvestinė {year}".
    expect(
      await screen.findByRole('heading', { name: /biudžeto suvestinė 2026/i }),
    ).toBeInTheDocument();

    // Metric cards: Planuota, Faktinė, Likutis, % panaudota.
    await waitFor(() => {
      expect(screen.getByText(/planuota/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/faktinė/i)).toBeInTheDocument();
    expect(screen.getByText(/likutis/i)).toBeInTheDocument();
    expect(screen.getByText(/% panaudota/i)).toBeInTheDocument();
    expect(screen.getByText(/45\.0%/)).toBeInTheDocument();

    // Statistika cards (4 papildomi).
    expect(screen.getByText(/aktyvūs projektai/i)).toBeInTheDocument();
    expect(screen.getByText(/baigti projektai/i)).toBeInTheDocument();
    expect(screen.getByText(/^šaltiniai$/i)).toBeInTheDocument();
    expect(screen.getByText(/paskirstymai/i)).toBeInTheDocument();

    // Artėjantys terminai — turi rodyti mock deadline'ą.
    expect(screen.getByTestId('upcoming-deadlines-list')).toBeInTheDocument();
    expect(screen.getByText(/it modernizavimas/i)).toBeInTheDocument();
    expect(screen.getByText(/19 d\./i)).toBeInTheDocument();

    // Fvm summary API turi būti kviestas su default metais.
    expect(fvmSummaryMock).toHaveBeenCalledWith({ year: 2026 });
  });

  it('Year picker keičia užklausos metus ir kvietimą su nauja reikšme', async () => {
    fvmSummaryMock.mockImplementation((params: { year: number }) =>
      Promise.resolve(makeSummary({ year: params.year })),
    );

    renderWithProviders(<HomePage />, {
      authValue: makeAuthValue({ user: AM_ADMIN }),
    });

    const yearInput = await screen.findByTestId('fvm-summary-year-input');
    expect(yearInput).toHaveValue(2026);

    // Pakeiciame year į 2027 — query naudoja naują metą.
    fireEvent.change(yearInput, { target: { value: '2027' } });

    await waitFor(() => {
      expect(fvmSummaryMock).toHaveBeenCalledWith({ year: 2027 });
    });

    // Heading'as atvaizduoja naujus metus.
    expect(
      await screen.findByRole('heading', { name: /biudžeto suvestinė 2027/i }),
    ).toBeInTheDocument();
  });
});
