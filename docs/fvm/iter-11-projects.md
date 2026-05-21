# Iter 11 (FVM-3) — Projects (3 lygis) + auto-create iš prašymo

> **CTO brief**. Įgyvendina docx §2.4, §4.2, §6.3, F03, F04, F05.

## Tikslas

Nauja `projects` lentelė (3 FVM lygio objektas) — kas faktiškai naudoja biudžetą. Tipai: projektas, spec_programa, veikla. `project.service.ts` su CRUD + lifecycle (planuojama → vykdoma → baigta → uždaryta). AM patvirtinus spec.programa prašymą → galima sukurti `project` įrašą (per Iter 10 placeholder mygtuką, dabar realiai). Naujasis `/projektai` UI puslapis su CRUD + auto-create button'as patvirtinto prašymo detalėje.

Iter 10 sukūrė `fvm_project_id` lauką į `requests` lentelėje (be FK). Iter 11 pridės FK constraint + populate'ina iš real projects.

## Apima iš docx

- §2.4 Projektai ir veiklos (3 lygis)
- §4.2 project.service.ts funkcijos
- §6.3 projects schema
- F03: Spec.programos automatinis sukūrimas iš patvirtinto prašymo
- F04: Spec.programos finansavimo tipo valdymas (jau yra requests laukas; čia projekto sluoksnis)
- F05: Projekto / veiklos kūrimas ir susiejimas su biudžeto eilute

## NEAPIMA

- §4.3 expenses sluoksnis (Iter 12)
- §4.4 payroll (Iter 13)
- §4.5 reports (Iter 14)
- Spec.programos `spec_prog_tipas` (atskiras|biudzeto_dalis) — jau Iter 9, budget_allocation lauke

## Esama būklė

- `budget_allocations_v2` lentelė + servisas — Iter 9 padarytas (FK target)
- `requests.fvm_project_id` laukas — Iter 10 sukurtas, NULL
- `createFvmProject` placeholder action `requests.service.ts` — Iter 10. Iter 11 perdaro real implementation.
- UI mygtukas „Sukurti FVM projektą" PrasymoDetailPage'e — yra, kviečia placeholder. Iter 11 — real call'as.

## Komandos sudėtis

| Rolė | Subagentas | Atsakomybė |
|---|---|---|
| DBA | general-purpose | projects migracija + requests.fvm_project_id FK + tests |
| Backend Engineer | general-purpose | Project model + service + auto-create logic + integration su requests + tests |
| Frontend Engineer | general-purpose | /projektai page + dialogai + integration į PrasymoDetailPage + tests |
| Independent Auditor | general-purpose | Audit kriterijai po komandos |

## Subagentų briefingai

### A. DBA brief

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas skaitymas**:
1. `docs/fvm/iter-11-projects.md` (šitas failas) — sekcija „A. DBA brief"
2. `docs/fvm/01-architecture.md` — `projects` schema sekcija
3. `docs/fvm/spec/FVM-v0.1.md` — §2.4, §6.3
4. `apps/api/src/database/migrations/20260522100000_create_fvm_foundation.ts` — stiliaus referencija
5. `apps/api/src/database/migrations/20260523100000_add_fvm_fields_to_requests.ts` — Iter 10 migracija (kontekstas)

**Deliverables**:

