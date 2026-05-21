/**
 * FundingSource modelis — finansavimo šaltinis (1 FVM lygis, Iter 9).
 *
 * Atsako į klausimą „Iš kur pinigai?" (pvz., Valstybės biudžetas 2026,
 * ES fondas X, ...). Per ADR-001 — tipas yra FK į classifier_items
 * grupėje `funding_source_type`, ne SQL enum.
 *
 * Unique constraint: (tenant_id, kodas, metai) — tą patį šaltinį galima
 * registruoti per kelis metus.
 *
 * Detali architektūra — `docs/fvm/01-architecture.md` §funding_sources.
 */
import type { JSONSchema, RelationMappings } from 'objection';
import { BaseModel } from './Base';

export class FundingSource extends BaseModel {
  static override tableName = 'funding_sources';

  id!: number;
  tenantId!: number;
  pavadinimas!: string;
  kodas!: string;
  tipasClassifierItemId!: number;
  metai!: number;
  /** Decimal(15,2) — preserved as string per Objection convention. */
  metineSuma!: string;
  aprasymas!: string | null;
  aktyvus!: boolean;
  createdAt!: string;
  updatedAt!: string;

  // Eager-loaded
  tenant?: import('./Tenant').Tenant;
  tipasClassifierItem?: import('./ClassifierItem').ClassifierItem;
  allocations?: import('./BudgetAllocationV2').BudgetAllocationV2[];

  static override get jsonSchema(): JSONSchema {
    return {
      type: 'object',
      required: [
        'tenantId',
        'pavadinimas',
        'kodas',
        'tipasClassifierItemId',
        'metai',
        'metineSuma',
      ],
      properties: {
        id: { type: 'integer' },
        tenantId: { type: 'integer' },
        pavadinimas: { type: 'string', minLength: 1, maxLength: 200 },
        kodas: { type: 'string', minLength: 1, maxLength: 50 },
        tipasClassifierItemId: { type: 'integer' },
        metai: { type: 'integer', minimum: 2000, maximum: 3000 },
        // Decimal pernešamas string'u (preserves precision).
        metineSuma: { type: 'string' },
        aprasymas: { type: ['string', 'null'] },
        aktyvus: { type: 'boolean' },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' },
      },
    };
  }

  static override get relationMappings(): RelationMappings {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Tenant } = require('./Tenant') as typeof import('./Tenant');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ClassifierItem } =
      require('./ClassifierItem') as typeof import('./ClassifierItem');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BudgetAllocationV2 } =
      require('./BudgetAllocationV2') as typeof import('./BudgetAllocationV2');

    return {
      tenant: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Tenant,
        join: { from: 'funding_sources.tenant_id', to: 'tenants.id' },
      },
      tipasClassifierItem: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: ClassifierItem,
        join: {
          from: 'funding_sources.tipas_classifier_item_id',
          to: 'classifier_items.id',
        },
      },
      allocations: {
        relation: BaseModel.HasManyRelation,
        modelClass: BudgetAllocationV2,
        join: {
          from: 'funding_sources.id',
          to: 'budget_allocations_v2.funding_source_id',
        },
      },
    };
  }
}
