# Iter 9 (FVM-1) — Foundation: funding_sources + budget_allocations

> **CTO brief**. Skirta team subagentams. Skaityti kartu su `01-architecture.md` (galutinis schema) ir `02-migration-strategy.md` (esamos datos migracija).

## Tikslas

Nauja 1–2 lygio DB schema (`funding_sources` + naujas `budget_allocations`) veikia, esamas 2026 1.5M biudžeto seed migruotas, AM admin gali valdyti šaltinius ir paskirstymą per UI.

## Apima iš docx

- §2.1 Finansavimo šaltiniai (1 lygis)
- §2.2 Biudžeto paskirstymas (2 lygis)
- §6.1 funding_sources schema
- §6.2 budget_allocations schema
- §4.1 budget.service.ts funkcijos (be 3 lygio — projektai Iter 11)
- F01: Finansavimo šaltinių kūrimas ir valdymas
- F02: Biudžeto eilučių skaidymas pagal kategorijas

## NEAPIMA (kitose iteracijose)

- §2.3 Spec.programos (papildomai požymis 2 lygyje, bet visas auto-create flow — Iter 11)
- §2.4 Projektai/veiklos (Iter 11)
- Klasifikatoriaus papildymai už default seed — vartotojas valdo per esamą /klasifikatoriai
- Senų `budgets` + `budget_allocations` lentelių pašalinimas — Iter 16 (kol kas koegzistuoja read-only)

## Komandos sudėtis

| Rolė | Subagentas | Atsakomybė |
|---|---|---|
| Test Infra Engineer | general-purpose | Backend test infra setup (PRE-BLOCKER — jis vienas pirmas) |
| DBA / Migrations | general-purpose | Migracijos failai + data migration + verification |
| Backend Engineer | general-purpose | Models, services, tests, types |
| Frontend Engineer | general-purpose | Pages, dialogs, components, tests |
| Independent Auditor | general-purpose | Visi acceptance kriterijai post-team |

## Darbo seka

1. **Test Infra Engineer** dirba pirmas — backend test infra nuo nulio (žr. brief A)
2. **DBA** seka — migracijos + verification (žr. brief B)
3. **Backend** + **Frontend** paraleliai po DBA (žr. brief C ir D)
4. **Auditas** post-team

## Kodėl Test Infra pirmas

`apps/api/jest.config.js` referuoja `<rootDir>/test/setup-env.ts`, `test/global-setup.ts`, `test/global-teardown.ts` failus, kurių NĖRA. `apps/api/test/` katalogas neegzistuoja. Backend testų faktiškai nėra (tik `--passWithNoTests` praeina). FVM matematika su pinigais + Iter 13 DU permission'ais reikalauja solid integration test base. Sukursim dabar — naudosim per visas likusias iteracijas.

## Darbinis dir

`/home/arunas/Projects/AplinkosMinisterija/finansai`

## Subagentų briefingai

### A. Test Infra Engineer brief

**Tu esi Backend Test Infrastructure Engineer (Node.js + Jest + Knex/Objection + PostgreSQL).**

Backend test infra šiame projekte sulaužyta nuo MVP — `jest.config.js` referuoja failus, kurių nėra (`apps/api/test/`). Tavo darbas — sukurti minimalų, solid integration test pamatą, kuriuo naudosis visi būsimi FVM testai.

**Kontekstas**:
- `apps/api/jest.config.js` jau egzistuoja (žr. config)
- `apps/api/src/database/knexfile.ts` turi prod/dev config
- Naudojam PostgreSQL + Knex/Objection
- Moleculer.js servisai — testavimui reikia `ServiceBroker`

**Tavo deliverables**:

1. **Test DB config**: `apps/api/src/database/knexfile.ts` papildyk arba sukurk atskirą `test` aplinką
   - Test DB: `finansai_test` (atskira nuo dev)
   - Connection iš ENV: `TEST_DATABASE_URL` arba fallback į localhost
   - Migration directory: ta pati kaip prod

2. **Global setup**: `apps/api/test/global-setup.ts`
   - Sukurti `finansai_test` DB jei nėra (per pg admin connection)
   - Run migrations į švarią DB
   - Eksportuoti async funkciją

