/**
 * Biudžeto paskirstymų servisas (Iter 9, FVM-1).
 *
 * 2 FVM lygis: „Kam skiriama?" — pvz., DU 500k, Spec.programa A 200k,
 * Prekės/paslaugos 800k.
 *
 * Permission modelis (žr. `docs/fvm/01-architecture.md` §Permission modelis):
 *  - `list` / `get` / `summary` — visi autentifikuoti vartotojai
 *  - `create` / `update` / `delete` — tik AM administrator'ius
 *
 * Verslo invariantai:
 *  - `categoryClassifierItemId` PRIVALO būti iš grupės `budget_category`
 *  - `specProgTipas` leidžiamas TIK kai kategorijos kodas yra `spec_programa`;
 *    kitais atvejais — `null` (kitaip 400 klaida)
 *  - `planuotaSuma` > 0
 *  - DELETE RESTRICT — kol projects/expenses lentelės dar nesukurtos (Iter 11/12),
 *    realizuotas tik kaip TODO placeholder (žiūrint į priekį)
 *
 * REST aliases (`api.service.ts`):
 *  - GET    /budget-allocations              → budgetAllocations.list
 *  - GET    /budget-allocations/:id          → budgetAllocations.get
 *  - GET    /budget-allocations/:id/summary  → budgetAllocations.summary
 *  - POST   /budget-allocations              → budgetAllocations.create
 *  - PATCH  /budget-allocations/:id          → budgetAllocations.update
 *  - DELETE /budget-allocations/:id          → budgetAllocations.delete
 */
import type { ServiceSchema, Context } from 'moleculer';
import { Errors } from 'moleculer';
import type {
  BudgetAllocation as BudgetAllocationDTO,
  BudgetAllocationCreateDTO,
  BudgetAllocationUpdateDTO,
  BudgetAllocationSummary,
  SpecProgTipas,
} from '@biip-finansai/shared';
import { BudgetAllocationV2 } from '../models/BudgetAllocationV2';
import { Expense } from '../models/Expense';
import { FundingSource } from '../models/FundingSource';
import { ClassifierGroup } from '../models/ClassifierGroup';
import { ClassifierItem } from '../models/ClassifierItem';
import { centsToAmount, normalizeAmount, toCents } from '../utils/money';
import { calculatePercentUsed, calculateWarningFlags } from '../utils/fvm';
import { canViewPayroll, isAmAdminUser } from '../utils/permissions';
import type { AuthMeta } from './auth.service';

const BUDGET_CATEGORY_GROUP_CODE = 'budget_category';
const SPEC_PROGRAMA_CODE = 'spec_programa';
const SPEC_PROG_TIPAS_VALUES: readonly SpecProgTipas[] = [
  'atskiras',
  'biudzeto_dalis',
];

type BudgetAllocationWithRels = BudgetAllocationV2 & {
  categoryClassifierItem?: ClassifierItem;
  fundingSource?: FundingSource;
};

