# 03 — Architektūra

## Aukšto lygio diagrama

```
┌─────────────────────────────────────────────────────────────┐
│                  finansai (Caddy 80)                        │
│ ┌──────────────┬──────────────┬──────────────────────────┐  │
│ │ / (SPA)      │ /docs/*      │ /api/* → finansai-api    │  │
│ │ React+Vite   │ VitePress    │ rewrite /api → /finansai │  │
│ └──────────────┴──────────────┴──────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│            finansai-api (Moleculer.js, port 3000)           │
│                                                             │
│  /finansai/ping     /finansai/health                        │
│  /finansai/auth/login   /auth/logout   /auth/me             │
│  /finansai/tenants      CRUD                                │
│  /finansai/users        CRUD su scope filtru                │
│  /finansai/requests     CRUD + submit + decision + comments │
│  /finansai/dashboard    role-tailored stats + trend         │
└─────────────────────────────────────────────────────────────┘
        │                                       │
        ▼                                       ▼
┌──────────────────┐                  ┌──────────────────┐
│   PostgreSQL     │                  │      Redis       │
│   `finansai` DB  │                  │   sesijų store   │
└──────────────────┘                  └──────────────────┘
```

## Stack pasirinkimas

| Komponentas | Sprendimas                              | Kodėl                                                  |
| ----------- | --------------------------------------- | ------------------------------------------------------ |
| Backend FW  | **Moleculer.js**                        | Visi BIIP API'ai jau ant Moleculer (tooling, patternai) |
| ORM         | **Knex + Objection.js**                 | BIIP standartas; migracijų + tipuoti modeliai           |
| DB          | **PostgreSQL 17**                       | biip-postgres infra jau yra                            |
| Sesijos     | **Redis** (HttpOnly cookie token)       | Lengva, jokios JWT komplikacijos; ta pati Redis kaip kitur |
| Frontend    | **React 18 + Vite + Tailwind + shadcn** | Greitas dev, gražus default look                       |
| Forms       | react-hook-form + zod                   | BIIP standartas                                        |
| API client  | axios + React Query                     | Caching, retries, optimistic updates                   |
| Grafikai    | **recharts**                            | Lengvi, sklandi React API, gerai dirba su responsive   |
| Docs        | **VitePress**                           | Markdown native, paprastas hosting'as šalia SPA        |
| Caddy       | In-container Caddy                      | SPA + docs + API reverse proxy vienam port             |

## Repo struktūra

```
finansai/
├── apps/
│   ├── api/                          Moleculer.js + TS + Knex/Objection
│   │   ├── src/services/
│   │   │   ├── api.service.ts        Gateway: cookie parsing, route groups
│   │   │   ├── auth.service.ts       login/logout/me, session resolve
│   │   │   ├── tenants.service.ts    Tenants CRUD (AM admin only)
│   │   │   ├── users.service.ts      Users CRUD su scope filtru
│   │   │   ├── requests.service.ts   Prašymų state machine + komentarai
│   │   │   └── dashboard.service.ts  Role-tailored stats + monthly trend
│   │   ├── src/models/               Base, User, Tenant, Request, RequestComment
│   │   ├── src/database/             knexfile, db.ts, migrations/, seeds/
│   │   └── Dockerfile                produces ghcr.io/.../finansai-api:<Env>
│   └── web/                          React 18 + Vite + shadcn
│       ├── src/
│       │   ├── pages/                HomePage, LoginPage, Vartotojai, Organizacijos,
│       │   │                         Statistika, Prasymai, PrasymoDetail, PrasymoEdit
│       │   ├── components/
│       │   │   ├── ui/               shadcn primitives (Button, Card, Select,
│       │   │   │                     Checkbox, MultiSelect, …)
│       │   │   ├── charts/           recharts wrap'ai (Monthly, Status, PerTenant)
│       │   │   ├── tenants/          TenantDialog
│       │   │   ├── users/            UserDialog
│       │   │   └── Sidebar, Layout
│       │   └── lib/                  api, auth, roles, requests helpers
│       ├── caddy/Caddyfile           in-container: /api → finansai-api, /docs → docs, / → SPA
│       └── Dockerfile                produces ghcr.io/.../finansai:<Env>
├── packages/shared/                  TS tipai dalinami tarp api ir web
├── docs/                             VitePress source ir decision log
├── docker-compose.yml                local dev: postgres + redis
└── .github/workflows/                deploy-{development,staging,production}.yml
```

## Auth flow

1. POST `/api/auth/login` su `{ username, password }`
2. API valdo: random 32-byte hex token → Redis raktas `finansai:session:<token>` su payload `{ userId, role, createdAt }`, TTL 7 dienos
3. Response su HttpOnly cookie `finansai_session=<token>` (SameSite=Lax, Secure prod'e)
4. Sekančioms užklausoms — cookie keliauja į backend, gateway `authenticate` hook'as resolve'ina session per `auth.resolveSession`
5. GET `/api/auth/me` grąžina current user info (frontend tikrina po refresh)
6. POST `/api/auth/logout` — trinami iš Redis + clear cookie

## Deploy

| Branch / Tag | Aplinka     | Image tag       | URL                              |
| ------------ | ----------- | --------------- | -------------------------------- |
| `dev`        | Development | `:Development`  | https://dev-finansai.biip.lt     |
| `main`       | Staging     | `:Staging`      | https://staging-finansai.biip.lt |
| tag `X.Y.Z`  | Production  | `:Production`   | https://finansai.biip.lt (kol kas redirect → staging) |

CI workflow (`.github/workflows/deploy-*.yml`):
1. Build Docker image (apps/web + apps/api)
2. Push to ghcr.io
3. Trigger `biip-infra/deploy-environment.yml` su atitinkama aplinka (per `BIIP_INFRA_DEPLOY_TOKEN`)
4. biip-infra deploy: SCP compose → SSH `docker compose up --wait`
