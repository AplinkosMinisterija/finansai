# FVM Migracijos strategija

## Tikslas

Saugiai pereiti nuo dabartinio biudžeto modelio (`budgets` + `budget_allocations` per `classifier_item_id`) prie FVM modelio (`funding_sources` + naujas `budget_allocations` per `funding_source_id` + `category_classifier_item_id`).

## Esamų duomenų inventorius (2026-05-21)

### `budgets` lentelė
- Vienas įrašas: 2026 metai, total_amount = 1,500,000.00 €
- Sukurtas Iter 1 seed metu

### `budget_allocations` lentelė (sena)
- Įrašai per `classifier_item_id` (klasifikatoriaus grupė „Lėšų tipas" arba panaši)
- Sumos pagal pradinį Giedrės pavyzdį (500k atlyginimui, 1M vystymui, etc.)

### `classifier_groups` ir `classifier_items`
- Yra grupė lėšų tipams (DU, vystymas, kt.) — naudojama biudžeto skaidymui
- Bus reused kaip `budget_category` klasifikatorius (ADR-001)

### `requests`
- N įrašų (per Iter 2-8 testavimo). Statusai mišrūs.
- `decision_funding_source` referuoja į `classifier_item_id` (per source program klasifikatorių)

## Migracijos seka (per Iter 9)

### Žingsnis 1: Sukurti naują schemą (ne-destruktyvi)

Nauja migracija sukuria:
- `funding_sources` lentelę
- `budget_allocations_v2` lentelę (laikinas pavadinimas, kad nepainioti su senuoju)
- Klasifikatoriaus grupę `budget_category` (jei dar nėra) su default items: DU, spec_programa, prekes_paslaugos, investicijos, kita
- Klasifikatoriaus grupę `funding_source_type` su default items: biudzetas, ES, kita

Migracija pavadinta: `20260522100000_create_fvm_foundation.ts`

### Žingsnis 2: Migracija duomenų (Knex migration script tame pačiame file)

```typescript
exports.up = async function (knex) {
  // ... create tables (žingsnis 1) ...

  // Tenant ID — AM
  const amTenant = await knex('tenants').where({ code: 'AM' }).first();
  if (!amTenant) throw new Error('AM tenant not found — bootstrap data missing');

  // Funding source type "biudzetas" classifier item
  const fundingSourceTypeGroup = await knex('classifier_groups')
    .where({ code: 'funding_source_type' })
    .first();
  const biudzetasType = await knex('classifier_items')
    .where({ group_id: fundingSourceTypeGroup.id, code: 'biudzetas' })
    .first();

  // Migrate kiekvienam budgets įrašui — sukuriam funding_source
  const oldBudgets = await knex('budgets').select('*');
  for (const oldBudget of oldBudgets) {
    const [newSource] = await knex('funding_sources')
      .insert({
        tenant_id: amTenant.id,
        pavadinimas: `Valstybės biudžetas ${oldBudget.year}`,
        kodas: `VB-${oldBudget.year}`,
        tipas_classifier_item_id: biudzetasType.id,
        metai: oldBudget.year,
        metine_suma: oldBudget.total_amount,
        aprasymas: oldBudget.notes || 'Migruota iš senos budgets lentelės',
        aktyvus: true,
      })
      .returning('*');

    // Migracija senųjų budget_allocations į naujas
    const oldAllocations = await knex('budget_allocations')
      .where({ budget_id: oldBudget.id });

    for (const oldAlloc of oldAllocations) {
      // Senas budget_allocations.classifier_item_id → naujas category_classifier_item_id
      // Bet pirma — pamatuoti, ar tas classifier_item priklauso budget_category grupei
      const oldItem = await knex('classifier_items')
        .where({ id: oldAlloc.classifier_item_id })
        .first();

      // Jei taip — naudojam tiesiogiai. Jei ne (pvz., custom AM tipas) — mapping
      // strategija: pridėti kaip naują budget_category item.
      let categoryItemId = oldItem.group_id === budgetCategoryGroup.id
        ? oldItem.id
        : await ensureCategoryItem(knex, budgetCategoryGroup.id, oldItem.name);

      await knex('budget_allocations_v2').insert({
        funding_source_id: newSource.id,
        category_classifier_item_id: categoryItemId,
        pavadinimas: oldItem.name,
        spec_prog_tipas: null,
        planuota_suma: oldAlloc.amount,
        metai: oldBudget.year,
        pastabos: 'Migruota iš senos budget_allocations lentelės',
      });
    }
  }
};

async function ensureCategoryItem(knex, groupId, name) {
  let item = await knex('classifier_items')
    .where({ group_id: groupId, name })
    .first();
  if (!item) {
    const code = name.toLowerCase().replace(/\s+/g, '_');
    [item] = await knex('classifier_items')
      .insert({ group_id: groupId, code, name, sort_order: 999, active: true })
      .returning('*');
  }
  return item;
}
```

### Žingsnis 3: Patikrinti migracijos integriškumą

Atskirta migracija (arba post-migration script):

```typescript
// migrations-verify/verify-fvm-foundation.ts
async function verify(knex) {
  // 1. Visos senos allocations turi atitikmenį naujose
  const oldCount = await knex('budget_allocations').count('id as count').first();
  const newCount = await knex('budget_allocations_v2').count('id as count').first();
  assert(oldCount.count === newCount.count, 'Allocation count mismatch');

  // 2. Sumos sutampa
  const oldSum = await knex('budget_allocations').sum('amount as sum').first();
  const newSum = await knex('budget_allocations_v2').sum('planuota_suma as sum').first();
  assert(Math.abs(oldSum.sum - newSum.sum) < 0.01, 'Sum mismatch');

  // 3. Kiekvienas funding_source.metine_suma >= sum of allocations per source
  const sources = await knex('funding_sources').select('*');
  for (const s of sources) {
    const allocSum = await knex('budget_allocations_v2')
      .where({ funding_source_id: s.id })
      .sum('planuota_suma as sum')
      .first();
    assert(s.metine_suma >= allocSum.sum, `Source ${s.kodas} overcommitted`);
  }

  console.log('FVM migration verification PASSED');
}
```

### Žingsnis 4: Servisų refactoring naudoti naują schema

`budgets.service.ts` perdarytas — visi endpoint'ai naudoja `funding_sources` + `budget_allocations_v2` (per modeli).

### Žingsnis 5: Po staging UAT — atsisakyti senų lentelių

Atskira migracija (po Iter 16 staging UAT pass):

```typescript
exports.up = async function (knex) {
  // Pervadinti
  await knex.schema.dropTable('budget_allocations');
  await knex.schema.renameTable('budget_allocations_v2', 'budget_allocations');
  await knex.schema.dropTable('budgets');
};
```

**Svarbu**: šis žingsnis paliekam Iter 16 tail, ne Iter 9. Iki tol abi schemos koegzistuoja (sena tik read'inė, nauja aktyvi).

## Rollback strategija

Kiekviena migracija turi `exports.down`:

```typescript
exports.down = async function (knex) {
  await knex.schema.dropTable('payroll_distributions'); // jei sukurta
  await knex.schema.dropTable('payroll_profiles');
  await knex.schema.dropTable('expenses');
  await knex.schema.dropTable('projects');
  await knex.schema.dropTable('budget_allocations_v2');
  await knex.schema.dropTable('funding_sources');
  // Klasifikatorius nedalom — gali būti naudojami kitur
};
```

Dev aplinkoje rollback'inam laisvai. Staging — atsargiai (gali būti UAT duomenys). Prod — niekados be Giedrės sutikimo.

## Data integrity garantijos

### Per migration
- Sumų lygybės check'ai (žr. verify žingsnį 3)
- Foreign key integrity (visi naujieji FK rodo į egzistuojančius records)
- Tenant scoping (visi FVM objektai turi tenant_id, sumigruoti į AM tenant)

### Po migration runtime
- DB CHECK constraints (status enums, tipas enums)
- Service-level validation (SUM percentage = 100% per payroll distributions per period)
- Permission gates (DU duomenys — tenant_id match)

## Pre-migration backup

Prieš paleidžiant migraciją bet kurioje aplinkoje (dev/staging/prod):

```bash
# Backup į failą
pg_dump -h localhost -p 5544 -U finansai_user finansai_db > backup-pre-fvm-$(date +%Y%m%d).sql

# Restore jei reikia
psql -h localhost -p 5544 -U finansai_user -d finansai_db < backup-pre-fvm-YYYYMMDD.sql
```

**Staging** ir **prod** backup'us daro DevOps prieš push'inant `main` arba tagą.

## Migration rehearsal (Iter 16)

Prieš tagging X.Y.Z prod release'ui — kvietinis Giedrei:

1. Staging duomenų refresh iš prod (anonimizuoti — masking DU duomenis)
2. Naujas pull staging'e (sumigruota schema)
3. Manual smoke test: AM admin pravažiuoja per visus FVM puslapius
4. UAT su Giedre
5. Jei OK — tag X.Y.Z

## Versija

- v1.0 — 2026-05-21 — Pradinis snapshot (CTO Claude).
