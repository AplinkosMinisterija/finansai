# Iter 14 (FVM-6) — Reports + Excel/PDF Export

> **CTO brief**. Įgyvendina docx §4.5, F12, F13, F14.

## Tikslas

Ataskaitų generavimas iš sukauptų FVM duomenų. 3 šablonai:
1. Biudžeto vykdymo: planuota vs faktinė vs likutis (per šaltinį + kategoriją)
2. Spec. programos: prašyta → patvirtinta → panaudota
3. DU paskirstymo: kas kiek iš kurio šaltinio per laikotarpį (TIK AM admin / org_admin)

Eksportas: Excel (.xlsx) ir PDF.

## Apima iš docx

- §4.5 report.service.ts (Finansinių ataskaitų generavimas)
- F12: Biudžeto vykdymo ataskaita (planas vs faktinis vs likutis)
- F13: Spec. programos ataskaita (prašyta → patvirtinta → panaudota)
- F14: Eksportas į Excel ir PDF

## NEAPIMA

- §3.4 dashboard atnaujinimai (jau Iter 10/12 padaryti)
- Audit log / activity tracking ataskaita
- Custom dashboards (Iter 15)

## Saugumo (svarbu — DU ataskaita)

DU paskirstymo ataskaita (§3) — TIK `canViewPayroll(user)` (AM admin + org_admin savo tenant). Specialist negali nei filter'inti, nei generate, nei download. Atskira route prefix `/reports/payroll-distribution` su `requireDuAccess`.

Per ADR-005: visi reports endpoint'ai naudoja tuos pačius DU filter'us kaip ir kitos endpoint'ai (žr. expense.list + projects.list patterns).

## Komandos sudėtis

| Rolė | Subagentas | Atsakomybė |
|---|---|---|
| Backend Engineer | general-purpose | report.service.ts + 3 endpoint'ai + Excel/PDF generation + tests |
| Frontend Engineer | general-purpose | /ataskaitos puslapis + filter UI + download buttons + tests |
| Security Reviewer (compact) | general-purpose | DU ataskaita verify SECURE per pre-existing canViewPayroll filtravimas |
| Independent Auditor | general-purpose | Audit 8 kriterijų |

## Subagentų briefingai

### A. Backend brief

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas pirminis skaitymas**:
1. `docs/fvm/iter-14-reports.md` — sekcija „A. Backend brief"
2. `docs/fvm/01-architecture.md` — Report API contract sekcija
3. `docs/fvm/spec/FVM-v0.1.md` — §4.5, F12-F14
4. `docs/fvm/03-decisions-log.md` — ADR-005 (canViewPayroll + DU filter pattern)
5. `apps/api/src/services/expenses.service.ts` — budgetSummary (referencija agregacijai)
6. `apps/api/src/services/payroll.service.ts` — kaip DU expense'ai kuriami (su saltinio_dalis)
7. `apps/api/src/services/projects.service.ts` — referencija
8. `apps/api/src/utils/permissions.ts` — canViewPayroll, isAmAdminUser

**Tavo deliverables**:

