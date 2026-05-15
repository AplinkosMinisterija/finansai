# Diskusijų log

Naujausi įrašai viršuje. Vienas įrašas = vienas sprendimas/diskusija.

## 2026-05-15 — Iter 0 bootstrap

Sukurta projekto struktūra kopijuojant iš `hr` repo. Pakeitimai:

- `biip-hr` → `biip-finansai` visuose package'uose
- `ghcr.io/aplinkosministerija/hr*` → `.../finansai*` image tag'uose
- `/hr` API route prefiksas → `/finansai`
- Cookie `hr_session` → `finansai_session`
- Redis prefiksas `hr:session:` → `finansai:session:`
- Domain'ai: `dev-finansai.biip.lt`, `staging-finansai.biip.lt`, `finansai.biip.lt`

**Spalvos:** primary deep teal (HSL 184 60% 22%) vietoj hr žalio. Vizualus skirtumas akivaizdus, bet aplinka pažįstama (shadcn defaults).

**HR-specifinis kodas pašalintas:**
- Visos employees / departments / leave / orders / onboarding / dashboard / dbsis services
- Visi atitinkami modeliai + migracijos + seeds
- DBSIS integracija (nereikia finansavimo prašymų sistemai)

**Auth supaprastintas:**
- `users.employee_id` FK pašalintas — user'is tiesiogiai turi `full_name`, `email`, `role`
- Iter 1 papildys: `tenant_id`, `am_scope_org_ids`, role enum išplėtimas

**Demo:** vienintelis `demo`/`demo` accountas su role `admin`. Iter 1 pridės 8+ accounts pagal tenantus.

## 2026-05-15 — Production aplinkos sprendimas

`finansai.biip.lt` Caddy taisyklė — 302 redirect į `staging-finansai.biip.lt`. Atitinka hr precedent'ą: prod aplinka neturi atskiros DB, todėl `finansai` + `finansai-api` servisai vienoje `profiles: [development, staging]` grupėje.

Kai (jei) bus reikalas pilnos prod aplinkos:
1. biip-infra: išplėsti hr-style pattern'ą prod profilui
2. Sukurti `finansai` DB prod postgres per `postgres-createdb.yml`
3. Pakeisti Caddyfile iš redirect į reverse_proxy

## 2026-05-15 — Iteracijų planas

5 iteracijos + bootstrap (Iter 0). Po kiekvienos — nepriklausomas review subagent'as. Tik tada einam toliau. Detalė — [06 — Implementacijos planas](/06-implementacijos-planas).
