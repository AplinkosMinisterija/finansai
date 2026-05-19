/**
 * Po-MVP seed: klasifikatorių grupės + reikšmės + pavyzdinis 2026 m. biudžetas.
 *
 * Idempotent — truncatina klasifikatorių/biudžeto lenteles ir įdeda iš naujo.
 * Vykdomas po 01_initial.ts (Knex paeiliui pagal pavadinimą).
 */
import type { Knex } from 'knex';

interface GroupSeed {
  code: string;
  name: string;
  description: string;
  items: ItemSeed[];
}

interface ItemSeed {
  code: string;
  name: string;
  sortOrder?: number;
  children?: ItemSeed[];
}

const GROUPS: GroupSeed[] = [
  {
    code: 'funding_type',
    name: 'Lėšų tipai',
    description: 'Lėšų tipai biudžeto skaidymui ir prašymo eilutei. Palaiko sub-categorijas.',
    items: [
      {
        code: 'IT',
        name: 'IT',
        sortOrder: 10,
        children: [
          { code: 'IT_LICENSES', name: 'Licencijos', sortOrder: 1 },
          { code: 'IT_EQUIPMENT', name: 'Įranga', sortOrder: 2 },
          { code: 'IT_DEVELOPMENT', name: 'Vystymas', sortOrder: 3 },
          { code: 'IT_MAINTENANCE', name: 'Priežiūra', sortOrder: 4 },
          { code: 'IT_OTHER', name: 'Kita', sortOrder: 99 },
        ],
      },
      {
        code: 'TRAINING',
        name: 'Mokymai',
        sortOrder: 20,
        children: [
          { code: 'TRAINING_INTERNAL', name: 'Vidiniai mokymai', sortOrder: 1 },
          { code: 'TRAINING_EXTERNAL', name: 'Išoriniai mokymai', sortOrder: 2 },
          { code: 'TRAINING_CONFERENCE', name: 'Konferencijos', sortOrder: 3 },
        ],
      },
      { code: 'SALARY', name: 'Atlyginimai', sortOrder: 30 },
      { code: 'COMMUNICATION', name: 'Komunikacija ir leidiniai', sortOrder: 40 },
      { code: 'PROCUREMENT', name: 'Viešieji pirkimai (kita)', sortOrder: 50 },
      { code: 'OTHER', name: 'Kita', sortOrder: 99 },
    ],
  },
  {
    code: 'is_system',
    name: 'Informacinės sistemos',
    description: 'IS sąrašas paraiškos formoje (vietoj laisvo „IS kodo" lauko).',
    items: [
      { code: 'GPAIS', name: 'GPAIS — Gaminių paskirstymo IS', sortOrder: 1 },
      { code: 'BIIP', name: 'BIIP — Biologinės įvairovės info platforma', sortOrder: 2 },
      { code: 'DBSIS', name: 'DBSIS — Dokumentų valdymo sistema', sortOrder: 3 },
      { code: 'MEDZIOKLE', name: 'Medžioklės IS', sortOrder: 4 },
      { code: 'SAUGOMOS', name: 'Saugomų teritorijų IS', sortOrder: 5 },
      { code: 'AAA', name: 'Aplinkos apsaugos agentūros IS', sortOrder: 6 },
      { code: 'OTHER', name: 'Kita', sortOrder: 99 },
    ],
  },
  {
    code: 'project_type',
    name: 'Projekto tipai',
    description: 'Projekto tipas paraiškos formoje.',
    items: [
      { code: 'NEW_DEVELOPMENT', name: 'Naujas kūrimas', sortOrder: 1 },
      { code: 'MODERNIZATION', name: 'Modernizavimas', sortOrder: 2 },
      { code: 'MAINTENANCE', name: 'Priežiūra', sortOrder: 3 },
      { code: 'INTEGRATION', name: 'Integracija', sortOrder: 4 },
      { code: 'DECOMMISSIONING', name: 'Užbaigimas / nutraukimas', sortOrder: 5 },
      { code: 'RESEARCH', name: 'Tyrimas / analizė', sortOrder: 6 },
    ],
  },
  {
    code: 'source_program',
    name: 'Finansavimo šaltinio programos',
    description: 'AM programos / šaltiniai iš kurių skiriamas finansavimas (issue #8).',
    items: [
      { code: 'AM_IT_BUDGET', name: 'AM IT biudžetas', sortOrder: 1 },
      { code: 'AM_TRAINING_BUDGET', name: 'AM mokymų biudžetas', sortOrder: 2 },
      { code: 'AM_DEVELOPMENT', name: 'AM vystymo programa', sortOrder: 3 },
      { code: 'EU_FUNDS', name: 'ES struktūriniai fondai', sortOrder: 4 },
      { code: 'OTHER', name: 'Kita', sortOrder: 99 },
    ],
  },
  {
    code: 'approval_levels',
    name: 'Aprobacijos lygiai',
    description:
      'Daugiapakopės aprobacijos žingsniai (issue #9). AAD scope: 1 žingsnis (am_admin). ' +
      'Vėliau pridedami: skyrius → departamentas → kancleris.',
    items: [
      { code: 'AM_ADMIN', name: 'AM administratorius', sortOrder: 1 },
      { code: 'DEPARTMENT', name: 'Departamentas', sortOrder: 2 },
      { code: 'DIVISION', name: 'Skyrius', sortOrder: 3 },
      { code: 'CHANCELLOR', name: 'Kancleris', sortOrder: 4 },
      { code: 'DBSIS', name: 'DBSIS sistema', sortOrder: 5 },
    ],
  },
];

