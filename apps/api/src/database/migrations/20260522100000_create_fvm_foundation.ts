/**
 * Iter 9 (FVM-1): Foundation — funding_sources + budget_allocations_v2.
 *
 * Ką daro ši migracija:
 *  1. Sukuria `funding_sources` lentelę (1 lygis FVM hierarchijoje).
 *     "Iš kur pinigai?" — Valstybės biudžetas, ES fondai, kt.
 *  2. Sukuria `budget_allocations_v2` lentelę (2 lygis).
 *     "Kam skiriama?" — DU, spec.programa, prekės/paslaugos, investicijos, kita.
 *     Pavadinimas su `_v2` suffix'u, kad nesimaišytų su senuoju
 *     `budget_allocations` (DROP'insim Iter 16 po staging UAT).
 *  3. Idempotent'iškai seedina klasifikatorius:
 *     - Grupė `funding_source_type` + items biudzetas/es/kita
 *     - Grupė `budget_category` + items du/spec_programa/prekes_paslaugos/
 *       investicijos/kita
 *  4. Pervaro esamus `budgets` + `budget_allocations` įrašus į naują schemą
 *     (žr. docs/fvm/02-migration-strategy.md Žingsnis 2 pseudokoduką).
 *  5. Iškviečia `verifyFvmFoundation` — jei FAIL → transaction rollback'inasi.
 *
 * Viskas vyksta vienoje `knex.transaction` — atominė operacija.
 *
 * `down`: drop'ina naujas lenteles ir naujus seedinamus klasifikatorius
 * (tik tuos, kuriuos pati šita migracija pridėjo, ir tik jei niekas iš
 * kitur į juos nereferuoja).
 *
 * Susiję dokumentai:
 *  - docs/fvm/01-architecture.md (galutinis schema)
 *  - docs/fvm/02-migration-strategy.md (data migration detalės)
 *  - docs/fvm/iter-09-foundation.md (CTO brief)
 */
import type { Knex } from 'knex';
import { verifyFvmFoundation } from './utils/verify-fvm-foundation';

// --- Klasifikatorių seed konstantos -----------------------------------------

interface ClassifierItemSeed {
  code: string;
  name: string;
  sortOrder: number;
}

interface ClassifierGroupSeed {
  code: string;
  name: string;
  description: string;
  items: ClassifierItemSeed[];
}

const FUNDING_SOURCE_TYPE_GROUP: ClassifierGroupSeed = {
  code: 'funding_source_type',
  name: 'Finansavimo šaltinio tipas',
  description:
    'Finansavimo šaltinio tipas (1 FVM lygio kategorija). ' +
    'Naudoja funding_sources.tipas_classifier_item_id.',
  items: [
    { code: 'biudzetas', name: 'Valstybės biudžetas', sortOrder: 10 },
    { code: 'es', name: 'ES fondai', sortOrder: 20 },
    { code: 'kita', name: 'Kiti', sortOrder: 99 },
  ],
};

const BUDGET_CATEGORY_GROUP: ClassifierGroupSeed = {
  code: 'budget_category',
  name: 'Biudžeto kategorija',
  description:
    'Biudžeto paskirstymo kategorija (2 FVM lygio). ' +
    'Naudoja budget_allocations.category_classifier_item_id.',
  items: [
    { code: 'du', name: 'Darbo užmokestis', sortOrder: 10 },
    { code: 'spec_programa', name: 'Specialioji programa', sortOrder: 20 },
    { code: 'prekes_paslaugos', name: 'Prekės ir paslaugos', sortOrder: 30 },
    { code: 'investicijos', name: 'Investicijos', sortOrder: 40 },
    { code: 'kita', name: 'Kita', sortOrder: 99 },
  ],
};

// --- Helper'iai --------------------------------------------------------------

interface ClassifierGroupRow {
  id: number;
  code: string;
}

interface ClassifierItemRow {
  id: number;
  group_id: number;
  code: string;
  name: string;
}

/**
 * Idempotent'iškai įdeda klasifikatoriaus grupę su jos items.
 * Jei grupė jau egzistuoja — naudoja esamą. Jei items'as jau yra
 * pagal (group_id, code) — praleidžia.
 */
