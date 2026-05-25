/**
 * DU agregatinis leak fix tests (Iter 13.x re-re-audit, docx §4.4).
 *
 * Kontekstas: po Iter 13D fix'o (`expenses.list`, `expenses.get`,
 * `projects.list`, `projects.get`, `projects.summary` paslėpti nuo
 * org_user'io), Security Reviewer'is rado, kad DU sumos LEAK'ina per
 * AGREGUOTUS endpoint'us:
 *   1. `expenses.budgetSummary` — SUM(suma) per DU allocation be filter'o
 *   2. `budgetAllocations.summary` — tas pats per direktinį route
 *   3. `budgetAllocations.list` — DU allocations matomi org_user + cross-tenant
 *   4. `fundingSources.list` — cross-tenant sources matomi (S15.C)
 *   5. `projects.summary` — edge case DU expense ne-DU projektui
 *
 * Šis spec'as verifikuoja, kad PO patch'o:
 *   - org_user NEPAMATO DU sumų per JOKIUS agreguotus endpoint'us
 *   - org_user NEPAMATO cross-tenant duomenų per list'us
 *   - AM admin vis dar mato VISKĄ (visi tenant'ai, visi DU)
 *   - org_admin (savo tenant) mato savo DU duomenis (turi DU access)
 *
 * Test'ai:
 *   1. org_user `expenses.budgetSummary` — DU allocation NEgrąžinama
 *   2. org_user `budgetAllocations.summary` su DU ID → 404
 *   3. org_user `budgetAllocations.list` — DU allocations NEmatomi
 *   4. org_user `budgetAllocations.list` — cross-tenant NEmatomi
 *   5. org_user `fundingSources.list` — cross-tenant NEmatomi
 *   6. AM admin VIS TIEK mato viską per visus 3 endpoint'us
 *   7. org_admin (savo tenant) mato savo DU allocations + summary
 *   8. (edge) projects.summary ne-DU projektui su DU expense — DU NE įskaitomas
 */
