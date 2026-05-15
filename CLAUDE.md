# CLAUDE.md — Agent onboarding

Šis failas yra **tau, Claude**. Aplinkos ministerijos finansavimo prašymų sistema (Finansai). Vartotojas dirba kasdien su Claude'u kaip su pair programmer'iu — git commit'us darai pati, deploy'inies pati.

## Tavo pirmasis ėjimas — onboarding

Kai gauni pirmą žinutę šiame repo, **prieš atsakymą padaryk šitai**:

1. Perskaityk **visus** `docs/` failus eilės tvarka (01 → 06). Tai pilnas dabartinis kontekstas + implementacijos planas. `docs/06-implementacijos-planas.md` parodo, kur iteracijoje esam ir kas dar laukia.
2. Peržiūrėk `docs/diskusijos.md` — naujausi sprendimai, ką užbaigėm, kur sustojom. Naujausi įrašai viršuje.
3. Jei nori pamatyti, kaip live atrodo dabartinė versija — `gh run list --repo AplinkosMinisterija/finansai` parodys paskutinį deploy. URL'ai: `https://dev-finansai.biip.lt`, `staging-finansai.biip.lt`, `finansai.biip.lt`.
4. Patikrink ar yra `superpowers` skill — naudosi `superpowers:brainstorming` naujų featureų aptarimui ir `superpowers:writing-plans` plano įrašymui prieš implementaciją.
5. **Lietuvių kalba** — visas turinys lietuviškai. Atsakymai irgi lietuviškai.
6. Trumpa santrauka vartotojui: *„Esam Iter N. Šiandien užbaigta X, laukia Y. Kuriuo norėtum pradėti?"*

## Workflow taisyklės

- **Brainstormai naujom feature'ėm per `superpowers:brainstorming` skill.** Klausimai po vieną, multiple choice kai įmanoma. Niekada nedaryk wall-of-text klausimų.
- **Sprendimus rašyk į `docs/diskusijos.md`** — naujausi įrašai viršuje, su data. Architektūros sprendimai gali eit į atskirus `docs/0N-*.md` failus.
- **Kodo pakeitimus iteruok mažais žingsniais.** Vienas commit'as = vienas darbas. Lengva atsekti, lengva rollback'inti.
- **Testai** — backend Jest, frontend Vitest + RTL. Naujam feature'ui — bent vienas integracijos testas.
- **Lokaliai testuok prieš push'inant** — `yarn build` ir `yarn test` turi pereiti. Lokaliai paleisk `yarn dev`, patikrink kad nieko nesulaužėi.

## Git ir deploy susitarimas (vienas-žmogaus modelis)

**Šis projektas vystomas vieno žmogaus** — be PR review, be feature branch'ų. Yra trys branch'ai/aplinkos:

> **Repo default branch — `main`** (atitinka GitHub konvenciją, kad release/tag UI rodytų iš main). Po klonavimo iškart pereik į dev: `git checkout dev`.

| Branch / Tag | Aplinka | URL | Trigger |
|---|---|---|---|
| `dev` | Development | https://dev-finansai.biip.lt | push į `dev` |
| `main` | Staging | https://staging-finansai.biip.lt | push į `main` |
| tag `X.Y.Z` | Production | https://finansai.biip.lt (redirect → staging) | tag push |

### Tavo (Claude) atsakomybės

**Kai vartotojas prašo pakeitimo:** commit tiesiogiai į `dev` branch'ą (NEdaryk PR, NEdaryk naujo branch'o), push. NEKlausk leidimo — tai default flow. Po push'o GitHub Actions **automatiškai** build'ina image'ą ir trigerina biip-infra Development deploy'ą.

1. `git push origin dev` — viskas, ką tau reikia daryti.
2. Palauk finansai workflow + biip-infra Development deploy pabaigos. Jei nori — gali `gh run watch`, bet nebūtina; tipiškas ciklas ~2-3 min.
3. Pranešk: „Padaryta. Atnaujink https://dev-finansai.biip.lt — pakeitimas matomas."

> **Išimtis:** jei vartotojas eksplicitiškai pasako „padaryk PR" arba „atskirame branch'e" — tada nesilaikyk default flow.

**Kai vartotojas pasako „paleisk į staging" (arba pan. „push to staging", „pateik staging"):**

1. `git checkout main && git pull && git merge dev` (ff jei galima, kitaip `--no-ff -m "Paleidžiama į staging: <kas pasikeitė>"`)
2. `git push origin main`
3. Palauk auto-pipeline pabaigos (~2-3 min)
4. Pranešk: „Staging atnaujintas — https://staging-finansai.biip.lt"

**Kai vartotojas pasako „paleisk į production" (arba pan. „release", „pateik į prod"):**

1. Įvertink pakeitimus nuo paskutinio tag'o: `git log <last-tag>..main --oneline` ir trumpai pasakyk vartotojui, kas keičiasi.
2. Pasiūlyk semver bump'ą:
   - **patch** (X.Y.**Z+1**): bug fix, smulkios polishavimas, copy keitimai
   - **minor** (X.**Y+1**.0): naujas ekranas, naujas feature'as
   - **major** (**X+1**.0.0): breaking change
3. Sukurk tag **iš `main`** (ne `dev`): `git checkout main && git pull && git tag X.Y.Z && git push origin X.Y.Z`
4. Palauk auto-pipeline pabaigos
5. Pranešk: „Produkcija išleista X.Y.Z — https://finansai.biip.lt"

> **Niekada netaginuok prieš tai neparodęs vartotojui kas keičiasi ir negavęs „taip"** — tai vienintelis taško, kur reikia consent'o. Visi kiti dev/staging veiksmai — autonominiai.

### Auto-pipeline kaip veikia

Po `git push` arba tag push'o, finansai workflow:
1. Build'ina Docker image'us (web + api) su tinkamu tag'u (`:Development` / `:Staging` / `:Production`)
2. Push'ina į `ghcr.io/aplinkosministerija/finansai` ir `.../finansai-api`
3. **Automatiškai** trigerina `biip-infra/deploy-environment.yml` su atitinkama aplinka (per `BIIP_INFRA_DEPLOY_TOKEN` secret)
4. biip-infra deploy'as SCP'ina compose failus į VM, `docker compose up --wait` paima naują image'ą iš ghcr.io

Bendras ciklas push → URL atnaujintas: ~2-3 min.

### Ką NE daryk

- Ne commit'ink į `main` tiesiogiai (tik per merge iš `dev`)
- Ne sukurk naujų branch'ų vartotojui neprašant
- Ne atidaryk PR'ų (vienas žmogus = nereikia review)
- Ne taginuok be aprovalo

## Greitas referencijos taškas

| Klausimas | Atsakymas |
|---|---|
| Kam šis įrankis? | Finansavimo prašymų teikimui ir tvirtinimui. AM = tvirtintojas; pavaldžios institucijos = teikėjai |
| Stack | Moleculer.js + TS + Knex + Objection + PostgreSQL + Redis (backend); React 18 + Vite + Tailwind + shadcn/ui + React Query (frontend); VitePress (docs) |
| MVP fokusas | Vartotojų valdymas (tenant→user) + prašymo wizard'as + tvirtinimo ping-pong |
| Auth (MVP) | session-based, `demo`/demo. Vėliau biip-auth-api SSO |
| Dabartinis statusas | Iter 0-5 baigti — MVP ready. Žiūrėk `docs/06-implementacijos-planas.md` |
| Local dev | `yarn install && yarn dev:db && yarn dev` (api 3000, web 5173, docs 5174) |
