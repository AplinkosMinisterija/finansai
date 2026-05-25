/**
 * `DuPage` testai (Iter 13, FVM-5) — SAUGUMO PRIORITETINIAI.
 *
 * Tikriname 5+ kritiškus scenarijus:
 *  1. AM admin mato content + „Apskaičiuoti mėnesį" mygtuką
 *  2. Org admin mato content; nemato compute mygtuko
 *  3. Org specialistas (user role) — route guard navigate'ina į /
 *  4. Empty state, kai nėra profile'ų
 *  5. „Naujas profilis" mygtukas matomas tinkamoms rolėms
 *
 * Permission gating'as bandomas perduodant skirtingus `AuthContext` user'ius.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { AuthUser, PayrollProfile } from '@biip-finansai/shared';
import DuPage from '../DuPage';
import { makeAuthValue, renderWithProviders } from '@/test-utils';

const listProfilesMock = vi.fn();
const removeProfileMock = vi.fn();
vi.mock('@/lib/api/fvm', () => ({
  payrollApi: {
    listProfiles: (...args: unknown[]) => listProfilesMock(...args),
    getProfile: vi.fn(),
    createProfile: vi.fn(),
    updateProfile: vi.fn(),
    removeProfile: (...args: unknown[]) => removeProfileMock(...args),
    listDistributions: vi.fn().mockResolvedValue([]),
    getDistribution: vi.fn(),
    createDistribution: vi.fn(),
    updateDistribution: vi.fn(),
    removeDistribution: vi.fn(),
    computeMonth: vi.fn(),
  },
  fundingSourcesApi: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    tenantsList: vi.fn().mockResolvedValue([]),
    usersList: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 }),
  };
});

function makeProfile(overrides: Partial<PayrollProfile> = {}): PayrollProfile {
  return {
    id: 1,
    tenantId: 1,
    tenantCode: 'AM',
    tenantName: 'Aplinkos ministerija',
    userId: 5,
    userFullName: 'Jonas Jonaitis',
    vardasPavarde: 'Jonas Jonaitis',
    pareigos: 'Vyr. specialistas',
    sutartiesTipas: 'darbo',
    atlyginimasBruto: '1500.00',
    priedai: '200.00',
    galiojaNuo: '2026-01-01',
    galiojaIki: null,
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
  approvalLevelCodes: [],
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
  approvalLevelCodes: [],
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
  approvalLevelCodes: [],
};

/**
 * Wrapper komponentas, kuris renderina DuPage maršrute /du ir tikrina,
 * kad neturintieji prieigos butų nukreipti į / (HomePage placeholder).
 */
function HomePlaceholder(): JSX.Element {
  return <div data-testid="home-placeholder">Pradžia</div>;
}

function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<HomePlaceholder />} />
      <Route path="/du" element={<DuPage />} />
    </Routes>
  );
}

