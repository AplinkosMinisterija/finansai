/**
 * `CopyBudgetDialog` testai (Iter 15, F16).
 *
 * Tikriname:
 *  1. Form validation — sourceYear === targetYear blokuoja submit'ą.
 *  2. Submit kviečia `fundingSourcesApi.copyFromYear` su tinkamais
 *     duomenimis ir invaliduoja queries onSuccess.
 *  3. 409 Conflict error iš serverio rodomas vartotojui LT žinute.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { AuthUser, CopyBudgetResponse, Tenant } from '@biip-finansai/shared';
import { CopyBudgetDialog } from '../CopyBudgetDialog';
import { makeAuthValue, renderWithProviders } from '@/test-utils';

const copyFromYearMock = vi.fn();
const tenantsListMock = vi.fn();

vi.mock('@/lib/api/fvm', () => ({
  fundingSourcesApi: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    copyFromYear: (...args: unknown[]) => copyFromYearMock(...args),
  },
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    tenantsList: (...args: unknown[]) => tenantsListMock(...args),
  };
});

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

describe('CopyBudgetDialog (Iter 15, F16)', () => {
  beforeEach(() => {
    copyFromYearMock.mockReset();
    tenantsListMock.mockReset();
    tenantsListMock.mockResolvedValue([makeTenant()]);
  });

  it('rodo validation klaidą, kai šaltinio ir tikslo metai sutampa', async () => {
    renderWithProviders(
      <CopyBudgetDialog
        open
        onOpenChange={vi.fn()}
        defaultSourceYear={2026}
        defaultTargetYear={2026}
      />,
      { authValue: makeAuthValue({ user: AM_ADMIN }) },
    );

    expect(
      await screen.findByRole('heading', { name: /kopijuoti biudžetą/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('copy-submit'));

    expect(
      await screen.findByText(/šaltinio ir tikslo metai turi skirtis/i),
    ).toBeInTheDocument();
    expect(copyFromYearMock).not.toHaveBeenCalled();
  });

  it('submit kviečia copyFromYear API su tinkamais duomenimis ir rodo sėkmės žinutę', async () => {
    const response: CopyBudgetResponse = {
      copiedSources: 3,
      copiedAllocations: 7,
      targetYear: 2026,
    };
    copyFromYearMock.mockResolvedValue(response);

    const onOpenChange = vi.fn();
    renderWithProviders(
      <CopyBudgetDialog
        open
        onOpenChange={onOpenChange}
        defaultSourceYear={2025}
        defaultTargetYear={2026}
      />,
      { authValue: makeAuthValue({ user: AM_ADMIN }) },
    );

    // Form'os default values atspindi defaultSource/TargetYear.
    expect(await screen.findByTestId('copy-source-year-input')).toHaveValue(2025);
    expect(screen.getByTestId('copy-target-year-input')).toHaveValue(2026);

    fireEvent.click(screen.getByTestId('copy-submit'));

    await waitFor(() => {
      expect(copyFromYearMock).toHaveBeenCalledWith({
        sourceYear: 2025,
        targetYear: 2026,
      });
    });

    // Sėkmės result rodomas.
    expect(await screen.findByTestId('copy-result')).toBeInTheDocument();
    expect(
      screen.getByText(/sėkmingai nukopijuota į 2026 metus/i),
    ).toBeInTheDocument();
  });

  it('409 Conflict iš serverio rodomas LT žinute vartotojui', async () => {
    const axiosErr = Object.assign(new Error('Request failed'), {
      isAxiosError: true,
      response: {
        status: 409,
        data: {
          message:
            '2026 metais jau yra finansavimo šaltinių. Pirma juos pašalinkite arba pasirinkite kitus tikslo metus.',
        },
      },
    });
    copyFromYearMock.mockRejectedValue(axiosErr);

    renderWithProviders(
      <CopyBudgetDialog
        open
        onOpenChange={vi.fn()}
        defaultSourceYear={2025}
        defaultTargetYear={2026}
      />,
      { authValue: makeAuthValue({ user: AM_ADMIN }) },
    );

    fireEvent.click(await screen.findByTestId('copy-submit'));

    await waitFor(() => {
      expect(copyFromYearMock).toHaveBeenCalled();
    });

    const errEl = await screen.findByTestId('copy-dialog-error');
    expect(errEl).toBeInTheDocument();
    expect(errEl).toHaveTextContent(/2026 metais jau yra finansavimo šaltinių/i);
  });

  it('paspaudus „Uždaryti" iškviečia onOpenChange(false)', async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <CopyBudgetDialog
        open
        onOpenChange={onOpenChange}
      />,
      { authValue: makeAuthValue({ user: AM_ADMIN }) },
    );

    // Du elementai vadinasi „Uždaryti" — radix dialog'o X mygtukas su sr-only
    // tekstu ir mūsų footer'io mygtukas. Imam footer'io variantą per text.
    const allCloseButtons = await screen.findAllByRole('button', {
      name: /uždaryti/i,
    });
    // Footer'io mygtukas — turi matomą tekstą (ne sr-only).
    const footerClose = allCloseButtons.find((btn) =>
      btn.textContent?.includes('Uždaryti'),
    );
    expect(footerClose).toBeDefined();
    fireEvent.click(footerClose!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
