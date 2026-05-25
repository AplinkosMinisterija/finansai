/**
 * Issue #9: daugiapakopio workflow per-žingsnį sprendimo teisė.
 *
 * Padengia:
 *  - canDecideStep: vartotojas su lygiu gali tvirtinti tik kai jo eilė;
 *    be lygio — 403; AM admin (super-approver) — gali bet kurį.
 *  - daugiapakopis advance: approve ne paskutinį → SUBMITTED + kitas PENDING;
 *    approve paskutinį → APPROVED + sprendimo metaduomenys.
 *  - grąžinti vidury → RETURNED (teikėjui); resubmit → nauja iteracija.
 *  - atmesti vidury → REJECTED.
 *  - backward compat: legacy 1-žingsnio prašymą AM admin sprendžia be lygio.
 *
 * Grandinės kūrimas (submit) — atskiras spec'as requests-workflow-chain.spec.ts.
 *
 * Test'ai kviečia broker'į tiesiogiai (be HTTP gateway'aus).
 */
import type { ServiceBroker } from 'moleculer';
import type { FinancingRequest as RequestDTO, FinancingRequestDetail } from '@biip-finansai/shared';
import bcrypt from 'bcryptjs';
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

/**
 * Įdeda realų AM tvirtintoją (role=user) su nurodytais aprobacijos lygiais ir
 * grąžina jo DB id. Reikia realaus user'io, nes `approval_steps.decided_by_user_id`
 * turi FK į users.
 */
async function insertAmUser(tenantId: number, username: string, levels: string[]): Promise<number> {
  const knex = getTestKnex();
  const passwordHash = await bcrypt.hash('test', 10);
  const rows = (await knex('users')
    .insert({
      username,
      password_hash: passwordHash,
      full_name: username,
      email: `${username}@am.lt`,
      role: 'user',
      tenant_id: tenantId,
      am_scope_org_ids: null,
      approval_level_codes: levels,
      active: true,
    })
    .returning('id')) as Array<{ id: number }>;
  return rows[0]!.id;
}

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

/** Įdeda `approval_levels` grupę su nurodytais lygiais (active flag'ais). */
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

