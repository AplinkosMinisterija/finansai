/**
 * `ExpensesSection` testai (Iter 12, FVM-4).
 *
 * Tikriname:
 *  - Empty state — kai išlaidų nėra
 *  - List render'inimas su mock duomenimis + AM admin'as mato „Pridėti išlaidą"
 *    mygtuką + org_user NEMato to mygtuko
 *  - Multi-source badge rodomas išlaidoms su saltinioDalis array
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { AuthUser, Expense } from '@biip-finansai/shared';
import { ExpensesSection } from '../ExpensesSection';
import { makeAuthValue, renderWithProviders } from '@/test-utils';

const expensesListMock = vi.fn();
const expensesCreateMock = vi.fn();
const expensesUpdateMock = vi.fn();
const expensesRemoveMock = vi.fn();
const expensesBudgetSummaryMock = vi.fn();

vi.mock('@/lib/api/fvm', () => ({
  expensesApi: {
    list: (...args: unknown[]) => expensesListMock(...args),
    get: vi.fn(),
    create: (...args: unknown[]) => expensesCreateMock(...args),
    update: (...args: unknown[]) => expensesUpdateMock(...args),
    remove: (...args: unknown[]) => expensesRemoveMock(...args),
    budgetSummary: (...args: unknown[]) => expensesBudgetSummaryMock(...args),
  },
  budgetAllocationsApi: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    summary: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  fundingSourcesApi: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  projectsApi: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    summary: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    changeStatus: vi.fn(),
  },
}));

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 1,
    projectId: 42,
    projectName: 'IT modernizavimas',
    budgetAllocationId: 10,
    budgetAllocationName: 'DU darbuotojams',
    tenantId: 1,
    tipas: 'sutartis',
    suma: '1500.00',
    data: '2026-03-15',
    aprasymas: 'Sutarties pirmas mokėjimas',
    saltinioDalis: null,
    createdByUserId: 1,
    createdByName: 'Demo Vartotojas',
    createdAt: '2026-05-21T00:00:00Z',
    updatedAt: '2026-05-21T00:00:00Z',
    ...overrides,
  };
}

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
};

const ORG_USER: AuthUser = {
  id: 200,
  username: 'aad-user',
  fullName: 'AAD specialistas',
  email: 'aad@aad.lt',
  role: 'user',
  tenantId: 2,
  tenantCode: 'AAD',
  tenantName: 'AAD',
  tenantIsApprover: false,
  amScopeOrgIds: null,
};

describe('ExpensesSection', () => {
  beforeEach(() => {
    expensesListMock.mockReset();
    expensesCreateMock.mockReset();
    expensesUpdateMock.mockReset();
    expensesRemoveMock.mockReset();
    expensesBudgetSummaryMock.mockReset();
  });

  it('rodo empty state žinutę, kai išlaidų nėra', async () => {
    expensesListMock.mockResolvedValue([]);
    renderWithProviders(
      <ExpensesSection
        projectId={42}
        defaultAllocationId={10}
        projectTenantId={1}
      />,
      { authValue: makeAuthValue({ user: AM_ADMIN }) },
    );

    await waitFor(() => {
      expect(screen.getByTestId('expenses-empty')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/išlaidų dar nėra|paspauskite „pridėti išlaidą"/i),
    ).toBeInTheDocument();
  });

  it('AM administratorius mato „Pridėti išlaidą" mygtuką', async () => {
    expensesListMock.mockResolvedValue([]);
    renderWithProviders(
      <ExpensesSection
        projectId={42}
        defaultAllocationId={10}
        projectTenantId={1}
      />,
      { authValue: makeAuthValue({ user: AM_ADMIN }) },
    );

    expect(await screen.findByTestId('open-new-expense')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /pridėti išlaidą/i }),
    ).toBeInTheDocument();
  });

  it('rodo išlaidų sąrašą su pateiktais duomenimis + multi-source badge', async () => {
    expensesListMock.mockResolvedValue([
      makeExpense({
        id: 1,
        tipas: 'sutartis',
        suma: '1500.00',
        data: '2026-03-15',
        aprasymas: 'Sutarties pirmas mokėjimas',
        saltinioDalis: null,
      }),
      makeExpense({
        id: 2,
        tipas: 'du',
        suma: '5000.00',
        data: '2026-04-01',
        aprasymas: null,
        saltinioDalis: [
          { fundingSourceId: 1, suma: '3000.00' },
          { fundingSourceId: 2, suma: '2000.00' },
        ],
      }),
    ]);

    renderWithProviders(
      <ExpensesSection
        projectId={42}
        defaultAllocationId={10}
        projectTenantId={1}
      />,
      { authValue: makeAuthValue({ user: AM_ADMIN }) },
    );

    await waitFor(() => {
      expect(screen.getByTestId('expenses-table')).toBeInTheDocument();
    });

    // Pirmoji eilutė — single-source („Vienas")
    expect(screen.getByTestId('expense-row-1')).toBeInTheDocument();
    // Antroji — multi-source badge'as
    expect(screen.getByTestId('expense-row-2')).toBeInTheDocument();
    expect(screen.getByTestId('expense-multi-source-2')).toBeInTheDocument();
    expect(screen.getByTestId('expense-multi-source-2').textContent).toMatch(
      /2 šaltiniai/i,
    );
  });

  it('Organizacijos vartotojas (user role) NEmato „Pridėti išlaidą" mygtuko', async () => {
    expensesListMock.mockResolvedValue([]);
    renderWithProviders(
      <ExpensesSection
        projectId={42}
        defaultAllocationId={10}
        projectTenantId={2}
      />,
      { authValue: makeAuthValue({ user: ORG_USER }) },
    );

    await waitFor(() => {
      expect(screen.getByTestId('expenses-empty')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('open-new-expense')).toBeNull();
  });

  // SAUGUMO PATCH (Iter 13.x, docx §4.4): defense-in-depth FE filter'is.
  // Net jei backend grąžintų DU expense'ą (regresijos / cache atveju), FE
  // turi išmesti jį prieš render'inant ne-DU vartotojui.
  it('Organizacijos vartotojas NEmato DU expense\'ų net jei backend grąžina', async () => {
    expensesListMock.mockResolvedValue([
      makeExpense({
        id: 1,
        tipas: 'sutartis',
        suma: '1500.00',
      }),
      makeExpense({
        id: 99,
        tipas: 'du',
        suma: '5000.00',
        aprasymas: 'DU 2026-03: Petras Sensitive',
      }),
    ]);

    renderWithProviders(
      <ExpensesSection
        projectId={42}
        defaultAllocationId={10}
        projectTenantId={2}
      />,
      { authValue: makeAuthValue({ user: ORG_USER }) },
    );

    await waitFor(() => {
      expect(screen.getByTestId('expenses-table')).toBeInTheDocument();
    });

    // Sutartis matoma
    expect(screen.getByTestId('expense-row-1')).toBeInTheDocument();
    // DU paslėpta — net jei backend grąžino (defense in depth).
    expect(screen.queryByTestId('expense-row-99')).toBeNull();
    expect(screen.queryByText(/Petras Sensitive/)).toBeNull();
  });
});
