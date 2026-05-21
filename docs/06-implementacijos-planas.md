# 06 — Implementacijos planas

8 iteracijos + bootstrap (Iter 0). Pradžioje planavome 5 iteracijas iki MVP — vėlesnės (6-8) gimė iš realių poreikių po pirmojo paleisto. Po kiekvienos iteracijos — nepriklausomas review subagent'as patikrina acceptance kriterijus prieš einant prie sekančios.

## Iter 0 — Bootstrap + Infra ✅

**Tikslas:** dev/staging deploy pipeline + blank shell veikia.

- [x] Repo `AplinkosMinisterija/finansai` (kopija iš `hr` template)
- [x] Yarn workspaces struktūra (apps/api, apps/web, docs, packages/shared)
- [x] Dockerfiles + Caddyfile + GitHub Actions (3 workflows)
- [x] biip-infra docker-compose pridėjimas (finansai + finansai-api)
- [x] biip-infra Caddyfiles (3 aplinkos)
- [x] PostgreSQL DB sukurta per `postgres-createdb.yml`
- [x] Color palette: deep teal (skiriasi nuo hr žalio)
- [x] Sesijos auth + vienas demo accountas (`demo`/`demo`)
- [x] Blank HomePage placeholder
- [x] Production redirect į staging

**Verifikuota:** dev, staging, prod (redirect) — visi 200/302.

## Iter 1 — Auth, tenants, vartotojai ✅

**Tikslas:** pilnas vartotojų valdymas pagal scope.

- [x] Migracija: `tenants` lentelė + `users.tenant_id` + `users.am_scope_org_ids[]`
- [x] Seed: AM + AAD + VSTT + LGT, 10 demo accounts (visi pwd=`demo`)
- [x] Modeliai: Tenant + User update (su tenant relation)
- [x] Auth servisas: load tenant info, AuthUser su tenant + scope
- [x] tenants.service.ts (list, read-only)
- [x] users.service.ts (list/get/create/update/delete su scope rules):
  - am_admin: visi vartotojai, gali valdyti
  - am_user: AM + scope orgs (read-only)
  - org_admin: savo tenant vartotojai (CRUD)
  - org_user: tik save (read-only)
- [x] API gateway routes: /tenants, /users CRUD
- [x] UI: `/vartotojai` puslapis su sąrašu, paieška, tenant filtru
- [x] UI: UserDialog (create + edit)

**Verifikuota:** scope filtrai veikia per visus 4 role tipus dev+staging.

## Iter 2 — Prašymo schema + API ✅

**Tikslas:** DB schema ir CRUD API parengtas wizard'ui.

- [x] Migracija: `requests` (5 logikos grupės pagal Excel) + `request_comments`
- [x] Statusai: DRAFT/SUBMITTED/RETURNED/APPROVED/REJECTED
- [x] Modeliai: Request, RequestComment (Objection.js su relations)
- [x] requests.service.ts:
  - list (su scope filtru pagal role)
  - get (su scope check)
  - create draft (tik org rolės)
  - update (tik DRAFT/RETURNED, tik owner/org_admin)
  - submit (DRAFT/RETURNED → SUBMITTED)
  - delete (tik DRAFT)
  - decision: approve / reject / return (tik AM rolės, SUBMITTED status)
  - addComment (visi, kurie mato)
- [x] Seed: 7 pavyzdiniai prašymai įvairiuose statusuose (ping-pong istorija įtraukta)

**Verifikuota:** seed'inami prašymai matomi per visus filtrus.

## Iter 3 — Prašymo teikimo wizard (UI) ✅

**Tikslas:** multi-step forma kaip GPAIS screenshot'e.

- [x] PrasymaiPage: sąrašas su status pills, paieška, tenant filtru
- [x] RequestWizard komponentas: 5 žingsnių wizard'as
  - Sidebar nav su „X iš 5" indikatoriumi
  - Auto-save po kiekvieno žingsnio (saveMutation)
  - Žingsnis 1: pagrindinė info
  - Žingsnis 2: finansavimas (auto-total)
  - Žingsnis 3: ketvirčiai (validacija: suma = viso prašoma)
  - Žingsnis 4: atsakingi asmenys (email validacija)
  - Žingsnis 5: peržiūra + „Pateikti AM"
- [x] PrasymoEditPage: load + permission + wizard

**Verifikuota:** wizard navigacija, draft auto-save, submit transitions į SUBMITTED.

## Iter 4 — Tvirtinimo flow + ping-pong ✅

**Tikslas:** AM gali pilnai valdyti paraiškas.

- [x] PrasymoDetailPage: pilna detalė su visomis 5 sekcijomis
- [x] AM veiksmai (SUBMITTED status):
  - Patvirtinti (+ skirta suma, šaltinis, protokolas, įsakymas)
  - Grąžinti pataisymui (+ privalomas komentaras)
  - Atmesti (+ privalomas komentaras)
- [x] Submitter pusėje:
  - RETURNED → „Redaguoti" + „Pateikti pakartotinai"
  - DRAFT → „Redaguoti" + „Ištrinti"
- [x] Komentarų gija su kind badge'ais
- [x] Decision metadata rodymas APPROVED/REJECTED sekcijoje
- [x] Pridėti komentarą (visi, kurie mato prašymą)

