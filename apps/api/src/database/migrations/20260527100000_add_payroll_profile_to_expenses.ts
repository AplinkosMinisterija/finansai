/**
 * Iter 14 (FVM-6): payroll_profile_id susiejimas su DU expense'ais.
 *
 * Kontekstas: Iter 13 `payroll.computeMonth` sukurdavo DU expense'us be
 * tiesioginės nuorodos į `payroll_profiles` lentelę — vienintelis ryšys
 * būdavo `aprasymas` lauke `DU YYYY-MM: <vardas_pavarde>` formatu, kuris
 * trapus (priklauso nuo vardas_pavarde unikalumo tenant'e ir text parsing).
 *
 * Iter 14 reports'ams (F14 DU paskirstymas) reikia stabilesnio agregavimo
 * per profile — pridėdami `payroll_profile_id` FK į `expenses` lentelę,
 * gauname:
 *  - O(1) JOIN'ą iš expense į profile (vietoj substring parse'o)
 *  - Atsparumas vardas_pavarde keitimui (profilio kraštinis kontekstas
 *    išlieka stabilus, jei aprasymas pakeičiamas administratoriaus)
 *  - Atsparumas to paties pavadinimo dubliavimui tenant'e (du Jonas
 *    Jonaitis'ai būtų neaiškiai atskirti per `aprasymas`)
 *
 * Ką daro migracija:
 *  1. ALTER TABLE expenses ADD COLUMN payroll_profile_id integer NULL.
 *     - Reikšmė NULL visiems ne-DU expense'ams (default valikas).
 *     - FK į payroll_profiles(id) ON DELETE SET NULL — jei profilis
 *       ištrinamas, expense'as išlieka (audit trail), bet pakirtimas į
 *       profile pranyksta. Tai pragmatiškiausia, nes ataskaitose galim
 *       parodyti „<istorinis darbuotojas>" arba „NULL" filter'iu.
 *  2. Sukuria indeksą `idx_expenses_payroll_profile` (payroll_profile_id).
 *     Partial WHERE payroll_profile_id IS NOT NULL — sutaupom vietos
 *     (dauguma expense'ų bus NULL šitam lauke).
 *  3. Backfill'as esamiems DU expense'ams:
 *     - Parse'inam `aprasymas` regex'u `^DU (\d{4}-\d{2}): (.+)$`.
 *     - Match'inam tenant_id (per join į projects -> tenant_id) ir
 *       `vardas_pavarde` per `payroll_profiles`.
 *     - Atnaujinam `payroll_profile_id` rastiems match'ams.
 *     - Nemach'inti DU expense'ai lieka su NULL (manualus tvarkymas
 *       arba neaktualu — istoriniai duomenys).
 *
 * `down`:
 *  - Drop'ina indeksą.
 *  - Drop'ina koloną (kartu su FK constraint'u per kaskadą).
 *
 * Susiję dokumentai:
 *  - docs/fvm/iter-14-reports.md — Backend brief (Option A)
 *  - docs/fvm/spec/FVM-v0.1.md §4.5, F14 — DU paskirstymo ataskaita
 *  - apps/api/src/services/payroll.service.ts — `computeMonth` set'ina
 *    `payrollProfileId` per insert'ą (atskiras patch'as)
 *  - apps/api/src/services/reports.service.ts — `payrollDistribution`
 *    endpoint'as naudoja šitą FK'ą per agregavimo užklausą
 */
import type { Knex } from 'knex';

const FK_INDEX_NAME = 'idx_expenses_payroll_profile';
const APRASYMAS_REGEX = /^DU (\d{4}-\d{2}): (.+)$/;

export async function up(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // 1) Pridedam koloną. NULL visiems esamiems įrašams.
    await trx.schema.alterTable('expenses', (t) => {
      t.integer('payroll_profile_id')
        .nullable()
        .references('id')
        .inTable('payroll_profiles')
        .onDelete('SET NULL');
    });

    // 2) Indeksas — partial, kad sutaupytume vietos (dauguma NULL).
    await trx.raw(
      `CREATE INDEX ${FK_INDEX_NAME} ON expenses (payroll_profile_id) WHERE payroll_profile_id IS NOT NULL`,
    );

    // 3) Backfill'as. Per DU expense'us:
    //    - Iš aprasymas išparsinam mėnesį + vardas_pavarde
    //    - Per projektą sužinom tenant_id
    //    - Surandam matching payroll_profile'ą (tenant_id + vardas_pavarde)
    //    - Atnaujinam payroll_profile_id
    interface DuExpenseRow {
      id: number;
      tenant_id: number;
      aprasymas: string | null;
    }
    const duExpenses = (await trx('expenses as e')
      .join('projects as p', 'p.id', 'e.project_id')
      .where('e.tipas', 'du')
      .whereNotNull('e.aprasymas')
      .select<DuExpenseRow[]>(
        'e.id as id',
        'p.tenant_id as tenant_id',
        'e.aprasymas as aprasymas',
      )) as DuExpenseRow[];

    // Map'inam profile lookup'us per tenant + vardas_pavarde, kad
    // nesidubliuotų SELECT'ai.
    const profilesByKey = new Map<string, number>();
    interface ProfileRow {
      id: number;
      tenant_id: number;
      vardas_pavarde: string;
    }
    const allProfiles = (await trx('payroll_profiles').select<ProfileRow[]>(
      'id',
      'tenant_id',
      'vardas_pavarde',
    )) as ProfileRow[];
    for (const p of allProfiles) {
      profilesByKey.set(`${p.tenant_id}::${p.vardas_pavarde}`, p.id);
    }

    for (const row of duExpenses) {
      if (!row.aprasymas) continue;
      const match = APRASYMAS_REGEX.exec(row.aprasymas);
      if (!match) continue;
      const vardasPavarde = match[2];
      if (!vardasPavarde) continue;
      const key = `${row.tenant_id}::${vardasPavarde}`;
      const profileId = profilesByKey.get(key);
      if (profileId === undefined) continue;
      await trx('expenses')
        .where({ id: row.id })
        .update({ payroll_profile_id: profileId });
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // 1) Drop'inam indeksą (CREATE per raw, todėl ir DROP per raw — simetrija).
    await trx.raw(`DROP INDEX IF EXISTS ${FK_INDEX_NAME}`);
    // 2) Drop'inam koloną — PostgreSQL automatiškai pašalina FK constraint'ą.
    await trx.schema.alterTable('expenses', (t) => {
      t.dropColumn('payroll_profile_id');
    });
  });
}
