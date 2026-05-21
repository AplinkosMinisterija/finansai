# Iter 10 (FVM-2) — Stream 1: Request integration

> **CTO brief**. Įgyvendina docx §3 (P01–P06).

## Tikslas

Prašymo modelis papildytas FVM lygmens laukais (budget_category, funding_source_type, spec_program_funding_type, fvm_project_id). Wizard turi naują „Biudžetas" žingsnį arba sub-section. AM patvirtinimo ekranas rodo institucijos pasirinkimą ir leidžia AM korekciją. Dashboard papildytas budget_category breakdown'u. Seni prašymai (be naujų laukų) toliau veikia.

**Iter 10 NEKURIA `projects` lentelės ir auto-create logikos** — tai Iter 11 darbas. `fvm_project_id` lauko schema sukurta, bet nullable; populated bus Iter 11.

## Apima iš docx

- §3.1 Prašymo modelio papildymai (5 nauji laukai)
- §3.2 Wizard papildymas (institucijos pusė)
- §3.3 Patvirtinimo ekranas (AM pusė) — pakeitimai
- §3.4 Dashboard papildymas — budget_category breakdown
- P01: wizard biudžeto kategorija
- P02: spec.programa papildomas klausimas
- P03: AM patvirtinimas + approved_amount (jau yra)
- P04: FVM projekto sukūrimas — PLACEHOLDER mygtukas/komentaras (real implementation Iter 11)
- P05: nauji DB laukai
- P06: dashboard kategorijos breakdown

## NEAPIMA

- §2.3 projektų lentelės (Iter 11)
- §4.2 project.service.ts (Iter 11)
- §4.3 expenses logikos (Iter 12)
- Auto-create FVM projekto iš patvirtinto prašymo (Iter 11)

## Esama būklė (kontekstas komandai)

- `apps/api/src/models/Request.ts` — esamas modelis. `decisionGrantedAmount`, `decisionFundingSource`, `decisionProtocol`, `decisionOrder` jau yra.
- `apps/web/src/components/requests/RequestWizard.tsx` — 5 žingsnių wizard (`info`, `financing`, `quarterly`, `responsible`, `review`). Step'ai apibrėžti const STEPS array.
- `apps/web/src/pages/PrasymoDetailPage.tsx` — AM approval screen su decision dialog.
- `apps/api/src/services/dashboard.service.ts` — turi `costCategories` (cost field aggregation), bet NĖRA budget_category aggregation.
- Klasifikatoriai (Iter 9 seedinti):
  - `budget_category` grupė: items du, spec_programa, prekes_paslaugos, investicijos, kita
  - `funding_source_type` grupė: items biudzetas, es, kita

## Komandos sudėtis

| Rolė | Subagentas | Atsakomybė |
|---|---|---|
| DBA | general-purpose | Migracijos failai naujiems request laukams |
| Backend Engineer | general-purpose | Request modelio + service'o + dashboard'o papildymai, validation, testai |
| Frontend Engineer | general-purpose | Wizard biudžeto žingsnis, approval dialog, dashboard chart |
| Independent Auditor | general-purpose | Po komandos — P01–P06 verification |

## Darbo seka

1. **DBA** pirma — migracija nauji request laukai (blocker)
2. **Backend** + **Frontend** paraleliai (po DBA pabaigos) — modelis update + UI changes
3. **Auditas** post-team

## Subagentų briefingai

### A. DBA brief

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas skaitymas**:
1. `docs/fvm/01-architecture.md` — sekcija „requests papildomi laukai" (žr. ALTER TABLE statement)
2. `docs/fvm/spec/FVM-v0.1.md` — §3.1 (P05 lentelės)
3. `apps/api/src/database/migrations/20260517090000_create_requests.ts` — referencija stiliui

**Deliverables**:

1. **Migracija**: `apps/api/src/database/migrations/20260523100000_add_fvm_fields_to_requests.ts`
   - `ALTER TABLE requests ADD COLUMN budget_category_id integer REFERENCES classifier_items(id) ON DELETE SET NULL`
   - `ALTER TABLE requests ADD COLUMN funding_source_type_id integer REFERENCES classifier_items(id) ON DELETE SET NULL`
   - `ALTER TABLE requests ADD COLUMN spec_program_funding_type varchar(20)`
   - CHECK constraint: `spec_program_funding_type IS NULL OR spec_program_funding_type IN ('atskiras', 'biudzeto_dalis')`
   - `ALTER TABLE requests ADD COLUMN fvm_project_id integer` (FK į projects bus pridėtas Iter 11; kol kas tik kolona be FK — gausim FK Iter 11)
   - Indeksai: `idx_requests_budget_category` ant `budget_category_id`
   - `down`: drop'ina visus 4 stulpelius
   - VIENAS transaction'as (atomic)
   - Visos kolonos `nullable` — backward compat seniems prašymams

