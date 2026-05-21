# Diskusijų log

Naujausi įrašai viršuje. Vienas įrašas = vienas sprendimas/diskusija.

## 2026-05-21 — Iter 12 (FVM-4) baigta — Expenses + likučio skaičiavimas + warnings

Ketvirtoji FVM iteracija. §4.3, §6.4, F06-F08, F11 docx. 3 paralelinės komandos + auditas. 8/8 PASS.

**Svarbu**:
- **expenses lentelė** su `saltinio_dalis jsonb` (ADR-002): viena išlaida gali būti padalinta tarp kelių finansavimo šaltinių. GIN index'as su `jsonb_path_ops` containment query'ams.
- **Multi-source SUM validation**: 1 ct epsilon (1 cent = 0.01 €). Frontend + backend abu naudoja tą patį constant'ą.
- **Realus likutis**: `budgetAllocations.summary` ir `projects.summary` dabar grąžina tikrą `faktine` per SUM(expenses) — Iter 9-11 grąžino '0.00' placeholder'į.
- **Warning threshold**: `FVM_WARNING_THRESHOLD_PERCENT` env var (default 80%). `isWarning` ≥80%, `isOver` >100%. Konfigūruojama per environment, ne per UI (Iter 14+ gal pridėsim settings page'ą).
- **Bulk summary endpoint**: `/expenses/budget-summary` grąžina visus allocations su flags vienoje užklausoje — vietoj N+1 per kiekvieną allocation row. BiudzetasPage'as naudoja šitą.
- **UI warnings**: BudgetWarningBanner su progress bar (geltonas/raudonas tonai), BudgetWarningsList (top N) StatistikaPage'e ir BiudzetasPage'e.
- **Test isolation iteracinis pattern**: kiekviena nauja Iter pridėjus FK į ankstesnių iter lenteles, esamų testų `beforeAll` reikia rollback'inti naujausią iter pirmiausia. Iter 12A pridėjo expenses rollback į 3 esamus spec'us.

**Deliverables**:
- 3 commits → `dev`, 1 audit, CI in progress
- Backend: 48 nauji testai (18 migration + 18 service + 7 summary + 5 budget-summary). Iš viso 175.
- Frontend: 9 nauji testai. Iš viso 66.
- Naujasis modelis + servisas: Expense / expenses.service.ts (CRUD + budgetSummary)
- API endpoint'ai: /expenses/*, /expenses/budget-summary
- Migration: `20260525100000_create_expenses.ts` + GIN index
- Frontend: ExpensesSection, ExpenseDialog, BudgetWarningBanner, BudgetWarningsList; ProjektoDetailPage + BiudzetasPage + StatistikaPage atnaujinti

Toliau — Iter 13 (FVM-5): payroll DU sluoksnis. SVARBU — saugumo griežti reikalavimai (specialistas savo duomenų NEMATO).

## 2026-05-21 — Iter 11 (FVM-3) baigta — Projects (3 lygis) + auto-create

Trečioji FVM iteracija. §2.4, §4.2, §6.3, F03-F05 docx. 3 paralelinės komandos + auditas. 8/8 PASS.

**Svarbu**:
- **projects lentelė** = 3 FVM lygio objektas. Tipai: projektas, spec_programa, veikla. Statusai: planuojama → vykdoma → baigta → uzdaryta.
- **requests.fvm_project_id FK** uždarytas (Iter 10 paliko be FK). Orphan check guard'as migracijoje.
- **`createFvmProject` real implementation** pakeičia Iter 10 placeholder'ą. AM admin patvirtinto spec.programa prašymo → mygtuko paspaudimu sukuriamas projekto įrašas (tipas=spec_programa, biudžetas=approved_amount, request_id, atsakingas=createdByUser). Allocation suranda per kategorija+metai. Non-spec_programa → 400 LT „rankiniu būdu per /projektai".
- **`CreateFvmProjectResponse` discriminated union** ('created' | 'pending'): real Iter 11 grąžina 'created' su Project objektu; tipas backward-compatible su Iter 10 placeholder pending response.
- **Test isolation fix**: kai Iter 11 sukūrė FK iš requests.fvm_project_id į projects, Iter 9/10 testai negalėjo daryt `migrate.down` savo specifikams (FK blokavo). Pridėtas eksplicitinis Iter 11 rollback prieš ankstesnių iter rollback'us — tylus, bet svarbus fix.
- **`/projektai` + `/projektai/:id`** UI: lentelė su filtrais, dialog'ai (Project, StatusChange), badges (Status, Type), summary endpoint placeholder Iter 12 expenses.

**Deliverables**:
- 3 commits → `dev`, 1 audit, CI green
- Backend: 29 nauji testai (127 viso)
- Frontend: 9 nauji testai (57 viso)
- Naujasis modelis + servisas: Project / projects.service.ts (CRUD + lifecycle + permissions)
- API endpoint'ai: /projects/*, /projects/:id/status, /projects/:id/summary
- Migration: `20260524100000_create_projects.ts` + FK į requests

Toliau — Iter 12 (FVM-4): expenses lentelė, expense.service.ts, multi-source split (jsonb saltinio_dalis), realaus budget likučio skaičiavimas, 80% warning threshold.

## 2026-05-21 — Iter 10 (FVM-2) baigta — Stream 1 request integration

Antroji FVM iteracija užbaigta. §3 docx (P01-P06) — esamos sistemos pakeitimai. 3 paralelinės komandos (DBA → Backend → Frontend) + nepriklausomas auditas. 8/8 PASS.

**Svarbu**:
- **Wizard turi 6 žingsnius** (anksčiau 5): pridėtas „Biudžetas" tarp Finansavimas ir Ketvirčiai. Visi nauji laukai opcionalūs (backward compat seniems prašymams).
- **AM patvirtinimo ekrane** AM gali pakeisti budgetCategory/specProgramFundingType/fundingSourceType per decision dialog'ą — institucijos pasirinkimas pre-fill'inamas, bet AM gali koreguoti.
- **Nauja `ClassifierSelectById` variant** (numeric ID-based) FVM laukams — senas `ClassifierSelect` (code-based) lieka backward compat'ui.
- **`createFvmProject` placeholder endpoint** + UI mygtukas — backend grąžina pending message, real implementation Iter 11.
- **Pre-existing bug** (ApprovalStep.$beforeUpdate naudoja BaseModel'o updated_at, bet approval_steps lentelė tos kolonos neturi) — ištaisytas (no-op override). Reikalingas Iter 10 testams; niekada nebuvo trigger'inamas anksčiau, nes nebuvo testų.
- **`fvm_project_id` kol kas be FK** į projects (lentelės nėra iki Iter 11). FK pridėsim Iter 11 migracijoje.

**Deliverables**:
- 3 commits → `dev` → CI in progress
- Backend: 30 nauji testai (84 viso)
- Frontend: 6 nauji testai (48 viso)
- Migration: `20260523100000_add_fvm_fields_to_requests.ts`
- API endpoint: `POST /requests/:id/create-fvm-project` (placeholder)
- Naujas chart: `BudgetCategoryChart` StatistikaPage'e

Toliau — Iter 11 (FVM-3): projektų lentelė, project.service, auto-create iš patvirtinto spec.programa prašymo, /projektai UI.

## 2026-05-21 — Iter 9 (FVM-1) baigta — Foundation tables

Pirmoji FVM iteracija užbaigta. 4 paralelinės komandos (Test Infra → DBA → Backend → Frontend) + nepriklausomas auditas. 8/8 audit kriterijai PASS.

**Iškart svarbu** (ne-akivaizdūs sprendimai):
- **ADR-004 priimtas** (`docs/fvm/03-decisions-log.md`): visi nauji FVM lentelių PK ir FK — `SERIAL integer`, ne UUID. Originalus arch doc (v1.0) siūlė UUID, bet DBA pastebėjo, kad visa esama codebase naudoja integer (tenants, users, requests). FK konsistencija svarbiau už docx schemos raidiškumą. Arch doc atnaujinta į v1.1.
- **Backend testų infra atstatyta nuo nulio**: `apps/api/test/` katalogas neegzistavo nuo MVP (jest.config.js referavo nelikvidžius failus). Iter 9A sukūrė pamatą — global-setup/teardown, helpers (db/broker/auth), sanity test. Visi FVM testai dabar veikia ant šito.
- **Heuristic data migration** senų `budget_allocations.classifier_item_id` (per „Lėšų tipas" grupę: SALARY, IT, INVESTMENT etc.) į naują `budget_category` (du, prekes_paslaugos, investicijos, kita). Žr. `mapOldItemToBudgetCategory` funkciją migracijoje. Custom items nepatekę į heuristikas → mapuojami į `kita`. Acceptable, dokumentuota.
- **Sena `budgets` + senas `budget_allocations` lieka koegzistuoti** iki Iter 16. Naujasis tariamas pavadinimas DB — `budget_allocations_v2` (laikinas — Iter 16 pervadinsim). Tas pats su modeliu — `BudgetAllocationV2` klasė.
- **VitePress`srcExclude: ['fvm/**']`**: FVM darbo dokumentai (CTO/komandos koordinavimo turinys) nebepublikuojami per dokų svetainę — buvo CI failure dėl `<placeholder>` šablono žymeklių, kurie atrodė kaip neuždarytas HTML.

**Deliverables**:
- 4 commits → `dev` → dev-finansai.biip.lt deploy success
- Backend: 54 testai PASS (3 sanity + 11 migration + 40 service)
- Frontend: 42 testai PASS (32 baseline + 10 nauji)
- Nauji puslapiai: `/finansavimo-saltiniai`, refaktorintas `/biudzetas`
- API endpoint'ai: `/funding-sources/*`, `/budget-allocations/*`, `/budget-allocations/:id/summary`

Toliau — Iter 10 (FVM-2): prašymo modelio papildymai pagal §3 docx (P01-P06), wizard biudžeto žingsnis, AM approval ekrano papildymai.

## 2026-05-21 — FVM (Iter 9-16) — Kickoff

Giedrė pateikė techninį užsakymą **„Finansų valdymo modulis (FVM)"** v0.1 (`docs/fvm/spec/FVM-v0.1.md`). Tai didelis scope — esamai sistemai pakeitimai (Stream 1, §3 docx) PLIUS visiškai naujas finansų sekimo sluoksnis (Stream 2, §4): funding_sources hierarchy, projects, expenses, payroll.

Vartotojas paskyrė Claude'ą CTO rolėje su instrukcija: 5-9 iteracijos, kiekviena su komanda + nepriklausomu auditu, pilna FVM apimtis.

**Sukurta dokumentacija** `docs/fvm/`:
- `README.md` — katalogas + scope
- `00-master-plan.md` — 8 iteracijos (Iter 9 → Iter 16), ~12 sav. trukmė
- `01-architecture.md` — duomenų modelis, lentelių schema, API contracts
- `02-migration-strategy.md` — esamos `budgets`/`budget_allocations` migracija
- `03-decisions-log.md` — 3 ADR (klasifikatorius vs enum, jsonb vs junction, payroll mokesčiai)
- `PROGRESS.md` — live eiga

**Pagrindinis architektūros sprendimas (ADR-001)**: docx siūlo enum'us `funding_source.tipas` ir `budget_allocation.kategorija`. Mes naudosim klasifikatorius (consistency su PR #10/#11; AM admin galės pridėti naujų be migracijos). Default items seedinami pagal docx values. Spec deviation flagged — gali revertuoti į enum jei Giedrė pareikalaus.

**Iter 9 deliverables**: funding_sources + budget_allocations naujas modelis + data migration iš esamų budgets (2026 1.5M seed) + budget servisas + UI `/finansavimo-saltiniai`.

Laukiama vartotojo sign-off pradėti Iter 9.

## 2026-05-15 — Iter 5 — Docs polish + visi 5 iter baigti

Visi 5 iter užbaigti vienoje sesijoje:
- **Iter 0**: bootstrap, deploy pipeline į 3 aplinkas, demo `demo`/`demo`
- **Iter 1**: tenants + 10 demo accounts pagal AM/AAD/VSTT/LGT, scope rules
- **Iter 2**: prašymo schema (requests + request_comments) ir API su statusais
- **Iter 3**: 5 žingsnių wizard'as (kaip GPAIS) — pagrindinė info → finansavimas → ketv. → atsakingi → peržiūra
- **Iter 4**: ping-pong flow — AM tvirtina/atmeta/grąžina su decision metadata
- **Iter 5**: dokumentacija užbaigta

Liko ateičiai: ketv. ataskaitos, metinė ataskaita, VIISP SSO, Power BI dashboard'ai.

## 2026-05-15 — Iter 4 — Tvirtinimo flow

PrasymoDetailPage rodo prašymą + kelią:
- Komentarų gija su kind badge'ais (submitted/returned/approved/rejected)
- AM rolėms — decision dialogas su privalomu komentaru (jei return/reject)
- Submitter pusėje — RETURNED prašymas vėl redaguojamas, gali pakartotinai pateikti

Decision metadata (skirta suma, šaltinis, protokolas, įsakymas) rodoma APPROVED prašyme.

## 2026-05-15 — Iter 3 — Wizard

RequestWizard komponentas multi-step pildymui. Atskirta nuo PrasymoEditPage kad būtų reusable. Auto-save po kiekvieno žingsnio (PATCH) — jei vartotojas uždarys naršyklę, juodraštis išliks serveryje.

Ketvirčių validacija — suma turi atitikti „Iš viso prašoma" (be DU). Jei skirtumas > 0.01€ — neleidžiama eiti į kitą žingsnį.

## 2026-05-15 — Iter 2 — Prašymo schema

`requests` lentelė su visais Excel laukais suskirstytais į 5 logines grupes. Pinigų sumos — `decimal(12,2)`, JSON'e perduodamos kaip string (decimal preservation iš PostgreSQL).

Statusų mašina:
- DRAFT → SUBMITTED → (RETURNED → SUBMITTED)* → APPROVED | REJECTED

Komentarai (`request_comments`) — viena lentelė ir vartotojo komentaras, ir audit log (kind=`status_change`/`submitted`/`returned`/`approved`/`rejected`).

Sprendimo metadata (`decision_granted_amount`, `decision_funding_source`, `decision_protocol`, `decision_order`, `decided_at`, `decided_by_user_id`) — saugoma tiesiog requests lentelėje. Kelis kartus tvirtinti negalima — kai statusas APPROVED/REJECTED, nebepasiekiama.

## 2026-05-15 — Iter 1 — Auth, tenants, vartotojai

Pridėta `tenants` lentelė (AM + AAD + VSTT + LGT), users papildytas `tenant_id` + `am_scope_org_ids[]`.

Role enum išplėstas iš `admin` į 4 reikšmes:
- `am_admin` — AM administratorius, visi + valdo AM vartotojus
- `am_user` — AM specialistas, scope orgs (NULL = visos)
- `org_admin` — pavaldžios institucijos administratorius, savo tenant
- `org_user` — pavaldžios institucijos vartotojas, tik save

Scope rules išreikštos `canView` / `canManage` helper'iuose `users.service.ts`. Frontend turi mirrored `canManageUsers` helper'į.

Auth.resolveUser endpoint'as — vidinis, naudoja gateway authenticate hook'as, kad pilną AuthUser (su tenant info) atneštų į kiekvieną request.meta.

Seed check'as runner.ts'e — žiūri `tenants` count: jei 0, paleidžia visą seed (truncate + insert). Tai leidžia atnaujinti seed'us tarp iteracijų — tik užwipinti tenants kad refresh'intų.

## 2026-05-15 — Iter 0 bootstrap

Sukurta projekto struktūra kopijuojant iš `hr` repo. Pakeitimai:

- `biip-hr` → `biip-finansai` visuose package'uose
- `ghcr.io/aplinkosministerija/hr*` → `.../finansai*` image tag'uose
- `/hr` API route prefiksas → `/finansai`
- Cookie `hr_session` → `finansai_session`
- Redis prefiksas `hr:session:` → `finansai:session:`
- Domain'ai: `dev-finansai.biip.lt`, `staging-finansai.biip.lt`, `finansai.biip.lt`

**Spalvos:** primary deep teal (HSL 184 60% 22%) vietoj hr žalio.

**Pašalinta:** visos HR-specifinės domain'os (employees / departments / leave / orders / onboarding / dashboard / DBSIS).

## 2026-05-15 — Production aplinkos sprendimas

`finansai.biip.lt` Caddy taisyklė — 302 redirect į `staging-finansai.biip.lt`. Atitinka hr precedent'ą: prod aplinka neturi atskiros DB.

## 2026-05-15 — Iteracijų planas

5 iteracijos + bootstrap (Iter 0). Po kiekvienos — nepriklausomas review subagent'as. Tik tada einam toliau. Detalė — [06 — Implementacijos planas](/06-implementacijos-planas).
