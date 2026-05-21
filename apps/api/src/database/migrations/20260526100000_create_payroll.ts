/**
 * Iter 13 (FVM-5): Payroll — darbuotojo finansinis profilis + DU paskirstymas.
 *
 * Ką daro ši migracija:
 *  1. Sukuria `payroll_profiles` lentelę (§6.5 architektūros dok'e + docx §6.5).
 *     Darbuotojo finansinis profilis — atlyginimas bruto + priedai per
 *     tenant'ą. Pagal ADR-003 — TIK bruto, BE Sodra/GPM mokesčių apskaitos.
 *     - `vardas_pavarde` redundant copy: leidžia turėti darbuotoją be
 *       `users` įrašo (pvz., paslaugų sutartis su trečiąja šalimi). Jei
 *       `user_id` ne NULL — turi būti sync'inta su `users.full_name`
 *       (servisas atsakingas).
 *     - `sutarties_tipas` ('darbo' | 'paslaugu' | 'autorine') apribojamas
 *       per PostgreSQL CHECK constraint, pridėtą per `knex.raw` (Knex
 *       schema builder neturi tiesioginio `.check(...)` API enum'ams).
 *     - `galioja_nuo` / `galioja_iki` — istorinė versija: profilis gali
 *       keistis kas mėnesį, todėl saugom periodus. Jei `galioja_iki` NULL —
 *       profilis vis dar galioja.
 *
 *  2. Sukuria `payroll_distributions` lentelę (§6.6).
 *     Per kiekvieną profilį — kiek procentų arba kokia fiksuota suma iš
 *     kiekvieno finansavimo šaltinio. Paskirstymas gali keistis per laiką
 *     (istorinės versijos per galioja_nuo/galioja_iki).
 *     - `paskirstymo_tipas` ('procentais' | 'fiksuota') per CHECK constraint.
 *     - `reiksme` decimal(10, 4) — leidžia tikslius procentus (pvz. 33.3333%)
 *       arba fiksuotas sumas eurais. SUM(procentais.reiksme) per profile per
 *       periodą ≤ 100 — tikrinama servise (per-row CHECK nepakanka).
 *
 *  3. Sukuria indeksus:
 *     - `idx_payroll_profiles_tenant` (tenant_id) — tenant scope query'ams
 *       (org_admin filter'ina pagal savo tenant).
 *     - `idx_payroll_profiles_user` (user_id) — user'io profilio paieška
 *       (nors per docx §4.4 specialistas savo nemato — administracinės
 *       UI funkcijos visgi naudoja).
 *     - `idx_payroll_distributions_profile` (payroll_profile_id) — visi
 *       distributions per profile (CASCADE delete naudoja).
 *     - `idx_payroll_distributions_source` (funding_source_id) — agregacijos
 *       per finansavimo šaltinį (mėnesinis recompute, ataskaitos).
 *
 * FK politika (ON DELETE):
 *  - payroll_profiles.tenant_id          -> RESTRICT (tenant ištrynimas
 *                                            blokuojamas, kol yra profilių —
 *                                            duomenų integralumas).
 *  - payroll_profiles.user_id            -> SET NULL (user ištrynimas
 *                                            leidžiamas; profile išlieka su
 *                                            user_id NULL — istorinis DU
 *                                            įrašas turi išlikti net jei
 *                                            user paskyra panaikinama).
 *                                            `vardas_pavarde` ne-NULL — todėl
 *                                            niekas „neprapuola".
 *  - payroll_distributions.payroll_profile_id -> CASCADE (ištrynus profilį,
 *                                            jo distributions automatiškai
 *                                            ištrinami — distribution'as be
 *                                            profile prasmės neturi).
 *  - payroll_distributions.funding_source_id  -> RESTRICT (finansavimo
 *                                            šaltinio ištrynimas blokuojamas,
 *                                            kol yra rišamų distributions —
 *                                            ataskaitų istorija privalo
 *                                            išlikti pilna).
 *
 * Viskas vyksta vienoje `knex.transaction` — jei kuris žingsnis fail'ina,
 * viskas roll'inasi atgal.
 *
 * `down` aiškumo dėl drop'ina abi lenteles eksplicit'iškai. CASCADE delete
 * iš `payroll_profiles` automatiškai ištrintų `payroll_distributions`, bet
 * mes drop'inam pirma children (distributions), kad order būtų aiškus.
 * PostgreSQL `DROP TABLE` automatiškai pašalina kartu visus CHECK
 * constraint'us, indeksus ir FK constraint'us, susijusius su šių lentelių
 * kolonomis.
 *
 * Susiję dokumentai:
 *  - docs/fvm/01-architecture.md — payroll_profiles + payroll_distributions (§6.5, §6.6)
 *  - docs/fvm/spec/FVM-v0.1.md — §4.4, §6.5, §6.6
 *  - docs/fvm/03-decisions-log.md — ADR-003 (tik bruto, ne Sodra/GPM), ADR-004 (SERIAL PK)
 *  - docs/fvm/iter-13-payroll.md — DBA brief
 */
import type { Knex } from 'knex';

const PROFILES_SUTARTIES_TIPAS_CHECK = 'payroll_profiles_sutarties_tipas_check';
const DISTRIBUTIONS_PASKIRSTYMO_TIPAS_CHECK =
  'payroll_distributions_paskirstymo_tipas_check';