3. **Global teardown**: `apps/api/test/global-teardown.ts`
   - Drop visas lentelių datą (TRUNCATE ar drop+migrate)
   - Close connections

4. **Per-test setup**: `apps/api/test/setup-env.ts`
   - Set NODE_ENV='test'
   - Set DATABASE_URL pointing į test DB

5. **Test helpers**: `apps/api/test/helpers/`
   - `db.ts` — `getTestKnex()`, `truncateAll(knex)`, `seedBaseFixtures(knex)` (sukuria 1 AM tenant + 1 admin user)
   - `broker.ts` — `createTestBroker()` su DB connection ir auth mock
   - `auth.ts` — `mockAuthUser(opts)` grąžina AuthUser-like objektą test'ams

6. **Sanity test**: `apps/api/test/sanity.spec.ts`
   - Bent vienas test'as kuris:
     - Sukuria test broker
     - Calls existing service (e.g., `tenants.list`)
     - Asserts response shape
   - Tikslas: įrodyti, kad infra veikia end-to-end

7. **Dokumentacija**: `apps/api/test/README.md`
   - Kaip paleisti testus lokaliai (test DB sukūrimas)
   - Test patterns (broker, auth mock, truncate per test)
   - Test isolation strategy

**Constraints**:
- TS strict
- Tik standartinės libs (jokio Mockingbird ar pan.) — naudoti tik tai, kas jau yra package.json
- Test DB jungimo configas iš ENV (CI/CD friendly)
- maxWorkers=1 jau yra (sequential testai, nes shared DB) — OK
- KOMITUOTI NEREIKIA

**Done criterion**:
- `cd apps/api && yarn test` praleidžia sanity.spec.ts
- `apps/api/test/README.md` aiškiai paaiškina kaip naudoti

### B. DBA brief

**Tu esi DBA, dirbantis `finansai` Moleculer.js + Knex/Objection + PostgreSQL projekte.**

Tavo darbas: parašyti migracijas naujam FVM modelio pamatui (Iter 9). Pilną kontekstą rasi:
- `docs/fvm/01-architecture.md` — galutinė schema (žr. sekcijas funding_sources, budget_allocations)
- `docs/fvm/02-migration-strategy.md` — data migration detalės su pseudokoduku
- `apps/api/src/database/migrations/` — esamos migracijos kaip stiliaus referencija
- `apps/api/src/database/knex.ts` — Knex config

**Tavo deliverables**:

1. **Migracija**: `20260522100000_create_fvm_foundation.ts`
   - Knex schema sukurianti:
     - `funding_sources` lentelę pagal `01-architecture.md` schema
     - `budget_allocations_v2` lentelę (laikinas pavadinimas) pagal `01-architecture.md` schema
   - Seed: klasifikatoriaus grupė `funding_source_type` su items: `biudzetas`, `es`, `kita`
   - Seed: klasifikatoriaus grupė `budget_category` su items: `du`, `spec_programa`, `prekes_paslaugos`, `investicijos`, `kita`
   - Data migration logika pagal `02-migration-strategy.md` pseudokoduką: pervaryti esamus `budgets` + `budget_allocations` įrašus į naują schema
   - `exports.down` rollback

