/**
 * UAT #42 (PA-008 / PA-009): atsiskaitymų (requestReports) teisės.
 *
 * Tikriname:
 *  - PA-008: AM (tvirtintojas) gali PERSKAITYTI (list) pateiktą atsiskaitymą.
 *  - PA-009: AM NEgali kurti/teikti atsiskaitymo vartotojo vardu (read-only).
 *  - Teikėjas (org user) — gali kurti/teikti savo prašymo atsiskaitymą.
 *
 * Org admin sukuria + submit'ina prašymą per AM admin (on behalf nereikia —
 * naudojam org user sukurtą prašymą), AM admin patvirtina, tada bandom
 * atsiskaitymo CRUD įvairiais vartotojais.
 */
import type { ServiceBroker } from 'moleculer';
import type {
  FinancingRequest as RequestDTO,
  RequestReport as ReportDTO,
} from '@biip-finansai/shared';
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
import { mockAuthUser, mockOrgUser } from '../helpers/auth';

describe('requestReports — UAT #42 teisės (PA-008/PA-009)', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;

  beforeAll(async () => {
    broker = await createTestBroker();
  });

  afterAll(async () => {
    if (broker) await broker.stop();
    await closeTestKnex();
  });

  beforeEach(async () => {
    const knex = getTestKnex();
    await truncateAll(knex);
    base = await seedBaseFixtures(knex);
    org = await seedOrgTenant(knex);
  });

  const amAdmin = () =>
    mockAuthUser({
      id: base.amAdminUserId,
      tenantId: base.amTenantId,
      tenantIsApprover: true,
      role: 'admin',
    });

  const orgUser = () =>
    mockOrgUser({ id: org.orgUserId, tenantId: org.orgTenantId, tenantCode: 'AAD' });

  /** Org user sukuria → submit → AM admin approve → grąžina APPROVED prašymą. */
  async function approvedRequest(): Promise<RequestDTO> {
    const created = (await broker.call(
      'requests.create',
      { projectName: 'Atsiskaitymo testas', year: new Date().getFullYear() },
      { meta: { user: orgUser() } },
    )) as RequestDTO;
    await broker.call('requests.submit', { id: created.id }, { meta: { user: orgUser() } });
    await broker.call(
      'requests.decision',
      { id: created.id, decision: 'approve', grantedAmount: 10000 },
      { meta: { user: amAdmin() } },
    );
    return created;
  }

  it('PA-009: AM admin NEgali sukurti atsiskaitymo → 403 FORBIDDEN', async () => {
    const r = await approvedRequest();
    await expect(
      broker.call(
        'requestReports.upsert',
        { requestId: r.id, periodYear: 2026, periodQuarter: 1, amountUsed: '1000' },
        { meta: { user: amAdmin() } },
      ),
    ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
  });

  it('Teikėjas (org user) gali sukurti atsiskaitymą; AM gali jį perskaityti (PA-008)', async () => {
    const r = await approvedRequest();

    // Teikėjas sukuria + pateikia.
    const report = (await broker.call(
      'requestReports.upsert',
      {
        requestId: r.id,
        periodYear: 2026,
        periodQuarter: 2,
        amountUsed: '2500',
        description: 'Q2 panaudota',
      },
      { meta: { user: orgUser() } },
    )) as ReportDTO;
    expect(report.status).toBe('DRAFT');

    await broker.call('requestReports.submit', { id: report.id }, { meta: { user: orgUser() } });

    // PA-008: AM admin gali PERSKAITYTI pateiktą atsiskaitymą (read-only).
    const listed = (await broker.call(
      'requestReports.list',
      { requestId: r.id },
      { meta: { user: amAdmin() } },
    )) as ReportDTO[];
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe('SUBMITTED');
    expect(listed[0]?.amountUsed).toBe('2500.00');
  });

  it('PA-009: AM admin NEgali pateikti (submit) teikėjo juodraščio → 403', async () => {
    const r = await approvedRequest();
    const report = (await broker.call(
      'requestReports.upsert',
      { requestId: r.id, periodYear: 2026, periodQuarter: 3, amountUsed: '500' },
      { meta: { user: orgUser() } },
    )) as ReportDTO;
    await expect(
      broker.call('requestReports.submit', { id: report.id }, { meta: { user: amAdmin() } }),
    ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
  });
});