export async function up(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // 1) Sukuriam `payroll_profiles` lentelę.
    await trx.schema.createTable('payroll_profiles', (t) => {
      t.increments('id').primary();
      t.integer('tenant_id')
        .notNullable()
        .references('id')
        .inTable('tenants')
        .onDelete('RESTRICT');
      // user_id NULL — leidžia darbuotoją be sistemos paskyros (pvz., paslaugų
      // sutartis su trečiąja šalimi). SET NULL — kad ištrynus user'į
      // profile nebūtų prarastas (istorinis DU įrašas).
      t.integer('user_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL');
      // Redundant copy: jei `user_id` NULL, vardas_pavarde turi būti
      // įvestas rankomis; jei ne NULL — servisas sync'ina su
      // `users.full_name` (pakeitimai user'yje neauto-propaguoja, kad
      // istorinė versija išliktų stabili).
      t.string('vardas_pavarde', 200).notNullable();
      t.string('pareigos', 200).notNullable();
      // sutarties_tipas IN ('darbo', 'paslaugu', 'autorine') — CHECK
      // pridedamas atskirai per raw SQL.
      t.string('sutarties_tipas', 20).notNullable();
      // Bruto atlyginimas — ADR-003: be Sodra/GPM apskaitos.
      t.decimal('atlyginimas_bruto', 10, 2).notNullable();
      t.decimal('priedai', 10, 2).notNullable().defaultTo(0);
      t.date('galioja_nuo').notNullable();
      t.date('galioja_iki').nullable();
      t.timestamp('created_at', { useTz: true })
        .notNullable()
        .defaultTo(trx.fn.now());
      t.timestamp('updated_at', { useTz: true })
        .notNullable()
        .defaultTo(trx.fn.now());

      t.index(['tenant_id'], 'idx_payroll_profiles_tenant');
      t.index(['user_id'], 'idx_payroll_profiles_user');
    });

    // 2) CHECK constraint sutarties_tipas — Knex schema builder neturi
    //    tiesioginio Postgres-style `.check()` API enum'ams. Constraint
    //    name fixed, kad `down` (per DROP TABLE) galėtų drop'inti
    //    automatiškai ir kad PG error message būtų atpažįstamas test'uose.
    await trx.raw(`
      ALTER TABLE payroll_profiles
        ADD CONSTRAINT ${PROFILES_SUTARTIES_TIPAS_CHECK}
        CHECK (sutarties_tipas IN ('darbo', 'paslaugu', 'autorine'))
    `);

    // 3) Sukuriam `payroll_distributions` lentelę.
    await trx.schema.createTable('payroll_distributions', (t) => {
      t.increments('id').primary();
      // CASCADE — ištrynus profile, jo distributions automatiškai ištrinami.
      // Distribution be profile prasmės neturi.
      t.integer('payroll_profile_id')
        .notNullable()
        .references('id')
        .inTable('payroll_profiles')
        .onDelete('CASCADE');
      // RESTRICT — finansavimo šaltinio ištrynimas blokuojamas, kol yra
      // rišamų distributions (ataskaitų istorija privalo išlikti pilna).
      t.integer('funding_source_id')
        .notNullable()
        .references('id')
        .inTable('funding_sources')
        .onDelete('RESTRICT');
      // paskirstymo_tipas IN ('procentais', 'fiksuota') — CHECK atskirai per raw.
      t.string('paskirstymo_tipas', 20).notNullable();
      // decimal(10, 4) — leidžia tikslius procentus (pvz. 33.3333%) arba
      // fiksuotas sumas eurais. SUM(procentais.reiksme) per profile per
      // overlap'inantį periodą ≤ 100 — tikrinama servise (ne DB CHECK,
      // nes per-row CHECK negali agreguoti).
      t.decimal('reiksme', 10, 4).notNullable();
      t.date('galioja_nuo').notNullable();
      t.date('galioja_iki').nullable();
      t.timestamp('created_at', { useTz: true })
        .notNullable()
        .defaultTo(trx.fn.now());
      t.timestamp('updated_at', { useTz: true })
        .notNullable()
        .defaultTo(trx.fn.now());

      t.index(['payroll_profile_id'], 'idx_payroll_distributions_profile');
      t.index(['funding_source_id'], 'idx_payroll_distributions_source');
    });

    // 4) CHECK constraint paskirstymo_tipas.
    await trx.raw(`
      ALTER TABLE payroll_distributions
        ADD CONSTRAINT ${DISTRIBUTIONS_PASKIRSTYMO_TIPAS_CHECK}
        CHECK (paskirstymo_tipas IN ('procentais', 'fiksuota'))
    `);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // ORDER MATTERS: payroll_distributions turi FK į payroll_profiles
    // (CASCADE), todėl pirma drop'inam children (distributions), tada
    // parent (profiles). PostgreSQL DROP TABLE kartu pašalina visus CHECK
    // constraint'us, indeksus ir FK constraint'us, susijusius su šios
    // lentelės kolonomis. Aiškumo dėl drop'inam abi eksplicit'iškai.
    await trx.schema.dropTableIfExists('payroll_distributions');
    await trx.schema.dropTableIfExists('payroll_profiles');
  });
}
