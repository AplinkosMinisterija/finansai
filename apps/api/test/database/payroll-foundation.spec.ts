/**
 * FVM payroll migracijos integration test'as (Iter 13).
 *
 * Test'ai (8):
 *  1. Po migracijos `payroll_profiles` ir `payroll_distributions` lentelės
 *     turi visus laukus pagal §6.5, §6.6 architektūros dok'e + DBA brief'e.
 *  2. CHECK constraint `sutarties_tipas`: insert su `sutarties_tipas='invalid'`
 *     throw'ina PG check_violation.
 *  3. CHECK constraint `paskirstymo_tipas`: insert su `paskirstymo_tipas='invalid'`
 *     throw'ina PG check_violation.
 *  4. CASCADE delete: ištrynus payroll_profile, jo distributions automatiškai
 *     ištrinami.
 *  5. RESTRICT funding_source: bandant ištrint funding_source, į kurį rodo
 *     distribution — DB throw'ina FK violation.
 *  6. SET NULL user_id: ištrynus user'į, profile išlieka, jo user_id NULL.
 *  7. Valid insert: profile + 2 distributions (1 procentais, 1 fiksuota) —
 *     sėkmingai.
 *  8. Rollback (`migrate.down`) — abi lentelės dingo iš schemos.
 *
 * Pastaba: `global-setup.ts` jau paleido visas migracijas test DB. Per
 * test'us specifiškai apsisukam šitą migraciją per `migrate.down` /
 * `migrate.up` Test'e 8 — rollback patikrinimui. Kiti testai naudoja
 * latest schema.
 *
 * Pastaba dėl test izoliacijos: Iter 13 lentelės NĖRA referenced'inamos
 * iš jokios kitos lentelės (expenses.tipas='du' tik logiškai siejasi su
 * payroll computeMonth funkcionalumu, bet FK nėra). Todėl rollback'ui
 * netgi nereikia atsukti kitų migracijų pirma.
 */
import type { Knex } from 'knex';
import {
  getTestKnex,
  closeTestKnex,
  truncateAll,
  seedBaseFixtures,
  seedFvmClassifiers,
  type BaseFixtures,
  type FvmClassifierFixtures,
} from '../helpers/db';

const PAYROLL_MIGRATION = '20260526100000_create_payroll.ts';

const PROFILES_EXPECTED_COLUMNS = [
  'id',
  'tenant_id',
  'user_id',
  'vardas_pavarde',
  'pareigos',
  'sutarties_tipas',
  'atlyginimas_bruto',
  'priedai',
  'galioja_nuo',
  'galioja_iki',
  'created_at',
  'updated_at',
] as const;

const DISTRIBUTIONS_EXPECTED_COLUMNS = [
  'id',
  'payroll_profile_id',
  'funding_source_id',
  'paskirstymo_tipas',
  'reiksme',
  'galioja_nuo',
  'galioja_iki',
  'created_at',
  'updated_at',
] as const;

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
}

async function getColumnSet(
  knex: Knex,
  tableName: string,
): Promise<Set<string>> {
  const rows = (await knex('information_schema.columns')
    .where({ table_schema: 'public', table_name: tableName })
    .select<ColumnRow[]>(
      'column_name',
      'data_type',
      'is_nullable',
    )) as ColumnRow[];
  return new Set(rows.map((r) => r.column_name));
}

interface SeededContext {
  fixtures: BaseFixtures;
  classifiers: FvmClassifierFixtures;
  fundingSourceId: number;
  secondFundingSourceId: number;
}

/**
 * Įdeda visą reikalingą "lattice" payroll insert'ams:
 *  - AM tenant + admin user'is (per seedBaseFixtures)
 *  - FVM klasifikatoriai (per seedFvmClassifiers)
 *  - 2 funding_sources (kad multi-source distribution testai turėtų
 *    ką naudoti — vienas biudžetas, antras ES)
 *
 * Šie ID'ai bus naudojami visuose payroll insert'uose toliau.
 */
