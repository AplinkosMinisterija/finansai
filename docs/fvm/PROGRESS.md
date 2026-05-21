# FVM eiga (live)

**Last update**: 2026-05-21 17:05 UTC (CTO Claude — Iter 10 baigta)

## Statusas

🟢 **Iter 10 (FVM-2) PASS — push'inta į dev**. Ruošiu Iter 11 brief.

## Iteracijų statusas

| Iter | Pavadinimas | Status | Brief | Audit | Push'inta |
|---|---|---|---|---|---|
| 9 (FVM-1) | Foundation: funding_sources + budget_allocations | 🟢 done | `iter-09-foundation.md` | 8/8 PASS | ✅ 2026-05-21 |
| 10 (FVM-2) | Stream 1: Request integration | 🟢 done | `iter-10-request-integration.md` | 8/8 PASS | ✅ 2026-05-21 |
| 11 (FVM-3) | Projects + auto-create | 🟢 done | `iter-11-projects.md` | 8/8 PASS | ✅ 2026-05-21 |
| 12 (FVM-4) | Expenses + budget remainder | 🟢 done | `iter-12-expenses.md` | 8/8 PASS | ✅ 2026-05-21 |
| 11 (FVM-3) | Projects + auto-create | ⏸️ | — | — | — |
| 12 (FVM-4) | Expenses + budget remainder | ⏸️ | — | — | — |
| 13 (FVM-5) | Payroll (DU) | ⏸️ | — | — | — |
| 14 (FVM-6) | Reports + Excel/PDF | ⏸️ | — | — | — |
| 15 (FVM-7) | Dashboard + multi-year | ⏸️ | — | — | — |
| 16 (FVM-8) | E2E + Staging + Prod | ⏸️ | — | — | — |

Legend: ⏸️ pending • 🟡 in progress • 🟢 done • 🔴 blocked/failing audit

## Atviri klausimai

- **ADR-001 sign-off**: ar Giedrė sutinka su klasifikatorius vs enum sprendimu? Iter 16 staging UAT — galim parodyti. Jei ne — migracija į enum.
- **ADR-003**: payroll mokesčiai (Sodra/GPM) — Iter 13. Jei staging UAT metu Giedrė prašys — pridėti į Iter 13 scope.
- **Iter 9 minor**: Sidebar nav item `/finansavimo-saltiniai` matomas visiems auth users (ne tik AM admin). Audit'as priėmė kaip konsistentu su `/biudzetas`. Jei reikia AM-only navigaciją — smulkus fix.

## Diff vs originalus plano timeline

Originalas: 8 iter × ~1.5 sav = 12 sav.

| Iter | Plan | Real | Delta |
|---|---|---|---|
| 9 | 1.5 sav. | ~2 val. (Claude sesija) | -1.5 sav. |
| 10 | 1.5 sav. | ~1 val. (Claude sesija) | -1.5 sav. |
| 11 | 1.5 sav. | ~1.5 val. (Claude sesija) | -1.5 sav. |
| 12 | 1.5 sav. | ~1.5 val. (Claude sesija) | -1.5 sav. |

Claude vykdomas paraleliai daug subagent'ais — realus laikas daug trumpesnis nei žmogui. Adjustments po kiekvieno iter.

## Veiklos log

### 2026-05-21 (vakar)
- CTO Claude perėmė vadovavimą (vartotojo prašymu).
- Perskaityta `FVM_Techninis_uzsakymas.docx` (Giedrės v0.1).
- Atliktas gap analysis vs esama app būklė (Iter 0-8 baigti).
- Susidaryta 8 iteracijų roadmap, master plan, architektūra, migracijos strategija, ADR-001/002/003.

