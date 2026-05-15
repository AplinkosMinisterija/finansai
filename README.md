# Finansai — AM finansavimo prašymų sistema

Aplinkos ministerijos vidinė web aplikacija finansavimo prašymams teikti ir tvirtinti. Pakeičia anksčiau naudotą SharePoint įrankį.

## TL;DR

- **AM** = tvirtintojas (admin + user su scope per organizacijas)
- **Pavaldžios institucijos** (AAD, VSTT, LGT, …) = teikėjai (admin + user)
- **Workflow**: submitter teikia → AM tvirtina / atmeta / grąžina pataisymui → ping-pong kol patvirtinta
- **Aplinkos**: [dev-finansai.biip.lt](https://dev-finansai.biip.lt), [staging-finansai.biip.lt](https://staging-finansai.biip.lt), [finansai.biip.lt](https://finansai.biip.lt) (kol kas redirect → staging)
- **Docs**: [/docs/](https://dev-finansai.biip.lt/docs/)

Detalė — žr. [docs/01-kontekstas.md](docs/01-kontekstas.md) ir [docs/06-implementacijos-planas.md](docs/06-implementacijos-planas.md).

## Kur dabar esam

- ✅ **Iter 0** — bootstrap: repo, deploy pipeline, blank shell, sesijos auth, demo account
- ⏳ **Iter 1** — auth, tenants, vartotojai
- ⏳ **Iter 2** — prašymo schema + API
- ⏳ **Iter 3** — prašymo teikimo wizard'as
- ⏳ **Iter 4** — tvirtinimo flow + ping-pong
- ⏳ **Iter 5** — docsai, testai, polish

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

Demo prisijungimas: `demo` / `demo` (Iter 0; Iter 1 pridės 8+ accounts).

## Struktūra

```
finansai/
├── README.md                       ← šis failas
├── CLAUDE.md                       ← Claude'o onboarding + workflow taisyklės
├── apps/
│   ├── api/                        Moleculer.js + TS + (Knex+Objection+Postgres)
│   │   ├── src/services/           api.service.ts, auth.service.ts
│   │   ├── src/database/           migrations + seeds
│   │   ├── Dockerfile              produces ghcr.io/.../finansai-api:<Env>
│   │   └── package.json
│   └── web/                        React 18 + Vite + Tailwind + shadcn/ui
│       ├── src/                    main.tsx, App.tsx, pages/, components/, lib/
│       ├── caddy/Caddyfile         in-container Caddy: /api → finansai-api, /docs → docs, / → SPA
│       ├── Dockerfile              produces ghcr.io/.../finansai:<Env>
│       └── package.json
├── packages/
│   └── shared/                     TS tipai dalinami tarp api ir web
├── docs/                           VitePress source ir decision log
│   ├── .vitepress/config.ts        sidebar, theme
│   ├── index.md
│   ├── 01..06-*.md                 architektūra, sprendimai, planas
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
