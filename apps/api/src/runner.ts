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
import { initDb, runMigrations, runSeeds, getKnex, closeDb } from './database/db';
import { closeRedis } from './utils/redis';

async function maybeSeed(): Promise<void> {
  // Idempotent seed — jei users lentelė tuščia, paleidžiam.
  const knex = getKnex();
  try {
    const rows = await knex.raw<{ rows: { count: string }[] }>(
      'SELECT COUNT(*)::text AS count FROM users',
    );
    const first = rows.rows[0];
    const count = first ? Number(first.count) : 0;
    if (count === 0) {
      console.log('Users table empty — running seeds');
      await runSeeds();
    } else {
      console.log(`Seeds already complete (${count} users) — skipping`);
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
