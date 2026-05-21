# Iter 16 (FVM-8) — E2E + Staging UAT + Production deploy

> **CTO brief**. Galutinė FVM iteracija. Šipinama Giedrei + production.

## Tikslas

E2E (Playwright) testai padengia 5+ kritinius user journeys; migration rehearsal staging'e su Giedrės UAT; CLAUDE.md + README + docs atnaujinti; demo data atnaujintas; production tag X.Y.Z.

## Apima

- Playwright E2E suite (5 user journeys)
- Migration rehearsal: dev → staging
- Documentation update (CLAUDE.md, README, docs/06-implementacijos-planas.md)
- Demo data refresh (seeds.ts atnaujinimas su FVM datą)
- Performance test (10k+ expenses scenarius)
- Staging deploy + Giedrės UAT
- Production tag X.Y.Z

## Komandos sudėtis

| Rolė | Subagentas | Atsakomybė |
|---|---|---|
| QA Engineer | general-purpose | Playwright E2E setup + 5 journey'ai + tests |
| DevOps | general-purpose | Demo data seeds + dev DB tests + staging migracijos plan |
| Tech Writer | general-purpose | CLAUDE.md + README + docs atnaujinimas |
| Independent Auditor | general-purpose | Final audit kriterijai + ship readiness |

## Subagentų briefingai

### A. QA brief — Playwright E2E

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas pirminis skaitymas**:
1. `docs/fvm/iter-16-deploy.md` — sekcija „A. QA brief"
2. `docs/fvm/00-master-plan.md` — Iter 16 user journeys
3. `apps/web/src/pages/*` — visi FVM puslapiai
4. CLAUDE.md — dev workflow

**Tavo deliverables**:

1. **Playwright setup**:
   - Sukurti `apps/e2e/` arba šaknyje `playwright.config.ts`
   - `package.json` skripts: `e2e`, `e2e:headed`, `e2e:ui`
   - `cd / && yarn add -D -W @playwright/test`
   - Naudoti chromium browser
   - Test'ų aplinka: lokalus dev API + web (per `yarn dev:db` + `yarn dev:api` + `yarn dev:web`)

2. **5 critical user journeys**:
   - `tests/e2e/01-funding-source-flow.spec.ts`: AM admin login → sukuria funding_source → 2 budget_allocations → mato biudžetą
   - `tests/e2e/02-spec-program-flow.spec.ts`: Institucija pateikia spec.programa prašymą → AM tvirtina → AM sukuria FVM projektą per mygtuką → projektas matomas /projektai
   - `tests/e2e/03-expense-tracking.spec.ts`: Org admin sukuria projektą → pridėja expenses (single + multi-source) → biudžeto likutis atnaujinamas → warning rodomas pasiekus 80%
   - `tests/e2e/04-payroll-permission.spec.ts`: AM admin sukuria payroll profile + distributions → computeMonth → DU expense'ai sukurti. Org user bandant pasiekti /du — redirect'inamas. Bandant /expenses?type=du — sąrašas tuščias.
   - `tests/e2e/05-annual-report.spec.ts`: AM admin generuoja biudžeto vykdymo ataskaitą → Excel download → patikrina filename + dydis (jei galima); generuoja DU ataskaitą → Excel download; org_user bandant DU ataskaitą — UI nemato tab'o

3. **Test data seeding**: per kiekvieną test runs reset DB į clean state'ą su minimal'iu seed (per `dev:db:reset` arba helper)

4. **CI integration**: jei galima — workflow file CI'iui `.github/workflows/e2e.yml` (optional, jei sudėtinga)