1. **Migracija**: `apps/api/src/database/migrations/20260524100000_create_projects.ts`
   - Sukuria `projects` lentelę pagal `01-architecture.md`:
     - id SERIAL PK
     - tenant_id integer FK → tenants(id) ON DELETE RESTRICT
     - budget_allocation_id integer FK → budget_allocations_v2(id) ON DELETE RESTRICT
     - request_id integer FK → requests(id) ON DELETE SET NULL (NULL jei ne spec_programa)
     - pavadinimas varchar(300) NOT NULL
     - tipas varchar(20) NOT NULL CHECK IN ('projektas', 'spec_programa', 'veikla')
     - biudzetas decimal(15, 2) NOT NULL
     - pradzios_data date NULL
     - pabaigos_data date NULL
     - statusas varchar(20) NOT NULL DEFAULT 'planuojama' CHECK IN ('planuojama', 'vykdoma', 'baigta', 'uzdaryta')
     - atsakingas_user_id integer FK → users(id) ON DELETE SET NULL
     - aprasymas text NULL
     - created_at, updated_at timestamptz
   - Indexai: `idx_projects_tenant`, `idx_projects_allocation`, `idx_projects_request`, `idx_projects_status`
   - **Antroji dalis: requests.fvm_project_id FK**:
     - `ALTER TABLE requests ADD CONSTRAINT requests_fvm_project_id_foreign FOREIGN KEY (fvm_project_id) REFERENCES projects(id) ON DELETE SET NULL`
     - Pirma patikrinti, ar nėra jokių requests su NULL'iniu fvm_project_id (turėtų būti visi NULL po Iter 10 — saugus pridėjimas)
   - `down`: drop'ina FK constraint nuo requests → drop'ina projects lentelę
   - VIENAS transaction'as (atomic)

2. **Integration testas**: `apps/api/test/database/projects-foundation.spec.ts`
   - Setup: seed AM tenant + funding_source + budget_allocation_v2 + admin user
   - Testai (bent 6):
     1. projects lentelė turi visus 12 laukų pagal §6.3
     2. CHECK constraint `tipas`: insert su `tipas='invalid'` throw'ina
     3. CHECK constraint `statusas`: insert su `statusas='invalid'` throw'ina
     4. Insert spec_programa projektas su request_id — sėkmingai (request egzistuoja)
     5. Insert projektas be request_id (regular project) — sėkmingai
     6. FK requests.fvm_project_id veikia: po projekto sukūrimo galima patch'inti request.fvm_project_id į tą projekto ID
     7. ON DELETE SET NULL ant request_id: ištrinant request'ą, project išlieka su request_id=NULL
     8. ON DELETE SET NULL ant requests.fvm_project_id: ištrinant project'ą, request išlieka su fvm_project_id=NULL
     9. Rollback (`down`) veikia — visos lentelės/constraints dingo

**Constraints**:
- TS strict
- LT header komentaras
- knex.transaction visam darbui
- CHECK constraints per raw SQL
- NEKEISTI: esamų migracijų, esamų servisų
- **NEKOMITUOTI**

**Done criterion**:
- `cd apps/api && yarn db:migrate` paleidžia
- `cd apps/api && yarn test projects-foundation` PASS
- `cd apps/api && yarn typecheck` pass

