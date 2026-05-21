# @biip-finansai/e2e — Playwright E2E testai

End-to-end testų suite'as FVM (Iter 16) — dengia 5 kritinius user journey'us
naudojant Playwright + Chromium prieš lokalų dev environment.

## Kas dengiama

| # | Failas | Journey |
|---|---|---|
| 1 | `tests/01-funding-source-flow.spec.ts` | AM admin sukuria finansavimo šaltinį → kortelė matosi sąraše |
| 2 | `tests/02-spec-program-flow.spec.ts` | Org admin pateikia spec.programa prašymą → AM patvirtina → „Sukurti FVM projektą" → projekto detalė matoma |
| 3 | `tests/03-expense-tracking.spec.ts` | AM admin sukuria projektą → pridėja išlaidą per UI → biudžeto likutis sumažėja |
| 4 | `tests/04-payroll-permission.spec.ts` | Org specialistas negali pasiekti `/du` (redirect) ir nemato DU ataskaitų tab'o (defense-in-depth) |
| 5 | `tests/05-annual-report.spec.ts` | AM admin atsisiunčia biudžeto vykdymo Excel — failas validus xlsx (ZIP magic bytes) |

Visi testai naudoja LT UI tekstą per `data-testid` (kur yra) arba role/text
matchers (kur stabiliau).

## Prielaidos

### 1. Dev aplinka turi būti paleista

**Trys procesai** turi veikti **prieš** paleidžiant testus:

```bash
# Terminal 1 — DB
yarn dev:db                # docker compose: postgres (5433) + redis (6380)

# Terminal 2 — API
yarn dev:api               # http://localhost:3000

# Terminal 3 — Web
yarn dev:web               # http://localhost:5173 (su proxy /api → :3000)
```

> Galima leisti viską viename terminale per `yarn dev`, bet tada DB nebus
> automatiškai pakeltas — paleisk `yarn dev:db` atskirai pirma.

### 2. DB turi būti su seed'u

```bash
cd apps/api
yarn db:migrate            # užtikrinti, kad visos migracijos pritaikytos
yarn db:seed               # įdėti tenants, users, klasifikatorius, demo prašymus
```

> Pastaba: dabartinis `02_classifiers_and_budget.ts` seed'as truncatina
> visas klasifikatorių grupes, todėl FVM klasifikatorius (`funding_source_type`,
> `budget_category`) reikia atstatyti po seed'o. Tai daro **automatiškai**
> `tests/global-setup.ts` — pridėdamas grupes ir items per API endpoint'us
> jei jų nėra. Vis tiek seed turi būti įvykdytas — bent dėl users/tenants.

### 3. Lokalus `.env` (apps/api)

```env
DB_CONNECTION=postgresql://finansai:finansai@localhost:5433/finansai
REDIS_URL=redis://localhost:6380
PORT=3000
NAMESPACE=finansai
LOGLEVEL=info
AUTO_MIGRATE=true
SESSION_COOKIE_SECURE=false
```

### 4. Chromium įdiegtas

```bash
npx playwright install chromium
```

Jei nesidiegia (pvz., Arch'e — „OS not officially supported"), naudojama
fallback Ubuntu 24.04 build versija. Veikia visapusiškai.

## Paleidimas

Iš **projekto šaknies** (rekomenduojama):

```bash
yarn e2e                   # headless, list reporter
yarn e2e:headed            # headed mode (matom browser)
yarn e2e:ui                # Playwright UI mode (interaktyvi debug)
```

Iš `apps/e2e/`:

```bash
npx playwright test                         # visi
npx playwright test 01-funding-source-flow  # vienas failas
npx playwright test --reporter=list         # verbose
npx playwright test --debug                 # step-by-step
```

## Konfigūracija

- `playwright.config.ts` — chromium projektas, baseURL `http://localhost:5173`,
  Europe/Vilnius timezone, `lt-LT` locale.
- `fullyParallel: false` + `workers: 1` — testai dalinasi DB, nelygiagretiname,
  kad neliktų race condition'ų.
- `trace: 'retain-on-failure'` + `screenshot: 'only-on-failure'` — debug'inant
  paleisk `npx playwright show-trace test-results/<test>/trace.zip`.

## Helper'iai

| Failas | Paskirtis |
|---|---|
| `tests/helpers/auth.ts` | `loginViaApi`, `loginViaUi`, `logout` + `ACCOUNTS` mapas |
| `tests/helpers/api.ts` | `apiGet`, `apiPost`, `apiPatch`, `apiPut`, `apiDelete`, `uniqueSuffix` |
| `tests/helpers/db-setup.ts` | `ensureFvmClassifiers` — pripildo FVM klasifikatorius per API |
| `tests/global-setup.ts` | Playwright `globalSetup` — fail-fast jei API neveikia, atstato FVM klasifikatorius |

### Kritinis dėmesys: cookies + page context

Playwright top-level `request` fixture turi **atskirą** session storage'ą nuo
`page` context'o. Jei nori, kad cookies share'intųsi:

```typescript
// ✗ NEVEIKS — request ir page turi atskirus cookie storage'us
const { request, page } = ...;
await loginViaApi(request, 'demo'); // cookie tik request'e
await page.goto('/');               // page'as auth'inamas atskirai (LoginPage)

// ✓ VEIKS — naudoti page.context().request
const { page } = ...;
const request = page.context().request;
await loginViaApi(request, 'demo'); // cookie page context'e
await page.goto('/');               // page'as jau auth'intas
```

## Demo accounts

Visi su slaptažodžiu `demo`. Naudojam (žr. `helpers/auth.ts → ACCOUNTS`):

- `demo` — AM admin (default; alias `am-admin`)
- `am-admin` — AM admin
- `am-user` — AM specialistas (visos org.)
- `aad-admin` — AAD admin (submitter / org_admin)
- `aad-user` — AAD specialistas (org_user, naudojam permission gating'o testui)

## Žinomi apribojimai

- **Test'ai modifikuoja DB**. Po visų run'ų DB turi extra funding_sources,
  budget_allocations, projektus, expenses, prašymus su `E2E-{suffix}` prefiksais.
  Pakartotinis run'as veikia per `uniqueSuffix()` — nesusilieja, bet DB auga.
  Norint išvalyti — paleisti `yarn db:seed` (truncatina + įdeda iš naujo).
- **Nelygiagretina**. Testai nuosekliai (workers=1). 5 testai užtrunka ~16 sec.
- **Spec.programa testas** sukuria AAD funding_source + budget_allocation,
  nes backend `createFvmProject` ieško allocation prašymo tenant'e
  (žr. `02-spec-program-flow.spec.ts` docstring detalėms).

## Debug'inimas

1. **Trace viewer** po failed run:
   ```bash
   npx playwright show-trace test-results/<test-folder>/trace.zip
   ```

2. **Screenshot'ai** automatiškai daromi prie failed step'ų — randami
   `test-results/<test-folder>/test-failed-*.png`.

3. **API logai** — palaikomi backend tsx watch terminale; konkretūs request'ai
   matomi su `=> METHOD /finansai/...` ir `<= STATUS METHOD /finansai/... [+Xms]`.

4. **Naujas user'is / atskira sesija** — testai naudoja Playwright `context.request`,
   kad cookie'is per `page.context().request` būtų share'inamas. Žiūr'k „Kritinis
   dėmesys" sekciją aukščiau.

## CI integracija

Šiuo metu CI workflow nesukurtas (Iter 16 brief — optional). Norint pridėti,
sukurti `.github/workflows/e2e.yml` su steps: setup-node + playwright install +
docker compose up postgres + dev:api/web background'e + `yarn e2e`.
