# Finansai — Aplinkos ministerijos finansavimo prašymų sistema

**Trumpai (ne-techniniam skaitytojui):** Aplinkos ministerijos (AM) pavaldžios institucijos (Aplinkos apsaugos departamentas, Saugomų teritorijų tarnyba, Geologijos tarnyba ir kt.) per šią sistemą teikia AM finansavimo prašymus — IT projektams, sistemoms palaikyti, naujoms plėtros sąnaudoms. AM darbuotojai prašymus tvirtina, atmeta arba grąžina pataisymui. Sistema pakeičia senąjį SharePoint įrankį, kuris buvo nepatogus ir nepalaikomas.

## Kam ši sistema?

| Vaidmuo | Ką daro | Kaip patenka į sistemą |
|---|---|---|
| **Pavaldžios institucijos specialistas** | Pildo prašymus IT projektams ar kitoms sąnaudoms | Login → „Naujas prašymas" → 5 žingsnių vedlys → Pateikti |
| **Pavaldžios institucijos vadovas** | Mato visus savo organizacijos prašymus, gali redaguoti, valdyti vartotojus | Login → „Prašymai" / „Vartotojai" |
| **AM specialistas** | Peržiūri pateiktus prašymus, juos tvirtina arba grąžina pataisyti | Login → „Pradžia" → „Laukia mano tvirtinimo" |
| **AM administratorius** | Tas pats + valdo organizacijas, AM vartotojus, gali teikti prašymą kitos org. vardu | Login → meniu visos sekcijos |

## Statusas

Visos planuotos iteracijos užbaigtos:

- ✅ **Iter 0** — bootstrap: repo, deploy pipeline, blank shell, sesijos auth
- ✅ **Iter 1** — organizacijos (tenants), vartotojų valdymas, role-based scope
- ✅ **Iter 2** — prašymo duomenų modelis (DB schema + API)
- ✅ **Iter 3** — prašymo teikimo wizard'as (5 žingsnių multi-step)
- ✅ **Iter 4** — tvirtinimo flow (AM perspektyva + ping-pong)
- ✅ **Iter 5** — docsai, testai, polish
- ✅ **Iter 6** — rolių modelio supaprastinimas (admin/user) + UI polish
- ✅ **Iter 7** — organizacijų valdymas (UI)
- ✅ **Iter 8** — statistikos puslapis su grafikais

Detalė — [06 — Implementacijos planas](/06-implementacijos-planas).

## Aplinkos

| Branch / Tag | Aplinka | URL |
|---|---|---|
| `dev` | Development | https://dev-finansai.biip.lt |
| `main` | Staging | https://staging-finansai.biip.lt |
| tag `X.Y.Z` | Production | https://finansai.biip.lt (redirect → staging) |

## Demo paskyros

Slaptažodis visiems: `demo`

| Username | UI etiketė | Tenant | Scope |
|---|---|---|---|
| `demo` | AM administratorius | AM | Viskas |
| `am-admin` | AM administratorius | AM | Viskas |
| `am-user` | AM specialistas | AM | Visos org'os |
| `am-user-aad` | AM specialistas | AM | Tik AAD prašymai |
| `aad-admin` | AAD administratorius | AAD | Savo org |
| `aad-user` | AAD specialistas | AAD | Tik savo prašymai |
| `vstt-admin` | VSTT administratorius | VSTT | Savo org |
| `vstt-user` | VSTT specialistas | VSTT | Tik savo prašymai |
| `lgt-admin` | LGT administratorius | LGT | Savo org |
| `lgt-user` | LGT specialistas | LGT | Tik savo prašymai |

Jei nori greitai pamatyti AM teikiantį prašymą *kitos* org. vardu — prisijungs `am-admin`, paspausk „Naujas prašymas", pasirink AAD ar VSTT.

## Stack (techniniam skaitytojui)

- **Backend:** Moleculer.js (microservices), TypeScript, Knex (migracijos) + Objection.js (ORM modeliai), PostgreSQL, Redis (sesijos)
- **Frontend:** React 18, Vite, Tailwind CSS, shadcn/ui primitives, React Query, React Router, recharts (grafikams)
- **Docs:** VitePress (šis pat puslapis)
- **CI/CD:** GitHub Actions → biip-infra → Docker Compose dev/staging/prod

Detalė — [03 — Architektūra](/03-architektura).

## Dokumentacijos žemėlapis

| Skyrius | Kam reikalingas |
|---|---|
| [01 — Kontekstas](/01-kontekstas) | Kodėl statoma ši sistema, kas yra SharePoint pirmtakas |
| [02 — MVP scope](/02-mvp-scope) | Kas yra ir ko nėra MVP'ame |
| [03 — Architektūra](/03-architektura) | Kodo struktūra, servisai, deploy |
| [04 — Vartotojų modelis](/04-vartotoju-modelis) | Rolės, scope, permission matrica |
| [05 — Prašymo modelis](/05-prasymo-modelis) | DB schema, state machine, wizard'o žingsniai |
| [06 — Implementacijos planas](/06-implementacijos-planas) | Iteracijų progresas |
| [Diskusijos](/diskusijos) | Sprendimų istorija (naujausi viršuje) |