interface BudgetAllocationSeed {
  itemCode: string; // classifier_items.code (unique within funding_type)
  amount: string;
}

const BUDGET_2026: { totalAmount: string; notes: string; allocations: BudgetAllocationSeed[] } = {
  totalAmount: '1500000.00',
  notes: 'Pavyzdinis 2026 m. biudžetas (issue #1). 1 500 000 € paskirstyta tarp lėšų tipų.',
  allocations: [
    { itemCode: 'SALARY', amount: '500000.00' },
    { itemCode: 'IT', amount: '650000.00' },
    { itemCode: 'TRAINING', amount: '120000.00' },
    { itemCode: 'COMMUNICATION', amount: '80000.00' },
    { itemCode: 'PROCUREMENT', amount: '100000.00' },
    { itemCode: 'OTHER', amount: '50000.00' },
  ],
};

export async function seed(knex: Knex): Promise<void> {
  // Atsargumas — gali nebūti migracijos.
  const hasGroups = await knex.schema.hasTable('classifier_groups');
  if (!hasGroups) return;

  await knex('budget_allocations').del();
  await knex('budgets').del();
  await knex('classifier_items').del();
  await knex('classifier_groups').del();

  await knex.raw('ALTER SEQUENCE classifier_groups_id_seq RESTART WITH 1');
  await knex.raw('ALTER SEQUENCE classifier_items_id_seq RESTART WITH 1');
  await knex.raw('ALTER SEQUENCE budgets_id_seq RESTART WITH 1');
  await knex.raw('ALTER SEQUENCE budget_allocations_id_seq RESTART WITH 1');

  // 1) Groups + items (su hierarchija)
  const itemIdByCompositeCode: Record<string, number> = {}; // "groupCode:itemCode" → id
  for (const g of GROUPS) {
    const [insertedGroup] = (await knex('classifier_groups')
      .insert({
        code: g.code,
        name: g.name,
        description: g.description,
        active: true,
      })
      .returning('id')) as Array<{ id: number }>;
    if (!insertedGroup) throw new Error(`Group insert failed: ${g.code}`);
    const groupId = insertedGroup.id;

    for (const item of g.items) {
      const [insertedItem] = (await knex('classifier_items')
        .insert({
          group_id: groupId,
          parent_id: null,
          code: item.code,
          name: item.name,
          sort_order: item.sortOrder ?? 0,
          active: true,
        })
        .returning('id')) as Array<{ id: number }>;
      if (!insertedItem) throw new Error(`Item insert failed: ${g.code}:${item.code}`);
      itemIdByCompositeCode[`${g.code}:${item.code}`] = insertedItem.id;

      if (item.children) {
        for (const child of item.children) {
          const [insertedChild] = (await knex('classifier_items')
            .insert({
              group_id: groupId,
              parent_id: insertedItem.id,
              code: child.code,
              name: child.name,
              sort_order: child.sortOrder ?? 0,
              active: true,
            })
            .returning('id')) as Array<{ id: number }>;
          if (!insertedChild) {
            throw new Error(`Child insert failed: ${g.code}:${child.code}`);
          }
          itemIdByCompositeCode[`${g.code}:${child.code}`] = insertedChild.id;
        }
      }
    }
  }

  // 2) 2026 m. biudžetas
  const [insertedBudget] = (await knex('budgets')
    .insert({
      year: 2026,
      total_amount: BUDGET_2026.totalAmount,
      notes: BUDGET_2026.notes,
    })
    .returning('id')) as Array<{ id: number }>;
  if (!insertedBudget) throw new Error('Budget insert failed');

  for (const a of BUDGET_2026.allocations) {
    const itemId = itemIdByCompositeCode[`funding_type:${a.itemCode}`];
    if (!itemId) throw new Error(`Budget allocation references unknown item: ${a.itemCode}`);
    await knex('budget_allocations').insert({
      budget_id: insertedBudget.id,
      classifier_item_id: itemId,
      amount: a.amount,
    });
  }
}
