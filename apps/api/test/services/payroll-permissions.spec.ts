/**
 * Payroll permission integration tests (Iter 13, FVM-5).
 *
 * SAUGUMO PRIORITETINĖ specifikacija — DU duomenys griežtai apsaugoti per
 * docx §4.4:
 *  - AM administratorius (visi tenant'ai) ⇒ AKCEPT
 *  - Org admin (savo tenant) ⇒ AKCEPT
 *  - Specialistas / Org user ⇒ VISADA 403, net su `?user_id=mine` ar
 *    tiesioginiu `GET /payroll-profiles/:savo_id`
 *  - Cross-tenant org admin ⇒ 403
 *  - computeMonth ⇒ TIK AM admin (org admin negali)
 *
 * Test'ai (14):
 *  1. AM admin gali listProfiles → 200
 *  2. Org admin savo tenant'e → 200 (mato tik savo)
 *  3. Org admin kito tenant'o profiles → 403 (su tenantId filter)
 *  4. Org user (specialistas) bet kuriam list — 403 (net su userId=savo)
 *  5. Org user GET /payroll-profiles/:other_id — 403
 *  6. Org user GET /payroll-profiles/:own_id — 403 (specialistas savo nemato)
 *  7. Org user POST payroll-profiles — 403
 *  8. Org user PATCH payroll-profiles — 403
 *  9. Org user DELETE payroll-profiles — 403
 *  10. Org user listDistributions — 403
 *  11. Org user POST /payroll/compute — 403
 *  12. Org admin POST /payroll/compute — 403 (TIK AM admin)
 *  13. Cross-tenant: org admin tenantA POST į profile tenantB — 403
 *  14. AM admin computeMonth bet kuriam tenant'ui — 200 (sėkmingai)
 */
