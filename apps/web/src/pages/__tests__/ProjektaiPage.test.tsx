/**
 * `ProjektaiPage` testai (Iter 11, FVM-3).
 *
 * Mockinam `projectsApi.list` per `vi.mock`. Permission gating'as bandomas
 * perduodant skirtingus `AuthContext` user'ius.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { AuthUser, Project } from '@biip-finansai/shared';
import ProjektaiPage from '../ProjektaiPage';
import { makeAuthValue, renderWithProviders } from '@/test-utils';

const listMock = vi.fn();
const removeMock = vi.fn();
vi.mock('@/lib/api/fvm', () => ({
  projectsApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: vi.fn(),
    summary: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: (...args: unknown[]) => removeMock(...args),
    changeStatus: vi.fn(),
  },
  fundingSourcesApi: {
    list: vi.fn().mockResolvedValue([]),
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

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    tenantsList: vi.fn().mockResolvedValue([]),
    usersList: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 }),
    requestsList: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 }),
  };
});

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    tenantId: 1,
    tenantCode: 'AM',
    tenantName: 'Aplinkos ministerija',
    budgetAllocationId: 10,
    budgetAllocationName: 'DU darbuotojams',
    requestId: null,
    requestProjectName: null,
    pavadinimas: 'IT modernizavimas 2026',
    tipas: 'projektas',
    biudzetas: '150000.00',
    pradziosData: '2026-01-01',
    pabaigosData: '2026-12-31',
    statusas: 'planuojama',
    atsakingasUserId: 5,
    atsakingasUserName: 'Jonas Jonaitis',
    aprasymas: null,
    isDuSystem: false,
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

describe('ProjektaiPage', () => {
  beforeEach(() => {
    listMock.mockReset();
    removeMock.mockReset();
  });

  it('rodo tuščios būsenos žinutę, kai projektų nėra', async () => {
    listMock.mockResolvedValue([]);
    renderWithProviders(<ProjektaiPage />, {
      authValue: makeAuthValue({ user: AM_ADMIN }),
    });

    await waitFor(() => {
      expect(screen.getByTestId('projects-empty')).toBeInTheDocument();
    });
    expect(screen.getByText(/nėra projektų/i)).toBeInTheDocument();
  });

  it('AM administratorius mato „Naujas projektas" mygtuką', async () => {
    listMock.mockResolvedValue([]);
    renderWithProviders(<ProjektaiPage />, {
      authValue: makeAuthValue({ user: AM_ADMIN }),
    });

    expect(
      await screen.findByTestId('open-new-project'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /naujas projektas/i }),
    ).toBeInTheDocument();
  });

  it('Organizacijos vartotojas (user role) NEmato „Naujas projektas" mygtuko', async () => {
    listMock.mockResolvedValue([]);
    renderWithProviders(<ProjektaiPage />, {
      authValue: makeAuthValue({ user: ORG_USER }),
    });

    await waitFor(() => {
      expect(screen.getByTestId('projects-empty')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('open-new-project')).toBeNull();
  });

  // SAUGUMO PATCH (Iter 13.x, docx §4.4): defense-in-depth FE filter'is.
  // Net jei backend grąžintų DU sistemos projektą (regresijos / cache atveju),
  // FE turi išmesti jį prieš render'inant ne-DU vartotojui.
  it('Organizacijos vartotojas NEmato DU sistemos projektų net jei backend grąžina', async () => {
    listMock.mockResolvedValue([
      makeProject({
        id: 1,
        pavadinimas: 'IT modernizavimas 2026',
        isDuSystem: false,
      }),
      makeProject({
        id: 99,
        pavadinimas: 'DU expense system (auto)',
        tipas: 'veikla',
        isDuSystem: true,
      }),
    ]);
    renderWithProviders(<ProjektaiPage />, {
      authValue: makeAuthValue({ user: ORG_USER }),
    });

    await waitFor(() => {
      expect(screen.getByTestId('projects-table')).toBeInTheDocument();
    });
    expect(screen.getByText('IT modernizavimas 2026')).toBeInTheDocument();
    // DU sistemos projektas turi būti paslėptas — net jei API grąžino.
    expect(screen.queryByText('DU expense system (auto)')).toBeNull();
    expect(screen.queryByTestId('project-row-99')).toBeNull();
  });

  it('rodo projektų sąrašą su pateiktais duomenimis', async () => {
    listMock.mockResolvedValue([
      makeProject({
        id: 1,
        pavadinimas: 'IT modernizavimas 2026',
        tipas: 'projektas',
        biudzetas: '150000.00',
        statusas: 'planuojama',
      }),
      makeProject({
        id: 2,
        pavadinimas: 'Mokymai 2026',
        tipas: 'veikla',
        biudzetas: '25000.00',
        statusas: 'vykdoma',
        atsakingasUserName: 'Petras Petraitis',
      }),
    ]);

    renderWithProviders(<ProjektaiPage />, {
      authValue: makeAuthValue({ user: AM_ADMIN }),
    });

    await waitFor(() => {
      expect(screen.getByTestId('projects-table')).toBeInTheDocument();
    });

    expect(screen.getByText('IT modernizavimas 2026')).toBeInTheDocument();
    expect(screen.getByText('Mokymai 2026')).toBeInTheDocument();
    expect(screen.getByText('Jonas Jonaitis')).toBeInTheDocument();
    expect(screen.getByText('Petras Petraitis')).toBeInTheDocument();
  });
});
