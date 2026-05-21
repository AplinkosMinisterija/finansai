/**
 * Expenses servisas (Iter 12, FVM-4).
 *
 * 3 FVM lygio entitetas — projekto faktinė išlaida. Padidina biudžeto
 * naudojimą, sumažina likutį, generuoja warning'us pasiekus
 * `WARNING_THRESHOLD_PERCENT` (default 80%, žr. `utils/fvm.ts`).
 *
 * Permission modelis (žr. `docs/fvm/01-architecture.md`):
 *  - `list` / `get` — visi autentifikuoti vartotojai; tenant scope per
 *    `project.tenant_id` (org users mato tik savo tenant; AM admin
 *    + AM user pagal scope — visus arba scope'ą)
 *  - `create` / `update` / `delete` — AM admin + org_admin (savo tenant)
 *  - `budgetSummary` — visi autentifikuoti; tenant scope per allocation chain
 *
 * Verslo invariantai (create + update):
 *  - `projectId` egzistuoja + tenant scope match
 *  - `budgetAllocationId` egzistuoja; rekomenduojama projekto allocation,
 *    BET leidžiama kita allocation (rare case) — žr. iter-12 brief.
 *  - `suma` > 0
 *  - `data` per projekto datas — soft warning (accept ir tęsiam)
 *  - `saltinioDalis` (jei nurodyta):
 *      * kiekvienas elementas turi `fundingSourceId` (int egzistuoja) +
 *        `suma` (string-decimal > 0)
 *      * SUM(`saltinioDalis[].suma`) === expense.suma (epsilon 1 ct)
 *      * 400 LT klaida kitaip
 *  - `saltinioDalis === null` → priimama; single-source per
 *    `budget_allocation.funding_source_id`
 *
 * Update CAN'T change:
 *  - `project_id` (perkėlimas tarp projektų neleidžiamas — naujas projektas =
 *    nauja išlaida)
 *
 * Delete — hard delete (audit trail per `created_by_user_id` + `created_at`).
 *
 * REST aliases (`api.service.ts`):
 *  - GET    /expenses                     → expenses.list
 *  - GET    /expenses/budget-summary      → expenses.budgetSummary
 *  - GET    /expenses/:id                 → expenses.get
 *  - POST   /expenses                     → expenses.create
 *  - PATCH  /expenses/:id                 → expenses.update
 *  - DELETE /expenses/:id                 → expenses.delete
 */
import type { ServiceSchema, Context } from 'moleculer';
import { Errors } from 'moleculer';
import type {
  BudgetWarningItem,
  BudgetWarningsResponse,
  Expense as ExpenseDTO,
  ExpenseCreateDTO,
  ExpenseListQuery,
  ExpenseSourceDistributionItem,
  ExpenseType,
  ExpenseUpdateDTO,
} from '@biip-finansai/shared';
import { BudgetAllocationV2 } from '../models/BudgetAllocationV2';
import { Expense, type ExpenseSourceDistributionRow } from '../models/Expense';
import { FundingSource } from '../models/FundingSource';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { centsToAmount, normalizeAmount, toCents } from '../utils/money';
import {
  EXPENSE_SUM_EPSILON_CENTS,
  calculatePercentUsed,
  calculateWarningFlags,
} from '../utils/fvm';
import { canViewPayroll } from '../utils/permissions';
import type { AuthMeta } from './auth.service';

const EXPENSE_TYPES: readonly ExpenseType[] = [
  'du',
  'sutartis',
  'saskaita',
  'tiesiogine',
];

type ExpenseWithRels = Expense & {
  project?: import('../models/Project').Project & {
    tenant?: import('../models/Tenant').Tenant;
  };
  budgetAllocation?: BudgetAllocationV2;
  createdByUser?: User;
};