2. **Integration testas**: `apps/api/test/database/fvm-request-fields.spec.ts`
   - Setup: sukurti senas request be naujų laukų (validation: seni laukai NULL, vis tiek galima sukurti)
   - Test: pridėti naują request su visi nauji laukai užpildyti — DB priima
   - Test: validation — funding_source_type_id rodantis į kitos grupės klasifikatorių (pvz., budget_category) — DB priima (ne DB-level validation; backend tikrins)
   - Test: spec_program_funding_type CHECK constraint — neteisinga reikšmė throw'ina
   - Test: rollback `down` veikia, kolonos dingo, esami request'ai (be naujų laukų) lieka

**Done criterion**:
- `cd apps/api && yarn db:migrate` pereina
- `cd apps/api && yarn test fvm-request-fields` pereina
- `cd apps/api && yarn typecheck` pass

### B. Backend brief

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas skaitymas**:
1. `docs/fvm/01-architecture.md` — requests papildomi laukai, dashboard sekcijos
2. `docs/fvm/spec/FVM-v0.1.md` — §3 visa, ypač §3.3 (AM patvirtinimo ekranas), §3.4 (dashboard)
3. `apps/api/src/models/Request.ts` — esamas modelis (extending)
4. `apps/api/src/services/requests.service.ts` — esamas servisas (rules: ping-pong flow, decision metadata jau yra)
5. `apps/api/src/services/dashboard.service.ts` — esamas dashboardas + costCategories

**Deliverables**:

1. **Request modelis papildytas**:
   - `apps/api/src/models/Request.ts`:
     - Pridėti laukus: `budgetCategoryId: number | null`, `fundingSourceTypeId: number | null`, `specProgramFundingType: 'atskiras' | 'biudzeto_dalis' | null`, `fvmProjectId: number | null`
     - JSON schema update
     - Relations: `budgetCategory` (BelongsToOne ClassifierItem), `fundingSourceType` (BelongsToOne ClassifierItem) — `project` relation pridėsim Iter 11

2. **Shared types**:
   - `packages/shared/src/index.ts` (arba `requests.ts` jei yra) — `FinancingRequest` interface papildytas naujais laukais
   - `FinancingRequestCreate` ir `FinancingRequestUpdate` DTOs papildyti
   - `SpecProgramFundingType` type re-eksportuotas iš `fvm.ts` (jei nėra, sukurti)

3. **requests.service.ts**:
   - Visi CRUD endpoint'ai (create, get, update, list) handle'ina naujus laukus (paima iš input, grąžina į output)
   - **Validation per create/update**:
     - Jei `budgetCategoryId` nurodytas — patikrint, kad item priklauso `budget_category` grupei. Jei ne — 400 validation error LT žinute.
     - Jei `fundingSourceTypeId` nurodytas — patikrint, kad item priklauso `funding_source_type` grupei.
     - Jei `specProgramFundingType` nurodytas — tik leistinos reikšmės (`atskiras` arba `biudzeto_dalis`).
     - Jei `specProgramFundingType` nurodytas — `budgetCategoryId` turi būti `spec_programa` item (jei nėra — 400 error).
   - **AM approval endpoint papildytas** (per docx §3.3):
     - AM gali pakeisti `budgetCategoryId` patvirtinimo metu (mažas patch existing endpoint)
     - `approved_amount` (=== `decisionGrantedAmount`) jau veikia
     - „Sukurti FVM projektą" mygtuko backend logika — kol kas grąžina TODO/placeholder response per `requests.createFvmProject` action (real implementation Iter 11)
   - **Backward compatibility**: jei input atėjo be naujų laukų — leisti (jokio breaking change)

4. **dashboard.service.ts papildytas**:
   - Pridėti `budgetCategoryStats` agregaciją: { categoryItemId, categoryCode, categoryName, totalRequested, totalGranted, count }
   - Group per `budget_category` classifier items (5 default + custom jei yra)
   - Include į main dashboard response payload
   - LEFT JOIN su classifier_items kad gautume name'us
   - NEKEISTI `costCategories` — paliekam, jis turi prasmę (cost field-based)

