/**
 * BudgetAllocationV2 modelis — biudžeto paskirstymas (2 FVM lygis, Iter 9).
 *
 * Atsako į klausimą „Kam skiriama?" (pvz., DU 500k, Spec.programa A 200k,
 * Prekės/paslaugos 800k). Per ADR-001 — kategorija yra FK į classifier_items
 * grupėje `budget_category`, ne SQL enum.
 *
 * Klasė pavadinta `BudgetAllocationV2` (su V2 suffix'u), nes esamas modelis
 * `BudgetAllocation` (`apps/api/src/models/BudgetAllocation.ts`) reprezentuoja
 * seną schemą (`budget_allocations` lentelė). Klasė pavadinta pagal lentelę
 * (`budget_allocations_v2`). Iter 16 metu sena lentelė bus pašalinta, ši
 * pervadinta į `budget_allocations` ir klasė atitinkamai į `BudgetAllocation`.
 *
 * `specProgTipas` — laukas, kuris naudojamas TIK kai allocation kategorija
 * yra `spec_programa`. DB CHECK constraint užtikrina, kad reikšmė yra
 * `null` arba `atskiras` / `biudzeto_dalis`.
 *
 * Detali architektūra — `docs/fvm/01-architecture.md` §budget_allocations.
 */
import type { JSONSchema, RelationMappings } from 'objection';
import type { SpecProgTipas } from '@biip-finansai/shared';
import { BaseModel } from './Base';

export class BudgetAllocationV2 extends BaseModel {
  static override tableName = 'budget_allocations_v2';

  id!: number;
  fundingSourceId!: number;
  categoryClassifierItemId!: number;
  pavadinimas!: string;
  specProgTipas!: SpecProgTipas | null;
  /** Decimal(15,2) — preserved as string per Objection convention. */
  planuotaSuma!: string;
  metai!: number;
  pastabos!: string | null;
  createdAt!: string;
  updatedAt!: string;

  // Eager-loaded
  fundingSource?: import('./FundingSource').FundingSource;
  categoryClassifierItem?: import('./ClassifierItem').ClassifierItem;

  static override get jsonSchema(): JSONSchema {
    return {
      type: 'object',
      required: [
        'fundingSourceId',
        'categoryClassifierItemId',
        'pavadinimas',
        'planuotaSuma',
        'metai',
      ],
      properties: {
        id: { type: 'integer' },
        fundingSourceId: { type: 'integer' },
        categoryClassifierItemId: { type: 'integer' },
        pavadinimas: { type: 'string', minLength: 1, maxLength: 200 },
        specProgTipas: {
          type: ['string', 'null'],
          enum: ['atskiras', 'biudzeto_dalis', null],
        },
        planuotaSuma: { type: 'string' },
        metai: { type: 'integer', minimum: 2000, maximum: 3000 },
        pastabos: { type: ['string', 'null'] },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' },
      },
    };
  }

  static override get relationMappings(): RelationMappings {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { FundingSource } =
      require('./FundingSource') as typeof import('./FundingSource');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ClassifierItem } =
      require('./ClassifierItem') as typeof import('./ClassifierItem');

    return {
      fundingSource: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: FundingSource,
        join: {
          from: 'budget_allocations_v2.funding_source_id',
          to: 'funding_sources.id',
        },
      },
      categoryClassifierItem: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: ClassifierItem,
        join: {
          from: 'budget_allocations_v2.category_classifier_item_id',
          to: 'classifier_items.id',
        },
      },
    };
  }
}
