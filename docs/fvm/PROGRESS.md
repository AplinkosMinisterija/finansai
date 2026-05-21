# FVM eiga (live)

**Last update**: 2026-05-21 (CTO Claude)

## Statusas

🟡 **Planavimas**. Master plan, architektūra, migracijos strategija ir ADR'ai užrašyti. Laukiu vartotojo sign-off pradėti Iter 9 (FVM-1).

## Iteracijų statusas

| Iter | Pavadinimas | Status | Brief | Audit | Push'inta |
|---|---|---|---|---|---|
| 9 (FVM-1) | Foundation: funding_sources + budget_allocations | ⏸️ pending sign-off | — | — | — |
| 10 (FVM-2) | Stream 1: Request integration | ⏸️ | — | — | — |
| 11 (FVM-3) | Projects + auto-create | ⏸️ | — | — | — |
| 12 (FVM-4) | Expenses + budget remainder | ⏸️ | — | — | — |
| 13 (FVM-5) | Payroll (DU) | ⏸️ | — | — | — |
| 14 (FVM-6) | Reports + Excel/PDF | ⏸️ | — | — | — |
| 15 (FVM-7) | Dashboard + multi-year | ⏸️ | — | — | — |
| 16 (FVM-8) | E2E + Staging + Prod | ⏸️ | — | — | — |

Legend: ⏸️ pending • 🟡 in progress • 🟢 done • 🔴 blocked/failing audit

## Atviri klausimai

- **ADR-001 sign-off**: ar Giedrė sutinka su klasifikatorius vs enum sprendimu? Iter 9 staging UAT — galim parodyti. Jei ne — migracija į enum.
- **ADR-003**: payroll mokesčiai (Sodra/GPM) — Iter 13. Jei staging UAT metu Giedrė prašys — pridėti į Iter 13 scope, pratęsti iter trukmę.

## Diff vs originalus plano timeline

Originalas: 8 iter × ~1.5 sav = 12 sav. (~3 mėn)

Realybės adjustments tracking — atnaujinama po kiekvieno iter.

## Veiklos log

### 2026-05-21
- CTO Claude perėmė vadovavimą (vartotojo prašymu).
- Perskaityta `FVM_Techninis_uzsakymas.docx` (Giedrės v0.1).
- Atliktas gap analysis vs esama app būklė (Iter 0-8 baigti).
- Susidaryta 8 iteracijų roadmap, master plan, architektūra, migracijos strategija, ADR-001/002/003.
- Komentarų docx'e nerasta (peržiūrėtas comments.xml + tracked changes — abu tušti). User patvirtino: docx tekstas = naujausia spec, jis pats yra „komentaras".
