/**
 * `RequestWizard` — UAT #42 (PA-002/003/004) žingsnių struktūros testai.
 *
 * Po UAT #42 teikėjas nebepildo administracinių/finansinių sprendimų:
 *  - PA-004: „Biudžetas" žingsnis pašalintas → liko 5 žingsniai.
 *  - PA-002: Prioritetas + Pirkimo stadija nebėra wizard'e.
 *  - PA-003: Finansavimo šaltinio laukai (Finansavimas iš IT / Kitos lėšos /
 *    Kitų lėšų šaltinis) nebėra wizard'e.
 *
 * Tikriname:
 *  1. Wizard'e yra 5 žingsniai (info, financing, quarterly, responsible, review).
 *  2. „Biudžetas" žingsnio nebėra.
 *  3. Prioriteto / pirkimo stadijos laukų nebėra Pagrindinės informacijos žingsnyje.
 *  4. Finansavimo šaltinio laukų nebėra Finansavimo žingsnyje.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ClassifierItem, FinancingRequest } from '@biip-finansai/shared';
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
    groupCode: 'is_system',
    parentId: null,
    code: 'AADIS',
    name: 'AADIS — Aplinkos apsaugos departamento IS',
    sortOrder: 0,
    active: true,
    ...overrides,
  };
}

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
    createdAt: '2026-05-21T00:00:00Z',
    updatedAt: '2026-05-21T00:00:00Z',
    ...overrides,
  };
}

describe('RequestWizard — UAT #42 žingsnių struktūra', () => {
  beforeEach(() => {
    requestUpdateMock.mockReset();
    requestSubmitMock.mockReset();
    classifierItemsListMock.mockReset();
    classifierItemsListMock.mockResolvedValue([makeItem()]);
    requestUpdateMock.mockImplementation((id: number, patch: unknown) =>
      Promise.resolve({
        ...makeRequest({ id }),
        ...((patch as object) ?? {}),
      }),
    );
  });

  it('rodo 5 žingsnius (info, financing, quarterly, responsible, review)', () => {
    renderWithProviders(<RequestWizard request={makeRequest()} onSaved={vi.fn()} />, {
      authValue: makeAuthValue(),
    });

    // PA-004: liko 5 žingsniai.
    expect(screen.getByText(/užpildyta 1 iš 5/i)).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /1 pagrindinė informacija/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2 finansavimas/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3 ketvirtinis paskirstymas/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /4 atsakingi asmenys/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /5 peržiūra/i })).toBeInTheDocument();

    // PA-004: „Biudžetas" žingsnio nebėra.
    expect(screen.queryByRole('button', { name: /biudžetas/i })).toBeNull();
  });

  it('PA-002: Pagrindinės informacijos žingsnyje nėra prioriteto / pirkimo stadijos', () => {
    renderWithProviders(<RequestWizard request={makeRequest()} onSaved={vi.fn()} />, {
      authValue: makeAuthValue(),
    });

    // Esam info žingsnyje (default).
    expect(screen.getByLabelText(/projekto pavadinimas/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/prioritetas/i)).toBeNull();
    expect(screen.queryByLabelText(/pirkimo stadija/i)).toBeNull();
  });

  it('PA-003: Finansavimo žingsnyje nėra finansavimo šaltinio laukų', async () => {
    renderWithProviders(<RequestWizard request={makeRequest()} onSaved={vi.fn()} />, {
      authValue: makeAuthValue(),
    });

    fireEvent.click(screen.getByRole('button', { name: /2 finansavimas/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 2, name: /^finansavimas$/i }),
      ).toBeInTheDocument();
    });

    // Išlaidų laukai lieka.
    expect(screen.getByLabelText(/įranga \/ licencijos/i)).toBeInTheDocument();
    // Finansavimo šaltinio laukai pašalinti.
    expect(screen.queryByLabelText(/finansavimas iš it/i)).toBeNull();
    expect(screen.queryByLabelText(/kitos lėšos/i)).toBeNull();
    expect(screen.queryByLabelText(/kitų lėšų šaltinis/i)).toBeNull();
  });
});
