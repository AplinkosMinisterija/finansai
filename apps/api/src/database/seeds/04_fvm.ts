/**
 * Iter 16 (FVM-8): FVM demo duomenų seed'as.
 *
 * Sukuria realistic FVM datą AM tenant'e 2026 metams:
 *  - 2 funding_sources (VB 1.5M + ES 500k)
 *  - 5 budget_allocations per kategorijas (DU/spec/PP/inv/kita)
 *  - 1 spec.programos request (APPROVED) → 1 spec.programa projektas
 *  - 1 regular projektas (tipas=projektas)
 *  - 5 expenses (mix single + multi-source split)
 *  - 2 payroll_profiles + 4 payroll_distributions
 *  - 1 computeMonth simuliacija (kovas 2026) → DU expenses
 *
 * **Idempotency**: prieš kūrybą tikrinama, ar AM tenant'e yra `kodas=VB-2026-FVM`
 * funding_source. Jei taip — visas seed'as praleidžiamas (idempotent skip).
 * Tai leidžia `yarn db:seed` paleisti pakartotinai be klaidų.
 *
 * **Failo numeris (`04`)**: 02 ir 03 prefiksai jau užimti (`02_classifiers_and_budget`,
 * `03_demo_workflows`). Knex paleidžia seed'us pagal failo pavadinimą ASCII tvarka,
 * todėl `04_fvm` paleidžiamas paskutinis — kai jau yra tenants, users, klasifikatoriai
 * IR FVM lentelės (sukurtos per FVM migracijas).
 *
 * **Sąlyga**: paleidžiamas TIK jei egzistuoja FVM lentelės (`funding_sources` etc.).
 * Greenfield aplinkoje, jei migracijos nepaleistos — seed'as silent skip.
 *
 * Susiję dokumentai:
 *  - docs/fvm/iter-16-deploy.md — DevOps brief
 *  - docs/fvm/01-architecture.md — schema
 *  - apps/api/src/services/payroll.service.ts — DU sistemos projektai
 */
import type { Knex } from 'knex';

// --- Konstantos -------------------------------------------------------------

/** Unique sentinel kodas — pagal jį atpažįstam, ar seed'as jau buvo paleistas. */
const SENTINEL_FUNDING_SOURCE_KODAS = 'VB-2026-FVM';
const FVM_YEAR = 2026;

// --- Tipai ------------------------------------------------------------------

interface TenantRow {
  id: number;
  code: string;
}

interface UserRow {
  id: number;
  username: string;
}

interface ClassifierItemRow {
  id: number;
  code: string;
}

// --- Helper'iai -------------------------------------------------------------

/**
 * Patikrina, ar visos privalomos FVM lentelės egzistuoja. Jei ne — seed'as
 * praleidžiamas (greenfield aplinka, migracijos dar nepaleistos).
 */
async function fvmTablesExist(knex: Knex): Promise<boolean> {
  const tables = [
    'funding_sources',
    'budget_allocations_v2',
    'projects',
    'expenses',
    'payroll_profiles',
    'payroll_distributions',
  ];
  for (const t of tables) {
    if (!(await knex.schema.hasTable(t))) {
      return false;
    }
  }
  return true;
}

/**
 * Idempotency check: ar šis FVM seed jau buvo paleistas? Tikrinama per
 * unique sentinel funding_source.kodas. Jei yra — return true → skip.
 */
async function alreadySeeded(knex: Knex): Promise<boolean> {
  const existing = await knex('funding_sources')
    .where({ kodas: SENTINEL_FUNDING_SOURCE_KODAS })
    .first('id');
  return Boolean(existing);
}

/** Surenka klasifikatoriaus item'us pagal grupės kodą — atgalinio lookup'o helper'is. */
async function getClassifierItems(knex: Knex, groupCode: string): Promise<Map<string, number>> {
  const rows = (await knex('classifier_items as ci')
    .join('classifier_groups as cg', 'cg.id', 'ci.group_id')
    .where('cg.code', groupCode)
    .select<ClassifierItemRow[]>('ci.id', 'ci.code')) as ClassifierItemRow[];
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(r.code, r.id);
  }
  return m;
}

/**
 * Idempotent'iškai užtikrina, kad FVM klasifikatorių grupės + items
 * egzistuoja. Reikalinga, nes seed'as `02_classifiers_and_budget.ts`
 * truncatina visus classifier_items — įskaitant FVM grupes (sukurtas per
 * migraciją 20260522100000). Be šito helper'io, 04_fvm reštart'avę
 * `yarn db:seed` būtų nepakankamai resilient'inis.
 */
