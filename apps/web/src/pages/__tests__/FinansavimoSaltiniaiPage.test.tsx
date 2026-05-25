/**
 * `FinansavimoSaltiniaiPage` testai.
 *
 * Mockinam `fundingSourcesApi.list` per `vi.mock`, kad išvengtume tikrų
 * HTTP užklausų testų aplinkoje. Permission gating'as bandomas perduodant
 * skirtingus `AuthContext` user'ius.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { AuthUser, FundingSource } from '@biip-finansai/shared';
import FinansavimoSaltiniaiPage from '../FinansavimoSaltiniaiPage';
import { makeAuthValue, renderWithProviders } from '@/test-utils';

// Module-level mocks: aliasai pakeičia tikrus fetch'us — testai kontroliuoja resp.
const listMock = vi.fn();
vi.mock('@/lib/api/fvm', () => ({
  fundingSourcesApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  budgetAllocationsApi: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    summary: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

// Klasifikatoriai naudojami dialog'ui — bet šiame teste dialog'as neatsidaro,
// tačiau saugiklis vis tiek reikalingas, jeigu komponentas pre-fetchin'a.
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    classifierItemsList: vi.fn().mockResolvedValue([]),
    tenantsList: vi.fn().mockResolvedValue([]),
  };
});

function makeFundingSource(overrides: Partial<FundingSource> = {}): FundingSource {
  return {
    id: 1,
    tenantId: 1,
    pavadinimas: 'Valstybės biudžetas 2026',
    kodas: 'VB-2026',
    tipasClassifierItemId: 10,
    tipasCode: 'biudzetas',
    tipasName: 'Biudžetas',
    tenantCode: 'AM',
    tenantName: 'Aplinkos ministerija',
    metai: 2026,
    metineSuma: '1500000.00',
    aprasymas: null,
    aktyvus: true,
    allocationsCount: 0,
    allocatedAmount: '0.00',
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

describe('FinansavimoSaltiniaiPage', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  it('rodo tuščios būsenos žinutę, kai šaltinių nėra', async () => {
    listMock.mockResolvedValue([]);
    renderWithProviders(<FinansavimoSaltiniaiPage />, {
      authValue: makeAuthValue({ user: AM_ADMIN }),
    });

    await waitFor(() => {
      expect(screen.getByTestId('funding-sources-empty')).toBeInTheDocument();
    });
    expect(screen.getByText(/nėra šaltinių/i)).toBeInTheDocument();
  });

  it('AM administratorius mato „Naujas šaltinis" mygtuką', async () => {
    listMock.mockResolvedValue([]);
    renderWithProviders(<FinansavimoSaltiniaiPage />, {
      authValue: makeAuthValue({ user: AM_ADMIN }),
    });

    expect(
      await screen.findByTestId('open-new-funding-source'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /naujas šaltinis/i })).toBeInTheDocument();
  });

  it('Organizacijos vartotojas NEmato „Naujas šaltinis" mygtuko', async () => {
    listMock.mockResolvedValue([]);
    renderWithProviders(<FinansavimoSaltiniaiPage />, {
      authValue: makeAuthValue({ user: ORG_USER }),
    });

    await waitFor(() => {
      expect(screen.getByTestId('funding-sources-empty')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('open-new-funding-source')).toBeNull();
    expect(screen.queryByRole('button', { name: /naujas šaltinis/i })).toBeNull();
  });

  it('rodo finansavimo šaltinių sąrašą su pateiktais duomenimis', async () => {
    listMock.mockResolvedValue([
      makeFundingSource({
        id: 1,
        kodas: 'VB-2026',
        pavadinimas: 'Valstybės biudžetas 2026',
        metineSuma: '1500000.00',
        allocatedAmount: '250000.00',
        allocationsCount: 2,
      }),
      makeFundingSource({
        id: 2,
        kodas: 'ES-2026',
        pavadinimas: 'ES fondai 2026',
        metineSuma: '300000.00',
        allocatedAmount: '0.00',
        allocationsCount: 0,
      }),
    ]);

    renderWithProviders(<FinansavimoSaltiniaiPage />, {
      authValue: makeAuthValue({ user: AM_ADMIN }),
    });

    await waitFor(() => {
      expect(screen.getByTestId('funding-source-list')).toBeInTheDocument();
    });

    expect(screen.getByText('Valstybės biudžetas 2026')).toBeInTheDocument();
    expect(screen.getByText('ES fondai 2026')).toBeInTheDocument();
    expect(screen.getByText('VB-2026')).toBeInTheDocument();
    expect(screen.getByText('ES-2026')).toBeInTheDocument();
  });

  it('Organizacijos vartotojas nemato edit/delete mygtukų kortelėse', async () => {
    listMock.mockResolvedValue([
      makeFundingSource({ id: 42, kodas: 'VB-2026', pavadinimas: 'VB' }),
    ]);
    renderWithProviders(<FinansavimoSaltiniaiPage />, {
      authValue: makeAuthValue({ user: ORG_USER }),
    });

    await waitFor(() => {
      expect(screen.getByTestId('funding-source-list')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('edit-funding-source-42')).toBeNull();
    expect(screen.queryByTestId('delete-funding-source-42')).toBeNull();
  });
});
