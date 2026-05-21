# FVM Staging Deploy Plan

> **Iter 16 (FVM-8)** — Staging deploy + Giedrės UAT before production tag X.Y.Z.

## Tikslas

Saugiai sumigruoti FVM schemą staging aplinkoje, atlikti smoke testus, gauti Giedrės UAT'ą prieš production tag'inimą.

**Apima**: 7 FVM migracijas (`20260522` → `20260527`), 1 FVM seed (`04_fvm.ts`), atnaujintus servisus (funding sources, budget allocations v2, projects, expenses, payroll, reports) ir frontend'o FVM puslapius.

**Staging URL**: https://staging-finansai.biip.lt
**Staging VM**: `10.10.6.10:8001`
**Prod URL** (po release): https://finansai.biip.lt

---

## Pre-deploy checklist

### 1. Lokali validacija

- [ ] `yarn install` praėjo be klaidų
- [ ] `yarn build` PASS (api + web + shared)
- [ ] `yarn typecheck` PASS visam workspace'ui
- [ ] `yarn test` PASS (jest backend + vitest frontend)
- [ ] `yarn workspace @biip-finansai/api db:migrate` paleistas lokaliai be klaidų
- [ ] `yarn workspace @biip-finansai/api db:seed` paleidžia visus 4 seed'us (01-04)
- [ ] `yarn workspace @biip-finansai/api tsx scripts/verify-fvm.ts` PASS
- [ ] Lokaliai paleistas `yarn dev:db && yarn dev` — UI atsidaro, login `demo`/`demo` veikia
- [ ] FVM puslapiai (`/finansavimo-saltiniai`, `/biudzetas`, `/projektai`, `/du`, `/ataskaitos`) atsidaro

### 2. Backup staging DB

```bash
# Iš biip-admin.smalsuolis.lt arba per ssh tunelį
ssh biip
psql -h localhost -p 5544 -U finansai finansai
pg_dump -h localhost -p 5544 -U finansai finansai > /backup/finansai-staging-pre-fvm-$(date +%Y%m%d-%H%M%S).sql
```

**Backup file naming**: `finansai-staging-pre-fvm-YYYYMMDD-HHMMSS.sql`. Saugomi `/backup/` direktorijoje VM.

- [ ] Backup'as sukurtas ir patikrintas dydis (>1MB)
- [ ] Backup'as restore'inamas test'iniam DB (sanity check)

### 3. Git workflow

```bash
# Lokaliai
git checkout dev
git pull origin dev
git status   # turi būti clean
git log --oneline -10   # paskutiniai commit'ai - peržiūrėt

# Merge į main (staging trigger'as)
git checkout main
git pull origin main
git merge dev --no-ff -m "FVM (Iter 9-16) → staging: migracijos + servisai + UI"
```

- [ ] `dev` branch švarus (`git status` clean)
- [ ] Visi commit'ai semantiškai sutvarkyti

### 4. CI / Secrets

