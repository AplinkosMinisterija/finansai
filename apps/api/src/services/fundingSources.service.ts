/**
 * Finansavimo šaltinių servisas (Iter 9, FVM-1).
 *
 * 1 FVM lygis: „Iš kur pinigai?" — pvz., Valstybės biudžetas 2026 (1.5M €).
 *
 * Permission modelis (žr. `docs/fvm/01-architecture.md` §Permission modelis):
 *  - `list` / `get` — visi autentifikuoti vartotojai (skaitymas)
 *  - `create` / `update` / `delete` — tik AM administrator'ius
 *    (aprover tenant'o `admin`)
 *
 * Verslo invariantai:
 *  - `tipasClassifierItemId` PRIVALO būti iš grupės `funding_source_type`
 *  - Unique (tenant_id, kodas, metai) — tikrinamas DB lygiu + apvalkalas
 *    pateikia friendly LT klaidos žinutę
 *  - DELETE RESTRICT'inta — negali ištrinti šaltinio, jei turi
 *    rišamų `budget_allocations_v2` (409 Conflict, LT žinutė)
 *
 * REST aliases (`api.service.ts`):
 *  - GET    /funding-sources         → fundingSources.list
 *  - GET    /funding-sources/:id     → fundingSources.get
 *  - POST   /funding-sources         → fundingSources.create
 *  - PATCH  /funding-sources/:id     → fundingSources.update
 *  - DELETE /funding-sources/:id     → fundingSources.delete
 */
import type { ServiceSchema, Context } from 'moleculer';
import { Errors } from 'moleculer';
import type {
  FundingSource as FundingSourceDTO,
  FundingSourceCreateDTO,
  FundingSourceUpdateDTO,
} from '@biip-finansai/shared';
import { FundingSource } from '../models/FundingSource';
import { BudgetAllocationV2 } from '../models/BudgetAllocationV2';
import { ClassifierGroup } from '../models/ClassifierGroup';
import { ClassifierItem } from '../models/ClassifierItem';
import { Tenant } from '../models/Tenant';
import { centsToAmount, normalizeAmount, toCents } from '../utils/money';
import { isAmAdminUser } from '../utils/permissions';
import type { AuthMeta } from './auth.service';

const FUNDING_SOURCE_TYPE_GROUP_CODE = 'funding_source_type';

type FundingSourceWithRels = FundingSource & {
  tipasClassifierItem?: ClassifierItem;
  tenant?: Tenant;
  allocations?: BudgetAllocationV2[];
};

