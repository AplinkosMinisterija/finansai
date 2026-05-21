# FVM Architektūra — duomenų modelis ir sprendimai

## Tikslas

Šis dokumentas paaiškina **kaip** docx'o §2 (Finansų hierarchijos modelis) ir §6 (Duomenų modelis) yra įgyvendinami `finansai` sistemoje, kur nukrypstama nuo docx'o ir kodėl.

Skaitykite kartu su:
- [spec/FVM-v0.1.md](./spec/FVM-v0.1.md) §2, §6 — Giedrės originalas
- [03-decisions-log.md](./03-decisions-log.md) — ADR-style nukrypimų log

## 3 lygių hierarchija

Docx (§2) apibrėžia trijų lygių finansų piramidę. Mes ją realizuojam tiksliai pagal docx, su mažais patikslinimais žemiau.

```
┌─────────────────────────────────────────────────┐
│ 1 lygis: funding_sources                        │
│   "Iš kur pinigai?"                             │
│   Pvz.: Valstybės biudžetas 2026 (1.5M €)      │
└────────────────────┬────────────────────────────┘
                     │ 1:N
                     ▼
┌─────────────────────────────────────────────────┐
│ 2 lygis: budget_allocations                     │
│   "Kam skiriama?"                                │
│   Pvz.: DU 500k, Spec.programa A 200k, P&P 800k│
└────────────────────┬────────────────────────────┘
                     │ 1:N
                     ▼
┌─────────────────────────────────────────────────┐
│ 3 lygis: projects                                │
│   "Kas konkrečiai išleidžia?"                   │
│   Pvz.: IT modernizavimas, Mokymai 2026, ...    │
└────────────────────┬────────────────────────────┘
                     │ 1:N
                     ▼
┌─────────────────────────────────────────────────┐
│ Faktinės išlaidos: expenses                      │
│   project + budget_allocation + suma + data      │
└──────────────────────────────────────────────────┘

DU side track:
  payroll_profiles ──N:1── users
       │
       │ 1:N
       ▼
  payroll_distributions ──N:1── funding_sources
  (kas mėnesį generuojami expenses per DU)
```

## Lentelės — galutinis dizainas

### funding_sources (§6.1 docx + tikslinimas)

```sql
CREATE TABLE funding_sources (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  pavadinimas         varchar(200) NOT NULL,
  kodas               varchar(50) NOT NULL,
  -- Docx siūlo enum, mes naudojam klasifikatorių (ADR-001)
  tipas_classifier_item_id  uuid NOT NULL REFERENCES classifier_items(id),
  metai               integer NOT NULL,
  metine_suma         decimal(15, 2) NOT NULL,
  aprasymas           text,
  aktyvus             boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kodas, metai)
);
CREATE INDEX idx_funding_sources_tenant_year ON funding_sources (tenant_id, metai);
```

**Nukrypimas nuo docx**:
- `tipas` per klasifikatorių (ne enum) — žr. ADR-001
- Unique constraint apima `metai` — leidžia tą patį šaltinį turėti per kelis metus

### budget_allocations (§6.2 docx + tikslinimas)

```sql
CREATE TABLE budget_allocations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funding_source_id           uuid NOT NULL REFERENCES funding_sources(id) ON DELETE RESTRICT,
  -- Docx siūlo enum kategorija, mes naudojam klasifikatorių (ADR-001)
  category_classifier_item_id uuid NOT NULL REFERENCES classifier_items(id),
  pavadinimas                 varchar(200) NOT NULL,
  -- Tik spec.programoms (kai kategorija = spec_programa)
  spec_prog_tipas             varchar(20) CHECK (spec_prog_tipas IN ('atskiras', 'biudzeto_dalis')),
  planuota_suma               decimal(15, 2) NOT NULL,
  metai                       integer NOT NULL,
  pastabos                    text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_budget_allocations_source ON budget_allocations (funding_source_id);
CREATE INDEX idx_budget_allocations_year ON budget_allocations (metai);
```

**Migration iš esamos `budget_allocations`**: žr. [02-migration-strategy.md](./02-migration-strategy.md).

### projects (§6.3 docx)