**Verifikuota:** ping-pong cikls (submit → return → fix → submit → approve) galimas.

## Iter 5 — Docsai, testai, polish ✅

**Tikslas:** prod-ready vartotojo akimis.

- [x] VitePress dokumentacija atnaujinta (visi 6 puslapiai)
- [x] CLAUDE.md atspindi dabartinę state'ą
- [x] README.md aiškus quickstart
- [x] Production redirect veikia (302 → staging)
- [x] /docs/ visose 3 aplinkose
- [x] Demo accounts veikia visose 3 aplinkose

## Iter 6 — Rolių modelio supaprastinimas + UI polish ✅

**Tikslas:** atsisakyti dubliuojančio 4-rolių modelio + pakelti UI kokybę.

- [x] Migracija + modelis: `tenant.description` laukas
- [x] Backend role refaktorinimas: `am_admin/am_user/org_admin/org_user` → `admin/user` + tenant.is_approver
- [x] Backend: `requests.create` palaiko AM admin „on behalf" — gali nurodyti `tenantId` kitos organizacijos
- [x] Backend: `tenants.service.ts` pilnas CRUD su sauga (negalima ištrinti su vartotojais/prašymais)
- [x] Backend: `dashboard.service.ts` papildytas `monthlyTrend` (12 mėn dinamika)
- [x] Frontend role refaktorinimas: `lib/roles.ts` + `lib/requests.ts` permission helper'iai
- [x] Shadcn primitives: Checkbox (@radix-ui/react-checkbox) + custom MultiSelect
- [x] UserDialog: native HTML pakeisti į shadcn Select + Checkbox + MultiSelect (AM scope)
- [x] PrasymaiPage: tenant picker dialog AM admin'ams
- [x] Sidebar: Dokumentacija nuoroda (/docs/) + Organizacijos meniu punktas
- [x] Testai: 27 permission testai, visi praeina

## Iter 7 — Organizacijų valdymas (UI) ✅

**Tikslas:** AM admin gali pilnai valdyti organizacijas.

- [x] OrganizacijosPage (/organizacijos) — sąrašas su grupavimu (Tvirtintojai vs Pavaldžios)
- [x] TenantDialog — CRUD su code/name/description/isApprover/active laukais
- [x] Vartotojų ir prašymų skaičiukai pagal organizaciją
- [x] Apsauga: ne-AM admin matytojas, kad puslapis prieinamas tik AM admin
- [x] Sidebar punktas filtruojamas pagal canManageTenants

## Iter 8 — Statistika su grafikais ✅

**Tikslas:** vizualizuoti dinamiką + įvedimas analytical dashboardui.

- [x] recharts priklausomybė
- [x] Trys reusable chart komponentai:
  - MonthlyTrendChart (bar pora pateikta vs patvirtinta)
  - StatusPieChart + StatusLegend (donut)
  - PerTenantBarChart (€ horizontaliai)
- [x] StatistikaPage (/statistika) — money summary + monthly + status pie + per-tenant
- [x] HomePage mini-chart su nuoroda į pilną statistiką
- [x] Sidebar punktas „Statistika" visiems vartotojams
- [x] CSS spalvų kintamieji grafikams (`--chart-success`, etc.)

## Polish užduotys vėliau (po MVP):

- Backend integration tests (Jest) — bent vienas per scope rules / state machine
- Daugiau frontend testų (Vitest + RTL) wizard + decision flow'ams
- E2E (Playwright) happy path
- Ketvirtinės ataskaitos + metinė ataskaita
- VIISP / biip-auth-api integracija
- Power BI dashboard'ai
- Notifikacijos (email, in-app) apie status pakeitimus

## Iter 9 — FVM-1: Finansavimo šaltiniai + biudžeto paskirstymas ✅

**Tikslas:** pirmas FVM duomenų sluoksnis pagal Giedrės techninį užsakymą (§2.1, §2.2, §6.1, §6.2). Žr. `docs/fvm/` katalogą su master planu, architektūra ir ADR'ais.

- [x] Backend test infra (apps/api/test/) — pamatas FVM testams (Iter 9A)
- [x] Migracija: `funding_sources` + `budget_allocations_v2` (laikinas pavadinimas) + verify helper
- [x] Klasifikatoriai seedinti: `funding_source_type` (3 items), `budget_category` (5 items)
- [x] Data migration: senų `budgets` + `budget_allocations` pervarymas (heuristic mapper)
- [x] Backend: `fundingSources.service.ts`, `budgetAllocations.service.ts`, modeliai, DTO
- [x] Frontend: `/finansavimo-saltiniai` puslapis + dialog'ai + Sidebar item
- [x] Frontend: `/biudzetas` refactor į naują 2-lygio modelį (su spec_prog_tipas conditional UI)
- [x] Testai: 54 backend + 10 nauji frontend (visi PASS)
- [x] ADR-001 (klasifikatorius vs enum), ADR-004 (SERIAL ID vs UUID) priimti
- [x] Nepriklausomas auditas: 8/8 PASS

FVM Iter 9-16 detalus planas — `docs/fvm/00-master-plan.md`. Iter 10 (FVM-2) — prašymo modelio papildymai (Stream 1 §3 docx).