describe('DuPage — saugumo gating + UX', () => {
  beforeEach(() => {
    listProfilesMock.mockReset();
    removeProfileMock.mockReset();
  });

  it('AM administratorius mato content + „Apskaičiuoti mėnesį" mygtuką', async () => {
    listProfilesMock.mockResolvedValue([]);
    renderWithProviders(<AppRoutes />, {
      authValue: makeAuthValue({ user: AM_ADMIN }),
      initialRoute: '/du',
    });

    // Header'as su DU pavadinimu — atvaizduoja, kad page sėkmingai sumontuotas.
    expect(
      await screen.findByRole('heading', { name: /darbo užmokestis/i }),
    ).toBeInTheDocument();
    // Compute mygtukas matomas tik AM admin'ui.
    expect(screen.getByTestId('open-compute-month')).toBeInTheDocument();
    // „Naujas profilis" — irgi matomas.
    expect(screen.getByTestId('open-new-payroll')).toBeInTheDocument();
    // Home placeholder NE-atvaizduotas.
    expect(screen.queryByTestId('home-placeholder')).toBeNull();
  });

  it('Org administratorius mato savo tenant content; NE-mato „Apskaičiuoti mėnesį" mygtuko', async () => {
    listProfilesMock.mockResolvedValue([]);
    renderWithProviders(<AppRoutes />, {
      authValue: makeAuthValue({ user: ORG_ADMIN }),
      initialRoute: '/du',
    });

    // Org admin'as patenka į DuPage.
    expect(
      await screen.findByRole('heading', { name: /darbo užmokestis/i }),
    ).toBeInTheDocument();
    // Compute mygtukas paslepiamas — tik AM admin'as gali skaičiuoti.
    expect(screen.queryByTestId('open-compute-month')).toBeNull();
    // Profilius vis tiek gali kurti savo tenant'e.
    expect(screen.getByTestId('open-new-payroll')).toBeInTheDocument();
  });

  it('Org specialistas (user role) — route guard NAVIGATE į / (DU duomenų nemato)', async () => {
    listProfilesMock.mockResolvedValue([]);
    renderWithProviders(<AppRoutes />, {
      authValue: makeAuthValue({ user: ORG_USER }),
      initialRoute: '/du',
    });

    // Naviguotas atgal į / — DuPage NE-atvaizduotas.
    await waitFor(() => {
      expect(screen.getByTestId('home-placeholder')).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('heading', { name: /darbo užmokestis/i }),
    ).toBeNull();
    // Payroll API'as net NE-kviestas — request'ą nutraukia guard'as.
    expect(listProfilesMock).not.toHaveBeenCalled();
  });

  it('renderina empty state žinutę, kai DU profilių nėra (AM admin)', async () => {
    listProfilesMock.mockResolvedValue([]);
    renderWithProviders(<AppRoutes />, {
      authValue: makeAuthValue({ user: AM_ADMIN }),
      initialRoute: '/du',
    });

    await waitFor(() => {
      expect(screen.getByTestId('payroll-empty')).toBeInTheDocument();
    });
    expect(screen.getByText(/nėra DU profilių/i)).toBeInTheDocument();
  });

  it('„Naujas profilis" mygtukas matomas AM admin ir org admin rolėms', async () => {
    listProfilesMock.mockResolvedValue([]);

    // AM admin
    const am = renderWithProviders(<AppRoutes />, {
      authValue: makeAuthValue({ user: AM_ADMIN }),
      initialRoute: '/du',
    });
    expect(await screen.findByTestId('open-new-payroll')).toBeInTheDocument();
    am.unmount();

    // Org admin
    listProfilesMock.mockResolvedValue([]);
    renderWithProviders(<AppRoutes />, {
      authValue: makeAuthValue({ user: ORG_ADMIN }),
      initialRoute: '/du',
    });
    expect(await screen.findByTestId('open-new-payroll')).toBeInTheDocument();
  });

  it('rodo DU profilių lentelę su pateiktais duomenimis', async () => {
    listProfilesMock.mockResolvedValue([
      makeProfile({
        id: 1,
        vardasPavarde: 'Jonas Jonaitis',
        pareigos: 'Vyr. specialistas',
        atlyginimasBruto: '1500.00',
      }),
      makeProfile({
        id: 2,
        vardasPavarde: 'Petras Petraitis',
        pareigos: 'Skyriaus vadovas',
        atlyginimasBruto: '2200.00',
        sutartiesTipas: 'paslaugu',
      }),
    ]);

    renderWithProviders(<AppRoutes />, {
      authValue: makeAuthValue({ user: AM_ADMIN }),
      initialRoute: '/du',
    });

    await waitFor(() => {
      expect(screen.getByTestId('payroll-table')).toBeInTheDocument();
    });
    expect(screen.getByText('Jonas Jonaitis')).toBeInTheDocument();
    expect(screen.getByText('Petras Petraitis')).toBeInTheDocument();
    expect(screen.getByText('Vyr. specialistas')).toBeInTheDocument();
    expect(screen.getByText('Skyriaus vadovas')).toBeInTheDocument();
  });
});