async function ensureFvmClassifiers(knex: Knex): Promise<void> {
  interface GroupSeed {
    code: string;
    name: string;
    description: string;
    items: Array<{ code: string; name: string; sortOrder: number }>;
  }
  const groups: GroupSeed[] = [
    {
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
    },
    {
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
    },
  ];

  for (const g of groups) {
    let group = (await knex('classifier_groups')
      .where({ code: g.code })
      .first<{ id: number }>('id')) as { id: number } | undefined;

    if (!group) {
      const [inserted] = (await knex('classifier_groups')
        .insert({
          code: g.code,
          name: g.name,
          description: g.description,
          active: true,
        })
        .returning('id')) as Array<{ id: number }>;
      if (!inserted) {
        throw new Error(`[04_fvm] Nepavyko sukurti classifier_group: ${g.code}`);
      }
      group = inserted;
    }

    for (const item of g.items) {
      const existing = await knex('classifier_items')
        .where({ group_id: group.id, code: item.code })
        .first('id');
      if (existing) continue;
      await knex('classifier_items').insert({
        group_id: group.id,
        parent_id: null,
        code: item.code,
        name: item.name,
        sort_order: item.sortOrder,
        active: true,
      });
    }
  }
}

/** Suformuoja YYYY-MM-DD date string'ą. */
function dateStr(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** Mėnesio paskutinė diena (DU expense'ams). */
function lastDayOfMonth(year: number, month: number): string {
  // PG akceptuoja YYYY-MM-DD; sukuriam Date ir paimam paskutinę dieną mėnesyje.
  const d = new Date(year, month, 0); // month=3 → kovo 31 (paskutinė kovo diena)
  return dateStr(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// --- Seed funkcija ----------------------------------------------------------

export async function seed(knex: Knex): Promise<void> {
  // 0) Sanity check: FVM lentelės.
  if (!(await fvmTablesExist(knex))) {
    // Migracijos dar nepaleistos — silent skip (greenfield setup, tests).
    return;
  }

  // 1) Idempotency: jei jau seed'inta — skip.
  if (await alreadySeeded(knex)) {
    return;
  }

  // 2) Resolvinam AM tenant'ą.
  const amTenant = (await knex('tenants').where({ code: 'AM' }).first<TenantRow>()) as
    | TenantRow
    | undefined;
  if (!amTenant) {
    // AM tenant'as turi būti sukurtas per 01_initial seed'ą. Jei jo nėra —
    // greenfield / broken state. Silent skip — neturim ką FVM duomenyse rišti.
    return;
  }

  // 3) Resolvinam reikalingus user'ius (am-admin commiter'iui, am-user backup'as).
  const amAdmin = (await knex('users').where({ username: 'am-admin' }).first<UserRow>()) as
    | UserRow
    | undefined;
  const amUser = (await knex('users').where({ username: 'am-user' }).first<UserRow>()) as
    | UserRow
    | undefined;
  const creatorUserId = amAdmin?.id ?? amUser?.id;
  if (creatorUserId === undefined) {
    // Be AM admin/user user'io negalim sukurti expense'ų ar request'ų.
    return;
  }

  // 4) Resolvinam klasifikatorius. funding_source_type + budget_category yra
  //    sukurti per `20260522100000_create_fvm_foundation` migraciją, bet
  //    seed'as `02_classifiers_and_budget.ts` truncatina visus classifier_items —
  //    todėl pirma re-ensure'inam FVM grupes (idempotent).
  await ensureFvmClassifiers(knex);
  const fundingTypeItems = await getClassifierItems(knex, 'funding_source_type');
  const budgetCategoryItems = await getClassifierItems(knex, 'budget_category');

  const biudzetasTypeId = fundingTypeItems.get('biudzetas');
  const esTypeId = fundingTypeItems.get('es');
  if (biudzetasTypeId === undefined || esTypeId === undefined) {
    throw new Error(
      "[04_fvm] funding_source_type klasifikatoriaus item'ai (biudzetas/es) nerasti — paleisk FVM migracijas",
    );
  }

  // UAT #42 (PA-005): susiejam source_program reikšmes su funding_source_type
  // tėvais (šaltinis → programa hierarchija). AM IT/mokymų/vystymo programos →
  // valstybės biudžetas; ES fondai → ES. Idempotent — update'inam parent_id.
  const sourceProgramItems = await getClassifierItems(knex, 'source_program');
  const sourceProgramParents: Record<string, number> = {
    AM_IT_BUDGET: biudzetasTypeId,
    AM_TRAINING_BUDGET: biudzetasTypeId,
    AM_DEVELOPMENT: biudzetasTypeId,
    EU_FUNDS: esTypeId,
  };
  for (const [code, parentId] of Object.entries(sourceProgramParents)) {
    const itemId = sourceProgramItems.get(code);
    if (itemId !== undefined) {
      await knex('classifier_items').where({ id: itemId }).update({ parent_id: parentId });
    }
  }

  const categoryDuId = budgetCategoryItems.get('du');
  const categorySpecId = budgetCategoryItems.get('spec_programa');
  const categoryPpId = budgetCategoryItems.get('prekes_paslaugos');
  const categoryInvId = budgetCategoryItems.get('investicijos');
  const categoryKitaId = budgetCategoryItems.get('kita');
  if (
    categoryDuId === undefined ||
    categorySpecId === undefined ||
    categoryPpId === undefined ||
    categoryInvId === undefined ||
    categoryKitaId === undefined
  ) {
    throw new Error(
      "[04_fvm] budget_category klasifikatoriaus item'ai nerasti — paleisk FVM migracijas",
    );
  }

  // #6 demo: patvirtintiems prašymams (be FVM kategorijos) priskiriam biudžeto
  // kategoriją. Po UAT #42 PA-004 USER jos nebepildo — ją nustato AM tvirtindamas;
  // be šito „Pagal biudžeto kategoriją" diagrama liktų tuščia. Paskirstom
  // round-robin per ne-DU kategorijas (DU skirta payroll'ui), kad būtų įvairovė.
  const approvedForCategory = (await knex('requests')
    .where({ status: 'APPROVED' })
    .whereNull('budget_category_id')
    .orderBy('id', 'asc')
    .select('id')) as Array<{ id: number }>;
  const categoryRotation = [categoryPpId, categoryInvId, categorySpecId, categoryKitaId];
  for (let i = 0; i < approvedForCategory.length; i++) {
    await knex('requests')
      .where({ id: approvedForCategory[i]!.id })
      .update({ budget_category_id: categoryRotation[i % categoryRotation.length]! });
  }

  // Visas darbas vyksta vienoje transakcijoje — atominė operacija. Jei kuris
  // žingsnis fail'ina, viskas roll'inasi atgal.
  await knex.transaction(async (trx) => {
    // ── A) Funding sources (2 vnt: VB + ES) ─────────────────────────────
    const [vbSource] = (await trx('funding_sources')
      .insert({
        tenant_id: amTenant.id,
        pavadinimas: 'Valstybės biudžetas 2026',
        kodas: SENTINEL_FUNDING_SOURCE_KODAS,
        tipas_classifier_item_id: biudzetasTypeId,
        metai: FVM_YEAR,
        metine_suma: '1500000.00',
        aprasymas: 'AM 2026 m. VB lėšos. Demo FVM seed.',
        aktyvus: true,
      })
      .returning(['id'])) as Array<{ id: number }>;
    if (!vbSource) throw new Error('Nepavyko sukurti VB funding_source');

    const [esSource] = (await trx('funding_sources')
      .insert({
        tenant_id: amTenant.id,
        pavadinimas: 'ES fondai 2026',
        kodas: 'ES-2026-FVM',
        tipas_classifier_item_id: esTypeId,
        metai: FVM_YEAR,
        metine_suma: '500000.00',
        aprasymas: 'AM 2026 m. ES struktūrinių fondų lėšos. Demo FVM seed.',
        aktyvus: true,
      })
      .returning(['id'])) as Array<{ id: number }>;
    if (!esSource) throw new Error('Nepavyko sukurti ES funding_source');

    // ── B) Budget allocations (5 vnt) ───────────────────────────────────
    // Bendra suma = 400k + 200k + 600k + 300k + 500k = 2 000 000
    //  VB (1.5M): DU 400k + spec 200k + PP 600k + investicijos 300k = 1.5M
    //  ES (500k): kita 500k (likę po VB)
    // Sąmoningai naudojam abu šaltinius, kad demo'tų multi-source funkcionalumą.

    const allocations: Array<{ kategorija: string; id: number }> = [];

    const [duAllocation] = (await trx('budget_allocations_v2')
      .insert({
        funding_source_id: vbSource.id,
        category_classifier_item_id: categoryDuId,
        pavadinimas: 'Darbo užmokestis 2026',
        spec_prog_tipas: null,
        planuota_suma: '400000.00',
        metai: FVM_YEAR,
        pastabos: 'AM darbuotojų DU. Naudoja payroll.computeMonth.',
      })
      .returning(['id'])) as Array<{ id: number }>;
    if (!duAllocation) throw new Error('Nepavyko sukurti DU allocation');
    allocations.push({ kategorija: 'du', id: duAllocation.id });

    const [specAllocation] = (await trx('budget_allocations_v2')
      .insert({
        funding_source_id: vbSource.id,
        category_classifier_item_id: categorySpecId,
        pavadinimas: 'Specialiosios programos 2026',
        spec_prog_tipas: 'biudzeto_dalis',
        planuota_suma: '200000.00',
        metai: FVM_YEAR,
        pastabos: 'Spec.programos kaip biudžeto dalis (ne atskiras finansavimas).',
      })
      .returning(['id'])) as Array<{ id: number }>;
    if (!specAllocation) throw new Error('Nepavyko sukurti SPEC allocation');
    allocations.push({ kategorija: 'spec_programa', id: specAllocation.id });

    const [ppAllocation] = (await trx('budget_allocations_v2')
      .insert({
        funding_source_id: vbSource.id,
        category_classifier_item_id: categoryPpId,
        pavadinimas: 'Prekės ir paslaugos 2026',
        spec_prog_tipas: null,
        planuota_suma: '600000.00',
        metai: FVM_YEAR,
        pastabos: 'IT licencijos, mokymai, paslaugos.',
      })
      .returning(['id'])) as Array<{ id: number }>;
    if (!ppAllocation) throw new Error('Nepavyko sukurti PP allocation');
    allocations.push({ kategorija: 'prekes_paslaugos', id: ppAllocation.id });

    const [invAllocation] = (await trx('budget_allocations_v2')
      .insert({
        funding_source_id: vbSource.id,
        category_classifier_item_id: categoryInvId,
        pavadinimas: 'Investicijos 2026',
        spec_prog_tipas: null,
        planuota_suma: '300000.00',
        metai: FVM_YEAR,
        pastabos: 'IT infrastruktūra, įranga.',
      })
      .returning(['id'])) as Array<{ id: number }>;
    if (!invAllocation) throw new Error('Nepavyko sukurti INV allocation');
    allocations.push({ kategorija: 'investicijos', id: invAllocation.id });

    const [kitaAllocation] = (await trx('budget_allocations_v2')
      .insert({
        funding_source_id: esSource.id,
        category_classifier_item_id: categoryKitaId,
        pavadinimas: 'Kita (ES fondai)',
        spec_prog_tipas: null,
        planuota_suma: '500000.00',
        metai: FVM_YEAR,
        pastabos: 'ES struktūrinių fondų neapibrėžtos paskirties lėšos.',
      })
      .returning(['id'])) as Array<{ id: number }>;
    if (!kitaAllocation) throw new Error('Nepavyko sukurti KITA allocation');
    allocations.push({ kategorija: 'kita', id: kitaAllocation.id });

    // ── C) Spec.programa request (APPROVED) ─────────────────────────────
    // Imituojam pilną prašymo gyvavimo ciklą: SUBMITTED → APPROVED su
    // decisionGrantedAmount + budgetCategoryId rodančiu į spec_programa.
    const [specRequest] = (await trx('requests')
      .insert({
        tenant_id: amTenant.id,
        created_by_user_id: creatorUserId,
        status: 'APPROVED',
        year: FVM_YEAR,
        project_name: 'Saugomų teritorijų informacinė platforma — spec.programa',
        system_code: null,
        project_type: 'IT_SYSTEM',
        description: 'Spec.programa saugomų teritorijų valdymui per FVM.',
        planned_works: 'Sistemos plėtra + 2026 m. priežiūra.',
        priority: 1,
        procurement_stage: 'Sutartis pasirašyta',
        // Cost'ai paliekam 0, naudojam tik FVM laukus.
        cost_du: 0,
        cost_equipment: 0,
        cost_creation: 0,
        cost_analysis: 0,
        cost_development: 0,
        cost_maintenance: 0,
        cost_modernization: 0,
        cost_decommissioning: 0,
        funding_from_it: 0,
        other_funds: 0,
        other_funds_source: null,
        q1_amount: 50000,
        q2_amount: 50000,
        q3_amount: 50000,
        q4_amount: 50000,
        responsible_institution: 'AM',
        executor_name: 'Demo Specialistas',
        executor_email: 'demo@am.lt',
        implementation_deadline: dateStr(FVM_YEAR, 12, 31),
        submitter_notes: null,
        // Sprendimo laukai (APPROVED).
        decision_granted_amount: '200000.00',
        decision_funding_source: 'AM_IT_BUDGET',
        decision_protocol: 'AM-FVM-2026/SPEC-001',
        decision_order: 'AM Įsakymas 2026/A-FVM-SPEC',
        decided_at: dateStr(FVM_YEAR, 1, 15),
        decided_by_user_id: amAdmin?.id ?? creatorUserId,
        submitted_at: dateStr(FVM_YEAR, 1, 5),
        // FVM laukai (Iter 10).
        budget_category_id: categorySpecId,
        funding_source_type_id: biudzetasTypeId,
        spec_program_funding_type: 'biudzeto_dalis',
        fvm_project_id: null, // bus užpildyta žemiau po projects insert'o
      })
      .returning(['id'])) as Array<{ id: number }>;
    if (!specRequest) throw new Error('Nepavyko sukurti spec.programos request');

    // Audit trail komentarai (submitted + approved).
    await trx('request_comments').insert([
      {
        request_id: specRequest.id,
        author_user_id: creatorUserId,
        kind: 'submitted',
        body: null,
        metadata: null,
      },
      {
        request_id: specRequest.id,
        author_user_id: amAdmin?.id ?? creatorUserId,
        kind: 'approved',
        body: 'Patvirtinta — spec.programa 2026 m.',
        metadata: JSON.stringify({ fromStatus: 'SUBMITTED', toStatus: 'APPROVED' }),
      },
    ]);

    // ── D) Projects (2 vnt: spec.programa + regular) ────────────────────
    // Spec.programos projektas — naudoja spec.allocation, susietas su request.
    const [specProject] = (await trx('projects')
      .insert({
        tenant_id: amTenant.id,
        budget_allocation_id: specAllocation.id,
        request_id: specRequest.id,
        pavadinimas: 'Spec. programa: Saugomų teritorijų informacinė platforma',
        tipas: 'spec_programa',
        biudzetas: '200000.00',
        pradzios_data: dateStr(FVM_YEAR, 2, 1),
        pabaigos_data: dateStr(FVM_YEAR, 12, 31),
        statusas: 'vykdoma',
        atsakingas_user_id: amAdmin?.id ?? creatorUserId,
        aprasymas: 'Auto-sukurtas iš patvirtinto spec.programos prašymo (demo FVM seed).',
        is_du_system: false,
      })
      .returning(['id'])) as Array<{ id: number }>;
    if (!specProject) throw new Error('Nepavyko sukurti spec.programos projekto');

    // Užregistruojam fvm_project_id atgal į request (matches createFvmProject flow).
    await trx('requests').where({ id: specRequest.id }).update({ fvm_project_id: specProject.id });

    // Regular projektas — naudoja PP allocation.
    const [regularProject] = (await trx('projects')
      .insert({
        tenant_id: amTenant.id,
        budget_allocation_id: ppAllocation.id,
        request_id: null,
        pavadinimas: 'AADIS modernizavimo projektas 2026',
        tipas: 'projektas',
        biudzetas: '150000.00',
        pradzios_data: dateStr(FVM_YEAR, 1, 15),
        pabaigos_data: dateStr(FVM_YEAR, 11, 30),
        statusas: 'vykdoma',
        // UAT #41 PR-001: vadovas = am-user (role 'user'), kad demo'e būtų
        // matomas naujasis modelis — vadovas veda išlaidas, admin read-only.
        atsakingas_user_id: amUser?.id ?? amAdmin?.id ?? creatorUserId,
        aprasymas: 'AADIS platformos refactoring + naujos funkcijos. Demo FVM seed.',
        is_du_system: false,
      })
      .returning(['id'])) as Array<{ id: number }>;
    if (!regularProject) throw new Error('Nepavyko sukurti regular projekto');

    // ── E) Expenses (5 vnt: 3 single + 2 multi-source) ──────────────────
    // Pirma — single-source išlaidos (saltinio_dalis = NULL).
    await trx('expenses').insert([
      {
        project_id: specProject.id,
        budget_allocation_id: specAllocation.id,
        tipas: 'sutartis',
        suma: '25000.00',
        data: dateStr(FVM_YEAR, 2, 20),
        aprasymas: 'Spec.programos pradinis vystymo etapas — sutartis su rangovu.',
        saltinio_dalis: null,
        payroll_profile_id: null,
        created_by_user_id: creatorUserId,
      },
      {
        project_id: specProject.id,
        budget_allocation_id: specAllocation.id,
        tipas: 'saskaita',
        suma: '8500.00',
        data: dateStr(FVM_YEAR, 3, 10),
        aprasymas: 'Licencijos integraciniam sluoksniui (single-source).',
        saltinio_dalis: null,
        payroll_profile_id: null,
        created_by_user_id: creatorUserId,
      },
      {
        project_id: regularProject.id,
        budget_allocation_id: ppAllocation.id,
        tipas: 'sutartis',
        suma: '35000.00',
        data: dateStr(FVM_YEAR, 2, 28),
        aprasymas: 'AADIS modernizavimas — refactoring sprintas Q1.',
        saltinio_dalis: null,
        payroll_profile_id: null,
        created_by_user_id: creatorUserId,
      },
    ]);

    // Multi-source išlaidos (2 vnt). saltinio_dalis array su SUM == expense.suma.
    // PG jsonb laukas turi būti JSON stringified prieš insert'inant
    // (snake_case `funding_source_id` per docx konvenciją).
    await trx('expenses').insert([
      {
        project_id: regularProject.id,
        budget_allocation_id: ppAllocation.id,
        tipas: 'saskaita',
        suma: '12000.00',
        data: dateStr(FVM_YEAR, 3, 15),
        aprasymas: 'Multi-source: 70% VB + 30% ES (paslaugų rinkinys).',
        saltinio_dalis: JSON.stringify([
          { funding_source_id: vbSource.id, suma: '8400.00' },
          { funding_source_id: esSource.id, suma: '3600.00' },
        ]),
        payroll_profile_id: null,
        created_by_user_id: creatorUserId,
      },
      {
        project_id: regularProject.id,
        budget_allocation_id: ppAllocation.id,
        tipas: 'tiesiogine',
        suma: '4500.00',
        data: dateStr(FVM_YEAR, 3, 22),
        aprasymas: 'Multi-source: 50/50 VB/ES — Q1 konferencija.',
        saltinio_dalis: JSON.stringify([
          { funding_source_id: vbSource.id, suma: '2250.00' },
          { funding_source_id: esSource.id, suma: '2250.00' },
        ]),
        payroll_profile_id: null,
        created_by_user_id: creatorUserId,
      },
    ]);

    // ── F) Payroll profiles (2 vnt) ────────────────────────────────────
    // 2 darbuotojai AM tenant'e su skirtingu DU paskirstymu.
    const [profile1] = (await trx('payroll_profiles')
      .insert({
        tenant_id: amTenant.id,
        user_id: null,
        vardas_pavarde: 'Jonas Demo Specialistas',
        pareigos: 'IT projektų vadovas',
        sutarties_tipas: 'darbo',
        atlyginimas_bruto: '3500.00',
        priedai: '500.00',
        galioja_nuo: dateStr(FVM_YEAR, 1, 1),
        galioja_iki: null,
      })
      .returning(['id'])) as Array<{ id: number }>;
    if (!profile1) throw new Error('Nepavyko sukurti payroll_profile #1');

    const [profile2] = (await trx('payroll_profiles')
      .insert({
        tenant_id: amTenant.id,
        user_id: null,
        vardas_pavarde: 'Ona Demo Analitikė',
        pareigos: 'Vyriausioji analitikė',
        sutarties_tipas: 'darbo',
        atlyginimas_bruto: '2800.00',
        priedai: '200.00',
        galioja_nuo: dateStr(FVM_YEAR, 1, 1),
        galioja_iki: null,
      })
      .returning(['id'])) as Array<{ id: number }>;
    if (!profile2) throw new Error('Nepavyko sukurti payroll_profile #2');

    // ── G) Payroll distributions (4 vnt) ────────────────────────────────
    // Profile #1: 70% VB + 30% ES (procentais)
    // Profile #2: 100% VB (vienas distribution)
    // Profile #2 papildomai: 0 ES — paliekam tik VB
    await trx('payroll_distributions').insert([
      {
        payroll_profile_id: profile1.id,
        funding_source_id: vbSource.id,
        paskirstymo_tipas: 'procentais',
        reiksme: '70.0000',
        galioja_nuo: dateStr(FVM_YEAR, 1, 1),
        galioja_iki: null,
      },
      {
        payroll_profile_id: profile1.id,
        funding_source_id: esSource.id,
        paskirstymo_tipas: 'procentais',
        reiksme: '30.0000',
        galioja_nuo: dateStr(FVM_YEAR, 1, 1),
        galioja_iki: null,
      },
      {
        payroll_profile_id: profile2.id,
        funding_source_id: vbSource.id,
        paskirstymo_tipas: 'procentais',
        reiksme: '100.0000',
        galioja_nuo: dateStr(FVM_YEAR, 1, 1),
        galioja_iki: null,
      },
      // 4-as distribution'as: fiksuota suma (demo'ja `fiksuota` paskirstymo tipą).
      // ES, fiksuotas 100 EUR/mėn nuo Q2 — galioja nuo balandžio.
      {
        payroll_profile_id: profile2.id,
        funding_source_id: esSource.id,
        paskirstymo_tipas: 'fiksuota',
        reiksme: '100.0000',
        galioja_nuo: dateStr(FVM_YEAR, 4, 1),
        galioja_iki: null,
      },
    ]);

    // ── H) ComputeMonth simuliacija (kovas 2026) ────────────────────────
    // Replikuojam payroll.service.ts:computeMonth elgesį: per kiekvieną
    // profile aktyvų mėnesyje × distribution → DU expense. Imituojam realų
    // computeMonth flow be jo iškvietimo (servisas reikalauja AM auth meta).

    const computeMonth = '2026-03';
    const computeMonthEnd = lastDayOfMonth(FVM_YEAR, 3); // 2026-03-31

    // Auto-create DU sistemos projektą (mirror payroll.ensureDuSystemProject).
    const [duSystemProject] = (await trx('projects')
      .insert({
        tenant_id: amTenant.id,
        budget_allocation_id: duAllocation.id,
        request_id: null,
        pavadinimas: 'DU expense system (auto)',
        tipas: 'veikla',
        biudzetas: '0.00',
        pradzios_data: null,
        pabaigos_data: null,
        statusas: 'vykdoma',
        atsakingas_user_id: null,
        aprasymas:
          'Auto-sukurtas sistemos projektas DU mėnesinių apskaičiavimų išlaidoms talpinti. ' +
          'Žr. payroll.computeMonth.',
        is_du_system: true,
      })
      .returning(['id'])) as Array<{ id: number }>;
    if (!duSystemProject) throw new Error('Nepavyko sukurti DU sistemos projekto');

    // Profile #1: bruto 3500 + priedai 500 = 4000/mėn
    //   70% VB → 2800.00 (procentais)
    //   30% ES → 1200.00 (procentais)
    // Profile #2: bruto 2800 + priedai 200 = 3000/mėn
    //   100% VB → 3000.00 (procentais)
    //   (ES distribution galioja_nuo=2026-04-01 — kovo mėnesį dar neaktyvus)

    interface DuExpenseSeed {
      profileId: number;
      profileName: string;
      fundingSourceId: number;
      suma: string;
    }

    const duExpenses: DuExpenseSeed[] = [
      {
        profileId: profile1.id,
        profileName: 'Jonas Demo Specialistas',
        fundingSourceId: vbSource.id,
        suma: '2800.00',
      },
      {
        profileId: profile1.id,
        profileName: 'Jonas Demo Specialistas',
        fundingSourceId: esSource.id,
        suma: '1200.00',
      },
      {
        profileId: profile2.id,
        profileName: 'Ona Demo Analitikė',
        fundingSourceId: vbSource.id,
        suma: '3000.00',
      },
    ];

    for (const due of duExpenses) {
      await trx('expenses').insert({
        project_id: duSystemProject.id,
        budget_allocation_id: duAllocation.id,
        tipas: 'du',
        suma: due.suma,
        data: computeMonthEnd,
        aprasymas: `DU ${computeMonth}: ${due.profileName}`,
        saltinio_dalis: JSON.stringify([
          { funding_source_id: due.fundingSourceId, suma: due.suma },
        ]),
        payroll_profile_id: due.profileId,
        created_by_user_id: creatorUserId,
      });
    }
  });
}