```sql
CREATE TABLE projects (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id),
  budget_allocation_id        uuid NOT NULL REFERENCES budget_allocations(id) ON DELETE RESTRICT,
  request_id                  uuid REFERENCES requests(id), -- NULL jei ne spec.programa
  pavadinimas                 varchar(300) NOT NULL,
  tipas                       varchar(20) NOT NULL CHECK (tipas IN ('projektas', 'spec_programa', 'veikla')),
  biudzetas                   decimal(15, 2) NOT NULL,
  pradzios_data               date,
  pabaigos_data               date,
  statusas                    varchar(20) NOT NULL DEFAULT 'planuojama'
                              CHECK (statusas IN ('planuojama', 'vykdoma', 'baigta', 'uzdaryta')),
  atsakingas_user_id          uuid REFERENCES users(id),
  aprasymas                   text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_tenant ON projects (tenant_id);
CREATE INDEX idx_projects_allocation ON projects (budget_allocation_id);
CREATE INDEX idx_projects_request ON projects (request_id);
CREATE INDEX idx_projects_status ON projects (statusas);
```

### expenses (§6.4 docx)

```sql
CREATE TABLE expenses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  budget_allocation_id uuid NOT NULL REFERENCES budget_allocations(id) ON DELETE RESTRICT,
  tipas                varchar(20) NOT NULL CHECK (tipas IN ('du', 'sutartis', 'saskaita', 'tiesiogine')),
  suma                 decimal(15, 2) NOT NULL,
  data                 date NOT NULL,
  aprasymas            varchar(500),
  -- multi-source distribution: [{ "funding_source_id": "...", "suma": 600.00 }, ...]
  -- NULL jei išlaida vieno šaltinio (default: budget_allocation.funding_source_id)
  saltinio_dalis       jsonb,
  created_by_user_id   uuid NOT NULL REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_project ON expenses (project_id);
CREATE INDEX idx_expenses_allocation ON expenses (budget_allocation_id);
CREATE INDEX idx_expenses_date ON expenses (data);
```

**Sprendimas dėl jsonb vs junction table** (atsakymas į docx §8 klausimą):
- Pradiniam release — **jsonb**. Pranašumai: paprasta, mažiau query'ų, palaiko ne-fiksuoto skaičiaus splits.
- Trūkumas: sunkesnės SQL agregacijos per šaltinį.
- **Mitigation**: budget summary endpoint'ai naudoja Knex/Objection `jsonb_array_elements` query (PostgreSQL native).
- Jei performance bus issue — Iter 16+ galim migruoti į `expense_distributions` lentelę. ADR-002 reservuotas.

### payroll_profiles (§6.5 docx)

```sql
CREATE TABLE payroll_profiles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  user_id           uuid REFERENCES users(id), -- gali būti NULL jei darbuotojas nėra sistemos vartotojas
  vardas_pavarde    varchar(200) NOT NULL, -- jei user_id NULL, redundant copy
  pareigos          varchar(200) NOT NULL,
  sutarties_tipas   varchar(20) NOT NULL CHECK (sutarties_tipas IN ('darbo', 'paslaugu', 'autorine')),
  atlyginimas_bruto decimal(10, 2) NOT NULL,
  priedai           decimal(10, 2) NOT NULL DEFAULT 0,
  galioja_nuo       date NOT NULL,
  galioja_iki       date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payroll_profiles_tenant ON payroll_profiles (tenant_id);
CREATE INDEX idx_payroll_profiles_user ON payroll_profiles (user_id);
```

**Nukrypimas**: pridėtas `vardas_pavarde` lauks — leidžia turėti darbuotoją be `users` įrašo (pvz., paslaugų sutartis su trečiąja šalimi).

### payroll_distributions (§6.6 docx)

```sql
CREATE TABLE payroll_distributions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_profile_id  uuid NOT NULL REFERENCES payroll_profiles(id) ON DELETE CASCADE,
  funding_source_id   uuid NOT NULL REFERENCES funding_sources(id) ON DELETE RESTRICT,
  paskirstymo_tipas   varchar(20) NOT NULL CHECK (paskirstymo_tipas IN ('procentais', 'fiksuota')),
  reiksme             decimal(10, 4) NOT NULL, -- % (0-100) arba fiksuota suma €
  galioja_nuo         date NOT NULL,
  galioja_iki         date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payroll_distributions_profile ON payroll_distributions (payroll_profile_id);
CREATE INDEX idx_payroll_distributions_source ON payroll_distributions (funding_source_id);
```

