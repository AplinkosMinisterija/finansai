# Iter 13 (FVM-5) — Payroll (DU) + monthly compute

> **CTO brief**. Įgyvendina docx §4.4, §6.5, §6.6, F09, F10. **SAUGUMO PRIORITETINĖ ITER** — DU duomenys griežtai apsaugoti.

## Tikslas

Darbuotojo finansinis profilis + DU paskirstymas tarp finansavimo šaltinių. Automatinis mėnesio DU kaštų skaičiavimas su rezultatu integruotu į `expense.service` (DU type expenses). Strict permission gates per `payroll_profiles.tenant_id` — specialistas savo duomenų NEMATO (per docx §4.4 explicit reikalavimas).

ADR-003: bruto + priedai, BE Sodra/GPM apskaitos.

## Apima iš docx

- §4.4 payroll.service.ts (Supaprastintas DU valdymas finansinio planavimo tikslams)
- §6.5 payroll_profiles schema
- §6.6 payroll_distributions schema (% arba fiksuota per laikotarpį)
- F09: Darbuotojo finansinio profilio ir DU paskirstymo valdymas
- F10: Automatinis mėnesio DU kaštų paskaičiavimas pagal šaltinį

## NEAPIMA

- §4.5 ataskaitos (Iter 14)
- Sodra/GPM apskaitos (ADR-003 — atskira fazė po Iter 16 jei Giedrė pareikalaus)
- HR sistemos integracija (docx §4.4: „Nesikerta su HR sistema")

## Saugumo reikalavimai (KRITIŠKI)

Per docx §4.4 + CLAUDE.md privacy:
- **AM admin** mato visus DU duomenis (visi tenant'ai)
- **Institucijos vadovas (org_admin)** mato savo komandos DU (savo tenant)
- **Specialistas (org_user)** NEGALI matyti DU duomenų — net savo
- Tas pats permission'ai backend + frontend (2 sluoksniai)
- Penetration-style testai per security reviewer subagent

## Komandos sudėtis

| Rolė | Subagentas | Atsakomybė |
|---|---|---|
| DBA | general-purpose | payroll_profiles + payroll_distributions migracija + tests |
| Backend Engineer | general-purpose | Models + payroll.service.ts + monthly compute + integration su expense.service |
| Frontend Engineer | general-purpose | /du puslapis su strict access gates + dialog'ai |
| Security Reviewer | general-purpose | Penetration-style tests + audit |
| Independent Auditor | general-purpose | 8 audit kriterijai + saugumas |

## Subagentų briefingai

### A. DBA brief

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas skaitymas**:
1. `docs/fvm/iter-13-payroll.md` — sekcija „A. DBA brief"
2. `docs/fvm/01-architecture.md` — payroll_profiles + payroll_distributions sekcijos
3. `docs/fvm/spec/FVM-v0.1.md` — §4.4, §6.5, §6.6
4. `docs/fvm/03-decisions-log.md` — ADR-003

**Deliverables**:

1. **Migracija**: `apps/api/src/database/migrations/20260526100000_create_payroll.ts`
   - `payroll_profiles`:
     - id SERIAL PK
     - tenant_id integer NOT NULL FK → tenants(id) ON DELETE RESTRICT
     - user_id integer NULL FK → users(id) ON DELETE SET NULL
     - vardas_pavarde varchar(200) NOT NULL (redundant copy jei user_id NULL, arba sync su user)
     - pareigos varchar(200) NOT NULL
     - sutarties_tipas varchar(20) NOT NULL CHECK (sutarties_tipas IN ('darbo', 'paslaugu', 'autorine'))
     - atlyginimas_bruto decimal(10, 2) NOT NULL
     - priedai decimal(10, 2) NOT NULL DEFAULT 0
     - galioja_nuo date NOT NULL
     - galioja_iki date NULL
     - created_at, updated_at timestamptz
   - Indexai: idx_payroll_profiles_tenant, idx_payroll_profiles_user
   - `payroll_distributions`:
     - id SERIAL PK
     - payroll_profile_id integer NOT NULL FK → payroll_profiles(id) ON DELETE CASCADE
     - funding_source_id integer NOT NULL FK → funding_sources(id) ON DELETE RESTRICT
     - paskirstymo_tipas varchar(20) NOT NULL CHECK (IN ('procentais', 'fiksuota'))
     - reiksme decimal(10, 4) NOT NULL — % (0-100) arba € suma
     - galioja_nuo date NOT NULL
     - galioja_iki date NULL
     - created_at, updated_at
   - Indexai: idx_payroll_distributions_profile, idx_payroll_distributions_source
   - VIENAS transaction
   - LT komentaras
   - `down`: drop'ina abi lenteles (distributions pirma per CASCADE)

2. **Integration testas**: `apps/api/test/database/payroll-foundation.spec.ts` (bent 6):
   1. Abi lentelės su visomis kolonomis
   2. CHECK constraints sutarties_tipas + paskirstymo_tipas
   3. CASCADE delete profile → distributions ištrinamos
   4. RESTRICT funding_source: jei distribution rodo į source, source delete blokuojamas
   5. SET NULL user_id: ištrinant user, profile išlieka su user_id NULL
   6. Insert su valid duomenimis abu lygiai sėkmingai
   7. Rollback `down` veikia
   8. Test isolation (pridėti Iter 13 rollback į ankstesnius spec'us)

**Constraints**:
- TS strict, LT komentarai, knex.transaction
- **NEKOMITUOTI**

**Done criterion**:
- `yarn db:migrate` paleidžia
- `yarn test payroll-foundation` PASS
- `yarn test` PASS regression (175 esami + nauji)

### B. Backend brief

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas skaitymas**:
1. `docs/fvm/iter-13-payroll.md` — sekcija „B. Backend brief" + saugumo reikalavimai
2. `docs/fvm/01-architecture.md` — payroll sekcijos + permission modelis
3. `docs/fvm/spec/FVM-v0.1.md` — §4.4
4. `docs/fvm/03-decisions-log.md` — ADR-003
5. `apps/api/src/services/expenses.service.ts` — referencija (tenant scoping)
6. `apps/api/src/services/projects.service.ts` — referencija
7. `apps/api/src/utils/permissions.ts` ar `lib/roles.ts` (frontend) — esami helper'iai

**SAUGUMO INSTRUKTAS** (KRITIŠKAS):
- Visi payroll endpoint'ai turi `requireDuAccess(meta)` helper'į:
  - AM admin (role='admin' && tenantIsApprover) → AKCEPT
  - Org admin (role='admin' && !tenantIsApprover) + tenant match → AKCEPT
  - **Visi kiti → 403 FORBIDDEN** (net savo duomenims)
- Specialistas (org_user role='user') negali pasiekti net `GET /payroll-profiles?user_id=mine` — visada 403
- Tenant scope strict: org_admin negali matyti kitos tenant'o DU (per `me.tenantId === profile.tenantId`)

**Deliverables**:

1. **Modeliai**:
   - `apps/api/src/models/PayrollProfile.ts`
   - `apps/api/src/models/PayrollDistribution.ts`
   - Relations: tenant, user, distributions; profile, fundingSource

2. **Naujas servisas**: `apps/api/src/services/payroll.service.ts`
   - Endpoint'ai:
     - `listProfiles` — tenant scope, AM admin/org_admin only; filter: tenantId (AM optional), userId, active (galioja_nuo ≤ today ≤ galioja_iki OR galioja_iki NULL)
     - `getProfile`
     - `createProfile` — AM admin/org_admin (savo tenant)
     - `updateProfile`
     - `deleteProfile` — AM admin only; RESTRICT jei active distributions
     - `listDistributions` — filter: profileId, sourceId
     - `createDistribution` — AM admin/org_admin
       - Validate: paskirstymo_tipas + reiksme (procentais 0-100, fiksuota > 0)
       - Constraint: same period (galioja_nuo overlap) per profile — SUM(procentais.reiksme) ≤ 100
     - `updateDistribution`
     - `deleteDistribution`
     - `computeMonth` — kviečiamas per `POST /payroll/compute?month=YYYY-MM`
       - Idempotentiškas: jei tas pats mėnuo jau apskaičiuotas — ištrinami senieji expense rows, sukuriama naujai
       - Logic:
         * Per kiekvieną profilį, kuris aktyvus tame mėnesyje (galioja_nuo ≤ mėnuo end AND (galioja_iki NULL OR galioja_iki ≥ mėnuo start))
         * monthly_total = atlyginimas_bruto + priedai
         * Per kiekvieną distribution aktyvią tame mėnesyje:
           - jei procentais: amount = monthly_total × reiksme/100
           - jei fiksuota: amount = reiksme (clamp'inant kad SUM nelaisytų monthly_total)
         * Sukuria expense'us su tipas='du' susiejant su atitinkamais project'ais
           - **Komplikacija**: kuris projektas? Iter 13 — kol kas nė vienas (DU expenses tiesiogiai į budget_allocation su default project'u)
           - Sprendimas: AM admin sukuria „DU expense projektą" per tenantą — placeholder. Arba: nesukuria expense — vietoj to update'ina allocation summary tiesiogiai per kompiuteryje saugomą agregaciją.
           - **Pragmatiškas sprendimas Iter 13**: sukuria expense per kiekvieną distribution; project_id = "system DU project" per tenant (auto-create jei nėra). Tipas='du'. SAUGOJIMAS: aprašymas formatu „DU YYYY-MM: <profile.vardas_pavarde>".
         * Visa transakcijoje

3. **Permission helper'is**: `apps/api/src/utils/permissions.ts` (papildyti) arba per service'o utility
   - `requireDuAccess(meta, tenantId)`:
     - AM admin → OK
     - Org admin su `me.tenantId === tenantId` → OK
     - Kiti → throw 403

4. **Integration su expenses**: kai computeMonth sukuria DU expense'us, jie atrodo regular expense (tipas='du') ir įskaitomi į allocation/project summary. Test'ai patvirtins.

5. **Shared types** (`packages/shared/src/fvm.ts`):
   - PayrollProfile, PayrollDistribution interfaces
   - DistributionType = 'procentais' | 'fiksuota'
   - ContractType = 'darbo' | 'paslaugu' | 'autorine'
   - DTOs (CreateProfile/Update; CreateDistribution/Update)
   - ComputeMonthResponse

6. **API routing**: `apps/api/src/services/api.service.ts`
   - Pridėti `payroll.*` whitelist
   - REST aliases:
     - GET/POST/PATCH/DELETE `/payroll-profiles[/:id]`
     - GET/POST/PATCH/DELETE `/payroll-distributions[/:id]`
     - POST `/payroll/compute?month=YYYY-MM`
   - `runner.ts` registruoti

7. **Integration testai** (bent 12 saugumo + 8 funkcionalumo):

   `apps/api/test/services/payroll-permissions.spec.ts` (bent 12 PERMISSION testų):
   1. AM admin gali list visus profiles → 200
   2. Org admin gali list savo tenant → 200
   3. Org admin negali list kitos tenant — 403
   4. Org user (specialist) bandant list — 403 (net jei užklausa su jo savo userId)
   5. Org user GET /payroll-profiles/:id (kito) — 403
   6. Org user GET /payroll-profiles/:mine — 403 (specialist savo nemato)
   7. Org user POST — 403
   8. Org user PATCH — 403
   9. Org user DELETE — 403
   10. Org user list distributions — 403
   11. Org user computeMonth — 403
   12. Cross-tenant: org admin tenant A bandant CRUD tenant B profile — 403
   13. AM admin gali compute month bet kuriame tenant'e
   14. JWT'as / session tampering test (jei reikalingas — gali likti saugumo reviewer'iui)

   `apps/api/test/services/payroll.service.spec.ts` (bent 8 funkcionalumo):
   1. AM admin create profile
   2. AM admin create distribution (procentais)
   3. AM admin create distribution (fiksuota)
   4. SUM(procentais.reiksme) > 100 per same period → 400 LT
   5. delete profile su aktyviomis distribuctions → 409 RESTRICT
   6. delete profile be distribuctions — sėkmingai
   7. computeMonth idempotent: 2x kvietimas su tuo pačiu mėnesiu — antras ištrina pirmojo expense'us ir sukuria naujus
   8. computeMonth sukuria expense'us su tipas='du' ir teisingomis sumomis
   9. computeMonth: profile galiojantis tik dalį mėnesio (galioja_iki vidury) — proportional skaičiavimas optional, arba full month — dokumentuoti pasirinkimą

**Constraints**:
- TS strict, LT errors
- Visi DB pakeitimai transakcijose
- Penetration-aware testai (bandyk reikšti scenarijus kur permission gali būti praleistas — multi-step queries, internal listings, etc.)
- **NEKOMITUOTI**

**Done criterion**:
- `yarn test` PASS (175 esami + ~20 nauji)
- `yarn typecheck` + `yarn build` pass

### C. Frontend brief

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas skaitymas**:
1. `docs/fvm/iter-13-payroll.md` — sekcija „C. Frontend brief" + saugumo reikalavimai
2. `docs/fvm/01-architecture.md` — Frontend struktūra
3. `docs/fvm/spec/FVM-v0.1.md` — §4.4
4. `packages/shared/src/fvm.ts` — PayrollProfile + PayrollDistribution
5. `apps/web/src/lib/roles.ts` ar `permissions.ts` — pridėti `canViewPayroll` helper

**SAUGUMO**:
- `canViewPayroll(user) = (user.role === 'admin' && (user.tenantIsApprover || hasOrgAdminRights))` — pridėti helper'į
- Nav punktas „DU" matomas tik kai `canViewPayroll`
- Page'as redirect'ina į HomePage jei `!canViewPayroll`
- 2 sluoksniai gating'o: route guard + page-level check + dialog access checks

**Deliverables**:

1. **API client'as**: `apps/web/src/lib/api/fvm.ts`
   - `payrollApi`: listProfiles, getProfile, createProfile, updateProfile, deleteProfile + same for distributions + computeMonth

2. **Komponentai**: `apps/web/src/components/payroll/`
   - `PayrollProfileDialog.tsx` — CRUD modal (vardas_pavarde / pareigos / sutarties_tipas / atlyginimas_bruto / priedai / galioja_nuo / galioja_iki / user link optional)
   - `PayrollDistributionDialog.tsx` — CRUD distribution (profile / funding_source / paskirstymo_tipas radio / reiksme / galioja periods)
   - `ComputeMonthDialog.tsx` — month picker + „Apskaičiuoti" mygtukas; rodo confirmation jei mėnuo jau apskaičiuotas
   - `PayrollList.tsx` — lentelė profile'ų

3. **Naujasis puslapis**: `apps/web/src/pages/DuPage.tsx`
   - Layout su:
     - Profile'ų sąrašas + Naujas profile mygtukas
     - Klikti profile → atveria detail dialog'ą su distributions
     - „Apskaičiuoti mėnesį" mygtukas (AM admin only)
   - Route guard: jei `!canViewPayroll(user)` → redirect /

4. **Routing + Sidebar**:
   - `/du` → DuPage
   - Sidebar punktas „DU" (icon: Wallet ar Banknote) — TIK matomas canViewPayroll

5. **Permission utility**: `apps/web/src/lib/roles.ts` papildyti `canViewPayroll(user): boolean`

6. **Frontend testai**:
   - `apps/web/src/pages/__tests__/DuPage.test.tsx` (4+):
     1. AM admin sees full content
     2. Org admin sees own tenant content
     3. Org user sees „Neturite teisės" — redirect'as
     4. Renders empty state
   - `apps/web/src/components/payroll/__tests__/PayrollProfileDialog.test.tsx` (2+):
     1. Form validation
     2. distributions sub-section veikia

**Constraints**:
- LT UI
- shadcn primitives
- Strict permission gates: 2 sluoksniai
- A11y
- **NEKOMITUOTI**

**Done criterion**:
- `yarn test` PASS (66 esami + nauji)
- `yarn typecheck` + `yarn build` pass

### D. Security Reviewer brief

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Po Backend + Frontend baigti** — atskirai paleisi penetration-style testus.

**Skaityti**:
1. `docs/fvm/iter-13-payroll.md` — saugumo reikalavimai
2. `docs/fvm/spec/FVM-v0.1.md` — §4.4 explicit „Specialistas savo duomenų nematosi"
3. Visi Iter 13 backend ir frontend failai

**Tavo darbas**:

1. Atlikti **penetration-style audit**: bandyti praeiti permission gates:
   - Direct HTTP call'ai su skirtingais auth tokens (mock'ais arba real)
   - Cross-tenant access bandymai
   - Privilege escalation (org_user bandant pasirinkti AM admin role)
   - URL manipulation (`/du` su org_user role)
   - Multi-step attacks (login as org_user, query payroll endpoint per pattern)

2. **Audit checklist**:
   - [ ] AM admin gauna duomenis
   - [ ] Org admin (savo tenant) gauna
   - [ ] Org admin (kita tenant) — 403
   - [ ] Org user — 403 visiems
   - [ ] Org user su query string `?user_id=mine` — 403
   - [ ] URL'as `/du` per org_user — redirect'as
   - [ ] Dialog'ai neatsidaro org_user'iui
   - [ ] Backend logging neištecka DU duomenų į regular log files

3. **Audit'oriaus išvada**:
   - **SECURE / VULNERABLE**
   - Jei VULNERABLE — konkretūs scenarijai

**Output formatas**:
```
## Security Audit Iter 13

### Pateikti scenarijai
1. <pavadinimas> → PASS|FAIL
2. ...

### Vulnerability findings
- ...

### Recommendations
- ...

### Verdict: SECURE | VULNERABLE
```

## Iter 13 Audit kriterijai

### Kriterijus 1: DB schema §6.5, §6.6
- [ ] payroll_profiles + payroll_distributions lentelės pagal docx
- [ ] CHECK constraints + FK politika

### Kriterijus 2: Permission gates (KRITIŠKAS)
- [ ] AM admin/org_admin/specialist matrix įgyvendintas
- [ ] Specialist NEGAUNA DU duomenų net savo
- [ ] Cross-tenant blokuojama
- [ ] Security Reviewer paskelbė SECURE

### Kriterijus 3: Distribution validation (F09)
- [ ] paskirstymo_tipas (procentais / fiksuota) handle'inamas
- [ ] SUM(procentais) per same period ≤ 100
- [ ] reiksme positive

### Kriterijus 4: Monthly compute (F10)
- [ ] computeMonth idempotentiškas
- [ ] Sukuria expense'us su tipas='du'
- [ ] Integruoja su existing expense flow

### Kriterijus 5: UI
- [ ] /du puslapis veikia AM admin/org_admin'ams
- [ ] Org user redirect'as
- [ ] Sidebar punktas tik canViewPayroll
- [ ] Dialog'ai veikia

### Kriterijus 6: Testai
- [ ] Backend bent 12 permission + 8 funkcionalumo + 6 migration testai
- [ ] Frontend bent 5 nauji
- [ ] Visi pereina

### Kriterijus 7: ADR-003 laikomasi (tik bruto, ne Sodra/GPM)
- [ ] payroll_profiles laukai pagal §6.5 (atlyginimas_bruto, priedai — ne mokesčių laukai)
- [ ] Dokumentai mini ADR-003

### Kriterijus 8: TS + Build + Security
- [ ] typecheck + build pass abu app'sai
- [ ] Security Reviewer verdict: SECURE
