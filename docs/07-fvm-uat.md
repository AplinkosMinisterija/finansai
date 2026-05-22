# 07 — FVM UAT klausimai Giedrei

> **Skirta**: Giedrei (techninio užsakymo autorei). Iter 9–16 įgyvendinta — atvirų klausimų sąrašas + UAT smoke checklist.
>
> **Statusas**: ship-ready v0.3.0 stagingo'e. Po Giedrės sign-off — production tag.

## TL;DR

FVM (Finansų valdymo modulis) pilnai įgyvendintas pagal `FVM_Techninis_uzsakymas.docx v0.1`. 2 sprendimai padaryti **nukrypstant nuo docx'o** — reikia tavo patvirtinimo prieš tag'inant production. Plius keletas dalykų UAT metu pasižiūrėti.

## Reikia tavo sprendimo

### 1. ADR-001 — `kategorija` ir `tipas` per klasifikatorių (ne SQL enum)

**Kontekstas**: Tavo techniniame užsakyme:
- §6.1 `funding_source.tipas` aprašyta kaip `enum(biudzetas, ES, kita)`
- §6.2 `budget_allocation.kategorija` aprašyta kaip `enum(DU, spec_programa, prekes_paslaugos, investicijos, kita)`

**Ką padariau**: vietoj SQL enum naudoju **klasifikatoriaus referencijas** (FK į `classifier_items`):
- `funding_sources.tipas_classifier_item_id` → grupė `funding_source_type` (3 default items: biudzetas, es, kita)
- `budget_allocations.category_classifier_item_id` → grupė `budget_category` (5 default items: du, spec_programa, prekes_paslaugos, investicijos, kita)

**Kodėl**: sistema jau turi išvystytą klasifikatorių modelį (kurį tu pati patvirtinai per issue #7 ir #8 — IS kodai, projekto tipai, šaltinio programa). AM admin gali pridėti naują kategoriją per `/klasifikatoriai` UI **be deploy'o**. SQL enum keitimas reikalauja migracijos.

**Tavo sprendimas**:
- 🟢 **OK, palik klasifikatorių** — tai mūsų dabartinis state. Default items įdėti, viskas veikia.
- 🔴 **Atstatyti į enum** — galiu padaryti, ~1 dienos darbas (migracija + servisų refactor + testų update). Bet AM admin tada nebegalės pridėti naujų kategorijų be tavęs/Arūno.

Aš asmeniškai linkstu prie 🟢, bet sprendimas tavo.

### 2. ADR-003 — Payroll be Sodra/GPM mokesčių apskaitos

**Kontekstas**: Tavo techninio užsakymo §8 klausimas: „Ar payroll modulis turėtų skaičiuoti darbdavio mokesčius (Sodra ir kt.) ar tik bruto sumą?"

**Ką padariau**: tik **bruto + priedai**. Mokesčių apskaita NĖRA įgyvendinta. Pagrindimas — docx §4.4: „Supaprastintas DU valdymas finansinio planavimo tikslams. Nesikerta su HR sistema."

Tai reiškia, kad ataskaitose DU eilutė rodys bruto + priedai, bet faktinis išleistas pinigų kiekis (su Sodra ~32% papildomai) realybėje bus didesnis.

**Tavo sprendimas**:
- 🟢 **Tinka taip** — bruto pakankamas finansiniam planavimui. HR sistema tvarko mokesčius atskirai.
- 🟡 **Pridėti darbdavio koeficientą** (~+1.477 Sodra) — paprastas multiplier per setting'ą. ~0.5 dienos darbo.
- 🔴 **Pilna Sodra/GPM apskaita** — sudėtinga, keičiasi tarifai, lubos. ~1 sav. darbo + ongoing maintenance.

## UAT smoke checklist (stagingo'e po deploy)

Login `am-admin` / `demo` ir pratestuok:

### Finansavimo šaltiniai (Iter 9)
- [ ] `/finansavimo-saltiniai` rodo 2 šaltinius (VB 2026: 1.5M, ES 2026: 500k — per seed)
- [ ] „Naujas šaltinis" mygtukas — atsidaro dialog'as, gali sukurti naują
- [ ] Klikti šaltinį → matosi allocations su sumomis ir likučiu

### Biudžeto paskirstymas
- [ ] `/biudzetas` rodo 5 allocations: DU, spec.programa, prekės/paslaugos, investicijos, kita
- [ ] Kategorijos per dropdown'ą — AM admin gali pridėti naują (eik į `/klasifikatoriai` → grupė `budget_category` → naujas item → grįžk į `/biudzetas` → naujas item matosi dropdown'e)
- [ ] Faktinė + Likutis kolonos parodo SUM(expenses) — turėtų būti < planuotos
- [ ] Warning'as raudonu/geltonu jei kuri allocation > 80%

