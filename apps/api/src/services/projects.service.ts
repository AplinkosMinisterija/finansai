/**
 * Projects servisas (Iter 11, FVM-3) — 3 FVM lygis.
 *
 * Atsako į klausimą „Kas konkrečiai išleidžia?" — projektai, spec.programos
 * arba skyriaus veiklos, kurios faktiškai naudoja biudžetą.
 *
 * Permission modelis (žr. `docs/fvm/01-architecture.md` §Permission modelis):
 *  - `list` / `get` / `summary` — visi autentifikuoti vartotojai;
 *    org users automatiškai scope'inami į savo tenant
 *  - `create` — AM admin (bet kuriame tenant'e) + org_admin (tik savo)
 *  - `update` — AM admin + org_admin (savo tenant); CAN'T change tipas,
 *    tenant_id, request_id po sukūrimo
 *  - `delete` — tik AM admin; RESTRICT'inta į status='planuojama'
 *  - `changeStatus` — AM admin + org_admin (savo tenant); reverse tranzicijos
 *    leidžiamos tik AM admin
 *
 * Verslo invariantai:
 *  - `pavadinimas` required (min 1 char)
 *  - `biudzetas` > 0
 *  - Jei `tipas === 'spec_programa'` → `requestId` REQUIRED, request turi
 *    būti APPROVED, request.budgetCategoryId privalo rodyti į `spec_programa`
 *    item'ą klasifikatoriuje
 *  - `pradziosData <= pabaigosData` (jei abi nurodytos)
 *  - `budgetAllocationId` privalo priklausyti tenant'ui per
 *    `funding_sources.tenant_id` chain'ą
 *
 * REST aliases (`api.service.ts`):
 *  - GET    /projects                 → projects.list
 *  - GET    /projects/:id             → projects.get
 *  - GET    /projects/:id/summary     → projects.summary
 *  - POST   /projects                 → projects.create
 *  - PATCH  /projects/:id             → projects.update
 *  - DELETE /projects/:id             → projects.delete
 *  - PATCH  /projects/:id/status      → projects.changeStatus
 */
import type { ServiceSchema, Context } from 'moleculer';
import { Errors } from 'moleculer';
import type {
  Project as ProjectDTO,
  ProjectChangeStatusDTO,
  ProjectCreateDTO,
  ProjectListQuery,
  ProjectStatus,
  ProjectSummary,
  ProjectType,
  ProjectUpdateDTO,
} from '@biip-finansai/shared';
import { BudgetAllocationV2 } from '../models/BudgetAllocationV2';
import { ClassifierItem } from '../models/ClassifierItem';
import { Expense } from '../models/Expense';
import { FundingSource } from '../models/FundingSource';
import { Project } from '../models/Project';
import { Request } from '../models/Request';
import { Tenant } from '../models/Tenant';
import { User } from '../models/User';
import { centsToAmount, normalizeAmount, toCents } from '../utils/money';
import { calculatePercentUsed, calculateWarningFlags } from '../utils/fvm';
import { canViewPayroll } from '../utils/permissions';
import type { AuthMeta } from './auth.service';

const SPEC_PROGRAMA_CODE = 'spec_programa';

const PROJECT_TYPES: readonly ProjectType[] = [
  'projektas',
  'spec_programa',
  'veikla',
];

const PROJECT_STATUSES: readonly ProjectStatus[] = [
  'planuojama',
  'vykdoma',
  'baigta',
  'uzdaryta',
];

/**
 * Forward tranzicijų grafas. Reverse tranzicijos (visi kiti perėjimai į
 * mažesnį indeksą) leidžiamos tik AM admin.
 */
const FORWARD_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  planuojama: ['vykdoma'],
  vykdoma: ['baigta'],
  baigta: ['uzdaryta'],
  uzdaryta: [],
};

/**
 * Statuso, į kurį pereiti gali TIK AM admin (papildomai prie forward'ų).
 * Pvz., baigta → uzdaryta yra „forward", bet uždarymas yra finalinė
 * operacija ir AM atsakomybėje.
 */