async function seedPayrollContext(knex: Knex): Promise<SeededContext> {
  const fixtures = await seedBaseFixtures(knex);
  const classifiers = await seedFvmClassifiers(knex);

  // Funding source #1 — biudžetas.
  const insertedSource1 = (await knex('funding_sources')
    .insert({
      tenant_id: fixtures.amTenantId,
      pavadinimas: 'Valstybės biudžetas 2026 (payroll test)',
      kodas: 'VB-2026-PAYROLL',
      tipas_classifier_item_id: classifiers.fundingSourceTypeItemIds.biudzetas,
      metai: 2026,
      metine_suma: '1000000.00',
      aprasymas: 'test fixture — biudžetas',
      aktyvus: true,
    })
    .returning('id')) as Array<{ id: number }>;
  const fundingSourceId = insertedSource1[0]?.id;
  if (fundingSourceId === undefined) {
    throw new Error('Test fixture: nepavyko sukurti funding_source #1');
  }

  // Funding source #2 — ES fondai.
  const insertedSource2 = (await knex('funding_sources')
    .insert({
      tenant_id: fixtures.amTenantId,
      pavadinimas: 'ES fondai 2026 (payroll test)',
      kodas: 'ES-2026-PAYROLL',
      tipas_classifier_item_id: classifiers.fundingSourceTypeItemIds.es,
      metai: 2026,
      metine_suma: '500000.00',
      aprasymas: 'test fixture — ES',
      aktyvus: true,
    })
    .returning('id')) as Array<{ id: number }>;
  const secondFundingSourceId = insertedSource2[0]?.id;
  if (secondFundingSourceId === undefined) {
    throw new Error('Test fixture: nepavyko sukurti funding_source #2');
  }

  return {
    fixtures,
    classifiers,
    fundingSourceId,
    secondFundingSourceId,
  };
}

