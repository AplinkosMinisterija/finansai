# 06 — Implementacijos planas

5 iteracijos + bootstrap. Po kiekvienos — nepriklausomas review subagent'as patikrina, ar viskas atitinka acceptance kriterijus, prieš einant prie sekančios.

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

**Polish užduotys vėliau (po MVP):**
- Backend integration tests (Jest) — bent vienas per scope rules / state machine
- Daugiau frontend testų (Vitest + RTL) wizard + decision flow'ams
- E2E (Playwright) happy path
- Ketvirtinės ataskaitos + metinė ataskaita (Iter 6+)
- VIISP / biip-auth-api integracija (vėliau)
- Power BI dashboard'ai (vėliau)