const AM_ONLY_FORWARD_TARGETS: ProjectStatus[] = ['uzdaryta'];

type ProjectWithRels = Project & {
  tenant?: Tenant;
  budgetAllocation?: BudgetAllocationV2;
  request?: Request;
  atsakingasUser?: User;
};

function toDTO(p: ProjectWithRels): ProjectDTO {
  return {
    id: p.id,
    tenantId: p.tenantId,
    tenantCode: p.tenant?.code,
    tenantName: p.tenant?.name,
    budgetAllocationId: p.budgetAllocationId,
    budgetAllocationName: p.budgetAllocation?.pavadinimas,
    requestId: p.requestId,
    requestProjectName: p.request?.projectName ?? null,
    pavadinimas: p.pavadinimas,
    tipas: p.tipas,
    biudzetas: p.biudzetas,
    pradziosData: p.pradziosData,
    pabaigosData: p.pabaigosData,
    statusas: p.statusas,
    atsakingasUserId: p.atsakingasUserId,
    atsakingasUserName: p.atsakingasUser?.fullName ?? null,
    aprasymas: p.aprasymas,
    isDuSystem: p.isDuSystem,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function requireMe(ctx: Context<unknown, AuthMeta>): NonNullable<AuthMeta['user']> {
  if (!ctx.meta.user) {
    throw new Errors.MoleculerClientError('Neautentifikuota', 401, 'AUTH_REQUIRED');
  }
  return ctx.meta.user;
}

function requireAmAdmin(me: NonNullable<AuthMeta['user']>): void {
  if (!me.tenantIsApprover || me.role !== 'admin') {
    throw new Errors.MoleculerClientError(
      'Šis veiksmas leidžiamas tik AM administratoriui',
      403,
      'FORBIDDEN',
    );
  }
}

function isAmAdmin(me: NonNullable<AuthMeta['user']>): boolean {
  return me.tenantIsApprover && me.role === 'admin';
}

function isOrgAdmin(me: NonNullable<AuthMeta['user']>): boolean {
  return !me.tenantIsApprover && me.role === 'admin';
}

/**
 * Patikrina, ar vartotojas gali rašyti (create / update / changeStatus)
 * projekto duomenis tenant'e `tenantId`:
 *  - AM admin gali viskuose tenant'uose
 *  - Org admin tik savo tenant'e
 *  - Kiti — 403
 */
function requireWriteAccess(
  me: NonNullable<AuthMeta['user']>,
  tenantId: number,
): void {
  if (isAmAdmin(me)) return;
  if (isOrgAdmin(me) && me.tenantId === tenantId) return;
  throw new Errors.MoleculerClientError(
    'Neturite teisės valdyti šios organizacijos projektų',
    403,
    'FORBIDDEN',
  );
}

/**
 * Patikrina, ar vartotojas gali matyti tenant'o projektus:
 *  - AM admin / AM user (su scope arba pilnu prieigu) — taip
 *  - Org user'iai / org admin'ai — tik savo tenant
 */
function requireReadAccess(
  me: NonNullable<AuthMeta['user']>,
  tenantId: number,
): void {
  if (me.tenantIsApprover) {
    if (me.role === 'admin') return;
    // AM user — scope check (NULL = visi)
    if (me.amScopeOrgIds === null) return;
    if (me.amScopeOrgIds.includes(tenantId)) return;
    throw new Errors.MoleculerClientError(
      'Neturite teisės matyti šio projekto',
      403,
      'FORBIDDEN',
    );
  }
  if (me.tenantId !== tenantId) {
    throw new Errors.MoleculerClientError(
      'Neturite teisės matyti šio projekto',
      403,
      'FORBIDDEN',
    );
  }
}

async function loadProject(id: number): Promise<ProjectWithRels | undefined> {
  const p = await Project.query()
    .findById(id)
    .withGraphFetched('[tenant, budgetAllocation, request, atsakingasUser]');
  return p as ProjectWithRels | undefined;
}

/**
 * Validate'ina ar `budgetAllocationId` priklauso konkretaus tenant'ui:
 *  - allocation egzistuoja
 *  - jos `funding_source.tenant_id === tenantId`
 *
 * Throw'ina LT klaidos žinutę bet kokiame neatitikime.
 */
async function validateAllocationBelongsToTenant(
  allocationId: number,
  tenantId: number,
): Promise<BudgetAllocationV2> {
  const allocation = await BudgetAllocationV2.query()
    .findById(allocationId)
    .withGraphFetched('fundingSource');
  if (!allocation) {
    throw new Errors.MoleculerClientError(
      'Biudžeto eilutė nerasta',
      400,
      'INVALID_BUDGET_ALLOCATION',
    );
  }
  const allocWithRel = allocation as BudgetAllocationV2 & {
    fundingSource?: FundingSource;
  };
  if (!allocWithRel.fundingSource) {
    // Korumpuotas duomuo — funding_source visada turi būti FK target.
    throw new Errors.MoleculerClientError(
      'Biudžeto eilutės finansavimo šaltinis nerastas',
      500,
      'BUDGET_ALLOCATION_INCONSISTENT',
    );
  }
  if (allocWithRel.fundingSource.tenantId !== tenantId) {
    throw new Errors.MoleculerClientError(
      'Pasirinkta biudžeto eilutė priklauso kitai organizacijai',
      400,
      'ALLOCATION_TENANT_MISMATCH',
    );
  }
  return allocation;
}

/**
 * Specifinė spec_programa tipo validacija:
 *  - requestId privalomas
 *  - request egzistuoja ir status = APPROVED
 *  - request.budgetCategoryId rodantis į `spec_programa` klasifikatoriaus item'ą
 *  - request.tenantId atitinka projekto tenantId
 *  - request dar neturi fvmProjectId (kad neapdubliuotume)
 */
async function validateSpecProgramaRequest(
  requestId: number | null | undefined,
  tenantId: number,
): Promise<Request> {
  if (requestId === null || requestId === undefined) {
    throw new Errors.MoleculerClientError(
      'Spec. programos projektui privaloma nurodyti susietą prašymą',
      400,
      'SPEC_PROGRAMA_REQUEST_REQUIRED',
    );
  }
  const r = await Request.query()
    .findById(requestId)
    .withGraphFetched('budgetCategory');
  if (!r) {
    throw new Errors.MoleculerClientError(
      'Susietas prašymas nerastas',
      400,
      'REQUEST_NOT_FOUND',
    );
  }
  if (r.status !== 'APPROVED') {
    throw new Errors.MoleculerClientError(
      'Spec. programos projektas gali būti susietas tik su patvirtintu prašymu',
      400,
      'REQUEST_NOT_APPROVED',
    );
  }
  if (r.tenantId !== tenantId) {
    throw new Errors.MoleculerClientError(
      'Susietas prašymas priklauso kitai organizacijai',
      400,
      'REQUEST_TENANT_MISMATCH',
    );
  }
  const rWithCat = r as Request & { budgetCategory?: ClassifierItem };
  if (
    !rWithCat.budgetCategory ||
    rWithCat.budgetCategory.code !== SPEC_PROGRAMA_CODE
  ) {
    throw new Errors.MoleculerClientError(
      'Susieto prašymo biudžeto kategorija turi būti „Specialioji programa"',
      400,
      'REQUEST_NOT_SPEC_PROGRAMA',
    );
  }
  if (r.fvmProjectId !== null) {
    throw new Errors.MoleculerClientError(
      'Šiam prašymui projektas jau sukurtas',
      400,
      'REQUEST_ALREADY_HAS_PROJECT',
    );
  }
  return r;
}

/**
 * Validate'ina datų logiką: jei abi nurodytos — pradzia <= pabaiga.
 */
function validateDates(
  pradziosData: string | null | undefined,
  pabaigosData: string | null | undefined,
): void {
  if (!pradziosData || !pabaigosData) return;
  if (pradziosData > pabaigosData) {
    throw new Errors.MoleculerClientError(
      'Pradžios data negali būti vėlesnė už pabaigos datą',
      400,
      'INVALID_DATE_RANGE',
    );
  }
}

interface ChangeStatusParams {
  id: number;
  statusas: ProjectStatus;
}

/**
 * Patikrina ar statuso pakeitimas leistinas:
 *  - Forward (pvz. planuojama → vykdoma) — leidžia org_admin ir AM admin,
 *    išskyrus AM_ONLY_FORWARD_TARGETS (uzdaryta) — tik AM admin
 *  - Reverse (mažesnis indeksas) — tik AM admin
 *  - Neegzistuojantis perėjimas (pvz. planuojama → uzdaryta) — 400
 */
function validateStatusTransition(
  me: NonNullable<AuthMeta['user']>,
  from: ProjectStatus,
  to: ProjectStatus,
): void {
  if (from === to) {
    throw new Errors.MoleculerClientError(
      'Projektas jau yra šio statuso',
      400,
      'STATUS_UNCHANGED',
    );
  }
  const fromIdx = PROJECT_STATUSES.indexOf(from);
  const toIdx = PROJECT_STATUSES.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) {
    throw new Errors.MoleculerClientError(
      'Nežinomas projekto statusas',
      400,
      'INVALID_STATUS',
    );
  }
  const isReverse = toIdx < fromIdx;
  if (isReverse) {
    if (!isAmAdmin(me)) {
      throw new Errors.MoleculerClientError(
        'Atstatyti projekto statusą gali tik AM administratorius',
        403,
        'STATUS_REVERSE_FORBIDDEN',
      );
    }
    return;
  }
  // Forward — bet ne būtinai į kaimyninį statusą; ribojam į vieną žingsnį
  // (planuojama → vykdoma → baigta → uzdaryta), kad nepasišoktume per
  // tarpinius būvius.
  const allowed = FORWARD_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new Errors.MoleculerClientError(
      `Neleistinas projekto statuso pakeitimas iš „${from}" į „${to}"`,
      400,
      'INVALID_STATUS_TRANSITION',
    );
  }
  if (AM_ONLY_FORWARD_TARGETS.includes(to) && !isAmAdmin(me)) {
    throw new Errors.MoleculerClientError(
      'Uždaryti projektą gali tik AM administratorius',
      403,
      'STATUS_TRANSITION_AM_ONLY',
    );
  }
}