### B. Backend brief

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas skaitymas**:
1. `docs/fvm/iter-11-projects.md` — sekcija „B. Backend brief"
2. `docs/fvm/01-architecture.md` — projects schema, API contracts
3. `docs/fvm/spec/FVM-v0.1.md` — §2.4, §4.2 (project.service.ts funkcijos), §3 (auto-create from request)
4. `apps/api/src/services/budgetAllocations.service.ts` — referencija servisas (FVM stiliaus)
5. `apps/api/src/services/requests.service.ts` — esamas `createFvmProject` placeholder (eilutes ieško Iter 10 commit'e)
6. `apps/api/src/models/Request.ts` — esamas modelis

**Deliverables**:

1. **Objection.js modelis**: `apps/api/src/models/Project.ts`
   - Fields atitinkantys schema
   - Relations: tenant, budgetAllocation, request, atsakingasUser
   - JSON schema validation

2. **Naujas servisas**: `apps/api/src/services/projects.service.ts`
   - Pagal `budgetAllocations.service.ts` stilių
   - Endpoint'ai:
     - `list` — filter: tenantId, status, type, allocationId, requestId; visi auth'd users
     - `get` — visi auth'd users (tenant scope tikrinimas)
     - `create` — AM admin gali viskuose tenant'uose; org_admin tik savo tenant'e. Validation:
       - pavadinimas, tipas, biudzetas, budgetAllocationId required
       - Jei `tipas === 'spec_programa'` → request_id required, request turi būti APPROVED status'o
       - biudzetas > 0
       - pradzios_data <= pabaigos_data (jei abi nurodytos)
       - budgetAllocationId pagal tenant nepasiekiamas — patikrinti, kad allocation priklauso tenant'ui (per funding_source.tenant_id chain)
     - `update` — AM admin + org_admin; CAN'T change tipas po sukūrimo
     - `delete` — AM admin only; RESTRICT jei status != 'planuojama' (saugumas; vykdomus negalima trinti)
     - `changeStatus` — atskira endpoint'a su valid transitions: planuojama→vykdoma→baigta→uzdaryta; reverse transitions tik AM admin (vykdomą galima grįžinti į planuojamą)
   - LT klaidų žinutės

3. **Auto-create logika** — perdaryti `requests.createFvmProject` action:
   - **Naujas real implementation** (vietoj placeholder):
     - Validate: request.status === 'APPROVED'
     - Validate: request.fvmProjectId === null (kad nedubliuotume)
     - Validate: AM admin (per `requireAmAdmin` helper)
     - Use case 1 — spec.programa: jei `request.budgetCategoryId` rodantis į `spec_programa` classifier item:
       - Reikia `budget_allocation_id` — nustatomas paieška: jei yra allocation su `category_classifier_item_id = request.budgetCategoryId` AND `metai = request.year` → naudoja tą; jei kelios — naudoja pirmą (TODO Iter 14+: leist AM admin pasirinkti); jei nė vienos — 400 LT klaida
     - Use case 2 — kiti tipai: kol kas tik spec.programa auto-create palaikoma; kiti tipai per /projektai manual create
     - Sukuria Project:
       - tenant_id = request.tenant_id
       - budget_allocation_id = nustatytas pagal kategoriją + metus
       - request_id = request.id
       - pavadinimas = request.projectName (arba „Spec. programa: {projectName}")
       - tipas = 'spec_programa'
       - biudzetas = request.decisionGrantedAmount
       - statusas = 'planuojama'
       - atsakingas_user_id = request.created_by_user_id (institucijos kontakto asmuo)
       - aprasymas = request.description (skopuota iš prašymo)
     - Po sukūrimo: patch `requests.fvm_project_id = newProject.id`
     - Visa transakcijoje
     - Grąžina: `{ status: 'created', project: <Project DTO>, requestId }`

4. **Permission patikrinimas tenant scope**:
   - `list` — org users mato savo tenant projektus; AM admin'ai mato visus
   - `get` — tenant scope check; 403 jei kitos tenant projektas
   - `create` — tenant scope check; AM admin + org_admin gali kurti savo tenant'e
   - `update` — tas pats kaip create
   - `delete` — tik AM admin
   - `changeStatus` — AM admin + org_admin (savo tenant)

5. **Shared types** (`packages/shared/src/fvm.ts` papildoma):
   - `Project` interface
   - `ProjectCreateDTO`, `ProjectUpdateDTO`, `ProjectChangeStatusDTO`
   - `ProjectType`, `ProjectStatus` types
   - `CreateFvmProjectResponse` papildyti (real fields, ne placeholder)

6. **API routing**: `apps/api/src/services/api.service.ts`
   - Pridėti `projects.*` į whitelist
   - REST aliases: `/projects/*` + `/projects/:id/status` PATCH + `/projects/:id/summary` GET (placeholder summary, real Iter 12)

7. **Integration testai**: `apps/api/test/services/projects.service.spec.ts` (bent 10):
   1. AM admin gali create projektą be request_id (regular projektas)
   2. Spec.programa create reikalauja request_id ir request.status=APPROVED
   3. Spec.programa create — request_id rodantis į ne-APPROVED → 400
   4. AM admin gali list visus projektus
   5. Org admin mato tik savo tenant projektus
   6. Org user negali create — 403
   7. AM admin gali changeStatus (planuojama → vykdoma)
   8. Invalid status transition (baigta → planuojama) — 400 (org user'iui); AM admin gali revert
   9. Delete tik kai statusas=planuojama — vykdoma → 409 (RESTRICT)
   10. Budget_allocation_id iš kitos tenant'o → 400

8. **createFvmProject integration tests** (`apps/api/test/services/requests-create-fvm-project.spec.ts`, bent 5):
   1. AM admin + APPROVED spec.programa + esama allocation → sėkmingai sukuria, fvm_project_id užpildomas
   2. APPROVED non-spec_programa → grąžina „Per /projektai manual create" (placeholder OK) arba leidžia su default settings — pasirink ir dokumentuok
   3. SUBMITTED request → 400 (turi būti APPROVED)
   4. Request su fvm_project_id != NULL → 400 (jau sukurtas)
   5. Spec.programa be matchin'inčios allocation → 400 LT klaida

**Constraints**:
- TS strict
- LT user-facing errors
- Visi DB pakeitimai transakcijose
- Naudoja esamus permission helper'ius
- NEKEISTI esamų servisų be priežasties (decision endpoint'as gali likti — auto-create gali būti rankinis per createFvmProject)
- **NEKOMITUOTI**

**Done criterion**:
- `cd apps/api && yarn test` visi PASS (84 esami + ~15 nauji)
- `cd apps/api && yarn typecheck` pass
- `cd apps/api && yarn build` pass

### C. Frontend brief

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas skaitymas**:
1. `docs/fvm/iter-11-projects.md` — sekcija „C. Frontend brief"
2. `docs/fvm/01-architecture.md` — Frontend struktūra (Iter 11 pages)
3. `docs/fvm/spec/FVM-v0.1.md` — §2.4, §4.2
4. `packages/shared/src/fvm.ts` — naujieji tipai (po Backend Iter 11B)
5. `apps/web/src/pages/FinansavimoSaltiniaiPage.tsx` — referencija page stiliui
6. `apps/web/src/components/funding-sources/` — referencija dialogams
7. `apps/web/src/pages/PrasymoDetailPage.tsx` — esamas „Sukurti FVM projektą" placeholder mygtukas

**Deliverables**:

1. **Naujasis puslapis**: `apps/web/src/pages/ProjektaiPage.tsx`
   - Sąrašas su filtru: metai, tipas (visi/projektas/spec_programa/veikla), statusas, tenant (jei AM admin)
   - Lentelė ar kortelės: pavadinimas | tipas (badge) | biudžetas | statusas | atsakingas | veiksmai
   - „Naujas projektas" mygtukas (AM admin + org_admin)
   - Klikti row → ProjektoDetailPage

2. **Naujasis puslapis**: `apps/web/src/pages/ProjektoDetailPage.tsx`
   - Atskira route'a `/projektai/:id`
   - Header: pavadinimas + statusas badge
   - Metaduomenys: tipas, tenant, biudzetas, daty, atsakingas, aprasymas
   - Susietas request'as (jei spec_programa) — link'as į prašymą
   - Susietas budget_allocation — link'as į /biudzetas su filter
   - Status change mygtukai (AM admin + org_admin atitinkamose tranzicijose)
   - Placeholder „Išlaidos" sekcija — pažymėta „Iter 12"
   - „Redaguoti" mygtukas → atveria ProjectDialog

3. **Komponentai**: `apps/web/src/components/projects/`
   - `ProjectDialog.tsx` — CRUD modal:
     - pavadinimas (string), tipas (select: projektas|spec_programa|veikla — disabled jei edit), biudzetas (decimal), pradzios_data (date), pabaigos_data (date), atsakingas (User select — only same tenant users), aprasymas (textarea), budget_allocation_id (FundingSourceAllocation select, group'inant per funding_source)
     - Jei tipas=spec_programa → request_id pasirinkimas (paieška per approved spec.programa requests) — optional
     - Validation: visi required + dates + biudzetas > 0
   - `ProjectStatusBadge.tsx` — statusas su spalvomis
   - `ProjectStatusChangeDialog.tsx` — dialog status pakeitimui (su komentaru optional)

4. **PrasymoDetailPage atnaujinta**: `apps/web/src/pages/PrasymoDetailPage.tsx`
   - „Sukurti FVM projektą" mygtukas — dabar kviečia real backend (per existing API client function)
   - Po sėkmingo sukūrimo: redirect arba toast + invalidate query → fvmProjectId atsiranda
   - Jei request.fvmProjectId nustatytas → rodyti nuorodą „Žiūrėti projektą"
   - Tooltip pakeisti iš „Iter 11" į actual purpose (pvz., „Sukurti spec.programos vykdymo projektą")

5. **Routing**: `apps/web/src/App.tsx`
   - `/projektai` → ProjektaiPage
   - `/projektai/:id` → ProjektoDetailPage

6. **Sidebar atnaujinimas**: `apps/web/src/components/Sidebar.tsx`
   - Naujas punktas „Projektai" (icon: Briefcase ar FolderKanban)
   - Matomas visiems auth users (org_admin gali kurti, list visiems)

7. **API client**: `apps/web/src/lib/api/fvm.ts` papildyti:
   - `projectsApi`: list, get, create, update, remove, changeStatus
   - Tipai iš `@biip-finansai/shared`

8. **Frontend testai**:
   - `apps/web/src/pages/__tests__/ProjektaiPage.test.tsx` (3+ testai):
     1. Renders empty state
     2. AM admin sees create button; org user doesn't
     3. List renders su mock data
   - `apps/web/src/components/projects/__tests__/ProjectDialog.test.tsx` (2+ testai):
     1. Form validation
     2. request_id dropdown rodomas tik kai tipas=spec_programa

**Constraints**:
- LT UI tekstai
- shadcn primitives + ClassifierSelectById (Iter 10 pridėta)
- React Query invalidations po mutate
- A11y
- NEKEISTI: PrasymaiPage, BiudzetasPage, FinansavimoSaltiniaiPage be priežasties
- **NEKOMITUOTI**

**Done criterion**:
- `yarn typecheck` (api+web) pass
- `yarn test` (api+web) pass
- `yarn build` (abu) pass

## Iter 11 Audit kriterijai

### Kriterijus 1: DB schema §6.3
- [ ] projects lentelėje visi 12 laukų
- [ ] CHECK constraints tipas + statusas
- [ ] Visi FK su tinkamais ON DELETE
- [ ] requests.fvm_project_id FK pridėtas

### Kriterijus 2: Project lifecycle (§4.2)
- [ ] Status transitions veikia: planuojama → vykdoma → baigta → uzdaryta
- [ ] Reverse transitions tik AM admin
- [ ] Validation per service

### Kriterijus 3: Spec.programa auto-create (F03)
- [ ] AM patvirtinus spec.programa prašymą + mygtuko spaudimu — projektas sukuriamas su tinkamais laukais (request_id, biudžetas=approved_amount, tenant, tipas=spec_programa)
- [ ] requests.fvm_project_id užpildomas
- [ ] Duplikatas neleidžiamas (fvm_project_id != null → 400)

### Kriterijus 4: Manual project create (F05)
- [ ] /projektai puslapyje galima sukurti regular projektą (tipas=projektas arba veikla)
- [ ] Dialog'as turi visus reikiamus laukus
- [ ] budget_allocation_id pasirinkimas veikia

### Kriterijus 5: Permission gates
- [ ] AM admin gali viską
- [ ] Org admin gali kurti savo tenant'e
- [ ] Org user negali kurti — 403
- [ ] Cross-tenant access blocked

### Kriterijus 6: UI funkcionalumas
- [ ] /projektai puslapis renders
- [ ] /projektai/:id detail renders
- [ ] „Sukurti FVM projektą" mygtukas PrasymoDetailPage'e veikia (real call)
- [ ] Sidebar nav punktas

### Kriterijus 7: Testai
- [ ] Backend bent 10 projects + 5 createFvmProject + 6 migration testai
- [ ] Frontend bent 5 nauji
- [ ] Visi pereina

### Kriterijus 8: TS + Build
- [ ] typecheck + build pass abiem app'sams
