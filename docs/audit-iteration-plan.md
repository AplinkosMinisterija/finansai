# Audit'o įgyvendinimo planas — iteracijos

Pagrindas — `docs/audit-2026-05-19.md` (12 patobulinimų).

Kiekviena iteracija:
1. Implementacija (subagent)
2. Nepriklausoma review (atskiras subagent)
3. Jei OK — PR per kiekvieną patobulinimą, merge į dev
4. Tik tada toliau

PR'ai per kiekvieną patobulinimą atskiri (Giedrei matomi).

## Iteracija 1 — Kritinės bug'ai

| # | Patobulinimas | Failas | Effort |
|---|---|---|---|
| 1 | Biudžeto validacija (total ≥ allocated) | `budgets.service.ts:upsert` | S |
| 3 | Plan conversion DRAFT validation | `requests.service.ts:convertPlanToCurrentYear` | S |
| 10 | Decision action ne-atominė → trx | `requests.service.ts:decision` | M |

Iteracija 1 baigta kai visi trys merge'inti į dev + review'ę praėjo.

## Iteracija 2 — Vidutinės (TS tipai, dashboard)

| # | Patobulinimas | Failas | Effort |
|---|---|---|---|
| 5 | `grantedAmount: any` → griežtas tipas | `requests.service.ts:decision` | S |
| 6 | Decimal helper'is shared | per visus services | M |
| 8 | Dashboard per-tenant year filter | `dashboard.service.ts` | S |

## Iteracija 3 — Kodo kokybė

| # | Patobulinimas | Failas | Effort |
|---|---|---|---|
| 2 | Approval workflow vizualizacija (Round N) | `requests.service`, `ApprovalStepsList.tsx` | M |
| 4 | Permissions duplikacija → shared lib | `requests/`, `requestAttachments` | M |
| 9 | Base64 validacija per Buffer.from | `requestAttachments.service.ts` | S |

## Iteracija 4 — UX žemo prioriteto

| # | Patobulinimas | Failas | Effort |
|---|---|---|---|
| 7 | Attachment delete frontend pre-check | `AttachmentList.tsx` | S |
| 11 | Biudžeto suvestinė panaudojimo | `BiudzetasPage.tsx` | S |
| 12 | Sistemos grupių apsauga | `KlasifikatoriaiPage.tsx` | S |

## Workflow per iteraciją

```
[Sub agent: implement task]
        ↓
[Sub agent: review (PASS/FAIL)]
        ↓
   PASS? → PR + merge dev → next task
   FAIL? → grąžinti implement'eriui su pastabom → repeat
```

PR'ai į `dev` branch'ą, „Closes" reference'as nedarys close (assignee Giedrei testavimui).
