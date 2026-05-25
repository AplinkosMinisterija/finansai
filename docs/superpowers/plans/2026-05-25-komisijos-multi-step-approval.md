# Komisijos daugiapakopis tvirtinimo workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Užbaigti #9 komisijos workflow — konfigūruojama tvirtinimo grandinė (aktyvūs `approval_levels`), vartotojai priskiriami lygiams, per-žingsnį sprendimo teisė ir UI.

**Architecture:** Pernaudoja esamą `approval_steps` pamatą. Grandinė = aktyvūs `approval_levels` (sortOrder). Vartotojo lygiai `users.approval_level_codes text[]` (kaip `am_scope_org_ids`). `canDecideStep` gating; AM admin = super-approver. Grąžinti→teikėjui, atmesti→terminalus.

**Tech Stack:** Moleculer.js + TS + Knex + Objection (apps/api), React 18 + Vite + shadcn (apps/web), shared types (packages/shared). Jest (be), Vitest+RTL (fe). Postgres 5433.

**Spec:** `docs/superpowers/specs/2026-05-25-komisijos-multi-step-approval-design.md`

---

## Failų struktūra

| Failas | Atsakomybė |
|---|---|
| `apps/api/src/database/migrations/<ts>_add_approval_levels_to_users.ts` | `users.approval_level_codes text[]` |
| `packages/shared/src/index.ts` | `AuthUser`/`User`/`UserCreate*`/`UserUpdate*` += `approvalLevelCodes`; `RequestDecisionPayload` nepaliečiamas |
| `apps/api/src/models/User.ts` | mapper'is `approvalLevelCodes` |
| `apps/api/src/services/auth.service.ts` | įkrauna `approvalLevelCodes` į `AuthUser` |
| `apps/api/src/services/users.service.ts` | priima/validuoja `approvalLevelCodes` (AM only) |
| `apps/api/src/services/requests.service.ts` | `getActiveWorkflowChain`, `submit` naudoja ją, `canDecideStep`, `decision` gating |
| `apps/web/src/lib/requests.ts` | `canDecideStep` helper |
| `apps/web/src/components/users/UserDialog.tsx` | „Aprobacijos lygiai" multi-select (AM role=user) |
| `apps/web/src/pages/PrasymoDetailPage.tsx` | sprendimo veiksmų gating + `viewer` prop į ApprovalStepsList |
| `apps/web/src/components/requests/ApprovalStepsList.tsx` | „Jūsų eilė" žyma (naujas `viewer` prop) |
| `apps/api/src/database/seeds/01_initial.ts`, `02_classifiers_and_budget.ts` | aktyvi grandinė + demo lygių priskyrimas |
| testai | žr. žemiau |

---

## Task 1: Migracija — `users.approval_level_codes`

**Files:** Create `apps/api/src/database/migrations/20260529100000_add_approval_levels_to_users.ts`

- [ ] **Step 1: Migracija**

```ts
import type { Knex } from 'knex';
// #9: AM tvirtintojo aprobacijos lygiai (approval_levels kodai). Analogiškai
// users.am_scope_org_ids — masyvas, default tuščias.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.specificType('approval_level_codes', 'text[]').notNullable().defaultTo('{}');
  });
}
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('approval_level_codes');
  });
}
```

- [ ] **Step 2: Reset test DB + migrate verify**

Run: `PGPASSWORD=finansai dropdb -h localhost -p 5433 -U finansai finansai_test; cd apps/api && yarn jest sanity`
Expected: PASS (migracija pritaikoma per global-setup).

- [ ] **Step 3: Commit** — `feat(api): #9 users.approval_level_codes migracija`

---

## Task 2: Shared tipai + User modelis + auth.service

**Files:** Modify `packages/shared/src/index.ts`, `apps/api/src/models/User.ts`, `apps/api/src/services/auth.service.ts`

- [ ] **Step 1: Shared** — į `AuthUser`, `User` DTO ir `UserCreateDTO`/`UserUpdateDTO` (kur yra `amScopeOrgIds`) pridėti `approvalLevelCodes: string[]` (DTO create/update — `approvalLevelCodes?: string[]`). Rasti per `grep -n "amScopeOrgIds" packages/shared/src/index.ts` ir veidrodžiu pridėti.

- [ ] **Step 2: User modelis** — `apps/api/src/models/User.ts`: pridėti lauką `approvalLevelCodes!: string[];` ir užtikrinti snake_case mapper'į (`approval_level_codes`). Patikrinti kaip `amScopeOrgIds` mapinamas (jsonSchema / columnNameMappers) ir veidrodžiu.

- [ ] **Step 3: auth.service** — kur konstruojamas `AuthUser` (grep `amScopeOrgIds`), pridėti `approvalLevelCodes: user.approvalLevelCodes ?? []`.

- [ ] **Step 4: build shared + typecheck**

