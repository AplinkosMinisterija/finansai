# 06 — Implementacijos planas

5 iteracijos + bootstrap. Po kiekvienos — nepriklausomas review subagent'as patikrina, ar viskas atitinka acceptance kriterijus, prieš einant prie sekančios.

## Iter 0 — Bootstrap + Infra ✅

**Tikslas:** dev/staging deploy pipeline + blank shell veikia.

- [x] Repo `AplinkosMinisterija/finansai` (kopija iš `hr` template)
- [x] Yarn workspaces struktūra (apps/api, apps/web, docs, packages/shared)
- [x] Dockerfiles + Caddyfile + GitHub Actions
- [x] biip-infra docker-compose pridėjimas (finansai + finansai-api)
- [x] biip-infra Caddyfiles (3 aplinkos)
- [x] PostgreSQL DB sukurta per `postgres-createdb.yml`
- [x] Color palette: deep teal (skiriasi nuo hr žalio)
- [x] Sesijos auth + vienas demo accountas (`demo`/`demo`)
- [x] Blank HomePage placeholder
- [x] Production redirect į staging

**Acceptance:**
- `https://dev-finansai.biip.lt` — login → blank home
- `https://dev-finansai.biip.lt/docs/` — VitePress dokumentacija
- `https://staging-finansai.biip.lt` — tas pats
- `https://finansai.biip.lt` — 302 → staging

## Iter 1 — Auth, tenants, vartotojai

**Tikslas:** pilnas vartotojų valdymas pagal scope.

- [ ] Migracija: `tenants` lentelė + `users.tenant_id` + `users.am_scope_org_ids`
- [ ] Seed: AM + AAD + VSTT + LGT, 8+ demo accounts (visiems passwordai `demo`)
- [ ] Service: `tenants.list`, `users.list`/`get`/`create`/`update`/`delete` (su scope)
- [ ] UI: `/vartotojai` puslapis su sąrašu, sukūrimo/redagavimo dialogais
- [ ] Auth payload įtraukia `tenantId`, `tenantCode`, `amScopeOrgIds`

**Acceptance:**
- am-admin/demo mato visus
- am-user/demo mato tik priskirtų organizacijų vartotojus
- aad-admin/demo mato tik AAD vartotojus
- aad-user/demo mato tik save (read-only)

## Iter 2 — Prašymo schema + API

**Tikslas:** DB schema ir CRUD API parengtas wizard'ui.

- [ ] Migracija: `requests` (DRAFT/SUBMITTED/RETURNED/APPROVED/REJECTED) + `request_comments`
- [ ] Modelis: `Request`, `RequestComment` (Objection.js)
- [ ] Service: `requests.list`/`get`/`create`/`update`/`submit`/`delete` (su scope)
- [ ] Seed: 5-7 pavyzdiniai prašymai įvairiuose statusuose

**Acceptance:**
- API testai praeina (Jest)
- Curl `/api/requests` grąžina scope-filtruotą sąrašą per role

## Iter 3 — Prašymo teikimo wizard (UI)

**Tikslas:** multi-step forma kaip GPAIS screenshot'e.

- [ ] 5 žingsnių wizard scaffold (sidebar žingsniai, „X iš 5" indicator)
- [ ] Žingsnis 1: Pagrindinė info forma
- [ ] Žingsnis 2: Finansavimas (auto-total)
- [ ] Žingsnis 3: Ketv. paskirstymas (sum validation)
- [ ] Žingsnis 4: Atsakingi asmenys
- [ ] Žingsnis 5: Peržiūra + Submit
- [ ] Draft auto-save (debounce 1s)
- [ ] `/prasymai` puslapis su sąrašu + status filtrais

**Acceptance:**
- Submitter sukuria draftą, pildo žingsnius, pateikia
- Reload — draftas iš serverio
- Submit transitions į SUBMITTED, AM mato sąraše

## Iter 4 — Tvirtinimo flow + ping-pong

**Tikslas:** AM gali pilnai valdyti paraiškas.

- [ ] Backend: `requests.approve`/`reject`/`returnForFix` actions
- [ ] AM request detail page su veiksmų mygtukais
- [ ] Decision metadata forma (skirta suma, šaltinis, protokolas, įsakymas)
- [ ] Comments thread komponentas
- [ ] Submitter pusėje: RETURNED grįžta į edit modal su komentarais

**Acceptance:**
- Pilnas ping-pong cikls veikia (submit → return → fix → submit → approve)
- AM scope filtruoja tinkamai
- Audit log rodo visus veiksmus

## Iter 5 — Docsai, testai, polish

**Tikslas:** prod-ready vartotojo akimis.

- [ ] VitePress docs visi puslapiai užpildyti
- [ ] Backend integration testai (Jest)
- [ ] Frontend testai (Vitest + RTL)
- [ ] README polish
- [ ] CLAUDE.md polish
- [ ] Production aplinka (jei norėsis pakeisti iš redirect į pilną — žr. hr precedent)

**Acceptance:**
- `yarn test` pereina abu workspaces
- `yarn build` pereina visus workspaces
- `/docs/` rodo pilną dokumentaciją
- README ir CLAUDE.md atspindi dabartinę state
