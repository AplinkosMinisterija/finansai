# Komisijos daugiapakopis tvirtinimo workflow — dizainas

**Issue:** #9 (Architektūros sprendimas: scope nuo AAD iki visos AM)
**Data:** 2026-05-25
**Statusas:** Patvirtintas dizainas (laukia spec review + plano)

## Kontekstas ir tikslas

Issue #9 proceso schema („Finansų klausimų proceso schema v4") numato **komisijos
svarstymą** — daugiapakopį prašymo tvirtinimą: teikėjas → AM paraiškų administratorius
→ departamentas → kancleris. Šiuo metu egzistuoja `approval_steps` duomenų pamatas,
bet pilnas workflow atidėtas. Šis dizainas užbaigia 3 trūkstamus gabalus:

1. **Grandinės konfigūratorius** — kokie žingsniai ir kokia tvarka.
2. **Per-žingsnį approver priskyrimas** — kas gali spręsti konkretaus lygio žingsnį.
3. **Per-žingsnį sprendimo UI** — kiekvienas approver mato/sprendžia tik savo žingsnį.

### Esama būklė (pamatas, kurį pernaudojam)

- **`approval_steps` lentelė** (`20260519160000_create_approval_steps.ts`): `id`,
  `request_id`, `sequence`, `level_code`, `level_name` (snapshot), `status`
  (`PENDING|APPROVED|REJECTED|RETURNED`), `decided_by_user_id`, `decided_at`,
  `comment`, `created_at`. Be `updated_at` (modelis no-op'ina `$beforeUpdate`).
- **`approval_levels` klasifikatorius** (`02_classifiers_and_budget.ts`): `AM_ADMIN`,
  `DEPARTMENT`, `DIVISION`, `CHANCELLOR`, `DBSIS` (su `sortOrder`).
- **`ClassifierItem`**: turi `code`, `name`, `sortOrder`, `active`, `parentId`.
- **`requests.service.ts`**:
  - `submit` (~l.828): kuria žingsnius iš **hardkodinto** `DEFAULT_WORKFLOW_LEVELS =
    ['AM_ADMIN']` (1 žingsnis). Resubmit iš RETURNED kuria naują seriją (`startSeq`),
    t.y. naują iteraciją.
  - `decision` (~l.1238): pažymi dabartinį PENDING žingsnį; jei APPROVE ir liko PENDING
    žingsnių → `newStatus = SUBMITTED` (keliauja toliau), kitaip APPROVED; sprendimo
    metaduomenys rašomi tik patvirtinus paskutinį žingsnį.
  - `canDecide(viewer, r)` (~l.480): bet kuris AM tvirtintojas (`tenantIsApprover`),
    kurio scope (`amScopeOrgIds`) apima `r.tenant_id`. **Nėra** per-lygio gating.
- **`ApprovalStepsList.tsx`**: rodo žingsnius, grupuoja į iteracijas (round), naujausia
  viršuje. Read-only.
- **`users.am_scope_org_ids text[]`**: esamas masyvo stulpelis (scope) — precedentas
  naujam masyvo stulpeliui.

## Priimti sprendimai (brainstorm)

1. **Viena globali grandinė** (ne per-tenant, ne sąlyginė).
2. **Vartotojai priskiriami lygiams** (kelis lygius vienam vartotojui; leidžia pavadavimą).
3. **Grąžinimas → teikėjui** (resubmit startuoja iš naujo); **atmetimas → terminalus** (REJECTED).
4. **Konfigūracija pernaudoja `/klasifikatoriai`** (grandinė = aktyvūs `approval_levels`)
   **+ `UserDialog`** (vartotojo lygiai).
5. **⚙️ Numatytoji grandinė:** `AM_ADMIN → DEPARTMENT → CHANCELLOR` (aktyvūs); `DIVISION`
   + `DBSIS` neaktyvūs (DBSIS = sistema, ne approver).
6. **⚙️ AM admin (role=admin) = super-approver:** traktuojamas kaip turintis visus
   lygius → gali atblokuoti bet kurį žingsnį, jokio deadlock.

## Architektūra

### 1. Grandinės apibrėžimas

Aktyvi grandinė = `approval_levels` klasifikatoriaus elementai su `active=true`,
surikiuoti pagal `sortOrder`. Valdoma per esamą `/klasifikatoriai` puslapį (AM admin
aktyvuoja/deaktyvuoja + rikiuoja). Helper'is backend'e:

```
getActiveWorkflowChain(): Promise<{ code, name, sortOrder }[]>
  → ClassifierItem.query() WHERE group=approval_levels AND active=true ORDER BY sortOrder
```

Tuščia grandinė (joks lygis neaktyvus) → **fallback** vienas `AM_ADMIN` žingsnis (kad
prašymo pateikimas niekada nesulūžtų).

`level_name` snapshot'inamas į `approval_steps` (kaip dabar) — istorija išlieka net
keičiant klasifikatorių.

### 2. Vartotojo → lygio priskyrimas

Naujas stulpelis `users.approval_level_codes text[]` (default `'{}'`), analogiškas
esamam `am_scope_org_ids`. Reikšmės = `approval_levels` kodai (pvz. `{DEPARTMENT}`).

- Migracija: `ALTER TABLE users ADD COLUMN approval_level_codes text[] NOT NULL DEFAULT '{}'`.
- Modelis `User` + shared `AuthUser`/`User` DTO: `approvalLevelCodes: string[]`.
- `auth.service.ts`: įkrauna `approvalLevelCodes` į sesijos `AuthUser`.
- `users.service.ts` create/update: priima `approvalLevelCodes` (validuoja, kad kodai
  egzistuoja `approval_levels` grupėje); leidžiama tik AM tvirtintojų rolėms (org
  vartotojams lieka tuščia).
- `UserDialog.tsx`: naujas multi-select „Aprobacijos lygiai", matomas tik kai
  redaguojamas AM tvirtintojas su **`role === 'user'`** (analogiškai esamam
  `amScopeOrgIds` select'ui). AM admin'ams lygiai nereikšmingi — jie super-approver'iai
  (žr. §3), tad select'as jiems nerodomas.

### 3. Žingsnio sprendimo teisė

Naujas helper'is (backend + frontend `lib/requests.ts`):

```
canDecideStep(viewer, request, currentStep):
  - viewer turi praeiti esamą canDecide (tenantIsApprover + scope apima request.tenant_id)
  - IR ( viewer.role === 'admin'  // super-approver: visi lygiai
        OR viewer.approvalLevelCodes.includes(currentStep.levelCode) )
```

`currentStep` = pirmas PENDING žingsnis (mažiausias sequence). Jei žingsnių nėra
(senas prašymas be steps) → fallback į esamą `canDecide` (backward compat).

### 4. Žingsnių kūrimas (submit)

`submit` action: `DEFAULT_WORKFLOW_LEVELS` pakeičiamas `getActiveWorkflowChain()`
rezultatu. Per kiekvieną aktyvų lygį (sortOrder tvarka) — PENDING žingsnis su
`sequence = startSeq + i`. Resubmit logika (nauja iteracija) nesikeičia.

### 5. Per-žingsnį sprendimo UI

- **`PrasymoDetailPage.tsx`** sprendimo dialogas: Patvirtinti / Grąžinti / Atmesti
  veiksmai rodomi tik kai `canDecideStep(user, r, currentPendingStep)` = true. Kitiems
  AM tvirtintojams rodoma informacinė juosta „Laukia: {levelName}". Antraštė rodo
  dabartinį lygį.
- **`ApprovalStepsList.tsx`**: dabartinis PENDING žingsnis paryškintas (jau yra);
  pridedamas „Jūsų eilė" ženkliukas, jei dabartinio žingsnio lygis ∈ vartotojo lygiai
  (arba admin). **Prop pakeitimas:** komponentas dabar gauna ne tik `steps`, bet ir
  `viewer` (vartotojo `approvalLevelCodes` + `role`) — reikia atnaujinti iškvietimo
  vietą `PrasymoDetailPage.tsx`.

### 6. Būsenų logika

Nepakitusi, tik grandinė ilgesnė:
- Approve **ne paskutinį** žingsnį → žingsnis APPROVED, prašymas lieka SUBMITTED, kitas
  PENDING. Sprendimo metaduomenys (suma, šaltinis, protokolas, įsakymas) **nerašomi**.
- Approve **paskutinį** žingsnį → prašymas APPROVED; sprendimo metaduomenys rašomi.
- Grąžinti (bet kuriame žingsnyje) → žingsnis RETURNED, prašymas RETURNED (teikėjui);
  resubmit → nauja iteracija nuo 1 žingsnio.
- Atmesti → žingsnis REJECTED, prašymas REJECTED (terminalus).

> Pastaba: sprendimo metaduomenų laukai (įsk. UAT #42 PA-002/003/005/006 perkeltus
> `priority`, `procurementStage`, finansavimo laukus, `decisionOrderDate`) rašomi tik
> patvirtinant **paskutinį** žingsnį — vienoje vietoje, kad neliktų pusinių duomenų.

### 7. Migracija + seed

- Migracija: `users.approval_level_codes text[]`.
- Seed atnaujinimas (`01_initial.ts` / `02_classifiers_and_budget.ts`):
  - `approval_levels`: `AM_ADMIN`, `DEPARTMENT`, `CHANCELLOR` → `active=true`;
    `DIVISION`, `DBSIS` → `active=false`.
  - Demo vartotojai: `am-admin` → visi lygiai (arba paliekam kaip super-approver per
    role); pridedami/priskiriami demo „departamento" ir „kanclerio" tvirtintojai, kad
    demo rodytų 3-pakopį srautą.
- Egzistuojantys in-flight prašymai išlaiko jau sukurtus žingsnius (be backfill).

### 8. Permissions / saugumas

- Lygio gating yra **addityvus** esamam tenant/scope patikrinimui — nemažina jokio
  matomumo apribojimo. DU (ADR-005) nepaliečiamas (workflow nesusijęs su DU duomenimis).
- `approvalLevelCodes` rašymas — tik AM admin (per `users.service` permission gate).

## Komponentų sąrašas (apimtis)

| Sluoksnis | Failai |
|---|---|
| Migracija | `migrations/<ts>_add_approval_levels_to_users.ts` |
| Shared | `packages/shared/src/index.ts` (AuthUser/User += approvalLevelCodes; canDecideStep tipai) |
| Backend | `models/User.ts`, `services/auth.service.ts`, `services/users.service.ts`, `services/requests.service.ts` (getActiveWorkflowChain, submit, decision, canDecideStep) |
| Frontend | `lib/requests.ts` (canDecideStep), `components/users/UserDialog.tsx`, `pages/PrasymoDetailPage.tsx`, `components/requests/ApprovalStepsList.tsx` |
| Seed | `database/seeds/01_initial.ts`, `02_classifiers_and_budget.ts` |
| Docs | VitePress `srcExclude` += `superpowers/**` |

## Testai

**Backend (Jest):**
- `getActiveWorkflowChain` grąžina aktyvius lygius sortOrder tvarka; tuščia → fallback.
- submit kuria N žingsnių iš aktyvios grandinės.
- `canDecideStep`: vartotojas su lygiu gali; be lygio — negali; admin (super) — gali bet kurį.
- daugiapakopis advance: approve 1 žingsnį → SUBMITTED + kitas PENDING; approve paskutinį → APPROVED + metaduomenys.
- grąžinti vidury → RETURNED (teikėjui); resubmit → nauja iteracija.
- atmesti vidury → REJECTED.
- `users.service` priima/validuoja `approvalLevelCodes` (AM only).
- **Backward compat:** egzistuojantis SUBMITTED prašymas su vienu `AM_ADMIN` žingsniu
  vis tiek sprendžiamas teisingai per `canDecideStep` — AM admin (super-approver)
  dengia jį be jokio lygių priskyrimo.

**Frontend (Vitest + RTL):**
- UserDialog rodo lygių multi-select tik AM vartotojui; siunčia `approvalLevelCodes`.
- Sprendimo veiksmai gating'inami pagal dabartinio žingsnio lygį.
- ApprovalStepsList „Jūsų eilė" žyma.

## Ne šios apimties (YAGNI / atskirai)

- Per-tenant ar sąlyginės (sumos/kategorijos) grandinės.
- Grąžinimas vienu žingsniu atgal (tik teikėjui).
- Paralelinis tvirtinimas (tik nuoseklus).
- Lygio žmogaus atostogų/delegavimo mechanizmas (dabar dengia kelių vartotojų vienam
  lygiui + admin super-approver).
- DBSIS kaip automatinis žingsnis (DBSIS lieka neaktyvus; integracija — atskira #3/#13).

## Atviri rizikos punktai

- Numatytoji 3-pakopė grandinė pakeičia naujo prašymo elgesį (3 žingsniai vietoj 1).
  AM admin gali grįžti prie 1 žingsnio deaktyvuodamas lygius `/klasifikatoriai`.
- Egzistuojantys SUBMITTED prašymai liks su 1 žingsniu (sukurtu prieš pakeitimą) —
  tikėtina, bet verta paminėti Giedrei.
