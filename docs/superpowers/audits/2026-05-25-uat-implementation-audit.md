# UAT implementacijos auditas — visos issues

**Data:** 2026-05-25
**Apimtis:** nepriklausomas 5-modulių auditas (#40, #41, #42, #9 + regresijos #1–#8/#13) — kodas vs reikalavimai (docx + issue), elgsenos verifikacija, testai.
**Metodas:** 5 lygiagretūs read-only audito agentai, kiekvienas tikrino su file:line įrodymais + targeted testais.

## Suvestinė

Didžioji dalis reikalavimų **✅ ATITINKA**. Rasta **1 HIGH bug, 2 MEDIUM, keli LOW + infra**. Žemiau — verifikacijos matrica ir prioritetizuotas fix planas.

### ✅ Atitinka (be veiksmų)
- **#40** BP-001/FS-001/BP-002/SP-001/FS-002 — visi ✅ (auto-fill korektiškas, year `include` veikia, SP-001 patikrinta, FS-002 DB unique+409).
- **#41** PR-001 ✅ saugu (vadovas-only, DU defense neapeinamas, computeMonth nepaliestas, demo seed wired am-user); PR-002/003 doc-only ✅.
- **#42** PA-001/PA-004/PA-006/PA-007/PA-008/PA-009/PA-010 — ✅.
- **#9** NEAKTUALU ✅; multi-step grandinė/canDecideStep/deadlock(super-approver)/backward-compat — ✅; saugumas (canDecideStep niekada nepraplečia matomumo) ✅.
- **Regresijos #1–#5, #7, #8(dalinai), #13** — funkcionalumas išlikęs.

## Verifikacijos matrica (radiniai)

| ID | Statusas | Įrodymas | Veiksmas |
|---|---|---|---|
| **PA-005 programų dropdown** | 🐛 **HIGH** | `ClassifierSelect.tsx:46,55-59` `showHierarchy=true` default; po PA-005 `source_program` items turi `parentId`→`funding_source_type` (kita grupė) → nei top-level, nei in-group child → **nukrenta; rodoma tik „Kita"**. Sprendimo forma `PrasymoDetailPage.tsx:~547`. | **P1** — taisyti |
| **#8 šaltinio programa (admin)** | ♻️ susijęs su PA-005 | Tas pats dropdown — admin nebegali pasirinkti realios programos. | dengia P1 |
| **#9 metaduomenų „leak" tarpiniam žingsnyje** | 🐛 MED | `requests.service.ts:~1318-1323` intermediate-approve strip'ina tik 6 laukus; `decisionOrderDate`, `priority`, `procurementStage`, `fundingFromIt`, `otherFunds`, `otherFundsSource`, fvmPatch — rašomi PRIEŠ paskutinį žingsnį (spec §6 pažeidimas). Audit-trail komentaras emit'ina `undefined`. | **P2** — taisyti + testas |
| **#6 BudgetCategoryChart data-coverage** | ♻️ MED | Po PA-004 USER nebenustato `budgetCategoryId` → FVM „Pagal biudžeto kategoriją" diagrama beveik tuščia (tik admin-kategorizuoti APPROVED). `dashboard.service.ts:~532` skip NULL. Issue #6 esmę dengia CostCategoryChart (sveika). | **P3** — perženklinti/scope |
| **PA-002/PA-003 backend enforcement** | ⚠️ LOW | `requests.service.ts sanitizePayload PAYLOAD_FIELDS` vis dar priima `priority`/`procurementStage`/funding iš create/update (tik FE enforce'ina). | **P4** — hardening |
| **createFvmProject UX** | ⚠️ LOW-MED | Admin turi nustatyti biudžeto kategoriją tvirtindamas, kitaip „Sukurti FVM projektą" → 400 `NOT_SPEC_PROGRAMA`, be UI užuominos. | **P5** — užuomina |
| **Backend test harness flakiness** | 🐛 INFRA | Visi 5 auditoriai matė non-deterministic FK/unique klaidas (`finansai_test` pool `min:0,max:4` + shared Objection `Model.knex()` + TRUNCATE/seed race). Pavieniui + serijoje (mano pilnas runas) — 348 PASS; lygiagrečiai/su dropdb race — RED. | **P6** — pool max:1 |
| **years.ts be testo; FS update-catch asimetrija** | ⚠️ LOW | `lib/years.ts` neturi unit testo; `fundingSources.service.ts` update catch tikrina tik `code==='23505'` (create tikrina ir Objection wrapper). | **P7** — minor |

## Fix planas

| Prioritetas | Fix | Failai |
|---|---|---|
| **P1 HIGH** | `ClassifierSelect` + `ClassifierSelectById`: kai `showHierarchy`, įtraukti „našlaičius" (items, kurių `parentId` nėra šios grupės lookup'e) kaip top-level — niekas nenukrenta. Atstato PA-005 + #8. | `apps/web/src/components/classifiers/ClassifierSelect.tsx` |
| **P2 MED** | `decision`: visus sprendimo metaduomenis (incl. decisionOrderDate, priority, procurementStage, funding*, fvmPatch) taikyti TIK paskutiniam žingsniui; tarpiniam — strip. Audit-trail komentaro `undefined` triukšmą pataisyti. + testas (tarpinis approve nepalieka šių laukų). | `apps/api/src/services/requests.service.ts`, `test/services/requests-workflow.spec.ts` |
| **P3 MED** | BudgetCategoryChart perženklinti į „Patvirtinti prašymai pagal biudžeto kategoriją" (kad tuščia pre-approval nebūtų klaidinanti); empty-state jau yra. | `apps/web/src/pages/StatistikaPage.tsx` (ar chart komponentas) |
| **P4 LOW** | `sanitizePayload`/create+update: pašalinti `priority`/`procurementStage`/`fundingFromIt`/`otherFunds`/`otherFundsSource` iš USER create/update (admin-decision-only). + testas. | `apps/api/src/services/requests.service.ts`, spec |
| **P5 LOW-MED** | Sprendimo formoje: jei spec.programa neparinkta biudžeto kategorija — užuomina prie „Sukurti FVM projektą". | `apps/web/src/pages/PrasymoDetailPage.tsx` |
| **P6 INFRA** | Test knex pool `min:1,max:1` (de-flake). | `apps/api/test/helpers/db.ts` |
| **P7 LOW** | `lib/years.ts` unit testas; `fundingSources` update catch += Objection `UniqueViolationError`. | `apps/web/src/lib/years.test.ts` (naujas), `apps/api/src/services/fundingSources.service.ts` |

## Vykdymas
Implementuojama šiame branch'e (`dev`), TDD kur taikoma, mažais commitais, pilna verifikacija (serijinis jest, abu tikri typecheck'ai, web vitest), push, CI, issue komentarai (#9, #42, #8/#6 jei aktualu).