async function ensureClassifierGroup(
  trx: Knex.Transaction,
  seed: ClassifierGroupSeed,
): Promise<{ groupId: number; itemIdsByCode: Record<string, number> }> {
  let group = (await trx('classifier_groups')
    .where({ code: seed.code })
    .first<ClassifierGroupRow>()) as ClassifierGroupRow | undefined;

  if (!group) {
    const inserted = (await trx('classifier_groups')
      .insert({
        code: seed.code,
        name: seed.name,
        description: seed.description,
        active: true,
      })
      .returning(['id', 'code'])) as ClassifierGroupRow[];
    if (!inserted[0]) {
      throw new Error(`Nepavyko sukurti classifier_group: ${seed.code}`);
    }
    group = inserted[0];
  }

  const itemIdsByCode: Record<string, number> = {};
  for (const item of seed.items) {
    const existing = (await trx('classifier_items')
      .where({ group_id: group.id, code: item.code })
      .first<ClassifierItemRow>()) as ClassifierItemRow | undefined;

    if (existing) {
      itemIdsByCode[item.code] = existing.id;
      continue;
    }

    const insertedItems = (await trx('classifier_items')
      .insert({
        group_id: group.id,
        parent_id: null,
        code: item.code,
        name: item.name,
        sort_order: item.sortOrder,
        active: true,
      })
      .returning(['id', 'group_id', 'code', 'name'])) as ClassifierItemRow[];
    const newItem = insertedItems[0];
    if (!newItem) {
      throw new Error(
        `Nepavyko įdėti classifier_item: ${seed.code}:${item.code}`,
      );
    }
    itemIdsByCode[item.code] = newItem.id;
  }

  return { groupId: group.id, itemIdsByCode };
}

/**
 * Heuristikas: pagal seno classifier_item kodą ar pavadinimą — nuspėti,
 * į kurią `budget_category` kategoriją mapinti.
 *
 * Mapping rules (case-insensitive, žodžio dalys):
 *  - "salary" arba "atlyginim" arba "DU"  → du
 *  - "spec"   → spec_programa
 *  - "invest" → investicijos
 *  - "IT", "training", "communication", "procurement", "prekes", "paslaug"
 *      → prekes_paslaugos
 *  - kita → kita
 *
 * Tikslas — neprarasti senų duomenų semantikos, kai jie reflektuoja
 * lėšų tipus iš `funding_type` grupės (pvz., SALARY → du, IT → prekes_paslaugos).
 */
function mapOldItemToBudgetCategory(
  oldItem: { code: string; name: string },
): 'du' | 'spec_programa' | 'prekes_paslaugos' | 'investicijos' | 'kita' {
  const blob = `${oldItem.code} ${oldItem.name}`.toLowerCase();
  if (
    blob.includes('salary') ||
    blob.includes('atlyginim') ||
    blob.match(/\bdu\b/)
  ) {
    return 'du';
  }
  if (blob.includes('spec')) return 'spec_programa';
  if (blob.includes('invest')) return 'investicijos';
  if (
    blob.includes(' it ') ||
    blob.startsWith('it ') ||
    blob.endsWith(' it') ||
    blob === 'it' ||
    blob.includes('training') ||
    blob.includes('mokym') ||
    blob.includes('communication') ||
    blob.includes('komunikac') ||
    blob.includes('procurement') ||
    blob.includes('pirkim') ||
    blob.includes('prekes') ||
    blob.includes('paslaug')
  ) {
    return 'prekes_paslaugos';
  }
  return 'kita';
}

interface OldBudgetRow {
  id: number;
  year: number;
  total_amount: string | number;
  notes: string | null;
}

interface OldAllocationRow {
  id: number;
  budget_id: number;
  classifier_item_id: number;
  amount: string | number;
}

interface TenantRow {
  id: number;
  code: string;
}

/**
 * Pervaro senus `budgets` + `budget_allocations` įrašus į naują FVM schemą.
 *
 * Per kiekvieną seną `budgets` įrašą:
 *  - Sukuria `funding_sources` įrašą su tipas='biudzetas' (default),
 *    metine_suma = old.total_amount.
 *  - Per kiekvieną seną `budget_allocations` (priklausantį tam biudžetui):
 *     - Atranda atitinkamą `budget_category` classifier item (heuristikos
 *       per `mapOldItemToBudgetCategory`).
 *     - Sukuria `budget_allocations_v2` įrašą su funding_source_id, kategorija,
 *       pavadinimas (iš seno classifier_item.name), planuota_suma, metai.
 *
 * Jei nėra AM tenant'o (kodas 'AM') — skip silently, NĖRA ką migruoti
 * (greenfield aplinka, pvz., test setup'as kur dar nesodintos esybės).
 */