5. **Integration testai**:
   - `apps/api/test/services/requests-fvm.spec.ts`:
     - 6+ testų:
       1. Create su naujais laukais — visi išsaugomi
       2. Create be naujų laukų — backward compat (seni prašymai)
       3. Validation: budget_category_id iš klaidingos grupės → 400
       4. Validation: funding_source_type_id iš klaidingos grupės → 400
       5. Validation: spec_program_funding_type tik kai budget_category = spec_programa
       6. AM approval flow su new fields: AM gali pakeisti budget_category prieš approve
   - `apps/api/test/services/dashboard-fvm.spec.ts`:
     - 3+ testų:
       1. dashboard grąžina budgetCategoryStats su teisingomis sumomis
       2. Tuščioje DB grąžina 0 visoms kategorijoms
       3. Kategorija su 0 prašymais — grąžinama (count=0, total=0)

**Constraints**:
- TS strict
- LT user-facing errors, EN dev logs
- NEKEISTI request status state machine
- NEKEISTI senų laukų semantikos
- NEKURTI projects servisų / lentelių (Iter 11)
- **NEKOMITUOTI**

**Done criterion**:
- `cd apps/api && yarn test` visi pass (esami + nauji)
- `cd apps/api && yarn typecheck` pass
- `cd apps/api && yarn build` pass

### C. Frontend brief

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas skaitymas**:
1. `docs/fvm/spec/FVM-v0.1.md` — §3.2, §3.3, §3.4
2. `docs/fvm/01-architecture.md` — Frontend struktūra
3. `packages/shared/src/index.ts` — naujieji `FinancingRequest` laukai (po Backend)
4. `apps/web/src/components/requests/RequestWizard.tsx` — esamas wizard (5 žingsniai)
5. `apps/web/src/pages/PrasymoDetailPage.tsx` — esamas approval screen
6. `apps/web/src/pages/HomePage.tsx`, `StatistikaPage.tsx` — dashboard'as

**Deliverables**:

1. **Wizard'as papildytas**: `apps/web/src/components/requests/RequestWizard.tsx`
   - Naujas žingsnis tarp „Finansavimas" (1) ir „Ketvirtinis paskirstymas" (2) → step index pasislenka, naujas STEP key: `budget`
   - Žingsnio turinys:
     - **Biudžeto kategorija** (ClassifierSelect group=`budget_category`) — required jei nori naudoti FVM funcionalumą; visiškai optional jei ne (backward compat)
     - **Jei kategorija = spec_programa** — papildomas radio: spec_program_funding_type:
       - `atskiras` — Su atskiru finansavimu (rinkliavos, mokesčiai)
       - `biudzeto_dalis` — Iš bendrojo biudžeto (dalis VB)
     - **Jei spec_program_funding_type = atskiras** — papildomas dropdown: funding_source_type (ClassifierSelect group=`funding_source_type`)
   - Validation:
     - Visi laukai neprivalomi atgaliniam suderinamumui
     - JEI vartotojas užpildo `spec_program_funding_type` — `budget_category` turi būti spec_programa
   - FormState extended
   - Auto-save (PATCH) veikia kaip esamai

2. **AM approval dialog atnaujintas**: `apps/web/src/components/requests/DecisionDialog.tsx` (ar pavadinimas, žiūrėk PrasymoDetailPage)
   - Rodyti institucijos pasirinkimą (read-only field): kategorija, spec_program_funding_type, funding_source_type
   - AM gali keisti `budgetCategoryId` (dropdown) jei nori koreguoti
   - Jei keičia kategoriją — analogiškai handle spec_program_funding_type ir funding_source_type
   - „Sukurti FVM projektą" mygtukas — rodyti TIK kai status pasidaro APPROVED (mygtukas disabled su tooltip „Bus pridėta Iter 11")

3. **Naujasis dashboard chart**: `apps/web/src/components/charts/BudgetCategoryChart.tsx`
   - Horizontalus bar arba donut: budget_category × (count requests | total requested €)
   - Naudoja `budgetCategoryStats` iš dashboard response
   - Integruojamas į `HomePage.tsx` (po esamų grafikų) ir/arba `StatistikaPage.tsx`

