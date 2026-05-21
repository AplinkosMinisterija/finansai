# FVM Master Plan — 8 iteracijos

> **Status**: aktyvus. Numatomas startas: 2026-05-21. Numatoma trukmė: ~12 sav.
>
> Live progress — žr. [PROGRESS.md](./PROGRESS.md).

## Bendros prielaidos

- **Source of truth**: Giedrės FVM_Techninis_uzsakymas.docx v0.1 ([kopija](./spec/FVM-v0.1.md)).
- **Scope**: pilnas FVM = Stream 1 (§3 docx — esamos sistemos pakeitimai) + Stream 2 (§4 — naujas FVM sluoksnis).
- **Esamas state**: Iter 0–8 baigti (MVP + post-MVP enhancement'ai). FVM tęsia kaip Iter 9–16.
- **Branch flow**: kiekvienos iteracijos darbai commit'inami į `dev` po audit'o → auto-deploy į dev-finansai.biip.lt. Staging/prod tagai — po Iter 16.
- **Architektūros nukrypimai nuo docx**: dokumentuojami [03-decisions-log.md](./03-decisions-log.md). Jokių silent deviations.

## Iteracijos ciklas (uniform per visas 8)

Kiekviena iteracija sudaryta iš 4 fazių:

### 1. Brief (CTO)
- Sudaromas detalus task planas: `iter-NN-name.md`
- Pasirenkama komandos sudėtis (kurie subagentai, kokios kompetencijos)
- Apibrėžiami **audit kriterijai** — kuo bus matuojama sėkmė
- Identifikuojamos prielaidos ir rizikos

### 2. Komandos darbas
- Dispatch'inami subagentai per `Agent` įrankį (general-purpose, code-simplifier, explore — pagal poreikį)
- Paraleliniai taskai — kai galima (backend + frontend dirbantys nepriklausomose srityse)
- CTO peržiūri intermediate output, sustabdo grybavimą
- Po komandos atidirbimo — visi changes commit'inami į `dev` (be push! push tik po audit pass)

### 3. Nepriklausomas auditas
- Atskiras subagentas (nesusijęs su implementacija) gauna:
  - Acceptance kriterijus (iš briefingo)
  - Spec sekciją (iš docx)
  - Patikrinimo metodologiją: kodą, testus, schema, run-time behavior
- Output: pass/fail per kriterijų + rekomendacijos jeigu nepakanka

### 4. CTO sprendimas
- **Pass**: commit'as push'inamas į `dev`, atnaujinama `PROGRESS.md`, sukuriamas commit'as „Iter NN: `<pavadinimas>`", einame į kitos iter brief'ą
- **Fail**: identifikuojami konkretūs gaps, dispatch'inamas fix taskas (gali būti naujas subagentas arba ta pati komanda)
- **Loop**: tas pats audit'as kartojamas iki pass

## Iteracijos overview

### Iter 9 (FVM-1) — Foundation: funding_sources + budget_allocations

**Tikslas**: nauja 1–2 lygio DB schema veikia, esami duomenys migruoti, AM admin gali valdyti šaltinius ir paskirstymą per UI.

**Trukmė**: 1.5 sav.

**Apima**: §2.1, §2.2, §6.1, §6.2, F01, F02 iš docx.

**Komandos sudėtis**: Backend Engineer, DBA, Frontend Engineer.

**Pagrindiniai deliverables**:
- Migracija: `funding_sources` lentelė
- Migracija: `budget_allocations` rebuild (funding_source_id FK)
- Data migration: esamas 2026 1.5M seed → nauja struktūra
- Klasifikatoriai: `budget_category`, `funding_source_type` grupės su default items
- Backend: `funding-sources.service.ts`, `budgets.service.ts` refactor, modeliai
- Frontend: `/finansavimo-saltiniai` puslapis, `/biudzetas` perdaryta UI
- Integration testai

**Audit kriterijai**: žr. `iter-09-foundation.md`

### Iter 10 (FVM-2) — Stream 1: Request integration

**Tikslas**: prašymo modelis papildytas FVM laukais; wizard'as turi biudžeto kategorijos žingsnį; AM patvirtinimo ekranas leidžia įvesti approved amount ir koreguoti kategoriją.

**Trukmė**: 1.5 sav.

**Apima**: §3 (P01–P06), F03 (preparation — pilnai sukursi Iter 11).

**Komandos sudėtis**: Backend, Frontend, QA.

**Pagrindiniai deliverables**:
- Migracija: `requests` papildoma `budget_category_id`, `funding_source_type_id`, `spec_program_funding_type` (enum: atskiras|biudzeto_dalis|NULL), `fvm_project_id` (FK į projects, kol kas NULL)
- Wizard: naujas žingsnis arba sub-section „Biudžeto informacija" tarp finansavimo ir ketvirčių
- Approval screen: rodo institucijos pasirinkimą, leidžia AM korekciją, įveda approved_amount (jau yra kaip `decision_granted_amount`)
- Dashboard: papildoma kategorijos breakdown'as
- Backward compatibility: seni prašymai be naujų laukų toliau veikia

**Audit kriterijai**: P01–P06 kiekvienas verifikuojamas pagal docx aprašymą.

### Iter 11 (FVM-3) — Projects (3 lygis) + auto-create

**Tikslas**: nauja `projects` lentelė + servisas + UI; AM patvirtinus spec. programos prašymą — automatiškai (arba per mygtuką) sukuriamas projekto įrašas su request_id ir biudžetu = approved_amount.

**Trukmė**: 1.5 sav.

**Apima**: §2.4, §4.2, §6.3, F03, F04, F05.

**Komandos sudėtis**: Backend, Frontend.

**Pagrindiniai deliverables**:
- Migracija: `projects` lentelė pagal §6.3
- `project.service.ts` — CRUD + lifecycle (planuojama → vykdoma → baigta → uždaryta)
- Auto-create logika: AM approval → `project` insert su tipas=spec_programa, request_id, biudzetas
- Frontend: `/projektai` puslapis (list + detail + create wizard)
- Wizard ne-spec-programa projektams (rankinis sukūrimas)
- Patvirtinto prašymo detalėje rodomas link'as į sukurtą projektą (jei yra)

**Audit kriterijai**: §2.4 visi laukai egzistuoja; §4.2 funkcijos veikia; auto-create flow testuojamas end-to-end.

### Iter 12 (FVM-4) — Expenses + budget remainder

**Tikslas**: faktinių išlaidų kaupimas; automatinis likučio skaičiavimas; įspėjimai per 80% (konfigūruojama).

**Trukmė**: 1.5 sav.

**Apima**: §4.3, §6.4, F06, F07, F08, F11.

**Komandos sudėtis**: Backend, Frontend.

**Pagrindiniai deliverables**:
- Migracija: `expenses` lentelė pagal §6.4 (jsonb `saltinio_dalis` daugiašalti distribution)
- `expense.service.ts` — CRUD + auto-reduce budget_allocation likučio
- Budget summary endpoint: planuota/faktinė/likutis per allocation ir per project
- Warnings: kai likutis < 20% planuotos → flag projektui ir allocation
- Frontend: islaidu sąrašas projekto detalėje + multi-source distribution UI
- Frontend: warning indikatoriai dashboard'e ir biudžeto puslapyje
- Konfigūracija: warning threshold settings UI (AM admin)

**Audit kriterijai**: 100 išlaidų vienam projektui — likutis teisingas; multi-source split sumuoja į expense total; warning trigger'inasi.

### Iter 13 (FVM-5) — Payroll (DU)

**Tikslas**: darbuotojo finansinis profilis + DU paskirstymas per finansavimo šaltinius; automatinis mėnesio DU kaštų skaičiavimas.

**Trukmė**: 2 sav. (didesnė dėl permission'ų ir UI sudėtingumo).

**Apima**: §4.4, §6.5, §6.6, F09, F10.

**Komandos sudėtis**: Backend, Frontend, Security Reviewer.

**Pagrindiniai deliverables**:
- Migracija: `payroll_profiles` + `payroll_distributions` lentelės
- `payroll.service.ts` — CRUD + monthly compute job
- **Permission**: atlyginimo duomenis mato tik AM admin + institucijos vadovas (savo komandai). Specialistas savo duomenų NEMATO.
- Integration: kas mėnesį DU expense'ai automatiškai kuriami expense.service'e (DU type)
- Frontend: `/du` puslapis su strict access control
- Frontend: `/du` distribution UI (profilis × šaltinis × procentas/fiksuota)
- Security audit: penetration-style permission testai

**Audit kriterijai**: ne-įgaliotas vartotojas NEGALI matyti atlyginimo (403 visiems endpoint'ams + UI gating); DU distribution sumuoja į 100% per profilį; mėnesinis recompute job veikia idempotentiškai.

### Iter 14 (FVM-6) — Reports + Excel/PDF Export

**Tikslas**: ataskaitų generavimas su Excel ir PDF eksportu.

**Trukmė**: 1.5 sav.

**Apima**: §4.5, F12, F13, F14.

**Komandos sudėtis**: Backend, Frontend.

**Pagrindiniai deliverables**:
- `report.service.ts` enhancement — naudoja naują FVM datą
- Šablonai:
  1. Biudžeto vykdymo: planuota vs faktinė vs likutis per šaltinį + kategoriją
  2. Spec. programos: prašyta → patvirtinta → panaudota
  3. DU paskirstymo: kas kiek iš kurio šaltinio per laikotarpį
- Excel eksportas: `exceljs` arba panašu (.xlsx)
- PDF eksportas: server-side render (puppeteer ar pdfkit)
- Frontend: `/ataskaitos` puslapis su filtrais + download mygtukais

**Audit kriterijai**: trys šablonai generuojasi su realiais duomenimis; Excel atsidaro be klaidų; PDF turi LT'ašiukus ir formatavimą; AM admin filter veikia.

### Iter 15 (FVM-7) — FVM Dashboard + multi-year planning

**Tikslas**: dedikuotas FVM dashboard'as + galimybė kopijuoti praėjusių metų biudžetą į naujus metus.

**Trukmė**: 1 sav.

**Apima**: §3.4 (Stream 1 dashboard papildymai jau Iter 10), F15, F16.

**Komandos sudėtis**: Frontend, UX, Backend (light).

**Pagrindiniai deliverables**:
- `/fvm` arba HomePage refactor: FVM dashboard
- Komponentai: biudžeto suvestinė, artėjantys terminai, pavojaus signalai (per Iter 12 warning system)
- F16: „Kopijuoti biudžetą iš {praėję metai}" mygtukas
- Multi-year navigation: metų picker AM admin'ams
- UX polish: visi nauji puslapiai vienodu stiliumi, accessible (a11y)

**Audit kriterijai**: dashboard rodo realią datą iš FVM lentelių; copy biudžeto kuria naujas funding_sources + budget_allocations sumomis iš source year'o; UX consistency check.

### Iter 16 (FVM-8) — E2E + Staging + Production

**Tikslas**: E2E testai padengia happy + critical paths; staging UAT su Giedre; prod deploy.

**Trukmė**: 1.5 sav.

**Apima**: visi spec'o flow'ai end-to-end.

**Komandos sudėtis**: QA, DevOps, all team for fix-on-the-fly.

**Pagrindiniai deliverables**:
- Playwright E2E suite — bent 5 critical user journeys:
  1. AM admin sukuria funding_source → budget_allocations → mato biudžetą
  2. Institucija pateikia spec programos prašymą → AM tvirtina → projektas auto-sukurtas
  3. Institucija atsiskaito ketv ataskaita; expenses kaupiasi; likutis mažėja
  4. AM admin žiūri DU paskirstymą (permission test integruotas)
  5. AM admin generuoja metinę biudžeto vykdymo ataskaitą + Excel download
- Migration rehearsal staging'e su real data dump (jei yra)
- CLAUDE.md atnaujinta
- README + docs/ atnaujinta
- `docs/06-implementacijos-planas.md` papildytas FVM iter 9-16 sekcijomis su ✅
- Demo data refresh
- Push į `main` (staging deploy) → Giedrės UAT → tag X.Y.Z (prod deploy)

**Audit kriterijai**: visi E2E pereinami; nė vienas regression iš ankstesnių Iter 0–8 funkcijų; Giedrės UAT sign-off; staging veikia 24h be klaidų prieš prod tag'inimą.

## Rizikos ir mitigation

| Rizika | Tikimybė | Impact | Mitigation |
|---|---|---|---|
| Data migration sulaužo esamus duomenis | Med | High | Migration testai prieš push; rollback migracija; staging rehearsal Iter 16 |
| Giedrė pakeičia spec mid-flight | Med | Med | Spec versionavimas docs/fvm/spec/; ADR per nukrypimą |
| Permission bug atskleidžia DU duomenis | Low | Critical | Iter 13 dedicated security reviewer + penetration-style testai |
| Performance issue su daug expense'ų | Med | Med | Iter 16 load testing su 10k expenses/projektui (per §8 docx Q3) |
| Audit per griežtas — visad fail | Low | Med | Audit kriterijai conservative ir verifikuojami; nebandyti "perfectionism trap" |

## Audit'oriaus rolė (detaliau)

Nepriklausomas auditas — atskiras subagentas, kuris **nematė** implementacijos komandos darbo, gauna tik:
1. Iteracijos brief (`iter-NN-*.md`) — kas turėjo būti padaryta
2. Spec sekcija (iš docx) — kaip turi atrodyti
3. Acceptance kriterijai — taškiniai patikrinimai

Audit'oriaus output formatas:

```
## Iter NN audit

### Kriterijus 1: <pavadinimas>
- Status: PASS / FAIL / PARTIAL
- Įrodymas: <code path, test output, screenshot>
- Pastabos: <jei FAIL/PARTIAL — ką trūksta>

### Kriterijus 2: ...
...

### Bendras verdiktas
- READY TO SHIP / NEEDS WORK
- Jei NEEDS WORK — top 3 priority fixes
```

CTO (aš) **negaliu** būti auditorius savo plano — tai pažeidžia nepriklausomumą. Auditas visada per `Agent` įrankį.

## Kas eina į `docs/diskusijos.md`

Kiekvienos iteracijos pabaigoje — vienas entry su data, kas padaryta, kokie buvo audit findings, kokie sprendimai priimti. Tas pats stilius kaip esami Iter 0–8 entry.

## Versija

- v1.0 — 2026-05-21 — Pradinis planas (CTO Claude).