async function migrateOldBudgetData(
  trx: Knex.Transaction,
  budgetCategoryItemIds: Record<string, number>,
  fundingSourceTypeItemIds: Record<string, number>,
): Promise<void> {
  const amTenant = (await trx('tenants')
    .where({ code: 'AM' })
    .first<TenantRow>()) as TenantRow | undefined;
  if (!amTenant) {
    return;
  }

  const oldBudgets = (await trx('budgets').select<OldBudgetRow[]>(
    'id',
    'year',
    'total_amount',
    'notes',
  )) as OldBudgetRow[];
  if (oldBudgets.length === 0) {
    return;
  }

  const biudzetasTypeId = fundingSourceTypeItemIds['biudzetas'];
  if (biudzetasTypeId === undefined) {
    throw new Error(
      `[FVM migration] funding_source_type 'biudzetas' classifier item missing`,
    );
  }

  for (const oldBudget of oldBudgets) {
    const inserted = (await trx('funding_sources')
      .insert({
        tenant_id: amTenant.id,
        pavadinimas: `Valstybės biudžetas ${oldBudget.year}`,
        kodas: `VB-${oldBudget.year}`,
        tipas_classifier_item_id: biudzetasTypeId,
        metai: oldBudget.year,
        metine_suma: oldBudget.total_amount,
        aprasymas: oldBudget.notes ?? 'Migruota iš senos budgets lentelės',
        aktyvus: true,
      })
      .returning(['id'])) as Array<{ id: number }>;
    const newSourceId = inserted[0]?.id;
    if (newSourceId === undefined) {
      throw new Error(
        `Nepavyko sukurti funding_source per budgets ${oldBudget.year}`,
      );
    }

    const oldAllocations = (await trx('budget_allocations')
      .where({ budget_id: oldBudget.id })
      .select<OldAllocationRow[]>(
        'id',
        'budget_id',
        'classifier_item_id',
        'amount',
      )) as OldAllocationRow[];

    for (const oldAlloc of oldAllocations) {
      const oldItem = (await trx('classifier_items')
        .where({ id: oldAlloc.classifier_item_id })
        .first<{ id: number; code: string; name: string }>()) as
        | { id: number; code: string; name: string }
        | undefined;
      if (!oldItem) {
        throw new Error(
          `Senas classifier_item ${oldAlloc.classifier_item_id} nerastas (allocation ${oldAlloc.id})`,
        );
      }
      const categoryCode = mapOldItemToBudgetCategory(oldItem);
      const categoryItemId = budgetCategoryItemIds[categoryCode];
      if (categoryItemId === undefined) {
        throw new Error(
          `budget_category '${categoryCode}' classifier item missing`,
        );
      }

      await trx('budget_allocations_v2').insert({
        funding_source_id: newSourceId,
        category_classifier_item_id: categoryItemId,
        pavadinimas: oldItem.name,
        spec_prog_tipas: null,
        planuota_suma: oldAlloc.amount,
        metai: oldBudget.year,
        pastabos: 'Migruota iš senos budget_allocations lentelės',
      });
    }
  }
}

// --- Migracija --------------------------------------------------------------

