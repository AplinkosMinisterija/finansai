# Backend testų infrastruktūra

Šis dokumentas — „kaip rašyti ir paleisti" backend testus `finansai/api`. Jest +
ts-jest + reali PostgreSQL DB (`finansai_test`) + ServiceBroker testams.

## Greitas startas

```bash
# 1) Įsitikink, kad lokali PostgreSQL veikia (dev DB).
yarn dev:db        # iš repo root — paleidžia docker compose postgres + redis

# 2) Paleisk testus.
cd apps/api
yarn test

# Norint paleisti tik konkretų failą:
yarn test sanity.spec
```

Pirmu `yarn test` paleidimu `global-setup.ts` automatiškai sukurs `finansai_test`
DB ir paleis migracijas. Sekantys paleidimai naudos jau egzistuojančią DB
(greitis), prieš paleidžiant — TRUNCATE'inus visas lenteles.

## Struktūra

```
apps/api/test/
├── README.md              ← šis failas
├── setup-env.ts           ← per-test ENV (NODE_ENV, DB_CONNECTION)
├── global-setup.ts        ← VIENĄ kartą: CREATE DATABASE + migrate
├── global-teardown.ts     ← VIENĄ kartą po visko (placeholder)
├── sanity.spec.ts         ← infra įrodantis test'as
└── helpers/
    ├── db.ts              ← getTestKnex, truncateAll, seedBaseFixtures
    ├── broker.ts          ← createTestBroker
    └── auth.ts            ← mockAuthUser, mockOrgAdmin, mockOrgUser
```

## ENV kintamieji

| Kintamasis           | Default                                                          | Paskirtis                      |
|----------------------|------------------------------------------------------------------|--------------------------------|
| `TEST_DB_CONNECTION` | `postgresql://finansai:finansai@localhost:5433/finansai_test`    | Test DB connection string      |
| `DB_CONNECTION`      | (= TEST_DB_CONNECTION test'uose)                                 | `src/database/db.ts` per `setup-env` |
| `LOGLEVEL`           | `warn`                                                           | Tylesnis broker logger'is      |
| `REDIS_URL`          | `redis://localhost:6380`                                         | Redis (jei testas jį pasiekia) |

## Test patterns

### 1) Spec'as su DB ir broker

```ts
import type { ServiceBroker } from 'moleculer';
import {
  getTestKnex,
  closeTestKnex,
  truncateAll,
  seedBaseFixtures,
} from './helpers/db';
import { createTestBroker } from './helpers/broker';
import { mockAuthUser } from './helpers/auth';

describe('mano feature', () => {
  let broker: ServiceBroker;

  beforeAll(async () => {
    broker = await createTestBroker();
  });

  afterAll(async () => {
    await broker.stop();
    await closeTestKnex();
  });

  beforeEach(async () => {
    const knex = getTestKnex();
    await truncateAll(knex);
    await seedBaseFixtures(knex);
  });

  it('AM admin gali list\'inti tenant\'us', async () => {
    const tenants = await broker.call('tenants.list', {}, {
      meta: { user: mockAuthUser() },
    });
    expect(Array.isArray(tenants)).toBe(true);
  });
});
```

### 2) Permission test'as — 403 ne-AM admin

```ts
import { mockOrgUser } from './helpers/auth';

it('org user negali sukurti tenant\'o', async () => {
  await expect(
    broker.call(
      'tenants.create',
      { code: 'NEW', name: 'New Tenant' },
      { meta: { user: mockOrgUser() } },
    ),
  ).rejects.toMatchObject({ code: 403 });
});
```

### 3) Direct DB assertions po service call

```ts
it('tenant'as sukurtas su teisingais laukais', async () => {
  await broker.call('tenants.create', {
    code: 'NEW',
    name: 'Naujas',
  }, { meta: { user: mockAuthUser() } });

  const knex = getTestKnex();
  const created = await knex('tenants').where({ code: 'NEW' }).first();
  expect(created).toBeDefined();
  expect(created?.name).toBe('Naujas');
});
```

## Test isolation strategy

- **DB**: `truncateAll(knex)` `beforeEach`'e — visos lentelės iš naujo, ID'ai
  pradeda nuo 1. `RESTART IDENTITY CASCADE` per `TRUNCATE`.
- **Broker**: paprastai vienas broker'is per spec failą (`beforeAll`/`afterAll`),
  nes startup ~kelis šimtus ms.
- **Jest workers**: `maxWorkers=1` jau `jest.config.js`. Vienas DB —
  paralelinis run'as koliziuotų. Jei reikės speed up — galima ateityje
  pereiti į DB-per-worker su template DB.
- **Redis**: kol test'ai jo neliečia — palikti default URL. Auth servisas
  redį naudoja tik per `login`/`logout` actions; kiti call'ai meta.user
  perduoda tiesiogiai.

## CI/CD aplikavimas

CI runner'iui:
1. Užtikrinti PostgreSQL 17 (ar suderinamą) prieinamumą.
2. `TEST_DB_CONNECTION=postgresql://<user>:<pass>@<host>:<port>/finansai_test`.
3. `yarn install && yarn workspace @biip-finansai/api test`.

`global-setup.ts` sukurs DB jei nėra — ne reikia pre-step migration'ams.

## Trouble­shooting

| Symptom                                              | Sprendimas |
|------------------------------------------------------|------------|
| `ECONNREFUSED 127.0.0.1:5433`                        | `yarn dev:db` iš root — paleisti docker compose postgres |
| `database "finansai_test" does not exist`            | `global-setup` turi sukurti — bet jei DB user'is be `CREATEDB` teisės, sukurk rankomis: `createdb -U finansai -h localhost -p 5433 finansai_test` |
| Test'as „hangs" pabaigoje                            | Trūksta `await broker.stop()` arba `await closeTestKnex()`. Patikrink `afterAll`. |
| `MoleculerClientError: ... FORBIDDEN`                | Patikrink, ar `meta.user` turi reikiamą rolę (`mockAuthUser` default = AM admin). |
| Schema pasikeitė, test'ai naudoja seną              | Schema jau migruojama `global-setup`'e. Jei reikia full reset — `dropdb -U finansai -h localhost -p 5433 finansai_test` ir vėl `yarn test`. |

## Žinios

- `apps/api/test/` katalogas pridėtas Iter 9 (FVM-1) pradžioje. Tai pirmas
  veikiantis backend test pamatas projekte.
- `tsconfig.json` `exclude: ["node_modules", "dist", "test"]` — test failai
  NEDALYVAUJA build'ui (`yarn build`). Tipus jiems pateikia ts-jest pats.
- `jest.config.js` `roots: ['<rootDir>/test']` — visi `*.spec.ts` šitam
  kataloge. Service-level integration test'us tradiciškai talpinam
  `apps/api/test/services/foo.service.spec.ts`.