2. **Verification helper**: `apps/api/src/database/migrations/utils/verify-fvm-foundation.ts`
   - Funkcija `verifyFvmFoundation(knex)` pagal `02-migration-strategy.md` Žingsnis 3
   - Kviečiamas migracijos pabaigoje (jei verify FAIL → throw, transaction rollback'inasi)

3. **Testas migracijai**: `apps/api/src/database/migrations/__tests__/fvm-foundation.test.ts`
   - Jest test: setup test DB, paleisti seed (sukurti budgets + budget_allocations), paleisti migraciją, patikrinti:
     - Visi seni allocations turi atitikmenį naujose
     - Sumos lygios
     - funding_sources turi 1 įrašą per 2026 metus su tipas=biudzetas
   - Naudoja `apps/api/jest.config.ts` ir esamus DB test helper'ius

**Constraints**:
- Naudoti Knex transaction'us — visa migracija turi būti atomic
- Naudoti `uuid_generate_v4()` jei extension yra, kitaip `gen_random_uuid()`
- Indeksai pagal `01-architecture.md`
- Foreign keys pagal `01-architecture.md` (ON DELETE RESTRICT kur nurodyta)
- Migracijos failo header'is su komentaru kas daroma (LT kalba)
- KOMITUOTI NEREIKIA — tik failai, aš commit'insiu po audit

**Done critierion (DBA pati testuoja)**:
- `cd apps/api && yarn db:migrate` — eina be klaidų
- `cd apps/api && npx knex migrate:rollback --knexfile src/database/knexfile.ts` — eina be klaidų
- `cd apps/api && yarn test fvm-foundation` — pass

### C. Backend brief

**Tu esi Backend Engineer (Moleculer.js + TypeScript + Knex/Objection).**

Priklausomybės: DBA jau sukūręs migraciją (`20260522100000_create_fvm_foundation.ts`) — schemos struktūra apibrėžta. Skaityk:
- `docs/fvm/01-architecture.md` — galutinis schema + API contract
- `apps/api/src/services/budgets.service.ts` — kaip atrodė senas budget servisas
- `apps/api/src/services/classifiers.service.ts` — referencija klasifikatoriaus paradigmai
- `apps/api/src/models/Budget.ts` (ar panašu) — kaip atrodė senas modelis

**Tavo deliverables**:

1. **Objection.js modeliai**:
   - `apps/api/src/models/FundingSource.ts` — pilnas modelis su relations:
     - `tenant` (BelongsToOne → Tenant)
     - `tipasClassifierItem` (BelongsToOne → ClassifierItem)
     - `allocations` (HasMany → BudgetAllocation)
   - `apps/api/src/models/BudgetAllocation.ts` — modelis su:
     - `fundingSource` (BelongsToOne → FundingSource)
     - `categoryClassifierItem` (BelongsToOne → ClassifierItem)

2. **Naujas servisas**: `apps/api/src/services/fundingSources.service.ts`
   - Moleculer service pagal esamą stilių (žr. `budgets.service.ts`, `classifiers.service.ts`)
   - Endpoint'ai pagal `01-architecture.md` API contract:
     - `list` — visiems auth'd users, filter: year, tenant_id, type_id
     - `get` — visiems
     - `create` — tik AM admin
     - `update` — tik AM admin
     - `delete` — tik AM admin, RESTRICT jei yra allocations
   - Validation per Moleculer params

3. **Refaktorintas servisas**: `apps/api/src/services/budgets.service.ts`
   - Pervadinti į `budgetAllocations.service.ts` ARBA palikti `budgets.service.ts` su `allocations` namespace'u
   - Endpoint'ai:
     - `list` — filter funding_source_id, year, category_id
     - `get`
     - `create` — AM admin
     - `update` — AM admin
     - `delete` — AM admin, RESTRICT jei yra projects (Iter 11) ar expenses (Iter 12) (kol kas placeholder check'as — TODO commentas)
     - `summary` — endpoint grąžinantis planuota/faktinė/likutis vienam allocation (faktinė kol kas 0, nes nėra expenses iki Iter 12)
   - Senas `budgets` lentelės endpoint'as DEPRECATED bet veikia (read only iš senos lentelės) — Iter 16 pašalinsim. Helper komentaras kodu.

4. **Shared types**: `packages/shared/src/fvm.ts` (naujas failas, ar pridėti į index.ts)
   - `FundingSource` interface
   - `BudgetAllocation` interface
   - Request/response DTO tipai
   - Eksportuoti iš `packages/shared/src/index.ts`

5. **Integration testai** (Jest):
   - `apps/api/src/services/__tests__/fundingSources.service.test.ts`
     - CRUD happy path (AM admin gali)
     - 403 kai ne-AM admin bando POST/PATCH/DELETE
     - DELETE RESTRICT kai yra allocations
     - List/filter veikia
   - `apps/api/src/services/__tests__/budgetAllocations.service.test.ts`
     - CRUD happy path
     - Summary endpoint grąžina teisingus skaičius (planuota = create input, likutis = planuota — 0 expenses)
   - Bent 8 testai per abu failus

**Constraints**:
- NEKEISTI esamų testų ar kitų servisų be aiškios priežasties
- Permission helper'iai jau yra `lib/permissions.ts` arba per Moleculer scopus — naudoti esamus
- Frontend laukia šių endpoint'ų — laikytis API contract'o iš `01-architecture.md`
- TS strict — no `any`
- Lietuviški user-facing error msg'ai, angliški DEV log'ai

**Done criterion**:
- `cd apps/api && yarn typecheck` pass
- `cd apps/api && yarn test fundingSources` pass
- `cd apps/api && yarn test budgetAllocations` pass
- `cd apps/api && yarn dev` paleidžia API be klaidų

### D. Frontend brief

**Tu esi Frontend Engineer (React 18 + Vite + Tailwind + shadcn/ui + React Query).**

Priklausomybės: Backend baigė services + types. Skaityk:
- `docs/fvm/01-architecture.md` — Frontend struktūra sekcija
- `packages/shared/src/fvm.ts` — naudos tipai (sukurta Backend)
- `apps/web/src/pages/BiudzetasPage.tsx` — kaip atrodo senas biudžeto puslapis (referencija)
- `apps/web/src/pages/KlasifikatoriaiPage.tsx` — referencija CRUD page paradigmai
- `apps/web/src/components/classifiers/` — referencija dialog'ams
- `apps/web/src/lib/api.ts` (ar pan.) — API client'as

**Tavo deliverables**:

1. **Naujas puslapis**: `apps/web/src/pages/FinansavimoSaltiniaiPage.tsx`
   - List view: visi tenant funding sources, filter pagal metus
   - Tik AM admin mato „Naujas šaltinis" mygtuką ir gali editinti
   - Klikti šaltinį → modal arba inline editor su allocation'ais
   - Visual: kortelės arba lentelė su sumomis (planuota, jau paskirstyta, likutis)

2. **Komponentai**: `apps/web/src/components/funding-sources/`
   - `FundingSourceDialog.tsx` — CRUD modal
   - `FundingSourceList.tsx` — list su filtrais
   - `FundingSourceCard.tsx` — vienas šaltinis su allocation summary

3. **Refaktorintas puslapis**: `apps/web/src/pages/BiudzetasPage.tsx`
   - Perdarytas atspindi naują modelį
   - Kolonos: šaltinis | kategorija | pavadinimas | planuota | jau paskirstyta | likutis
   - Filter pagal šaltinį, kategoriją, metus
   - AM admin gali pridėti/editinti allocation
   - Backward compat: jei vartotojas pasieks per esamą URL — automatinis redirect arba puslapis veikia su nauja struktūra

4. **Komponentai**: `apps/web/src/components/budget-allocations/`
   - `BudgetAllocationDialog.tsx` — CRUD modal su:
     - funding_source dropdown
     - kategorija dropdown (ClassifierSelect — esamas componentas)
     - pavadinimas, planuota_suma, metai, pastabos
     - spec_prog_tipas dropdown — rodyti TIK kai kategorija = spec_programa

5. **Sidebar atnaujinimas**: `apps/web/src/components/Sidebar.tsx`
   - Pridėti naują punktą „Finansavimo šaltiniai" (matomas AM admin)
   - Esamas „Biudžetas" — paliekam

6. **Frontend testai** (Vitest + RTL):
   - `apps/web/src/pages/__tests__/FinansavimoSaltiniaiPage.test.tsx`
     - Renders list
     - AM admin sees create button; org user doesn't
   - `apps/web/src/components/funding-sources/__tests__/FundingSourceDialog.test.tsx`
     - Form validation
     - Submit calls API

**Constraints**:
- shadcn/ui primitives (Dialog, Select, Input, Label, Button) — NEKURTI naujų UI custom componentų
- React Query hooks pagal esamą paradigmą (`useQuery`, `useMutation`)
- Klaidos rodomos per esamą toast/error display
- LT kalba UI tekstai
- A11y: form labels, focus management, keyboard navigation
- NEKEISTI esamų testų ar puslapių be aiškios priežasties

**Done criterion**:
- `cd apps/web && yarn build` pass
- `cd apps/web && yarn test` pass (visi naujieji + esami)
- `cd apps/web && yarn dev` paleidžia be klaidų
- Vizualus smoke test (vidiniam check'ui): puslapis renders, dialog atsidaro

## Iter 9 Audit kriterijai

Nepriklausomam auditoriui:

### Kriterijus 1: DB schema atitinka docx §6.1 ir §6.2
- [ ] `funding_sources` lentelė turi VISUS docx §6.1 laukus (pavadinimas, kodas, tipas, metai, metinė_suma, aktyvus, tenant_id, aprasymas)
- [ ] `budget_allocations` (naujasis) turi VISUS docx §6.2 laukus (funding_source_id, kategorija, pavadinimas, planuota_suma, metai, pastabos, plus spec_prog_tipas iš §2.3)
- [ ] ADR-001 deviation aiškiai matosi: kategorija ir tipas yra FK į classifier_items, ne SQL enum

### Kriterijus 2: Data migration nedingo
- [ ] Senas budgets lentelės 2026 1.5M įrašas migruotas — yra 1+ funding_source 2026 metams, suma >= 1.5M
- [ ] Visos senos budget_allocations turi atitikmenis budget_allocations_v2 (count match)
- [ ] Sumų agregacija: SUM(senų) = SUM(naujų) per metus

### Kriterijus 3: Klasifikatorius seedinti default values
- [ ] Klasifikatoriaus grupė `funding_source_type` egzistuoja su items: biudzetas, es, kita
- [ ] Klasifikatoriaus grupė `budget_category` egzistuoja su items: du, spec_programa, prekes_paslaugos, investicijos, kita
- [ ] Per /klasifikatoriai UI matosi naujos grupės

### Kriterijus 4: API endpoint'ai pagal contract
- [ ] GET /api/funding-sources — sąrašas (auth required)
- [ ] POST /api/funding-sources — AM admin OK, ne-AM 403
- [ ] PATCH /api/funding-sources/:id — AM admin OK, ne-AM 403
- [ ] DELETE /api/funding-sources/:id — RESTRICT jei yra allocations
- [ ] GET /api/budget-allocations — sąrašas
- [ ] POST/PATCH/DELETE budget allocations — AM admin only
- [ ] GET /api/budget-allocations/:id/summary — grąžina planuota/faktinė/likutis

### Kriterijus 5: Permission gates
- [ ] Org user (ne admin) negali POST/PATCH/DELETE — 403
- [ ] Org admin (ne AM) negali — 403
- [ ] AM admin gali viską

### Kriterijus 6: Frontend funkcionuoja
- [ ] `/finansavimo-saltiniai` puslapis renders su funding sources sąrašu
- [ ] AM admin mato „Naujas šaltinis" mygtuką; org user nemato
- [ ] Dialog atsidaro, validation veikia, save kviečia API
- [ ] `/biudzetas` puslapis perdarytas, rodo naują modelį
- [ ] Sidebar turi naują nuorodą „Finansavimo šaltiniai"

### Kriterijus 7: Testai
- [ ] Backend: bent 8 integration testai per funding sources + budget allocations
- [ ] Frontend: bent 2 component testai (page render + dialog)
- [ ] Migration: bent 1 jest test patikrinantis data migration teisingumą
- [ ] Visi pereina (`yarn test` pass be klaidų)

### Kriterijus 8: TypeScript ir build
- [ ] `yarn typecheck` (api + web) — be klaidų
- [ ] `yarn build` (api + web) — be klaidų
- [ ] Šalutinis check: yarn lint be naujų klaidų

## Rizikos ir mitigation

| Rizika | Mitigation |
|---|---|
| DBA migracija sulaužo dev DB | Migration rehearsal lokaliai pirma, paskui CI |
| Backend ir Frontend skirtingi tipų laukai | Shared types `packages/shared/src/fvm.ts` yra single source |
| Senasis `/biudzetas` UI sulūžta vartotojui | Backward compat: senas `budgets` lentelės read works iki Iter 16; UI rodo migruotus duomenis |
| Audit'orius FAIL daro per griežtai | Acceptance kriterijai conservative; jei 2 iter'os FAIL — review brief'ą |

## Done definition (CTO sign-off)

- [ ] Visi 8 audit kriterijai PASS
- [ ] Commit padarytas su žinute „Iter 9 (FVM-1): foundation"
- [ ] Push į `dev` → CI green → dev-finansai.biip.lt deploy success
- [ ] `docs/fvm/PROGRESS.md` atnaujintas su rezultatu
- [ ] `docs/diskusijos.md` papildytas su Iter 9 entry