describe('requests service — daugiapakopis workflow (Issue #9)', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;
  // Realūs AM tvirtintojai (role=user) su lygiais — DB id'ai (FK approval_steps).
  let levelUserIds: Record<string, number>;

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
    levelUserIds = {
      AM_ADMIN: await insertAmUser(base.amTenantId, 'am-lvl-admin', ['AM_ADMIN']),
      DEPARTMENT: await insertAmUser(base.amTenantId, 'am-lvl-dep', ['DEPARTMENT']),
      CHANCELLOR: await insertAmUser(base.amTenantId, 'am-lvl-chan', ['CHANCELLOR']),
      NONE: await insertAmUser(base.amTenantId, 'am-lvl-none', []),
    };
  });

  // ── Auth helper'iai ──
  const amAdmin = () =>
    mockAuthUser({
      id: base.amAdminUserId,
      tenantId: base.amTenantId,
      tenantIsApprover: true,
      role: 'admin',
    });

  /**
   * AM user'is (specialistas) su konkrečiais aprobacijos lygiais. Naudoja realų
   * DB user'į (FK approval_steps.decided_by_user_id). `levels` turi sutapti su
   * `beforeEach` užseed'intais (AM_ADMIN/DEPARTMENT/CHANCELLOR/NONE).
   */
  const amUser = (levels: string[]) => {
    const key = levels.length === 0 ? 'NONE' : levels[0]!;
    const id = levelUserIds[key];
    if (id === undefined) throw new Error(`No seeded AM user for levels: ${levels.join(',')}`);
    return mockAuthUser({
      id,
      username: `am-user-${key}`,
      tenantId: base.amTenantId,
      tenantIsApprover: true,
      role: 'user',
      amScopeOrgIds: null,
      approvalLevelCodes: levels,
    });
  };

  const owner = () =>
    mockOrgUser({
      id: org.orgUserId,
      tenantId: org.orgTenantId,
      tenantCode: 'AAD',
      tenantName: 'Aplinkos apsaugos departamentas',
    });

  async function createDraft(projectName = 'Workflow testas'): Promise<RequestDTO> {
    return (await broker.call(
      'requests.create',
      { projectName, year: new Date().getFullYear() },
      { meta: { user: owner() } },
    )) as RequestDTO;
  }

  async function submit(id: number): Promise<RequestDTO> {
    return (await broker.call(
      'requests.submit',
      { id },
      { meta: { user: owner() } },
    )) as RequestDTO;
  }

  async function getDetail(id: number, user = amAdmin()): Promise<FinancingRequestDetail> {
    return (await broker.call(
      'requests.get',
      { id },
      { meta: { user } },
    )) as FinancingRequestDetail;
  }

  describe('canDecideStep — per-žingsnį teisė', () => {
    it('DEPARTMENT vartotojas negali spręsti kol eilė AM_ADMIN', async () => {
      await seedApprovalLevels();
      const draft = await createDraft();
      await submit(draft.id);
      await expect(
        broker.call(
          'requests.decision',
          { id: draft.id, decision: 'approve' },
          { meta: { user: amUser(['DEPARTMENT']) } },
        ),
      ).rejects.toMatchObject({ code: 403 });
    });

    it('AM admin (super) gali spręsti pirmą žingsnį', async () => {
      await seedApprovalLevels();
      const draft = await createDraft();
      await submit(draft.id);
      const after = (await broker.call(
        'requests.decision',
        { id: draft.id, decision: 'approve' },
        { meta: { user: amAdmin() } },
      )) as RequestDTO;
      // Po pirmo approve — dar yra žingsnių → SUBMITTED.
      expect(after.status).toBe('SUBMITTED');
    });

    it('AM_ADMIN vartotojas su lygiu gali spręsti pirmą žingsnį', async () => {
      await seedApprovalLevels();
      const draft = await createDraft();
      await submit(draft.id);
      const after = (await broker.call(
        'requests.decision',
        { id: draft.id, decision: 'approve' },
        { meta: { user: amUser(['AM_ADMIN']) } },
      )) as RequestDTO;
      expect(after.status).toBe('SUBMITTED');
    });

    it('po AM_ADMIN approve — DEPARTMENT vartotojas gali spręsti antrą žingsnį', async () => {
      await seedApprovalLevels();
      const draft = await createDraft();
      await submit(draft.id);
      // 1) AM admin approve pirmą.
      await broker.call(
        'requests.decision',
        { id: draft.id, decision: 'approve' },
        { meta: { user: amUser(['AM_ADMIN']) } },
      );
      // 2) Dabar eilė DEPARTMENT — DEPARTMENT vartotojas gali.
      const after = (await broker.call(
        'requests.decision',
        { id: draft.id, decision: 'approve' },
        { meta: { user: amUser(['DEPARTMENT']) } },
      )) as RequestDTO;
      expect(after.status).toBe('SUBMITTED'); // dar liko CHANCELLOR
    });

    it('vartotojas be lygio negali (403)', async () => {
      await seedApprovalLevels();
      const draft = await createDraft();
      await submit(draft.id);
      await expect(
        broker.call(
          'requests.decision',
          { id: draft.id, decision: 'approve' },
          { meta: { user: amUser([]) } },
        ),
      ).rejects.toMatchObject({ code: 403 });
    });
  });

  describe('daugiapakopis advance', () => {
    it('approve visus 3 žingsnius → APPROVED + metaduomenys paskutiniame', async () => {
      await seedApprovalLevels();
      const draft = await createDraft();
      await submit(draft.id);
      await broker.call(
        'requests.decision',
        { id: draft.id, decision: 'approve' },
        { meta: { user: amUser(['AM_ADMIN']) } },
      );
      await broker.call(
        'requests.decision',
        { id: draft.id, decision: 'approve' },
        { meta: { user: amUser(['DEPARTMENT']) } },
      );
      const final = (await broker.call(
        'requests.decision',
        { id: draft.id, decision: 'approve', grantedAmount: 12345 },
        { meta: { user: amUser(['CHANCELLOR']) } },
      )) as RequestDTO;
      expect(final.status).toBe('APPROVED');
      expect(Number(final.decisionGrantedAmount)).toBe(12345);
      const detail = await getDetail(draft.id);
      expect(detail.approvalSteps.every((s) => s.status === 'APPROVED')).toBe(true);
    });

    it('UAT auditas P2: tarpinis approve NERAŠO sprendimo metaduomenų (tik galutinis)', async () => {
      await seedApprovalLevels();
      const draft = await createDraft();
      await submit(draft.id);
      // 1-as (AM_ADMIN) žingsnis su metaduomenimis — NETURI persistintis.
      const afterFirst = (await broker.call(
        'requests.decision',
        {
          id: draft.id,
          decision: 'approve',
          grantedAmount: 999,
          priority: 5,
          procurementStage: 'vykdoma',
        },
        { meta: { user: amUser(['AM_ADMIN']) } },
      )) as RequestDTO;
      expect(afterFirst.status).toBe('SUBMITTED'); // dar ne galutinis
      expect(afterFirst.decisionGrantedAmount).toBeNull();
      expect(afterFirst.priority).toBeNull();
      expect(afterFirst.procurementStage).toBeNull();
      // DEPARTMENT — taip pat tarpinis.
      await broker.call(
        'requests.decision',
        { id: draft.id, decision: 'approve' },
        { meta: { user: amUser(['DEPARTMENT']) } },
      );
      // CHANCELLOR — galutinis, metaduomenys persistinasi.
      const final = (await broker.call(
        'requests.decision',
        { id: draft.id, decision: 'approve', grantedAmount: 12345, priority: 3 },
        { meta: { user: amUser(['CHANCELLOR']) } },
      )) as RequestDTO;
      expect(final.status).toBe('APPROVED');
      expect(Number(final.decisionGrantedAmount)).toBe(12345);
      expect(final.priority).toBe(3);
    });

    it('grąžinti vidury → RETURNED; resubmit → nauja iteracija', async () => {
      await seedApprovalLevels();
      const draft = await createDraft();
      await submit(draft.id);
      await broker.call(
        'requests.decision',
        { id: draft.id, decision: 'approve' },
        { meta: { user: amUser(['AM_ADMIN']) } },
      );
      // DEPARTMENT grąžina.
      const returned = (await broker.call(
        'requests.decision',
        { id: draft.id, decision: 'return', comment: 'Trūksta detalių' },
        { meta: { user: amUser(['DEPARTMENT']) } },
      )) as RequestDTO;
      expect(returned.status).toBe('RETURNED');
      // Resubmit → nauja serija žingsnių (iteracija 2).
      await submit(draft.id);
      const detail = await getDetail(draft.id);
      // 3 (1 iteracija) + 3 (2 iteracija) = 6 žingsnių.
      expect(detail.approvalSteps).toHaveLength(6);
      const newest = detail.approvalSteps.filter((s) => s.sequence > 3);
      expect(newest).toHaveLength(3);
      expect(newest.every((s) => s.status === 'PENDING')).toBe(true);
    });

    it('atmesti vidury → REJECTED', async () => {
      await seedApprovalLevels();
      const draft = await createDraft();
      await submit(draft.id);
      const rejected = (await broker.call(
        'requests.decision',
        { id: draft.id, decision: 'reject' },
        { meta: { user: amUser(['AM_ADMIN']) } },
      )) as RequestDTO;
      expect(rejected.status).toBe('REJECTED');
    });
  });

  describe('backward compat', () => {
    it('legacy 1-žingsnio (AM_ADMIN) prašymą AM admin sprendžia be lygio', async () => {
      // Be approval_levels grupės → fallback 1 AM_ADMIN žingsnis.
      const draft = await createDraft();
      await submit(draft.id);
      const final = (await broker.call(
        'requests.decision',
        { id: draft.id, decision: 'approve', grantedAmount: 500 },
        { meta: { user: amAdmin() } },
      )) as RequestDTO;
      expect(final.status).toBe('APPROVED');
    });
  });
});
