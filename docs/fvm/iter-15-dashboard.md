# Iter 15 (FVM-7) — FVM Dashboard + multi-year planning

> **CTO brief**. Įgyvendina docx §3.4 papildymą (FVM-specific) + F15, F16.

## Tikslas

Dedikuotas FVM dashboard'as su biudžeto suvestine, artėjančiais terminais, pavojaus signalais. F16: galimybė kopijuoti praėjusių metų biudžetą į kitus metus.

## Apima iš docx

- §3.4 dashboard kategorijos breakdown (jau Iter 10 padaryta, čia papildoma FVM-specific)
- F15: Dashboard — biudžeto suvestinė + artėjantys terminai + pavojaus signalai
- F16: Biudžeto planavimas kitiem metams (kopijavimas iš praėjusių)

## NEAPIMA

- Nauji ataskaitų tipai (Iter 14)
- Detalūs analytics chart'ai (StatistikaPage jau yra)

## Komandos sudėtis

| Rolė | Subagentas | Atsakomybė |
|---|---|---|
| Backend Engineer | general-purpose | dashboard.fvmSummary + funding-sources.copyFromYear endpoint + tests |
| Frontend Engineer | general-purpose | HomePage atnaujinimas + CopyBudgetDialog + tests |
| Independent Auditor | general-purpose | 6 audit kriterijai |

## Subagentų briefingai

### A. Backend brief

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas pirminis skaitymas**:
1. `docs/fvm/iter-15-dashboard.md` — sekcija „A. Backend brief"
2. `docs/fvm/spec/FVM-v0.1.md` — F15, F16
3. `apps/api/src/services/dashboard.service.ts` — esamas dashboard'as
4. `apps/api/src/services/expenses.service.ts` — budgetSummary (referencija agregacijai)
5. `apps/api/src/services/fundingSources.service.ts` — esami CRUD endpoint'ai
6. `apps/api/src/services/budgetAllocations.service.ts` — esami CRUD
7. `apps/api/src/services/projects.service.ts` — projektai su deadlines

**Tavo deliverables**:

1. **Atnaujink `dashboard.service.ts`** — pridėk naują endpoint'ą `fvmSummary`:
   - Params: year (required), tenantId (optional, AM admin filter)
   - Grąžina:
     ```ts
     {
       year,
       generatedAt,
       budgetTotals: {
         planuota,
         faktine,
         likutis,
         percentUsed,
         isWarning,
         isOver
       },
       topWarnings: BudgetWarningItem[] (top 5),
       upcomingDeadlines: [
         { type: 'project_end' | 'allocation_year_end',
           id, name, date, daysUntil }
       ] // next 30 days
       activeProjectsCount,
       completedProjectsCount,
       totalSourcesCount,
       totalAllocationsCount,
     }
     ```
   - DU filter per ADR-005: agregacijos exclude'ina DU expense'us jei !canViewPayroll
   - upcomingDeadlines: query projects su pabaigos_data tarp now() ir now()+30d, status NE 'baigta' arba 'uzdaryta'

2. **Naujas endpoint'as `fundingSources.copyFromYear`**:
   - Params: { sourceYear, targetYear, tenantId (optional AM admin) }
   - Validation:
     - sourceYear, targetYear required
     - targetYear > sourceYear arba targetYear < sourceYear (gali kopijuoti į praeitį dėl test'ų; bet warn'inti UI)
     - sourceYear turi turėti funding_sources tenant'e
     - targetYear funding_sources turi būti tušti (kad nedubliuotume) — 409 Conflict jei jau yra
   - AM admin only
   - Logic:
     - Per kiekvieną source year funding_source: sukuria target year copy su tuo pačiu pavadinimas, kodas, tipas, metine_suma, aprasymas, aktyvus
     - Per kiekvieną budget_allocation tame source: sukuria copy su naujuoju funding_source_id, sąvininą kategoriją, planuota_suma, pavadinimas, pastabos, spec_prog_tipas
     - Visa transakcijoje
   - Grąžina: `{ copiedSources: number, copiedAllocations: number, targetYear }`

3. **Šalutiniai pakeitimai**:
   - Pridėk getCalendarDeadlines helper'į `apps/api/src/services/dashboard.service.ts`
   - Atnaujink shared types: `FvmSummaryResponse`, `CopyBudgetResponse`, `UpcomingDeadline`

4. **API routing**: `apps/api/src/services/api.service.ts`:
   - Pridėti `GET /dashboard/fvm-summary?year=...`
   - Pridėti `POST /funding-sources/copy-year` (`{ sourceYear, targetYear, tenantId? }`)

