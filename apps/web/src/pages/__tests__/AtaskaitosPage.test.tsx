/**
 * `AtaskaitosPage` testai (Iter 14, FVM-6).
 *
 * Tikrina:
 *  1. AM admin mato visus 3 tab'us (Biudžetas, Spec.programos, DU)
 *  2. Org admin (canViewPayroll === true) — visi 3 tab'ai
 *  3. Org user (canViewPayroll === false) — TIK 2 tab'ai (be DU)
 *  4. Excel download mygtukas kvieta `reportsApi.budgetExecutionDownload`
 *     su format='xlsx'
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AuthUser } from '@biip-finansai/shared';
import AtaskaitosPage from '../AtaskaitosPage';
import { makeAuthValue, renderWithProviders } from '@/test-utils';

const budgetExecutionDownloadMock = vi.fn();
const specProgramExecutionDownloadMock = vi.fn();
const payrollDistributionDownloadMock = vi.fn();
const budgetExecutionMock = vi.fn();
const specProgramExecutionMock = vi.fn();
const payrollDistributionMock = vi.fn();

vi.mock('@/lib/api/fvm', () => ({
  reportsApi: {
    budgetExecution: (...args: unknown[]) => budgetExecutionMock(...args),
    budgetExecutionDownload: (...args: unknown[]) =>
      budgetExecutionDownloadMock(...args),
    specProgramExecution: (...args: unknown[]) =>
      specProgramExecutionMock(...args),
    specProgramExecutionDownload: (...args: unknown[]) =>
      specProgramExecutionDownloadMock(...args),
    payrollDistribution: (...args: unknown[]) =>
      payrollDistributionMock(...args),
    payrollDistributionDownload: (...args: unknown[]) =>
      payrollDistributionDownloadMock(...args),
  },
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
};

const ORG_ADMIN: AuthUser = {
  id: 100,
  username: 'aad-admin',
  fullName: 'AAD Administratorius',
  email: 'admin@aad.lt',
  role: 'admin',
  tenantId: 2,
  tenantCode: 'AAD',
  tenantName: 'AAD',
  tenantIsApprover: false,
  amScopeOrgIds: null,
};

const ORG_USER: AuthUser = {
  id: 200,
  username: 'aad',
  fullName: 'AAD specialistas',
  email: 'aad@aad.lt',
  role: 'user',
  tenantId: 2,
  tenantCode: 'AAD',
  tenantName: 'AAD',
  tenantIsApprover: false,
  amScopeOrgIds: null,
};

describe('AtaskaitosPage — tabai, permission gating, download mygtukai', () => {
  beforeEach(() => {
    budgetExecutionMock.mockReset();
    specProgramExecutionMock.mockReset();
    payrollDistributionMock.mockReset();
    budgetExecutionDownloadMock.mockReset();
    specProgramExecutionDownloadMock.mockReset();
    payrollDistributionDownloadMock.mockReset();
  });

  it('AM administratorius mato visus 3 tabus (Biudžetas, Spec.programos, DU)', () => {
    renderWithProviders(<AtaskaitosPage />, {
      authValue: makeAuthValue({ user: AM_ADMIN }),
      initialRoute: '/ataskaitos',
    });

    expect(
      screen.getByTestId('reports-tab-budget-execution'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('reports-tab-spec-program')).toBeInTheDocument();
    expect(
      screen.getByTestId('reports-tab-payroll-distribution'),
    ).toBeInTheDocument();
  });

  it('Org administratorius (canViewPayroll=true) — visi 3 tabai', () => {
    renderWithProviders(<AtaskaitosPage />, {
      authValue: makeAuthValue({ user: ORG_ADMIN }),
      initialRoute: '/ataskaitos',
    });

    expect(
      screen.getByTestId('reports-tab-budget-execution'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('reports-tab-spec-program')).toBeInTheDocument();
    expect(
      screen.getByTestId('reports-tab-payroll-distribution'),
    ).toBeInTheDocument();
  });

  it('Org specialistas (canViewPayroll=false) NE-mato DU tabo', () => {
    renderWithProviders(<AtaskaitosPage />, {
      authValue: makeAuthValue({ user: ORG_USER }),
      initialRoute: '/ataskaitos',
    });

    expect(
      screen.getByTestId('reports-tab-budget-execution'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('reports-tab-spec-program')).toBeInTheDocument();
    // SAUGUMO: DU tabas paslepiamas.
    expect(
      screen.queryByTestId('reports-tab-payroll-distribution'),
    ).toBeNull();
  });

  it('Atsisiųsti Excel mygtukas kvieta API su format=xlsx', async () => {
    budgetExecutionDownloadMock.mockResolvedValue(undefined);
    renderWithProviders(<AtaskaitosPage />, {
      authValue: makeAuthValue({ user: AM_ADMIN }),
      initialRoute: '/ataskaitos',
    });

    fireEvent.click(screen.getByTestId('be-download-xlsx'));

    await waitFor(() => {
      expect(budgetExecutionDownloadMock).toHaveBeenCalledTimes(1);
    });
    expect(budgetExecutionDownloadMock).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'xlsx' }),
    );
  });

  it('Atsisiųsti PDF mygtukas kvieta API su format=pdf', async () => {
    budgetExecutionDownloadMock.mockResolvedValue(undefined);
    renderWithProviders(<AtaskaitosPage />, {
      authValue: makeAuthValue({ user: AM_ADMIN }),
      initialRoute: '/ataskaitos',
    });

    fireEvent.click(screen.getByTestId('be-download-pdf'));

    await waitFor(() => {
      expect(budgetExecutionDownloadMock).toHaveBeenCalledTimes(1);
    });
    expect(budgetExecutionDownloadMock).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'pdf' }),
    );
  });

  it('Idle state — prieš paspaudžiant „Generuoti" nieko nekviečia ir rodo užuominą', () => {
    renderWithProviders(<AtaskaitosPage />, {
      authValue: makeAuthValue({ user: AM_ADMIN }),
      initialRoute: '/ataskaitos',
    });

    expect(screen.getByTestId('be-idle')).toBeInTheDocument();
    expect(budgetExecutionMock).not.toHaveBeenCalled();
  });
});
