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
import dashboardService from './services/dashboard.service';
import classifiersService from './services/classifiers.service';
import budgetsService from './services/budgets.service';
import fundingSourcesService from './services/fundingSources.service';
import budgetAllocationsService from './services/budgetAllocations.service';
import projectsService from './services/projects.service';
import expensesService from './services/expenses.service';
import requestAttachmentsService from './services/requestAttachments.service';
import requestReportsService from './services/requestReports.service';
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
        return;
      }
      // Antra-fazė check'as: jei pridėta nauja seed-lentelė (approval_steps po
      // issue #9) bet ji tuščia esant senų požymių (>0 prašymų), tai dev seed'as
      // sename DB ir reikia reseed'inti su naujais demo duomenimis.
      const hasApprovalSteps = await knex.schema.hasTable('approval_steps');
      if (hasApprovalSteps) {
        const stepRows = await knex.raw<{ rows: { count: string }[] }>(
          'SELECT COUNT(*)::text AS count FROM approval_steps',
        );
        const stepCount = stepRows.rows[0] ? Number(stepRows.rows[0].count) : 0;
        if (stepCount === 0) {
          console.log(
            `Approval steps empty but ${count} requests exist — re-seeding for new demo data`,
          );
          await runSeeds();
          return;
        }
      }
      console.log(`Seeds already complete (${count} requests) — skipping`);
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
  broker.createService(dashboardService);
  broker.createService(classifiersService);
  broker.createService(budgetsService);
  broker.createService(fundingSourcesService);
  broker.createService(budgetAllocationsService);
  broker.createService(projectsService);
  broker.createService(expensesService);
  broker.createService(requestAttachmentsService);
  broker.createService(requestReportsService);
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
