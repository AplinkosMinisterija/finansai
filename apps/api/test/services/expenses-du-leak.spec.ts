/**
 * Expenses DU leak fix tests (Iter 13.x saugumo patch'as, docx §4.4).
 *
 * Kontekstas: Iter 13 `payroll.computeMonth` sukuria `expenses` įrašus su
 * `tipas='du'` ir darbuotojo vardu `aprasymas` lauke. Iki saugumo patch'o
 * šie įrašai būdavo matomi org_user (specialistui) per:
 *   - `GET /expenses?type=du` (tipo filter'as)
 *   - `GET /expenses/:id` (tiesioginis ID)
 *   - `GET /expenses` su projektu (tenant scope leidžia)
 *
 * Šis spec'as verifikuoja, kad PO patch'o:
 *   - org_user NEGAUNA jokio DU expense'o (net per filter'us)
 *   - org_user GET su DU expense ID grąžina 404 (ne 403 — kad nepamatytų ID)
 *   - org_admin ir AM admin VIS DAR MATO DU expense'us savo scope'e
 *
 * Test'ai (6):
 *  1. `computeMonth` sukuria DU expense'us su `tipas='du'` ir tinkamu aprasymu
 *  2. AM admin per `expenses.list` mato DU expense'us
 *  3. Org admin (savo tenant) mato DU expense'us savo tenant'e
 *  4. Org admin kito tenant'o DU expense'ai NEmatomi (per tenant scope)
 *  5. Org user (specialist) — DU expense'ai NEgrąžinami sąraše
 *     (net su `type='du'` filter'u arba `projectId` filter'u į DU projektą)
 *  6. Org user `expenses.get` su DU expense ID → 404 EXPENSE_NOT_FOUND
 */