**Constraints**:
- Test'ai turi run'inti su `yarn e2e`
- Lokali aplinka (dev DB + dev server'iai paleisti)
- LT UI selektoriai
- **NEKOMITUOTI**

**Done criterion**:
- `yarn e2e` PASS visi 5
- README ar `apps/e2e/README.md` paaiškina kaip paleisti

### B. DevOps brief — Demo data + migration plan

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas pirminis skaitymas**:
1. `apps/api/src/database/seeds/01_initial.ts` — esamas seed
2. `docs/fvm/02-migration-strategy.md` — migracijos planas
3. Visos FVM migracijos `20260522100000` → `20260527100000`

**Tavo deliverables**:

1. **Naujas seed'as**: `apps/api/src/database/seeds/02_fvm.ts`
   - Sukuria realistic FVM datą AM tenant'e:
     - 2026 funding_source „Valstybės biudžetas 2026" (1.5M)
     - 2026 funding_source „ES fondai 2026" (500k)
     - 5 budget_allocations per kategorijas
     - 1 spec.programos request → APPROVED → projektas → 3 expenses
     - 1 regular projektas → 5 expenses (multi-source split'as)
     - 3 payroll profiles + distributions per AM tenant
     - 1 computeMonth įvykdytas (kovas 2026)
   - Idempotent — jei jau seed'inta, skip

2. **Migration verification script**: `apps/api/scripts/verify-fvm-migration.ts`
   - Standalone Node skriptas:
     - Patikrina visas FVM lenteles egzistuoja
     - Patikrina classifiers seeded
     - Patikrina, kad nei vienas reikalavimo iš `docs/fvm/spec/FVM-v0.1.md` neapeitas
   - Output: pass/fail su detalėmis

3. **Staging migration plan**: `docs/fvm/staging-deploy-plan.md`
   - Pre-deploy checklist:
     - [ ] Backup'as staging DB
     - [ ] Push į main (auto-deploy)
     - [ ] Stebėt CI + biip-infra deploy
     - [ ] Manual smoke test'as: login, sukurt funding_source, pridėt expense, generate report
   - Rollback plan jei migracija sulaužys

4. **Performance test (optional)**: jei laikas leis — `apps/api/scripts/perf-test.ts`:
   - Sukuria 10k expenses scenarius
   - Matuoja budgetSummary endpoint response time
   - Reports if > 500ms — flag

**Done criterion**:
- `yarn db:seed` paleidžia naują seed'ą lokaliai
- `apps/api/scripts/verify-fvm-migration.ts` paleidžia ir PASS
- staging-deploy-plan.md sukurtas

### C. Tech Writer brief — Documentation update

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas pirminis skaitymas**:
1. CLAUDE.md (root + `apps/`) — esami
2. README.md — esamas
3. `docs/06-implementacijos-planas.md` — atnaujint su Iter 16 ✅
4. Visi `docs/fvm/*.md`

**Tavo deliverables**:

1. **`CLAUDE.md` atnaujinimas**:
   - Pridėti FVM modulio aprašymą (po MVP fokusas)
   - Atnaujinti „Galimi gstack skill'ai" (jei aktualu)
   - „Dabartinis statusas" lentelėje: „Iter 0-16 baigti — MVP + FVM ready"
   - Permission modelio sekciją: ADR-005 (canViewPayroll, is_du_system)

2. **README.md atnaujinimas**:
   - Pridėti FVM moduio funkcionalumo aprašymą
   - Tech stack atnaujinti (exceljs, pdfkit)

3. **`docs/06-implementacijos-planas.md` finalize**:
   - Pridėti Iter 13/14/15/16 ✅ entries (jei trūksta)

4. **`docs/fvm/README.md` finalize**:
   - Po visų iter pridėti „Status: COMPLETED ✅"
   - Performance metrics + test counts (galutiniai)

5. **`docs/diskusijos.md` finalize entries**:
   - Iter 14 entry
   - Iter 15 entry
   - Iter 16 entry su release notes

6. **CHANGELOG.md sukurti arba atnaujinti** (jei nėra):
   - v0.3.0 FVM release entry su naujomis funkcijomis

**Constraints**:
- LT kalba
- Konsistentiškumas su esamomis konvencijomis
- **NEKOMITUOTI**

**Done criterion**:
- Visi dokumentai atnaujinti
- Iter 16 brief sumažintas, nes integracija fokusinė

## Iter 16 Audit kriterijai

### Kriterijus 1: Playwright E2E (5 journeys)
- [ ] 5 journey'ai pereina
- [ ] `yarn e2e` veikia lokaliai
- [ ] Playwright config setup

### Kriterijus 2: Demo data refresh
- [ ] Naujas seed'as su FVM datą veikia
- [ ] verify-fvm-migration script PASS

### Kriterijus 3: Documentation
- [ ] CLAUDE.md atnaujintas
- [ ] README atnaujintas
- [ ] 06-implementacijos-planas.md su visais Iter 9-16 ✅
- [ ] diskusijos.md atnaujintas
- [ ] CHANGELOG.md sukurtas / atnaujintas

### Kriterijus 4: Migration plan
- [ ] staging-deploy-plan.md sukurtas
- [ ] Rollback procedure dokumentuota

### Kriterijus 5: Ship readiness
- [ ] Visi backend testai PASS
- [ ] Visi frontend testai PASS
- [ ] yarn typecheck + build clean
- [ ] No regression'as ankstesnėms iteracijoms

### Kriterijus 6: docx coverage check
- [ ] Atlikti final cross-reference: visi spec'o §3+§4+§6 reikalavimai padengti
- [ ] Visi 9 atviri GitHub issues (#1-13) — final status check

### Kriterijus 7: TS + Build
- [ ] typecheck + build pass abu app'ams

### Kriterijus 8: CTO sprendimas
- [ ] Push'ti į `main` (staging deploy)
- [ ] Po Giedrės UAT — tag X.Y.Z
