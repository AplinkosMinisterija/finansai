# 05 — Prašymo modelis (Iter 2)

::: warning DRAFT
Šis dokumentas detalizuojamas Iter 2 metu. Pirminis projektas remiasi SharePoint'e naudotos lentelės struktūra.
:::

## Excel laukų grupavimas į wizard'o žingsnius

SharePoint lentelėje yra ~30 laukų vienoje eilutėje. Suskaidom į 5 logines grupes (wizard'as kaip GPAIS):

### 1. Pagrindinė informacija
- IS projektas (pavadinimas)
- Projekto iniciatorius (org)
- Informacinė sistema (IT sistemos kodas/pavadinimas)
- Projekto tipas (free text, pvz. „IT sistema", „Licencijos")
- Projekto aprašymas
- Planuojami atlikti darbai
- Pirkimo stadija (enum: Pradėtas / Vykdomas / Užbaigtas / —)
- Prioritetas (1-5 arba —)

### 2. Finansavimas
| Eilutė | Suma € |
| --- | --- |
| DU (darbo užmokestis) | numeric(10,2) |
| Įranga / licencijos | numeric(10,2) |
| Kūrimas | numeric(10,2) |
| Analizė | numeric(10,2) |
| Vystymas | numeric(10,2) |
| Palaikymas | numeric(10,2) |
| Modernizavimas | numeric(10,2) |
| Likvidavimas | numeric(10,2) |
| **Iš viso prašoma (be DU)** | computed |
| Finansavimas iš IT | numeric(10,2) |
| Kitos lėšos | numeric(10,2) |
| Kitų lėšų šaltinis | string |

### 3. Ketvirtinis paskirstymas
- Planuojama Q1, Q2, Q3, Q4 (numeric, suma turi sutapti su „iš viso prašoma")

### 4. Atsakingi asmenys
- Atsakinga įstaiga
- Projektą vykdantis asmuo (free text)
- El. paštas
- Projekto įgyvendinimo terminas (data)
- Pastabos

### 5. Sprendimas (AM admin/user pildo)
- Skirtas naujas finansavimas 2026 (numeric)
- Naujai skirto finansavimo šaltinis
- Posėdžio protokolas (numeris/data)
- Įsakymo data ir nr.
- Komentaras (jei grąžinama pataisymui arba atmetama)

## Statusų mašina

```
              ┌─────────────────────────────────────────┐
              │                                         │
              ▼                                         │
        ┌─────────┐  submit   ┌───────────┐  return    │
        │  DRAFT  │ ────────▶ │ SUBMITTED │ ─────────┐ │
        └─────────┘           └───────────┘          │ │
              ▲                  │     │             ▼ │
              │                  │     │      ┌─────────────┐
              │   edit           │     │      │  RETURNED   │
              └──────────────────┘     │      └─────────────┘
                                       │             │ submit
                                       ▼             │
                              ┌───────────────┐      │
                              │   APPROVED    │◀─────┘
                              │   REJECTED    │
                              └───────────────┘
```

- **DRAFT** — submitter pildo, auto-save
- **SUBMITTED** — pateikta AM peržiūrai, submitter nebegali keisti
- **RETURNED** — AM grąžino pataisymui su komentaru; submitter vėl gali keisti
- **APPROVED** — AM patvirtino (su sprendimo metaduomenimis)
- **REJECTED** — AM atmetė (su priežastimi)

## Comments / Audit log

```sql
CREATE TABLE request_comments (
  id            SERIAL PRIMARY KEY,
  request_id    INTEGER NOT NULL REFERENCES requests(id),
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  kind          VARCHAR(32) NOT NULL,  -- 'comment' | 'status_change' | 'edit'
  body          TEXT,
  metadata      JSONB,                 -- old_status, new_status, changed_fields
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Detalė — Iter 2 implementacijos planas.
