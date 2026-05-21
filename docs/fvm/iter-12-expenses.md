# Iter 12 (FVM-4) — Expenses + budget remainder + warnings

> **CTO brief**. Įgyvendina docx §4.3, §6.4, F06, F07, F08, F11.

## Tikslas

Faktinių išlaidų kaupimas su projekto + allocation susiejimu. Multi-source split (jsonb saltinio_dalis) — viena išlaida gali būti padalinta tarp kelių finansavimo šaltinių. Automatinis biudžeto likučio skaičiavimas realiu laiku: `planuota − faktinė = likutis`. Įspėjimai per 80% (konfigūruojama riba).

Iter 9-11 sukūrė: funding_sources, budget_allocations_v2, projects. Iter 12 prijungia faktinę išlaidų realybę.

## Apima iš docx

- §4.3 expense.service.ts (Faktinių išlaidų kaupimas)
- §6.4 expenses schema su jsonb saltinio_dalis
- F06: faktinių išlaidų kaupimas ir susiejimas su projektu ir biudžeto eilute
- F07: išlaidos padalijimas tarp kelių finansavimo šaltinių (multi-source split)
- F08: automatinis biudžeto likučio skaičiavimas realiu laiku
- F11: įspėjimai apie biudžeto limito artėjimą (konfigūruojama riba, default 80%)

## NEAPIMA

- §4.4 payroll DU (Iter 13)
- §4.5 ataskaitos su eksportu (Iter 14)
- Expense distributions junction lentelė (ADR-002 — jsonb dabar, junction kandidatas vėliau jei perf prastas)
- Atskira `app_settings` lentelė warning threshold'ui — kol kas hard-coded 80% (konstanta) ar per environment variable

## Esama būklė

- `budgetAllocations.service.ts` ir `projects.service.ts` turi `summary` endpoint'us, kurie grąžina `faktine = '0.00'` su TODO Iter 12. Iter 12 — perdaro real implementation.
- `BudgetAllocation` model + `Project` model jau egzistuoja — bus extended.

## Komandos sudėtis

| Rolė | Subagentas | Atsakomybė |
|---|---|---|
| DBA | general-purpose | expenses lentelė migracija + tests |
| Backend Engineer | general-purpose | Expense model + service + integration su summary endpoint'ais (real faktinė) + warnings + tests |
| Frontend Engineer | general-purpose | /islaidos UI tabe ProjektoDetailPage'e + multi-source dialog + warnings + tests |
| Independent Auditor | general-purpose | Audit kriterijai |

## Subagentų briefingai

### A. DBA brief

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas skaitymas**:
1. `docs/fvm/iter-12-expenses.md` — sekcija „A. DBA brief"
2. `docs/fvm/01-architecture.md` — `expenses` (§6.4) schema
3. `docs/fvm/spec/FVM-v0.1.md` — §4.3, §6.4
4. `docs/fvm/03-decisions-log.md` — ADR-002 (jsonb pasirinkimas)
5. `apps/api/src/database/migrations/20260524100000_create_projects.ts` — stilius

**Deliverables**:

1. **Migracija**: `apps/api/src/database/migrations/20260525100000_create_expenses.ts`
   - Sukuria `expenses` lentelę pagal `01-architecture.md`:
     - id SERIAL PK
     - project_id integer NOT NULL FK → projects(id) ON DELETE RESTRICT
     - budget_allocation_id integer NOT NULL FK → budget_allocations_v2(id) ON DELETE RESTRICT
     - tipas varchar(20) NOT NULL CHECK (tipas IN ('du', 'sutartis', 'saskaita', 'tiesiogine'))
     - suma decimal(15, 2) NOT NULL
     - data date NOT NULL
     - aprasymas varchar(500) NULL
     - saltinio_dalis jsonb NULL — formatas: `[{ "funding_source_id": int, "suma": "string-decimal" }, ...]`
     - created_by_user_id integer NOT NULL FK → users(id) ON DELETE RESTRICT
     - created_at, updated_at timestamptz
   - Indexai: `idx_expenses_project`, `idx_expenses_allocation`, `idx_expenses_date`, GIN'as ant `saltinio_dalis` (`USING gin (saltinio_dalis jsonb_path_ops)`)
   - CHECK constraints per knex.raw
   - VIENAS transaction'as
   - LT header komentaras
   - `down`: drop'ina lentelę su visomis priklausomybėmis

