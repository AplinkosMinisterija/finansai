/**
 * AuthUser mock factory test'ams.
 *
 * Servisai vartoja `ctx.meta.user` (AuthMeta), kurį prod'e populate'ina
 * `api.service.authenticate` per session cookie. Testuose mes broker'į
 * kviečiame tiesiai (be HTTP), todėl reikia į `meta.user` įdėti
 * AuthUser-like objektą rankomis.
 *
 * `mockAuthUser({...})` grąžina defaults'us (AM admin), perduotą laukai
 * over'ina default'us. Naudoti:
 *   ```ts
 *   await broker.call('tenants.list', {}, {
 *     meta: { user: mockAuthUser() },
 *   });
 *   ```
 */
import type { AuthUser } from '@biip-finansai/shared';

export interface MockAuthUserOpts {
  id?: number;
  username?: string;
  fullName?: string;
  email?: string | null;
  role?: AuthUser['role'];
  tenantId?: number;
  tenantCode?: string;
  tenantName?: string;
  tenantIsApprover?: boolean;
  amScopeOrgIds?: number[] | null;
  approvalLevelCodes?: string[];
}

const DEFAULT_AM_ADMIN: AuthUser = {
  id: 1,
  username: 'test-am-admin',
  fullName: 'Test AM Admin',
  email: 'test-am-admin@example.com',
  role: 'admin',
  tenantId: 1,
  tenantCode: 'AM',
  tenantName: 'Aplinkos ministerija',
  tenantIsApprover: true,
  amScopeOrgIds: null,
  approvalLevelCodes: [],
};

export function mockAuthUser(opts: MockAuthUserOpts = {}): AuthUser {
  return {
    ...DEFAULT_AM_ADMIN,
    ...opts,
    // Explicit `null`'ą `amScopeOrgIds` lauke išlaikome (spread'as null'ą perima ok).
  };
}

/** Trumpinys org admin (ne AM) user'iui. */
export function mockOrgAdmin(
  opts: Omit<MockAuthUserOpts, 'role' | 'tenantIsApprover'> = {},
): AuthUser {
  return mockAuthUser({
    id: 2,
    username: 'test-org-admin',
    fullName: 'Test Org Admin',
    email: 'test-org-admin@example.com',
    tenantId: 2,
    tenantCode: 'AAD',
    tenantName: 'Aplinkos apsaugos departamentas',
    ...opts,
    role: 'admin',
    tenantIsApprover: false,
  });
}

/** Trumpinys org user (paprastas teikėjas) — ne AM, ne admin. */
export function mockOrgUser(
  opts: Omit<MockAuthUserOpts, 'role' | 'tenantIsApprover'> = {},
): AuthUser {
  return mockAuthUser({
    id: 3,
    username: 'test-org-user',
    fullName: 'Test Org User',
    email: 'test-org-user@example.com',
    tenantId: 2,
    tenantCode: 'AAD',
    tenantName: 'Aplinkos apsaugos departamentas',
    ...opts,
    role: 'user',
    tenantIsApprover: false,
  });
}
