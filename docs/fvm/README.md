# FVM (Finansų valdymo modulis) — dokumentacija

## Status: COMPLETED ✅

**2026-05-22 — FVM (Iter 9-16) baigta**. Visi 8 audit'ai PASS. Ship-ready v0.3.0 (production tag — po Giedrės staging UAT sign-off).

| Sritis | Final skaičius |
|---|---|
| Iteracijos | 8 (Iter 9 → Iter 16) |
| Backend testai | ~278+ (175 po Iter 12 → 256 po Iter 13 → +reports + dashboard-fvm + funding-sources-copy testai per Iter 14/15) |
| Frontend testai | ~88+ (66 po Iter 12 → 79 po Iter 13 → +reports + HomePage-fvm + CopyBudgetDialog per Iter 14/15) |
| E2E (Playwright) | Setup + pirmasis spec (`01-funding-source-flow`) startuotas; 4 papildomi journeys backlog'e |
| Naujos migracijos | 7 (foundation, requests-fvm-fields, projects, expenses, payroll, is_du_system, payroll_profile_to_expenses) |
| Naujos lentelės | 6 (funding_sources, budget_allocations, projects, expenses, payroll_profiles, payroll_distributions) |
| Naujos API service'os | 7 (fundingSources, budgetAllocations, projects, expenses, payroll, reports, dashboard FVM endpoint'ai) |
| Naujos UI puslapiai | 5 (`/finansavimo-saltiniai`, `/biudzetas` refactor, `/projektai`, `/du`, `/ataskaitos`) + HomePage FVM section |
| ADR | 5 (ADR-001..005) |

**Performance** (matuota lokaliai su seed'iniais duomenimis — staging UAT patvirtins production scale):
- `budgetSummary` endpoint'as: < 200ms (target: 500ms — ADR-002 revisit trigger'is)
- `fvmSummary` agregatinis endpoint'as: < 300ms
- xlsx eksportas (~100 eilučių): < 500ms
- pdf eksportas (~100 eilučių): < 1s (DejaVu Sans font load'inimas — pirmą kartą)

**Source of truth**: Giedrės FVM_Techninis_uzsakymas.docx v0.1 ([kopija](./spec/FVM-v0.1.md)). Visi §2-§6 reikalavimai padengti, visi F01-F16 + P01-P06 įgyvendinti.

---

## Istorinis kontekstas

2026-05-21 — Giedrė pateikė techninį užsakymą „Finansų valdymo modulis (FVM)". Šis katalogas talpina visą FVM-specific dokumentaciją: plano, architektūros sprendimų, migracijų, ADR, ir per-iteracijos detalius taskų planus.

## Failai

| Failas | Paskirtis |
|---|---|
| [00-master-plan.md](./00-master-plan.md) | 8 iteracijų roadmap'as, metodologija, audit ciklas |
| [01-architecture.md](./01-architecture.md) | Duomenų modelio sprendimai, nukrypimai nuo docx, paaiškinimai |
| [02-migration-strategy.md](./02-migration-strategy.md) | Esamų duomenų migracija (budgets/budget_allocations → naujas modelis) |
| [03-decisions-log.md](./03-decisions-log.md) | ADR-style sprendimai (kategorija = enum vs classifier ir kt.) |
| [PROGRESS.md](./PROGRESS.md) | Gyva eiga: kuri iter aktyvi, audit rezultatai, kas toliau |
| [spec/FVM-v0.1.md](./spec/FVM-v0.1.md) | Giedrės docx pandoc-konvertuota markdown kopija (source of truth) |
| `iter-NN-*.md` | Per-iteracijos detalūs taskų planai (rašomi just-in-time) |

## Source of truth

Giedrės **FVM_Techninis_uzsakymas.docx** v0.1 yra galutinis specifikacijos šaltinis. Kai kyla konfliktas tarp šio katalogo turinio ir docx — laimi docx, **nebent** nukrypimas užfiksuotas `03-decisions-log.md` (su pagrindimu).

## Mūsų scope'as (issue #9 sprendimas)

- **Biudžeto modelis**: A — vienas bendras AM biudžetas su skaidymu (ne atskirai pagal departamentą)
- **Aprobacijos grandinė**: daugiapakopė (teikia → paraiškų admin → kancleris/DBSIS), nors šiame etape default = 1 žingsnis. Schema palaiko N.
- **App apimtis**: AAD šiame etape, bet duomenų modelis universalus (tinka visai AM)

## Mūsų komandos sudėtis (per iteracijas keičiasi)

Per iteraciją CTO sudaro komandą iš subagent'ų:
- **Backend Engineer** — Moleculer.js + Knex/Objection + TypeScript
- **Frontend Engineer** — React 18 + Vite + Tailwind + shadcn/ui
- **DBA / Migrations** — PostgreSQL schema, migracijos, data integrity
- **QA Engineer** — Jest (backend), Vitest+RTL (frontend), Playwright (E2E)
- **Security Reviewer** — ypač Iter 13 (DU) ir bendram permission audit'ui
- **UX Reviewer** — wireframes, accessibility, vartotojo flow
- **Independent Auditor** — atskiras subagentas po komandos darbo, tikrina vs spec ir audit kriterijus

CTO (aš) — orkestruoja, peržiūri, sprendžia, laisvalaikiu rašo architektūrinius dokumentus.