import type { ServiceBroker } from 'moleculer';
import type {
  BudgetAllocation as BudgetAllocationDTO,
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

describe('payroll permissions (Iter 13) — SAUGUMO PRIORITETINĖ', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;
  let secondOrg: OrgTenantFixtures;
  let cls: FvmClassifierFixtures;
  let amProfileId: number;
  let orgProfileId: number;
  let secondOrgProfileId: number;
  /** orgUserId savo (paties) payroll profile — used Test 6: specialistas savo nemato. */
  let orgUserOwnProfileId: number;
  let orgFundingSourceId: number;
  let amDuAllocationId: number;

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

    // AM funding source + DU allocation (computeMonth requires this).
    const amFs = (await broker.call(
      'fundingSources.create',
      {
        tenantId: base.amTenantId,
        pavadinimas: 'AM VB 2026',
        kodas: 'AM-VB-2026',
        tipasClassifierItemId: cls.fundingSourceTypeItemIds.biudzetas,
        metai: 2026,
        metineSuma: '2000000.00',
      },
      { meta: { user: amAdmin() } },
    )) as FundingSourceDTO;
    const amAlloc = (await broker.call(
      'budgetAllocations.create',
      {
        fundingSourceId: amFs.id,
        categoryClassifierItemId: cls.budgetCategoryItemIds.du,
        pavadinimas: 'AM DU 2026',
        planuotaSuma: '500000.00',
        metai: 2026,
      },
      { meta: { user: amAdmin() } },
    )) as BudgetAllocationDTO;
    amDuAllocationId = amAlloc.id;

    // Org funding source + DU allocation
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

    // AM profile
    const amProfile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: base.amTenantId,
        vardasPavarde: 'AM Darbuotojas',
        pareigos: 'Vyriausiasis specialistas',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '3000.00',
        priedai: '200.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    amProfileId = amProfile.id;

    // Org profile (1) — savininkų nesusietas
    const orgProfile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: org.orgTenantId,
        vardasPavarde: 'Org Darbuotojas',
        pareigos: 'Vyriausiasis specialistas',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '2500.00',
        priedai: '100.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    orgProfileId = orgProfile.id;

    // Org profile (2) — užregistruotas paties orgUserId (specialistas) savo
    // profile. Test 6 patikrina, kad specialistas savo NEMATO.
    const orgUserProfile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: org.orgTenantId,
        userId: org.orgUserId,
        vardasPavarde: 'Org User Savininkas',
        pareigos: 'Specialistas',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '1800.00',
        priedai: '50.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    orgUserOwnProfileId = orgUserProfile.id;

    // Second org profile
    const secOrgProfile = (await broker.call(
      'payroll.createProfile',
      {
        tenantId: secondOrg.orgTenantId,
        vardasPavarde: 'Sec Org Darbuotojas',
        pareigos: 'Direktorius',
        sutartiesTipas: 'darbo',
        atlyginimasBruto: '4000.00',
        priedai: '0.00',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO;
    secondOrgProfileId = secOrgProfile.id;

    // Org tenant distribution (used Test 10: org user listDistributions → 403)
    await broker.call(
      'payroll.createDistribution',
      {
        payrollProfileId: orgProfileId,
        fundingSourceId: orgFundingSourceId,
        paskirstymoTipas: 'procentais',
        reiksme: '100',
        galiojaNuo: '2026-01-01',
      },
      { meta: { user: amAdmin() } },
    );
  });

  // -------- listProfiles --------

  it('1. AM admin gali listProfiles — 200, mato visus tenant\'ų profile\'us', async () => {
    const list = (await broker.call(
      'payroll.listProfiles',
      {},
      { meta: { user: amAdmin() } },
    )) as PayrollProfileDTO[];
    // AM (1) + Org (2) + secOrg (1) = 4
    expect(list).toHaveLength(4);
    const tenantIds = list.map((p) => p.tenantId).sort();
    expect(tenantIds).toEqual(
      [base.amTenantId, org.orgTenantId, org.orgTenantId, secondOrg.orgTenantId].sort(),
    );
  });

  it('2. Org admin savo tenant\'e — 200, mato tik savo', async () => {
    const list = (await broker.call(
      'payroll.listProfiles',
      {},
      { meta: { user: orgAdmin() } },
    )) as PayrollProfileDTO[];
    // Tik org tenant'o du profile'ai
    expect(list).toHaveLength(2);
    for (const p of list) {
      expect(p.tenantId).toBe(org.orgTenantId);
    }
  });

  it('3. Org admin su kito tenant\'o filter — 403', async () => {
    await expect(
      broker.call(
        'payroll.listProfiles',
        { tenantId: secondOrg.orgTenantId },
        { meta: { user: orgAdmin() } },
      ),
    ).rejects.toMatchObject({ code: 403, type: 'DU_TENANT_FORBIDDEN' });
  });

  it('4. Org user (specialistas) listProfiles be filter — 403', async () => {
    await expect(
      broker.call(
        'payroll.listProfiles',
        {},
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({ code: 403, type: 'DU_FORBIDDEN' });
  });

  it('4b. Org user su user_id=savo (bandymas pamatyti savo) — 403', async () => {
    // Specialistas savo NEMATO net su explicit userId filter.
    await expect(
      broker.call(
        'payroll.listProfiles',
        { userId: org.orgUserId },
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({ code: 403, type: 'DU_FORBIDDEN' });
  });

  // -------- getProfile --------

  it('5. Org user GET /payroll-profiles/:other_id — 403', async () => {
    await expect(
      broker.call(
        'payroll.getProfile',
        { id: orgProfileId },
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({ code: 403, type: 'DU_FORBIDDEN' });
  });

  it('6. Org user GET /payroll-profiles/:savo_id — 403 (specialistas savo nemato)', async () => {
    // Net su tiesioginiu ID į savo profile — 403 (docx §4.4 explicit).
    await expect(
      broker.call(
        'payroll.getProfile',
        { id: orgUserOwnProfileId },
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({ code: 403, type: 'DU_FORBIDDEN' });
  });

  // -------- mutations --------

  it('7. Org user POST payroll-profiles — 403', async () => {
    await expect(
      broker.call(
        'payroll.createProfile',
        {
          tenantId: org.orgTenantId,
          vardasPavarde: 'Test Permission',
          pareigos: 'Test',
          sutartiesTipas: 'darbo',
          atlyginimasBruto: '1000.00',
          galiojaNuo: '2026-01-01',
        },
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({ code: 403, type: 'DU_FORBIDDEN' });
  });

  it('8. Org user PATCH payroll-profiles — 403', async () => {
    await expect(
      broker.call(
        'payroll.updateProfile',
        { id: orgProfileId, pareigos: 'Hacked' },
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({ code: 403, type: 'DU_FORBIDDEN' });
  });

  it('9. Org user DELETE payroll-profiles — 403', async () => {
    await expect(
      broker.call(
        'payroll.deleteProfile',
        { id: orgProfileId },
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({ code: 403, type: 'DU_FORBIDDEN' });
  });

  it('10. Org user listDistributions — 403', async () => {
    await expect(
      broker.call(
        'payroll.listDistributions',
        {},
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({ code: 403, type: 'DU_FORBIDDEN' });
  });

  it('10b. Org user listDistributions su profileId — 403', async () => {
    await expect(
      broker.call(
        'payroll.listDistributions',
        { profileId: orgProfileId },
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({ code: 403, type: 'DU_FORBIDDEN' });
  });

  // -------- computeMonth (TIK AM admin) --------

  it('11. Org user POST /payroll/compute — 403', async () => {
    await expect(
      broker.call(
        'payroll.computeMonth',
        { month: '2026-03' },
        { meta: { user: orgUser() } },
      ),
    ).rejects.toMatchObject({ code: 403, type: 'AM_DU_FORBIDDEN' });
  });

  it('12. Org admin POST /payroll/compute — 403 (TIK AM admin)', async () => {
    // Org admin'as net savo tenant'e negali kviesti — operacija paliečia visus
    // tenant'us, todėl reikia AM privilegijų.
    await expect(
      broker.call(
        'payroll.computeMonth',
        { month: '2026-03' },
        { meta: { user: orgAdmin() } },
      ),
    ).rejects.toMatchObject({ code: 403, type: 'AM_DU_FORBIDDEN' });
  });

  // -------- cross-tenant --------

  it('13a. Cross-tenant: org admin tenantA POST į kito tenant\'o profile — 403', async () => {
    // Org admin (tenant 'org') bando sukurti profile kitos org tenant'e
    await expect(
      broker.call(
        'payroll.createProfile',
        {
          tenantId: secondOrg.orgTenantId,
          vardasPavarde: 'Cross Tenant Hack',
          pareigos: 'Test',
          sutartiesTipas: 'darbo',
          atlyginimasBruto: '1000.00',
          galiojaNuo: '2026-01-01',
        },
        { meta: { user: orgAdmin() } },
      ),
    ).rejects.toMatchObject({ code: 403, type: 'DU_TENANT_FORBIDDEN' });
  });

  it('13b. Cross-tenant: org admin tenantA PATCHina tenantB profile — 403', async () => {
    await expect(
      broker.call(
        'payroll.updateProfile',
        { id: secondOrgProfileId, pareigos: 'Hacked' },
        { meta: { user: orgAdmin() } },
      ),
    ).rejects.toMatchObject({ code: 403, type: 'DU_TENANT_FORBIDDEN' });
  });

  it('13c. Cross-tenant: org admin tenantA GETina tenantB profile — 403', async () => {
    await expect(
      broker.call(
        'payroll.getProfile',
        { id: secondOrgProfileId },
        { meta: { user: orgAdmin() } },
      ),
    ).rejects.toMatchObject({ code: 403, type: 'DU_TENANT_FORBIDDEN' });
  });

  it('13d. Cross-tenant: org admin tenantA DELETEina tenantB profile — 403', async () => {
    await expect(
      broker.call(
        'payroll.deleteProfile',
        { id: secondOrgProfileId },
        { meta: { user: orgAdmin() } },
      ),
    ).rejects.toMatchObject({ code: 403, type: 'DU_TENANT_FORBIDDEN' });
  });

  // -------- AM admin success path --------

  it('14. AM admin computeMonth bet kuriam tenant\'ui — 200 (sėkmingai)', async () => {
    const result = (await broker.call(
      'payroll.computeMonth',
      { month: '2026-03' },
      { meta: { user: amAdmin() } },
    )) as { status: string; month: string };
    expect(result.status).toBe('computed');
    expect(result.month).toBe('2026-03');
  });

  // -------- org admin success — sanity check'as, kad permission gates ne
  //          per griežti --------

  it('15. Org admin sėkmingai gali listDistributions savo tenant\'e', async () => {
    const list = await broker.call(
      'payroll.listDistributions',
      {},
      { meta: { user: orgAdmin() } },
    );
    expect(Array.isArray(list)).toBe(true);
  });

  // Avoid unused warnings.
  void amProfileId;
  void amDuAllocationId;
});