### Prašymas + auto-create FVM projektas (Iter 10-11)
- [ ] Wizard'as turi naują žingsnį „Biudžetas" tarp Finansavimas ir Ketvirčiai
- [ ] Pasirinkus „Specialioji programa" kategoriją — atsiranda papildomas finansavimo tipo radio
- [ ] AM patvirtinant spec.programa prašymą → matosi „Sukurti FVM projektą" mygtukas
- [ ] Paspaudus mygtuką → sukuriamas projektas `/projektai/:id`
- [ ] Tas pats prašymas — link'as „Žiūrėti projektą →" vietoj „Sukurti" mygtuko

### Projektai (Iter 11)
- [ ] `/projektai` rodo seed'inį spec.programa projektą + regular projektą
- [ ] Klikti → detail puslapyje matosi metaduomenys, status, biudžetas, susijusios išlaidos
- [ ] „Pakeisti statusą" — planuojama → vykdoma; baigta → uzdaryta tik AM admin

### Išlaidos + multi-source split (Iter 12)
- [ ] Projekto detalė → „Pridėti išlaidą" → dialog'as su tipas (du/sutartis/saskaita/tiesiogine)
- [ ] Įjungus „Padalinti tarp finansavimo šaltinių" — matosi multi-row UI; live total su skirtumu
- [ ] Po pridėjimo → biudžeto likutis ir warning'ai atsinaujina

### DU / payroll (Iter 13) — saugumo kritinis
- [ ] AM admin: `/du` matomas Sidebar'e, atsidaro be problemų; matosi seed'iniai profile'iai
- [ ] AM admin: „Apskaičiuoti mėnesį" mygtukas — pasirink mėnesį → sukuria DU expense'us projekte
- [ ] **Logout. Login `aad-user` / `demo` (specialistas)**:
  - [ ] Sidebar'e NĖRA „DU" punkto
  - [ ] URL'as `/du` → redirect'as į `/` su toast'u
  - [ ] `/ataskaitos` → DU tab'as NĖRA matomas
  - [ ] `/expenses` (jei pasieks per URL) — DU expense'ai NEROMI sąraše
- [ ] Logout, login atgal `am-admin`

### Ataskaitos + Excel/PDF (Iter 14)
- [ ] `/ataskaitos` rodo 3 tabs
- [ ] Biudžeto vykdymas: pasirink metus → „Generuoti" → atvaizduojama lentelė; „Excel" download → atsidaro Excel'yje su LT diakritiniais (š, ą, č, ę…)
- [ ] Spec.programos: tas pats; PDF download — LT diakritiniai turi atsirasti teisingai
- [ ] DU paskirstymas: pasirink laikotarpį → matuoja kas iš kurio šaltinio; PDF/Excel

### FVM dashboard + multi-year (Iter 15)
- [ ] HomePage rodo FVM section su 4 cards (Planuota/Faktinė/Likutis/%)
- [ ] „Top įspėjimai" + „Artėjantys terminai" sąrašai
- [ ] Year picker → keičia rodomus duomenis
- [ ] `/finansavimo-saltiniai` → „Kopijuoti iš praėjusių metų" mygtukas → dialog'as → kopija į 2027

## Po UAT — sign-off

Kai pratestavai ir sutinki:
- Atsakyk Arūnui (arba pažymėk šitame faile): „ADR-001 ✅, ADR-003 ✅, UAT ✅"
- Arūnas tag'ins `v0.3.0` → production deploy

Jei kažkas nuvilia — pažymėk konkrečiai, kas. Galima vienam dalykui taisyti vienai dienai be perdarymo viso plano.

## Failai detalesnei peržiūrai (jei nori)

- **Master planas + 8 iteracijų aprašymas**: github.com/AplinkosMinisterija/finansai/blob/dev/docs/fvm/00-master-plan.md
- **Architektūros sprendimai (5 ADR)**: github.com/AplinkosMinisterija/finansai/blob/dev/docs/fvm/03-decisions-log.md
- **Tavo originalus docx (pandoc-konvertuotas)**: github.com/AplinkosMinisterija/finansai/blob/dev/docs/fvm/spec/FVM-v0.1.md
- **Diskusijų log su pamokomis**: github.com/AplinkosMinisterija/finansai/blob/dev/docs/diskusijos.md

## Versija

- v1.0 — 2026-05-22 — Pradinis UAT klausimynas.
