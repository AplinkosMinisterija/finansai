/**
 * Issue #9: NEAKTUALU (not-relevant / soft-archive) būsenos integraciniai
 * testai.
 *
 * Padengia:
 *  1. DRAFT → NEAKTUALU leidžiama prašymo teikėjui (org user).
 *  2. RETURNED → NEAKTUALU irgi leidžiama.
 *  3. NEAKTUALU prašymo NEGALIMA pateikti (submit → 403).
 *  4. NEAKTUALU → DRAFT (markActive / reaktyvacija) leidžiama tam pačiam asmeniui.
 *  5. Pašalinis vartotojas (kita org) negali nei archyvuoti, nei grąžinti (403).
 *  6. NEAKTUALU NErodomas default aktyviame sąraše; matomas tik su status=NEAKTUALU.
 *  7. Audit įrašai (request_comments) sukuriami su teisingu kind + metadata.
 *  8. NEAKTUALU prašymą savininkas gali ištrinti (delete leidžia DRAFT+NEAKTUALU).
 *
 * Test'ai kviečia broker'į tiesiogiai (be HTTP gateway'aus).
 */
import type { ServiceBroker } from 'moleculer';
import type { FinancingRequest as RequestDTO, PaginatedResponse } from '@biip-finansai/shared';
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

