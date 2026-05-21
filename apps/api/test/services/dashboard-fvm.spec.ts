/**
 * Dashboard service FVM integration tests (Iter 10, FVM-2 / P06).
 *
 * Test scope (3+):
 *  1. `budgetCategoryStats` agreguoja sumas teisingai per kategorijas.
 *  2. Tuščia DB (be jokių prašymų) — `budgetCategoryStats` = [].
 *  3. Prašymai be `budgetCategoryId` (NULL) NE įtraukiami į stats'ą.
 *  4. AM admin (approver) mato visus prašymus agregacijoje.
 *  5. APPROVED prašymo `totalGranted` = `decisionGrantedAmount`; ne-APPROVED — 0.
 */
import type { ServiceBroker } from 'moleculer';
import type {
  BudgetCategoryStats,
  DashboardData,
  FinancingRequest as RequestDTO,
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
import { mockAuthUser } from '../helpers/auth';

describe('dashboard service — FVM budgetCategoryStats (Iter 10)', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;
  let cls: FvmClassifierFixtures;

  beforeAll(async () => {
    broker = await createTestBroker();
  });

  afterAll(async () => {
    if (broker) {
      await broker.stop();
    }
    await closeTestKnex();
  });

  beforeEach(async () => {
    const knex = getTestKnex();
    await truncateAll(knex);
    base = await seedBaseFixtures(knex);
    org = await seedOrgTenant(knex);
    cls = await seedFvmClassifiers(knex);
  });

  const amAdmin = () =>
    mockAuthUser({
      id: base.amAdminUserId,
      tenantId: base.amTenantId,
      tenantIsApprover: true,
      role: 'admin',
    });

  // Helper'is — sukuria DRAFT prašymą per AM admin'ą su nustatomu FVM kategorija.
  async function createRequest(opts: {
    budgetCategoryId?: number | null;
    fundingSourceTypeId?: number | null;
    specProgramFundingType?: 'atskiras' | 'biudzeto_dalis' | null;
    costEquipment?: string;
    costCreation?: string;
    costAnalysis?: string;
    projectName?: string;
  }): Promise<RequestDTO> {
    const params: Record<string, unknown> = {
      tenantId: org.orgTenantId,
      projectName: opts.projectName ?? 'Dashboard FVM test',
      year: new Date().getFullYear(),
    };
    if (opts.budgetCategoryId !== undefined) {
      params['budgetCategoryId'] = opts.budgetCategoryId;
    }
    if (opts.fundingSourceTypeId !== undefined) {
      params['fundingSourceTypeId'] = opts.fundingSourceTypeId;
    }
    if (opts.specProgramFundingType !== undefined) {
      params['specProgramFundingType'] = opts.specProgramFundingType;
    }
    if (opts.costEquipment !== undefined) {
      params['costEquipment'] = opts.costEquipment;
    }
    if (opts.costCreation !== undefined) {
      params['costCreation'] = opts.costCreation;
    }
    if (opts.costAnalysis !== undefined) {
      params['costAnalysis'] = opts.costAnalysis;
    }
    return (await broker.call('requests.create', params, {
      meta: { user: amAdmin() },
    })) as RequestDTO;
  }

  // Helper'is — submitina prašymą ir patvirtina su nustatytu granted amount.
  async function submitAndApprove(
    id: number,
    grantedAmount: number,
  ): Promise<void> {
    await broker.call('requests.submit', { id }, { meta: { user: amAdmin() } });
    await broker.call(
      'requests.decision',
      { id, decision: 'approve', grantedAmount },
      { meta: { user: amAdmin() } },
    );
  }

  async function getDashboard(): Promise<DashboardData> {
    return (await broker.call('dashboard.get', {}, {
      meta: { user: amAdmin() },
    })) as DashboardData;
  }

  describe('Test 1: dashboard.budgetCategoryStats grąžina teisingas sumas', () => {
    it('Sukurti 2 prašymai skirtingose kategorijose — agreguojama atskirai', async () => {
      // Prašymas 1: DU kategorija, costEquipment=10000 (be approve)
      await createRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.du,
        costEquipment: '10000.00',
        projectName: 'DU prašymas',
      });
      // Prašymas 2: spec_programa kategorija, costCreation=25000, approve granted=20000
      const r2 = await createRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.spec_programa,
        specProgramFundingType: 'atskiras',
        costCreation: '25000.00',
        projectName: 'Spec.programa prašymas',
      });
      await submitAndApprove(r2.id, 20000);
      // Prašymas 3: dar viena spec_programa, costCreation=5000 (be approve)
      await createRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.spec_programa,
        specProgramFundingType: 'biudzeto_dalis',
        costCreation: '5000.00',
        projectName: 'Spec.programa #2',
      });

      const data = await getDashboard();
      expect(data.budgetCategoryStats).toBeDefined();
      expect(data.budgetCategoryStats).toHaveLength(2);

      const byCode = new Map<string, BudgetCategoryStats>(
        data.budgetCategoryStats.map((s) => [s.categoryCode, s]),
      );

      const du = byCode.get('du');
      expect(du).toBeDefined();
      expect(du!.categoryItemId).toBe(cls.budgetCategoryItemIds.du);
      expect(du!.categoryName).toBe('Darbo užmokestis');
      expect(du!.count).toBe(1);
      expect(du!.totalRequested).toBe('10000.00');
      expect(du!.totalGranted).toBe('0.00'); // neaprovinta

      const sp = byCode.get('spec_programa');
      expect(sp).toBeDefined();
      expect(sp!.categoryItemId).toBe(cls.budgetCategoryItemIds.spec_programa);
      expect(sp!.categoryName).toBe('Specialioji programa');
      expect(sp!.count).toBe(2);
      // 25000 + 5000 = 30000
      expect(sp!.totalRequested).toBe('30000.00');
      // Tik 1 spec.programa patvirtinta su 20000.
      expect(sp!.totalGranted).toBe('20000.00');
    });
  });

  describe('Test 2: tuščia DB — budgetCategoryStats = []', () => {
    it('Be jokių prašymų grąžinama tuščia agregacija', async () => {
      const data = await getDashboard();
      expect(data.budgetCategoryStats).toBeDefined();
      expect(data.budgetCategoryStats).toEqual([]);
    });
  });

  describe('Test 3: prašymai be budgetCategoryId neįtraukiami', () => {
    it('Tik 1 legacy prašymas (NULL kategorija) — stats lieka tuščias', async () => {
      // Vienintelis prašymas — be FVM laukų.
      await createRequest({
        costEquipment: '5000.00',
        projectName: 'Legacy prašymas (be FVM)',
      });

      const data = await getDashboard();
      expect(data.budgetCategoryStats).toEqual([]);
    });

    it('Mišri DB: 1 prašymas su kategorija + 1 NULL — tik su kategorija įtraukiamas', async () => {
      // Su kategorija
      await createRequest({
        budgetCategoryId: cls.budgetCategoryItemIds.investicijos,
        costEquipment: '15000.00',
        projectName: 'Investicijos prašymas',
      });
      // Be kategorijos (legacy)
      await createRequest({
        costEquipment: '7000.00',
        projectName: 'Legacy be FVM',
      });

      const data = await getDashboard();
      expect(data.budgetCategoryStats).toHaveLength(1);
      const stat = data.budgetCategoryStats[0]!;
      expect(stat.categoryCode).toBe('investicijos');
      expect(stat.count).toBe(1);
      expect(stat.totalRequested).toBe('15000.00');
    });
  });
});