Run: `yarn workspace @biip-finansai/shared build && cd apps/api && yarn tsc -p tsconfig.json --noEmit`
Expected: clean.

- [ ] **Step 5: Commit** — `feat: #9 approvalLevelCodes shared+model+auth plumbing`

---

## Task 3: users.service + UserDialog (lygių priskyrimas)

**Files:** Modify `apps/api/src/services/users.service.ts`, `apps/web/src/components/users/UserDialog.tsx`
**Test:** `apps/api/test/services/users.service.spec.ts` (jei yra; kitaip pridėti į esamą)

- [ ] **Step 1: Failing test** — AM admin sukuria AM `role=user` su `approvalLevelCodes: ['DEPARTMENT']` → grąžinamas su tuo lauku; neegzistuojantis kodas → 400; org vartotojui perduoti lygiai ignoruojami/tušti.

- [ ] **Step 2: Backend** — `users.service.ts` create/update params += `approvalLevelCodes: { type:'array', items:'string', optional:true }`. Handler: validuoti, kad kiekvienas kodas egzistuoja `approval_levels` grupėje (ClassifierItem WHERE group=approval_levels code IN ...); leisti tik kai target yra AM tvirtintojas (`tenantIsApprover`); kitaip force `[]`. Patch'inti `approvalLevelCodes`.

- [ ] **Step 3: UserDialog** — veidrodžiu `amScopeOrgIds` MultiSelect: naujas „Aprobacijos lygiai" MultiSelect, opcijos iš `classifierItemsList({ groupCode:'approval_levels' })` (code→name), rodomas tik kai `form.tenantIsApprover && form.role === 'user'`. State + create/update payload += `approvalLevelCodes`.

- [ ] **Step 4: Run tests** — `cd apps/api && yarn jest users` + `yarn workspace @biip-finansai/web test UserDialog`. Expected PASS.

- [ ] **Step 5: Commit** — `feat: #9 priskirti aprobacijos lygius vartotojams`

---

## Task 4: `getActiveWorkflowChain` + submit naudoja ją

**Files:** Modify `apps/api/src/services/requests.service.ts`
**Test:** `apps/api/test/services/requests-fvm.spec.ts` arba naujas `requests-workflow.spec.ts`

- [ ] **Step 1: Failing test** — aktyvuojam `approval_levels` AM_ADMIN+DEPARTMENT+CHANCELLOR (kiti inactive); pateikiam prašymą; `approvalSteps` turi 3 PENDING žingsnius sortOrder tvarka su teisingais `levelCode`.

- [ ] **Step 2: Implement** — pridėti:

```ts
async function getActiveWorkflowChain(): Promise<{ code: string; name: string }[]> {
  const group = await ClassifierGroup.query().findOne({ code: 'approval_levels' });
  if (!group) return [{ code: 'AM_ADMIN', name: 'AM administratorius' }];
  const items = await ClassifierItem.query()
    .where({ group_id: group.id, active: true })
    .orderBy('sort_order', 'asc');
  if (items.length === 0) return [{ code: 'AM_ADMIN', name: 'AM administratorius' }];
  return items.map((i) => ({ code: i.code, name: i.name }));
}
```

`submit` (~l.834) pakeisti `DEFAULT_WORKFLOW_LEVELS` ciklą: `const chain = await getActiveWorkflowChain();` ir per `chain` kurti žingsnius (`levelCode: c.code, levelName: c.name`). Palikti `DEFAULT_WORKFLOW_LEVELS` kaip fallback konstantą arba pašalinti (getActiveWorkflowChain jau turi fallback).

- [ ] **Step 3: Run test** — `cd apps/api && yarn jest requests`. Expected PASS.

- [ ] **Step 4: Commit** — `feat(api): #9 submit kuria žingsnius iš konfigūruojamos grandinės`

---

## Task 5: `canDecideStep` (be + fe) + decision gating

**Files:** Modify `apps/api/src/services/requests.service.ts`, `apps/web/src/lib/requests.ts`
**Test:** requests workflow spec

- [ ] **Step 1: Failing tests (backend)** — su 3-žingsnių grandine: vartotojas su `DEPARTMENT` lygiu negali spręsti kol dabartinis PENDING = AM_ADMIN; AM admin (super) gali; po AM_ADMIN approve → dabartinis = DEPARTMENT → DEPARTMENT vartotojas gali; vartotojas be lygio → 403.

- [ ] **Step 2: Backend `canDecideStep`** — pridėti šalia `canDecide`:

```ts
function canDecideStep(
  viewer: NonNullable<AuthMeta['user']>,
  r: { tenantId: number },
  currentStep: { levelCode: string } | undefined,
): boolean {
  if (!canDecide(viewer, r)) return false;      // esamas tenant/scope gate
  if (!currentStep) return true;                 // be žingsnių (legacy) → kaip anksčiau
  if (viewer.role === 'admin') return true;      // AM admin = super-approver
  return (viewer.approvalLevelCodes ?? []).includes(currentStep.levelCode);
}
```

