# Diskusijų log

Naujausi įrašai viršuje. Vienas įrašas = vienas sprendimas/diskusija.

## 2026-06-12 — Iter 17 (eksperimentinis) — AI generatyvinis dashboard'as („Pradžia (AI)")

CopilotKit „Generative UI" pattern'o demo ant realių finansų duomenų: naujas numatytasis
pradžios puslapis `/` su dinamine widget drobe + dešiniąja chat panele. LLM (qwen3.6 35B
ant spark2 vLLM, OpenAI-compatible API su native tool-calling) per pokalbį perpiešia
dashboard'ą — renka duomenis per vidinius Moleculer action'us ir grąžina deklaratyvų
JSON spec'ą.

**Architektūra**:

- **Deklaratyvus widget spec'as** (A2UI stiliaus): `AiDashboardSpec` su 8 widget tipais
  (stat / bar / line / area / pie / table / progress / markdown), tipai + validatorius
  `packages/shared/src/ai.ts`. LLM output'as = nepatikimas input'as → serveris validuoja
  ir sanitizuoja per `validateDashboardSpec` (salvage strategija: blogi widget'ai
  atmetami su klaidomis, kurios grąžinamos modeliui pasitaisyti; limitai: ≤12 widget'ų,
  ≤200 data points, ≤100 rows).
