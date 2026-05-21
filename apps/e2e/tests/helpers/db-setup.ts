/**
 * DB setup helper'is — užtikrina FVM klasifikatorių egzistavimą prieš testus.
 *
 * Žinoma problema: `02_classifiers_and_budget.ts` seed'as truncatina visus
 * classifier_groups + items, o paleidęs tik MVP grupes. FVM klasifikatorius
 * (`funding_source_type`, `budget_category`) sukuriami per migraciją, todėl
 * po seed'o jų nelieka.
 *
 * Sprendimas (be migracijos rollback): per API įdėti reikalingus FVM klasifikatorius
 * jei jų nėra. AM admin teisėmis (`canManageClassifiers`).
 *
 * Naudoti per `test.beforeAll` globaliame setup'e, kad nepasikartotų per kiekvieną test'ą.
 */
import type { APIRequestContext } from '@playwright/test';

interface ClassifierGroup {
  id: number;
  code: string;
  name: string;
  active: boolean;
}

interface ClassifierItem {
  id: number;
  groupId: number;
  code: string;
  name: string;
  active: boolean;
}

interface FvmGroupSeed {
  code: string;
  name: string;
  description: string;
  items: Array<{ code: string; name: string; sortOrder: number }>;
}

const FVM_GROUPS: FvmGroupSeed[] = [
  {
    code: 'funding_source_type',
    name: 'Finansavimo šaltinio tipas',
    description:
      'Finansavimo šaltinio tipas (1 FVM lygio kategorija). Naudoja funding_sources.tipas_classifier_item_id.',
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
      'Biudžeto paskirstymo kategorija (2 FVM lygio). Naudoja budget_allocations.category_classifier_item_id.',
    items: [
      { code: 'du', name: 'Darbo užmokestis', sortOrder: 10 },
      { code: 'spec_programa', name: 'Specialioji programa', sortOrder: 20 },
      { code: 'prekes_paslaugos', name: 'Prekės ir paslaugos', sortOrder: 30 },
      { code: 'investicijos', name: 'Investicijos', sortOrder: 40 },
      { code: 'kita', name: 'Kita', sortOrder: 99 },
    ],
  },
];

/**
 * Užtikrina, kad funding_source_type ir budget_category klasifikatoriai
 * (ir jų items) egzistuotų. Idempotent — jei jau yra, nieko nedaro.
 *
 * Reikalauja kad `request` būtų autentifikuotas su AM admin teisėmis.
 */
export async function ensureFvmClassifiers(
  request: APIRequestContext,
): Promise<void> {
  // 1. List visus group'us — jei reikia, sukuriam
  const groupsResp = await request.get('/api/classifiers/groups');
  if (!groupsResp.ok()) {
    throw new Error(
      `Negalim gauti classifier groups: ${groupsResp.status()} ${await groupsResp
        .text()
        .catch(() => '?')}`,
    );
  }
  const existingGroups = (await groupsResp.json()) as ClassifierGroup[];

  for (const seed of FVM_GROUPS) {
    let group = existingGroups.find((g) => g.code === seed.code);
    if (!group) {
      const createResp = await request.post('/api/classifiers/groups', {
        data: {
          code: seed.code,
          name: seed.name,
          description: seed.description,
          active: true,
        },
        headers: { 'Content-Type': 'application/json' },
      });
      if (!createResp.ok()) {
        const body = await createResp.text().catch(() => '');
        throw new Error(
          `Negalim sukurti classifier group ${seed.code}: ${createResp.status()} ${body}`,
        );
      }
      group = (await createResp.json()) as ClassifierGroup;
    }

    // List items šiai grupei
    const itemsResp = await request.get(
      `/api/classifiers/items?groupCode=${seed.code}`,
    );
    if (!itemsResp.ok()) {
      throw new Error(
        `Negalim gauti classifier items ${seed.code}: ${itemsResp.status()}`,
      );
    }
    const existingItems = (await itemsResp.json()) as ClassifierItem[];

    for (const item of seed.items) {
      if (existingItems.some((i) => i.code === item.code)) continue;
      const createResp = await request.post('/api/classifiers/items', {
        data: {
          groupId: group.id,
          code: item.code,
          name: item.name,
          sortOrder: item.sortOrder,
          active: true,
        },
        headers: { 'Content-Type': 'application/json' },
      });
      if (!createResp.ok()) {
        const body = await createResp.text().catch(() => '');
        throw new Error(
          `Negalim sukurti classifier item ${seed.code}:${item.code}: ${createResp.status()} ${body}`,
        );
      }
    }
  }
}