`decision` handler: prieš leidžiant sprendimą, surasti dabartinį PENDING žingsnį (jau randamas `currentStep` ~l.1239, bet permission tikrinama anksčiau per `canDecide`). Pridėti: užkrauti dabartinį PENDING žingsnį PRIEŠ permission check ir naudoti `canDecideStep`. Jei false → 403 LT „Šį žingsnį tvirtina kitas aprobacijos lygis".

- [ ] **Step 3: Frontend `canDecideStep`** — `lib/requests.ts`: analogiškas helper'is, priimantis `user`, `request`, ir dabartinį PENDING žingsnį (iš `request.approvalSteps`). Eksportuoti.

- [ ] **Step 4: Run tests** — `cd apps/api && yarn jest requests`. Expected PASS.

- [ ] **Step 5: Commit** — `feat(api): #9 per-žingsnį sprendimo teisė (canDecideStep)`

---

## Task 6: Sprendimo UI gating + ApprovalStepsList „Jūsų eilė"

**Files:** Modify `apps/web/src/pages/PrasymoDetailPage.tsx`, `apps/web/src/components/requests/ApprovalStepsList.tsx`
**Test:** `apps/web/src/components/requests/__tests__/ApprovalStepsList.test.tsx` (naujas), PrasymoDetailPage esami

- [ ] **Step 1: PrasymoDetailPage** — kur `canDecideNow = canDecide(user, r)` (~l.335), pakeisti į `canDecideStep(user, r, currentPendingStep)` (currentPendingStep = pirmas `approvalSteps` su status PENDING). Kai SUBMITTED bet ne tavo eilė — vietoj veiksmų rodyti juostą „Laukia: {levelName}".

- [ ] **Step 2: ApprovalStepsList** — prop `viewer?: { role: string; approvalLevelCodes: string[] }`. Dabartiniam PENDING žingsniui, jei `viewer.role==='admin' || viewer.approvalLevelCodes.includes(step.levelCode)` → rodyti Badge „Jūsų eilė". Atnaujinti iškvietimą PrasymoDetailPage'e (perduoti `viewer`).

- [ ] **Step 3: Tests** — ApprovalStepsList: „Jūsų eilė" rodoma kai lygis sutampa; nerodoma kitaip. Run `yarn workspace @biip-finansai/web test`. Expected PASS.

- [ ] **Step 4: Commit** — `feat(web): #9 per-žingsnį sprendimo UI + „Jūsų eilė"`

---

## Task 7: Seed — aktyvi grandinė + demo lygiai

**Files:** Modify `apps/api/src/database/seeds/02_classifiers_and_budget.ts`, `01_initial.ts`

- [ ] **Step 1:** `02_*`: `approval_levels` items — `AM_ADMIN`, `DEPARTMENT`, `CHANCELLOR` su `active: true`; `DIVISION`, `DBSIS` su `active: false`. (Pridėti `active` lauką į seed items, jei seed'as jį palaiko; kitaip po insert UPDATE.)

- [ ] **Step 2:** `01_initial.ts`: demo AM vartotojams pridėti `approvalLevelCodes`: pvz. naujas `am-departamentas`/demo (role user, AM, level DEPARTMENT) ir `am-kancleris`/demo (role user, AM, level CHANCELLOR); `am-user` → `['AM_ADMIN']`. `am-admin` lieka super-approver (be lygių — dengia per role).

- [ ] **Step 3:** Reset test DB + run `cd apps/api && yarn jest` — visi PASS (seed naudojamas tik dev, bet patikrinam, kad seed nesulaužo).

- [ ] **Step 4: Commit** — `feat: #9 seed — aktyvi 3-pakopė grandinė + demo lygiai`

---

## Task 8: Galutinė verifikacija

- [ ] **Step 1: Reset test DB** — `PGPASSWORD=finansai dropdb -h localhost -p 5433 -U finansai finansai_test`
- [ ] **Step 2: Backend** — `cd apps/api && yarn jest` → visi PASS.
- [ ] **Step 3: Frontend** — `yarn workspace @biip-finansai/web test` → visi PASS.
- [ ] **Step 4: Tikras typecheck** — `yarn workspace @biip-finansai/shared build && cd apps/web && npx tsc -p tsconfig.app.json --noEmit && cd ../api && yarn tsc -p tsconfig.json --noEmit` → clean.
- [ ] **Step 5: Push** — `git push origin dev`, palaukti CI success.

---

## Self-review (spec coverage)
- §1 grandinė → Task 4 ✓ · §2 user lygiai → Task 1/2/3 ✓ · §3 canDecideStep → Task 5 ✓ · §4 submit → Task 4 ✓ · §5 UI → Task 6 ✓ · §6 state machine (nepakitusi) → dengia esama + Task 5 ✓ · §7 migracija+seed → Task 1/7 ✓ · §8 testai → Task 3/4/5/6 ✓.
