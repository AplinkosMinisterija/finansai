# Finansai — Aplinkos ministerijos finansavimo prašymų sistema

Tikslas — pakeisti senąjį SharePoint įrankį, per kurį Aplinkos ministerijai pavaldžios institucijos teikia finansavimo prašymus IT projektams ir kitiems sąnaudų straipsniams. AM darbuotojai prašymus tvirtina, atmeta arba grąžina pataisymui.

## Statusas

Visos pradinės 5 iteracijos užbaigtos:

- ✅ **Iter 0** — bootstrap: repo, deploy pipeline, blank shell, sesijos auth
- ✅ **Iter 1** — organizacijos (tenants), vartotojų valdymas, role-based scope
- ✅ **Iter 2** — prašymo duomenų modelis (DB schema + API)
- ✅ **Iter 3** — prašymo teikimo wizard'as (5 žingsnių multi-step)
- ✅ **Iter 4** — tvirtinimo flow (AM perspektyva + ping-pong)
- ✅ **Iter 5** — docsai, testai, polish

Detalė — [06 — Implementacijos planas](/06-implementacijos-planas).

## Aplinkos

| Branch / Tag | Aplinka       | URL                          |
| ------------ | ------------- | ---------------------------- |
| `dev`        | Development   | https://dev-finansai.biip.lt |
| `main`       | Staging       | https://staging-finansai.biip.lt |
| tag `X.Y.Z`  | Production    | https://finansai.biip.lt (redirect → staging) |

## Demo paskyros

Slaptažodis visiems: `demo`

| Username       | Rolė             | Tenant | Scope                                    |
| -------------- | ---------------- | ------ | ---------------------------------------- |
| `demo`         | AM administratorius | AM  | Visi                                     |
| `am-admin`     | AM administratorius | AM  | Visi                                     |
| `am-user`      | AM specialistas     | AM  | Visos org.                              |
| `am-user-aad`  | AM specialistas     | AM  | Tik AAD                                 |
| `aad-admin`    | Org. administratorius | AAD | AAD vartotojai + prašymai             |
| `aad-user`     | Org. specialistas   | AAD | Tik savo prašymai                       |
| `vstt-admin`   | Org. administratorius | VSTT | VSTT vartotojai + prašymai            |
| `vstt-user`    | Org. specialistas   | VSTT | Tik savo prašymai                       |
| `lgt-admin`    | Org. administratorius | LGT | LGT vartotojai + prašymai             |
| `lgt-user`     | Org. specialistas   | LGT | Tik savo prašymai                       |

## Stack

- **Backend:** Moleculer.js + TS + Knex + Objection.js + PostgreSQL + Redis (sesijos)
- **Frontend:** React 18 + Vite + Tailwind + shadcn/ui + React Query
- **Docs:** VitePress
- **CI/CD:** GitHub Actions + biip-infra

Detalė — [03 — Architektūra](/03-architektura).
