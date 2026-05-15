/**
 * Dev entry point — manualus broker startup'as dėl tsx watch suderinamumo.
 * Production naudoja moleculer-runner (žr. package.json scripts.start).
 *
 * Inicializacijos eilė:
 *   1) Knex/Objection prijungimas + (opcionaliai) migracijos
 *   2) Moleculer broker'is su visais service'ais
 */
import 'dotenv/config';
import { ServiceBroker } from 'moleculer';
import brokerConfig from './moleculer.config';
import apiService from './services/api.service';
import authService from './services/auth.service';
import tenantsService from './services/tenants.service';
import usersService from './services/users.service';
import requestsService from './services/requests.service';
import { initDb, runMigrations, runSeeds, getKnex, closeDb } from './database/db';
import { closeRedis } from './utils/redis';

async function maybeSeed(): Promise<void> {
  // Idempotent: tikrinam newest seedinamą lentelę — requests. Jei tuščia,
  // paleidžiam seed'ą (truncatina ir įdeda viską iš naujo). Tai dengia ir
  // pirmąjį deploy'ą (tenants/users), ir incrementinį (kai pridėta requests).
  // Jei kažkas jau sukurtų realių prašymų — count > 0, ir seed skipinasi.
  const knex = getKnex();
  try {
    const hasRequests = await knex.schema.hasTable('requests');
    if (hasRequests) {
      const rows = await knex.raw<{ rows: { count: string }[] }>(
        'SELECT COUNT(*)::text AS count FROM requests',
      );
      const count = rows.rows[0] ? Number(rows.rows[0].count) : 0;
      if (count === 0) {
        console.log('Requests table empty — running seeds');
        await runSeeds();
      } else {
        console.log(`Seeds already complete (${count} requests) — skipping`);
      }
      return;
    }
    // Fallback (Iter 0 deploy be requests migracijos)
    const tenantRows = await knex.raw<{ rows: { count: string }[] }>(
      'SELECT COUNT(*)::text AS count FROM tenants',
    );
    const tenantsCount = tenantRows.rows[0] ? Number(tenantRows.rows[0].count) : 0;
    if (tenantsCount === 0) {
      console.log('Tenants table empty (no requests migration yet) — running seeds');
      await runSeeds();
    } else {
      console.log(`Seeds already complete (${tenantsCount} tenants) — skipping`);
    }
  } catch (err) {
    console.log('Seed check failed (table not ready?) — running seeds anyway:', err);
    await runSeeds();
  }
}

async function main(): Promise<void> {
  await initDb();
  if (process.env.AUTO_MIGRATE === 'true') {
    await runMigrations();
  }
  if (process.env.AUTO_SEED === 'true') {
    await maybeSeed();
  }

  const broker = new ServiceBroker(brokerConfig);

  broker.createService(authService);
  broker.createService(tenantsService);
  broker.createService(usersService);
  broker.createService(requestsService);
  broker.createService(apiService);

  await broker.start();

  const shutdown = async (): Promise<void> => {
    await broker.stop();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
