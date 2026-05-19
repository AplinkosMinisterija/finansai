/**
 * Biudžetų servisas (issue #1).
 *
 * - list/get: visi autentifikuoti.
 * - upsert/delete: tik aprover tenant'o `admin` (AM admin).
 *
 * Upsert per metus: vienu kartu sukuria/atnaujina biudžetą + visus allocations.
 */
import type { ServiceSchema, Context } from 'moleculer';
import { Errors } from 'moleculer';
import type {
  Budget as BudgetDTO,
  BudgetAllocation as AllocationDTO,
  BudgetUpsertRequest,
} from '@biip-finansai/shared';
import { Budget } from '../models/Budget';
import { BudgetAllocation } from '../models/BudgetAllocation';
import { ClassifierItem } from '../models/ClassifierItem';
import type { AuthMeta } from './auth.service';

type BudgetWithRels = Budget & {
  allocations?: Array<BudgetAllocation & { classifierItem?: ClassifierItem }>;
};

function sumDecimal(values: string[]): string {
  // Sumuojam kaip integer cents, kad išvengtume float klaidų.
  const totalCents = values.reduce((acc, v) => {
    const n = Math.round(parseFloat(v || '0') * 100);
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
  return (totalCents / 100).toFixed(2);
}

function toAllocationDTO(a: BudgetAllocation & { classifierItem?: ClassifierItem }): AllocationDTO {
  return {
    id: a.id,
    budgetId: a.budgetId,
    classifierItemId: a.classifierItemId,
    classifierItemCode: a.classifierItem?.code,
    classifierItemName: a.classifierItem?.name,
    classifierItemParentId: a.classifierItem?.parentId ?? null,
    amount: a.amount,
  };
}

function toBudgetDTO(b: BudgetWithRels): BudgetDTO {
  const allocations = (b.allocations ?? []).map(toAllocationDTO);
  const allocatedAmount = sumDecimal(allocations.map((a) => a.amount));
  return {
    id: b.id,
    year: b.year,
    totalAmount: b.totalAmount,
    notes: b.notes,
    allocations,
    allocatedAmount,
  };
}

function requireMe(ctx: Context<unknown, AuthMeta>): NonNullable<AuthMeta['user']> {
  if (!ctx.meta.user) {
    throw new Errors.MoleculerClientError('Neautentifikuota', 401, 'AUTH_REQUIRED');
  }
  return ctx.meta.user;
}

function requireSuperAdmin(me: NonNullable<AuthMeta['user']>): void {
  if (!me.tenantIsApprover || me.role !== 'admin') {
    throw new Errors.MoleculerClientError(
      'Šis veiksmas leidžiamas tik AM administratoriui',
      403,
      'FORBIDDEN',
    );
  }
}

async function loadBudget(id: number): Promise<BudgetWithRels | undefined> {
  const b = await Budget.query()
    .findById(id)
    .withGraphFetched('allocations.classifierItem');
  return b as BudgetWithRels | undefined;
}

const BudgetsService: ServiceSchema = {
  name: 'budgets',

  actions: {
    list: {
      async handler(ctx: Context<unknown, AuthMeta>): Promise<BudgetDTO[]> {
        requireMe(ctx);
        const budgets = (await Budget.query()
          .withGraphFetched('allocations.classifierItem')
          .orderBy('year', 'desc')) as BudgetWithRels[];
        return budgets.map(toBudgetDTO);
      },
    },

    getByYear: {
      params: { year: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ year: number }, AuthMeta>): Promise<BudgetDTO | null> {
        requireMe(ctx);
        const b = (await Budget.query()
          .findOne({ year: ctx.params.year })
          .withGraphFetched('allocations.classifierItem')) as BudgetWithRels | undefined;
        return b ? toBudgetDTO(b) : null;
      },
    },

    get: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<BudgetDTO> {
        requireMe(ctx);
        const b = await loadBudget(ctx.params.id);
        if (!b) {
          throw new Errors.MoleculerClientError('Biudžetas nerastas', 404, 'BUDGET_NOT_FOUND');
        }
        return toBudgetDTO(b);
      },
    },

    upsert: {
      params: {
        year: { type: 'number', integer: true, convert: true },
        totalAmount: { type: 'string' },
        notes: { type: 'string', optional: true, nullable: true, max: 2000 },
        allocations: {
          type: 'array',
          items: {
            type: 'object',
            strict: true,
            props: {
              classifierItemId: { type: 'number', integer: true, convert: true },
              amount: { type: 'string' },
            },
          },
          default: [],
        },
      },
      async handler(ctx: Context<BudgetUpsertRequest, AuthMeta>): Promise<BudgetDTO> {
        const me = requireMe(ctx);
        requireSuperAdmin(me);
        const p = ctx.params;

        // Validacija: visi allocation classifier item'ai egzistuoja.
        if (p.allocations.length > 0) {
          const ids = p.allocations.map((a) => a.classifierItemId);
          const items = await ClassifierItem.query().whereIn('id', ids);
          if (items.length !== new Set(ids).size) {
            throw new Errors.MoleculerClientError(
              'Vienas ar daugiau klasifikatoriaus reikšmių neegzistuoja',
              400,
              'INVALID_CLASSIFIER',
            );
          }
        }

        const knex = Budget.knex();
        const trx = await knex.transaction();
        try {
          let budget = await Budget.query(trx).findOne({ year: p.year });
          if (budget) {
            await Budget.query(trx).findById(budget.id).patch({
              totalAmount: p.totalAmount,
              notes: p.notes ?? null,
            });
          } else {
            budget = await Budget.query(trx).insert({
              year: p.year,
              totalAmount: p.totalAmount,
              notes: p.notes ?? null,
            });
          }
          // Allocations — full replace (drop existing, insert new).
          await BudgetAllocation.query(trx).where('budget_id', budget.id).delete();
          if (p.allocations.length > 0) {
            // Deduplikuojam pagal classifier_item_id (sumuojam, jei dublikuojama).
            const merged = new Map<number, number>();
            for (const a of p.allocations) {
              const cents = Math.round(parseFloat(a.amount || '0') * 100);
              merged.set(
                a.classifierItemId,
                (merged.get(a.classifierItemId) ?? 0) + cents,
              );
            }
            const rows = Array.from(merged.entries()).map(([cid, cents]) => ({
              budgetId: budget!.id,
              classifierItemId: cid,
              amount: (cents / 100).toFixed(2),
            }));
            await BudgetAllocation.query(trx).insert(rows);
          }
          await trx.commit();
          const out = await loadBudget(budget.id);
          if (!out) throw new Error('Updated budget not found');
          return toBudgetDTO(out);
        } catch (e) {
          await trx.rollback();
          throw e;
        }
      },
    },

    delete: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<{ ok: true }> {
        const me = requireMe(ctx);
        requireSuperAdmin(me);
        const target = await Budget.query().findById(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError('Biudžetas nerastas', 404, 'BUDGET_NOT_FOUND');
        }
        await Budget.query().deleteById(target.id);
        return { ok: true };
      },
    },
  },
};

export default BudgetsService;