import type { ServiceBroker } from 'moleculer';
import type {
  BudgetAllocation as BudgetAllocationDTO,
  BudgetAllocationSummary,
  BudgetWarningsResponse,
  FundingSource as FundingSourceDTO,
  PayrollProfile as PayrollProfileDTO,
  Project as ProjectDTO,
  ProjectSummary,
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

describe('DU agregatinis leak fix (Iter 13.x, docx §4.4) — SAUGUMO PATCH', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;
  let secondOrg: OrgTenantFixtures;
  let cls: FvmClassifierFixtures;
  let orgFundingSourceId: number;
  let orgDuAllocationId: number;
  let orgPrekesAllocationId: number;
  let orgNonDuProjectId: number;

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
    secondOrg = await seedOrgTenant(knex, { code: 'AAD2', name: 'AAD #2' });
    cls = await seedFvmClassifiers(knex);

    // Org tenant'as: funding source + DU allocation + Prekės allocation
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
    const duAlloc = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: orgFs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.du,
        pavadinimas: 'AAD DU 2026',
        planuotaSuma: '200000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;
    orgDuAllocationId = duAlloc.id;
    const ppAlloc = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: orgFs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.prekes_paslaugos,
        pavadinimas: 'AAD Prekės 2026',
        planuotaSuma: '100000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;
    orgPrekesAllocationId = ppAlloc.id;

    // Org tenant'o ne-DU projektas
    const orgProj = (await broker.call(
      'projects.create',
      {
        tenantId: org.orgTenantId,
        budgetAllocationId: ppAlloc.id,
        atsakingasUserId: org.orgAdminUserId,
        pavadinimas: 'AAD projektas A',
        tipas: 'projektas',
        biudzetas: '50000.00',
      },
      { meta: { user: amAdmin() } },
    )) as ProjectDTO;
    orgNonDuProjectId = orgProj.id;

    // Org tenant'o paprastas (ne-DU) expense
    await broker.call(
      'expenses.create',
      {
        projectId: orgProj.id,
        budgetAllocationId: ppAlloc.id,
        tipas: 'saskaita',
        suma: '5000.00',
        data: '2026-03-15',
      },
      { meta: { user: orgAdmin() } },
    );

    // Second org tenant'as: funding source + DU allocation (cross-tenant
    // testavimui — org_user NETURI matyti šito tenant'o duomenų)
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
        planuotaSuma: '150000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    );
    await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: secFs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.prekes_paslaugos,
        pavadinimas: 'AAD2 Prekės 2026',
        planuotaSuma: '80000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    );

    // Sukuriam DU profile + distribution + computeMonth, kad atsirastų
    // realūs DU expense'ai org tenant'e.
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
    await broker.call('payroll.computeMonth', { month: '2026-03' }, { meta: { user: amAdmin() } });
  });

  // -------- TEST 1: expenses.budgetSummary --------

  it('1. org_user expenses.budgetSummary — DU allocation NEgrąžinama (planuota+faktinė paslėpta)', async () => {
    const resp = (await broker.call(
      'expenses.budgetSummary',
      { year: 2026 },
      { meta: { user: orgUser() } },
    )) as BudgetWarningsResponse;
    // Tenant scope filter'as: org_user mato tik savo tenant'ą.
    // DU filter'as: DU allocation NE rodoma. Liko tik Prekės allocation.
    for (const item of resp.items) {
      expect(item.allocationId).not.toBe(orgDuAllocationId);
    }
    // Patikrinam, kad Prekės allocation rodomas su teisinga faktine.
    const prekes = resp.items.find((i) => i.allocationId === orgPrekesAllocationId);
    expect(prekes).toBeDefined();
    expect(prekes!.planuota).toBe('100000.00');
    expect(prekes!.faktine).toBe('5000.00');
  });

  it("1b. org_user expenses.budgetSummary — DU pavadinimas neLEAK'ina", async () => {
    const resp = (await broker.call(
      'expenses.budgetSummary',
      { year: 2026 },
      { meta: { user: orgUser() } },
    )) as BudgetWarningsResponse;
    // Nė vienam item'e neturi būti „DU" pavadinime (visi DU allocations
    // paslėpti).
    for (const item of resp.items) {
      expect(item.allocationName.toLowerCase()).not.toContain('du');
    }
  });

  // -------- TEST 2: budgetAllocations.summary --------

  it('2. org_user budgetAllocations.summary su DU allocation ID → 404', async () => {
    await expect(
      broker.call(
        'budgetAllocations.summary',
        { id: orgDuAllocationId },
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({
      code: 404,
      type: 'BUDGET_ALLOCATION_NOT_FOUND',
    });
  });

  it('2b. org_user budgetAllocations.get su DU allocation ID → 404', async () => {
    await expect(
      broker.call(
        'budgetAllocations.get',
        { id: orgDuAllocationId },
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({
      code: 404,
      type: 'BUDGET_ALLOCATION_NOT_FOUND',
    });
  });

  // -------- TEST 3: budgetAllocations.list — DU + tenant scope --------

  it('3. org_user budgetAllocations.list — DU allocations NEmatomi', async () => {
    const list = (await broker.call(
      'budgetAllocations.list',
      {},
      { meta: { user: orgUser() } },
    )) as BudgetAllocationDTO[];
    // Nė vienas allocation neturi būti DU kategorijos.
    for (const a of list) {
      expect(a.categoryCode).not.toBe('du');
    }
    // Org tenant'e 2 allocations sukurta: DU + Prekės. Be DU — lieka 1.
    expect(list).toHaveLength(1);
    expect(list[0]!.categoryCode).toBe('prekes_paslaugos');
  });

  it('3b. org_user budgetAllocations.list su categoryItemId=du filter — vis tiek tuščia', async () => {
    const list = (await broker.call(
      'budgetAllocations.list',
      { categoryItemId: cls.budgetCategoryItemIds.du },
      { meta: { user: orgUser() } },
    )) as BudgetAllocationDTO[];
    expect(list).toHaveLength(0);
  });

  // -------- TEST 4: budgetAllocations.list — cross-tenant --------

  it('4. org_user budgetAllocations.list — cross-tenant allocations NEmatomi', async () => {
    const list = (await broker.call(
      'budgetAllocations.list',
      {},
      { meta: { user: orgUser() } },
    )) as BudgetAllocationDTO[];
    // Visi grąžinti allocations turi būti TIK iš org tenant'o funding
    // source'o (per fundingSourceId arba per fundingSourceCode prefix).
    for (const a of list) {
      expect(a.fundingSourceId).toBe(orgFundingSourceId);
    }
  });

  // -------- TEST 5: fundingSources.list — cross-tenant --------

  it('5. org_user fundingSources.list — cross-tenant sources NEmatomi', async () => {
    const list = (await broker.call(
      'fundingSources.list',
      {},
      { meta: { user: orgUser() } },
    )) as FundingSourceDTO[];
    // org_user turi matyti TIK savo tenant'o source (kodas 'AAD-VB-2026').
    expect(list).toHaveLength(1);
    expect(list[0]!.tenantId).toBe(org.orgTenantId);
    expect(list[0]!.kodas).toBe('AAD-VB-2026');
  });

  // -------- TEST 6: AM admin mato viską --------

  it("6. AM admin VIS TIEK mato viską per visus 3 endpoint'us", async () => {
    // 6a. expenses.budgetSummary — visi tenant'ai, visos kategorijos
    const summary = (await broker.call(
      'expenses.budgetSummary',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as BudgetWarningsResponse;
    // 4 allocations sukurta: org DU + org Prekės + sec DU + sec Prekės.
    // Galimas papildomas DU-system allocation jei computeMonth jį sukūrė.
    // Tikrinam, kad bent 2 DU allocations matosi.
    const duAllocations = summary.items.filter((i) =>
      i.allocationName.toLowerCase().includes('du'),
    );
    expect(duAllocations.length).toBeGreaterThanOrEqual(2);

    // 6b. budgetAllocations.summary su DU allocation ID — grąžinama (ne 404)
    const duSum = (await broker.call(
      'budgetAllocations.summary',
      { id: orgDuAllocationId },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationSummary;
    expect(duSum.planuota).toBe('200000.00');
    expect(Number.parseFloat(duSum.faktine)).toBeGreaterThan(0);

    // 6c. budgetAllocations.list — visus tenant'us
    const allList = (await broker.call(
      'budgetAllocations.list',
      {},
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO[];
    // Visi sukurti allocations matomi (org: DU + Prekės; sec: DU + Prekės).
    const hasOrgDu = allList.some((a) => a.id === orgDuAllocationId);
    expect(hasOrgDu).toBe(true);

    // 6d. fundingSources.list — visus tenant'us
    const fsList = (await broker.call(
      'fundingSources.list',
      {},
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO[];
    // Mažiausiai 2 — org + secondOrg.
    expect(fsList.length).toBeGreaterThanOrEqual(2);
  });

  // -------- TEST 7: org_admin (savo tenant) mato savo DU --------

  it('7. org_admin (savo tenant) MATO savo DU allocations + summary', async () => {
    // 7a. budgetAllocations.list — DU allocation matomas
    const list = (await broker.call(
      'budgetAllocations.list',
      {},
      { meta: { user: orgAdmin() } },
    )) as BudgetAllocationDTO[];
    const hasDu = list.some((a) => a.categoryCode === 'du');
    expect(hasDu).toBe(true);

    // 7b. budgetAllocations.summary su DU allocation ID — grąžinama
    const sum = (await broker.call(
      'budgetAllocations.summary',
      { id: orgDuAllocationId },
      { meta: { user: orgAdmin() } },
    )) as BudgetAllocationSummary;
    expect(sum.planuota).toBe('200000.00');
    expect(Number.parseFloat(sum.faktine)).toBeGreaterThan(0);

    // 7c. expenses.budgetSummary — DU allocation matomas
    const budgetSum = (await broker.call(
      'expenses.budgetSummary',
      { year: 2026 },
      { meta: { user: orgAdmin() } },
    )) as BudgetWarningsResponse;
    const orgDuItem = budgetSum.items.find((i) => i.allocationId === orgDuAllocationId);
    expect(orgDuItem).toBeDefined();
    expect(orgDuItem!.planuota).toBe('200000.00');

    // 7d. org_admin NEturi matyti CROSS-TENANT (secondOrg) — net jei turi
    //     DU access, tenant scope vis tiek riboja.
    for (const a of list) {
      expect(a.fundingSourceId).toBe(orgFundingSourceId);
    }
  });

  it('7b. org_admin (savo tenant) fundingSources.list — savo tenant matomas, cross-tenant ne', async () => {
    const list = (await broker.call(
      'fundingSources.list',
      {},
      { meta: { user: orgAdmin() } },
    )) as FundingSourceDTO[];
    expect(list).toHaveLength(1);
    expect(list[0]!.tenantId).toBe(org.orgTenantId);
  });

  // -------- TEST 8: projects.summary edge case --------

  it('8. (edge) org_user projects.summary ne-DU projektui su DU expense — DU NEįskaitomas', async () => {
    // Setup: AM admin sukuria DU expense'ą paprastame (ne-DU-system)
    // projekte. Tipiškai to neturėtų atsitikti — DU expense'ai eina į
    // dedicated DU-system projektą. Bet defense-in-depth: net jei kažkur
    // atsidurtų DU expense ne-DU projekte, org_user NEturi matyti.
    await broker.call(
      'expenses.create',
      {
        projectId: orgNonDuProjectId,
        budgetAllocationId: orgDuAllocationId,
        tipas: 'du',
        suma: '7777.00',
        data: '2026-03-20',
        aprasymas: "DU leak — shouldn't be aggregated for org_user",
      },
      { meta: { user: orgAdmin() } },
    );

    // org_user projects.summary — DU expense (7777) NEįskaitomas, lieka
    // tik paprastas saskaita expense (5000).
    const summary = (await broker.call(
      'projects.summary',
      { id: orgNonDuProjectId },
      { meta: { user: orgUser() } },
    )) as ProjectSummary;
    expect(summary.biudzetas).toBe('50000.00');
    expect(summary.panaudota).toBe('5000.00');

    // AM admin VIS TIEK mato visus 12777 (5000 + 7777)
    const amSummary = (await broker.call(
      'projects.summary',
      { id: orgNonDuProjectId },
      { meta: { user: amAdmin() } },
    )) as ProjectSummary;
    expect(amSummary.panaudota).toBe('12777.00');
  });

  // -------- TEST 9: defense-in-depth expenses.budgetSummary --------

  it("9. (defense-in-depth) DU expense ne-DU allocation'e — org_user NEįskaito SUM", async () => {
    // Sukuriam DU expense'ą Prekės allocation'e (klaidingas data). org_user
    // budgetSummary turi pamatyti Prekės allocation, bet DU expense'as ten
    // NEpapuls į faktinę sumą.
    await broker.call(
      'expenses.create',
      {
        projectId: orgNonDuProjectId,
        budgetAllocationId: orgPrekesAllocationId,
        tipas: 'du',
        suma: '999.00',
        data: '2026-03-25',
        aprasymas: 'DU expense in Prekės allocation — should be hidden',
      },
      { meta: { user: orgAdmin() } },
    );

    const resp = (await broker.call(
      'expenses.budgetSummary',
      { year: 2026 },
      { meta: { user: orgUser() } },
    )) as BudgetWarningsResponse;
    const prekes = resp.items.find((i) => i.allocationId === orgPrekesAllocationId);
    expect(prekes).toBeDefined();
    // Tik 5000 nuo saskaita expense'o; DU 999 paslėptas net jei jis
    // priskirtas Prekės allocation'ui.
    expect(prekes!.faktine).toBe('5000.00');

    // AM admin SUM = 5000 + 999 = 5999.
    const amResp = (await broker.call(
      'expenses.budgetSummary',
      { year: 2026 },
      { meta: { user: amAdmin() } },
    )) as BudgetWarningsResponse;
    const amPrekes = amResp.items.find((i) => i.allocationId === orgPrekesAllocationId);
    expect(amPrekes!.faktine).toBe('5999.00');
  });
});
