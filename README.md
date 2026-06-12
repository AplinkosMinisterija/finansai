# Finansai — AM finansavimo prašymų sistema + FVM

Aplinkos ministerijos vidinė web aplikacija finansavimo prašymams teikti ir tvirtinti **bei pilnam finansų valdymui** (FVM — Finansų valdymo modulis). Pakeičia anksčiau naudotą SharePoint įrankį ir Excel'ius.

## TL;DR

- **AM** = tvirtintojas (admin + user su scope per organizacijas)
- **Pavaldžios institucijos** (AAD, VSTT, LGT, …) = teikėjai (admin + user)
- **Prašymų workflow**: submitter teikia → AM tvirtina / atmeta / grąžina pataisymui → ping-pong kol patvirtinta
- **FVM**: 3 lygių finansų hierarchija (šaltiniai → biudžetas → projektai → išlaidos), DU sluoksnis, ataskaitos su Excel/PDF eksportu, FVM dashboard, multi-year planning
- **Aplinkos**: [dev-finansai.biip.lt](https://dev-finansai.biip.lt), [staging-finansai.biip.lt](https://staging-finansai.biip.lt), [finansai.biip.lt](https://finansai.biip.lt) (kol kas redirect → staging)
- **Docs**: [/docs/](https://dev-finansai.biip.lt/docs/)

Detalė — žr. [docs/01-kontekstas.md](docs/01-kontekstas.md), [docs/06-implementacijos-planas.md](docs/06-implementacijos-planas.md) ir [docs/fvm/README.md](docs/fvm/README.md).

## Funkcionalumas

### MVP (Iter 0-8) ✅

- Vartotojų valdymas: AM admin/user + organizacijų admin/user, scope per organizacijas
- Organizacijų valdymas: AM admin pilnai valdo tenant'us (AAD, VSTT, LGT, …)
- Prašymo wizard'as: 6 žingsnių multi-step forma su auto-save (po Iter 10 — pridėtas „Biudžetas" žingsnis)
- Tvirtinimo flow: AM tvirtina / atmeta / grąžina pataisymui; ping-pong su komentarais
- Klasifikatoriai: AM admin pridėjus naują klasifikatoriaus įrašą — pasirenkamas dropdown'uose be deploy
- Statistika su grafikais: monthly trend, status pie, per-tenant bar charts (recharts)

### FVM (Iter 9-16) ✅

- **Finansavimo šaltiniai** (1 lygis): metinė suma, tipas per klasifikatorių, per tenant
- **Biudžeto paskirstymas** (2 lygis): per kategorijas (DU, spec.programa, prekės/paslaugos, investicijos, kita), spec.programų subtipai (atskiras / biudžeto dalis)
- **Projektai** (3 lygis): tipai (projektas / spec.programa / veikla), lifecycle (planuojama → vykdoma → baigta → uždaryta), auto-create iš patvirtinto spec.programa prašymo
- **Išlaidos**: multi-source split per `saltinio_dalis jsonb`, realus likutis per SUM(expenses), 80% warning threshold (env konfigūruojamas)
- **DU (payroll)**: `payroll_profiles` + `payroll_distributions` + monthly compute. **STRICT permissions** — specialistas DU duomenų nemato (ADR-005)
- **Ataskaitos**: 3 šablonai (biudžeto vykdymas, spec.programų vykdymas, DU paskirstymas) + Excel (.xlsx) + PDF eksportas su LT diakritiniais
- **FVM dashboard**: biudžeto suvestinė + top warnings + artėjantys terminai (next 30d)
- **Multi-year planning**: F16 — kopijavimas iš praėjusių metų į kitus

### AI generatyvinis dashboard'as (Iter 17, eksperimentinis) 🧪

„Pradžia (AI)" (`/`) — dinaminė widget drobė + AI chat panelė (CopilotKit „Generative UI"
pattern'as). Asistentas (qwen3.6 per `LLM_BASE_URL` OpenAI-compatible endpoint'ą) surenka
realius duomenis per vidinius action'us (ADR-005 teisės galioja) ir perpiešia vaizdą pagal
lietuvišką prašymą. Klasikinė pradžia — `/pradzia`. Be `LLM_BASE_URL` chat'as grąžina 503,
pradinis vaizdas veikia. Architektūra — `docs/diskusijos.md` (2026-06-12 įrašas).

**Žinomas ribotumas — AI vaizdo duomenys yra momentinė nuotrauka.** Modelis įrašo
skaičius tiesiai į widget spec'ą kaip literalias reikšmes, o paskutinis vaizdas
persistuojamas localStorage (per vartotoją). Po perkrovimo grįžta išsaugotas vaizdas
su **generavimo metu buvusiais** skaičiais — jie iš DB NEatsinaujina. Šviežius duomenis
visada rodo tik pradinis vaizdas (mygtukas „Pradinis vaizdas" — serveris perskaičiuoja
iš DB kiekvieną kartą) arba naujas prašymas chat'e. Jei AI vaizdams reikės gyvų duomenų,
keliai (nedaryta): (1) „Atnaujinti duomenis" mygtukas — LLM perpiešia tą patį layout'ą
šviežiais skaičiais; (2) spec'e vietoj literalių reikšmių laikyti duomenų nuorodas
(pvz. `{source: "islaidos_pagal_menesi", year}`), kurias serveris hidruoja kiekvieno
užkrovimo metu — layout'as iš AI, duomenys visada iš DB; (3) persistuoto vaizdo TTL
(pvz. iki paros pabaigos, po to — default).

## Kur dabar esam

- ✅ **Iter 0** — bootstrap: repo, deploy pipeline, blank shell, sesijos auth, demo account
- ✅ **Iter 1** — auth, tenants, vartotojai
- ✅ **Iter 2** — prašymo schema + API
- ✅ **Iter 3** — prašymo teikimo wizard'as
- ✅ **Iter 4** — tvirtinimo flow + ping-pong
- ✅ **Iter 5** — docsai, testai, polish
- ✅ **Iter 6** — rolių modelio supaprastinimas + UI polish
- ✅ **Iter 7** — organizacijų valdymas (UI)
- ✅ **Iter 8** — statistika su grafikais
- ✅ **Iter 9** — FVM-1: finansavimo šaltiniai + biudžeto paskirstymas
- ✅ **Iter 10** — FVM-2: Stream 1 — prašymo modelio integracija
- ✅ **Iter 11** — FVM-3: projektai (3 lygis) + auto-create
- ✅ **Iter 12** — FVM-4: išlaidos + likutis + warnings
- ✅ **Iter 13** — FVM-5: payroll (DU) + 2 saugumo fix'ai (ADR-005)
- ✅ **Iter 14** — FVM-6: ataskaitos + Excel/PDF eksportas
- ✅ **Iter 15** — FVM-7: FVM dashboard + multi-year planning
- ✅ **Iter 16** — FVM-8: E2E setup, demo data refresh, dokumentacija ship-ready (production tag — po Giedrės staging UAT)
- 🧪 **Iter 17** — AI generatyvinis dashboard'as (eksperimentinis): „Pradžia (AI)" + chat, deploy'inta į dev

**MVP + FVM ready**. Detalė — [docs/06-implementacijos-planas.md](docs/06-implementacijos-planas.md), FVM eiga — [docs/fvm/PROGRESS.md](docs/fvm/PROGRESS.md).

## Local dev

```bash
yarn install
yarn dev:db        # paleidžia postgres + redis (docker)
yarn dev           # paleidžia api (3000), web (5173), docs (5174)
```

Atskirai galima:

```bash
yarn dev:api       # tik backend
yarn dev:web       # tik frontend
yarn dev:docs      # tik dokumentacija
```

Demo prisijungimas: `demo` / `demo`. Papildomi demo accounts (AM admin/user, AAD/VSTT/LGT admin/user) — `pwd=demo`, žr. `apps/api/src/database/seeds/01_initial.ts`. FVM datą realiai padengia `04_fvm.ts` seed'as (Iter 16).

## Tech stack

**Backend** (`apps/api/`):
- Moleculer.js (microservices framework) + TypeScript
- Knex.js (migracijos) + Objection.js (modeliai)
- PostgreSQL + Redis (sessions/cache)
- **exceljs** (.xlsx eksportas — FVM ataskaitos)
- **pdfkit** (PDF eksportas — FVM ataskaitos, LT diakritiniai per unicode font)
- bcryptjs (slaptažodžių hash'inimas)
- Jest (testai)

**Frontend** (`apps/web/`):
- React 18 + TypeScript + Vite
- Tailwind CSS + shadcn/ui + lucide-react (ikonos)
- @tanstack/react-query (data fetching)
- react-router-dom + react-hook-form + zod
- recharts (statistikos grafikai)
- Caddy (in-container reverse proxy)
- Vitest + RTL (testai)

**E2E** (Playwright): setup + pirmasis spec (`apps/e2e/tests/01-funding-source-flow.spec.ts`) startuotas Iter 16; likę 4 user journeys backlog'e. Paleisti: `cd apps/e2e && yarn test` (arba root `yarn test`).

**Dokumentacija** (`docs/`): VitePress.

## Struktūra

```
finansai/
├── README.md                       ← šis failas
├── CLAUDE.md                       ← Claude'o onboarding + workflow taisyklės
├── CHANGELOG.md                    ← versijos changelog
├── apps/
│   ├── api/                        Moleculer.js + TS + (Knex+Objection+Postgres)
│   │   ├── src/services/           api/auth/tenants/users/requests + FVM (fundingSources/budgetAllocations/projects/expenses/payroll/reports/dashboard)
│   │   ├── src/database/           migrations + seeds
│   │   ├── src/utils/reports/      xlsx.ts + pdf.ts (exceljs + pdfkit)
│   │   ├── Dockerfile              produces ghcr.io/.../finansai-api:<Env>
│   │   └── package.json
│   ├── web/                        React 18 + Vite + Tailwind + shadcn/ui
│   │   ├── src/                    main.tsx, App.tsx, pages/, components/, lib/
│   │   ├── caddy/Caddyfile         in-container Caddy: /api → finansai-api, /docs → docs, / → SPA
│   │   ├── Dockerfile              produces ghcr.io/.../finansai:<Env>
│   │   └── package.json
│   └── e2e/                        Playwright E2E (Iter 16)
├── packages/
│   └── shared/                     TS tipai dalinami tarp api ir web (incl. FVM types: reports.ts, fvm.ts)
├── docs/                           VitePress source ir decision log
│   ├── .vitepress/config.ts        sidebar, theme
│   ├── index.md
│   ├── 01..06-*.md                 architektūra, sprendimai, planas
│   ├── fvm/                        FVM modulio dokumentacija (master plan, ADR, per-iter brief'ai)
│   └── diskusijos.md               diskusijų log
├── docker-compose.yml              local dev: postgres + redis
├── package.json                    yarn workspaces root
└── .github/workflows/              deploy-{development,staging,production}.yml
```

## Deploy

Vieno žmogaus dev modelis — Claude pati commit'ina ir deploy'ina.

| Branch / Tag | Aplinka     | URL                              | Trigger          |
| ------------ | ----------- | -------------------------------- | ---------------- |
| `dev`        | Development | https://dev-finansai.biip.lt     | push į `dev`     |
| `main`       | Staging     | https://staging-finansai.biip.lt | push į `main`    |
| tag `X.Y.Z`  | Production  | https://finansai.biip.lt         | tag push         |

### Tipinis flow'as

**„Pakeisk šitą dalyką":**
> Claude commit'ina į `dev`, push'ina, palaukia finansai build, trigerina biip-infra Development deploy → atnaujina `dev-finansai.biip.lt`.

**„Paleisk į staging":**
> Claude merge'ina `dev` → `main`, push'ina, palaukia staging build, trigerina biip-infra Staging deploy → atnaujina `staging-finansai.biip.lt`.

**„Paleisk į production":**
> Claude pasako, kas pasikeitė nuo paskutinio tag'o, pasiūlo semver bump'ą (patch/minor/major). Po patvirtinimo — sukuria tag, push'ina, trigerina prod deploy.

Detali specifikacija — [CLAUDE.md](CLAUDE.md) sekcijoj „Git ir deploy susitarimas".

## Kontaktai

- **Sukūrė:** Arūnas Smaliukas
- **AM GitHub organizacija:** [github.com/AplinkosMinisterija](https://github.com/AplinkosMinisterija)
