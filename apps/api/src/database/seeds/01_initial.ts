/**
 * Iter 1 seed: AM + 3 pavaldžios institucijos + demo accounts.
 *
 * Visi demo passwordai = "demo".
 */
import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';

interface TenantSeed {
  code: string;
  name: string;
  isApprover: boolean;
}

const TENANTS: TenantSeed[] = [
  { code: 'AM', name: 'Aplinkos ministerija', isApprover: true },
  { code: 'AAD', name: 'Aplinkos apsaugos departamentas', isApprover: false },
  { code: 'VSTT', name: 'Valstybinė saugomų teritorijų tarnyba', isApprover: false },
  { code: 'LGT', name: 'Lietuvos geologijos tarnyba', isApprover: false },
];

interface UserSeed {
  username: string;
  password: string;
  fullName: string;
  email: string;
  role: 'am_admin' | 'am_user' | 'org_admin' | 'org_user';
  tenantCode: string;
  /** AM userių scope. NULL = visos org'os. Sąraše naudojam tenant code'us, vėliau resolvinam į ID. */
  amScopeOrgCodes?: string[] | null;
}

const USERS: UserSeed[] = [
  // AM
  {
    username: 'am-admin',
    password: 'demo',
    fullName: 'AM Administratorius',
    email: 'admin@am.lt',
    role: 'am_admin',
    tenantCode: 'AM',
    amScopeOrgCodes: null,
  },
  {
    username: 'demo',
    password: 'demo',
    fullName: 'Demo Administratorius',
    email: 'demo@am.lt',
    role: 'am_admin',
    tenantCode: 'AM',
    amScopeOrgCodes: null,
  },
  {
    username: 'am-user',
    password: 'demo',
    fullName: 'AM Specialistas (visi)',
    email: 'specialistas@am.lt',
    role: 'am_user',
    tenantCode: 'AM',
    amScopeOrgCodes: null,
  },
  {
    username: 'am-user-aad',
    password: 'demo',
    fullName: 'AM Specialistas (AAD)',
    email: 'aad-koordinatorius@am.lt',
    role: 'am_user',
    tenantCode: 'AM',
    amScopeOrgCodes: ['AAD'],
  },
  // AAD
  {
    username: 'aad-admin',
    password: 'demo',
    fullName: 'AAD Administratorius',
    email: 'admin@aad.lt',
    role: 'org_admin',
    tenantCode: 'AAD',
  },
  {
    username: 'aad-user',
    password: 'demo',
    fullName: 'AAD Specialistas',
    email: 'specialistas@aad.lt',
    role: 'org_user',
    tenantCode: 'AAD',
  },
  // VSTT
  {
    username: 'vstt-admin',
    password: 'demo',
    fullName: 'VSTT Administratorius',
    email: 'admin@vstt.lt',
    role: 'org_admin',
    tenantCode: 'VSTT',
  },
  {
    username: 'vstt-user',
    password: 'demo',
    fullName: 'VSTT Specialistas',
    email: 'specialistas@vstt.lt',
    role: 'org_user',
    tenantCode: 'VSTT',
  },
  // LGT
  {
    username: 'lgt-admin',
    password: 'demo',
    fullName: 'LGT Administratorius',
    email: 'admin@lgt.lt',
    role: 'org_admin',
    tenantCode: 'LGT',
  },
  {
    username: 'lgt-user',
    password: 'demo',
    fullName: 'LGT Specialistas',
    email: 'specialistas@lgt.lt',
    role: 'org_user',
    tenantCode: 'LGT',
  },
];

export async function seed(knex: Knex): Promise<void> {
  // Trinam viską reverse-order'iu (FK constraints).
  await knex('users').del();
  await knex('tenants').del();

  await knex.raw('ALTER SEQUENCE users_id_seq RESTART WITH 1');
  await knex.raw('ALTER SEQUENCE tenants_id_seq RESTART WITH 1');

  // 1) Tenants
  const tenantIdByCode: Record<string, number> = {};
  for (const t of TENANTS) {
    const inserted = (await knex('tenants')
      .insert({
        code: t.code,
        name: t.name,
        is_approver: t.isApprover,
        active: true,
      })
      .returning('id')) as Array<{ id: number }>;
    const firstRow = inserted[0];
    if (!firstRow) throw new Error(`Tenant insert failed: ${t.code}`);
    tenantIdByCode[t.code] = firstRow.id;
  }

  // 2) Users
  for (const u of USERS) {
    const tenantId = tenantIdByCode[u.tenantCode];
    if (tenantId === undefined) {
      throw new Error(`Tenant code not found for user ${u.username}: ${u.tenantCode}`);
    }

    let amScopeOrgIds: number[] | null = null;
    if (u.amScopeOrgCodes !== undefined && u.amScopeOrgCodes !== null) {
      amScopeOrgIds = u.amScopeOrgCodes.map((c) => {
        const id = tenantIdByCode[c];
        if (id === undefined) throw new Error(`Scope tenant not found: ${c}`);
        return id;
      });
    }

    const passwordHash = await bcrypt.hash(u.password, 10);
    await knex('users').insert({
      username: u.username,
      password_hash: passwordHash,
      full_name: u.fullName,
      email: u.email,
      role: u.role,
      tenant_id: tenantId,
      am_scope_org_ids: amScopeOrgIds,
      active: true,
    });
  }
}
