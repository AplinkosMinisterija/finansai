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
│  /finansai/users        /tenants       (Iter 1+)            │
│  /finansai/requests     ...            (Iter 2+)            │
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
| Docs        | **VitePress**                           | Markdown native, paprastas hosting'as šalia SPA        |
| Caddy       | In-container Caddy                      | SPA + docs + API reverse proxy vienam port             |

## Repo struktūra

```
finansai/
├── apps/
│   ├── api/                          Moleculer.js + TS + Knex/Objection
│   │   ├── src/services/             api, auth, (Iter 1+) tenants, users, requests
│   │   ├── src/models/               Base, User, (Iter 1+) Tenant, Request
│   │   ├── src/database/             knexfile, db.ts, migrations/, seeds/
│   │   └── Dockerfile                produces ghcr.io/.../finansai-api:<Env>
│   └── web/                          React 18 + Vite + shadcn
│       ├── src/                      App, pages/, components/, lib/
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
