# FVM Architecture Decision Records (ADR)

ADR — short structured records of architectural decisions. Naujausi viršuje. Kiekvienas ADR turi: statusą (Proposed | Accepted | Superseded | Deprecated), kontekstą, sprendimą, alternatyvas, pasekmes.

## ADR-005 — DU duomenų izoliacija per `is_du_system` flag + `canViewPayroll`

**Status**: Accepted (priimta Iter 13D + 13E security fix'uose 2026-05-22)

**Data**: 2026-05-22

**Klausimas**: Per Iter 13 payroll įgyvendinimą Security Reviewer'is aptiko, kad nors `payroll.service.ts` permission gate'ai veikia tinkamai, DU duomenys leak'ina per gretimus servisus (`expenses.list/get`, `projects.list/get/summary`, `budgetAllocations.summary`, `expenses.budgetSummary`). Kaip apsaugoti DU duomenis cross-service'iu būdu be susikomplikavimo?

**Sprendimas**: 4-sluoksnis defense:

1. **DB flag**: `projects.is_du_system boolean NOT NULL DEFAULT false` kolona stabilus identifikatorius. Payroll computeMonth set'ina į true; visi kiti — false.

2. **Permission helper'iai**:
   - `canViewPayroll(user)` (FE + BE): true tik AM admin + org_admin. Specialist visada false.
   - `requireDuAccess(meta, tenantId?)` (BE): throw 403 jei !canViewPayroll arba cross-tenant.
   - `requireAmDuAccess(meta)` (BE): throw 403 jei !AM admin (computeMonth-only).

3. **SQL filter'iai per VISUS data endpoint'us**:
   - `expenses.list`: `WHERE tipas != 'du'` jei `!canViewPayroll(me)`
   - `expenses.get`: 404 NOT_FOUND (ne 403) jei DU expense ir `!canViewPayroll`
   - `projects.list`: `WHERE is_du_system = false` jei `!canViewPayroll`
   - `projects.get/summary`: 404 jei `isDuSystem` ir `!canViewPayroll`
   - `budgetAllocations.list/summary`: `whereNotExists` join į classifier_items DU + tenant scope
   - `fundingSources.list`: tenant scope (org_user tik savo tenant'as)
   - `*.summary` SUM užklausos: `whereNot('tipas', 'du')` jei `!canViewPayroll` (defense-in-depth)

4. **Frontend defense-in-depth**: `ExpensesSection`, `ProjektaiPage` po-filter; `DuPage` route guard; Sidebar gating.

**Pagrindimas**:
- DB flag aiškiau nei pavadinimo match'as (Iter 13D pradinis sprendimas — atmestas)
- `canViewPayroll` centralizuota logika — vienas point of truth
- 404 ne 403 — DU expense/projekto ID egzistavimas neatskleidžiamas (security best practice)
- Defense-in-depth: jei vienas sluoksnis sulūš, kiti laikys
- SQL filter'iai (ne post-process) — saugiai, performance OK, lengviau audit

**Alternatyvos atmestos**:
- Hard-coded pavadinimo match'as — trapus, lengvai sulaužomas
- Atskira `du_expenses` lentelė — dvigubas data model, sunku integruoti su budgetSummary
- Cron'inis privacy scan — reaktyvus, ne prevencinis
- Hashing aprasymas lauke — vis tiek leak sumos

**Pasekmės**:
- Kiekvienas naujas endpoint'as, kuris grąžina expenses ar projects, turi galvoti apie DU filter'ą
- `canViewPayroll` ir `is_du_system` tampa cross-cutting concerns FVM
- Migracija backfill'ina esamus DU sistemos projektus per pavadinimo prefix'ą
- Iter 14+ reports endpoint'ai turės naudoti tuos pačius filter'us

**Verified per testus**: 49 DU-specific testai per 6 service'us (payroll, expenses, projects, budgetAllocations, fundingSources, requests). Specialist negali sužinoti DU duomenų per JOKIUS endpoint'us.

---

## ADR-004 — Primary key tipas: SERIAL integer (ne UUID)

**Status**: Accepted (priimta CTO peržiūros metu Iter 9B)

**Data**: 2026-05-21

**Klausimas**: Pradinis `01-architecture.md` (v1.0) siūlė visiems FVM lentelėms `uuid PRIMARY KEY DEFAULT gen_random_uuid()`. DBA implementuodamas pastebėjo, kad VISA esama codebase (`tenants`, `users`, `requests`, `classifier_*`, `request_*`, `approval_steps`, `budgets`) naudoja `t.increments('id')` — auto-increment integer (serial). Iter 9B DBA pasirinko integer, nes FK konsistencija svarbesnė už docx schemos raidiškumą.

**Sprendimas**: Visi FVM lentelių `id` ir FK — **integer (SERIAL)**. Atnaujintas `01-architecture.md`. UUID galima būtų pridėti vėliau atskira migracija, jei kada prireiks (pvz., distributed system, external-facing IDs).

**Pagrindimas**:
- Foreign key consistency su esamomis lentelėmis
- Migracijos paprastesnės (negalima maišyt integer FK su uuid FK)
- Performance: 4 bytes vs 16 bytes per row; index'ai mažesni
- Codebase'as jau prijungtas prie šio convention'o per Objection.js modelius

**Alternatyvos atmestos**:
- UUID — reikštų migruoti visą codebase (tenants, users, requests, etc.) → out of scope
- Mixed (UUID FVM, integer legacy) — FK conflicts, painu maintainerams

**Pasekmės**:
- Frontend per API gaus number'inius ID'us (jau ir taip taip yra)
- API contracts dokumentuoti su `id: number` (ne string UUID)
- Jokio FK conversion'o nereikia
- Reverso pakeitimas (jei prireiks UUID) — atskira fazė, didelis darbas

---

## ADR-003 — Payroll mokesčiai: tik bruto, ne Sodra/GPM

**Status**: Accepted (Iter 13 patvirtino 2026-05-22)

**Data**: 2026-05-21

**Klausimas**: Docx §8 klausimas — „Ar payroll modulis turėtų skaičiuoti darbdavio mokesčius (Sodra ir kt.) ar tik bruto sumą?"

**Sprendimas**: Pradžiai — **tik bruto**. Per `payroll_profiles.atlyginimas_bruto + priedai` ir per `payroll_distributions` paskirstom šitą bruto sumą tarp finansavimo šaltinių. Mokesčių (Sodra, GPM, darbdavio dalis) apskaita NĖRA įgyvendinama Iter 13.

**Pagrindimas**:
- Docx §4.4: „Supaprastintas DU valdymas finansinio planavimo tikslams. Nesikerta su HR sistema."
- Mokesčių logika sudėtinga ir keičiasi (tarifai, lubos). HR sistema (atskira) tikriausiai jau tvarko.
- Bruto + priedai pakankamas finansiniam planavimui.

**Alternatyvos atmestos**:
- Pilna mokesčių apskaita — per didelis scope, dubliuos HR; riziką kad ne sutampu su HR realybe
- Procentinis darbdavio koeficientas (pvz., +1.4774 už Sodra) — apytikslis, klaidins

**Pasekmės**:
- Iter 13 scope mažesnis, baigsim per 2 sav.
- Ataskaitose DU eilutė bus „pagal bruto + priedai", aiškiai nurodyta
- Future: jei Giedrė pareikalaus pilnos mokesčių apskaitos → atskira fazė po Iter 16

---

## ADR-002 — Expenses multi-source distribution: jsonb (ne junction)

**Status**: Accepted (Iter 12 implementuosim; revisit jei perf issues)

**Data**: 2026-05-21

**Klausimas**: Docx §8 klausimas — „Ar jsonb laukas saltinio_dalis (išlaidų dalijimas) tinkamas sprendimas ar geriau atskira junction lentelė?"

**Sprendimas**: Naudoti **jsonb** lauką `expenses.saltinio_dalis` formato `[{ "funding_source_id": "...", "suma": NNN.NN }, ...]`. Kai išlaida vieno šaltinio — jsonb yra NULL ir naudojam `expenses.budget_allocation_id` susijusio šaltinio.

**Pagrindimas**:
- Daugumai expenses single-source — NULL field, mažesnė I/O.
- Schemai paprasčiau (mažiau JOIN'ų).
- PostgreSQL gerai supportina jsonb (GIN indeksai, `jsonb_array_elements` agregacijos).
- Junction lentelė reikalautų papildomo CRUD ir indekso — vertė neproporcinga issue'ui.

**Alternatyvos atmestos**:
- Junction lentelė `expense_distributions(expense_id, funding_source_id, suma)` — labiau normalizuota, bet:
  - Reikia papildomos service/CRUD complexity
  - Daugumai cases overkill (vieno šaltinio expenses dominuoja)
  - Kiekvienam create — dvigubas insert (atomicityness su transaction'u)
- Stored procedure su agregacijomis — overengineering MVP fazei

**Pasekmės**:
- Budget summary endpoint'ai naudoja `jsonb_array_elements` PostgreSQL function — žinoti reikia
- Migracija į junction (jei reikės) — vienkartinis script'as: iter through expenses, expand jsonb → junction inserts
- Iter 12 tests apima multi-source split scenarijus ir budget remainder validity

**Re-visit trigger**: jei query laikas > 500ms per budget summary su realistic data — perkelti į junction (ADR-002 superseded).

---

## ADR-001 — `kategorija` ir `tipas` per klasifikatorių (ne enum)

**Status**: Accepted (priimta CTO + naudotojo diskusijoje 2026-05-21)

**Data**: 2026-05-21

**Klausimas**: Docx §6.1 nurodo `funding_source.tipas` kaip `enum(biudzetas, ES, kita)`. Docx §6.2 nurodo `budget_allocation.kategorija` kaip `enum(DU, spec_programa, prekes_paslaugos, investicijos, kita)`. Ar implementuoti kaip SQL enum / TS literal type, ar kaip FK į `classifier_items`?

**Sprendimas**: Naudoti **klasifikatoriaus referenciją** abiems laukams.

- `funding_sources.tipas_classifier_item_id` → `classifier_items.id` (grupė `funding_source_type`)
- `budget_allocations.category_classifier_item_id` → `classifier_items.id` (grupė `budget_category`)

Default seedinami klasifikatoriaus items pagal docx enum vertes.

**Pagrindimas**:
1. `finansai` sistema jau turi išvystytą klasifikatoriaus modelį (PRs #10, #11), kurį AM admin valdo per `/klasifikatoriai` UI.
2. SQL enum keitimas reikalauja migracijos. AM gali norėti pridėti naują kategoriją be deploy.
3. Konsistentiškumas su esamais klasifikatoriais (IS code, projekto tipas, source program — visi per klasifikatorius).
4. Klasifikatoriaus items leidžia lokalizaciją (jei kada prireiks), sort order, active/inactive.
5. Default items seedinami pirmoje migracijoje — vartotojui neatrodo skirtumas iš pradžių.

**Alternatyvos atmestos**:
- SQL enum — užrakina docx 5 vertes; bet kuris naujas kategorija → migracija → deploy. AM admin to nepaaiškinsi.
- TS string literal — tas pats apribojimas, tik aukštesniame sluoksnyje.
- Hibridas (enum + custom field) — sukelia 2 source of truth painiavą.

**Pasekmės**:
- Frontend dropdown'ai per `ClassifierSelect` componentą (jau egzistuoja)
- Default seedų kūrimas Iter 9 migracijoje
- Audit kriterijus Iter 9: AM admin gali pridėti naują kategoriją per /klasifikatoriai → matosi budget allocation create dialog'e
- Spec deviation flagged — jei Giedrė nori griežto enum, galima migruoti (small effort)

**Risk**: Giedrė gali norėti griežto enum. Jeigu Iter 9 staging UAT metu paaiškės — ADR superseded, migracija į enum.

---

## ADR template

```markdown
## ADR-NNN — <Title>

**Status**: Proposed | Accepted | Superseded by ADR-MMM | Deprecated

**Data**: YYYY-MM-DD

**Klausimas**: <konkretus klausimas>

**Sprendimas**: <galutinis pasirinkimas>

**Pagrindimas**: <kodėl>

**Alternatyvos atmestos**: <kas dar buvo svarstyta ir kodėl ne>

**Pasekmės**: <kas pasikeičia, kokie nauji constraints, kas reikia atminti>
```
