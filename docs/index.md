# Finansai — Aplinkos ministerijos finansavimo prašymų sistema

Tikslas — pakeisti senąjį SharePoint įrankį, per kurį Aplinkos ministerijai pavaldžios institucijos teikia finansavimo prašymus IT projektams ir kitiems sąnaudų straipsniams. AM darbuotojai prašymus tvirtina, atmeta arba grąžina pataisymui.

## Kur dabar esam

- ✅ **Iter 0** — bootstrap: repo struktūra, deploy pipeline, blank shell, sesijos auth, vienas demo accountas
- ⏳ **Iter 1** — organizacijos (tenants), vartotojų valdymas, role-based prieiga
- ⏳ **Iter 2** — prašymo duomenų modelis, DB schema
- ⏳ **Iter 3** — prašymo teikimo wizard'as (multi-step)
- ⏳ **Iter 4** — tvirtinimo flow (AM perspektyva + ping-pong)
- ⏳ **Iter 5** — docsai, testai, polish, production redirect

Pilnas planas — [06 — Implementacijos planas](/06-implementacijos-planas).

## Aplinkos

| Branch / Tag | Aplinka       | URL                          |
| ------------ | ------------- | ---------------------------- |
| `dev`        | Development   | https://dev-finansai.biip.lt |
| `main`       | Staging       | https://staging-finansai.biip.lt |
| tag `X.Y.Z`  | Production    | https://finansai.biip.lt (redirect į staging, kol prod neprovisionuotas) |

## Stack

- **Backend:** Moleculer.js + TS + Knex + Objection.js + PostgreSQL + Redis (sesijos)
- **Frontend:** React 18 + Vite + Tailwind + shadcn/ui + React Query
- **Docs:** VitePress
- **CI/CD:** GitHub Actions + biip-infra

Detalė — [03 — Architektūra](/03-architektura).