describe('requests service — NEAKTUALU (Issue #9)', () => {
  let broker: ServiceBroker;
  let base: BaseFixtures;
  let org: OrgTenantFixtures;

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
  });

  const amAdmin = () =>
    mockAuthUser({
      id: base.amAdminUserId,
      tenantId: base.amTenantId,
      tenantIsApprover: true,
      role: 'admin',
    });

  // Prašymo savininkas — org specialistas iš org tenant'o.
  const owner = () =>
    mockOrgUser({
      id: org.orgUserId,
      tenantId: org.orgTenantId,
      tenantCode: 'AAD',
      tenantName: 'Aplinkos apsaugos departamentas',
    });

  // Pašalinis vartotojas — kita org (ne to prašymo savininkas).
  const stranger = () =>
    mockOrgUser({
      id: 999,
      tenantId: 9999,
      tenantCode: 'XXX',
      tenantName: 'Kita organizacija',
    });

  /** Sukuria DRAFT prašymą org savininko vardu. */
  async function createDraft(projectName = 'Issue #9 testas'): Promise<RequestDTO> {
    return (await broker.call(
      'requests.create',
      { projectName, year: new Date().getFullYear() },
      { meta: { user: owner() } },
    )) as RequestDTO;
  }

  describe('markNotRelevant (DRAFT/RETURNED → NEAKTUALU)', () => {
    it('savininkas pažymi DRAFT neaktualiu', async () => {
      const draft = await createDraft();
      const result = (await broker.call(
        'requests.markNotRelevant',
        { id: draft.id },
        { meta: { user: owner() } },
      )) as RequestDTO;
      expect(result.status).toBe('NEAKTUALU');

      // Audit įrašas sukurtas su teisingu kind + metadata.
      const knex = getTestKnex();
      const comments = await knex('request_comments')
        .where({ request_id: draft.id, kind: 'marked_not_relevant' })
        .select('*');
      expect(comments).toHaveLength(1);
      expect(comments[0].metadata).toMatchObject({
        fromStatus: 'DRAFT',
        toStatus: 'NEAKTUALU',
      });
    });

    it('savininkas pažymi RETURNED neaktualiu', async () => {
      // DRAFT → SUBMITTED → (AM grąžina) RETURNED
      const draft = await createDraft();
      await broker.call('requests.submit', { id: draft.id }, { meta: { user: owner() } });
      await broker.call(
        'requests.decision',
        { id: draft.id, decision: 'return', comment: 'Pataisykit' },
        { meta: { user: amAdmin() } },
      );
      const result = (await broker.call(
        'requests.markNotRelevant',
        { id: draft.id },
        { meta: { user: owner() } },
      )) as RequestDTO;
      expect(result.status).toBe('NEAKTUALU');
    });

    it('pašalinis vartotojas negali pažymėti neaktualiu (403)', async () => {
      const draft = await createDraft();
      await expect(
        broker.call('requests.markNotRelevant', { id: draft.id }, { meta: { user: stranger() } }),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });

    it('negalima pažymėti neaktualiu pateikto (SUBMITTED) prašymo', async () => {
      const draft = await createDraft();
      await broker.call('requests.submit', { id: draft.id }, { meta: { user: owner() } });
      await expect(
        broker.call('requests.markNotRelevant', { id: draft.id }, { meta: { user: owner() } }),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });
  });

  describe('NEAKTUALU būsenos apribojimai', () => {
    it('NEAKTUALU prašymo NEGALIMA pateikti (submit → 403)', async () => {
      const draft = await createDraft();
      await broker.call('requests.markNotRelevant', { id: draft.id }, { meta: { user: owner() } });
      await expect(
        broker.call('requests.submit', { id: draft.id }, { meta: { user: owner() } }),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });

    it('NEAKTUALU prašymo NEGALIMA spręsti (decision → 403)', async () => {
      const draft = await createDraft();
      await broker.call('requests.markNotRelevant', { id: draft.id }, { meta: { user: owner() } });
      await expect(
        broker.call(
          'requests.decision',
          { id: draft.id, decision: 'approve' },
          { meta: { user: amAdmin() } },
        ),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });
  });

  describe('markActive (NEAKTUALU → DRAFT, reaktyvacija)', () => {
    it('savininkas grąžina neaktualų prašymą į juodraštį', async () => {
      const draft = await createDraft();
      await broker.call('requests.markNotRelevant', { id: draft.id }, { meta: { user: owner() } });
      const result = (await broker.call(
        'requests.markActive',
        { id: draft.id },
        { meta: { user: owner() } },
      )) as RequestDTO;
      expect(result.status).toBe('DRAFT');

      const knex = getTestKnex();
      const comments = await knex('request_comments')
        .where({ request_id: draft.id, kind: 'reactivated' })
        .select('*');
      expect(comments).toHaveLength(1);
      expect(comments[0].metadata).toMatchObject({
        fromStatus: 'NEAKTUALU',
        toStatus: 'DRAFT',
      });
    });

    it('pašalinis vartotojas negali grąžinti į juodraštį (403)', async () => {
      const draft = await createDraft();
      await broker.call('requests.markNotRelevant', { id: draft.id }, { meta: { user: owner() } });
      await expect(
        broker.call('requests.markActive', { id: draft.id }, { meta: { user: stranger() } }),
      ).rejects.toMatchObject({ code: 403, type: 'FORBIDDEN' });
    });

    it('negalima grąžinti į juodraštį ne-NEAKTUALU prašymo (400)', async () => {
      const draft = await createDraft();
      await expect(
        broker.call('requests.markActive', { id: draft.id }, { meta: { user: owner() } }),
      ).rejects.toMatchObject({ code: 400, type: 'INVALID_STATUS' });
    });
  });

  describe('Sąrašo matomumas', () => {
    it('NEAKTUALU NErodomas default aktyviame sąraše, bet matomas su status=NEAKTUALU', async () => {
      const active = await createDraft('Aktyvus juodraštis');
      const archived = await createDraft('Archyvuotinas');
      await broker.call(
        'requests.markNotRelevant',
        { id: archived.id },
        { meta: { user: owner() } },
      );

      // Default sąrašas (be status filtro) — NEAKTUALU paslėptas.
      const defaultList = (await broker.call(
        'requests.list',
        { year: new Date().getFullYear() },
        { meta: { user: owner() } },
      )) as PaginatedResponse<RequestDTO>;
      const defaultIds = defaultList.items.map((r) => r.id);
      expect(defaultIds).toContain(active.id);
      expect(defaultIds).not.toContain(archived.id);

      // Eksplicitiškai prašant NEAKTUALU — matomas.
      const archivedList = (await broker.call(
        'requests.list',
        { status: 'NEAKTUALU', year: new Date().getFullYear() },
        { meta: { user: owner() } },
      )) as PaginatedResponse<RequestDTO>;
      const archivedIds = archivedList.items.map((r) => r.id);
      expect(archivedIds).toContain(archived.id);
      expect(archivedIds).not.toContain(active.id);
    });
  });

  describe('delete', () => {
    it('savininkas gali ištrinti NEAKTUALU prašymą', async () => {
      const draft = await createDraft();
      await broker.call('requests.markNotRelevant', { id: draft.id }, { meta: { user: owner() } });
      const res = (await broker.call(
        'requests.delete',
        { id: draft.id },
        { meta: { user: owner() } },
      )) as { ok: true };
      expect(res.ok).toBe(true);

      const knex = getTestKnex();
      const remaining = await knex('requests').where({ id: draft.id }).select('id');
      expect(remaining).toHaveLength(0);
    });
  });
});