describe('FVM payroll migration (Iter 13)', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = getTestKnex();
  });

  afterAll(async () => {
    // Palieki DB su naujausia schema, kad kiti spec'ai matytų pilną struktūrą.
    const isAtLatest = (await knex.migrate.currentVersion()).startsWith(
      '20260526100000',
    );
    if (!isAtLatest) {
      await knex.migrate.latest();
    }
    await closeTestKnex();
  });

  describe('Test 1: payroll_profiles + payroll_distributions lentelės su visomis kolonomis', () => {
    beforeAll(async () => {
      await knex.migrate.latest();
    });

    it('po migracijos payroll_profiles turi visus 12 kolonų pagal §6.5', async () => {
      const columns = await getColumnSet(knex, 'payroll_profiles');
      for (const col of PROFILES_EXPECTED_COLUMNS) {
        expect(columns.has(col)).toBe(true);
      }
      // Patikrinam, kad būtent 12 (jokio papildomo lauko nesusitalpino).
      expect(columns.size).toBe(PROFILES_EXPECTED_COLUMNS.length);
    });

    it('po migracijos payroll_distributions turi visus 9 kolonas pagal §6.6', async () => {
      const columns = await getColumnSet(knex, 'payroll_distributions');
      for (const col of DISTRIBUTIONS_EXPECTED_COLUMNS) {
        expect(columns.has(col)).toBe(true);
      }
      expect(columns.size).toBe(DISTRIBUTIONS_EXPECTED_COLUMNS.length);
    });

    it('payroll_profiles.user_id yra nullable', async () => {
      const row = (await knex('information_schema.columns')
        .where({
          table_schema: 'public',
          table_name: 'payroll_profiles',
          column_name: 'user_id',
        })
        .first<ColumnRow>('column_name', 'data_type', 'is_nullable')) as
        | ColumnRow
        | undefined;
      expect(row).toBeDefined();
      expect(row!.is_nullable).toBe('YES');
    });

    it('payroll_profiles.galioja_iki yra nullable, galioja_nuo NOT NULL', async () => {
      const rows = (await knex('information_schema.columns')
        .where({
          table_schema: 'public',
          table_name: 'payroll_profiles',
        })
        .whereIn('column_name', ['galioja_nuo', 'galioja_iki'])
        .select<ColumnRow[]>(
          'column_name',
          'is_nullable',
        )) as ColumnRow[];
      const byName: Record<string, string> = {};
      for (const r of rows) byName[r.column_name] = r.is_nullable;
      expect(byName['galioja_nuo']).toBe('NO');
      expect(byName['galioja_iki']).toBe('YES');
    });

    it('CHECK constraint payroll_profiles_sutarties_tipas_check egzistuoja', async () => {
      const rows = (await knex('information_schema.table_constraints')
        .where({
          table_schema: 'public',
          table_name: 'payroll_profiles',
          constraint_type: 'CHECK',
        })
        .select<Array<{ constraint_name: string }>>(
          'constraint_name',
        )) as Array<{ constraint_name: string }>;
      const names = rows.map((r) => r.constraint_name);
      expect(names).toEqual(
        expect.arrayContaining(['payroll_profiles_sutarties_tipas_check']),
      );
    });

    it('CHECK constraint payroll_distributions_paskirstymo_tipas_check egzistuoja', async () => {
      const rows = (await knex('information_schema.table_constraints')
        .where({
          table_schema: 'public',
          table_name: 'payroll_distributions',
          constraint_type: 'CHECK',
        })
        .select<Array<{ constraint_name: string }>>(
          'constraint_name',
        )) as Array<{ constraint_name: string }>;
      const names = rows.map((r) => r.constraint_name);
      expect(names).toEqual(
        expect.arrayContaining([
          'payroll_distributions_paskirstymo_tipas_check',
        ]),
      );
    });

    it('indeksai payroll_profiles (tenant, user) egzistuoja', async () => {
      const rows = (await knex('pg_indexes')
        .where({ schemaname: 'public', tablename: 'payroll_profiles' })
        .select<Array<{ indexname: string }>>('indexname')) as Array<{
        indexname: string;
      }>;
      const names = rows.map((r) => r.indexname);
      expect(names).toEqual(
        expect.arrayContaining([
          'idx_payroll_profiles_tenant',
          'idx_payroll_profiles_user',
        ]),
      );
    });

    it('indeksai payroll_distributions (profile, source) egzistuoja', async () => {
      const rows = (await knex('pg_indexes')
        .where({ schemaname: 'public', tablename: 'payroll_distributions' })
        .select<Array<{ indexname: string }>>('indexname')) as Array<{
        indexname: string;
      }>;
      const names = rows.map((r) => r.indexname);
      expect(names).toEqual(
        expect.arrayContaining([
          'idx_payroll_distributions_profile',
          'idx_payroll_distributions_source',
        ]),
      );
    });
  });

  describe('Test 2: CHECK constraint sutarties_tipas — neleistina reikšmė', () => {
    let ctx: SeededContext;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedPayrollContext(knex);
    });

    it('insert su sutarties_tipas="invalid" throw\'ina PG check_violation', async () => {
      await expect(
        knex('payroll_profiles').insert({
          tenant_id: ctx.fixtures.amTenantId,
          user_id: null,
          vardas_pavarde: 'Jonas Bandymas',
          pareigos: 'Specialistas',
          sutarties_tipas: 'invalid',
          atlyginimas_bruto: '2000.00',
          priedai: '0.00',
          galioja_nuo: '2026-01-01',
        }),
      ).rejects.toThrow(/payroll_profiles_sutarties_tipas_check/);
    });

    it('visi 3 leistini sutarties tipai priimami', async () => {
      // Patikrinam, kad CHECK leidžia visas 3 dokumentuotas reikšmes
      // (darbo, paslaugu, autorine).
      const types = ['darbo', 'paslaugu', 'autorine'] as const;
      for (const sutartiesTipas of types) {
        const inserted = (await knex('payroll_profiles')
          .insert({
            tenant_id: ctx.fixtures.amTenantId,
            user_id: null,
            vardas_pavarde: `Asmuo ${sutartiesTipas}`,
            pareigos: 'Specialistas',
            sutarties_tipas: sutartiesTipas,
            atlyginimas_bruto: '2000.00',
            priedai: '100.00',
            galioja_nuo: '2026-01-01',
          })
          .returning(['id', 'sutarties_tipas'])) as Array<{
          id: number;
          sutarties_tipas: string;
        }>;
        expect(inserted[0]?.sutarties_tipas).toBe(sutartiesTipas);
      }
    });
  });

  describe('Test 3: CHECK constraint paskirstymo_tipas — neleistina reikšmė', () => {
    let ctx: SeededContext;
    let profileId: number;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedPayrollContext(knex);

      // Reikia profile, kad galima būtų bandyti distribution insert'ą.
      const insertedProfile = (await knex('payroll_profiles')
        .insert({
          tenant_id: ctx.fixtures.amTenantId,
          user_id: ctx.fixtures.amAdminUserId,
          vardas_pavarde: 'Test AM Admin',
          pareigos: 'Vyriausiasis specialistas',
          sutarties_tipas: 'darbo',
          atlyginimas_bruto: '3000.00',
          priedai: '500.00',
          galioja_nuo: '2026-01-01',
        })
        .returning('id')) as Array<{ id: number }>;
      const pid = insertedProfile[0]?.id;
      if (pid === undefined) {
        throw new Error('Test fixture: nepavyko sukurti payroll_profile');
      }
      profileId = pid;
    });

    it('insert su paskirstymo_tipas="invalid" throw\'ina PG check_violation', async () => {
      await expect(
        knex('payroll_distributions').insert({
          payroll_profile_id: profileId,
          funding_source_id: ctx.fundingSourceId,
          paskirstymo_tipas: 'invalid',
          reiksme: '50.0000',
          galioja_nuo: '2026-01-01',
        }),
      ).rejects.toThrow(/payroll_distributions_paskirstymo_tipas_check/);
    });

    it('abu leistini tipai (procentais, fiksuota) priimami', async () => {
      const types = ['procentais', 'fiksuota'] as const;
      for (const paskirstymoTipas of types) {
        const inserted = (await knex('payroll_distributions')
          .insert({
            payroll_profile_id: profileId,
            funding_source_id: ctx.fundingSourceId,
            paskirstymo_tipas: paskirstymoTipas,
            reiksme: paskirstymoTipas === 'procentais' ? '40.0000' : '500.0000',
            galioja_nuo: '2026-01-01',
          })
          .returning(['id', 'paskirstymo_tipas'])) as Array<{
          id: number;
          paskirstymo_tipas: string;
        }>;
        expect(inserted[0]?.paskirstymo_tipas).toBe(paskirstymoTipas);
      }
    });
  });

  describe('Test 4: CASCADE delete — profile -> distributions', () => {
    let ctx: SeededContext;
    let profileId: number;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedPayrollContext(knex);

      // Sukuriam profile + 2 distributions.
      const insertedProfile = (await knex('payroll_profiles')
        .insert({
          tenant_id: ctx.fixtures.amTenantId,
          user_id: ctx.fixtures.amAdminUserId,
          vardas_pavarde: 'CASCADE Test',
          pareigos: 'Specialistas',
          sutarties_tipas: 'darbo',
          atlyginimas_bruto: '2500.00',
          priedai: '0.00',
          galioja_nuo: '2026-01-01',
        })
        .returning('id')) as Array<{ id: number }>;
      const pid = insertedProfile[0]?.id;
      if (pid === undefined) {
        throw new Error('Test fixture: nepavyko sukurti payroll_profile');
      }
      profileId = pid;

      await knex('payroll_distributions').insert([
        {
          payroll_profile_id: profileId,
          funding_source_id: ctx.fundingSourceId,
          paskirstymo_tipas: 'procentais',
          reiksme: '60.0000',
          galioja_nuo: '2026-01-01',
        },
        {
          payroll_profile_id: profileId,
          funding_source_id: ctx.secondFundingSourceId,
          paskirstymo_tipas: 'procentais',
          reiksme: '40.0000',
          galioja_nuo: '2026-01-01',
        },
      ]);
    });

    it('po profile delete — visi jo distributions automatiškai ištrinami', async () => {
      // Sanity check: prieš trinant — 2 distributions egzistuoja.
      const beforeCount = (await knex('payroll_distributions')
        .where({ payroll_profile_id: profileId })
        .count<Array<{ count: string }>>('id as count')) as Array<{
        count: string;
      }>;
      expect(Number(beforeCount[0]?.count)).toBe(2);

      await knex('payroll_profiles').where({ id: profileId }).del();

      // Po delete — distributions šituo profileId turi būti 0.
      const afterCount = (await knex('payroll_distributions')
        .where({ payroll_profile_id: profileId })
        .count<Array<{ count: string }>>('id as count')) as Array<{
        count: string;
      }>;
      expect(Number(afterCount[0]?.count)).toBe(0);

      // Profile irgi turi būti ištrintas.
      const profileRow = (await knex('payroll_profiles')
        .where({ id: profileId })
        .first<{ id: number }>()) as { id: number } | undefined;
      expect(profileRow).toBeUndefined();
    });
  });

  describe('Test 5: RESTRICT funding_source — distribution blokuoja delete', () => {
    let ctx: SeededContext;
    let profileId: number;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedPayrollContext(knex);

      const insertedProfile = (await knex('payroll_profiles')
        .insert({
          tenant_id: ctx.fixtures.amTenantId,
          user_id: ctx.fixtures.amAdminUserId,
          vardas_pavarde: 'RESTRICT Test',
          pareigos: 'Specialistas',
          sutarties_tipas: 'darbo',
          atlyginimas_bruto: '2500.00',
          priedai: '0.00',
          galioja_nuo: '2026-01-01',
        })
        .returning('id')) as Array<{ id: number }>;
      const pid = insertedProfile[0]?.id;
      if (pid === undefined) {
        throw new Error('Test fixture: nepavyko sukurti payroll_profile');
      }
      profileId = pid;

      await knex('payroll_distributions').insert({
        payroll_profile_id: profileId,
        funding_source_id: ctx.fundingSourceId,
        paskirstymo_tipas: 'procentais',
        reiksme: '100.0000',
        galioja_nuo: '2026-01-01',
      });
    });

    it('bandant ištrint funding_source su priklausančia distribution — FK violation', async () => {
      await expect(
        knex('funding_sources').where({ id: ctx.fundingSourceId }).del(),
      ).rejects.toThrow(/payroll_distributions_funding_source_id_foreign/);

      // Sanity check: funding_source vis dar yra.
      const row = (await knex('funding_sources')
        .where({ id: ctx.fundingSourceId })
        .first<{ id: number }>()) as { id: number } | undefined;
      expect(row?.id).toBe(ctx.fundingSourceId);
    });
  });

  describe('Test 6: SET NULL user_id — profile išlieka', () => {
    let ctx: SeededContext;
    let profileId: number;
    let throwawayUserId: number;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedPayrollContext(knex);

      // Sukuriam atskirą user'į, kurį galėsim ištrinti (AM admin per
      // seedBaseFixtures negali būti ištrintas, nes Jest cleanup'as visu
      // run'u laiko šitą id'į kaip "esamą"). Naujas user'is — izoliuotas
      // šitam test'ui.
      const insertedUser = (await knex('users')
        .insert({
          username: 'test-payroll-cleanup-user',
          password_hash: 'noop',
          full_name: 'Trinamas Naudotojas',
          email: 'cleanup@example.com',
          role: 'user',
          tenant_id: ctx.fixtures.amTenantId,
          am_scope_org_ids: null,
          active: true,
        })
        .returning('id')) as Array<{ id: number }>;
      const uid = insertedUser[0]?.id;
      if (uid === undefined) {
        throw new Error('Test fixture: nepavyko sukurti throwaway user');
      }
      throwawayUserId = uid;

      const insertedProfile = (await knex('payroll_profiles')
        .insert({
          tenant_id: ctx.fixtures.amTenantId,
          user_id: throwawayUserId,
          vardas_pavarde: 'Trinamas Naudotojas',
          pareigos: 'Specialistas',
          sutarties_tipas: 'darbo',
          atlyginimas_bruto: '2500.00',
          priedai: '0.00',
          galioja_nuo: '2026-01-01',
        })
        .returning('id')) as Array<{ id: number }>;
      const pid = insertedProfile[0]?.id;
      if (pid === undefined) {
        throw new Error('Test fixture: nepavyko sukurti payroll_profile');
      }
      profileId = pid;
    });

    it('ištrynus user — profile išlieka, jo user_id NULL', async () => {
      // Sanity check: prieš trinant user_id nustatytas.
      const before = (await knex('payroll_profiles')
        .where({ id: profileId })
        .first<{ user_id: number | null }>()) as
        | { user_id: number | null }
        | undefined;
      expect(before?.user_id).toBe(throwawayUserId);

      await knex('users').where({ id: throwawayUserId }).del();

      // Po delete — profile vis dar yra, user_id NULL.
      const after = (await knex('payroll_profiles')
        .where({ id: profileId })
        .first<{ id: number; user_id: number | null; vardas_pavarde: string }>()) as
        | { id: number; user_id: number | null; vardas_pavarde: string }
        | undefined;
      expect(after).toBeDefined();
      expect(after!.id).toBe(profileId);
      expect(after!.user_id).toBeNull();
      // Redundant copy `vardas_pavarde` išlieka — istorinis DU įrašas
      // niekur „neprapuola".
      expect(after!.vardas_pavarde).toBe('Trinamas Naudotojas');
    });
  });

  describe('Test 7: Valid insert — profile + 2 distributions (procentais + fiksuota)', () => {
    let ctx: SeededContext;

    beforeAll(async () => {
      await knex.migrate.latest();
      await truncateAll(knex);
      ctx = await seedPayrollContext(knex);
    });

    it('insert profile su 2 distributions (1 procentais, 1 fiksuota) — sėkmingai', async () => {
      // 1) Sukuriam profile.
      const insertedProfile = (await knex('payroll_profiles')
        .insert({
          tenant_id: ctx.fixtures.amTenantId,
          user_id: ctx.fixtures.amAdminUserId,
          vardas_pavarde: 'Test AM Admin',
          pareigos: 'Vyriausiasis specialistas',
          sutarties_tipas: 'darbo',
          atlyginimas_bruto: '3000.00',
          priedai: '500.00',
          galioja_nuo: '2026-01-01',
          galioja_iki: '2026-12-31',
        })
        .returning([
          'id',
          'tenant_id',
          'user_id',
          'vardas_pavarde',
          'sutarties_tipas',
          'atlyginimas_bruto',
          'priedai',
          'galioja_nuo',
          'galioja_iki',
        ])) as Array<{
        id: number;
        tenant_id: number;
        user_id: number | null;
        vardas_pavarde: string;
        sutarties_tipas: string;
        atlyginimas_bruto: string;
        priedai: string;
        galioja_nuo: string;
        galioja_iki: string | null;
      }>;
      const profile = insertedProfile[0];
      expect(profile).toBeDefined();
      expect(profile!.id).toBeGreaterThan(0);
      expect(profile!.tenant_id).toBe(ctx.fixtures.amTenantId);
      expect(profile!.user_id).toBe(ctx.fixtures.amAdminUserId);
      expect(profile!.sutarties_tipas).toBe('darbo');
      expect(Number(profile!.atlyginimas_bruto)).toBeCloseTo(3000, 2);
      expect(Number(profile!.priedai)).toBeCloseTo(500, 2);
      expect(profile!.galioja_nuo).toBe('2026-01-01');
      expect(profile!.galioja_iki).toBe('2026-12-31');

      // 2) Sukuriam 2 distributions: 70% iš biudžeto + 1050 € fiksuotai iš ES.
      const insertedDists = (await knex('payroll_distributions')
        .insert([
          {
            payroll_profile_id: profile!.id,
            funding_source_id: ctx.fundingSourceId,
            paskirstymo_tipas: 'procentais',
            reiksme: '70.0000',
            galioja_nuo: '2026-01-01',
            galioja_iki: '2026-12-31',
          },
          {
            payroll_profile_id: profile!.id,
            funding_source_id: ctx.secondFundingSourceId,
            paskirstymo_tipas: 'fiksuota',
            reiksme: '1050.0000',
            galioja_nuo: '2026-01-01',
            galioja_iki: '2026-12-31',
          },
        ])
        .returning([
          'id',
          'payroll_profile_id',
          'funding_source_id',
          'paskirstymo_tipas',
          'reiksme',
        ])) as Array<{
        id: number;
        payroll_profile_id: number;
        funding_source_id: number;
        paskirstymo_tipas: string;
        reiksme: string;
      }>;

      expect(insertedDists).toHaveLength(2);

      const procDist = insertedDists.find(
        (d) => d.paskirstymo_tipas === 'procentais',
      );
      const fixedDist = insertedDists.find(
        (d) => d.paskirstymo_tipas === 'fiksuota',
      );

      expect(procDist).toBeDefined();
      expect(procDist!.payroll_profile_id).toBe(profile!.id);
      expect(procDist!.funding_source_id).toBe(ctx.fundingSourceId);
      expect(Number(procDist!.reiksme)).toBeCloseTo(70, 4);

      expect(fixedDist).toBeDefined();
      expect(fixedDist!.payroll_profile_id).toBe(profile!.id);
      expect(fixedDist!.funding_source_id).toBe(ctx.secondFundingSourceId);
      expect(Number(fixedDist!.reiksme)).toBeCloseTo(1050, 4);
    });

    it('insert profile su user_id=NULL ir galioja_iki=NULL — sėkmingai', async () => {
      // Darbuotojas be sistemos paskyros (paslaugų sutartis) + neapibrėžtas
      // galiojimas (kol pareigos nepasikeis).
      const inserted = (await knex('payroll_profiles')
        .insert({
          tenant_id: ctx.fixtures.amTenantId,
          user_id: null,
          vardas_pavarde: 'Trečiosios šalies tiekėjas',
          pareigos: 'Konsultantas',
          sutarties_tipas: 'paslaugu',
          atlyginimas_bruto: '5000.00',
          // priedai praleidžiam — turi default 0.
          galioja_nuo: '2026-03-01',
          // galioja_iki NULL — vis dar galioja.
        })
        .returning([
          'id',
          'user_id',
          'vardas_pavarde',
          'sutarties_tipas',
          'priedai',
          'galioja_iki',
        ])) as Array<{
        id: number;
        user_id: number | null;
        vardas_pavarde: string;
        sutarties_tipas: string;
        priedai: string;
        galioja_iki: string | null;
      }>;
      const row = inserted[0];
      expect(row).toBeDefined();
      expect(row!.user_id).toBeNull();
      expect(row!.vardas_pavarde).toBe('Trečiosios šalies tiekėjas');
      expect(row!.sutarties_tipas).toBe('paslaugu');
      expect(Number(row!.priedai)).toBeCloseTo(0, 2);
      expect(row!.galioja_iki).toBeNull();
    });
  });

  describe('Test 8: rollback (down) — abi lentelės dingo', () => {
    beforeAll(async () => {
      // Įsitikinam, kad startuojam iš latest.
      await knex.migrate.latest();
      const hasProfiles = await knex.schema.hasTable('payroll_profiles');
      const hasDistributions = await knex.schema.hasTable(
        'payroll_distributions',
      );
      expect(hasProfiles).toBe(true);
      expect(hasDistributions).toBe(true);

      // Roll'inam šią migraciją down. Iter 13 lentelės NĖRA reference'inamos
      // iš jokios kitos lentelės — todėl jokio papildomo migracijos atsukimo
      // nereikia.
      await knex.migrate.down({ name: PAYROLL_MIGRATION });
    });

    afterAll(async () => {
      // Atstatom — afterAll aukščiau tikisi latest schemos.
      await knex.migrate.latest();
    });

    it('po rollback payroll_profiles lentelė dingo iš schema', async () => {
      const hasProfiles = await knex.schema.hasTable('payroll_profiles');
      expect(hasProfiles).toBe(false);
    });

    it('po rollback payroll_distributions lentelė dingo iš schema', async () => {
      const hasDistributions = await knex.schema.hasTable(
        'payroll_distributions',
      );
      expect(hasDistributions).toBe(false);
    });

    it('po rollback abu CHECK constraint\'ai dingo', async () => {
      const rows = (await knex('information_schema.table_constraints')
        .where({ table_schema: 'public' })
        .whereIn('constraint_name', [
          'payroll_profiles_sutarties_tipas_check',
          'payroll_distributions_paskirstymo_tipas_check',
        ])
        .select<Array<{ constraint_name: string }>>(
          'constraint_name',
        )) as Array<{ constraint_name: string }>;
      expect(rows).toHaveLength(0);
    });
  });
});
