/**
 * Expense modelis — projekto faktinė išlaida (Iter 12, FVM-4).
 *
 * Atsako į klausimą „Kiek konkrečiai jau išleista?" — kiekviena išlaida
 * susieta su projektu (`projectId`) ir biudžeto eilute (`budgetAllocationId`).
 * Lentelė `expenses` sukurta `20260525100000_create_expenses.ts` migracija.
 *
 * Multi-source split per `saltinioDalis` jsonb (ADR-002):
 *  - NULL → single-source: paveldima per
 *    `budget_allocation.funding_source_id`.
 *  - Array → multi-source: `[{ funding_source_id, suma }, ...]`. Saugomas DB
 *    snake_case'u; klasė nemap'ina šio lauko per snakeCaseMappers
 *    (jsonb laikomas vienas reikšmių „pakelis"). Serviso lygmenyje
 *    konvertuojam į camelCase array prieš grąžinant DTO.
 *
 * Saugumas / lifecycle:
 *  - `projectId` RESTRICT — projekto trinti negalima, kol yra išlaidų.
 *  - `budgetAllocationId` RESTRICT — biudžeto eilutės trinti negalima.
 *  - `createdByUserId` RESTRICT — vartotojo trinti negalima, kol yra jo
 *    sukurtų išlaidų (audit trail).
 *
 * JSON schema validation:
 *  - `tipas` apribota į 4 leistinas reikšmes (suderinta su DB CHECK constraint'u).
 *  - `saltinioDalis` jsonb array — JSON schema validuoja struktūrą (array
 *    objektų su `funding_source_id: integer` + `suma: string`).
 *    Verslo invariantas SUM(`suma`) === expense.`suma` tikrinamas servise
 *    (model'is JSON schema epsilon comparison'o atlikti negali).
 *
 * Detali architektūra — `docs/fvm/01-architecture.md` §6.4 + ADR-002.
 */
import type { JSONSchema, RelationMappings } from 'objection';
import type {
  ExpenseSourceDistributionItem,
  ExpenseType,
} from '@biip-finansai/shared';
import { BaseModel } from './Base';

/**
 * DB row reprezentacija multi-source split eilutės. Skiriasi nuo
 * `ExpenseSourceDistributionItem` tuo, kad jsonb saugoma SNAKE_CASE
 * (PG / DBA konvencija), o shared DTO — CAMEL_CASE.
 */
export interface ExpenseSourceDistributionRow {
  funding_source_id: number;
  suma: string;
}

export class Expense extends BaseModel {
  static override tableName = 'expenses';

  id!: number;
  projectId!: number;
  budgetAllocationId!: number;
  tipas!: ExpenseType;
  /** Decimal(15,2) — preserved as string per Objection convention. */
  suma!: string;
  data!: string;
  aprasymas!: string | null;
  /**
   * DB lygyje saugoma kaip jsonb array; vertė — array iš
   * `ExpenseSourceDistributionRow` (snake_case keys). Servis konvertuoja į
   * camelCase prieš DTO grąžinimą.
   *
   * NULL — single-source (default per `budget_allocation.funding_source_id`).
   */
  saltinioDalis!: ExpenseSourceDistributionRow[] | null;
  /**
   * Tiesioginė nuoroda į `payroll_profiles` (Iter 14 — FVM-6 reports).
   *
   * NULL visiems ne-DU expense'ams. DU expense'ams set'ina
   * `payroll.computeMonth` — naudojama `reports.payrollDistribution` per
   * profile agregavimui (vietoj trapus `aprasymas` parse'o).
   *
   * FK ON DELETE SET NULL: jei profilis ištrinamas, expense'as išlieka
   * audit trail'ui, bet susiejimas pranyksta.
   */
  payrollProfileId!: number | null;
  createdByUserId!: number;
  createdAt!: string;
  updatedAt!: string;

  // Eager-loaded
  project?: import('./Project').Project;
  budgetAllocation?: import('./BudgetAllocationV2').BudgetAllocationV2;
  createdByUser?: import('./User').User;
  payrollProfile?: import('./PayrollProfile').PayrollProfile;

  static override get jsonSchema(): JSONSchema {
    return {
      type: 'object',
      required: [
        'projectId',
        'budgetAllocationId',
        'tipas',
        'suma',
        'data',
        'createdByUserId',
      ],
      properties: {
        id: { type: 'integer' },
        projectId: { type: 'integer' },
        budgetAllocationId: { type: 'integer' },
        tipas: {
          type: 'string',
          enum: ['du', 'sutartis', 'saskaita', 'tiesiogine'],
        },
        suma: { type: 'string' },
        data: { type: 'string' },
        aprasymas: { type: ['string', 'null'], maxLength: 500 },
        // jsonb saltinio_dalis: array of `{ funding_source_id, suma }` arba null
        saltinioDalis: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            required: ['funding_source_id', 'suma'],
            properties: {
              funding_source_id: { type: 'integer' },
              suma: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        payrollProfileId: { type: ['integer', 'null'] },
        createdByUserId: { type: 'integer' },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' },
      },
    };
  }

  static override get relationMappings(): RelationMappings {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Project } = require('./Project') as typeof import('./Project');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BudgetAllocationV2 } =
      require('./BudgetAllocationV2') as typeof import('./BudgetAllocationV2');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { User } = require('./User') as typeof import('./User');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PayrollProfile } =
      require('./PayrollProfile') as typeof import('./PayrollProfile');

    return {
      project: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Project,
        join: { from: 'expenses.project_id', to: 'projects.id' },
      },
      budgetAllocation: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: BudgetAllocationV2,
        join: {
          from: 'expenses.budget_allocation_id',
          to: 'budget_allocations_v2.id',
        },
      },
      createdByUser: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: User,
        join: { from: 'expenses.created_by_user_id', to: 'users.id' },
      },
      payrollProfile: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: PayrollProfile,
        join: {
          from: 'expenses.payroll_profile_id',
          to: 'payroll_profiles.id',
        },
      },
    };
  }

  /**
   * Konvertuoja DB jsonb row formatą į shared DTO camelCase formatą.
   * Jei `saltinioDalis === null` — grąžina null.
   */
  static rowsToDtoDistribution(
    rows: ExpenseSourceDistributionRow[] | null | undefined,
  ): ExpenseSourceDistributionItem[] | null {
    if (!rows) return null;
    return rows.map((r) => ({
      fundingSourceId: r.funding_source_id,
      suma: r.suma,
    }));
  }

  /**
   * Konvertuoja shared DTO camelCase array į DB jsonb snake_case formatą.
   * Jei perduota null/undefined — grąžina null.
   */
  static dtoToRowDistribution(
    items: ExpenseSourceDistributionItem[] | null | undefined,
  ): ExpenseSourceDistributionRow[] | null {
    if (!items) return null;
    return items.map((i) => ({
      funding_source_id: i.fundingSourceId,
      suma: i.suma,
    }));
  }
}
