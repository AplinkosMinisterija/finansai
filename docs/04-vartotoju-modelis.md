# 04 — Vartotojų ir organizacijų modelis

> **Trumpai:** sistemoje yra dvi rolės — `admin` ir `user`. Ką ta rolė reiškia, sprendžia *vartotojo organizacijos tipas* (`tenant.is_approver`). Aplinkos ministerija yra vienintelis tvirtintojas; visos pavaldžios institucijos — teikėjai.

## Kam to reikia?

Senas modelis turėjo keturias roles (`am_admin`, `am_user`, `org_admin`, `org_user`) — bet jos faktiškai dubliuodavo informaciją: jei jau žinai, kad vartotojas yra iš AM, „am_admin" tik papildomai pasako, kad jis administratorius. Tas pats būtų pasiekiama nustatant `role = 'admin'` + `tenant.is_approver = TRUE`.

Praktiškai keturių rolių modelis sukurdavo neaiškumus: *„o kas, jei pavaldžios institucijos vartotojui priskirsiu `am_admin`? Ar jis tada gali tvirtinti svetimos org prašymus?"* — atsakymas: niekas, nes role'ę tikrina ne tik pati rolė, bet ir tenant.is_approver. Vietoj kodavimo dviejose vietose perkėlėm semantiką į vieną — tenant'ą.

## Organizacijos (tenants)

```sql
CREATE TABLE tenants (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(32) UNIQUE NOT NULL,     -- 'AM', 'AAD', 'VSTT', 'LGT'
  name          VARCHAR(200) NOT NULL,           -- 'Aplinkos ministerija'
  description   TEXT,                            -- trumpas aprašymas
  is_approver   BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE tik AM
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Seed organizacijos:

| Kodas | Pavadinimas | Tvirtintojas? |
|---|---|---|
| AM | Aplinkos ministerija | ✅ |
| AAD | Aplinkos apsaugos departamentas | ❌ |
| VSTT | Valstybinė saugomų teritorijų tarnyba | ❌ |
| LGT | Lietuvos geologijos tarnyba | ❌ |

> Sistema palaiko kelis tvirtintojus, bet praktiškai AM yra vienintelis. „Tvirtintojas" — tai organizacija, kurios `admin` rolės vartotojai gali patvirtinti ar atmesti kitų org. prašymus.

## Vartotojai (users)

```sql
-- Migracijos iš Iter 1
ALTER TABLE users
  ADD COLUMN tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  ADD COLUMN role TEXT NOT NULL DEFAULT 'user',     -- 'admin' | 'user'
  ADD COLUMN am_scope_org_ids INTEGER[] DEFAULT NULL;
```

`am_scope_org_ids` aktualus **tik** AM specialistui (aprover tenant + `user` rolė):

- `NULL` → mato visus pavaldžių org prašymus
- `[2, 5]` → mato tik tų organizacijų prašymus

Kitiems vartotojams šis laukas ignoruojamas.

## Rolės semantika

| Tenant tipas | role | Etiketė UI'e | Pagrindiniai gebėjimai |
|---|---|---|---|
| Tvirtintojas (AM) | `admin` | AM administratorius | CRUD organizacijos + vartotojai + tvirtina visus prašymus + gali teikti prašymus **kitos org. vardu** |
| Tvirtintojas (AM) | `user` | AM specialistas | Tvirtina/grąžina/atmeta tik pagal scope priskirtus prašymus |
| Pavaldi org. | `admin` | Org. administratorius | Valdo savo org. vartotojus, mato visus savo org. prašymus, gali teikti naują, redaguoti bet kurį DRAFT/RETURNED |
| Pavaldi org. | `user` | Org. specialistas | Mato/teikia/redaguoja tik savo prašymus |

## Permission matrica

| Operacija | AM admin | AM specialistas | Org. admin | Org. spec. |
|---|---|---|---|---|
| Matyti visas org'as | ✅ | ✅ | ❌ (tik savo) | ❌ (tik savo) |
| Valdyti org'as | ✅ | ❌ | ❌ | ❌ |
| Matyti visus AM vartotojus | ✅ | ✅ read-only | ❌ | ❌ |
| Valdyti AM vartotojus | ✅ | ❌ | ❌ | ❌ |
| Matyti savo org vartotojus | n/a | n/a | ✅ | ✅ read-only |
| Valdyti savo org vartotojus | n/a | n/a | ✅ | ❌ |
| Matyti visus prašymus | ✅ | ✅ tik scope | ❌ | ❌ |
| Matyti savo org prašymus | n/a | n/a | ✅ | ❌ |
| Matyti savo (=user) prašymus | n/a | n/a | ✅ | ✅ |
| Teikti prašymą savo org vardu | ❌ | ❌ | ✅ | ✅ |
| **Teikti prašymą KITOS org vardu** | ✅ | ❌ | ❌ | ❌ |
| Tvirtinti/grąžinti/atmesti | ✅ | ✅ tik scope | ❌ | ❌ |

## AM administratoriaus teikimas „kitos org. vardu"

Kartais pavaldi org. neturi savo vartotojo, bet AM jau žino, kad reikia įvesti prašymą — tada AM admin pats sukuria juodraštį, **bet pasirenka, kurios organizacijos vardu** jis teikiamas. Tas prašymas:

- Priklauso pasirinktai org'ai (`tenant_id` = ta org.)
- Kūrėjas (`created_by_user_id`) — pats AM admin
- Pateikimo metu — eina į tos org. queue, ne į AM
- Org'os admin mato jį savo prašymų sąraše ir gali redaguoti / pateikti / ištrinti (kaip ir bet kurį savo org. prašymą)

> Apsauga: AM specialistui (`user` rolei aprover tenant'e) ši galimybė *neprieinama*. Tik AM `admin`.

## Permission check pavyzdys (TypeScript)

```ts
function canViewRequest(viewer: AuthUser, r: { tenantId: number; createdByUserId: number }): boolean {
  if (viewer.tenantIsApprover) {
    if (viewer.role === 'admin') return true;
    return viewer.amScopeOrgIds === null || viewer.amScopeOrgIds.includes(r.tenantId);
  }
  if (r.tenantId !== viewer.tenantId) return false;
  if (viewer.role === 'admin') return true;
  return r.createdByUserId === viewer.id;
}
```

Praktiškai šitokie helper'iai gyvena dviejose vietose — frontend'e (`apps/web/src/lib/requests.ts`) ir backend'e (`apps/api/src/services/requests.service.ts`). Backendas yra autoritetinis šaltinis (frontas tik slepia mygtukus).

## Demo prisijungimai

Visiems slaptažodis — `demo`. Vartotojo vardas — kaip žemiau:

| Username | Tenant | Role | Scope |
|---|---|---|---|
| `demo` | AM | admin | viskas |
| `am-admin` | AM | admin | viskas |
| `am-user` | AM | user | viskas (null scope) |
| `am-user-aad` | AM | user | tik AAD prašymai |
| `aad-admin` | AAD | admin | savo org |
| `aad-user` | AAD | user | savo prašymai |
| `vstt-admin` | VSTT | admin | savo org |
| `vstt-user` | VSTT | user | savo prašymai |
| `lgt-admin` | LGT | admin | savo org |
| `lgt-user` | LGT | user | savo prašymai |
