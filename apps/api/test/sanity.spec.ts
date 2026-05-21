/**
 * Sanity test'as — įrodo, kad backend test infra veikia end-to-end:
 *   1. Test DB sukurta, migracijos paleistos.
 *   2. Knex + Objection prijungti.
 *   3. ServiceBroker'is paleidžiamas su realiais servisais.
 *   4. Service call'as su mock auth user'iu grąžina laukiamus duomenis.
 *
 * Šis spec'as turi praeiti. Jei kažkas iš jo žlunga — pirma sutvarkome
 * infra, paskui rašome naujus testus.
 */
import type { ServiceBroker } from 'moleculer';
import type { Tenant } from '@biip-finansai/shared';
import {
  getTestKnex,
  closeTestKnex,
  truncateAll,
  seedBaseFixtures,
} from './helpers/db';
import { createTestBroker } from './helpers/broker';
import { mockAuthUser } from './helpers/auth';

describe('test infrastructure sanity', () => {
  let broker: ServiceBroker;

  beforeAll(async () => {
    const knex = getTestKnex();
    await truncateAll(knex);
    await seedBaseFixtures(knex);
    broker = await createTestBroker({
      // Reikia tik tenants servisui call'inti — kiti servisai gali turėti
      // priklausomybes (Redis), tad sumažinam scope sanity'ui.
      services: undefined, // = ALL_SERVICES, bet HTTP gateway nepalietas
    });
  });

  afterAll(async () => {
    if (broker) {
      await broker.stop();
    }
    await closeTestKnex();
  });

  it('DB connection veikia ir migracijos pritaikytos', async () => {
    const knex = getTestKnex();
    const result = await knex.raw<{ rows: Array<{ ok: number }> }>(
      'SELECT 1 AS ok',
    );
    expect(result.rows[0]?.ok).toBe(1);

    // Patikrinam, kad core lentelės egzistuoja (migracijos pasileido).
    const hasTenants = await knex.schema.hasTable('tenants');
    const hasUsers = await knex.schema.hasTable('users');
    const hasRequests = await knex.schema.hasTable('requests');
    expect(hasTenants).toBe(true);
    expect(hasUsers).toBe(true);
    expect(hasRequests).toBe(true);
  });

  it('seedBaseFixtures sukuria AM tenant + admin user', async () => {
    const knex = getTestKnex();
    const tenant = await knex('tenants').where({ code: 'AM' }).first();
    expect(tenant).toBeDefined();
    expect(tenant?.is_approver).toBe(true);

    const user = await knex('users').where({ username: 'test-am-admin' }).first();
    expect(user).toBeDefined();
    expect(user?.role).toBe('admin');
  });

  it('broker call: tenants.list grąžina sukurtus tenant\'us', async () => {
    const knex = getTestKnex();
    const tenantRow = await knex('tenants').where({ code: 'AM' }).first();
    const userRow = await knex('users').where({ username: 'test-am-admin' }).first();
    if (!tenantRow || !userRow) {
      throw new Error('fixture\'ai negali būti tušti šiame test\'e');
    }

    const tenants = (await broker.call(
      'tenants.list',
      {},
      {
        meta: {
          user: mockAuthUser({
            id: userRow.id as number,
            tenantId: tenantRow.id as number,
          }),
        },
      },
    )) as Tenant[];

    expect(Array.isArray(tenants)).toBe(true);
    expect(tenants.length).toBeGreaterThanOrEqual(1);
    const amTenant = tenants.find((t) => t.code === 'AM');
    expect(amTenant).toBeDefined();
    expect(amTenant?.isApprover).toBe(true);
    expect(amTenant?.name).toBe('Aplinkos ministerija');
  });
});