5. **Integration testai**:
   - `apps/api/test/services/dashboard-fvm-summary.spec.ts` (bent 5):
     1. AM admin gauna pilną summary su totals + warnings + deadlines
     2. Org user gauna su DU exclude'inta iš totals
     3. Empty data → 0 visur
     4. Upcoming deadlines next 30d — projektai su pabaigos_data atfiltruojami teisingai
     5. Tenant scope: org_admin tik savo
   - `apps/api/test/services/funding-sources-copy.spec.ts` (bent 4):
     1. AM admin copy from 2025 → 2026: visi šaltiniai + allocations sukurti
     2. Conflict: target year jau turi šaltinius → 409
     3. Source year tuščias → 400 LT
     4. Org user → 403
     5. Cross-tenant validacija

**Constraints**:
- TS strict, LT errors
- Transakcijos copy'iui
- ADR-005 DU filter pattern
- **NEKOMITUOTI**

**Done criterion**:
- `yarn test` PASS (288 esami + ~9 nauji)
- `yarn typecheck` + `yarn build` pass

### B. Frontend brief

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas pirminis skaitymas**:
1. `docs/fvm/iter-15-dashboard.md` — sekcija „B. Frontend brief"
2. `apps/web/src/pages/HomePage.tsx` — esamas dashboard'as
3. `apps/web/src/pages/FinansavimoSaltiniaiPage.tsx` — referencija
4. `apps/web/src/lib/api/fvm.ts` — papildysi dashboardApi + copyYear
5. `packages/shared/src/fvm.ts` — FvmSummaryResponse, CopyBudgetResponse

**Tavo deliverables**:

1. **API client'as**: `apps/web/src/lib/api/fvm.ts`:
   - `dashboardApi.fvmSummary({ year, tenantId? })` → FvmSummaryResponse
   - `fundingSourcesApi.copyFromYear({ sourceYear, targetYear, tenantId? })` → CopyBudgetResponse

2. **HomePage atnaujinimas**: `apps/web/src/pages/HomePage.tsx`
   - Pridėti FVM summary section (žemiau esamų stats):
     - Header: „Biudžetas {year}"
     - 4 metric cards: Planuota, Faktinė, Likutis, % panaudota (su isWarning/isOver flags)
     - Top warnings list (`BudgetWarningsList` jau egzistuoja iš Iter 12)
     - Upcoming deadlines list (jei yra projektų artėjančių)
   - Year picker (default current year)
   - Tik canViewBudget arba visiems? Patikrink: viewer perms? Sąžiningai — visi auth users matydami dashboard apžvalgą galima

3. **CopyBudgetDialog**: `apps/web/src/components/funding-sources/CopyBudgetDialog.tsx`
   - AM admin only
   - Modal su: sourceYear (number, default current_year-1), targetYear (number, default current_year), tenantId (AM admin pick)
   - Confirm: „Tai sukurs naują biudžeto kopiją {targetYear} metams pagal {sourceYear}. Įsitikinkite, kad {targetYear} dar tuščia."
   - Submit → kviečia copyFromYear API → invalidate funding sources query → toast su result count'ais
   - Trigger'is per mygtuką FinansavimoSaltiniaiPage'e

4. **FinansavimoSaltiniaiPage atnaujinimas**:
   - „Kopijuoti iš praėjusių metų" mygtukas (AM admin only) — atveria CopyBudgetDialog

5. **Frontend testai** (bent 4):
   - `apps/web/src/pages/__tests__/HomePage-fvm.test.tsx` (2+):
     1. Renders FVM summary section
     2. Year picker veikia
   - `apps/web/src/components/funding-sources/__tests__/CopyBudgetDialog.test.tsx` (2+):
     1. Form validation
     2. Submit kviečia API + invalidate

**Constraints**:
- LT UI
- shadcn primitives (Card, Input, Button, Dialog)
- React Query mutation/query invalidation
- A11y
- **NEKOMITUOTI**

**Done criterion**:
- `yarn test` PASS (87 esami + ~4 nauji)
- `yarn typecheck` + `yarn build` pass

## Iter 15 Audit kriterijai

### Kriterijus 1: FVM Dashboard (F15)
- [ ] dashboard.fvmSummary endpoint'as veikia
- [ ] HomePage rodo FVM section: totals + warnings + deadlines
- [ ] Year picker funkcionuoja
- [ ] DU filter (specialist nemato DU sumų)

### Kriterijus 2: Multi-year planning (F16)
- [ ] copyFromYear endpoint'as veikia
- [ ] CopyBudgetDialog UI veikia
- [ ] Conflict handling (target year not empty → 409)
- [ ] AM admin only

### Kriterijus 3: Permission gates
- [ ] AM admin gali viską
- [ ] Org admin (savo tenant) gali
- [ ] Org user gauna read view be DU info

### Kriterijus 4: UI funkcionalumas
- [ ] HomePage perdarytas su FVM section
- [ ] CopyBudgetDialog veikia
- [ ] Loading + error states

### Kriterijus 5: Testai
- [ ] Backend bent 9
- [ ] Frontend bent 4
- [ ] Visi pereina

### Kriterijus 6: TS + Build + Security
- [ ] typecheck + build pass
- [ ] ADR-005 laikomasi
