# Changelog

Visi reikšmingi pakeitimai šiame projekte dokumentuojami šiame faile.

Versionavimas — [Semantic Versioning](https://semver.org/lang/lt/). Naujausi įrašai viršuje.

## [Neišleista]

### Pridėta

#### AI generatyvinis dashboard'as (Iter 17, eksperimentinis)

- Naujas numatytasis pradžios puslapis `/` („Pradžia (AI)") — dinaminė widget drobė,
  kurią AI asistentas perpiešia pagal lietuvišką prašymą pokalbio panelėje (CopilotKit
  „Generative UI" pattern'as). Klasikinė pradžia palikta `/pradzia`.
- Pradinis vaizdas — deterministinis, iš realių `dashboard.get` + `dashboard.fvmSummary`
  agregatų (be LLM). Mygtukas „Pradinis vaizdas" grąžina jį bet kada.
- AI duomenis renka tik per vidinius action'us su vartotojo teisėmis (ADR-005 tenant
  scope + DU filtrai galioja), payroll tool'ų nėra, išlaidos — tik agregatai.
- LLM: OpenAI-compatible endpoint'as per `LLM_BASE_URL`/`LLM_MODEL`/`LLM_AUTH_HEADER`
  env'us (demo — qwen3.6 35B ant lokalaus vLLM). Be konfigūracijos AI chat'as grąžina
  503, o pradinis dashboard'as veikia įprastai.

## [0.3.0] — 2026-05-22 — FVM (Finansų valdymo modulis)

Pilnas finansų valdymo modulis pagal Giedrės techninį užsakymą „Finansų valdymo modulis (FVM) v0.1" (`docs/fvm/spec/FVM-v0.1.md`). 8 iteracijos (Iter 9-16), 5 ADR, ~278+ backend testai + ~88+ frontend testai + Playwright E2E infrastruktūra startuota.

### Pridėta

#### Finansavimo šaltiniai (Iter 9, F01)

- Naujasis puslapis `/finansavimo-saltiniai` — AM admin gali valdyti finansavimo šaltinius (1 lygis)
- Lentelė: `funding_sources` su tenant_id, pavadinimas, kodas, tipas (klasifikatorius), metai, metine_suma, aprasymas, aktyvus
- Tipas per klasifikatorių (ADR-001): default items `biudzetas`, `ES_fondai`, `kita` — AM admin gali pridėti naujų be deploy
- Unique constraint per tenant_id + kodas + metai (leidžia tą patį kodą per kelis metus)

#### Biudžeto paskirstymas (Iter 9, F02)

- `/biudzetas` perdarytas į 2-lygio modelį (funding_source → budget_allocation)
- Lentelė: `budget_allocations` su kategorija (klasifikatorius), planuota_suma, spec_prog_tipas (atskiras / biudzeto_dalis)
- Kategorijos klasifikatoriaus default items: `du`, `spec_programa`, `prekes_paslaugos`, `investicijos`, `kita`
- Spec.programų subtipai conditional UI
- Data migration: senų `budgets` + `budget_allocations` pervarymas per heuristic mapper

#### Prašymo modelio integracija (Iter 10, P01-P06)

- `requests` papildoma 4 naujais nullable laukais: `budget_category_id`, `funding_source_type_id`, `spec_program_funding_type`, `fvm_project_id`
- Wizard 6 žingsniai (anksčiau 5) — pridėtas „Biudžetas" žingsnis tarp Finansavimas ir Ketvirčiai
- AM patvirtinimo ekrane — gali pakeisti budgetCategory / specProgramFundingType / fundingSourceType per decision dialog'ą
- Dashboard: `budgetCategoryStats` agregacija + `BudgetCategoryChart` StatistikaPage'e
- Backward compat: seni prašymai be naujų laukų toliau veikia

#### Projektai (3 lygis) (Iter 11, F03-F05)

- Naujasis puslapis `/projektai` + `/projektai/:id` — AM admin valdo projektus (3 lygis)
- Lentelė: `projects` su tipas (projektas / spec_programa / veikla), statusas (planuojama → vykdoma → baigta → uzdaryta), request_id, fvm_allocation_id, biudzetas, atsakingas
- Real `createFvmProject` action: AM patvirtinto spec.programa prašymo → vienu mygtuku sukuriamas projekto įrašas (allocation match per kategorija + metai)
- Lifecycle reverse'ai tik AM admin
- ProjectDialog, ProjectStatusBadge, ProjectTypeBadge, ProjectStatusChangeDialog

#### Išlaidos + likutis + warnings (Iter 12, F06-F08, F11)

- `ExpensesSection` projektų detalėse + `/biudzetas` puslapyje
- Lentelė: `expenses` su tipas, suma, data, projektas, allocation, **`saltinio_dalis` jsonb** (multi-source split)
- GIN index su `jsonb_path_ops` containment query'ams
- Multi-source SUM validation: 1 ct epsilon (frontend + backend dalinasi konstantą)
- Realus likutis per SUM(expenses) — Iter 9-11 grąžino '0.00' placeholder'į
- `WARNING_THRESHOLD_PERCENT` env var (default 80%) — `isWarning` ≥80%, `isOver` >100%
- BudgetWarningBanner (progress bar + flags), BudgetWarningsList (top N)
- Bulk summary endpoint `/expenses/budget-summary` — 1 query vietoj N+1

#### DU sluoksnis (payroll) (Iter 13, F09-F10, ADR-003, ADR-005)

- Naujasis puslapis `/du` — payroll profilių ir distribution'ų valdymas
- Lentelės: `payroll_profiles` (user, atlyginimas_bruto, priedai, tenant) + `payroll_distributions` (funding_source × procentas / fiksuota suma per laikotarpį)
- `payroll.service.ts:computeMonth` — idempotentiškas, sukuria DU expense'us per profile × distribution
- `is_du_system boolean` flag projects lentelei — stabilus identifikatorius
- **STRICT permissions (ADR-005)** — 4 sluoksniai defense:
  - DB flag: `projects.is_du_system`
  - `canViewPayroll(user)` helper'is (FE+BE): tik AM admin + org_admin
  - `requireDuAccess` + `requireAmDuAccess` BE gate'ai
  - SQL filter'iai per VISUS data endpoint'us (`expenses.list/get`, `projects.list/get/summary`, `budgetAllocations.list/summary`, `fundingSources.list`)
  - 404 NOT_FOUND ne 403 — DU expense/projekto ID egzistavimas neatskleidžiamas
  - Frontend defense-in-depth: Sidebar gating + Route guard + Dialog re-check + post-filter
- ADR-003 patvirtintas — tik bruto + priedai, be Sodra/GPM (HR sistema atskira)

#### Ataskaitos + Excel/PDF eksportas (Iter 14, F12-F14)

- Naujasis puslapis `/ataskaitos` — 3 sekcijos su Excel + PDF download buttons
- `reports.service.ts` su 3 endpoint'ais:
  - **`budgetExecution`** (F12): planuota / faktinė / likutis per šaltinį + kategoriją
  - **`specProgramExecution`** (F13): prašyta → patvirtinta → panaudota per spec.programa request'ą
  - **`payrollDistribution`** (F14): per profile × per source per laikotarpį (gated per `requireDuAccess`)
- Excel eksportas per **`exceljs`** (`apps/api/src/utils/reports/xlsx.ts`)
- PDF eksportas per **`pdfkit`** (`apps/api/src/utils/reports/pdf.ts`) — LT diakritiniai per DejaVu Sans unicode font (`apps/api/assets/fonts/DejaVuSans.ttf` + `DejaVuSans-Bold.ttf`)
- Failų pavadinimai: `biudzeto-vykdymas-{year}-{generatedAt}.xlsx`, etc.
- Binary response per Moleculer.web su Content-Disposition
- DU filter per ADR-005: budgetExecution exclude'ina DU jei !canViewPayroll
- `expenses.payroll_profile_id` FK pridėtas (backfill iš DU expense aprasymas parse)

#### FVM Dashboard + multi-year planning (Iter 15, F15, F16)

- HomePage perdarytas — FVM summary section su 4 metric cards (Planuota, Faktinė, Likutis, % panaudota) + top warnings + upcoming deadlines (next 30d)
- Year picker (default current year)
- `dashboard.fvmSummary` endpoint'as su pilna agregacija
- **F16: Biudžeto kopijavimas iš praėjusių metų**:
  - `fundingSources.copyFromYear` endpoint'as (AM admin only)
  - `CopyBudgetDialog` komponentas FinansavimoSaltiniaiPage'e
  - Validation: 409 Conflict jei target year jau turi šaltinius
  - Transakcijoje copy'inami funding_sources + budget_allocations

#### E2E testai (Iter 16)

- Playwright setup (`apps/e2e/`) — pirmasis spec startuotas: `01-funding-source-flow.spec.ts` (AM admin → funding_source → budget allocations → biudžetas matomas) + global-setup + helpers
- `@playwright/test ^1.60.0` pridėtas į root devDependencies
- `apps/e2e/package.json` scripts: `test`, `test:headed`, `test:ui`, `test:list`
- Likę 4 user journeys (spec.programos flow, expense tracking, payroll permission, annual report) — backlog'e (palikti po Giedrės UAT)

#### Dokumentacija

- `docs/fvm/` katalogas:
  - `README.md`, `00-master-plan.md` (8 iteracijos roadmap)
  - `01-architecture.md` (duomenų modelis)
  - `02-migration-strategy.md` (esamų duomenų migracija)
  - `03-decisions-log.md` (ADR-001..005)
  - `PROGRESS.md` (live eiga)
  - Per-iteracijos brief'ai: `iter-09-foundation.md` → `iter-16-deploy.md`
  - `spec/FVM-v0.1.md` (Giedrės docx pandoc-konvertuota markdown)
- 5 ADR (Architecture Decision Records):
  - ADR-001: klasifikatorius vs enum
  - ADR-002: jsonb (ne junction) multi-source distribution
  - ADR-003: tik bruto, ne Sodra/GPM
  - ADR-004: SERIAL integer (ne UUID)
  - ADR-005: DU duomenų izoliacija per `is_du_system` + `canViewPayroll`
- Demo data refresh: `apps/api/src/database/seeds/04_fvm.ts` su realistic FVM datą
- Migration verification script: `apps/api/scripts/verify-fvm.ts`

### Pakeista

- `requests` lentelė papildyta 4 FVM laukais (visi nullable, backward compat seniems prašymams)
- Wizard 5 → 6 žingsniai
- Dashboard.service.ts grąžina `budgetCategoryStats` + `fvmSummary` agregacijas
- `budgetAllocations.summary` + `projects.summary` perdaryti su realiu `faktine` per SUM(expenses) + `percentUsed` + `isWarning` + `isOver` flags
- `budgetAllocations.list/summary` + `fundingSources.list` — pridėtas tenant scope (ADR-005)

### Saugumas

- ADR-005: DU duomenų izoliacija per 4 sluoksnis defense (žr. Pridėta sekcija)
- 2 security fix'ai per Iter 13:
  - **Iter 13D** — row-level leak fix per `expenses.list/get` + `projects.list/get/summary` (Security Reviewer pass #1 buvo VULNERABLE)
  - **Iter 13E** — aggregate-level leak fix per `budgetSummary` + `budgetAllocations.summary` + tenant scope `budgetAllocations` + `fundingSources` (Security Reviewer pass #2 buvo PARTIAL)
  - Security Reviewer pass #3: SECURE — 49 DU-specific testai per 6 service'us, specialistas negali sužinoti DU duomenų per JOKIUS endpoint'us

### Performance

- `budgetSummary` endpoint'as su realistic data: < 200ms (target: 500ms — ADR-002 revisit trigger'is)
- `fvmSummary` agregatinis endpoint'as: < 300ms
- xlsx eksportas (~100 eilučių): < 500ms
- pdf eksportas (~100 eilučių): < 1s (LT unicode font load'inimas — pirmą kartą)

### Naujieji dependencies

**Backend (`apps/api/`)**:
- `exceljs ^4.4.0` — Excel (.xlsx) eksportas
- `pdfkit ^0.18.0` + `@types/pdfkit ^0.17.6` — PDF eksportas

**Root devDependencies**:
- `@playwright/test ^1.60.0` — E2E testai

### Naujos migracijos

| Migracija | Aprašymas |
|---|---|
| `20260522100000_create_fvm_foundation.ts` | `funding_sources` + `budget_allocations` + classifier seedų + data migration |
| `20260523100000_add_fvm_fields_to_requests.ts` | 4 nauji FVM laukai į `requests` |
| `20260524100000_create_projects.ts` | `projects` lentelė + `requests.fvm_project_id` FK |
| `20260525100000_create_expenses.ts` | `expenses` + GIN index `saltinio_dalis` |
| `20260526100000_create_payroll.ts` | `payroll_profiles` + `payroll_distributions` |
| `20260526200000_add_is_du_system_to_projects.ts` | ADR-005 `is_du_system` flag + backfill |
| `20260527100000_add_payroll_profile_to_expenses.ts` | `expenses.payroll_profile_id` FK + backfill |

### Naujos UI puslapiai

- `/finansavimo-saltiniai` (Iter 9)
- `/biudzetas` refactor (Iter 9, 12)
- `/projektai` + `/projektai/:id` (Iter 11)
- `/du` (Iter 13, STRICT permissions)
- `/ataskaitos` (Iter 14)
- HomePage FVM section (Iter 15)

### Test count atnaujinimas

- Backend: 76 (baseline po Iter 0-8) → ~278+ (po visų FVM iteracijų: 256 po Iter 13 + reports/dashboard/copy testai per Iter 14/15)
- Frontend: 32 (baseline) → ~88+ (66 po Iter 12 → 79 po Iter 13 → +reports/HomePage-fvm/CopyBudgetDialog testai per Iter 14/15)
- Playwright E2E: 1 spec'as įdiegtas + 4 backlog'e

---

## [0.2.0] — 2026-05-15 — MVP (Finansavimo prašymai)

MVP — pradinė finansavimo prašymų sistema. 5 iteracijos + bootstrap + post-MVP enhancement'ai (Iter 0-8).

### Pridėta

- **Iter 0** — Bootstrap: repo kopija iš `hr` template, deploy pipeline (3 aplinkos), blank shell, sesijos auth, demo accountas
- **Iter 1** — Auth, tenants, vartotojai: `tenants` lentelė (AM + AAD + VSTT + LGT), 10 demo accounts, scope rules per role
- **Iter 2** — Prašymo schema + API: `requests` (5 logikos grupės pagal Excel), `request_comments`, status'ai (DRAFT/SUBMITTED/RETURNED/APPROVED/REJECTED), CRUD su scope
- **Iter 3** — Prašymo teikimo wizard'as: 5 žingsnių multi-step forma su auto-save (kaip GPAIS)
- **Iter 4** — Tvirtinimo flow + ping-pong: AM patvirtina / atmeta / grąžina pataisymui, komentarų gija, decision metadata
- **Iter 5** — Docsai, testai, polish: VitePress dokumentacija, CLAUDE.md, README, demo accounts visose 3 aplinkose
- **Iter 6** — Rolių modelio supaprastinimas: `am_admin/am_user/org_admin/org_user` → `admin/user` + `tenant.is_approver`. AM admin gali sukurti prašymą „on behalf" of kitos organizacijos. UI polish (shadcn primitives: Checkbox, MultiSelect)
- **Iter 7** — Organizacijų valdymas: `/organizacijos` puslapis, TenantDialog, pilnas CRUD su sauga
- **Iter 8** — Statistika su grafikais: recharts, MonthlyTrendChart, StatusPieChart, PerTenantBarChart, `/statistika` puslapis, HomePage mini-chart

### Tech stack

Backend: Moleculer.js + TypeScript + Knex + Objection + PostgreSQL + Redis
Frontend: React 18 + Vite + Tailwind + shadcn/ui + React Query + recharts
Docs: VitePress
Tests: Jest (backend), Vitest + RTL (frontend)

### Deploy

3 aplinkos:
- Development: `dev-finansai.biip.lt` (push `dev`)
- Staging: `staging-finansai.biip.lt` (push `main`)
- Production: `finansai.biip.lt` (tag `X.Y.Z`, kol kas redirect → staging)

---

## [0.1.0] — Bootstrap iš `hr` template

Pradinis projekto bootstrap kopijuojant iš `biip-hr` repo template:
- `biip-hr` → `biip-finansai` visuose package'uose
- `ghcr.io/aplinkosministerija/hr*` → `.../finansai*` image tag'uose
- Domain'ai: `dev-finansai.biip.lt`, `staging-finansai.biip.lt`, `finansai.biip.lt`
- Cookie `hr_session` → `finansai_session`
- Color palette: deep teal (HSL 184 60% 22%) vietoj hr žalio
