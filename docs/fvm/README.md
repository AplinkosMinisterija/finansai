# FVM (Finansų valdymo modulis) — dokumentacija

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