function toDTO(
  fs: FundingSourceWithRels,
  extras?: { allocationsCount?: number; allocatedAmount?: string },
): FundingSourceDTO {
  return {
    id: fs.id,
    tenantId: fs.tenantId,
    pavadinimas: fs.pavadinimas,
    kodas: fs.kodas,
    tipasClassifierItemId: fs.tipasClassifierItemId,
    tipasCode: fs.tipasClassifierItem?.code,
    tipasName: fs.tipasClassifierItem?.name,
    tenantCode: fs.tenant?.code,
    tenantName: fs.tenant?.name,
    metai: fs.metai,
    metineSuma: fs.metineSuma,
    aprasymas: fs.aprasymas,
    aktyvus: fs.aktyvus,
    allocationsCount: extras?.allocationsCount,
    allocatedAmount: extras?.allocatedAmount,
    createdAt: fs.createdAt,
    updatedAt: fs.updatedAt,
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
 * Patikrina, kad classifier_item priklauso grupei `funding_source_type` ir
 * yra aktyvus. Throw'ina LT klaidos žinutę, jei ne.
 */
async function validateFundingSourceTypeItem(itemId: number): Promise<void> {
  const item = await ClassifierItem.query()
    .findById(itemId)
    .withGraphFetched('group');
  if (!item) {
    throw new Errors.MoleculerClientError(
      'Finansavimo šaltinio tipas nerastas klasifikatoriuje',
      400,
      'INVALID_TYPE_ITEM',
    );
  }
  if (!item.active) {
    throw new Errors.MoleculerClientError(
      'Pasirinkta finansavimo šaltinio tipo reikšmė yra neaktyvi',
      400,
      'INACTIVE_TYPE_ITEM',
    );
  }
  const group = (item as ClassifierItem & { group?: ClassifierGroup }).group;
  if (!group || group.code !== FUNDING_SOURCE_TYPE_GROUP_CODE) {
    throw new Errors.MoleculerClientError(
      `Pasirinkta klasifikatoriaus reikšmė priklauso ne „${FUNDING_SOURCE_TYPE_GROUP_CODE}" grupei`,
      400,
      'INVALID_TYPE_GROUP',
    );
  }
}

async function loadFundingSource(
  id: number,
): Promise<FundingSourceWithRels | undefined> {
  const fs = await FundingSource.query()
    .findById(id)
    .withGraphFetched('[tenant, tipasClassifierItem]');
  return fs as FundingSourceWithRels | undefined;
}

interface AllocationStats {
  count: number;
  allocatedAmount: string;
}

/**
 * Per kiekvieną pateiktą funding source ID — apskaičiuoja allocations count
 * ir sumą (centsais, kad išvengtume float drift'o).
 */
async function loadAllocationStats(
  sourceIds: number[],
): Promise<Map<number, AllocationStats>> {
  const stats = new Map<number, AllocationStats>();
  for (const id of sourceIds) {
    stats.set(id, { count: 0, allocatedAmount: '0.00' });
  }
  if (sourceIds.length === 0) return stats;

  const rows = (await BudgetAllocationV2.query()
    .select('funding_source_id')
    .count('* as count')
    .sum('planuota_suma as total')
    .whereIn('funding_source_id', sourceIds)
    .groupBy('funding_source_id')) as unknown as Array<{
    fundingSourceId: number;
    count: string;
    total: string | null;
  }>;

  for (const row of rows) {
    stats.set(row.fundingSourceId, {
      count: Number(row.count),
      allocatedAmount: centsToAmount(toCents(row.total ?? '0')),
    });
  }
  return stats;
}

interface ListParams {
  year?: number;
  tenantId?: number;
  typeItemId?: number;
}

const FundingSourcesService: ServiceSchema = {
  name: 'fundingSources',

  actions: {
    list: {
      params: {
        year: { type: 'number', integer: true, optional: true, convert: true },
        tenantId: { type: 'number', integer: true, optional: true, convert: true },
        typeItemId: { type: 'number', integer: true, optional: true, convert: true },
      },
      async handler(ctx: Context<ListParams, AuthMeta>): Promise<FundingSourceDTO[]> {
        const me = requireMe(ctx);
        const q = FundingSource.query()
          .withGraphFetched('[tenant, tipasClassifierItem]')
          .orderBy([
            { column: 'metai', order: 'desc' },
            { column: 'kodas', order: 'asc' },
          ]);

        // SAUGUMO PATCH (Iter 13.x agregatinis leak fix, docx §4.4 / S15.C):
        // Tenant scope — iki šiol `fundingSources.list` neturėjo tenant
        // scope'o, org_user matydavo visų tenant'ų funding sources kartu
        // su `allocatedAmount` agregatu. Po patch'o:
        //   - AM admin: visi tenant'ai
        //   - AM user su scope=null: visi tenant'ai
        //   - AM user su scope=[ids]: tik scope'o tenant'ai
        //   - Org admin / org user: TIK savo tenant'as
        if (me.tenantIsApprover) {
          if (me.role === 'user' && me.amScopeOrgIds !== null) {
            if (me.amScopeOrgIds.length === 0) {
              return [];
            }
            q.whereIn('tenant_id', me.amScopeOrgIds);
          }
        } else {
          q.where('tenant_id', me.tenantId);
        }

        if (ctx.params.year !== undefined) {
          q.where('metai', ctx.params.year);
        }
        if (ctx.params.tenantId !== undefined) {
          q.where('tenant_id', ctx.params.tenantId);
        }
        if (ctx.params.typeItemId !== undefined) {
          q.where('tipas_classifier_item_id', ctx.params.typeItemId);
        }
        const sources = (await q) as FundingSourceWithRels[];
        const stats = await loadAllocationStats(sources.map((s) => s.id));
        return sources.map((fs) => {
          const s = stats.get(fs.id);
          return toDTO(fs, {
            allocationsCount: s?.count ?? 0,
            allocatedAmount: s?.allocatedAmount ?? '0.00',
          });
        });
      },
    },

    get: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(
        ctx: Context<{ id: number }, AuthMeta>,
      ): Promise<FundingSourceDTO> {
        const me = requireMe(ctx);
        const fs = await loadFundingSource(ctx.params.id);
        if (!fs) {
          throw new Errors.MoleculerClientError(
            'Finansavimo šaltinis nerastas',
            404,
            'FUNDING_SOURCE_NOT_FOUND',
          );
        }
        // SAUGUMO PATCH (Iter 13.x agregatinis leak fix, docx §4.4):
        // Tenant scope — ne-AM admin'ai gali matyti tik savo tenant'ą.
        // Naudojam 404, kad nepatvirtintume ID egzistavimo.
        if (!isAmAdminUser(me)) {
          if (me.tenantIsApprover) {
            if (
              me.amScopeOrgIds !== null &&
              !me.amScopeOrgIds.includes(fs.tenantId)
            ) {
              throw new Errors.MoleculerClientError(
                'Finansavimo šaltinis nerastas',
                404,
                'FUNDING_SOURCE_NOT_FOUND',
              );
            }
          } else if (fs.tenantId !== me.tenantId) {
            throw new Errors.MoleculerClientError(
              'Finansavimo šaltinis nerastas',
              404,
              'FUNDING_SOURCE_NOT_FOUND',
            );
          }
        }
        const stats = await loadAllocationStats([fs.id]);
        const s = stats.get(fs.id);
        return toDTO(fs, {
          allocationsCount: s?.count ?? 0,
          allocatedAmount: s?.allocatedAmount ?? '0.00',
        });
      },
    },

    create: {
      params: {
        tenantId: { type: 'number', integer: true, convert: true },
        pavadinimas: { type: 'string', min: 1, max: 200 },
        kodas: { type: 'string', min: 1, max: 50 },
        tipasClassifierItemId: { type: 'number', integer: true, convert: true },
        metai: { type: 'number', integer: true, convert: true, min: 2000, max: 3000 },
        metineSuma: { type: 'string', min: 1 },
        aprasymas: { type: 'string', optional: true, nullable: true, max: 4000 },
        aktyvus: { type: 'boolean', optional: true, default: true },
      },
      async handler(
        ctx: Context<FundingSourceCreateDTO, AuthMeta>,
      ): Promise<FundingSourceDTO> {
        const me = requireMe(ctx);
        requireAmAdmin(me);
        const p = ctx.params;

        const tenant = await Tenant.query().findById(p.tenantId);
        if (!tenant) {
          throw new Errors.MoleculerClientError(
            'Organizacija nerasta',
            400,
            'INVALID_TENANT',
          );
        }
        await validateFundingSourceTypeItem(p.tipasClassifierItemId);
        const normalized = normalizeAmount(p.metineSuma);
        if (toCents(normalized) <= 0) {
          throw new Errors.MoleculerClientError(
            'Metinė suma turi būti didesnė už 0',
            400,
            'INVALID_AMOUNT',
          );
        }

        try {
          const inserted = await FundingSource.query().insert({
            tenantId: p.tenantId,
            pavadinimas: p.pavadinimas,
            kodas: p.kodas,
            tipasClassifierItemId: p.tipasClassifierItemId,
            metai: p.metai,
            metineSuma: normalized,
            aprasymas: p.aprasymas ?? null,
            aktyvus: p.aktyvus ?? true,
          });
          const out = await loadFundingSource(inserted.id);
          if (!out) throw new Error('Created funding source not found');
          return toDTO(out, { allocationsCount: 0, allocatedAmount: '0.00' });
        } catch (err: unknown) {
          // Objection wrap'ina PG unique violation į `UniqueViolationError`
          // (constructor name) su `.constraint`. Tikrinam abu variantus —
          // raw pg klaidą (code='23505') ir Objection wrapper'į.
          const e = err as {
            code?: string;
            constraint?: string;
            name?: string;
          };
          const isUniqueViolation =
            e.code === '23505' || e.name === 'UniqueViolationError';
          if (
            isUniqueViolation &&
            (e.constraint?.includes('tenant_id_kodas_metai') ?? false)
          ) {
            throw new Errors.MoleculerClientError(
              'Šios organizacijos finansavimo šaltinis su tokiu kodu šiems metams jau egzistuoja',
              409,
              'FUNDING_SOURCE_DUPLICATE',
            );
          }
          throw err;
        }
      },
    },

    update: {
      params: {
        id: { type: 'number', integer: true, convert: true },
        pavadinimas: { type: 'string', optional: true, min: 1, max: 200 },
        kodas: { type: 'string', optional: true, min: 1, max: 50 },
        tipasClassifierItemId: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
        },
        metai: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
          min: 2000,
          max: 3000,
        },
        metineSuma: { type: 'string', optional: true, min: 1 },
        aprasymas: { type: 'string', optional: true, nullable: true, max: 4000 },
        aktyvus: { type: 'boolean', optional: true },
      },
      async handler(
        ctx: Context<FundingSourceUpdateDTO & { id: number }, AuthMeta>,
      ): Promise<FundingSourceDTO> {
        const me = requireMe(ctx);
        requireAmAdmin(me);
        const p = ctx.params;
        const target = await FundingSource.query().findById(p.id);
        if (!target) {
          throw new Errors.MoleculerClientError(
            'Finansavimo šaltinis nerastas',
            404,
            'FUNDING_SOURCE_NOT_FOUND',
          );
        }
        if (p.tipasClassifierItemId !== undefined) {
          await validateFundingSourceTypeItem(p.tipasClassifierItemId);
        }
        const patch: Record<string, unknown> = {};
        if (p.pavadinimas !== undefined) patch['pavadinimas'] = p.pavadinimas;
        if (p.kodas !== undefined) patch['kodas'] = p.kodas;
        if (p.tipasClassifierItemId !== undefined) {
          patch['tipasClassifierItemId'] = p.tipasClassifierItemId;
        }
        if (p.metai !== undefined) patch['metai'] = p.metai;
        if (p.metineSuma !== undefined) {
          const normalized = normalizeAmount(p.metineSuma);
          if (toCents(normalized) <= 0) {
            throw new Errors.MoleculerClientError(
              'Metinė suma turi būti didesnė už 0',
              400,
              'INVALID_AMOUNT',
            );
          }
          patch['metineSuma'] = normalized;
        }
        if (p.aprasymas !== undefined) patch['aprasymas'] = p.aprasymas;
        if (p.aktyvus !== undefined) patch['aktyvus'] = p.aktyvus;

        try {
          await FundingSource.query().findById(target.id).patch(patch);
        } catch (err: unknown) {
          const e = err as { code?: string; constraint?: string };
          if (
            e.code === '23505' &&
            (e.constraint?.includes('tenant_id_kodas_metai') ?? false)
          ) {
            throw new Errors.MoleculerClientError(
              'Šios organizacijos finansavimo šaltinis su tokiu kodu šiems metams jau egzistuoja',
              409,
              'FUNDING_SOURCE_DUPLICATE',
            );
          }
          throw err;
        }
        const updated = await loadFundingSource(target.id);
        if (!updated) throw new Error('Updated funding source not found');
        const stats = await loadAllocationStats([updated.id]);
        const s = stats.get(updated.id);
        return toDTO(updated, {
          allocationsCount: s?.count ?? 0,
          allocatedAmount: s?.allocatedAmount ?? '0.00',
        });
      },
    },

    delete: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(
        ctx: Context<{ id: number }, AuthMeta>,
      ): Promise<{ ok: true }> {
        const me = requireMe(ctx);
        requireAmAdmin(me);
        const target = await FundingSource.query().findById(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError(
            'Finansavimo šaltinis nerastas',
            404,
            'FUNDING_SOURCE_NOT_FOUND',
          );
        }
        const allocationCount = await BudgetAllocationV2.query()
          .where('funding_source_id', target.id)
          .resultSize();
        if (allocationCount > 0) {
          throw new Errors.MoleculerClientError(
            'Negalima ištrinti finansavimo šaltinio — jam priklauso biudžeto paskirstymai. Pirma ištrinkite paskirstymus.',
            409,
            'FUNDING_SOURCE_HAS_ALLOCATIONS',
          );
        }
        await FundingSource.query().deleteById(target.id);
        return { ok: true };
      },
    },
  },
};

export default FundingSourcesService;
