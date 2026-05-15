# 02 — MVP scope

## Iter 0 (DONE)

- Repo bootstrap pagal `hr` template
- Deploy pipeline į dev / staging (prod redirect)
- Blank shell + sesijos auth + 1 demo accountas

## MVP scope (Iter 1-4)

### Vartotojai

- Tenants lentelė (AM + 3-5 pavaldžios institucijos)
- Users su tenant_id, role enum (admin/user, plus AM specialūs am_admin/am_user)
- AM useriams — `am_scope_org_ids` array (kuriose organizacijose mato paraiškas; NULL = visos)
- Login: sessions Redis (kaip hr)
- UI: vartotojų sąrašas, sukūrimas, redagavimas (role-based)

### Prašymai (paraiškos)

- Vienas `requests` table su loginiais laukų grupėmis pagal Excel struktūrą:
  1. **Pagrindinė informacija**: projekto pavadinimas, iniciatorius (org), IT sistema, projekto tipas, aprašymas, planuojami darbai, pirkimo stadija, prioritetas
  2. **Finansavimas**: DU, įranga/licencijos, kūrimas, analizė, vystymas, palaikymas, modernizavimas, likvidavimas + viso prašoma + finansavimas iš IT + kitos lėšos
  3. **Ketvirtinis paskirstymas**: planuojama Q1/Q2/Q3/Q4 (suma turi sutapti su viso)
  4. **Atsakingi asmenys**: institucija, projektą vykdantis asmuo, el. paštas, įgyvendinimo terminas, pastabos
  5. **Sprendimas (AM only)**: skirta suma, šaltinis, protokolas, įsakymo data/nr.
- Statusai: `DRAFT` → `SUBMITTED` → `RETURNED`/`APPROVED`/`REJECTED`
- Ping-pong: `RETURNED` su komentaru → submitter pataiso → `SUBMITTED` vėl
- Komentarų gija ir audito log

### NEįeina į MVP

- **Ketvirtinės ataskaitos** (Q1/Q2/Q3/Q4 atlikti darbai, panaudotos lėšos, rizikos) — Iter 6+
- **Metinė ataskaita** (suplanuotų darbų atlikimo %, projektų perkėlimo į kitus metus pažymėjimas) — Iter 6+
- **DBSIS integracija** — finansavimas neturi formalaus pasirašymo flow, tai DBSIS čia nereikia
- **VIISP / SSO** — demo passwordais; vėliau pridėsim biip-auth-api
- **Power BI integracija** — vėliau
- **Stebėsenos teisės** (atskiri vartotojai-stebėtojai be redagavimo) — Iter 7+
- **Email pranešimai** — vėliau
