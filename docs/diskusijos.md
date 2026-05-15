# Diskusijų log

Naujausi įrašai viršuje. Vienas įrašas = vienas sprendimas/diskusija.

## 2026-05-15 — Iter 5 — Docs polish + visi 5 iter baigti

Visi 5 iter užbaigti vienoje sesijoje:
- **Iter 0**: bootstrap, deploy pipeline į 3 aplinkas, demo `demo`/`demo`
- **Iter 1**: tenants + 10 demo accounts pagal AM/AAD/VSTT/LGT, scope rules
- **Iter 2**: prašymo schema (requests + request_comments) ir API su statusais
- **Iter 3**: 5 žingsnių wizard'as (kaip GPAIS) — pagrindinė info → finansavimas → ketv. → atsakingi → peržiūra
- **Iter 4**: ping-pong flow — AM tvirtina/atmeta/grąžina su decision metadata
- **Iter 5**: dokumentacija užbaigta

Liko ateičiai: ketv. ataskaitos, metinė ataskaita, VIISP SSO, Power BI dashboard'ai.

## 2026-05-15 — Iter 4 — Tvirtinimo flow

PrasymoDetailPage rodo prašymą + kelią:
- Komentarų gija su kind badge'ais (submitted/returned/approved/rejected)
- AM rolėms — decision dialogas su privalomu komentaru (jei return/reject)
- Submitter pusėje — RETURNED prašymas vėl redaguojamas, gali pakartotinai pateikti

Decision metadata (skirta suma, šaltinis, protokolas, įsakymas) rodoma APPROVED prašyme.

## 2026-05-15 — Iter 3 — Wizard

RequestWizard komponentas multi-step pildymui. Atskirta nuo PrasymoEditPage kad būtų reusable. Auto-save po kiekvieno žingsnio (PATCH) — jei vartotojas uždarys naršyklę, juodraštis išliks serveryje.

Ketvirčių validacija — suma turi atitikti „Iš viso prašoma" (be DU). Jei skirtumas > 0.01€ — neleidžiama eiti į kitą žingsnį.

## 2026-05-15 — Iter 2 — Prašymo schema

`requests` lentelė su visais Excel laukais suskirstytais į 5 logines grupes. Pinigų sumos — `decimal(12,2)`, JSON'e perduodamos kaip string (decimal preservation iš PostgreSQL).

Statusų mašina:
- DRAFT → SUBMITTED → (RETURNED → SUBMITTED)* → APPROVED | REJECTED

Komentarai (`request_comments`) — viena lentelė ir vartotojo komentaras, ir audit log (kind=`status_change`/`submitted`/`returned`/`approved`/`rejected`).

Sprendimo metadata (`decision_granted_amount`, `decision_funding_source`, `decision_protocol`, `decision_order`, `decided_at`, `decided_by_user_id`) — saugoma tiesiog requests lentelėje. Kelis kartus tvirtinti negalima — kai statusas APPROVED/REJECTED, nebepasiekiama.

## 2026-05-15 — Iter 1 — Auth, tenants, vartotojai

Pridėta `tenants` lentelė (AM + AAD + VSTT + LGT), users papildytas `tenant_id` + `am_scope_org_ids[]`.

Role enum išplėstas iš `admin` į 4 reikšmes:
- `am_admin` — AM administratorius, visi + valdo AM vartotojus
- `am_user` — AM specialistas, scope orgs (NULL = visos)
- `org_admin` — pavaldžios institucijos administratorius, savo tenant
- `org_user` — pavaldžios institucijos vartotojas, tik save

Scope rules išreikštos `canView` / `canManage` helper'iuose `users.service.ts`. Frontend turi mirrored `canManageUsers` helper'į.

Auth.resolveUser endpoint'as — vidinis, naudoja gateway authenticate hook'as, kad pilną AuthUser (su tenant info) atneštų į kiekvieną request.meta.

Seed check'as runner.ts'e — žiūri `tenants` count: jei 0, paleidžia visą seed (truncate + insert). Tai leidžia atnaujinti seed'us tarp iteracijų — tik užwipinti tenants kad refresh'intų.

## 2026-05-15 — Iter 0 bootstrap

Sukurta projekto struktūra kopijuojant iš `hr` repo. Pakeitimai:

- `biip-hr` → `biip-finansai` visuose package'uose
- `ghcr.io/aplinkosministerija/hr*` → `.../finansai*` image tag'uose
- `/hr` API route prefiksas → `/finansai`
- Cookie `hr_session` → `finansai_session`
- Redis prefiksas `hr:session:` → `finansai:session:`
- Domain'ai: `dev-finansai.biip.lt`, `staging-finansai.biip.lt`, `finansai.biip.lt`

**Spalvos:** primary deep teal (HSL 184 60% 22%) vietoj hr žalio.

**Pašalinta:** visos HR-specifinės domain'os (employees / departments / leave / orders / onboarding / dashboard / DBSIS).

## 2026-05-15 — Production aplinkos sprendimas

`finansai.biip.lt` Caddy taisyklė — 302 redirect į `staging-finansai.biip.lt`. Atitinka hr precedent'ą: prod aplinka neturi atskiros DB.

## 2026-05-15 — Iteracijų planas

5 iteracijos + bootstrap (Iter 0). Po kiekvienos — nepriklausomas review subagent'as. Tik tada einam toliau. Detalė — [06 — Implementacijos planas](/06-implementacijos-planas).