function toDTO(e: ExpenseWithRels): ExpenseDTO {
  return {
    id: e.id,
    projectId: e.projectId,
    projectName: e.project?.pavadinimas,
    budgetAllocationId: e.budgetAllocationId,
    budgetAllocationName: e.budgetAllocation?.pavadinimas,
    tenantId: e.project?.tenantId,
    tipas: e.tipas,
    suma: e.suma,
    data: e.data,
    aprasymas: e.aprasymas,
    saltinioDalis: Expense.rowsToDtoDistribution(e.saltinioDalis),
    createdByUserId: e.createdByUserId,
    createdByName: e.createdByUser?.fullName,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function requireMe(ctx: Context<unknown, AuthMeta>): NonNullable<AuthMeta['user']> {
  if (!ctx.meta.user) {
    throw new Errors.MoleculerClientError('Neautentifikuota', 401, 'AUTH_REQUIRED');
  }
  return ctx.meta.user;
}

function isAmAdmin(me: NonNullable<AuthMeta['user']>): boolean {
  return me.tenantIsApprover && me.role === 'admin';
}

function isOrgAdmin(me: NonNullable<AuthMeta['user']>): boolean {
  return !me.tenantIsApprover && me.role === 'admin';
}

/** Write access — AM admin (visi tenant'ai) arba org_admin (savo tenant). */
function requireWriteAccess(
  me: NonNullable<AuthMeta['user']>,
  tenantId: number,
): void {
  if (isAmAdmin(me)) return;
  if (isOrgAdmin(me) && me.tenantId === tenantId) return;
  throw new Errors.MoleculerClientError(
    'Neturite teisės valdyti šios organizacijos išlaidų',
    403,
    'FORBIDDEN',
  );
}

/**
 * Read access:
 *  - AM admin: visi
 *  - AM user (tenantIsApprover=true, role=user): pagal `amScopeOrgIds`
 *    (null = visi)
 *  - Org admin / org user: tik savo tenant'as
 */
function requireReadAccess(
  me: NonNullable<AuthMeta['user']>,
  tenantId: number,
): void {
  if (me.tenantIsApprover) {
    if (me.role === 'admin') return;
    if (me.amScopeOrgIds === null) return;
    if (me.amScopeOrgIds.includes(tenantId)) return;
    throw new Errors.MoleculerClientError(
      'Neturite teisės matyti šios išlaidos',
      403,
      'FORBIDDEN',
    );
  }
  if (me.tenantId !== tenantId) {
    throw new Errors.MoleculerClientError(
      'Neturite teisės matyti šios išlaidos',
      403,
      'FORBIDDEN',
    );
  }
}

/**
 * Patikrina projekto egzistavimą + tenant scope (write access). Grąžina
 * projektą su tenant.
 */
async function validateProjectForWrite(
  me: NonNullable<AuthMeta['user']>,
  projectId: number,
): Promise<Project> {
  const project = await Project.query().findById(projectId);
  if (!project) {
    throw new Errors.MoleculerClientError(
      'Projektas nerastas',
      400,
      'INVALID_PROJECT',
    );
  }
  requireWriteAccess(me, project.tenantId);
  return project;
}

/**
 * Patikrina allocation egzistavimą ir grąžina su funding_source. Tenant
 * tikrinimas — palyginimas su projekto tenant'u.
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
 * Multi-source split validation:
 *  - Kiekvienas elementas turi pozityvią sumą (toCents > 0)
 *  - Kiekvienas funding_source_id egzistuoja DB
 *  - SUM(saltinio_dalis[].suma) === expense.suma (epsilon centais)
 *
 * Grąžina normalizuotus item'us (sumos per `normalizeAmount`), kuriuos saugu
 * insert'inti į jsonb (per `dtoToRowDistribution`).
 */
async function validateAndNormalizeSaltinioDalis(
  items: ExpenseSourceDistributionItem[],
  expenseSumaCents: number,
): Promise<ExpenseSourceDistributionItem[]> {
  if (items.length === 0) {
    throw new Errors.MoleculerClientError(
      'Finansavimo šaltinio paskirstymas negali būti tuščias sąrašas',
      400,
      'INVALID_SOURCE_DISTRIBUTION',
    );
  }

  const normalized: ExpenseSourceDistributionItem[] = [];
  let totalCents = 0;
  const sourceIds = new Set<number>();
  for (const item of items) {
    if (
      typeof item.fundingSourceId !== 'number' ||
      !Number.isInteger(item.fundingSourceId)
    ) {
      throw new Errors.MoleculerClientError(
        'Finansavimo šaltinio ID turi būti sveikasis skaičius',
        400,
        'INVALID_SOURCE_DISTRIBUTION',
      );
    }
    const sumaNormalized = normalizeAmount(item.suma);
    const itemCents = toCents(sumaNormalized);
    if (itemCents <= 0) {
      throw new Errors.MoleculerClientError(
        'Kiekvienos finansavimo šaltinio dalies suma turi būti didesnė už 0',
        400,
        'INVALID_SOURCE_AMOUNT',
      );
    }
    totalCents += itemCents;
    sourceIds.add(item.fundingSourceId);
    normalized.push({
      fundingSourceId: item.fundingSourceId,
      suma: sumaNormalized,
    });
  }

  // Patikrinam, kad visi funding_source_id egzistuoja (vienoje užklausoje).
  const existing = (await FundingSource.query()
    .whereIn('id', Array.from(sourceIds))
    .select('id')) as Array<{ id: number }>;
  const existingIds = new Set(existing.map((r) => r.id));
  for (const sid of sourceIds) {
    if (!existingIds.has(sid)) {
      throw new Errors.MoleculerClientError(
        `Finansavimo šaltinis su ID ${sid} nerastas`,
        400,
        'INVALID_FUNDING_SOURCE',
      );
    }
  }

  if (Math.abs(totalCents - expenseSumaCents) > EXPENSE_SUM_EPSILON_CENTS) {
    throw new Errors.MoleculerClientError(
      'Finansavimo šaltinio paskirstymo sumų suma turi sutapti su išlaidos suma',
      400,
      'SOURCE_DISTRIBUTION_MISMATCH',
    );
  }

  return normalized;
}

async function loadExpense(id: number): Promise<ExpenseWithRels | undefined> {
  const e = await Expense.query()
    .findById(id)
    .withGraphFetched('[project.[tenant], budgetAllocation, createdByUser]');
  return e as ExpenseWithRels | undefined;
}

interface ListParams {
  projectId?: number;
  allocationId?: number;
  year?: number;
  type?: ExpenseType;
  dateFrom?: string;
  dateTo?: string;
  fundingSourceId?: number;
}

interface BudgetSummaryParams {
  year: number;
  projectId?: number;
}

const ExpensesService: ServiceSchema = {
  name: 'expenses',

  actions: {
    list: {
      params: {
        projectId: { type: 'number', integer: true, optional: true, convert: true },
        allocationId: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
        },
        year: { type: 'number', integer: true, optional: true, convert: true },
        type: {
          type: 'enum',
          values: EXPENSE_TYPES,
          optional: true,
        },
        dateFrom: { type: 'string', optional: true },
        dateTo: { type: 'string', optional: true },
        fundingSourceId: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
        },
      },
      async handler(ctx: Context<ExpenseListQuery, AuthMeta>): Promise<ExpenseDTO[]> {
        const me = requireMe(ctx);
        const q = Expense.query()
          .withGraphFetched('[project.[tenant], budgetAllocation, createdByUser]')
          .orderBy([
            { column: 'data', order: 'desc' },
            { column: 'id', order: 'desc' },
          ]);

        // Tenant scope per project.tenant_id — visiems ne-AM-admin'ams.
        if (me.tenantIsApprover) {
          if (me.role === 'user' && me.amScopeOrgIds !== null) {
            if (me.amScopeOrgIds.length === 0) {
              return [];
            }
            q.whereExists((qb) => {
              qb.from('projects')
                .whereRaw('projects.id = expenses.project_id')
                .whereIn('projects.tenant_id', me.amScopeOrgIds!);
            });
          }
        } else {
          q.whereExists((qb) => {
            qb.from('projects')
              .whereRaw('projects.id = expenses.project_id')
              .where('projects.tenant_id', me.tenantId);
          });
        }

        // SAUGUMO PATCH (Iter 13.x, docx §4.4):
        // DU expense'ai (`tipas='du'`) turi būti paslėpti vartotojams be DU
        // teisės — kitaip specialistas pamatytų darbuotojo vardą + sumą per
        // `expenses.aprasymas` lauką. `canViewPayroll` grąžina true tik
        // admin'ams (AM admin + org admin); kiekviena rolė turi atskirą
        // tenant scope'ą jau pritaikyta aukščiau.
        if (!canViewPayroll(me)) {
          q.whereNot('expenses.tipas', 'du');
        }

        if (ctx.params.projectId !== undefined) {
          q.where('expenses.project_id', ctx.params.projectId);
        }
        if (ctx.params.allocationId !== undefined) {
          q.where('expenses.budget_allocation_id', ctx.params.allocationId);
        }
        if (ctx.params.type !== undefined) {
          q.where('expenses.tipas', ctx.params.type);
        }
        if (ctx.params.dateFrom !== undefined) {
          q.where('expenses.data', '>=', ctx.params.dateFrom);
        }
        if (ctx.params.dateTo !== undefined) {
          q.where('expenses.data', '<=', ctx.params.dateTo);
        }
        if (ctx.params.year !== undefined) {
          // Filtras pagal metus — overlap su expense.data.
          // Paprasčiausia: data per metų ribas.
          const start = `${ctx.params.year}-01-01`;
          const end = `${ctx.params.year}-12-31`;
          q.where('expenses.data', '>=', start).andWhere(
            'expenses.data',
            '<=',
            end,
          );
        }
        if (ctx.params.fundingSourceId !== undefined) {
          // jsonb @> containment — GIN indeksas
          // (`idx_expenses_saltinio_dalis_gin`).
          const filter = JSON.stringify([
            { funding_source_id: ctx.params.fundingSourceId },
          ]);
          q.whereRaw('expenses.saltinio_dalis @> ?::jsonb', [filter]);
        }

        const rows = (await q) as ExpenseWithRels[];
        return rows.map(toDTO);
      },
    },

    get: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(
        ctx: Context<{ id: number }, AuthMeta>,
      ): Promise<ExpenseDTO> {
        const me = requireMe(ctx);
        const e = await loadExpense(ctx.params.id);
        if (!e) {
          throw new Errors.MoleculerClientError(
            'Išlaida nerasta',
            404,
            'EXPENSE_NOT_FOUND',
          );
        }
        const tenantId = e.project?.tenantId;
        if (tenantId === undefined) {
          throw new Errors.MoleculerClientError(
            'Išlaidos projektas neturi organizacijos',
            500,
            'EXPENSE_INCONSISTENT',
          );
        }
        // SAUGUMO PATCH (Iter 13.x, docx §4.4):
        // Pirma — DU tipo expense'us paslepiam vartotojams be DU teisės.
        // Naudojam 404 (ne 403), kad nepamatytų expense ID egzistuoja —
        // saugumo „dark pattern": resource nera randamas niekam, kas neturi
        // teisės.
        if (e.tipas === 'du' && !canViewPayroll(me)) {
          throw new Errors.MoleculerClientError(
            'Išlaida nerasta',
            404,
            'EXPENSE_NOT_FOUND',
          );
        }
        requireReadAccess(me, tenantId);
        return toDTO(e);
      },
    },

    create: {
      params: {
        projectId: { type: 'number', integer: true, convert: true },
        budgetAllocationId: {
          type: 'number',
          integer: true,
          convert: true,
        },
        tipas: { type: 'enum', values: EXPENSE_TYPES },
        suma: { type: 'string', min: 1 },
        data: { type: 'string', min: 1 },
        aprasymas: { type: 'string', optional: true, nullable: true, max: 500 },
        saltinioDalis: {
          type: 'array',
          optional: true,
          nullable: true,
          items: {
            type: 'object',
            props: {
              fundingSourceId: { type: 'number', integer: true, convert: true },
              suma: { type: 'string', min: 1 },
            },
          },
        },
      },
      async handler(
        ctx: Context<ExpenseCreateDTO, AuthMeta>,
      ): Promise<ExpenseDTO> {
        const me = requireMe(ctx);
        const p = ctx.params;

        const project = await validateProjectForWrite(me, p.projectId);
        const allocation = await validateAllocationBelongsToTenant(
          p.budgetAllocationId,
          project.tenantId,
        );
        void allocation; // tik validation; nereikia reikšmės create'ui

        const normalizedSuma = normalizeAmount(p.suma);
        const sumaCents = toCents(normalizedSuma);
        if (sumaCents <= 0) {
          throw new Errors.MoleculerClientError(
            'Išlaidos suma turi būti didesnė už 0',
            400,
            'INVALID_AMOUNT',
          );
        }

        // Multi-source split — validation jei pateikta. NULL → single-source.
        let saltinioRows: ExpenseSourceDistributionRow[] | null = null;
        if (p.saltinioDalis !== undefined && p.saltinioDalis !== null) {
          const normalized = await validateAndNormalizeSaltinioDalis(
            p.saltinioDalis,
            sumaCents,
          );
          saltinioRows = Expense.dtoToRowDistribution(normalized);
        }

        // Atomiškai sukuriam — transaction'as svarbus, jei vėliau pridėsim
        // papildomus side-effect'us (pvz., audit log lentelės įrašą).
        const knex = Expense.knex();
        const inserted = await knex.transaction(async (trx) => {
          return await Expense.query(trx).insert({
            projectId: p.projectId,
            budgetAllocationId: p.budgetAllocationId,
            tipas: p.tipas,
            suma: normalizedSuma,
            data: p.data,
            aprasymas: p.aprasymas ?? null,
            saltinioDalis: saltinioRows,
            createdByUserId: me.id,
          });
        });

        const out = await loadExpense(inserted.id);
        if (!out) throw new Error('Created expense not found');
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
        tipas: {
          type: 'enum',
          values: EXPENSE_TYPES,
          optional: true,
        },
        suma: { type: 'string', optional: true, min: 1 },
        data: { type: 'string', optional: true },
        aprasymas: { type: 'string', optional: true, nullable: true, max: 500 },
        saltinioDalis: {
          type: 'array',
          optional: true,
          nullable: true,
          items: {
            type: 'object',
            props: {
              fundingSourceId: { type: 'number', integer: true, convert: true },
              suma: { type: 'string', min: 1 },
            },
          },
        },
      },
      async handler(
        ctx: Context<ExpenseUpdateDTO & { id: number }, AuthMeta>,
      ): Promise<ExpenseDTO> {
        const me = requireMe(ctx);
        const target = await Expense.query().findById(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError(
            'Išlaida nerasta',
            404,
            'EXPENSE_NOT_FOUND',
          );
        }
        const project = await Project.query().findById(target.projectId);
        if (!project) {
          throw new Errors.MoleculerClientError(
            'Išlaidos projektas nerastas',
            500,
            'EXPENSE_INCONSISTENT',
          );
        }
        requireWriteAccess(me, project.tenantId);

        const p = ctx.params;
        const patch: Record<string, unknown> = {};

        if (p.budgetAllocationId !== undefined) {
          await validateAllocationBelongsToTenant(
            p.budgetAllocationId,
            project.tenantId,
          );
          patch['budgetAllocationId'] = p.budgetAllocationId;
        }
        if (p.tipas !== undefined) patch['tipas'] = p.tipas;

        // Suma + saltinioDalis turi būti validuoti kartu — jei keičiama bet
        // kuri iš jų, tikrinam konsistenciją tarp galutinių reikšmių.
        let effectiveSumaCents = toCents(target.suma);
        if (p.suma !== undefined) {
          const normalizedSuma = normalizeAmount(p.suma);
          effectiveSumaCents = toCents(normalizedSuma);
          if (effectiveSumaCents <= 0) {
            throw new Errors.MoleculerClientError(
              'Išlaidos suma turi būti didesnė už 0',
              400,
              'INVALID_AMOUNT',
            );
          }
          patch['suma'] = normalizedSuma;
        }

        // saltinioDalis logika:
        //  - undefined → neliečiam (esama reikšmė lieka, bet jei suma
        //    pasikeitė, esama saltinio_dalis gali tapti nekonsistentiška —
        //    re-validuojam su nauja suma)
        //  - null → išvalom (tampa single-source default)
        //  - array → validuojam ir update'inam
        if (p.saltinioDalis === null) {
          patch['saltinioDalis'] = null;
        } else if (p.saltinioDalis !== undefined) {
          const normalized = await validateAndNormalizeSaltinioDalis(
            p.saltinioDalis,
            effectiveSumaCents,
          );
          patch['saltinioDalis'] = Expense.dtoToRowDistribution(normalized);
        } else if (p.suma !== undefined && target.saltinioDalis !== null) {
          // Suma pasikeitė, bet saltinioDalis nebuvo pateiktas — re-validuojam
          // esamą split'ą su nauja suma. Jei nekonsistentiškas — 400.
          const currentDto = Expense.rowsToDtoDistribution(target.saltinioDalis);
          if (currentDto) {
            await validateAndNormalizeSaltinioDalis(currentDto, effectiveSumaCents);
          }
        }

        if (p.data !== undefined) patch['data'] = p.data;
        if (p.aprasymas !== undefined) patch['aprasymas'] = p.aprasymas;

        await Expense.query().findById(target.id).patch(patch);
        const out = await loadExpense(target.id);
        if (!out) throw new Error('Updated expense not found');
        return toDTO(out);
      },
    },

    delete: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(
        ctx: Context<{ id: number }, AuthMeta>,
      ): Promise<{ ok: true }> {
        const me = requireMe(ctx);
        const target = await Expense.query().findById(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError(
            'Išlaida nerasta',
            404,
            'EXPENSE_NOT_FOUND',
          );
        }
        const project = await Project.query().findById(target.projectId);
        if (!project) {
          throw new Errors.MoleculerClientError(
            'Išlaidos projektas nerastas',
            500,
            'EXPENSE_INCONSISTENT',
          );
        }
        requireWriteAccess(me, project.tenantId);
        await Expense.query().deleteById(target.id);
        return { ok: true };
      },
    },

    /**
     * Pilna biudžeto suvestinė nurodytiems metams. Grąžina visus tenant'ui
     * matomus allocations su planuota / faktinė / likutis / warning flag'ais.
     *
     * Filter'ai:
     *  - `year` (required) — filtruoja per `budget_allocations_v2.metai`
     *  - `projectId` (optional) — apriboja faktinę į vieno projekto išlaidas
     *    (sensingly kartu su year — pavyzdys: parodyti projekto įneštas
     *    išlaidas pagal allocation'us tuose metuose)
     *
     * Tenant scope:
     *  - AM admin / AM user (scope null) — visi tų metų allocations
     *  - AM user su scope — tik scope tenant'ų allocations
     *  - Org user / org admin — tik savo tenant'o allocations
     */
    budgetSummary: {
      params: {
        year: { type: 'number', integer: true, convert: true, min: 2000, max: 3000 },
        projectId: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
        },
      },
      async handler(
        ctx: Context<BudgetSummaryParams, AuthMeta>,
      ): Promise<BudgetWarningsResponse> {
        const me = requireMe(ctx);
        const year = ctx.params.year;

        const allocQ = BudgetAllocationV2.query()
          .withGraphFetched('fundingSource')
          .where('budget_allocations_v2.metai', year)
          .orderBy([
            { column: 'budget_allocations_v2.pavadinimas', order: 'asc' },
          ]);

        // Tenant scope per allocation.funding_source.tenant_id chain'as.
        if (me.tenantIsApprover) {
          if (me.role === 'user' && me.amScopeOrgIds !== null) {
            if (me.amScopeOrgIds.length === 0) {
              return { year, items: [] };
            }
            allocQ.whereExists((qb) => {
              qb.from('funding_sources')
                .whereRaw(
                  'funding_sources.id = budget_allocations_v2.funding_source_id',
                )
                .whereIn('funding_sources.tenant_id', me.amScopeOrgIds!);
            });
          }
        } else {
          allocQ.whereExists((qb) => {
            qb.from('funding_sources')
              .whereRaw(
                'funding_sources.id = budget_allocations_v2.funding_source_id',
              )
              .where('funding_sources.tenant_id', me.tenantId);
          });
        }

        const allocations = (await allocQ) as Array<
          BudgetAllocationV2 & { fundingSource?: FundingSource }
        >;
        if (allocations.length === 0) {
          return { year, items: [] };
        }

        // Faktinė per allocations — vienoje GROUP BY užklausoje.
        const allocationIds = allocations.map((a) => a.id);
        const expenseQ = Expense.query()
          .select('budget_allocation_id')
          .sum('suma as total')
          .whereIn('budget_allocation_id', allocationIds)
          .groupBy('budget_allocation_id');
        if (ctx.params.projectId !== undefined) {
          expenseQ.where('project_id', ctx.params.projectId);
        }
        const expenseRows = (await expenseQ) as unknown as Array<{
          budgetAllocationId: number;
          total: string | null;
        }>;
        const faktineByAllocation = new Map<number, number>();
        for (const row of expenseRows) {
          faktineByAllocation.set(row.budgetAllocationId, toCents(row.total));
        }

        const items: BudgetWarningItem[] = allocations.map((alloc) => {
          const planuotaCents = toCents(alloc.planuotaSuma);
          const faktineCents = faktineByAllocation.get(alloc.id) ?? 0;
          const likutisCents = planuotaCents - faktineCents;
          const percentUsed = calculatePercentUsed(planuotaCents, faktineCents);
          const flags = calculateWarningFlags(percentUsed);
          return {
            allocationId: alloc.id,
            allocationName: alloc.pavadinimas,
            fundingSourceName: alloc.fundingSource?.pavadinimas ?? '',
            planuota: centsToAmount(planuotaCents),
            faktine: centsToAmount(faktineCents),
            likutis: centsToAmount(likutisCents),
            percentUsed,
            isWarning: flags.isWarning,
            isOver: flags.isOver,
          };
        });

        return { year, items };
      },
    },
  },
};

export default ExpensesService;
