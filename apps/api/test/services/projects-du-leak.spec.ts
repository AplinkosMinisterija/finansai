/**
 * Projects DU leak fix tests (Iter 13.x saugumo patch'as, docx §4.4).
 *
 * Kontekstas: Iter 13 `payroll.computeMonth` auto-create'ino „DU expense
 * system" projektą per `ensureDuSystemProject`. Iki saugumo patch'o šis
 * projektas būdavo matomas org_user (specialistui) per:
 *   - `GET /projects` (tenant scope leidžia projektus matyti)
 *   - `GET /projects/:id` (ID egzistuoja per tenant)
 *   - `GET /projects/:id/summary` (DU expense totalai)
 *
 * Šis spec'as verifikuoja, kad PO patch'o:
 *   - DU sistemos projektas turi `isDuSystem=true` flag'ą
 *   - org_user `projects.list` — DU sistemos projektas NEgrąžinamas
 *   - org_user `projects.get` su DU projekto ID → 404
 *   - org_user `projects.summary` su DU projekto ID → 404
 *   - AM admin VIS DAR MATO DU sistemos projektus
 *
 * Test'ai (5):
 *  1. Auto-create DU sistemos projektas turi `isDuSystem=true`
 *  2. AM admin mato DU sistemos projektą per `projects.list`
 *  3. Org user `projects.list` — DU sistemos projektas NEgrąžinamas
 *  4. Org user `projects.get` su DU projekto ID → 404 PROJECT_NOT_FOUND
 *  5. Org user `projects.summary` su DU projekto ID → 404 PROJECT_NOT_FOUND
 */
import type { ServiceBroker } from 'moleculer';
import type {
  FundingSource as FundingSourceDTO,
  Project as ProjectDTO,
  PayrollProfile as PayrollProfileDTO,
} from '@biip-finansai/shared';

import {
  getTestKnex,
  closeTestKnex,
  truncateAll,
  seedBaseFixtures,
  seedOrgTenant,
  seedFvmClassifiers,
  type BaseFixtures,
  type OrgTenantFixtures,
  type FvmClassifierFixtures,
} from '../helpers/db';
import { createTestBroker } from '../helpers/broker';
import { mockAuthUser, mockOrgAdmin, mockOrgUser } from '../helpers/auth';