function toDTO(a: BudgetAllocationWithRels): BudgetAllocationDTO {
  return {
    id: a.id,
    fundingSourceId: a.fundingSourceId,
    categoryClassifierItemId: a.categoryClassifierItemId,
    categoryCode: a.categoryClassifierItem?.code,
    categoryName: a.categoryClassifierItem?.name,
    pavadinimas: a.pavadinimas,
    specProgTipas: a.specProgTipas,
    planuotaSuma: a.planuotaSuma,
    metai: a.metai,
    pastabos: a.pastabos,
    fundingSourceCode: a.fundingSource?.kodas,
    fundingSourceName: a.fundingSource?.pavadinimas,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
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

/**
 * Patikrina, kad classifier_item priklauso grupei `budget_category` ir
 * yra aktyvus. Grąžina patikrintą item'ą.
 */
async function validateCategoryItem(itemId: number): Promise<ClassifierItem> {
  const item = await ClassifierItem.query()
    .findById(itemId)
    .withGraphFetched('group');
  if (!item) {
    throw new Errors.MoleculerClientError(
      'Biudžeto kategorija nerasta klasifikatoriuje',
      400,
      'INVALID_CATEGORY_ITEM',
    );
  }
  if (!item.active) {
    throw new Errors.MoleculerClientError(
      'Pasirinkta biudžeto kategorijos reikšmė yra neaktyvi',
      400,
      'INACTIVE_CATEGORY_ITEM',
    );
  }
  const group = (item as ClassifierItem & { group?: ClassifierGroup }).group;
  if (!group || group.code !== BUDGET_CATEGORY_GROUP_CODE) {
    throw new Errors.MoleculerClientError(
      `Pasirinkta klasifikatoriaus reikšmė priklauso ne „${BUDGET_CATEGORY_GROUP_CODE}" grupei`,
      400,
      'INVALID_CATEGORY_GROUP',
    );
  }
  return item;
}

/**
 * Užtikrina, kad `specProgTipas` reikšmė atitinka kategoriją:
 *  - Kai kategorija = `spec_programa` — leidžiama `atskiras` / `biudzeto_dalis` / null
 *  - Kitose kategorijose — privalo būti `null` arba `undefined` (nustatomas null)
 *
 * Grąžina normalizuotą reikšmę.
 */
function normalizeSpecProgTipas(
  categoryCode: string,
  specProgTipas: SpecProgTipas | null | undefined,
): SpecProgTipas | null {
  if (categoryCode === SPEC_PROGRAMA_CODE) {
    if (
      specProgTipas !== null &&
      specProgTipas !== undefined &&
      !SPEC_PROG_TIPAS_VALUES.includes(specProgTipas)
    ) {
      throw new Errors.MoleculerClientError(
        'Neteisingas spec.programos tipo reikšmė. Galimos reikšmės: atskiras, biudzeto_dalis.',
        400,
        'INVALID_SPEC_PROG_TIPAS',
      );
    }
    return specProgTipas ?? null;
  }
  // Ne-spec_programa kategorija — neturėtų turėti specProgTipas
  if (specProgTipas !== null && specProgTipas !== undefined) {
    throw new Errors.MoleculerClientError(
      'Spec.programos tipas gali būti nurodytas tik kategorijai „spec_programa"',
      400,
      'SPEC_PROG_TIPAS_NOT_ALLOWED',
    );
  }
  return null;
}

async function loadAllocation(
  id: number,
): Promise<BudgetAllocationWithRels | undefined> {
  const a = await BudgetAllocationV2.query()
    .findById(id)
    .withGraphFetched('[categoryClassifierItem, fundingSource]');
  return a as BudgetAllocationWithRels | undefined;
}

interface ListParams {
  fundingSourceId?: number;
  year?: number;
  categoryItemId?: number;
}

const BudgetAllocationsService: ServiceSchema = {
  name: 'budgetAllocations',

  actions: {
    list: {
      params: {
        fundingSourceId: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
        },
        year: { type: 'number', integer: true, optional: true, convert: true },
        categoryItemId: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
        },
      },
      async handler(
        ctx: Context<ListParams, AuthMeta>,
      ): Promise<BudgetAllocationDTO[]> {
        const me = requireMe(ctx);
        const q = BudgetAllocationV2.query()
          .withGraphFetched('[categoryClassifierItem, fundingSource]')
          .orderBy([
            { column: 'metai', order: 'desc' },
            { column: 'pavadinimas', order: 'asc' },
          ]);

        // SAUGUMO PATCH (Iter 13.x agregatinis leak fix, docx §4.4):
        // Tenant scope — iki šiol allocation listing leido org_user matyti
        // visų tenant'ų allocations (kartu su `allocatedAmount`, `count`).
        // Po patch'o:
        //   - AM admin (`tenantIsApprover` + `admin`): visi tenant'ai
        //   - AM user su scope=null: visi tenant'ai
        //   - AM user su scope=[ids]: tik scope'o tenant'ai
        //   - Org admin / org user: TIK savo tenant'as
        // Filter'uojam per allocation.funding_source.tenant_id chain'ą.
        if (me.tenantIsApprover) {
          if (me.role === 'user' && me.amScopeOrgIds !== null) {
            if (me.amScopeOrgIds.length === 0) {
              return [];
            }
            q.whereExists((qb) => {
              qb.from('funding_sources')
                .whereRaw(
                  'funding_sources.id = budget_allocations_v2.funding_source_id',
                )
                .whereIn('funding_sources.tenant_id', me.amScopeOrgIds!);
            });
          }
        } else {
          q.whereExists((qb) => {
            qb.from('funding_sources')
              .whereRaw(
                'funding_sources.id = budget_allocations_v2.funding_source_id',
              )
              .where('funding_sources.tenant_id', me.tenantId);
          });
        }

        // SAUGUMO PATCH (Iter 13.x agregatinis leak fix, docx §4.4):
        // DU kategorijos allocations paslepiam vartotojams be DU teisės.
        // Kitaip org_user pamatytų DU allocation pavadinimą +
        // `planuotaSuma` per `categoryItemId=du` filter'ą arba bendrame
        // sąraše.
        if (!canViewPayroll(me)) {
          q.whereNotExists((qb) => {
            qb.from('classifier_items')
              .whereRaw(
                'classifier_items.id = budget_allocations_v2.category_classifier_item_id',
              )
              .where('classifier_items.code', 'du');
          });
        }

        if (ctx.params.fundingSourceId !== undefined) {
          q.where('funding_source_id', ctx.params.fundingSourceId);
        }
        if (ctx.params.year !== undefined) {
          q.where('metai', ctx.params.year);
        }
        if (ctx.params.categoryItemId !== undefined) {
          q.where('category_classifier_item_id', ctx.params.categoryItemId);
        }
        const rows = (await q) as BudgetAllocationWithRels[];
        return rows.map(toDTO);
      },
    },

    get: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(
        ctx: Context<{ id: number }, AuthMeta>,
      ): Promise<BudgetAllocationDTO> {
        const me = requireMe(ctx);
        const a = await loadAllocation(ctx.params.id);
        if (!a) {
          throw new Errors.MoleculerClientError(
            'Biudžeto paskirstymas nerastas',
            404,
            'BUDGET_ALLOCATION_NOT_FOUND',
          );
        }
        // SAUGUMO PATCH (Iter 13.x agregatinis leak fix, docx §4.4):
        // Tenant scope ne-AM vartotojams. Naudojam 404 (ne 403), kad
        // nepamatytų, jog allocation ID egzistuoja kitame tenant'e.
        if (!isAmAdminUser(me)) {
          const ownerTenantId = a.fundingSource?.tenantId;
          if (me.tenantIsApprover) {
            // AM user su scope
            if (
              me.amScopeOrgIds !== null &&
              (ownerTenantId === undefined ||
                !me.amScopeOrgIds.includes(ownerTenantId))
            ) {
              throw new Errors.MoleculerClientError(
                'Biudžeto paskirstymas nerastas',
                404,
                'BUDGET_ALLOCATION_NOT_FOUND',
              );
            }
          } else if (ownerTenantId !== me.tenantId) {
            throw new Errors.MoleculerClientError(
              'Biudžeto paskirstymas nerastas',
              404,
              'BUDGET_ALLOCATION_NOT_FOUND',
            );
          }
        }
        // DU kategorijos allocation paslepiam ne-DU vartotojams (404).
        if (
          !canViewPayroll(me) &&
          (a as BudgetAllocationWithRels).categoryClassifierItem?.code === 'du'
        ) {
          throw new Errors.MoleculerClientError(
            'Biudžeto paskirstymas nerastas',
            404,
            'BUDGET_ALLOCATION_NOT_FOUND',
          );
        }
        return toDTO(a);
      },
    },

    /**
     * Grąžina suvestinę vienam paskirstymui:
     *   planuota / faktinė / likutis + percentUsed + isWarning + isOver.
     *
     * - `planuota` = allocation.planuota_suma
     * - `faktine` = SUM(expenses.suma) WHERE budget_allocation_id = id
     *   (per visus expenses — single + multi-source; multi-source split
     *   nekeičia allocation pasirinkimo)
     * - `likutis` = planuota - faktine
     * - `percentUsed` = faktine / planuota × 100 (rounded 2 decimals)
     * - `isWarning` = percentUsed >= WARNING_THRESHOLD_PERCENT (default 80)
     * - `isOver` = percentUsed > 100
     */
    summary: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(
        ctx: Context<{ id: number }, AuthMeta>,
      ): Promise<BudgetAllocationSummary> {
        const me = requireMe(ctx);
        const a = (await BudgetAllocationV2.query()
          .findById(ctx.params.id)
          .withGraphFetched(
            '[categoryClassifierItem, fundingSource]',
          )) as BudgetAllocationWithRels | undefined;
        if (!a) {
          throw new Errors.MoleculerClientError(
            'Biudžeto paskirstymas nerastas',
            404,
            'BUDGET_ALLOCATION_NOT_FOUND',
          );
        }
        // SAUGUMO PATCH (Iter 13.x agregatinis leak fix, docx §4.4):
        // Tenant scope — analogiškai `get`. 404 ne 403, kad nepatvirtintume
        // ID egzistavimo kitame tenant'e.
        if (!isAmAdminUser(me)) {
          const ownerTenantId = a.fundingSource?.tenantId;
          if (me.tenantIsApprover) {
            if (
              me.amScopeOrgIds !== null &&
              (ownerTenantId === undefined ||
                !me.amScopeOrgIds.includes(ownerTenantId))
            ) {
              throw new Errors.MoleculerClientError(
                'Biudžeto paskirstymas nerastas',
                404,
                'BUDGET_ALLOCATION_NOT_FOUND',
              );
            }
          } else if (ownerTenantId !== me.tenantId) {
            throw new Errors.MoleculerClientError(
              'Biudžeto paskirstymas nerastas',
              404,
              'BUDGET_ALLOCATION_NOT_FOUND',
            );
          }
        }
        // DU kategorijos allocation summary — 404 ne-DU vartotojams. Kitaip
        // org_user pamatytų DU planuota + faktinė sumą per direktinį
        // `GET /budget-allocations/:duId/summary` route.
        if (
          !canViewPayroll(me) &&
          a.categoryClassifierItem?.code === 'du'
        ) {
          throw new Errors.MoleculerClientError(
            'Biudžeto paskirstymas nerastas',
            404,
            'BUDGET_ALLOCATION_NOT_FOUND',
          );
        }
        const planuotaCents = toCents(a.planuotaSuma);
        const expenseQ = Expense.query()
          .where('budget_allocation_id', a.id)
          .sum('suma as total');
        // SAUGUMO PATCH (Iter 13.x agregatinis leak fix, docx §4.4):
        // Defense-in-depth — SUM užklausoje neįskaitom DU expense'ų ne-DU
        // vartotojams. Edge case: jei DU expense kažkaip atsidurtų ne-DU
        // allocation'e (data drift), org_user vis tiek nepamatys DU sumos.
        if (!canViewPayroll(me)) {
          expenseQ.whereNot('expenses.tipas', 'du');
        }
        const sumRow = (await expenseQ.first()) as unknown as
          | { total: string | null }
          | undefined;
        const faktineCents = toCents(sumRow?.total ?? '0');
        const likutisCents = planuotaCents - faktineCents;
        const percentUsed = calculatePercentUsed(planuotaCents, faktineCents);
        const flags = calculateWarningFlags(percentUsed);
        return {
          planuota: centsToAmount(planuotaCents),
          faktine: centsToAmount(faktineCents),
          likutis: centsToAmount(likutisCents),
          percentUsed,
          isWarning: flags.isWarning,
          isOver: flags.isOver,
        };
      },
    },

    create: {
      params: {
        fundingSourceId: { type: 'number', integer: true, convert: true },
        categoryClassifierItemId: {
          type: 'number',
          integer: true,
          convert: true,
        },
        pavadinimas: { type: 'string', min: 1, max: 200 },
        specProgTipas: {
          type: 'enum',
          values: ['atskiras', 'biudzeto_dalis'],
          optional: true,
          nullable: true,
        },
        planuotaSuma: { type: 'string', min: 1 },
        metai: { type: 'number', integer: true, convert: true, min: 2000, max: 3000 },
        pastabos: { type: 'string', optional: true, nullable: true, max: 4000 },
      },
      async handler(
        ctx: Context<BudgetAllocationCreateDTO, AuthMeta>,
      ): Promise<BudgetAllocationDTO> {
        const me = requireMe(ctx);
        requireAmAdmin(me);
        const p = ctx.params;

        const source = await FundingSource.query().findById(p.fundingSourceId);
        if (!source) {
          throw new Errors.MoleculerClientError(
            'Finansavimo šaltinis nerastas',
            400,
            'INVALID_FUNDING_SOURCE',
          );
        }
        const categoryItem = await validateCategoryItem(p.categoryClassifierItemId);
        const specProgTipas = normalizeSpecProgTipas(
          categoryItem.code,
          p.specProgTipas,
        );
        const normalized = normalizeAmount(p.planuotaSuma);
        if (toCents(normalized) <= 0) {
          throw new Errors.MoleculerClientError(
            'Planuojama suma turi būti didesnė už 0',
            400,
            'INVALID_AMOUNT',
          );
        }

        const inserted = await BudgetAllocationV2.query().insert({
          fundingSourceId: p.fundingSourceId,
          categoryClassifierItemId: p.categoryClassifierItemId,
          pavadinimas: p.pavadinimas,
          specProgTipas,
          planuotaSuma: normalized,
          metai: p.metai,
          pastabos: p.pastabos ?? null,
        });
        const out = await loadAllocation(inserted.id);
        if (!out) throw new Error('Created allocation not found');
        return toDTO(out);
      },
    },

    update: {
      params: {
        id: { type: 'number', integer: true, convert: true },
        categoryClassifierItemId: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
        },
        pavadinimas: { type: 'string', optional: true, min: 1, max: 200 },
        specProgTipas: {
          type: 'enum',
          values: ['atskiras', 'biudzeto_dalis'],
          optional: true,
          nullable: true,
        },
        planuotaSuma: { type: 'string', optional: true, min: 1 },
        metai: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
          min: 2000,
          max: 3000,
        },
        pastabos: { type: 'string', optional: true, nullable: true, max: 4000 },
      },
      async handler(
        ctx: Context<BudgetAllocationUpdateDTO & { id: number }, AuthMeta>,
      ): Promise<BudgetAllocationDTO> {
        const me = requireMe(ctx);
        requireAmAdmin(me);
        const p = ctx.params;
        const target = await BudgetAllocationV2.query()
          .findById(p.id)
          .withGraphFetched('categoryClassifierItem');
        if (!target) {
          throw new Errors.MoleculerClientError(
            'Biudžeto paskirstymas nerastas',
            404,
            'BUDGET_ALLOCATION_NOT_FOUND',
          );
        }

        // Nustatyti, kokia kategorija galios po update'o — naujasis category
        // arba esamas, jei nekeičiamas. Reikalingas specProgTipas validacijai.
        let effectiveCategoryCode =
          (target as BudgetAllocationWithRels).categoryClassifierItem?.code ?? '';
        if (p.categoryClassifierItemId !== undefined) {
          const newCategory = await validateCategoryItem(p.categoryClassifierItemId);
          effectiveCategoryCode = newCategory.code;
        }

        const patch: Record<string, unknown> = {};
        if (p.categoryClassifierItemId !== undefined) {
          patch['categoryClassifierItemId'] = p.categoryClassifierItemId;
        }
        if (p.pavadinimas !== undefined) patch['pavadinimas'] = p.pavadinimas;
        if (p.specProgTipas !== undefined) {
          patch['specProgTipas'] = normalizeSpecProgTipas(
            effectiveCategoryCode,
            p.specProgTipas,
          );
        } else if (
          p.categoryClassifierItemId !== undefined &&
          effectiveCategoryCode !== SPEC_PROGRAMA_CODE &&
          target.specProgTipas !== null
        ) {
          // Pakeičiama kategorija iš spec_programa į kitą — esamas
          // specProgTipas reikšmę reikia force-null'inti, kad neliktų
          // nesuderinamų duomenų.
          patch['specProgTipas'] = null;
        }
        if (p.planuotaSuma !== undefined) {
          const normalized = normalizeAmount(p.planuotaSuma);
          if (toCents(normalized) <= 0) {
            throw new Errors.MoleculerClientError(
              'Planuojama suma turi būti didesnė už 0',
              400,
              'INVALID_AMOUNT',
            );
          }
          patch['planuotaSuma'] = normalized;
        }
        if (p.metai !== undefined) patch['metai'] = p.metai;
        if (p.pastabos !== undefined) patch['pastabos'] = p.pastabos;

        await BudgetAllocationV2.query().findById(target.id).patch(patch);
        const updated = await loadAllocation(target.id);
        if (!updated) throw new Error('Updated allocation not found');
        return toDTO(updated);
      },
    },

    delete: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(
        ctx: Context<{ id: number }, AuthMeta>,
      ): Promise<{ ok: true }> {
        const me = requireMe(ctx);
        requireAmAdmin(me);
        const target = await BudgetAllocationV2.query().findById(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError(
            'Biudžeto paskirstymas nerastas',
            404,
            'BUDGET_ALLOCATION_NOT_FOUND',
          );
        }
        // TODO Iter 11/12: kai bus sukurtos `projects` ir `expenses` lentelės,
        // čia tikrinti, ar į šitą allocation nesirišamas joks projektas ar
        // išlaida; jei taip — 409 Conflict su LT žinute. Schema jau apibrėžta
        // `docs/fvm/01-architecture.md` §projects ir §expenses.
        //
        // Implementation hint:
        //   const projCount = await Project.query()
        //     .where('budget_allocation_id', target.id).resultSize();
        //   const expCount = await Expense.query()
        //     .where('budget_allocation_id', target.id).resultSize();
        //   if (projCount > 0 || expCount > 0) throw 409 ...
        await BudgetAllocationV2.query().deleteById(target.id);
        return { ok: true };
      },
    },
  },
};

export default BudgetAllocationsService;
