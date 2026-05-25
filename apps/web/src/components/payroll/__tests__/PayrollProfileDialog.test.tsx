/**
 * `PayrollProfileDialog` testai (Iter 13, FVM-5).
 *
 * Tikriname:
 *  1. Form validation: vardas_pavarde, pareigos, bruto > 0
 *  2. galioja_iki, jei nurodyta — turi būti >= galioja_nuo
 *  3. Edit režime esami duomenys užkraunami į form'ą
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AuthUser, PayrollProfile, Tenant } from '@biip-finansai/shared';
import { PayrollProfileDialog } from '../PayrollProfileDialog';
import { makeAuthValue, renderWithProviders } from '@/test-utils';

const createProfileMock = vi.fn();
const updateProfileMock = vi.fn();
vi.mock('@/lib/api/fvm', () => ({
  payrollApi: {
    listProfiles: vi.fn().mockResolvedValue([]),
    getProfile: vi.fn(),
    createProfile: (...args: unknown[]) => createProfileMock(...args),
    updateProfile: (...args: unknown[]) => updateProfileMock(...args),
    removeProfile: vi.fn(),
    listDistributions: vi.fn().mockResolvedValue([]),
    getDistribution: vi.fn(),
    createDistribution: vi.fn(),
    updateDistribution: vi.fn(),
    removeDistribution: vi.fn(),
    computeMonth: vi.fn(),
  },
}));

const tenantsListMock = vi.fn();
const usersListMock = vi.fn();
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    tenantsList: (...args: unknown[]) => tenantsListMock(...args),
    usersList: (...args: unknown[]) => usersListMock(...args),
  };
});

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 1,
    code: 'AM',
    name: 'Aplinkos ministerija',
    description: null,
    isApprover: true,
    active: true,
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
  approvalLevelCodes: [],
};

function makeProfile(overrides: Partial<PayrollProfile> = {}): PayrollProfile {
  return {
    id: 5,
    tenantId: 1,
    tenantCode: 'AM',
    tenantName: 'Aplinkos ministerija',
    userId: null,
    userFullName: null,
    vardasPavarde: 'Esamas Darbuotojas',
    pareigos: 'Spec.',
    sutartiesTipas: 'darbo',
    atlyginimasBruto: '1800.00',
    priedai: '0.00',
    galiojaNuo: '2026-01-01',
    galiojaIki: null,
    createdAt: '2026-05-21T00:00:00Z',
    updatedAt: '2026-05-21T00:00:00Z',
    ...overrides,
  };
}

describe('PayrollProfileDialog', () => {
  beforeEach(() => {
    createProfileMock.mockReset();
    updateProfileMock.mockReset();
    tenantsListMock.mockReset();
    usersListMock.mockReset();
    tenantsListMock.mockResolvedValue([makeTenant()]);
    usersListMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });
  });

  it('rodo klaidą, kai vardas/pavardė tuščia ir submit paspaustas', async () => {
    renderWithProviders(
      <PayrollProfileDialog
        mode="create"
        profile={null}
        defaultTenantId={1}
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
      { authValue: makeAuthValue({ user: AM_ADMIN }) },
    );

    fireEvent.click(await screen.findByRole('button', { name: /sukurti/i }));

    expect(
      await screen.findByText(/įveskite vardą ir pavardę/i),
    ).toBeInTheDocument();
    expect(createProfileMock).not.toHaveBeenCalled();
  });

  it('rodo klaidą, kai pareigos tuščios', async () => {
    renderWithProviders(
      <PayrollProfileDialog
        mode="create"
        profile={null}
        defaultTenantId={1}
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
      { authValue: makeAuthValue({ user: AM_ADMIN }) },
    );

    await waitFor(() => {
      expect(tenantsListMock).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByTestId('payroll-vardas-input'), {
      target: { value: 'Jonas Jonaitis' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sukurti/i }));

    expect(await screen.findByText(/įveskite pareigas/i)).toBeInTheDocument();
    expect(createProfileMock).not.toHaveBeenCalled();
  });

  it('rodo klaidą, kai bruto atlyginimas 0 arba tuščia', async () => {
    renderWithProviders(
      <PayrollProfileDialog
        mode="create"
        profile={null}
        defaultTenantId={1}
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
      { authValue: makeAuthValue({ user: AM_ADMIN }) },
    );

    await waitFor(() => {
      expect(tenantsListMock).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByTestId('payroll-vardas-input'), {
      target: { value: 'Jonas Jonaitis' },
    });
    fireEvent.change(screen.getByTestId('payroll-pareigos-input'), {
      target: { value: 'Spec.' },
    });
    // bruto NE-užpildomas — palieka tuščią lauką.
    fireEvent.click(screen.getByRole('button', { name: /sukurti/i }));

    expect(
      await screen.findByText(/bruto atlyginimas turi būti didesnis už 0/i),
    ).toBeInTheDocument();
    expect(createProfileMock).not.toHaveBeenCalled();
  });

  it('rodo klaidą, kai galioja_iki ankstesnė už galioja_nuo', async () => {
    renderWithProviders(
      <PayrollProfileDialog
        mode="create"
        profile={null}
        defaultTenantId={1}
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
      { authValue: makeAuthValue({ user: AM_ADMIN }) },
    );

    await waitFor(() => {
      expect(tenantsListMock).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByTestId('payroll-vardas-input'), {
      target: { value: 'Jonas Jonaitis' },
    });
    fireEvent.change(screen.getByTestId('payroll-pareigos-input'), {
      target: { value: 'Spec.' },
    });
    fireEvent.change(screen.getByTestId('payroll-bruto-input'), {
      target: { value: '1500.00' },
    });
    fireEvent.change(screen.getByTestId('payroll-nuo-input'), {
      target: { value: '2026-06-01' },
    });
    fireEvent.change(screen.getByTestId('payroll-iki-input'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sukurti/i }));

    expect(
      await screen.findByText(
        /galiojimo pabaigos data negali būti ankstesnė už pradžios datą/i,
      ),
    ).toBeInTheDocument();
    expect(createProfileMock).not.toHaveBeenCalled();
  });

  it('edit režime rodo esamus duomenis formoje', async () => {
    renderWithProviders(
      <PayrollProfileDialog
        mode="edit"
        profile={makeProfile({
          vardasPavarde: 'Esamas Darbuotojas',
          pareigos: 'Egzistuojanti pareigybė',
          atlyginimasBruto: '2500.00',
        })}
        defaultTenantId={1}
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
      { authValue: makeAuthValue({ user: AM_ADMIN }) },
    );

    expect(
      await screen.findByRole('heading', { name: /redaguoti.*esamas darbuotojas/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('payroll-vardas-input')).toHaveValue(
      'Esamas Darbuotojas',
    );
    expect(screen.getByTestId('payroll-pareigos-input')).toHaveValue(
      'Egzistuojanti pareigybė',
    );
    expect(screen.getByTestId('payroll-bruto-input')).toHaveValue('2500.00');
  });
});
