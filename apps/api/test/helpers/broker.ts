/**
 * Test broker factory.
 *
 * Sukuria Moleculer ServiceBroker'į testams su tyliu loggeriu ir registruoja
 * paprašytus servisus. PAGAL DEFAULT — visus servisus (auth, tenants, users,
 * requests, dashboard, classifiers, budgets, requestAttachments, requestReports).
 * `api.service` (HTTP gateway) NEREGISTRUOJAMAS — testuose broker call'inam
 * tiesiogiai (`broker.call('foo.bar', params, { meta })`), o ne per HTTP.
 *
 * Naudoti:
 *   ```ts
 *   const broker = await createTestBroker();
 *   try {
 *     const result = await broker.call('tenants.list', {}, {
 *       meta: { user: mockAuthUser() },
 *     });
 *     expect(result).toEqual(...);
 *   } finally {
 *     await broker.stop();
 *   }
 *   ```
 *
 * `services` opcija — pasirinkti subset'ą jei testas pikus servisus
 * tik tikrina.
 */
import { ServiceBroker, type ServiceSchema, type LogLevels } from 'moleculer';
import authService from '../../src/services/auth.service';
import tenantsService from '../../src/services/tenants.service';
import usersService from '../../src/services/users.service';
import requestsService from '../../src/services/requests.service';
import dashboardService from '../../src/services/dashboard.service';
import classifiersService from '../../src/services/classifiers.service';
import budgetsService from '../../src/services/budgets.service';
import fundingSourcesService from '../../src/services/fundingSources.service';
import budgetAllocationsService from '../../src/services/budgetAllocations.service';
import projectsService from '../../src/services/projects.service';
import requestAttachmentsService from '../../src/services/requestAttachments.service';
import requestReportsService from '../../src/services/requestReports.service';
import { getTestKnex } from './db';

/** Visi servisai pagal nutylėjimą — be `api.service` (HTTP gateway). */
export const ALL_SERVICES: readonly ServiceSchema[] = [
  authService,
  tenantsService,
  usersService,
  requestsService,
  dashboardService,
  classifiersService,
  budgetsService,
  fundingSourcesService,
  budgetAllocationsService,
  projectsService,
  requestAttachmentsService,
  requestReportsService,
];

export interface CreateTestBrokerOpts {
  /**
   * Jei nurodyta — registruojami tik šie servisai. Naudinga sumažinti
   * startup ir izoliuoti test'us. Default — `ALL_SERVICES`.
   */
  services?: readonly ServiceSchema[];

  /**
   * Ar prijungti DB (`getTestKnex()` + Objection global'ą). Default `true`.
   * `false` naudoti tik tada, kai testas nepaliečia DB.
   */
  withDb?: boolean;
}

/**
 * Sukuria broker'į ir `await broker.start()` — grąžina paleistą instance'ą.
 * Test'as turi pats kviesti `await broker.stop()` (paprastai `afterAll`'e).
 */
export async function createTestBroker(
  opts: CreateTestBrokerOpts = {},
): Promise<ServiceBroker> {
  if (opts.withDb !== false) {
    // Užtikrina, kad knex + Objection prijungta prieš service.start'us
    // (kai kurie service'ai gali query'inti DB starto metu).
    getTestKnex();
  }

  const validLogLevels: readonly LogLevels[] = [
    'fatal',
    'error',
    'warn',
    'info',
    'debug',
    'trace',
  ];
  const rawLogLevel = process.env['LOGLEVEL'];
  const logLevel: LogLevels =
    rawLogLevel && (validLogLevels as readonly string[]).includes(rawLogLevel)
      ? (rawLogLevel as LogLevels)
      : 'error';

  const broker = new ServiceBroker({
    namespace: 'finansai-test',
    nodeID: `test-${process.pid}`,
    // Default'as testuose — tylus. Jei reikia debug'inti — `LOGLEVEL=info yarn test`.
    logger: {
      type: 'Console',
      options: {
        level: logLevel,
        colors: false,
        moduleColors: false,
        formatter: 'short',
        objectPrinter: null,
        autoPadding: false,
      },
    },
    logLevel,
    transporter: null,
    serializer: 'JSON',
    requestTimeout: 10 * 1000,
    retryPolicy: { enabled: false, retries: 0, delay: 100, maxDelay: 1000, factor: 2 },
    maxCallLevel: 100,
    heartbeatInterval: 10,
    heartbeatTimeout: 30,
    contextParamsCloning: false,
    tracking: { enabled: false, shutdownTimeout: 1000 },
    disableBalancer: false,
    registry: { strategy: 'RoundRobin', preferLocal: true },
    circuitBreaker: { enabled: false, threshold: 0.5, minRequestCount: 20, windowTime: 60, halfOpenTime: 10 * 1000 },
    bulkhead: { enabled: false, concurrency: 10, maxQueueSize: 100 },
    validator: true,
    metrics: { enabled: false },
    tracing: { enabled: false },
    middlewares: [],
    replCommands: null,
  });

  const services = opts.services ?? ALL_SERVICES;
  for (const svc of services) {
    broker.createService(svc);
  }

  await broker.start();
  return broker;
}
