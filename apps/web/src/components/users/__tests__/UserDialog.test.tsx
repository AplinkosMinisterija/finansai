/**
 * `UserDialog` testai — Issue #9 aprobacijos lygių priskyrimas.
 *
 * Tikriname:
 *  - „Aprobacijos lygiai" select rodomas tik AM tvirtintojui (aprover tenant +
 *    user rolė); slepiamas org tenant'ui.
 *  - Update kviečia `userUpdate` su pasirinktais `approvalLevelCodes`.
 *
 * Pastaba: Radix Select pointer model'is jsdom'e nepatikimas (žr.
 * ProjectDialog.test), todėl tenant/role nustatom per `user` prop (edit režimas),
 * o ne click'inant Select'ą.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { Tenant, User } from '@biip-finansai/shared';
import { UserDialog } from '../UserDialog';
import { renderWithProviders } from '@/test-utils';

const userCreateMock = vi.fn();
const userUpdateMock = vi.fn();
const classifierItemsListMock = vi.fn();
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    userCreate: (...args: unknown[]) => userCreateMock(...args),
    userUpdate: (...args: unknown[]) => userUpdateMock(...args),
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

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 10,
    username: 'am-dep',
    fullName: 'Departamento tvirtintojas',
    email: null,
    role: 'user',
    tenantId: 1,
    tenantCode: 'AM',
    tenantName: 'Aplinkos ministerija',
    tenantIsApprover: true,
    amScopeOrgIds: null,
    approvalLevelCodes: [],
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const AM_TENANT = makeTenant({ id: 1, code: 'AM', isApprover: true });
const ORG_TENANT = makeTenant({ id: 2, code: 'AAD', name: 'AAD', isApprover: false });

describe('UserDialog — aprobacijos lygiai (Issue #9)', () => {
  beforeEach(() => {
    userCreateMock.mockReset();
    userUpdateMock.mockReset();
    classifierItemsListMock.mockReset();
    classifierItemsListMock.mockResolvedValue([
      { id: 1, groupId: 1, parentId: null, code: 'AM_ADMIN', name: 'AM administratorius', sortOrder: 1, active: true },
      { id: 2, groupId: 1, parentId: null, code: 'DEPARTMENT', name: 'Departamentas', sortOrder: 2, active: true },
      { id: 3, groupId: 1, parentId: null, code: 'CHANCELLOR', name: 'Kancleris', sortOrder: 3, active: true },
    ]);
    userUpdateMock.mockResolvedValue({ id: 10 });
  });

  it('rodo „Aprobacijos lygiai" AM tvirtintojui su user role', async () => {
    renderWithProviders(
      <UserDialog
        mode="edit"
        user={makeUser({ role: 'user' })}
        tenants={[AM_TENANT, ORG_TENANT]}
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Aprobacijos lygiai')).toBeInTheDocument(),
    );
  });

  it('nerodo lygių org (ne-AM) tenant\'ui', () => {
    renderWithProviders(
      <UserDialog
        mode="edit"
        user={makeUser({ tenantId: 2, tenantCode: 'AAD', tenantIsApprover: false })}
        tenants={[AM_TENANT, ORG_TENANT]}
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Aprobacijos lygiai')).not.toBeInTheDocument();
  });

  it('update siunčia priskirtus approvalLevelCodes', async () => {
    // Lygiai jau priskirti (atspindi pasirinkimą formoje) — tikrinam, kad
    // submit'as juos perduoda backend'ui. (MultiSelect dropdown'o click'inimas
    // jsdom'e su Radix Dialog focus trap'u nestabilus — žr. failo header.)
    renderWithProviders(
      <UserDialog
        mode="edit"
        user={makeUser({ role: 'user', approvalLevelCodes: ['DEPARTMENT'] })}
        tenants={[AM_TENANT, ORG_TENANT]}
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await screen.findByLabelText('Aprobacijos lygiai');
    fireEvent.click(screen.getByRole('button', { name: 'Išsaugoti' }));

    await waitFor(() => expect(userUpdateMock).toHaveBeenCalledTimes(1));
    expect(userUpdateMock.mock.calls[0]![1]).toMatchObject({
      role: 'user',
      tenantId: 1,
      approvalLevelCodes: ['DEPARTMENT'],
    });
  });
});
