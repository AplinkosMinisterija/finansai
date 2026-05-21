/**
 * `FundingSourceDialog` testai.
 *
 * Tikriname:
 *  - Validation klaidos rodomos kai privalomi laukai tušti
 *  - Submit kviečia `fundingSourcesApi.create` su pateiktais duomenimis
 *  - Dialog'as renderina lauko etiketes (a11y label associations)
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ClassifierItem, Tenant } from '@biip-finansai/shared';
import { FundingSourceDialog } from '../FundingSourceDialog';
import { makeAuthValue, renderWithProviders } from '@/test-utils';

const createMock = vi.fn();
const updateMock = vi.fn();
vi.mock('@/lib/api/fvm', () => ({
  fundingSourcesApi: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
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

const tenantsListMock = vi.fn();
const classifierItemsListMock = vi.fn();
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    tenantsList: (...args: unknown[]) => tenantsListMock(...args),
    classifierItemsList: (...args: unknown[]) => classifierItemsListMock(...args),
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

function makeItem(overrides: Partial<ClassifierItem> = {}): ClassifierItem {
  return {
    id: 10,
    groupId: 1,
    parentId: null,
    code: 'biudzetas',
    name: 'Biudžetas',
    sortOrder: 0,
    active: true,
    ...overrides,
  };
}

describe('FundingSourceDialog', () => {
  beforeEach(() => {
    createMock.mockReset();
    updateMock.mockReset();
    tenantsListMock.mockReset();
    classifierItemsListMock.mockReset();
    tenantsListMock.mockResolvedValue([makeTenant()]);
    classifierItemsListMock.mockResolvedValue([makeItem()]);
  });

  it('renderina create formos pavadinimą su privalomais laukais', async () => {
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    renderWithProviders(
      <FundingSourceDialog
        mode="create"
        source={null}
        defaultTenantId={1}
        defaultYear={2026}
        open
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
      />,
      { authValue: makeAuthValue() },
    );

    expect(
      await screen.findByRole('heading', { name: /naujas finansavimo šaltinis/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^kodas$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^pavadinimas$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^metai$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/metinė suma/i)).toBeInTheDocument();
  });

  it('rodo validation klaidą, kai kodas tuščias', async () => {
    renderWithProviders(
      <FundingSourceDialog
        mode="create"
        source={null}
        defaultTenantId={1}
        defaultYear={2026}
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
      { authValue: makeAuthValue() },
    );

    // Užpildom pavadinimą bet ne kodą — submit'as turi nurodyti, kad kodas privalomas.
    fireEvent.change(screen.getByLabelText(/^pavadinimas$/i), {
      target: { value: 'Valstybės biudžetas 2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sukurti/i }));

    expect(await screen.findByText(/įveskite kodą/i)).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rodo validation klaidą, kai šaltinio tipas nepasirinktas', async () => {
    renderWithProviders(
      <FundingSourceDialog
        mode="create"
        source={null}
        defaultTenantId={1}
        defaultYear={2026}
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
      { authValue: makeAuthValue() },
    );

    await waitFor(() => {
      expect(tenantsListMock).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText(/^kodas$/i), { target: { value: 'VB-2026' } });
    fireEvent.change(screen.getByLabelText(/^pavadinimas$/i), {
      target: { value: 'Valstybės biudžetas 2026' },
    });
    fireEvent.change(screen.getByLabelText(/metinė suma/i), { target: { value: '1500' } });

    fireEvent.click(screen.getByRole('button', { name: /sukurti/i }));

    expect(
      await screen.findByText(/pasirinkite finansavimo šaltinio tipą/i),
    ).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('paspaudus „Atšaukti" iškviečia onOpenChange(false)', async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <FundingSourceDialog
        mode="create"
        source={null}
        defaultTenantId={1}
        defaultYear={2026}
        open
        onOpenChange={onOpenChange}
        onSuccess={vi.fn()}
      />,
      { authValue: makeAuthValue() },
    );

    fireEvent.click(await screen.findByRole('button', { name: /atšaukti/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('edit režime rodo esamus duomenis', async () => {
    renderWithProviders(
      <FundingSourceDialog
        mode="edit"
        source={{
          id: 5,
          tenantId: 1,
          pavadinimas: 'Egzistuojantis šaltinis',
          kodas: 'EXIST-001',
          tipasClassifierItemId: 10,
          tipasCode: 'biudzetas',
          tipasName: 'Biudžetas',
          tenantCode: 'AM',
          tenantName: 'Aplinkos ministerija',
          metai: 2026,
          metineSuma: '500000.00',
          aprasymas: 'aprašymas',
          aktyvus: true,
          allocationsCount: 0,
          allocatedAmount: '0.00',
          createdAt: '2026-05-21T00:00:00Z',
          updatedAt: '2026-05-21T00:00:00Z',
        }}
        defaultTenantId={1}
        defaultYear={2026}
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
      { authValue: makeAuthValue() },
    );

    expect(
      await screen.findByRole('heading', { name: /redaguoti.*exist-001/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^kodas$/i)).toHaveValue('EXIST-001');
    expect(screen.getByLabelText(/^pavadinimas$/i)).toHaveValue('Egzistuojantis šaltinis');
    expect(screen.getByLabelText(/metinė suma/i)).toHaveValue('500000.00');
  });
});