**Constraint**: `SUM(reiksme) WHERE paskirstymo_tipas = 'procentais' GROUP BY profile + galioja periodas` turi būti 100%. Tikrinama servise (ne DB CHECK, nes per-row CHECK negali).

### requests papildomi laukai (Iter 10)

```sql
ALTER TABLE requests ADD COLUMN budget_category_id uuid REFERENCES classifier_items(id);
ALTER TABLE requests ADD COLUMN funding_source_type_id uuid REFERENCES classifier_items(id);
ALTER TABLE requests ADD COLUMN spec_program_funding_type varchar(20)
  CHECK (spec_program_funding_type IN ('atskiras', 'biudzeto_dalis'));
ALTER TABLE requests ADD COLUMN fvm_project_id uuid REFERENCES projects(id);
```

**Pastaba**: `approved_amount` jau egzistuoja kaip `decision_granted_amount`. Nereikia naujo lauko.

## API contract overview

Detalūs OpenAPI specai bus generuojami iš Moleculer servisų. Pagrindinės grupės:

### /api/funding-sources (Iter 9)
- `GET /` — sąrašas (filter: year, tenant, type)
- `GET /:id` — vienas
- `POST /` — kurti (AM admin)
- `PATCH /:id` — atnaujinti (AM admin)
- `DELETE /:id` — soft delete (AM admin, tik jei nėra rišamų allocations)

### /api/budget-allocations (Iter 9)
- `GET /` — sąrašas (filter: funding_source_id, year, category)
- `GET /:id`
- `POST /`
- `PATCH /:id`
- `DELETE /:id` — tik jei nėra projects ar expenses
- `GET /:id/summary` — planuota / faktinė / likutis (vienam allocation)

### /api/projects (Iter 11)
- `GET /` — sąrašas
- `GET /:id`
- `POST /` — kurti rankiniu būdu (non-spec-programa)
- `POST /from-request/:requestId` — auto-create iš patvirtinto prašymo
- `PATCH /:id`
- `PATCH /:id/status` — status transitions
- `GET /:id/summary` — biudžetas / panaudota / likutis

### /api/expenses (Iter 12)
- `GET /` — sąrašas (filter: project, allocation, date range)
- `POST /` — pridėti išlaidą (auto-reduce allocation likutis)
- `PATCH /:id`
- `DELETE /:id` — su biudžeto re-calc
- `GET /budget-summary?year=...` — pilna vykdymo suvestinė

### /api/payroll-profiles, /api/payroll-distributions (Iter 13)
- Standartinis CRUD su **strict permission gates** (AM admin + institucijos vadovas)
- `POST /payroll/compute?month=2026-06` — mėnesinis recompute (idempotentiškas)

### /api/reports (Iter 14)
- `GET /budget-execution?year=...&format=json|xlsx|pdf`
- `GET /spec-programs?year=...&format=...`
- `GET /payroll-distribution?from=...&to=...&format=...`

## Permission modelis

| Rolė | Endpoint'ai | Apribojimai |
|---|---|---|
| AM admin (`admin` + AM tenant) | Visi | Pilna prieiga |
| AM specialist (`user` + AM tenant) | Read visi FVM + write savo scope orgs prašymams | Negali kurti funding_sources |
| Org admin (`admin` + org tenant) | Read savo tenant duomenis + write savo tenant projects/expenses + read savo tenant payroll | NEGALI matyti kitų organizacijų DU |
| Org user (`user` + org tenant) | Read savo tenant + write savo tenant expenses | NEGALI matyti payroll (net savo) |