2. **Integration testas**: `apps/api/test/database/expenses-foundation.spec.ts` (bent 7):
   1. expenses lentelė turi visus 11 laukų
   2. CHECK constraint tipas: insert su `tipas='invalid'` → throw
   3. FK constraints veikia: insert su klaidingu project_id → throw
   4. RESTRICT ant project_id: bandant ištrint projektą su expense → throw
   5. RESTRICT ant budget_allocation_id: bandant ištrint allocation su expense → throw
   6. Saltinio_dalis jsonb: insert su `[{"funding_source_id": 1, "suma": "600.00"}]` — sėkmingai
   7. GIN index užklausos veikia (test'as): `SELECT WHERE saltinio_dalis @> '[{"funding_source_id": 1}]'::jsonb`
   8. Rollback `down` veikia

**Constraints**:
- TS strict
- LT header komentarai
- knex.transaction
- Test isolation: jei kiti spec'ai rollback'ina šitą migration, įsitikink kad veikia (pridėk pri reikalo `migrate.down({ name })` patternus)
- **NEKOMITUOTI**

**Done criterion**:
- `cd apps/api && yarn db:migrate` paleidžia
- `cd apps/api && yarn test expenses-foundation` PASS
- `cd apps/api && yarn test` visi PASS (regression check)
- `cd apps/api && yarn typecheck` pass

### B. Backend brief

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas skaitymas**:
1. `docs/fvm/iter-12-expenses.md` — sekcija „B. Backend brief"
2. `docs/fvm/01-architecture.md` — expenses, API contract /expenses, summary atnaujinimas
3. `docs/fvm/spec/FVM-v0.1.md` — §4.3 (kiekviena išlaida + multi-source), §6.4
4. `docs/fvm/03-decisions-log.md` — ADR-002 jsonb naudojimo
5. `apps/api/src/services/projects.service.ts` — referencija
6. `apps/api/src/services/budgetAllocations.service.ts` — ten summary placeholder, atnaujinti realiu
7. `apps/api/src/models/Project.ts`, `BudgetAllocationV2.ts`

**Deliverables**:

1. **Modelis**: `apps/api/src/models/Expense.ts`
   - Fields + JSON schema
   - Relations: project, budgetAllocation, createdByUser
   - `saltinio_dalis` parse'inimas/validation per JSON schema (array su objektais)

2. **Naujas servisas**: `apps/api/src/services/expenses.service.ts`
   - Endpoint'ai:
     - `list` — filters: projectId, allocationId, year (iš date), type, dateFrom, dateTo, fundingSourceId (per saltinio_dalis GIN query)
       - Tenant scope per project.tenant_id (org users mato tik savo tenant expenses)
     - `get`
     - `create` — AM admin + org_admin (savo tenant); validation:
       - project_id egzistuoja ir priklauso atitinkamam tenant'ui
       - budget_allocation_id matchina projekto allocation (default) ARBA leidžiama skirtinga jei vartotojas eksplicitiškai nurodo (rare case)
       - suma > 0
       - data turi būti per projekto datas (jei jos nustatytos)
       - saltinio_dalis (jei nurodyta):
         - kiekvienas elementas turi `funding_source_id` (int) ir `suma` (string-decimal)
         - SUM(saltinio_dalis[].suma) === expense.suma (validation strict)
         - kiekvienas funding_source_id egzistuoja
       - Jei `saltinio_dalis === null` → default'inis: visa suma iš `budget_allocation.funding_source_id`
     - `update` — AM admin + org_admin; CAN'T change project_id; validation kaip create
     - `delete` — AM admin + org_admin (savo tenant); soft delete? Ne, hard delete (su komentaru, kad audit log galima review jei reikės)

3. **Likučio skaičiavimas** — perdaryti existing summary endpoint'us:
   - `budgetAllocations.service.ts:summary`:
     - planuota = allocation.planuota_suma
     - faktine = SUM expenses WHERE allocation_id = X (jei expense be saltinio_dalis) + SUM saltinio_dalis dalies (jei daugiasluoksnis split)
     - **Konkrečiai**:
       - Single-source expense: jos visa suma įskaitoma į budget_allocation.funding_source_id allocations
       - Multi-source expense: kiekvienas saltinio_dalis[].suma įskaitoma į ATITINKAMĄ allocation per funding_source_id+kategorija (BUT BUT — viena išlaida susieta su VIENU allocation per `expenses.budget_allocation_id`; multi-source dalo finansavimo šaltinius, ne kategorijas)
       - **Praktikoje**: faktine_allocation = SUM expenses.suma WHERE expenses.budget_allocation_id = X (visi expenses, įskaitant multi-source — saltinio_dalis tik atspindi finansavimo šaltinio paskirstymą, ne allocation pasirinkimą)
     - likutis = planuota - faktine
     - warning: likutis < 20% planuotos → flag (per `WARNING_THRESHOLD_PERCENT = 80` const'as)
   - `projects.service.ts:summary`:
     - biudzetas = project.biudzetas
     - panaudota = SUM expenses WHERE project_id = X
     - likutis = biudzetas - panaudota
     - warning: panaudota >= 80% biudzeto → flag

4. **Naujasis endpoint**: `expenses.budgetSummary` (arba per dashboard)
   - GET endpoint grąžinantis warning listing:
   - `{ year, items: [{ allocationId, allocationName, planuota, faktine, likutis, percentUsed, isWarning, isOver }] }`
   - Filter: year, projectId optional

5. **Shared types** (`packages/shared/src/fvm.ts`):
   - `Expense` interface (id, projectId, budgetAllocationId, tipas, suma, data, aprasymas, saltinioDalis, createdByUserId, createdAt, updatedAt)
   - `ExpenseType = 'du' | 'sutartis' | 'saskaita' | 'tiesiogine'`
   - `ExpenseSourceDistribution = { fundingSourceId: number; suma: string }[]`
   - `ExpenseCreateDTO`, `ExpenseUpdateDTO`, `ExpenseListQuery`
   - Update `BudgetAllocationSummary` (planuota, faktine, likutis, percentUsed, isWarning, isOver)
   - Update `ProjectSummary` (panaudota update, isWarning, isOver)
   - `BudgetWarningItem` (allocationId, name, planuota, faktine, likutis, percentUsed, isWarning, isOver)

6. **API routing**: `apps/api/src/services/api.service.ts`
   - Pridėti `expenses.*` whitelist + REST aliases `/expenses/*`
   - `runner.ts` registruoti expense service

7. **Konfigūracija**: konstantos arba env vars
   - `FVM_WARNING_THRESHOLD_PERCENT` (default 80, env override)
   - Kol kas const'as `apps/api/src/utils/fvm.ts` arba panašiai

8. **Integration testai**:
   - `apps/api/test/services/expenses.service.spec.ts` (bent 10):
     1. AM admin create expense
     2. Org admin create savo tenant
     3. Org user (ne admin) → 403
     4. Create su saltinio_dalis sumuojantis į expense.suma — sėkmingai
     5. Create su saltinio_dalis kuris NESUMUOJA → 400 LT klaida
     6. Create expense data not in project date range → 400
     7. Update: change suma ir saltinio_dalis konsistentiškai
     8. Delete: project su expense neištrinama (RESTRICT 409 jei bandoma)
     9. List filter pagal projectId, year, type
     10. List per saltinio_dalis (filter pagal funding_source_id) — GIN query veikia
     11. Cross-tenant access blokuotas
   - `apps/api/test/services/expense-summary.spec.ts` (bent 6):
     1. budgetAllocations.summary su 0 expenses → faktine=0, likutis=planuota, isWarning=false
     2. su expense 50% — faktine=50%, isWarning=false (under 80)
     3. su expense 80% — isWarning=true, isOver=false
     4. su expense 100% — isWarning=true, isOver=false
     5. su expense 110% — isWarning=true, isOver=true
     6. projects.summary su mixed expenses — agreguoja teisingai
   - `apps/api/test/services/expenses-budget-summary.spec.ts` (bent 3):
     1. Year filter su keliais allocations — visi grąžinami
     2. Multi-source expenses agregacija atspindi allocation tikslą
     3. Empty data → []

**Constraints**:
- TS strict
- LT errors
- Transakcijos
- Money/decimal: naudoti `toCents`/`centsToAmount` (jau yra `money.ts`)
- saltinio_dalis sum validation: precision 0.01 (epsilon comparison)
- **NEKOMITUOTI**

**Done criterion**:
- `cd apps/api && yarn test` PASS (127 esami + ~20 nauji)
- `cd apps/api && yarn typecheck` pass
- `cd apps/api && yarn build` pass

### C. Frontend brief

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas skaitymas**:
1. `docs/fvm/iter-12-expenses.md` — sekcija „C. Frontend brief"
2. `docs/fvm/01-architecture.md` — Frontend struktūra (Iter 12)
3. `docs/fvm/spec/FVM-v0.1.md` — §4.3
4. `packages/shared/src/fvm.ts` — Expense, ExpenseSourceDistribution
5. `apps/web/src/pages/ProjektoDetailPage.tsx` — kur dabar yra Iter 12 placeholder, dabar reali implementacija
6. `apps/web/src/lib/api/fvm.ts` — papildyti expensesApi
7. `apps/web/src/components/projects/` — referencija dialog stiliui

**Deliverables**:

1. **API client**: `apps/web/src/lib/api/fvm.ts`
   - `expensesApi`: list, get, create, update, remove, budgetSummary
   - Atnaujinti `BudgetAllocationSummary` ir `ProjectSummary` tipus per shared

2. **Komponentai**: `apps/web/src/components/expenses/`
   - `ExpensesSection.tsx` — projekto išlaidos sąrašas su pridėjimo/edit/delete
     - Lentelė: data | tipas | suma € | aprasymas | šaltiniai (badge if multi) | veiksmai
     - Filter: tipas, dateFrom, dateTo
     - „Pridėti išlaidą" mygtukas (AM admin + org_admin)
   - `ExpenseDialog.tsx` — CRUD modal:
     - Tipas (radio: du / sutartis / saskaita / tiesiogine)
     - Suma (decimal)
     - Data (date)
     - Aprasymas (textarea, optional)
     - „Padalinti tarp finansavimo šaltinių" checkbox:
       - Jei OFF: visa suma iš default'inio funding_source (per budget_allocation)
       - Jei ON: atveria multi-row UI — kiekviena eilutė: funding_source dropdown + suma — total turi sutapti su expense.suma (live validation)
     - Validation: suma > 0, data required, jei split — total === expense.suma
   - `BudgetWarningBanner.tsx` — warning banner allocation summary'iui (rodo planuota/faktine/likutis/percentUsed; flag jei isWarning/isOver)

3. **ProjektoDetailPage atnaujinta**:
   - „Išlaidos" placeholder pakeisti į real `ExpensesSection` komponentą
   - Summary section: rodyti naują BudgetSummary su isWarning/isOver flag'ais (planuota/panaudota/likutis su procentu)
   - Project status update'inant — invalidate expenses queries

4. **BiudzetasPage atnaujinta**:
   - Allocation row'ai rodo summary (planuota | faktine | likutis | %used) iš `summary` endpoint'o
   - Warning badge'ai (≥80% — geltonas; >100% — raudonas)
   - Naujas dropdown/section: „Įspėjimai" — sąrašas allocations su isWarning=true

5. **Naujasis dashboard chart arba section**:
   - `apps/web/src/components/charts/BudgetWarningsChart.tsx` arba list
   - Rodo top 5-10 allocations su didžiausiu percentUsed
   - Integruoti į StatistikaPage arba dedicated section

6. **Frontend testai**:
   - `apps/web/src/components/expenses/__tests__/ExpenseDialog.test.tsx` (3+ testai):
     1. Form validation (suma required, > 0)
     2. Multi-source split: total != expense suma → klaida rodoma
     3. Multi-source split: sėkmingai submit'ina su valid split
   - `apps/web/src/components/expenses/__tests__/ExpensesSection.test.tsx` (2+ testai):
     1. Empty state
     2. Renders list su mock data; AM admin matos create button

**Constraints**:
- LT UI
- shadcn primitives (Dialog, Select, Input, Checkbox, Textarea, RadioGroup arba native radio)
- React Query invalidations po expense create/update/delete: expenses, budget summary, project summary, dashboard
- A11y
- NEKEISTI: kitų puslapių be priežasties
- **NEKOMITUOTI**

**Done criterion**:
- `cd apps/web && yarn test` PASS (57 esami + nauji)
- `cd apps/web && yarn typecheck` pass
- `cd apps/web && yarn build` pass

## Iter 12 Audit kriterijai

### Kriterijus 1: DB schema §6.4
- [ ] expenses lentelė: visi 11 laukų + CHECK constraint tipas + FK + GIN'as ant saltinio_dalis

### Kriterijus 2: Multi-source split (F07)
- [ ] saltinio_dalis jsonb veikia
- [ ] Backend validation: SUM(saltinio_dalis[].suma) === expense.suma
- [ ] Frontend live validation
- [ ] List filter pagal funding_source_id (GIN query)

### Kriterijus 3: Faktinė + likutis (F06, F08)
- [ ] budgetAllocations.summary grąžina real faktine ir likutis
- [ ] projects.summary grąžina real panaudota ir likutis
- [ ] Auto-reduce'inimas: po expense create, likutis atnaujintas

### Kriterijus 4: Įspėjimai 80% (F11)
- [ ] isWarning flag set kai percentUsed ≥ 80
- [ ] isOver flag set kai percentUsed > 100
- [ ] Konfigūruojama riba per WARNING_THRESHOLD_PERCENT (env var galimas)

### Kriterijus 5: Permission gates
- [ ] AM admin + org_admin gali create/update/delete (savo tenant)
- [ ] Org user 403
- [ ] Cross-tenant blokuojama

### Kriterijus 6: UI funkcionalumas
- [ ] /projektai/:id Išlaidos sekcija veikia
- [ ] ExpenseDialog su multi-source split
- [ ] BiudzetasPage rodo warning'us
- [ ] BudgetWarningsChart/list rodo top warnings

### Kriterijus 7: Testai
- [ ] Backend bent 10 expense + 6 summary + 3 budget warning testai = 19+ migration
- [ ] Frontend bent 5 nauji
- [ ] Visi pereina

### Kriterijus 8: TS + Build
- [ ] typecheck + build pass abiem app'sams
