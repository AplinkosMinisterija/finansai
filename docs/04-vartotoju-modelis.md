# 04 — Vartotojų modelis (Iter 1)

::: warning DRAFT
Šis dokumentas detalizuojamas Iter 1 metu. Aktualus tik bendras planas.
:::

## Tenants

```sql
CREATE TABLE tenants (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(32) UNIQUE NOT NULL,  -- 'AM', 'AAD', 'VSTT', 'LGT'
  name          VARCHAR(200) NOT NULL,        -- 'Aplinkos ministerija'
  is_approver   BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE tik AM
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Seed:
- AM (is_approver=TRUE)
- AAD — Aplinkos apsaugos departamentas
- VSTT — Valstybinė saugomų teritorijų tarnyba
- LGT — Lietuvos geologijos tarnyba

## Users (Iter 1 plėtimas)

Iter 1 pridės migraciją:
```sql
ALTER TABLE users
  ADD COLUMN tenant_id INTEGER REFERENCES tenants(id),
  ADD COLUMN am_scope_org_ids INTEGER[] DEFAULT NULL;
-- role enum išplečia: 'admin' | 'am_admin' | 'am_user' | 'org_admin' | 'org_user'
```

## Permission matrix

| Operacija                          | am_admin | am_user           | org_admin | org_user      |
| ---------------------------------- | -------- | ----------------- | --------- | ------------- |
| Matyti visus AM vartotojus         | ✅       | ✅ (read-only)    | ❌        | ❌            |
| Valdyti AM vartotojus              | ✅       | ❌                | ❌        | ❌            |
| Matyti savo org vartotojus         | n/a      | n/a               | ✅        | ✅ (read-only) |
| Valdyti savo org vartotojus        | n/a      | n/a               | ✅        | ❌            |
| Matyti visas paraiškas             | ✅       | ✅ tik scope org'ų | ❌        | ❌            |
| Matyti savo org paraiškas          | n/a      | n/a               | ✅        | ❌            |
| Matyti savo (=user) paraiškas      | n/a      | n/a               | ✅        | ✅            |
| Teikti paraišką savo org vardu     | ❌       | ❌                | ✅        | ✅            |
| Tvirtinti/atmesti paraišką         | ✅       | ✅ tik scope org'ų | ❌        | ❌            |

## Scope checking pattern (Iter 1)

```ts
function canViewRequest(user: AuthUser, request: Request): boolean {
  if (user.role === 'am_admin') return true;
  if (user.role === 'am_user') {
    return user.amScopeOrgIds === null
      || user.amScopeOrgIds.includes(request.tenantId);
  }
  if (request.tenantId !== user.tenantId) return false;
  if (user.role === 'org_admin') return true;
  return request.createdByUserId === user.id;
}
```

Detalė — Iter 1 implementacijos planas.