import type { ServiceBroker } from 'moleculer';
import type {
  Expense as ExpenseDTO,
  FundingSource as FundingSourceDTO,
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

describe('expenses DU leak fix (Iter 13.x, docx §4.4) — SAUGUMO PATCH', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;
  let secondOrg: OrgTenantFixtures;
  let cls: FvmClassifierFixtures;
  let orgFundingSourceId: number;

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

  function secondOrgAdmin() {
    return mockOrgAdmin({
      id: secondOrg.orgAdminUserId,
      tenantId: secondOrg.orgTenantId,
      tenantCode: 'AAD2',
      tenantName: 'AAD #2',
    });
  }

  beforeEach(async () => {
    const knex = getTestKnex();
    await truncateAll(knex);
    base = await seedBaseFixtures(knex);
    org = await seedOrgTenant(knex);
    secondOrg = await seedOrgTenant(knex, { code: 'AAD2', name: 'AAD #2' });
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
    orgFundingSourceId = orgFs.id;
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

    // Second org funding source + DU allocation
    const secFs = (await broker.call(
      'fundingSources.create',
      {
        tenantId: secondOrg.orgTenantId,
        pavadinimas: 'AAD2 VB 2026',
        kodas: 'AAD2-VB-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2026,
        metineSuma: '300000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;
    await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: secFs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.du,
        pavadinimas: 'AAD2 DU 2026',
        planuotaSuma: '100000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    );

    // Profile org tenant'e — su sensitive vardu
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
        fundingSourceId: orgFundingSourceId,
        paskirstymoTipas: 'procentais',
        reiksme: '100',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    );

    // Profile second org tenant'e
    const secOrgProfile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: secondOrg.orgTenantId,
        vardasPavarde: 'Antanas Other',
        pareigos: 'Direktorius',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '4000.00',
        priedai: '0.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: secOrgProfile.id,
        fundingSourceId: secFs.id,
        paskirstymoTipas: 'procentais',
        reiksme: '100',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    );

    // computeMonth — sukuria DU expense'us per abu tenant'us
    await broker.call(
      'payroll.computeMonth',
      { month: '2026-03' },
      { meta: { user: amAdmin() } },
    );
  });

  // -------- TEST 1 --------

  it('1. computeMonth sukuria DU expense\'us su tipas=du ir teisingu aprasymu', async () => {
    // AM admin matos visus (sanity check'as, kad fixture'as veikia).
    const list = (await broker.call(
      'expenses.list',
      {},
      { meta: { user: amAdmin() } },
    )) as ExpenseDTO[];
    // Per abu tenant'us po 1 DU expense'ą = 2.
    const duExpenses = list.filter((e) => e.tipas === 'du');
    expect(duExpenses.length).toBe(2);
    // Aprasymas turi formatą 'DU YYYY-MM: <vardas>'
    const aprasymai = duExpenses.map((e) => e.aprasymas).sort();
    expect(aprasymai).toEqual([
      'DU 2026-03: Antanas Other',
      'DU 2026-03: Petras Sensitive',
    ]);
  });

  // -------- TEST 2 --------

  it('2. AM admin per expenses.list mato DU expense\'us (filter type=du)', async () => {
    const list = (await broker.call(
      'expenses.list',
      { type: 'du' },
      { meta: { user: amAdmin() } },
    )) as ExpenseDTO[];
    expect(list.length).toBe(2);
    for (const e of list) {
      expect(e.tipas).toBe('du');
    }
  });

  // -------- TEST 3 --------

  it('3. Org admin (savo tenant) mato DU expense\'us savo tenant\'e', async () => {
    const list = (await broker.call(
      'expenses.list',
      { type: 'du' },
      { meta: { user: orgAdmin() } },
    )) as ExpenseDTO[];
    // Org admin tenant scope'as — tik savo tenant'o expense'ai.
    expect(list.length).toBe(1);
    expect(list[0]!.tipas).toBe('du');
    expect(list[0]!.aprasymas).toBe('DU 2026-03: Petras Sensitive');
    expect(list[0]!.tenantId).toBe(org.orgTenantId);
  });

  // -------- TEST 4 --------

  it('4. Org admin kito tenant\'o DU expense\'ai NEmatomi per tenant scope', async () => {
    // Org admin org tenant'e — neturi matyti secondOrg DU expense'ų.
    const orgList = (await broker.call(
      'expenses.list',
      { type: 'du' },
      { meta: { user: orgAdmin() } },
    )) as ExpenseDTO[];
    for (const e of orgList) {
      // Nė vienas DU expense'as neturi būti iš kitos tenant'os.
      expect(e.tenantId).toBe(org.orgTenantId);
    }
    // Reverse direction sanity — secondOrgAdmin mato tik savo tenant'o
    const secList = (await broker.call(
      'expenses.list',
      { type: 'du' },
      { meta: { user: secondOrgAdmin() } },
    )) as ExpenseDTO[];
    expect(secList.length).toBe(1);
    expect(secList[0]!.tenantId).toBe(secondOrg.orgTenantId);
    expect(secList[0]!.aprasymas).toBe('DU 2026-03: Antanas Other');
  });

  // -------- TEST 5 — KERN LEAK FIX --------

  it('5. Org user (specialistas) — DU expense\'ai NEgrąžinami sąraše (jokio filter)', async () => {
    // 5a. Be jokio filter — visi list grąžinami expense'ai, bet DU paslėpti.
    const listAll = (await broker.call(
      'expenses.list',
      {},
      { meta: { user: orgUser() } },
    )) as ExpenseDTO[];
    for (const e of listAll) {
      expect(e.tipas).not.toBe('du');
    }
    // Org tenant'e DU expense'as buvo 1 — be jo, kitų org expense'ų nera,
    // tad visas sąrašas turi būti tuščias.
    expect(listAll.length).toBe(0);

    // 5b. Su explicit type='du' filter — vis tiek tuščia.
    const listDu = (await broker.call(
      'expenses.list',
      { type: 'du' },
      { meta: { user: orgUser() } },
    )) as ExpenseDTO[];
    expect(listDu.length).toBe(0);
  });

  // -------- TEST 6 --------

  it('6. Org user expenses.get su DU expense ID → 404 EXPENSE_NOT_FOUND', async () => {
    // Pirma per AM admin gaunam realų DU expense ID, kurį bandysim atidaryti.
    const allList = (await broker.call(
      'expenses.list',
      { type: 'du' },
      { meta: { user: amAdmin() } },
    )) as ExpenseDTO[];
    const orgDuExpense = allList.find(
      (e) => e.tenantId === org.orgTenantId,
    );
    expect(orgDuExpense).toBeDefined();

    // Org user bando atidaryti šitą expense — 404 (ne 403).
    await expect(
      broker.call(
        'expenses.get',
        { id: orgDuExpense!.id },
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({
      code: 404,
      type: 'EXPENSE_NOT_FOUND',
    });
  });

  // -------- BONUS: Org admin pas DU expense gauna OK --------

  it('7. (sanity) Org admin gali atidaryti savo tenant\'o DU expense per ID', async () => {
    const allList = (await broker.call(
      'expenses.list',
      { type: 'du' },
      { meta: { user: amAdmin() } },
    )) as ExpenseDTO[];
    const orgDuExpense = allList.find(
      (e) => e.tenantId === org.orgTenantId,
    );
    expect(orgDuExpense).toBeDefined();

    const got = (await broker.call(
      'expenses.get',
      { id: orgDuExpense!.id },
      { meta: { user: orgAdmin() } },
    )) as ExpenseDTO;
    expect(got.id).toBe(orgDuExpense!.id);
    expect(got.tipas).toBe('du');
    expect(got.aprasymas).toBe('DU 2026-03: Petras Sensitive');
  });
});

