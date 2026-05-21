/**
 * `RequestWizard` — FVM Iter 10 Biudžeto žingsnio testai.
 *
 * Tikriname:
 *  1. Wizard'e yra 6 žingsniai (po Iter 10 papildymo).
 *  2. Pasiekus „Biudžetas" žingsnį — rodomas kategorijos dropdown.
 *  3. spec_program_funding_type radio rodomas TIK kai kategorija = spec_programa.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type {
  ClassifierItem,
  FinancingRequest,
} from '@biip-finansai/shared';
import { RequestWizard } from '../RequestWizard';
import { makeAuthValue, renderWithProviders } from '@/test-utils';

const requestUpdateMock = vi.fn();
const requestSubmitMock = vi.fn();
const classifierItemsListMock = vi.fn();

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    requestUpdate: (...args: unknown[]) => requestUpdateMock(...args),
    requestSubmit: (...args: unknown[]) => requestSubmitMock(...args),
    classifierItemsList: (...args: unknown[]) => classifierItemsListMock(...args),
  };
});

function makeItem(overrides: Partial<ClassifierItem> = {}): ClassifierItem {
  return {
    id: 1,
    groupId: 1,
    groupCode: 'budget_category',
    parentId: null,
    code: 'du',
    name: 'Darbo užmokestis',
    sortOrder: 0,
    active: true,
    ...overrides,
  };
}

const BUDGET_CATEGORY_ITEMS: ClassifierItem[] = [
  makeItem({ id: 10, code: 'du', name: 'Darbo užmokestis' }),
  makeItem({
    id: 11,
    code: 'spec_programa',
    name: 'Specialioji programa',
    sortOrder: 1,
  }),
  makeItem({
    id: 12,
    code: 'prekes_paslaugos',
    name: 'Prekės ir paslaugos',
    sortOrder: 2,
  }),
];

const FUNDING_SOURCE_TYPE_ITEMS: ClassifierItem[] = [
  makeItem({
    id: 20,
    code: 'biudzetas',
    name: 'Biudžetas',
    groupCode: 'funding_source_type',
  }),
  makeItem({
    id: 21,
    code: 'es',
    name: 'ES fondai',
    groupCode: 'funding_source_type',
  }),
];

function makeRequest(overrides: Partial<FinancingRequest> = {}): FinancingRequest {
  return {
    id: 1,
    tenantId: 2,
    tenantCode: 'AAD',
    tenantName: 'AAD',
    createdByUserId: 200,
    createdByName: 'Specialistas',
    status: 'DRAFT',
    year: 2026,
    projectName: 'Test prašymas',
    systemCode: null,
    projectType: null,
    description: null,
    plannedWorks: null,
    priority: null,
    procurementStage: null,
    costDu: '0',
    costEquipment: '0',
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
    createdAt: '2026-05-21T00:00:00Z',
    updatedAt: '2026-05-21T00:00:00Z',
    ...overrides,
  };
}

describe('RequestWizard — FVM Biudžeto žingsnis (Iter 10)', () => {
  beforeEach(() => {
    requestUpdateMock.mockReset();
    requestSubmitMock.mockReset();
    classifierItemsListMock.mockReset();
    classifierItemsListMock.mockImplementation(
      (query: { groupCode?: string } = {}) => {
        if (query.groupCode === 'budget_category') {
          return Promise.resolve(BUDGET_CATEGORY_ITEMS);
        }
        if (query.groupCode === 'funding_source_type') {
          return Promise.resolve(FUNDING_SOURCE_TYPE_ITEMS);
        }
        return Promise.resolve([]);
      },
    );
    // Default — patch'as tiesiog grąžina pakartotinai esamą request'ą.
    requestUpdateMock.mockImplementation((id: number, patch: unknown) =>
      Promise.resolve({
        ...makeRequest({ id }),
        ...((patch as object) ?? {}),
      }),
    );
  });

  it('rodo 6 žingsnius sidebar dalyje (info, financing, budget, quarterly, responsible, review)', () => {
    renderWithProviders(
      <RequestWizard request={makeRequest()} onSaved={vi.fn()} />,
      { authValue: makeAuthValue() },
    );

    // Sidebar rodo „Užpildyta 1 iš 6" - 6 step'ai.
    expect(screen.getByText(/užpildyta 1 iš 6/i)).toBeInTheDocument();

    // Step button name'as = "<index> <label>" (e.g., "3 Biudžetas").
    expect(
      screen.getByRole('button', { name: /1 pagrindinė informacija/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /2 finansavimas/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /3 biudžetas/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /4 ketvirtinis paskirstymas/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /5 atsakingi asmenys/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /6 peržiūra/i }),
    ).toBeInTheDocument();
  });

  it('pasiekus „Biudžetas" žingsnį, rodomas kategorijos dropdown', async () => {
    renderWithProviders(
      <RequestWizard request={makeRequest()} onSaved={vi.fn()} />,
      { authValue: makeAuthValue() },
    );

    // Šokam tiesiai į Biudžeto žingsnį per sidebar mygtuką (kad išvengtume
    // visų save mutations'ų; sidebar leidžia teleport'inti į bet kurį step'ą).
    fireEvent.click(screen.getByRole('button', { name: /3 biudžetas/i }));

    // Žingsnio header'is.
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 2, name: /^biudžetas$/i }),
      ).toBeInTheDocument();
    });

    // Biudžeto kategorijos label + dropdown.
    expect(screen.getByText(/biudžeto kategorija/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/biudžeto kategorija/i)).toBeInTheDocument();

    // Spec.programos sekcija dar nematoma — kategorija nepasirinkta.
    expect(screen.queryByTestId('spec-program-section')).toBeNull();
  });

  it('spec.programos radio rodomas TIK kai kategorija = spec_programa', async () => {
    // Sukuriame request'ą jau su pasirinkta spec_programa kategorija — taip
    // patikrinam, kad form state'as inicializuoja sekciją iškart.
    renderWithProviders(
      <RequestWizard
        request={makeRequest({
          budgetCategoryId: 11,
          budgetCategoryCode: 'spec_programa',
          budgetCategoryName: 'Specialioji programa',
        })}
        onSaved={vi.fn()}
      />,
      { authValue: makeAuthValue() },
    );

    fireEvent.click(screen.getByRole('button', { name: /3 biudžetas/i }));

    // Sekcija matoma kai kategorija = spec_programa.
    await waitFor(() => {
      expect(screen.getByTestId('spec-program-section')).toBeInTheDocument();
    });

    const section = screen.getByTestId('spec-program-section');
    // Trys radio mygtukai: atskiras, biudzeto_dalis, nenurodyta.
    expect(within(section).getAllByRole('radio')).toHaveLength(3);
    expect(
      within(section).getByLabelText(/su atskiru finansavimu/i),
    ).toBeInTheDocument();
    expect(
      within(section).getByLabelText(/iš bendrojo biudžeto/i),
    ).toBeInTheDocument();
    expect(within(section).getByLabelText(/nenurodyta/i)).toBeInTheDocument();
  });

  it('NEspec.programa kategorijoje spec.programos sekcija nerodoma', async () => {
    renderWithProviders(
      <RequestWizard
        request={makeRequest({
          budgetCategoryId: 10,
          budgetCategoryCode: 'du',
          budgetCategoryName: 'Darbo užmokestis',
        })}
        onSaved={vi.fn()}
      />,
      { authValue: makeAuthValue() },
    );

    fireEvent.click(screen.getByRole('button', { name: /3 biudžetas/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 2, name: /^biudžetas$/i }),
      ).toBeInTheDocument();
    });

    // Kategorija pasirinkta, bet ne spec_programa — sekcija turi būti paslėpta.
    expect(screen.queryByTestId('spec-program-section')).toBeNull();
  });
});