const ProjectsService: ServiceSchema = {
  name: 'projects',

  actions: {
    list: {
      params: {
        tenantId: { type: 'number', integer: true, optional: true, convert: true },
        status: {
          type: 'enum',
          values: ['planuojama', 'vykdoma', 'baigta', 'uzdaryta'],
          optional: true,
        },
        type: {
          type: 'enum',
          values: ['projektas', 'spec_programa', 'veikla'],
          optional: true,
        },
        allocationId: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
        },
        requestId: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
        },
        year: { type: 'number', integer: true, optional: true, convert: true },
      },
      async handler(ctx: Context<ProjectListQuery, AuthMeta>): Promise<ProjectDTO[]> {
        const me = requireMe(ctx);
        const q = Project.query()
          .withGraphFetched(
            '[tenant, budgetAllocation, request, atsakingasUser]',
          )
          .orderBy([{ column: 'id', order: 'desc' }]);

        // Tenant scope pre-filtering:
        //  - AM admin / AM user su scope=null — visi
        //  - AM user su scope — tik scope'o organizacijos
        //  - Org users — tik savo tenant
        if (me.tenantIsApprover) {
          if (me.role === 'user' && me.amScopeOrgIds !== null) {
            if (me.amScopeOrgIds.length === 0) {
              return [];
            }
            q.whereIn('projects.tenant_id', me.amScopeOrgIds);
          }
        } else {
          q.where('projects.tenant_id', me.tenantId);
        }

        // SAUGUMO PATCH (Iter 13.x, docx §4.4):
        // DU sistemos projektus paslepiam vartotojams be DU teisės — kitaip
        // specialistas pamatytų „DU expense system (auto)" projektą su DU
        // expense suma. `canViewPayroll` grąžina true tik admin'ams.
        if (!canViewPayroll(me)) {
          q.where('projects.is_du_system', false);
        }

        // Optional filtrai
        if (ctx.params.tenantId !== undefined) {
          q.where('projects.tenant_id', ctx.params.tenantId);
        }
        if (ctx.params.status !== undefined) {
          q.where('projects.statusas', ctx.params.status);
        }
        if (ctx.params.type !== undefined) {
          q.where('projects.tipas', ctx.params.type);
        }
        if (ctx.params.allocationId !== undefined) {
          q.where('projects.budget_allocation_id', ctx.params.allocationId);
        }
        if (ctx.params.requestId !== undefined) {
          q.where('projects.request_id', ctx.params.requestId);
        }
        if (ctx.params.year !== undefined) {
          // Filtras pagal metus iš dates — projektas „pataiko" į metus,
          // jei jo pradzia ar pabaiga (arba bet kuri) buvo šių metų ribose.
          // Paprasčiausia heuristika: pradzia <= YYYY-12-31 IR pabaiga >= YYYY-01-01
          // (arba bet kuri NULL). Toks pat aprašymas atitinka „vyksta tais metais".
          const start = `${ctx.params.year}-01-01`;
          const end = `${ctx.params.year}-12-31`;
          q.where((qb) => {
            qb.where((q1) => {
              q1.whereNull('projects.pradzios_data').orWhere(
                'projects.pradzios_data',
                '<=',
                end,
              );
            }).andWhere((q2) => {
              q2.whereNull('projects.pabaigos_data').orWhere(
                'projects.pabaigos_data',
                '>=',
                start,
              );
            });
          });
        }

        const rows = (await q) as ProjectWithRels[];
        return rows.map(toDTO);
      },
    },

    get: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(
        ctx: Context<{ id: number }, AuthMeta>,
      ): Promise<ProjectDTO> {
        const me = requireMe(ctx);
        const p = await loadProject(ctx.params.id);
        if (!p) {
          throw new Errors.MoleculerClientError(
            'Projektas nerastas',
            404,
            'PROJECT_NOT_FOUND',
          );
        }
        // SAUGUMO PATCH (Iter 13.x, docx §4.4):
        // DU sistemos projektą paslepiam ne-DU vartotojams (404, ne 403 —
        // kad nepatvirtintume ID egzistavimo).
        if (p.isDuSystem && !canViewPayroll(me)) {
          throw new Errors.MoleculerClientError(
            'Projektas nerastas',
            404,
            'PROJECT_NOT_FOUND',
          );
        }
        requireReadAccess(me, p.tenantId);
        return toDTO(p);
      },
    },

    /**
     * Grąžina projekto biudžeto suvestinę:
     *   biudžetas / panaudota / likutis + percentUsed + isWarning + isOver.
     *
     * - `biudzetas` = project.biudzetas
     * - `panaudota` = SUM(expenses.suma) WHERE project_id = id
     * - `likutis` = biudzetas - panaudota
     * - `percentUsed` = panaudota / biudzetas × 100 (rounded 2 decimals)
     * - `isWarning` = percentUsed >= WARNING_THRESHOLD_PERCENT (default 80)
     * - `isOver` = percentUsed > 100
     */
    summary: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(
        ctx: Context<{ id: number }, AuthMeta>,
      ): Promise<ProjectSummary> {
        const me = requireMe(ctx);
        const p = await Project.query().findById(ctx.params.id);
        if (!p) {
          throw new Errors.MoleculerClientError(
            'Projektas nerastas',
            404,
            'PROJECT_NOT_FOUND',
          );
        }
        // SAUGUMO PATCH (Iter 13.x, docx §4.4):
        // DU sistemos projekto summary — paslėpta ne-DU vartotojams (404).
        // Kitaip specialistas pamatytų agreguotas DU totals.
        if (p.isDuSystem && !canViewPayroll(me)) {
          throw new Errors.MoleculerClientError(
            'Projektas nerastas',
            404,
            'PROJECT_NOT_FOUND',
          );
        }
        requireReadAccess(me, p.tenantId);
        const biudzetasCents = toCents(p.biudzetas);
        const expenseSumQ = Expense.query()
          .where('project_id', p.id)
          .sum('suma as total');
        // SAUGUMO PATCH (Iter 13.x agregatinis leak fix, docx §4.4):
        // Defense-in-depth — DU sistemos projektas jau slepiamas viršuje per
        // `isDuSystem` flag'ą + 404. Bet edge case: jei org_admin (turintis
        // DU access) sukurtų DU expense paprastame projekte, org_user vis
        // tiek nepamatys DU sumos summary'je.
        if (!canViewPayroll(me)) {
          expenseSumQ.whereNot('expenses.tipas', 'du');
        }
        const sumRow = (await expenseSumQ.first()) as unknown as
          | { total: string | null }
          | undefined;
        const panaudotaCents = toCents(sumRow?.total ?? '0');
        const likutisCents = biudzetasCents - panaudotaCents;
        const percentUsed = calculatePercentUsed(biudzetasCents, panaudotaCents);
        const flags = calculateWarningFlags(percentUsed);
        return {
          biudzetas: centsToAmount(biudzetasCents),
          panaudota: centsToAmount(panaudotaCents),
          likutis: centsToAmount(likutisCents),
          percentUsed,
          isWarning: flags.isWarning,
          isOver: flags.isOver,
        };
      },
    },

    create: {
      params: {
        tenantId: { type: 'number', integer: true, convert: true },
        budgetAllocationId: {
          type: 'number',
          integer: true,
          convert: true,
        },
        requestId: {
          type: 'number',
          integer: true,
          optional: true,
          nullable: true,
          convert: true,
        },
        pavadinimas: { type: 'string', min: 1, max: 300 },
        tipas: {
          type: 'enum',
          values: ['projektas', 'spec_programa', 'veikla'],
        },
        biudzetas: { type: 'string', min: 1 },
        pradziosData: { type: 'string', optional: true, nullable: true },
        pabaigosData: { type: 'string', optional: true, nullable: true },
        statusas: {
          type: 'enum',
          values: ['planuojama', 'vykdoma', 'baigta', 'uzdaryta'],
          optional: true,
        },
        atsakingasUserId: {
          type: 'number',
          integer: true,
          optional: true,
          nullable: true,
          convert: true,
        },
        aprasymas: { type: 'string', optional: true, nullable: true, max: 4000 },
      },
      async handler(
        ctx: Context<ProjectCreateDTO, AuthMeta>,
      ): Promise<ProjectDTO> {
        const me = requireMe(ctx);
        const p = ctx.params;

        requireWriteAccess(me, p.tenantId);

        // Tenant egzistuoja ir aktyvus
        const tenant = await Tenant.query().findById(p.tenantId);
        if (!tenant || !tenant.active) {
          throw new Errors.MoleculerClientError(
            'Organizacija nerasta arba neaktyvi',
            400,
            'INVALID_TENANT',
          );
        }

        // Biudžeto eilutė priklauso tenant'ui
        await validateAllocationBelongsToTenant(p.budgetAllocationId, p.tenantId);

        // Spec.programa privalo turėti request_id su valid kondicijomis
        if (p.tipas === 'spec_programa') {
          await validateSpecProgramaRequest(p.requestId, p.tenantId);
        }

        // Biudžetas > 0
        const normalized = normalizeAmount(p.biudzetas);
        if (toCents(normalized) <= 0) {
          throw new Errors.MoleculerClientError(
            'Projekto biudžetas turi būti didesnis už 0',
            400,
            'INVALID_AMOUNT',
          );
        }

        // Datų validacija
        validateDates(p.pradziosData, p.pabaigosData);

        // Atsakingas user — jei nurodytas, turi priklausyti tenant'ui
        if (
          p.atsakingasUserId !== undefined &&
          p.atsakingasUserId !== null
        ) {
          const user = await User.query().findById(p.atsakingasUserId);
          if (!user) {
            throw new Errors.MoleculerClientError(
              'Atsakingas vartotojas nerastas',
              400,
              'INVALID_RESPONSIBLE_USER',
            );
          }
          if (user.tenantId !== p.tenantId) {
            throw new Errors.MoleculerClientError(
              'Atsakingas vartotojas turi priklausyti tai pačiai organizacijai',
              400,
              'RESPONSIBLE_USER_TENANT_MISMATCH',
            );
          }
        }

        const knex = Project.knex();
        const created = await knex.transaction(async (trx) => {
          const inserted = await Project.query(trx).insert({
            tenantId: p.tenantId,
            budgetAllocationId: p.budgetAllocationId,
            // Ne-spec_programa tipai gali turėti request_id NULL'iniam
            // backward compat'ui, bet semantiškai gauname tik spec_programa
            // kontekste. Vis tiek nustatom į NULL, kad nesusidarytų klaidingų
            // įrašų.
            requestId:
              p.tipas === 'spec_programa' ? (p.requestId ?? null) : null,
            pavadinimas: p.pavadinimas,
            tipas: p.tipas,
            biudzetas: normalized,
            pradziosData: p.pradziosData ?? null,
            pabaigosData: p.pabaigosData ?? null,
            statusas: p.statusas ?? 'planuojama',
            atsakingasUserId: p.atsakingasUserId ?? null,
            aprasymas: p.aprasymas ?? null,
          });
          // Jei spec_programa — patch'inam request.fvm_project_id, kad jis
          // matytų savo projektą (reverse lookup).
          if (p.tipas === 'spec_programa' && p.requestId) {
            await Request.query(trx)
              .findById(p.requestId)
              .patch({ fvmProjectId: inserted.id });
          }
          return inserted;
        });

        const out = await loadProject(created.id);
        if (!out) throw new Error('Created project not found');
        return toDTO(out);
      },
    },

    update: {
      params: {
        id: { type: 'number', integer: true, convert: true },
        budgetAllocationId: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
        },
        pavadinimas: { type: 'string', optional: true, min: 1, max: 300 },
        biudzetas: { type: 'string', optional: true, min: 1 },
        pradziosData: { type: 'string', optional: true, nullable: true },
        pabaigosData: { type: 'string', optional: true, nullable: true },
        atsakingasUserId: {
          type: 'number',
          integer: true,
          optional: true,
          nullable: true,
          convert: true,
        },
        aprasymas: { type: 'string', optional: true, nullable: true, max: 4000 },
      },
      async handler(
        ctx: Context<ProjectUpdateDTO & { id: number }, AuthMeta>,
      ): Promise<ProjectDTO> {
        const me = requireMe(ctx);
        const target = await Project.query().findById(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError(
            'Projektas nerastas',
            404,
            'PROJECT_NOT_FOUND',
          );
        }
        requireWriteAccess(me, target.tenantId);

        const p = ctx.params;
        const patch: Record<string, unknown> = {};

        if (p.budgetAllocationId !== undefined) {
          await validateAllocationBelongsToTenant(
            p.budgetAllocationId,
            target.tenantId,
          );
          patch['budgetAllocationId'] = p.budgetAllocationId;
        }
        if (p.pavadinimas !== undefined) patch['pavadinimas'] = p.pavadinimas;
        if (p.biudzetas !== undefined) {
          const normalized = normalizeAmount(p.biudzetas);
          if (toCents(normalized) <= 0) {
            throw new Errors.MoleculerClientError(
              'Projekto biudžetas turi būti didesnis už 0',
              400,
              'INVALID_AMOUNT',
            );
          }
          patch['biudzetas'] = normalized;
        }

        // Datas validate'inam su likusiom (kurios nepakeičiamos — iš target).
        const effectivePradzia =
          p.pradziosData === undefined ? target.pradziosData : p.pradziosData;
        const effectivePabaiga =
          p.pabaigosData === undefined ? target.pabaigosData : p.pabaigosData;
        validateDates(effectivePradzia, effectivePabaiga);
        if (p.pradziosData !== undefined) patch['pradziosData'] = p.pradziosData;
        if (p.pabaigosData !== undefined) patch['pabaigosData'] = p.pabaigosData;

        if (
          p.atsakingasUserId !== undefined &&
          p.atsakingasUserId !== null
        ) {
          const user = await User.query().findById(p.atsakingasUserId);
          if (!user) {
            throw new Errors.MoleculerClientError(
              'Atsakingas vartotojas nerastas',
              400,
              'INVALID_RESPONSIBLE_USER',
            );
          }
          if (user.tenantId !== target.tenantId) {
            throw new Errors.MoleculerClientError(
              'Atsakingas vartotojas turi priklausyti tai pačiai organizacijai',
              400,
              'RESPONSIBLE_USER_TENANT_MISMATCH',
            );
          }
          patch['atsakingasUserId'] = p.atsakingasUserId;
        } else if (p.atsakingasUserId === null) {
          patch['atsakingasUserId'] = null;
        }
        if (p.aprasymas !== undefined) patch['aprasymas'] = p.aprasymas;

        await Project.query().findById(target.id).patch(patch);
        const out = await loadProject(target.id);
        if (!out) throw new Error('Updated project not found');
        return toDTO(out);
      },
    },

    delete: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(
        ctx: Context<{ id: number }, AuthMeta>,
      ): Promise<{ ok: true }> {
        const me = requireMe(ctx);
        requireAmAdmin(me);
        const target = await Project.query().findById(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError(
            'Projektas nerastas',
            404,
            'PROJECT_NOT_FOUND',
          );
        }
        if (target.statusas !== 'planuojama') {
          throw new Errors.MoleculerClientError(
            'Galima ištrinti tik planuojamus projektus. Vykdomų ar užbaigtų projektų trinti negalima.',
            409,
            'PROJECT_NOT_DELETABLE',
          );
        }
        await Project.query().deleteById(target.id);
        return { ok: true };
      },
    },

    /**
     * Atskira changeStatus endpoint'a leidžia atomic'ai pakeisti statusą
     * su validation (žiūr. `validateStatusTransition`). Pasirinkimas:
     *  - Forward kaimyniniam statusui — AM admin + org_admin (savo tenant)
     *  - Į „uzdaryta" — tik AM admin (final transition)
     *  - Reverse (į mažesnį indeksą) — tik AM admin
     */
    changeStatus: {
      params: {
        id: { type: 'number', integer: true, convert: true },
        statusas: {
          type: 'enum',
          values: ['planuojama', 'vykdoma', 'baigta', 'uzdaryta'],
        },
      },
      async handler(
        ctx: Context<ChangeStatusParams, AuthMeta>,
      ): Promise<ProjectDTO> {
        const me = requireMe(ctx);
        const target = await Project.query().findById(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError(
            'Projektas nerastas',
            404,
            'PROJECT_NOT_FOUND',
          );
        }
        requireWriteAccess(me, target.tenantId);
        validateStatusTransition(me, target.statusas, ctx.params.statusas);
        await Project.query()
          .findById(target.id)
          .patch({ statusas: ctx.params.statusas });
        const out = await loadProject(target.id);
        if (!out) throw new Error('Updated project not found');
        return toDTO(out);
      },
    },
  },
};

// Tipų eksportai test'ams ir kitiems servisams.
export { PROJECT_TYPES, PROJECT_STATUSES };
export type { ChangeStatusParams as ProjectChangeStatusParams };
export type { ProjectChangeStatusDTO };

export default ProjectsService;
