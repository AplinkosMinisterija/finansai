/**
 * Project modelis — 3 FVM lygis (Iter 11, FVM-3).
 *
 * Atsako į klausimą „Kas konkrečiai išleidžia?" — projektai, spec.programos
 * arba skyriaus veiklos, kurios faktiškai naudoja biudžetą. Trys potipiai
 * ta pati lentelės struktūra (per `tipas` CHECK constraint'ą):
 *  - `projektas` — paprastas projektas (pvz. „IT modernizavimas")
 *  - `spec_programa` — specialiosios programos projektas (su request_id)
 *  - `veikla` — skyriaus veikla (pvz. „Mokymai 2026")
 *
 * Statuso mašina:
 *   `planuojama` → `vykdoma` → `baigta` → `uzdaryta`
 *
 * Reverse tranzicijas leidžiamos tik AM administratoriui (per service'ą).
 *
 * Detali architektūra — `docs/fvm/01-architecture.md` §projects.
 *
 * Saugumas:
 *  - tenant_id RESTRICT — tenant ištrynimas blokuojamas kol yra projektų
 *  - budget_allocation_id RESTRICT — biudžeto eilutės ištrynimas blokuojamas
 *  - request_id SET NULL — spec.programos prašymo ištrynimas išlaiko projektą
 *  - atsakingas_user_id SET NULL — atsakingo user ištrynimas išlaiko projektą
 */
import type { JSONSchema, RelationMappings } from 'objection';
import type { ProjectStatus, ProjectType } from '@biip-finansai/shared';
import { BaseModel } from './Base';

export class Project extends BaseModel {
  static override tableName = 'projects';

  id!: number;
  tenantId!: number;
  budgetAllocationId!: number;
  /** NULL kai tipas != 'spec_programa'. */
  requestId!: number | null;
  pavadinimas!: string;
  tipas!: ProjectType;
  /** Decimal(15,2) — preserved as string per Objection convention. */
  biudzetas!: string;
  pradziosData!: string | null;
  pabaigosData!: string | null;
  statusas!: ProjectStatus;
  atsakingasUserId!: number | null;
  aprasymas!: string | null;
  createdAt!: string;
  updatedAt!: string;

  // Eager-loaded
  tenant?: import('./Tenant').Tenant;
  budgetAllocation?: import('./BudgetAllocationV2').BudgetAllocationV2;
  request?: import('./Request').Request;
  atsakingasUser?: import('./User').User;

  static override get jsonSchema(): JSONSchema {
    return {
      type: 'object',
      required: [
        'tenantId',
        'budgetAllocationId',
        'pavadinimas',
        'tipas',
        'biudzetas',
        'statusas',
      ],
      properties: {
        id: { type: 'integer' },
        tenantId: { type: 'integer' },
        budgetAllocationId: { type: 'integer' },
        requestId: { type: ['integer', 'null'] },
        pavadinimas: { type: 'string', minLength: 1, maxLength: 300 },
        tipas: {
          type: 'string',
          enum: ['projektas', 'spec_programa', 'veikla'],
        },
        biudzetas: { type: 'string' },
        pradziosData: { type: ['string', 'null'] },
        pabaigosData: { type: ['string', 'null'] },
        statusas: {
          type: 'string',
          enum: ['planuojama', 'vykdoma', 'baigta', 'uzdaryta'],
        },
        atsakingasUserId: { type: ['integer', 'null'] },
        aprasymas: { type: ['string', 'null'] },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' },
      },
    };
  }

  static override get relationMappings(): RelationMappings {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Tenant } = require('./Tenant') as typeof import('./Tenant');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BudgetAllocationV2 } =
      require('./BudgetAllocationV2') as typeof import('./BudgetAllocationV2');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Request } = require('./Request') as typeof import('./Request');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { User } = require('./User') as typeof import('./User');

    return {
      tenant: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Tenant,
        join: { from: 'projects.tenant_id', to: 'tenants.id' },
      },
      budgetAllocation: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: BudgetAllocationV2,
        join: {
          from: 'projects.budget_allocation_id',
          to: 'budget_allocations_v2.id',
        },
      },
      request: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Request,
        join: { from: 'projects.request_id', to: 'requests.id' },
      },
      atsakingasUser: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: User,
        join: { from: 'projects.atsakingas_user_id', to: 'users.id' },
      },
    };
  }
}
