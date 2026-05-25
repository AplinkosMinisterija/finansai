/**
 * Issue #9: tvirtinimo grandinės kūrimas (submit) iš konfigūruojamų
 * `approval_levels`.
 *
 * Padengia:
 *  - submit kuria N PENDING žingsnių iš aktyvios grandinės (sortOrder tvarka).
 *  - tuščia grandinė (joks lygis aktyvus) → fallback vienas AM_ADMIN žingsnis.
 *  - be approval_levels grupės → fallback vienas AM_ADMIN žingsnis.
 *
 * Test'ai kviečia broker'į tiesiogiai (be HTTP gateway'aus).
 */
import type { ServiceBroker } from 'moleculer';
import type {
  FinancingRequest as RequestDTO,
  FinancingRequestDetail,
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

interface LevelSeed {
  code: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

const DEFAULT_LEVELS: LevelSeed[] = [
  { code: 'AM_ADMIN', name: 'AM administratorius', sortOrder: 1, active: true },
  { code: 'DEPARTMENT', name: 'Departamentas', sortOrder: 2, active: true },
  { code: 'CHANCELLOR', name: 'Kancleris', sortOrder: 3, active: true },
  { code: 'DIVISION', name: 'Skyrius', sortOrder: 4, active: false },
  { code: 'DBSIS', name: 'DBSIS sistema', sortOrder: 5, active: false },
];

async function seedApprovalLevels(levels: LevelSeed[] = DEFAULT_LEVELS): Promise<void> {
  const knex = getTestKnex();
  const inserted = (await knex('classifier_groups')
    .insert({
      code: 'approval_levels',
      name: 'Aprobacijos lygiai',
      description: 'Test fixture — approval_levels group',
      active: true,
    })
    .returning('id')) as Array<{ id: number }>;
  const groupId = inserted[0]!.id;
  for (const lvl of levels) {
    await knex('classifier_items').insert({
      group_id: groupId,
      parent_id: null,
      code: lvl.code,
      name: lvl.name,
      sort_order: lvl.sortOrder,
      active: lvl.active,
    });
  }
}

describe('requests service — grandinės kūrimas (Issue #9)', () => {
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

  const owner = () =>
    mockOrgUser({
      id: org.orgUserId,
      tenantId: org.orgTenantId,
      tenantCode: 'AAD',
      tenantName: 'Aplinkos apsaugos departamentas',
    });

  async function createDraft(projectName = 'Grandinės testas'): Promise<RequestDTO> {
    return (await broker.call(
      'requests.create',
      { projectName, year: new Date().getFullYear() },
      { meta: { user: owner() } },
    )) as RequestDTO;
  }

  async function submit(id: number): Promise<RequestDTO> {
    return (await broker.call('requests.submit', { id }, { meta: { user: owner() } })) as RequestDTO;
  }

  async function getDetail(id: number): Promise<FinancingRequestDetail> {
    return (await broker.call(
      'requests.get',
      { id },
      { meta: { user: amAdmin() } },
    )) as FinancingRequestDetail;
  }

  it('aktyvi 3-pakopė grandinė → 3 PENDING žingsniai sortOrder tvarka', async () => {
    await seedApprovalLevels();
    const draft = await createDraft();
    await submit(draft.id);
    const detail = await getDetail(draft.id);
    const steps = detail.approvalSteps;
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.levelCode)).toEqual(['AM_ADMIN', 'DEPARTMENT', 'CHANCELLOR']);
    expect(steps.every((s) => s.status === 'PENDING')).toBe(true);
    expect(steps[0]!.levelName).toBe('AM administratorius');
  });

  it('tuščia grandinė (joks lygis aktyvus) → fallback vienas AM_ADMIN žingsnis', async () => {
    await seedApprovalLevels(DEFAULT_LEVELS.map((l) => ({ ...l, active: false })));
    const draft = await createDraft();
    await submit(draft.id);
    const detail = await getDetail(draft.id);
    expect(detail.approvalSteps).toHaveLength(1);
    expect(detail.approvalSteps[0]!.levelCode).toBe('AM_ADMIN');
  });

  it('be approval_levels grupės → fallback vienas AM_ADMIN žingsnis', async () => {
    const draft = await createDraft();
    await submit(draft.id);
    const detail = await getDetail(draft.id);
    expect(detail.approvalSteps).toHaveLength(1);
    expect(detail.approvalSteps[0]!.levelCode).toBe('AM_ADMIN');
  });
});