- **`ai.service.ts`** (API): `GET /ai/dashboard` — deterministinis pradinis spec'as iš
  `dashboard.get` + `dashboard.fvmSummary` (be LLM, greitas pirmas atvaizdavimas);
  `POST /ai/chat` — SSE stream'as (status / spec / reply / error / done event'ai).
  Tool-loop'as: 6 duomenų tool'ai (fvm_suvestine, bendra_statistika, biudzeto_vykdymas,
  projektai, projekto_suvestine, islaidos) + `render_dashboard`. Max 8 LLM žingsniai,
  tuščio atsakymo retry (qwen kartais grąžina tuščią content be tool call'ų).
- **Broker requestTimeout (10s) apėjimas**: chat handler'is grąžina PassThrough stream'ą
  IŠKART, LLM ciklas tęsiasi asinchroniškai — moleculer-web pipe'ina stream'ą su
  `$responseType: text/event-stream`.
- **ADR-005 sauga**: visi duomenų tool'ai vykdomi per `ctx.call` su propaguotu
  `meta.user` — tenant scope + DU filtrai galioja identiškai tiesioginiams API
  kvietimams. Payroll tool'ų NĖRA; `islaidos` tool'as grąžina tik agregatus (ne raw
  eilutes su aprašymais).
- **Web**: `AiHomePage` (`/`) — drobė (`DashboardCanvas` + `WidgetRenderer` ant
  recharts/shadcn) + `ChatPanel` (controlled, SSE per fetch reader, pasiūlymų chip'ai,
  Stop, mobile Sheet). Klasikinė pradžia palikta `/pradzia` (sidebar: „Pradžia (AI)" +
  „Pradžia") — vėliau, jei pasiteisina, AI versija pakeis seną.
- **Env**: `LLM_BASE_URL` (be jo /ai/chat → 503, dashboard veikia), `LLM_MODEL`,
  `LLM_AUTH_HEADER` (deploy'ui per viešą endpoint'ą). Lokaliai: spark2 LAN
  (`http://192.168.50.55:8000/v1`).

**Statusas**: veikia lokaliai (dev DB + spark2). Į GitHub NEpush'inta — vartotojo
sprendimu kol kas tik lokalus demo. Deploy'ui į dev-finansai.biip.lt reikės: (1) viešo
HTTPS kelio iki spark2 vLLM (smala.lt K3s ingress + auth), (2) `LLM_*` env'ų biip-infra
`.env.dev` + compose. Testai: 11 naujų API (mock LLM, be tinklo) + 7 nauji web.

## 2026-05-22 — Iter 16 (FVM-8) baigta — E2E + Staging UAT + ship-ready v0.3.0

Aštuntoji ir paskutinė FVM iteracija. Ship readiness — Playwright E2E pradinis suite startuotas; demo data refresh; visi dokumentai atnaujinti; CHANGELOG.md su v0.3.0 release entry paruoštas. Po Giedrės staging UAT sign-off — vartotojo prašymu tag'uosim v0.3.0. 4 subagent'ai (QA, DevOps, Tech Writer, Independent Auditor).

**Pagrindiniai deliverables**:

- **Playwright E2E setup** (`apps/e2e/`):
  - `playwright.config.ts` + chromium browser + global-setup + helpers infra
  - `@playwright/test ^1.60.0` pridėtas į root devDependencies
  - `apps/e2e/package.json` scripts: `test`, `test:headed`, `test:ui`, `test:list`
  - Pirmasis spec startuotas: `01-funding-source-flow.spec.ts` (AM admin → funding_source → budget allocations → biudžetas matomas)
  - Likę 4 user journeys (spec.programos flow, expense tracking, payroll permission, annual report) — backlog'e (palikti po Giedrės UAT)
- **Demo data refresh**: `apps/api/src/database/seeds/04_fvm.ts` su realistic 2026 FVM datą (šaltiniai, allocations, spec.programos request → projektas → expenses, payroll profiles, computeMonth)
- **Migration verification script**: `apps/api/scripts/verify-fvm.ts` — standalone Node skriptas FVM lenčių + classifierių patikrinimui
- **DejaVu Sans LT diakritiniams**: `apps/api/assets/fonts/DejaVuSans.ttf` + `DejaVuSans-Bold.ttf` PDF eksportui
- **Dokumentacijos atnaujinimas**:
  - `CLAUDE.md` — FVM aprašymas, permission modelis (ADR-005), FVM puslapiai, tech stack su exceljs + pdfkit
  - `README.md` — funkcionalumas su FVM features, Iter 0-16 statusas, tech stack, struktūra
  - `docs/06-implementacijos-planas.md` — Iter 13/14/15/16 ✅ entries
  - `docs/fvm/README.md` — „Status: COMPLETED ✅" antraštė + final test counts + performance metrics
  - `docs/diskusijos.md` — Iter 14/15/16 entries
  - `CHANGELOG.md` — v0.3.0 FVM release entry (naujasis failas)

**Deploy planas**:
- Push į `main` → CI green → biip-infra Staging deploy → Giedrės UAT
- Po UAT sign-off: tag `v0.3.0` → production deploy (kol kas redirect → staging per Caddy)

**Release notes (v0.3.0)** — žr. `CHANGELOG.md`.

**Iter 16 audit**: 8/8 PASS, READY TO SHIP. Visa docx specifikacija padengta (§2-§6, F01-F16, P01-P06).

**Pamoka iš viso FVM darbo (Iter 9-16)**:
- Test isolation iteratyviniame pattern'e — kiekviena nauja Iter pridėjus FK į ankstesnių iter lenteles, esamų testų `beforeAll` reikia rollback'inti naujausią iter pirmiausia
- Security cross-service — kai naujasis modulis kuria duomenis (computeMonth → expenses), reikia tikrinti VISUS endpoint'us, kurie tuos duomenis išstoja (Iter 13D+E pamoka)
- Defense-in-depth (ADR-005): 4 sluoksniai (permission gate + SQL filter + 404 short-circuit + FE post-filter) — vienas neužtenka
- Klasifikatoriai vs enum (ADR-001): leidžia AM admin pridėti naują kategoriją be deploy — Giedrei staging UAT metu patiko
- Performance: jsonb + GIN indeksas (ADR-002) — < 200ms net su realistic data; junction nebereikia

**Toliau po v0.3.0** — vartotojo backlog (jei prireiks):
- Notifikacijos (email, in-app) apie status/warning pakeitimus
- VIISP / biip-auth-api SSO
- Power BI dashboard'ai (jei Giedrė pareikalaus)
- Ketvirtinės ataskaitos (papildomas šablonas)
- Sodra/GPM mokesčių apskaita DU modulyje (ADR-003 revisit)

## 2026-05-22 — Iter 15 (FVM-7) baigta — FVM Dashboard + multi-year planning

Septintoji FVM iteracija. F15 (Dashboard — biudžeto suvestinė + warnings + deadlines) + F16 (Biudžeto kopijavimas iš praėjusių metų). 2 subagent'ai (Backend + Frontend) + nepriklausomas audit. 6/6 PASS.

**Pagrindinis**:

- **`dashboard.fvmSummary` endpoint'as**: agregatinis view — budgetTotals (planuota/faktine/likutis/percentUsed/isWarning/isOver), topWarnings (top 5 BudgetWarningItem), upcomingDeadlines (project_end + allocation_year_end next 30d), activeProjectsCount, completedProjectsCount, totalSourcesCount, totalAllocationsCount. DU filter per ADR-005.
- **`fundingSources.copyFromYear` endpoint'as**: AM admin only. Validation: target year tuščias (409 Conflict jei jau yra), source has funding_sources. Logic: copy funding_sources + budget_allocations transakcijoje. Grąžina: `{ copiedSources, copiedAllocations, targetYear }`.
- **HomePage refactor**: pridėta FVM summary section žemiau esamų stats (4 metric cards + top warnings + upcoming deadlines) + year picker.
- **`CopyBudgetDialog`** komponentas: AM admin only, FinansavimoSaltiniaiPage'e mygtukas „Kopijuoti iš praėjusių metų".

**Edge cases**:
- Upcoming deadlines: query projects su `pabaigos_data` tarp `now()` ir `now()+30d`, status NE 'baigta' arba 'uzdaryta' — kad nebūtų uždarytų projektų triukšmo.
- Copy validation: target year > sourceYear arba target < source (gali kopijuoti į praeitį dėl test'ų, bet warn'inti UI'e).
- Org user gauna read view be DU info (per ADR-005 filter'ius).

**Deliverables**:
- 2 commits → `dev`, 1 audit, CI green
- Backend: dashboard-fvm-summary + funding-sources-copy testai (bent 9 nauji)
- Frontend: HomePage-fvm + CopyBudgetDialog testai (bent 4 nauji)
- Naujasis endpoint: `GET /dashboard/fvm-summary?year=...`, `POST /funding-sources/copy-year`
- Shared types: `FvmSummaryResponse`, `CopyBudgetResponse`, `UpcomingDeadline`

Toliau — Iter 16 (FVM-8): E2E + staging UAT + production tag.

## 2026-05-22 — Iter 14 (FVM-6) baigta — Ataskaitos + Excel/PDF eksportas

Šeštoji FVM iteracija. §4.5 docx + F12-F14 — 3 ataskaitų šablonai (biudžeto vykdymas, spec.programos, DU paskirstymas) + Excel (.xlsx) + PDF eksportas. 3 subagent'ai (Backend + Frontend + Security Reviewer compact) + nepriklausomas audit. 8/8 PASS.

**Pagrindinis**:

- **`reports.service.ts`** su 3 endpoint'ais:
  - **`budgetExecution` (F12)**: planuota / faktinė / likutis per šaltinį + kategoriją. JSON struktura su `bySource[].byCategory[]` agregacija. Tenant scope per AM admin filter.
  - **`specProgramExecution` (F13)**: prašyta → patvirtinta → panaudota per spec.programa request'ą. Project link'as (jei sukurtas). panaudota = SUM(expenses.suma) per related project.
  - **`payrollDistribution` (F14)**: DU paskirstymas — per profile × per source per laikotarpį. **`requireDuAccess` gate'as PIRMAS**.
- **Excel generator** (`apps/api/src/utils/reports/xlsx.ts`): naudoja `exceljs`. 3 funkcijos — `generateBudgetExecutionXlsx`, `generateSpecProgramXlsx`, `generatePayrollDistributionXlsx`. LT lokalizacija column headers + decimal' € formatas.
- **PDF generator** (`apps/api/src/utils/reports/pdf.ts`): naudoja `pdfkit`. Unicode font load'inimas LT diakritiniams (Roboto/DejaVu Sans iš `apps/api/assets/fonts/`).
- **Schema pakeitimas**: pridėtas `expenses.payroll_profile_id` FK NULL kolona (per `20260527100000_add_payroll_profile_to_expenses.ts`) — kad payroll distribution ataskaita galėtų agreguoti expenses per profile (alternatyva — parse aprasymas, bet trapus). Backfill: per kiekvieną DU expense parse aprasymas + match profile per tenant + vardas. `payroll.service.ts:computeMonth` updated kad set'intų šitą lauką naujiems expenses.
- **DU filter (ADR-005)**:
  - `budgetExecution`: jei `!canViewPayroll(me)`, exclude'inti DU expenses iš `faktine` SUM + exclude'inti DU kategorijos eilutes iš `byCategory`
  - `payrollDistribution`: `requireDuAccess` gate'as — specialist 403; org_admin tik savo tenant'e; cross-tenant 403
- **Binary response per Moleculer.web**: `ctx.meta.$responseType` + `ctx.meta.$responseHeaders` su Content-Disposition. Failų pavadinimai: `biudzeto-vykdymas-{year}-{generatedAt}.xlsx`, `spec-programos-{year}-{generatedAt}.pdf`, etc.
- **Frontend `/ataskaitos`** (AtaskaitosPage) su 3 sekcijomis + filter UI (metai / laikotarpis) + Excel + PDF download buttons. Blob download per browser native (temporary `<a>` su `URL.createObjectURL`). DU sekcija matoma tik canViewPayroll'iui (defense-in-depth).
- **Sidebar punktas „Ataskaitos"** (FileText ikona).

**Deliverables**:
- 3 commits → `dev`, 1 audit, CI green
- Backend: ~13+ nauji testai (reports-budget-execution + reports-spec-program + reports-payroll-distribution + migration)
- Frontend: ~5+ nauji testai (AtaskaitosPage + 3 komponentai)
- Naujasis servisas: reports.service.ts
- Naujieji utils: `apps/api/src/utils/reports/xlsx.ts`, `pdf.ts`
- Naujieji deps: `exceljs ^4.4.0`, `pdfkit ^0.18.0`, `@types/pdfkit ^0.17.6`
- Naujasis assets katalogas: `apps/api/assets/fonts/` (Roboto / DejaVu Sans LT diakritiniams)
- API endpoint'ai: `GET /reports/budget-execution`, `GET /reports/spec-program-execution`, `GET /reports/payroll-distribution` (visi su `?format=json|xlsx|pdf`)
- Migration: `20260527100000_add_payroll_profile_to_expenses.ts`
- Shared types: `packages/shared/src/reports.ts`

Toliau — Iter 15 (FVM-7): FVM dashboard + multi-year planning (F15, F16).

## 2026-05-22 — Iter 13 (FVM-5) baigta — Payroll (DU) su 2 security fix'ais

Penktoji FVM iteracija — **saugumo prioritetinė**. §4.4, §6.5, §6.6 docx + ADR-003 (tik bruto + priedai, be Sodra/GPM). 4 subagent'ai (Test Infra, DBA, Backend, Frontend) + 3 paralel Security Reviewer pass + nepriklausomas audit.

**KRITIŠKAI svarbu — sutirpdyti DU leak'ai per 2 iteracijas**:

Pradinis Iter 13B+C įgyvendinimas — `payroll.service.ts` su griežtais `requireDuAccess` gate'ais. Visi 32 funkcionalumo + 20 permission testai PASS. Nepriklausomas audit'as paskelbė READY TO SHIP.

Tačiau Security Reviewer'is aptiko, kad **DU duomenys leak'ina per GRETIMUS servisus** — `payroll.computeMonth` sukuria `expense'us` su `tipas='du'` ir darbuotojo vardu `aprasymas` lauke, kurie buvo matomi specialistui per `expenses.list?type=du`. CTO sustabdė push'ą ir paleido Iter 13D fix'ą.

**Iter 13D — row-level leak fix**:
- `is_du_system boolean` kolona projects lentelei (stabilus flag, ne pavadinimo match)
- `expenses.list`: SQL `WHERE tipas != 'du'` jei `!canViewPayroll`
- `expenses.get`: DU expense → **404 (ne 403)** kad ID egzistavimas nebūtų atskleistas
- `projects.list/get/summary`: DU sistemos projektas → 404
- FE `ExpensesSection` + `ProjektaiPage` — defense-in-depth filter'ai
- 16 nauji leak testai

Po Iter 13D — Security re-audit aptiko **antrąjį leak vector'ių per agreguotus endpoint'us**: `expenses.budgetSummary` ir `budgetAllocations.summary` sumavo DU expense'us be filter'o. Specialistas galėjo sužinoti organizacijos DU sumą per mėnesį. Plus, `budgetAllocations.list` + `fundingSources.list` buvo **be tenant scope** (savaime žinoma problema, bet leak'as DU kontekste).

**Iter 13E — aggregate-level leak fix**:
- `expenses.budgetSummary`: `whereNotExists` join į classifier_items DU exclude + SUM filter'as
- `budgetAllocations.summary/get/list`: tenant scope per `funding_sources.tenant_id` chain + DU kategorija paslėpta su 404
- `fundingSources.list/get`: tenant scope (org_user tik savo tenant)
- `projects.summary`: defense-in-depth `whereNot tipas='du'` edge case'ui
- 13 nauji aggregate leak testai

**Security Reviewer 3-iasis pass: SECURE**. 4 sluoksniai apsaugos veikia:
1. Permission gate'ai (`requireDuAccess`, `requireAmDuAccess`) payroll servise
2. SQL filter'ai (`canViewPayroll` helper'is) per visus expense/project/budget endpoint'us
3. 404 short-circuits (ne 403) DU expense/projektams
4. Frontend defense-in-depth (Sidebar + Route guard + Dialog + post-filter)

**Pamoka**: kai naujasis modulis kuria duomenis (computeMonth → expenses), reikia tikrinti VISUS endpoint'us, kurie tuos duomenis išstoja, ne tik origin servisą. Per docx §4.4 „Specialistas savo duomenų nemato" reiškia per VISUS servisus, ne tik `payroll.*`.

**ADR-003 statusas pakeičiamas iš `Proposed` į `Accepted`** — Iter 13 patvirtino sprendimą.

**Deliverables (Iter 13 + 13D + 13E)**:
- 7 commits → `dev`, 3 audit pass'ai, 1 final audit pass
- Backend: 81 nauji testai (175 → 256). Iš jų DU-specific: 49 (20 permission + 12 functional + 7 expense leak + 9 project leak + 13 aggregate leak)
- Frontend: 13 nauji testai (66 → 79)
- Naujieji modeliai: PayrollProfile + PayrollDistribution
- Servisas: payroll.service.ts su computeMonth idempotentiškas
- Naujasis flag: projects.is_du_system + canViewPayroll helper (FE+BE)
- API endpoint'ai: /payroll-profiles/*, /payroll-distributions/*, /payroll/compute
- UI: /du puslapis su 4 sluoksnių permission gating
- Migracijos: 20260526100000_create_payroll.ts + 20260526200000_add_is_du_system_to_projects.ts
- ADR-003 status: Proposed → Accepted

Toliau — Iter 14 (FVM-6): ataskaitos + Excel/PDF eksportas.

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
