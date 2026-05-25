/**
 * `PrasymaiPage` — UAT #42 testai.
 *
 *  - PA-001: tvirtintojui (AM) default statuso filtras = „Pateiktas" (SUBMITTED).
 *    Teikėjui lieka „Visi".
 *  - PA-010: praėjusio įgyvendinimo termino badge'as „Terminas praėjęs".
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AuthUser, FinancingRequest } from '@biip-finansai/shared';
import PrasymaiPage from '../PrasymaiPage';
import { makeAuthValue, renderWithProviders } from '@/test-utils';

const requestsListMock = vi.fn();

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    requestsList: (...args: unknown[]) => requestsListMock(...args),
    tenantsList: vi.fn().mockResolvedValue([]),
    classifierItemsList: vi.fn().mockResolvedValue([]),
  };
});

function makeRequest(overrides: Partial<FinancingRequest> = {}): FinancingRequest {
  return {
    id: 1,
    tenantId: 2,
    tenantCode: 'AAD',
    tenantName: 'AAD',
    createdByUserId: 200,
    createdByName: 'Specialistas',
    status: 'SUBMITTED',
    year: new Date().getFullYear(),
    projectName: 'Test prašymas',
    systemCode: null,
    projectType: null,
    description: null,
    plannedWorks: null,
    priority: null,
    procurementStage: null,
    costDu: '0',
    costEquipment: '1000',
    costCreation: '0',
    costAnalysis: '0',
    costDevelopment: '0',
    costMaintenance: '0',
    costModernization: '0',
    costDecommissioning: '0',
    fundingFromIt: '0',
    otherFunds: '0',
    otherFundsSource: null,
    q1Amount: '0',
    q2Amount: '0',
    q3Amount: '0',
    q4Amount: '0',
    responsibleInstitution: null,
    executorName: null,
    executorEmail: null,
    implementationDeadline: null,
    submitterNotes: null,
    decisionGrantedAmount: null,
    decisionFundingSource: null,
    decisionProtocol: null,
    decisionOrder: null,
    decisionOrderDate: null,
    decidedAt: null,
    decidedByUserId: null,
    decidedByName: null,
    budgetCategoryId: null,
    budgetCategoryCode: null,
    budgetCategoryName: null,
    fundingSourceTypeId: null,
    fundingSourceTypeCode: null,
    fundingSourceTypeName: null,
    specProgramFundingType: null,
    fvmProjectId: null,
    submittedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const amAdmin: AuthUser = {
  id: 1,
  username: 'am-admin',
  fullName: 'AM Admin',
  email: null,
  role: 'admin',
  tenantId: 1,
  tenantCode: 'AM',
  tenantName: 'Aplinkos ministerija',
  tenantIsApprover: true,
  amScopeOrgIds: null,
  approvalLevelCodes: [],
};

const orgUser: AuthUser = {
  id: 200,
  username: 'aad-user',
  fullName: 'AAD User',
  email: null,
  role: 'user',
  tenantId: 2,
  tenantCode: 'AAD',
  tenantName: 'AAD',
  tenantIsApprover: false,
  amScopeOrgIds: null,
  approvalLevelCodes: [],
};

describe('PrasymaiPage — UAT #42', () => {
  beforeEach(() => {
    requestsListMock.mockReset();
    requestsListMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 200,
    });
  });

  it('PA-001: tvirtintojui (AM) default statuso filtras yra „Pateiktas"', async () => {
    renderWithProviders(<PrasymaiPage />, {
      authValue: makeAuthValue({ user: amAdmin }),
    });

    // Pirma užklausa turi būti su status=SUBMITTED.
    await waitFor(() => {
      expect(requestsListMock).toHaveBeenCalled();
    });
    const firstCallArg = requestsListMock.mock.calls[0]?.[0] as { status?: string };
    expect(firstCallArg.status).toBe('SUBMITTED');

    // „Pateikti" pill aktyvi (aria-selected).
    const pill = screen.getByRole('tab', { name: /^pateikti$/i });
    expect(pill).toHaveAttribute('aria-selected', 'true');
  });

  it('PA-001: teikėjui (org user) default filtras lieka „Visi"', async () => {
    renderWithProviders(<PrasymaiPage />, {
      authValue: makeAuthValue({ user: orgUser }),
    });

    await waitFor(() => {
      expect(requestsListMock).toHaveBeenCalled();
    });
    const firstCallArg = requestsListMock.mock.calls[0]?.[0] as { status?: string };
    // 'all' → status undefined siunčiamas backend'ui.
    expect(firstCallArg.status).toBeUndefined();

    const pill = screen.getByRole('tab', { name: /^visi$/i });
    expect(pill).toHaveAttribute('aria-selected', 'true');
  });

  it('PA-010: praėjusio termino prašymas pažymimas badge\'u „Terminas praėjęs"', async () => {
    requestsListMock.mockResolvedValue({
      items: [
        makeRequest({
          id: 7,
          status: 'APPROVED',
          implementationDeadline: '2020-01-01', // praeitis
        }),
        makeRequest({
          id: 8,
          status: 'APPROVED',
          implementationDeadline: '2099-01-01', // ateitis
        }),
      ],
      total: 2,
      page: 1,
      pageSize: 200,
    });

    renderWithProviders(<PrasymaiPage />, {
      authValue: makeAuthValue({ user: amAdmin }),
    });

    await waitFor(() => {
      expect(screen.getByTestId('overdue-badge-7')).toBeInTheDocument();
    });
    expect(screen.getByText(/terminas praėjęs/i)).toBeInTheDocument();
    // Ateities terminas — be badge'o.
    expect(screen.queryByTestId('overdue-badge-8')).toBeNull();
  });

  // Issue #9: „Neaktualūs" filtras pasiekiamas ir siunčia status=NEAKTUALU.
  it('Issue #9: yra „Neaktualūs" filtro pill; paspaudus siunčia status=NEAKTUALU', async () => {
    renderWithProviders(<PrasymaiPage />, {
      authValue: makeAuthValue({ user: orgUser }),
    });

    await waitFor(() => {
      expect(requestsListMock).toHaveBeenCalled();
    });

    const pill = screen.getByRole('tab', { name: /^neaktualūs$/i });
    expect(pill).toBeInTheDocument();
    // Pradžioje neaktyvi (default 'all' teikėjui).
    expect(pill).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(pill);

    await waitFor(() => {
      const lastCall = requestsListMock.mock.calls.at(-1)?.[0] as { status?: string };
      expect(lastCall.status).toBe('NEAKTUALU');
    });
    expect(pill).toHaveAttribute('aria-selected', 'true');
  });
});
