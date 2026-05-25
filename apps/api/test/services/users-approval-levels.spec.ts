/**
 * Issue #9: aprobacijos lygių (`approvalLevelCodes`) priskyrimas vartotojams.
 *
 * Padengia:
 *  1. AM admin sukuria AM `role=user` su `approvalLevelCodes: ['DEPARTMENT']`
 *     → grąžinamas su tuo lauku.
 *  2. Neegzistuojantis lygio kodas → 400.
 *  3. Org (ne-AM) vartotojui perduoti lygiai ignoruojami (force `[]`).
 *  4. Update'as gali pakeisti lygius; role/tenant pakeitimas, kuris lygius
 *     padaro neaktualius, juos išvalo.
 *
 * Test'ai kviečia broker'į tiesiogiai (be HTTP gateway'aus).
 */
import type { ServiceBroker } from 'moleculer';
import type { User as UserDTO } from '@biip-finansai/shared';
import {
  getTestKnex,
  closeTestKnex,
  truncateAll,
  seedBaseFixtures,
  seedOrgTenant,
  type BaseFixtures,
  type OrgTenantFixtures,
} from '../helpers/db';
import { createTestBroker } from '../helpers/broker';
import { mockAuthUser } from '../helpers/auth';

/** Įdeda `approval_levels` klasifikatorių grupę su keliais lygiais. */
async function seedApprovalLevels(): Promise<void> {
  const knex = getTestKnex();
  const inserted = (await knex('classifier_groups')
    .insert({
      code: 'approval_levels',
      name: 'Aprobacijos lygiai',
      description: 'Test fixture — approval_levels group',
      active: true,
    })
    .returning('id')) as Array<{ id: number }>;
  const groupId = inserted[0]!.id;
  const items: Array<{ code: string; name: string; sortOrder: number }> = [
    { code: 'AM_ADMIN', name: 'AM administratorius', sortOrder: 1 },
    { code: 'DEPARTMENT', name: 'Departamentas', sortOrder: 2 },
    { code: 'CHANCELLOR', name: 'Kancleris', sortOrder: 3 },
  ];
  for (const item of items) {
    await knex('classifier_items').insert({
      group_id: groupId,
      parent_id: null,
      code: item.code,
      name: item.name,
      sort_order: item.sortOrder,
      active: true,
    });
  }
}

describe('users service — aprobacijos lygiai (Issue #9)', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;

  beforeAll(async () => {
    broker = await createTestBroker();
  });

  afterAll(async () => {
    if (broker) {
      await broker.stop();
    }
    await closeTestKnex();
  });

  beforeEach(async () => {
    const knex = getTestKnex();
    await truncateAll(knex);
    base = await seedBaseFixtures(knex);
    org = await seedOrgTenant(knex);
    await seedApprovalLevels();
  });

  const amAdmin = () =>
    mockAuthUser({
      id: base.amAdminUserId,
      tenantId: base.amTenantId,
      tenantIsApprover: true,
      role: 'admin',
    });

  it('AM admin sukuria AM user su approvalLevelCodes', async () => {
    const created = (await broker.call(
      'users.create',
      {
        username: 'am-dep',
        password: 'demo123',
        fullName: 'Departamento tvirtintojas',
        role: 'user',
        tenantId: base.amTenantId,
        approvalLevelCodes: ['DEPARTMENT'],
      },
      { meta: { user: amAdmin() } },
    )) as UserDTO;
    expect(created.approvalLevelCodes).toEqual(['DEPARTMENT']);
  });

  it('neegzistuojantis lygio kodas → 400', async () => {
    await expect(
      broker.call(
        'users.create',
        {
          username: 'am-bad',
          password: 'demo123',
          fullName: 'Blogas lygis',
          role: 'user',
          tenantId: base.amTenantId,
          approvalLevelCodes: ['NĖRA_TOKIO'],
        },
        { meta: { user: amAdmin() } },
      ),
    ).rejects.toMatchObject({ code: 400 });
  });

  it('org (ne-AM) vartotojui lygiai ignoruojami', async () => {
    const created = (await broker.call(
      'users.create',
      {
        username: 'org-x',
        password: 'demo123',
        fullName: 'Org vartotojas',
        role: 'user',
        tenantId: org.orgTenantId,
        approvalLevelCodes: ['DEPARTMENT'],
      },
      { meta: { user: amAdmin() } },
    )) as UserDTO;
    expect(created.approvalLevelCodes).toEqual([]);
  });

  it('update keičia lygius; role pakeitimas į admin išvalo', async () => {
    const created = (await broker.call(
      'users.create',
      {
        username: 'am-dep2',
        password: 'demo123',
        fullName: 'Dep tvirtintojas',
        role: 'user',
        tenantId: base.amTenantId,
        approvalLevelCodes: ['DEPARTMENT'],
      },
      { meta: { user: amAdmin() } },
    )) as UserDTO;

    const updated = (await broker.call(
      'users.update',
      { id: created.id, approvalLevelCodes: ['CHANCELLOR'] },
      { meta: { user: amAdmin() } },
    )) as UserDTO;
    expect(updated.approvalLevelCodes).toEqual(['CHANCELLOR']);

    // Role → admin: lygiai super-approver'iui neaktualūs → išvalom.
    const toAdmin = (await broker.call(
      'users.update',
      { id: created.id, role: 'admin' },
      { meta: { user: amAdmin() } },
    )) as UserDTO;
    expect(toAdmin.approvalLevelCodes).toEqual([]);
  });
});