**DU specialus apsauga (per Iter 13)**:
- `payroll_profiles` ir `payroll_distributions` endpoint'ai ENFORCE'ina tenant_id match per session user
- Specialistas NEMATO net savo profilio (per docx §4.4 „Specialistas savo duomenų nemato")
- Frontend route gates + backend tenant scoping (2 sluoksniai)

## Konfigūracija

Naujos sistemos konfigūracijos (Iter 12 įveda):

| Settings key | Default | Paskirtis |
|---|---|---|
| `fvm.warning_threshold_percent` | 80 | Kai allocation panaudojimas > X% — warning UI |
| `fvm.auto_create_spec_program_project` | false | Ar AM approval iš karto kuria projekto įrašą, ar tik per mygtuką |
| `fvm.payroll_compute_day_of_month` | 1 | Kuriai dieną cron'as paleidžia mėnesinį DU recompute |

Settings saugomi `app_settings` lentelėje (sukurta Iter 9, jei dar nėra).

## Frontend struktūra

```
apps/web/src/
├── pages/
│   ├── FinansavimoSaltiniaiPage.tsx       (Iter 9)
│   ├── BiudzetasPage.tsx                  (Iter 9 — refactor)
│   ├── ProjektaiPage.tsx                  (Iter 11)
│   ├── ProjektoDetailPage.tsx             (Iter 11)
│   ├── IslaidosPage.tsx                   (Iter 12 — gali būti tab projekto detale)
│   ├── DuPage.tsx                         (Iter 13)
│   ├── AtaskaitosPage.tsx                 (Iter 14)
│   └── FvmDashboardPage.tsx               (Iter 15 — gali būti HomePage tab)
├── components/
│   ├── funding-sources/
│   ├── budget-allocations/
│   ├── projects/
│   ├── expenses/
│   ├── payroll/                            (Iter 13 — permission-gated)
│   └── reports/
└── lib/
    ├── permissions.ts                      (extended Iter 13)
    └── fvm.ts                              (helpers: format, calculate)
```

## Testavimo strategija

Pagal CLAUDE.md: bent vienas integration testas per feature. Per FVM:

**Backend (Jest)**:
- Funding sources CRUD + permission tests (Iter 9)
- Budget allocation lifecycle (Iter 9)
- Project auto-create from approval (Iter 11)
- Expense distribution + budget remainder math (Iter 12)
- Payroll permission penetration tests (Iter 13 — critical)
- Report generation correctness (Iter 14)

**Frontend (Vitest + RTL)**:
- Wizard biudžeto step (Iter 10)
- Project create flow (Iter 11)
- Multi-source expense form (Iter 12)
- Payroll page permission gate rendering (Iter 13)

**E2E (Playwright, Iter 16)**: 5 critical user journeys per master-plan.

## Performance ir scale prielaidos

Atsakymai į docx §8 klausimus:

1. **Auto-create spec programa**: nei eventais, nei tiesioginiu servisų ryšiu — per `request.approve` handler'į, kuris sinchroniškai sukuria `project` įrašą tame pačiame DB transaction'e. Atomic ir paprasta. Iter 11.

2. **jsonb saltinio_dalis vs junction**: jsonb pradžiai (žr. expenses §). Junction reservuota ADR-002 jei reikės.

3. **Biudžeto likučio testavimas didelis išlaidų kiekiu**: Iter 12 Jest integration test'as su 10k expenses scenarijumi. Iter 16 Playwright + DB seed su realistic prod-like data.

4. **Payroll mokesčiai (Sodra)**: docx neaiškiai apibrėžia. **Sprendimas**: pradžiai tik bruto (kaip docx siūlo §4.4). Mokesčių apskaita — atskira fazė, jei pareikalaus. ADR-003.

## Aplinka ir infrastruktūra

- DB: PostgreSQL (jau yra)
- Cache: Redis (jau yra, naudojam sessions ir worker queue jei reikės payroll cron)
- Cron: pradžioje Moleculer scheduler arba pg_cron. Iter 13.
- File storage: kaip iki šiol (base64 in DB, max 5MB). FVM nereikalauja naujų files.

## Versija ir naujinimai

- v1.0 — 2026-05-21 — Pradinis architektūros snapshot (CTO Claude).
- Per kiekvieną iter — atnaujinama, jei keičiasi schema/decisions. Diff'us nurodyti ADR-NN.
