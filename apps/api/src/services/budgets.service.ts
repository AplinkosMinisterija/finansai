/**
 * Biudžetų servisas (issue #1) — DEPRECATED nuo Iter 9 (FVM-1).
 *
 * @deprecated
 * Šis servisas operuoja SENĄJĄ vieno-lygio biudžeto schemą (`budgets` +
 * `budget_allocations`). Iter 9 metu pakeičia 2-lygis FVM modelis:
 *
 *  - `fundingSources.service.ts` — 1 lygis (finansavimo šaltiniai)
 *  - `budgetAllocations.service.ts` — 2 lygis (biudžeto paskirstymas)
 *
 * Šis servisas lieka aktyvus tik backward compat'ui (read-only `list`/`get`/
 * `getByYear` per senas lenteles) iki Iter 16. Tada `budgets` +
 * `budget_allocations` lentelės bus pašalintos, o `budget_allocations_v2`
 * bus pervadinta į `budget_allocations` (be `_v2` suffix'o).
 *
 * Iter 9 metu funkcijų NEKEITĖM — tik pridėjom deprecated marker'į.
 *
 * Detali migration strategy — `docs/fvm/02-migration-strategy.md`.
 */
import type { ServiceSchema, Context } from 'moleculer';
import { Errors } from 'moleculer';
import type {
  Budget as BudgetDTO,
  LegacyBudgetAllocation as AllocationDTO,
  BudgetUpsertRequest,
} from '@biip-finansai/shared';
import { Budget } from '../models/Budget';
import { BudgetAllocation } from '../models/BudgetAllocation';
import { ClassifierItem } from '../models/ClassifierItem';
import { Request } from '../models/Request';
import { centsToAmount, sumAmounts, toCents } from '../utils/money';
import type { AuthMeta } from './auth.service';

type BudgetWithRels = Budget & {
  allocations?: Array<BudgetAllocation & { classifierItem?: ClassifierItem }>;
};

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

function toBudgetDTO(b: BudgetWithRels, approvedAmount?: string): BudgetDTO {
  const allocations = (b.allocations ?? []).map(toAllocationDTO);
  const allocatedAmount = sumAmounts(allocations.map((a) => a.amount));
  return {
    id: b.id,
    year: b.year,
    totalAmount: b.totalAmount,
    notes: b.notes,
    allocations,
    allocatedAmount,
    approvedAmount,
  };
}

/**
 * Susumuoja patvirtintų prašymų (status='APPROVED') `decisionGrantedAmount` per metus.
 * Naudoja cents'us, kad išvengtume float klaidų.
 */
async function approvedAmountForYear(year: number): Promise<string> {
  const rows = (await Request.query()
    .where({ year, status: 'APPROVED' })
    .whereNotNull('decision_granted_amount')
    .select('decision_granted_amount as decisionGrantedAmount')) as Array<{
    decisionGrantedAmount: string | null;
  }>;
  return sumAmounts(rows.map((r) => r.decisionGrantedAmount ?? '0'));
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
        const approvedByYear = new Map<number, string>();
        await Promise.all(
          budgets.map(async (b) => {
            approvedByYear.set(b.year, await approvedAmountForYear(b.year));
          }),
        );
        return budgets.map((b) => toBudgetDTO(b, approvedByYear.get(b.year)));
      },
    },

    getByYear: {
      params: { year: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ year: number }, AuthMeta>): Promise<BudgetDTO | null> {
        requireMe(ctx);
        const b = (await Budget.query()
          .findOne({ year: ctx.params.year })
          .withGraphFetched('allocations.classifierItem')) as BudgetWithRels | undefined;
        if (!b) return null;
        const approvedAmount = await approvedAmountForYear(b.year);
        return toBudgetDTO(b, approvedAmount);
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
        const approvedAmount = await approvedAmountForYear(b.year);
        return toBudgetDTO(b, approvedAmount);
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

        // Validacija: visi allocation classifier item'ai egzistuoja ir yra aktyvūs.
        if (p.allocations.length > 0) {
          const ids = p.allocations.map((a) => a.classifierItemId);
          const items = await ClassifierItem.query()
            .whereIn('id', ids)
            .andWhere('active', true);
          if (items.length !== new Set(ids).size) {
            throw new Errors.MoleculerClientError(
              'Vienas ar daugiau klasifikatoriaus reikšmių neegzistuoja arba yra neaktyvios',
              400,
              'INVALID_CLASSIFIER',
            );
          }
        }

        // Validacija: paskirstymų suma negali viršyti bendro biudžeto.
        // Sumuojam cents'ais, kad išvengtume float klaidų.
        const totalCents = toCents(p.totalAmount);
        const allocatedCents = p.allocations.reduce(
          (acc, a) => acc + toCents(a.amount),
          0,
        );
        if (allocatedCents > totalCents) {
          throw new Errors.MoleculerClientError(
            'Allocations suma viršija bendrą biudžetą',
            400,
            'BUDGET_OVERFLOW',
          );
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
              merged.set(
                a.classifierItemId,
                (merged.get(a.classifierItemId) ?? 0) + toCents(a.amount),
              );
            }
            const rows = Array.from(merged.entries()).map(([cid, cents]) => ({
              budgetId: budget!.id,
              classifierItemId: cid,
              amount: centsToAmount(cents),
            }));
            await BudgetAllocation.query(trx).insert(rows);
          }
          await trx.commit();
          const out = await loadBudget(budget.id);
          if (!out) throw new Error('Updated budget not found');
          const approvedAmount = await approvedAmountForYear(out.year);
          return toBudgetDTO(out, approvedAmount);
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