### 2026-05-21 (šiandien, popietė)
- **Iter 9 (FVM-1) BAIGTA**. 4 subagent'ai (A/B/C/D) + nepriklausomas auditas.
- Sub A (Test Infra): nuo nulio sukurtas backend Jest infra. 3 sanity testai PASS.
- Sub B (DBA): migracija `20260522100000_create_fvm_foundation.ts` + verify helper + 11 testai. Heuristic mapper senų items.
- Sub C (Backend): `funding-sources.service.ts` + `budgetAllocations.service.ts` + modeliai + DTO + 40 integration testų.
- Sub D (Frontend): `/finansavimo-saltiniai` puslapis, refaktorintas `/biudzetas`, dialogai, sidebar nav, 10 component testų.
- ADR-004 pridėtas: ID = SERIAL integer (ne UUID kaip arch v1.0 siūlė); priežastis — codebase consistency.
- VitePress config: `srcExclude: ['fvm/**']` — FVM darbo dokai nebepublikuojami per dokų svetainę (placeholder `<>` žymeklių dėl).
- 4 commit'ai push'inti į `dev`. CI green. dev-finansai.biip.lt deploy success.
- Auditorius: 8/8 audit kriterijai PASS. READY TO SHIP.
- Test counts: backend 54 (3 sanity + 11 migration + 40 service); frontend 42 (32 baseline + 10 nauji).

### 2026-05-21 (ilgas vakaras)
- **Iter 12 (FVM-4) BAIGTA**. 3 subagent'ai + nepriklausomas auditas.
- Sub A (DBA): `expenses` lentelė + GIN index ant `saltinio_dalis` (jsonb_path_ops) + test isolation fix 3 esamuose spec'uose. 18 testai PASS.
- Sub B (Backend): Expense modelis + servisas (CRUD + budgetSummary), multi-source SUM validation (1 ct epsilon), realus `faktine` per SUM(expenses.suma), `WARNING_THRESHOLD_PERCENT` (default 80, env override), `budgetAllocations.summary` + `projects.summary` perdaryti su flags. 30 nauji testai.
- Sub C (Frontend): ExpensesSection + ExpenseDialog (multi-source split UI su live SUM validation), BudgetWarningBanner (progress bar + flags), BudgetWarningsList, BiudzetasPage bulk summary + warnings sekcija, ProjektoDetailPage realus expenses UI. 9 nauji testai.
- Auditorius: 8/8 PASS. Iter 12 backend testų 48 (gerokai viršija 19+ reikalavimą).
- Test counts (po Iter 12): backend 175 (127 + 48); frontend 66 (57 + 9).

### 2026-05-21 (vėlai vakare)
- **Iter 11 (FVM-3) BAIGTA**. 3 subagent'ai (A/B/C) + nepriklausomas auditas.
- Sub A (DBA): `projects` lentelė + 14 testai + `requests.fvm_project_id` FK pridėtas. Atrastas ir taisytas test isolation bug (Iter 9/10 testai turi pirma rollback Iter 11).
- Sub B (Backend): Project modelis + projects.service.ts (CRUD + lifecycle + permissions), real createFvmProject implementation pakeičia Iter 10 placeholder. 29 nauji testai (22 service + 8 createFvm).
- Sub C (Frontend): /projektai + /projektai/:id puslapiai, ProjectDialog + Status/Type badges + StatusChangeDialog, PrasymoDetailPage integration su real backend, Sidebar nav. 9 nauji testai.
- Auditorius: 8/8 PASS. CreateFvmProjectResponse discriminated union (created|pending) backward compat.
- Test counts (po Iter 11): backend 127 (98 + 29); frontend 57 (48 + 9).

### 2026-05-21 (šiandien, vakaras)
- **Iter 10 (FVM-2) BAIGTA**. 3 subagent'ai (A/B/C) + nepriklausomas auditas.
- Sub A (DBA): migracija `20260523100000_add_fvm_fields_to_requests.ts` — 4 nauji nullable laukai + CHECK constraint + index. 10 testų PASS.
- Sub B (Backend): Request modelis papildytas, requests.service.ts + decision validation, naujas createFvmProject placeholder action, dashboard.service.ts budgetCategoryStats agregacija. Pre-existing bug fix: ApprovalStep.$beforeUpdate no-op (lentelė be updated_at). 20 nauji testai (16 requests-fvm + 4 dashboard-fvm).
- Sub C (Frontend): RequestWizard 6 žingsniai (naujas „Biudžetas"), conditional spec.programa/funding_source_type sekcijos, ClassifierSelectById nauja variant, PrasymoDetailPage „Sukurti FVM projektą" placeholder mygtukas, BudgetCategoryChart StatistikaPage'e, 6 nauji testai.
- Auditorius: 8/8 PASS.
- Test counts (po Iter 10): backend 84 (54 + 30); frontend 48 (42 + 6).