export async function up(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // 1) funding_sources lentelė.
    await trx.schema.createTable('funding_sources', (t) => {
      t.increments('id').primary();
      t.integer('tenant_id')
        .notNullable()
        .references('id')
        .inTable('tenants')
        .onDelete('RESTRICT');
      t.string('pavadinimas', 200).notNullable();
      t.string('kodas', 50).notNullable();
      // Docx siūlo enum, mes naudojam klasifikatorių (ADR-001).
      t.integer('tipas_classifier_item_id')
        .notNullable()
        .references('id')
        .inTable('classifier_items')
        .onDelete('RESTRICT');
      t.integer('metai').notNullable();
      t.decimal('metine_suma', 15, 2).notNullable();
      t.text('aprasymas').nullable();
      t.boolean('aktyvus').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(trx.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(trx.fn.now());

      t.unique(['tenant_id', 'kodas', 'metai']);
      t.index(['tenant_id', 'metai'], 'idx_funding_sources_tenant_year');
    });

    // 2) budget_allocations_v2 lentelė.
    await trx.schema.createTable('budget_allocations_v2', (t) => {
      t.increments('id').primary();
      t.integer('funding_source_id')
        .notNullable()
        .references('id')
        .inTable('funding_sources')
        .onDelete('RESTRICT');
      // Docx siūlo enum kategorija, mes naudojam klasifikatorių (ADR-001).
      t.integer('category_classifier_item_id')
        .notNullable()
        .references('id')
        .inTable('classifier_items')
        .onDelete('RESTRICT');
      t.string('pavadinimas', 200).notNullable();
      // Tik spec.programoms (kai kategorija = spec_programa).
      t.string('spec_prog_tipas', 20).nullable();
      t.decimal('planuota_suma', 15, 2).notNullable();
      t.integer('metai').notNullable();
      t.text('pastabos').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(trx.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(trx.fn.now());

      t.index(['funding_source_id'], 'idx_budget_allocations_v2_source');
      t.index(['metai'], 'idx_budget_allocations_v2_year');
    });

    // CHECK constraint spec_prog_tipas — Knex.schema neturi tiesiogiai
    // .check() Postgres-style, todėl raw'iniai. Constraint name'as fixed,
    // kad galima būtų drop'inti per down (jei reikės).
    await trx.raw(`
      ALTER TABLE budget_allocations_v2
        ADD CONSTRAINT budget_allocations_v2_spec_prog_tipas_check
        CHECK (spec_prog_tipas IS NULL OR spec_prog_tipas IN ('atskiras', 'biudzeto_dalis'))
    `);

    // 3) Idempotentiškai seedinam klasifikatorius.
    const fundingSourceType = await ensureClassifierGroup(
      trx,
      FUNDING_SOURCE_TYPE_GROUP,
    );
    const budgetCategory = await ensureClassifierGroup(
      trx,
      BUDGET_CATEGORY_GROUP,
    );

    // 4) Data migration: pervaro senus įrašus į naujas lenteles.
    await migrateOldBudgetData(
      trx,
      budgetCategory.itemIdsByCode,
      fundingSourceType.itemIdsByCode,
    );

    // 5) Integritetinis check — jei FAIL, throw -> auto rollback.
    await verifyFvmFoundation(trx);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // 1) Drop'inam naujas lenteles. ORDER MATTERS: budget_allocations_v2 FK
    //    rodo į funding_sources, todėl pirma jis.
    await trx.schema.dropTableIfExists('budget_allocations_v2');
    await trx.schema.dropTableIfExists('funding_sources');

    // 2) Pašalinam seedinamus klasifikatorius — TIK jei niekas į juos
    //    nereferuoja (saugumo dėlei nebandom kaskadiškai trintinti).
    await safeRemoveClassifierGroup(trx, FUNDING_SOURCE_TYPE_GROUP.code);
    await safeRemoveClassifierGroup(trx, BUDGET_CATEGORY_GROUP.code);
  });
}

/**
 * Saugiai pašalina klasifikatoriaus grupę kartu su items'ais,
 * BET tik tuomet, jei nė vienas items nėra naudojamas jokiose FK referuojančiose
 * lentelėse. Atsargumas: jei kažkas iš išorės jau referuoja į šitą item,
 * praleidžiam tylėdami (down rollback'as nesinaikina production duomenų).
 */
async function safeRemoveClassifierGroup(
  trx: Knex.Transaction,
  groupCode: string,
): Promise<void> {
  const group = (await trx('classifier_groups')
    .where({ code: groupCode })
    .first<{ id: number }>()) as { id: number } | undefined;
  if (!group) return;

  const items = (await trx('classifier_items')
    .where({ group_id: group.id })
    .select<Array<{ id: number }>>('id')) as Array<{ id: number }>;
  if (items.length === 0) {
    await trx('classifier_groups').where({ id: group.id }).del();
    return;
  }
  const itemIds = items.map((i) => i.id);

  // Patikrinam, ar kažkas iš dar likusių lentelių (po table drop'o)
  // referuoja į šituos items. Jei taip — neliečiam.
  const referencingTables: Array<{ table: string; column: string }> = [
    { table: 'budget_allocations', column: 'classifier_item_id' },
    // requests gali turėti decision_funding_source kaip TEXT (legacy), todėl jo
    // čia neminam. Jei ateityje atsiras FK column į classifier_items —
    // pridėti čia.
  ];

  for (const ref of referencingTables) {
    const hasTable = await trx.schema.hasTable(ref.table);
    if (!hasTable) continue;
    const hasColumn = await trx.schema.hasColumn(ref.table, ref.column);
    if (!hasColumn) continue;
    const usedRow = (await trx(ref.table)
      .whereIn(ref.column, itemIds)
      .first<{ id: number }>()) as { id: number } | undefined;
    if (usedRow) {
      // Yra naudojimų — nedrop'inam, kad nedingtų prod referencijos.
      return;
    }
  }

  await trx('classifier_items').where({ group_id: group.id }).del();
  await trx('classifier_groups').where({ id: group.id }).del();
}