4. **Request detail rodymas**: `apps/web/src/pages/PrasymoDetailPage.tsx`
   - Naujas sub-section „Biudžeto informacija" (po Finansavimas):
     - Biudžeto kategorija
     - Spec.prog. finansavimo tipas (jei užpildyta)
     - Finansavimo šaltinio tipas (jei užpildyta)
   - Tik rodymas (no edit — wizard'as redaguoja)

5. **Frontend testai**:
   - `apps/web/src/components/requests/__tests__/RequestWizard-budget.test.tsx`:
     - Pasiekiamas naujas žingsnis
     - spec_program_funding_type rodomas tik kai kategorija = spec_programa
     - funding_source_type rodomas tik kai spec_program_funding_type = atskiras
   - `apps/web/src/components/charts/__tests__/BudgetCategoryChart.test.tsx`:
     - Renders su mock data
     - Empty state

**Constraints**:
- LT UI tekstai
- A11y: labels, ARIA, focus management
- React Query invalidations po patch
- NEKEISTI kitų wizard žingsnių semantikos
- **NEKOMITUOTI**

**Done criterion**:
- `cd apps/web && yarn test` pass
- `cd apps/web && yarn typecheck` pass
- `cd apps/web && yarn build` pass

## Iter 10 Audit kriterijai

### Kriterijus 1: DB schema P05
- [ ] `requests` lentelėje yra 4 nauji nullable kolonos pagal docx §3.1
- [ ] CHECK constraint `spec_program_funding_type IN ('atskiras', 'biudzeto_dalis')`
- [ ] Migration rollback veikia

### Kriterijus 2: Wizard biudžeto kategorija (P01)
- [ ] Wizard'e yra naujas žingsnis arba section, pasiekiamas tarp Finansavimas ir Ketvirčiai
- [ ] `budget_category` dropdown veikia
- [ ] Konditional `spec_program_funding_type` radio rodomas tik kai kategorija=spec_programa
- [ ] Konditional `funding_source_type` dropdown rodomas tik kai spec_program_funding_type=atskiras
- [ ] Visi laukai opcionalūs (backward compat)

### Kriterijus 3: Spec.programa konditional (P02)
- [ ] Spec.programa pasirinkimas atveria papildomą sekciją wizard'e
- [ ] Tik tinkami pasirinkimai leidžiami (atskiras|biudzeto_dalis)
- [ ] Validation: spec_program_funding_type be spec_programa kategorijos → klaida

### Kriterijus 4: AM patvirtinimo ekranas (P03)
- [ ] AM mato institucijos biudžeto kategorijos pasirinkimą
- [ ] AM gali pakeisti (correct) kategoriją prieš patvirtinant
- [ ] approved_amount įvedimas veikia (jau ir taip)
- [ ] „Sukurti FVM projektą" mygtukas atrodo placeholder (disabled with tooltip)

### Kriterijus 5: Backend validation
- [ ] budget_category_id iš kitos grupės → 400 LT error
- [ ] funding_source_type_id iš kitos grupės → 400 LT error
- [ ] spec_program_funding_type su klaidinga kategorija → 400 LT error
- [ ] Backward compat: requests be naujų laukų toliau veikia

### Kriterijus 6: Dashboard kategorijų breakdown (P06)
- [ ] Dashboard endpoint grąžina `budgetCategoryStats`
- [ ] Naujas chart komponentas rodo agregaciją
- [ ] Integruotas į HomePage arba StatistikaPage

### Kriterijus 7: Testai
- [ ] Backend bent 6 nauji requests-fvm + 3 dashboard-fvm + 5 migration testai
- [ ] Frontend bent 4 nauji
- [ ] Visi pereina

### Kriterijus 8: TS + Build + Dev startup
- [ ] `yarn typecheck` (abu) pass
- [ ] `yarn build` (abu) pass
- [ ] `yarn dev` (api + web) paleidžia be klaidų

## Rizikos

| Rizika | Mitigation |
|---|---|
| `requests.service.ts` validation būna per griežta seniems prašymams | Backward compat tests; visi laukai nullable; null bypass'a validation |
| Wizard step'o indeksai netinkamai pasislenka | Tests for wizard navigation; auto-save handle'ina migrations between versions |
| Dashboard chart breaks layout | Storybook-like visual smoke; build pass |
| `funding_source_type` confusing su `source_program` (issue #8) | Aiškus copy LT — „Finansavimo šaltinio TIPAS" (biudzetas/ES/kita) vs „Šaltinio PROGRAMA" (konkretus programos pavadinimas, AM admin nustato) |