1. **Naujas servisas**: `apps/api/src/services/reports.service.ts`
   - 3 endpoint'ai (visi grąžina struktūrintą JSON; eksportas atskirai):
   
   **a) `budgetExecution` — Biudžeto vykdymo (F12)**:
   - Params: year (required), tenantId (optional, AM admin filter), format ('json' | 'xlsx' | 'pdf')
   - JSON struktura:
     ```ts
     {
       year: 2026,
       generatedAt: ISO,
       totalPlanuota, totalFaktine, totalLikutis (cents → string decimal),
       bySource: [
         { fundingSourceId, fundingSourceName, fundingSourceTypeName,
           planuota, faktine, likutis, percentUsed,
           byCategory: [
             { categoryItemId, categoryCode, categoryName,
               planuota, faktine, likutis, percentUsed, isWarning, isOver }
           ]
         }
       ]
     }
     ```
   - DU filter: jei `!canViewPayroll(me)`, exclude'inti DU expenses iš `faktine` SUM (analogiškai budgetSummary), exclude'inti DU kategorijos eilutes iš `byCategory`
   - Tenant scope: org_user (per `canViewPayroll==false` neturėtų gauti?). Patikrink. Tinkamas elgesys: org user mato BENDRĄ ataskaitą savo tenant'e, tik be DU info. Org admin + AM admin mato pilna.
   
   **b) `specProgramExecution` — Spec. programos (F13)**:
   - Params: year (required), tenantId (optional)
   - JSON struktura:
     ```ts
     {
       year,
       generatedAt,
       items: [
         { requestId, requestProjectName, tenantName,
           prasyta, patvirtinta, panaudota, likutis, percentUsed,
           projektoId (jei sukurtas), projektoStatusas
         }
       ]
     }
     ```
   - Filter: requests su `budget_category.code = 'spec_programa'` ir status APPROVED
   - prasyta = sum of cost_* fields iš request
   - patvirtinta = decisionGrantedAmount
   - panaudota = SUM(expenses.suma) per related project (jei sukurtas)
   - Tenant scope per esamą requests.list logiką
   
   **c) `payrollDistribution` — DU paskirstymo (F14, SAUGUMO)**:
   - Params: from (date required), to (date required), tenantId (optional)
   - SAUGUMO: `requireDuAccess(meta, tenantId?)` PIRMAS — specialist 403
   - JSON struktura:
     ```ts
     {
       from, to, generatedAt,
       byProfile: [
         { profileId, vardasPavarde, pareigos, tenantName,
           bySource: [
             { fundingSourceId, fundingSourceName, sumaPerLaikotarpi }
           ],
           totalPerLaikotarpi
         }
       ],
       totalsBySource: [
         { fundingSourceId, fundingSourceName, total }
       ]
     }
     ```
   - Agregacija per `expenses` lentelę kur `tipas='du'` ir `data` tarp from/to
   - Per kiekvieną expense: panaudoja `saltinio_dalis` jsonb (jei nėra — single source per allocation.funding_source)
   - Profile gaunamas per `aprasymas` parse (regex `DU YYYY-MM: (.+)`) — TAKEAWAY: galimas trapus parse, alternatyvos:
     - **Lengviausia**: pridėti `payroll_profile_id` koloną į `expenses` (per `computeMonth` set'inti) — minor schema change
     - **Pragmatiškiausia**: parse'inti `aprasymas`
   - **Pasirink lengviausią**: pridėk `payroll_profile_id` integer NULL FK į expenses lentelę per atskirą migraciją `20260527100000_add_payroll_profile_to_expenses.ts`. Backfill: per kiekvieną esamą DU expense'ą parse aprasymas, surast matching profile, update'inti. Update'inti `computeMonth` kad set'intų šitą lauką.

2. **Excel generator**: `apps/api/src/utils/reports/xlsx.ts`
   - Naudok `exceljs` (jei dar nėra package — pridėk) — installation: `cd apps/api && yarn add exceljs`
   - Funkcijos: `generateBudgetExecutionXlsx(data)`, `generateSpecProgramXlsx(data)`, `generatePayrollDistributionXlsx(data)`
   - Output: Buffer (binary), kad endpoint'as galėtų grąžinti su atitinkamais HTTP headers
   - LT lokalizacija (column headers, formatting)
   - Decimal'ai €  formatu

3. **PDF generator**: `apps/api/src/utils/reports/pdf.ts`
   - Naudok `pdfkit` (lengvas, nedidelis dep) — `cd apps/api && yarn add pdfkit @types/pdfkit`
   - Alt: puppeteer + HTML šablonai — per heavy
   - LT charset palaikymas (lietuviški diakritiniai — `pdfkit` reikalauja unicode font'o; pridėk Roboto ar DejaVu Sans iš `assets/fonts/`)
   - Funkcijos: `generateBudgetExecutionPdf(data)`, `generateSpecProgramPdf(data)`, `generatePayrollDistributionPdf(data)`
   - Output: Buffer

4. **Endpoint'o response logika**:
   - Jei `format === 'json'` (default): grąžina JSON
   - Jei `format === 'xlsx'`: kviečia generator, grąžina Moleculer'io binary response su Content-Type/Disposition (Moleculer.web turi `responseType` ir `Content-Disposition` mechaniką per `ctx.meta`)
   - Jei `format === 'pdf'`: panašiai
   - Failas pavadinimas: `biudzeto-vykdymas-{year}-{generatedAt}.xlsx`

5. **Shared types**: `packages/shared/src/fvm.ts` ar `packages/shared/src/reports.ts` naujas failas:
   - `BudgetExecutionReport`, `SpecProgramReport`, `PayrollDistributionReport`
   - DTOs query params

6. **API routing**: `apps/api/src/services/api.service.ts`:
   - Whitelist `reports.*`
   - REST aliases:
     - `GET /reports/budget-execution?year=...&tenantId=...&format=xlsx`
     - `GET /reports/spec-program-execution?year=...&tenantId=...&format=xlsx`
     - `GET /reports/payroll-distribution?from=...&to=...&tenantId=...&format=xlsx`
   - Binary response support per Moleculer.web

7. **Migracija** (jei pasirinksi option A su `payroll_profile_id`):
   - `apps/api/src/database/migrations/20260527100000_add_payroll_profile_to_expenses.ts`
   - ALTER TABLE expenses ADD COLUMN payroll_profile_id integer NULL FK → payroll_profiles(id) ON DELETE SET NULL
   - Backfill: per DU expense parse aprasymas → match profile per tenant + vardas — UPDATE
   - Index idx_expenses_payroll_profile (jei reikia)

8. **Atnaujink `payroll.service.ts:computeMonth`**:
   - Insert'inant DU expense — set'inti naują `payrollProfileId` field

9. **Integration testai**:

   `apps/api/test/services/reports-budget-execution.spec.ts` (bent 5):
   1. AM admin gauna pilną ataskaitą su DU eilutėmis ir agregacijomis
   2. Org user gauna ataskaitą BE DU info (faktinė be DU expense'ų; byCategory be 'du' eilučių)
   3. Empty data → tuščia struktura
   4. xlsx format'as grąžina binary buffer
   5. pdf format'as grąžina binary buffer
   6. tenant scope: org_admin tik savo tenant'e
   
   `apps/api/test/services/reports-spec-program.spec.ts` (bent 4):
   1. Approved spec.programa request → įtraukiamas
   2. Submitted request → neįtraukiamas
   3. Project su expenses → panaudota teisingai
   4. xlsx + pdf export
   
   `apps/api/test/services/reports-payroll-distribution.spec.ts` (bent 4):
   1. AM admin gauna su DU agregacijomis per profile + per source
   2. Org user → 403 (canViewPayroll false)
   3. Org admin gauna savo tenant'o tik
   4. Cross-tenant → 403
   5. Date range filter veikia

**Constraints**:
- TS strict, LT errors
- Decimal money (toCents/centsToAmount)
- Transakcijos data migration'e
- exceljs + pdfkit kaip naujos deps
- **NEKOMITUOTI**

**Done criterion**:
- `yarn test` PASS (256 esami + ~15 nauji backend)
- `yarn typecheck` + `yarn build` pass
- xlsx + pdf failai atsidaro be klaidos (manual smoke)

### B. Frontend brief

**Cwd**: `/home/arunas/Projects/AplinkosMinisterija/finansai`

**Privalomas pirminis skaitymas**:
1. `docs/fvm/iter-14-reports.md` — sekcija „B. Frontend brief"
2. `docs/fvm/spec/FVM-v0.1.md` — §4.5, F14
3. `packages/shared/src/fvm.ts` ar `reports.ts` — Report tipai (po Backend Iter 14A)
4. `apps/web/src/lib/api/fvm.ts` — papildysi reportsApi
5. `apps/web/src/pages/StatistikaPage.tsx` — referencija (yra panašus pattern)

**Backend baigtas** (Iter 14A): reports.service.ts + 3 endpoint'ai + xlsx/pdf generators.

**Tavo deliverables**:

1. **API client**: `apps/web/src/lib/api/fvm.ts`:
   - `reportsApi`: `budgetExecution`, `specProgramExecution`, `payrollDistribution`
   - Variantas su format='json' grąžina struktūrintus duomenis
   - Variantas su format='xlsx' | 'pdf' grąžina Blob (galima trigger'inti file download)

2. **Naujasis puslapis**: `apps/web/src/pages/AtaskaitosPage.tsx`
   - Layout su tabs ar atskiromis sekcijomis 3 ataskaitoms:
     - **Biudžeto vykdymas**: filter (metai), JSON preview lentelėje (su isWarning/isOver flag'ais), Excel + PDF download buttons
     - **Spec. programos**: filter (metai), lentelė, Excel + PDF
     - **DU paskirstymas**: filter (laikotarpis from-to), **rodyti tik canViewPayroll**, lentelė, Excel + PDF
   - File download per Blob URL + temporary anchor element
   - Loading states

3. **Komponentai**: `apps/web/src/components/reports/`
   - `BudgetExecutionReport.tsx` — render JSON struktūra lentelėje su bySource + byCategory grupavimu
   - `SpecProgramReport.tsx` — lentelė
   - `PayrollDistributionReport.tsx` — lentelė; permission-gated

4. **Routing + Sidebar**:
   - `/ataskaitos` → AtaskaitosPage
   - Sidebar naujas punktas „Ataskaitos" (icon: FileText ar BarChart3)

5. **Frontend testai** (bent 5):
   - `apps/web/src/pages/__tests__/AtaskaitosPage.test.tsx` (3+):
     1. Renders 3 tabs/sections
     2. DU sekcija matoma tik canViewPayroll'iui
     3. Download button kvieta API su correct format
   - `apps/web/src/components/reports/__tests__/BudgetExecutionReport.test.tsx` (2+):
     1. Renders su mock data
     2. Empty state

**Constraints**:
- LT UI
- shadcn primitives
- Blob download per browser native
- Permission gating
- **NEKOMITUOTI**

**Done criterion**:
- `yarn test` PASS
- `yarn typecheck` + `yarn build` pass

## Iter 14 Audit kriterijai

### Kriterijus 1: Reports schema (F12-F14)
- [ ] 3 endpoint'ai grąžina teisingas JSON struktūras
- [ ] Decimal sumos teisingos
- [ ] Tenant scope veikia

### Kriterijus 2: Biudžeto vykdymo (F12)
- [ ] planuota / faktinė / likutis per šaltinį + kategoriją
- [ ] DU filter veikia (specialist nemato)

### Kriterijus 3: Spec. programos (F13)
- [ ] prašyta / patvirtinta / panaudota per request
- [ ] Project susiejimas (jei sukurtas)

### Kriterijus 4: DU paskirstymas (F14)
- [ ] canViewPayroll gate'as
- [ ] Per profile + per source agregacija
- [ ] Cross-tenant blokas

### Kriterijus 5: Excel + PDF eksportas
- [ ] xlsx generuojasi be klaidos
- [ ] PDF generuojasi be klaidos su LT diakritiniais
- [ ] Failai atsidaro (manual verify)

### Kriterijus 6: UI funkcionalumas
- [ ] /ataskaitos puslapis veikia
- [ ] 3 tabs ar sekcijos
- [ ] Download buttons veikia
- [ ] DU section tik canViewPayroll

### Kriterijus 7: Testai
- [ ] Backend bent 13 (5+4+4)
- [ ] Frontend bent 5
- [ ] Visi pereina

### Kriterijus 8: TS + Build + Security
- [ ] typecheck + build pass
- [ ] DU ataskaita SECURE per canViewPayroll