- [ ] `BIIP_INFRA_DEPLOY_TOKEN` secret'as galioja
- [ ] GitHub Actions runners aktyvūs
- [ ] ghcr.io priėjimas veikia (paskutinis push'as)

---

## Deploy sequence

### A. Push į `main`

```bash
git push origin main
```

Po push'o automatiškai:

1. `finansai` repo workflow (`build-tag-push.yml`) build'ina:
   - `ghcr.io/aplinkosministerija/finansai-api:Staging`
   - `ghcr.io/aplinkosministerija/finansai:Staging`
2. Via `BIIP_INFRA_DEPLOY_TOKEN` trigger'inamas `biip-infra/deploy-environment.yml` su `environment=staging`
3. biip-infra deploy:
   - SCP'ina docker-compose ir compose override'us į `10.10.6.10`
   - `docker compose up --wait` paima naujus image'us iš ghcr.io
   - Health check'ai (default 5min)

**Stebėjimas:**

```bash
gh run watch -R AplinkosMinisterija/finansai
gh run watch -R AplinkosMinisterija/biip-infra
```

### B. Migracijos auto-run

Container start'uodamas paleidžia `db:migrate` (žr. `Dockerfile` ENTRYPOINT arba init script). Jei NE — manualus:

```bash
ssh biip
ssh deploy@10.10.6.10
cd /opt/biip/finansai
docker compose exec api yarn workspace @biip-finansai/api db:migrate
```

**FVM migracijų eilė** (knex auto-tracks per `knex_migrations` lentelę — nepaleidžia jau paleistų):

1. `20260522100000_create_fvm_foundation` — funding_sources + budget_allocations_v2 + klasifikatoriai + data migration iš senų budgets
2. `20260523100000_add_fvm_fields_to_requests` — 4 nullable kolonos requests'e
3. `20260524100000_create_projects` — projects lentelė + FK iš requests.fvm_project_id
4. `20260525100000_create_expenses` — expenses + GIN jsonb indeksas
5. `20260526100000_create_payroll` — payroll_profiles + payroll_distributions
6. `20260526200000_add_is_du_system_to_projects` — `is_du_system` flag + partial indeksas
7. `20260527100000_add_payroll_profile_to_expenses` — `payroll_profile_id` FK + backfill

Visos migracijos atomiškos (`knex.transaction`). Jei kuri fail'ina — auto-rollback, deploy fail.

### C. Verification

```bash
docker compose exec api yarn workspace @biip-finansai/api tsx scripts/verify-fvm.ts
```

**Expected output**: 6/6 PASS:

1. FVM lentelės egzistuoja
2. FVM klasifikatoriai seedinti
3. expenses.payroll_profile_id kolona
4. projects.is_du_system kolona
5. FVM endpoint'ai whitelist'e
6. FVM migracijos paleistos

Jei kuris FAIL — žr. „Rollback plan" sekciją.

### D. Optionalus FVM seed staging'e

**Atsargumas**: staging DB jau turi realių UAT duomenų (esami biudžetai, prašymai). FVM seed'as (`04_fvm.ts`) yra **idempotent** — patikrina ar `funding_sources.kodas='VB-2026-FVM'` jau egzistuoja ir praleidžia jei taip.

```bash
docker compose exec api yarn workspace @biip-finansai/api db:seed --specific=04_fvm.ts
```

**Tik jei DB švari** ar Giedrei reikia papildomų demo duomenų. Tikra UAT data turi būti rankomis sukurta per UI.

---

## Smoke test scenarios

Po deploy + verify — manualus UAT (Giedrė + Demo Admin). Visi scenarijai per UI `https://staging-finansai.biip.lt`.

### S1. AM admin login + FVM puslapiai pasiekiami

- [ ] Login `demo`/`demo` → matomas dashboard
- [ ] Sidebar rodo `Finansavimo šaltiniai`, `Biudžetas`, `Projektai`, `Darbo užmokestis`, `Ataskaitos`
- [ ] Visi 5 puslapiai atsidaro be 500 klaidų

### S2. Funding source CRUD

- [ ] Sukurti naują funding_source („Test source 2026" / kodas „TEST-2026")
- [ ] Pridėti 2 budget_allocations: DU 50k + investicijos 30k
- [ ] List rodo naują šaltinį su `metine_suma` 80k+
- [ ] Edit `pavadinimas` — pakeitimas matomas
- [ ] Delete blocked'inta (jei yra allocations) — 409 LT žinutė

### S3. Spec.programos request → projektas

- [ ] Org admin (`aad-admin`) sukuria spec.programos request'ą su `budgetCategoryId=spec_programa`
- [ ] Submit → status SUBMITTED
- [ ] AM admin (`demo`) atidaro request → mato „Sukurti FVM projektą" mygtuką (po APPROVED)
- [ ] APPROVE su decisionGrantedAmount
- [ ] Klikti „Sukurti FVM projektą" → matomas redirect į `/projektai/:id`
- [ ] Projektas turi `tipas='spec_programa'`, `requestId` užpildytas

### S4. Expense tracking + warnings

- [ ] Pridėti expense į projektą — single source
- [ ] Pridėti expense — multi-source (du fundingSourceId, suma split 50/50)
- [ ] `/projektai/:id` rodo summary (planuota / faktine / likutis)
- [ ] Pasiekus 80% biudžeto — warning ženkliuku rodomas
- [ ] Budget summary endpoint (`/expenses/budget-summary`) grąžina teisingus skaičius

### S5. DU permission gate

- [ ] Org user (`aad-user`) bandant atidaryti `/du` — redirect arba 403 LT
- [ ] Org user prie `/expenses?type=du` — sąrašas tuščias (filter'inta backend'e)
- [ ] AM admin → `/du` matomas, gali sukurti payroll_profile + distributions
- [ ] Klikti „Apskaičiuoti DU" su mėnesiu `2026-03` — sukuriami DU expense'ai
- [ ] DU expense'ai NEMATOMI org user'iui (4-sluoksnis defense)

### S6. Ataskaitos eksportas

- [ ] AM admin atidaro `/ataskaitos`
- [ ] Generuoja biudžeto vykdymo ataskaitą — .xlsx download'inamas
- [ ] Spec.programos ataskaita — .xlsx download'inamas
- [ ] DU paskirstymo ataskaita — TIK AM admin/org_admin mato tab'ą
- [ ] PDF eksportas (jei aktyvuotas) veikia

### S7. Multi-year planning

- [ ] AM admin → funding sources „Copy from year" → 2026 → 2027
- [ ] Sukuriami 2027 m. šaltinių klonai su pirmaisiais allocations

### S8. Dashboard FVM summary

- [ ] `/` dashboard'as rodo FVM kortelę (planuota / faktine / % užimta)
- [ ] Kortelė reaguoja į `year` query param'ą

---

## Rollback plan

### Trigger conditions

Rollback'inti jei:

- Bet kuri migracija fail'ino vidury sekos
- `verify-fvm.ts` FAIL po deploy'o
- Smoke test'ai pažeisti — bent vienas iš S1-S4 critical scenario fail
- Production DB performance regresija (response time > 2s)
- Giedrės UAT — kritinis bugas (gali blokuoti work flow)

### Rollback procedure

**Opcija A — Migracijos rollback (jei tik schema sulaužyta)**:

```bash
ssh biip
ssh deploy@10.10.6.10
cd /opt/biip/finansai

# Rollback vienu žingsniu (paskutinė migracija)
docker compose exec api yarn workspace @biip-finansai/api knex migrate:rollback --knexfile src/database/knexfile.ts

# Arba batch rollback (visos FVM migracijos)
# Pakartot 7 kartus arba rollback --all (atsargiai!)
for i in {1..7}; do
  docker compose exec api yarn workspace @biip-finansai/api knex migrate:rollback --knexfile src/database/knexfile.ts
done
```

**Tikrinimas**: po rollback'o `verify-fvm.ts` turi rodyti FAIL'us (lentelės dingo) — tai expected.

**Opcija B — Pilnas DB restore iš backup'o** (jei rollback per migracijas nesaugus):

```bash
ssh biip
ssh deploy@10.10.6.10

# Sustabdyt API kontainerį (kad nebūtų aktyvių connection'ų)
docker compose stop api

# Restore
pg_restore -h localhost -p 5544 -U finansai -d finansai \
  --clean --if-exists \
  /backup/finansai-staging-pre-fvm-YYYYMMDD-HHMMSS.sql

# Restart
docker compose start api
```

**Atsargumas**: tarp backup'o ir rollback'o esamos UAT atnaujinimai (jei buvo) dingsta. Tik kraštinis variantas.

**Opcija C — Code rollback (jei migracija OK, bet servisas sulaužytas)**:

```bash
# Lokaliai
git checkout main
git revert <merge-commit-sha>   # arba reset, atsižvelgiant į situaciją
git push origin main
```

Po push'o auto-deploy paims senesnę image'ą. DB lieka su nauja schema — backward compatibility tikrinama per servisus (FVM laukai requests'e visi nullable, pvz.).

### Po-rollback

- [ ] Užkomentuoti FVM puslapius UI'e (frontend env flag arba feature toggle)
- [ ] Pranešti Giedrei + visam AM team'ui
- [ ] Sukurti GitHub issue su rollback priežastimi + repro steps
- [ ] Lokaliai atkartoti problemą prieš pakartotinį push'ą

---

## Production tag (X.Y.Z) — po staging UAT PASS

**Iter 16 done criterion**: Giedrės UAT PASS → tag.

### Pre-tag checklist

- [ ] Staging UAT visi 8 smoke scenariai PASS (S1-S8)
- [ ] Giedrė explicit'iškai pasakė „taip, galima į prod"
- [ ] CHANGELOG.md atnaujintas su v0.3.0 entry
- [ ] CLAUDE.md, README.md atnaujinti
- [ ] `docs/fvm/PROGRESS.md` „Status: COMPLETED ✅"

### Tag sequence

```bash
git checkout main
git pull origin main
git log --tags --oneline -5   # paskutinis tag'as referencijai

# Bump pagal semver
# Iter 9-16 = major FVM feature → minor bump
# (pvz., paskutinis tag'as 0.2.0 → 0.3.0)
NEW_TAG="0.3.0"

# Annotated tag (su release notes)
git tag -a "$NEW_TAG" -m "FVM (Finansų valdymo modulis) — Iter 9-16
- funding_sources + budget_allocations_v2
- projects (spec.programa / projektas / veikla)
- expenses su multi-source split
- DU sluoksnis (payroll_profiles + distributions + monthly compute)
- 3 ataskaitos su xlsx + pdf eksportu
- FVM dashboard + multi-year planning
- 4-sluoksnis DU permission defense (ADR-005)
"

git push origin "$NEW_TAG"
```

Po `git push tag`:

1. `finansai` workflow build'ina `:Production` image'us
2. `biip-infra` deploy'ina į prod VM (`10.10.6.11:8000`)
3. https://finansai.biip.lt atnaujinta

**Stebėjimas**:

```bash
gh run watch -R AplinkosMinisterija/finansai
```

### Post-tag

- [ ] Smoke test'ai prod aplinkoje (sub-set iš S1-S8)
- [ ] Sentry alert'ai stebimi 24h
- [ ] Performance monitoring (response time, error rate)
- [ ] GitHub release sukurtas (su CHANGELOG.md release notes)

---

## Kontaktai (jei kažkas blogai)

- **Sistemos vystytojas**: Arūnas Smaliukas <arunas.smaliukas@gmail.com>
- **AM kontaktas**: Giedrė (per AM kontaktų sistemą)
- **Infrastructure**: `biip-infra` DevOps lead

## Versija

- v1.0 — 2026-05-22 — Pradinis snapshot (Iter 16 DevOps brief)