describe('projects DU leak fix (Iter 13.x, docx §4.4) — SAUGUMO PATCH', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;
  let cls: FvmClassifierFixtures;
  let orgDuSystemProjectId: number;

  beforeAll(async () => {
    broker = await createTestBroker();
  });

  afterAll(async () => {
    if (broker) {
      await broker.stop();
    }
    await closeTestKnex();
  });

  function amAdmin() {
    return mockAuthUser({
      id: base.amAdminUserId,
      tenantId: base.amTenantId,
      tenantIsApprover: true,
      role: 'admin',
    });
  }

  function orgAdmin() {
    return mockOrgAdmin({
      id: org.orgAdminUserId,
      tenantId: org.orgTenantId,
    });
  }

  function orgUser() {
    return mockOrgUser({
      id: org.orgUserId,
      tenantId: org.orgTenantId,
    });
  }

  beforeEach(async () => {
    const knex = getTestKnex();
    await truncateAll(knex);
    base = await seedBaseFixtures(knex);
    org = await seedOrgTenant(knex);
    cls = await seedFvmClassifiers(knex);

    // Org tenant funding source + DU allocation
    const orgFs = (await broker.call(
      'fundingSources.create',
      {
        tenantId: org.orgTenantId,
        pavadinimas: 'AAD VB 2026',
        kodas: 'AAD-VB-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2026,
        metineSuma: '500000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;
    await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: orgFs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.du,
        pavadinimas: 'AAD DU 2026',
        planuotaSuma: '200000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    );

    // Profile org tenant'e
    const orgProfile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: org.orgTenantId,
        vardasPavarde: 'Petras Sensitive',
        pareigos: 'Vyriausiasis specialistas',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '3000.00',
        priedai: '500.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: orgProfile.id,
        fundingSourceId: orgFs.id,
        paskirstymoTipas: 'procentais',
        reiksme: '100',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    );

    // computeMonth — sukuria DU sistemos projektą per tenant
    await broker.call(
      'payroll.computeMonth',
      { month: '2026-03' },
      { meta: { user: amAdmin() } },
    );

    // Sužinom org tenant'o DU sistemos projekto ID per raw DB (auth bypass —
    // matom is_du_system flag'ą tiesiogiai per knex).
    const row = (await knex('projects')
      .where('tenant_id', org.orgTenantId)
      .where('is_du_system', true)
      .first<{ id: number }>('id')) as { id: number } | undefined;
    if (!row) {
      throw new Error(
        'Test fixture: DU sistemos projektas nesukurtas org tenant\'e',
      );
    }
    orgDuSystemProjectId = row.id;
  });

  // -------- TEST 1 --------

  it('1. Auto-create DU sistemos projektas turi isDuSystem=true', async () => {
    // AM admin mato visus projektus, įskaitant DU sistemos.
    const list = (await broker.call(
      'projects.list',
      {},
      { meta: { user: amAdmin() } },
    )) as ProjectDTO[];
    const duSystem = list.find((p) => p.id === orgDuSystemProjectId);
    expect(duSystem).toBeDefined();
    expect(duSystem!.isDuSystem).toBe(true);
    expect(duSystem!.tipas).toBe('veikla');
    expect(duSystem!.pavadinimas).toMatch(/^DU expense system/);
  });

  // -------- TEST 2 --------

  it('2. AM admin mato DU sistemos projektą per projects.list', async () => {
    const list = (await broker.call(
      'projects.list',
      { tenantId: org.orgTenantId },
      { meta: { user: amAdmin() } },
    )) as ProjectDTO[];
    const hasDuSystem = list.some((p) => p.isDuSystem === true);
    expect(hasDuSystem).toBe(true);
  });

  it('2b. Org admin (savo tenant) MATO DU sistemos projektą per projects.list', async () => {
    // Org admin'as TURI matyti DU sistemos projektą savo tenant'e — jis turi
    // teisę į DU duomenis savo organizacijoje.
    const list = (await broker.call(
      'projects.list',
      {},
      { meta: { user: orgAdmin() } },
    )) as ProjectDTO[];
    const hasDuSystem = list.some((p) => p.isDuSystem === true);
    expect(hasDuSystem).toBe(true);
  });

  // -------- TEST 3 — KERN LEAK FIX --------

  it('3. Org user projects.list — DU sistemos projektas NEgrąžinamas', async () => {
    const list = (await broker.call(
      'projects.list',
      {},
      { meta: { user: orgUser() } },
    )) as ProjectDTO[];
    // Nė vienas projektas neturi turėti isDuSystem=true.
    for (const p of list) {
      expect(p.isDuSystem).toBe(false);
    }
    // Org tenant'e tik DU sistemos projektas egzistuoja — be jo sąrašas
    // turi būti tuščias.
    expect(list.length).toBe(0);
  });

  it('3b. Org user projects.list su type=veikla filter — DU sistemos vis tiek NEgrąžinamas', async () => {
    const list = (await broker.call(
      'projects.list',
      { type: 'veikla' },
      { meta: { user: orgUser() } },
    )) as ProjectDTO[];
    expect(list.length).toBe(0);
  });

  // -------- TEST 4 --------

  it('4. Org user projects.get su DU projekto ID → 404 PROJECT_NOT_FOUND', async () => {
    await expect(
      broker.call(
        'projects.get',
        { id: orgDuSystemProjectId },
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({
      code: 404,
      type: 'PROJECT_NOT_FOUND',
    });
  });

  // -------- TEST 5 --------

  it('5. Org user projects.summary su DU projekto ID → 404 PROJECT_NOT_FOUND', async () => {
    await expect(
      broker.call(
        'projects.summary',
        { id: orgDuSystemProjectId },
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({
      code: 404,
      type: 'PROJECT_NOT_FOUND',
    });
  });

  // -------- BONUS: AM admin gali atidaryti DU sistemos projekto detalę --------

  it('6. (sanity) AM admin gali atidaryti DU sistemos projekto detalę + summary', async () => {
    const got = (await broker.call(
      'projects.get',
      { id: orgDuSystemProjectId },
      { meta: { user: amAdmin() } },
    )) as ProjectDTO;
    expect(got.id).toBe(orgDuSystemProjectId);
    expect(got.isDuSystem).toBe(true);

    const summary = (await broker.call(
      'projects.summary',
      { id: orgDuSystemProjectId },
      { meta: { user: amAdmin() } },
    )) as { biudzetas: string; panaudota: string };
    // Biudžetas auto-create'tas su 0.00; panaudota turi būti > 0 (1 DU expense).
    expect(summary.biudzetas).toBe('0.00');
    expect(Number.parseFloat(summary.panaudota)).toBeGreaterThan(0);
  });

  it('7. (sanity) Org admin gali atidaryti savo tenant\'o DU sistemos projekto detalę', async () => {
    const got = (await broker.call(
      'projects.get',
      { id: orgDuSystemProjectId },
      { meta: { user: orgAdmin() } },
    )) as ProjectDTO;
    expect(got.id).toBe(orgDuSystemProjectId);
    expect(got.isDuSystem).toBe(true);
  });
});
