# 02 — MVP scope

## MVP — kas yra (Iter 0-8) ✅

### Vartotojai ir organizacijos

- **Tenants lentelė** — AM + pavaldžios institucijos (AAD, VSTT, LGT). Lengvai išplečiama per UI organizacijų valdymo puslapį.
- **Users** — tenant_id, `role` enum (`admin` arba `user`), `am_scope_org_ids` (tik AM specialistams).
- **Sesijos** per Redis (HttpOnly cookie, 7d TTL).
- **UI: `/vartotojai`** — sąrašas su filtru pagal organizaciją, sukūrimas, redagavimas. Shadcn primitives: Select organizacijai/rolei, Checkbox aktyvumui, MultiSelect AM scope'ui.
- **UI: `/organizacijos`** (tik AM admin) — CRUD organizacijoms su saugikliais (negalima ištrinti su vartotojais/prašymais).

### Prašymai (paraiškos)

Vienas `requests` table su loginiais laukų grupėmis pagal Excel struktūrą:

1. **Pagrindinė informacija**: projekto pavadinimas, iniciatorius (org), IT sistema, projekto tipas, aprašymas, planuojami darbai, pirkimo stadija, prioritetas
2. **Finansavimas**: DU, įranga/licencijos, kūrimas, analizė, vystymas, palaikymas, modernizavimas, likvidavimas + finansavimas iš IT + kitos lėšos (+ auto-skaičiavimas viso prašoma)
3. **Ketvirtinis paskirstymas**: planuojama Q1/Q2/Q3/Q4 (suma turi sutapti su viso)
4. **Atsakingi asmenys**: institucija, projektą vykdantis asmuo, el. paštas, įgyvendinimo terminas, pastabos
5. **Sprendimas (AM only)**: skirta suma, šaltinis, protokolas, įsakymo data/nr.

**Statusai:** `DRAFT` → `SUBMITTED` → `RETURNED` / `APPROVED` / `REJECTED`

**Ping-pong:** `RETURNED` su komentaru → submitter pataiso → `SUBMITTED` vėl

**Komentarų gija** ir audito log su kind tipais (`comment`, `status_change`, `submitted`, `returned`, `approved`, `rejected`).

**Specialybė:** AM administratorius gali teikti prašymą *kitos* organizacijos vardu — naudinga, kai org. dar neturi savo vartotojo, bet AM jau pasiruošęs įvesti.

### Pradžios puslapis (`/`)

Role-tailored dashboardas:

- **AM admin/specialistui** — „Laukia mano tvirtinimo" sąrašas, prašoma/skirta sumos, vartotojai, per-organizaciją skirstinys, mini 12 mėn dinamikos grafikas.
- **Org. admin/spec.** — savo prašymų būsenos, „Reikia pataisyti" sąrašas (jei yra grąžintų), pateiktų/patvirtintų metrikos, mini dinamika.

### Statistika (`/statistika`)

Pilna analitinė peržiūra: 12 mėn dinamikos bar pora, status donut, per-organizaciją horizontalūs barai (AM scope), money summary cards.

## MVP — ko nėra

- **Ketvirtinės ataskaitos** (Q1/Q2/Q3/Q4 atlikti darbai, panaudotos lėšos, rizikos) — vėliau
- **Metinė ataskaita** (suplanuotų darbų atlikimo %, projektų perkėlimo į kitus metus pažymėjimas) — vėliau
- **DBSIS integracija** — finansavimas neturi formalaus pasirašymo flow, tai DBSIS čia nereikia
- **VIISP / SSO** — kol kas demo passwordai; vėliau pridėsim biip-auth-api SSO
- **Power BI integracija** — galbūt vėliau, kai statistika nepakaks
- **Stebėsenos teisės** (atskiri vartotojai-stebėtojai be redagavimo) — vėliau
- **Email pranešimai** apie status pakeitimus — vėliau
- **In-app notifikacijos / aktyvumo feed'as** — vėliau
- **Failų pridėjimas prie prašymo** — vėliau (kol kas tik tekstas + komentarai)

## Iteracijų santrauka

| Iter | Kas | Statusas |
|---|---|---|
| 0 | Repo bootstrap + deploy pipeline + sesijos auth | ✅ |
| 1 | Tenants, vartotojai, role-based scope | ✅ |
| 2 | Prašymo schema + API | ✅ |
| 3 | 5 žingsnių wizard'as | ✅ |
| 4 | AM tvirtinimo flow + ping-pong | ✅ |
| 5 | Docsai, testai, polish | ✅ |
| 6 | Rolių modelio supaprastinimas (4→2) + UI polish | ✅ |
| 7 | Organizacijų valdymas (UI) | ✅ |
| 8 | Statistika su grafikais | ✅ |

Detalė — [06 — Implementacijos planas](/06-implementacijos-planas).
