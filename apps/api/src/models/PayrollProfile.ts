/**
 * PayrollProfile modelis — darbuotojo finansinis profilis (Iter 13, FVM-5).
 *
 * Atsako į klausimą „Koks darbuotojo atlyginimas finansiniam planavimui?".
 * Lentelė `payroll_profiles` sukurta `20260526100000_create_payroll.ts`
 * migracija.
 *
 * SAUGUMO REIKALAVIMAS (docx §4.4): DU duomenis mato TIK:
 *  - AM administratorius (visi tenant'ai)
 *  - Org admin (tik savo tenant'as)
 *  - Specialistas (org_user) — NEMATO net savo
 * Permission gates implementuoti per `payroll.service.ts` `requireDuAccess`
 * helper'į. Modelio lygyje filtravimo NĖRA — servisas atsakingas už scope.
 *
 * Per ADR-003: tik bruto + priedai, BE Sodra/GPM apskaitos.
 *
 * `vardas_pavarde` — redundant copy:
 *  - Jei `user_id` NULL — leidžia darbuotoją be sistemos paskyros (pvz.
 *    paslaugų sutartis su trečiąja šalimi).
 *  - Jei `user_id` ne NULL — servisas atsakingas už sync su `users.full_name`,
 *    bet istorinis snapshot išlieka stabilus (pakeitimai user'yje
 *    neauto-propaguoja).
 *
 * Periodų logika (`galioja_nuo`, `galioja_iki`):
 *  - Profilis gali keistis kas mėnesį — saugom istorinę versiją.
 *  - `galioja_iki = NULL` — profilis vis dar galioja.
 *
 * Detali architektūra — `docs/fvm/01-architecture.md` §payroll_profiles.
 */
import type { JSONSchema, RelationMappings } from 'objection';

import { BaseModel } from './Base';

export type ContractType = 'darbo' | 'paslaugu' | 'autorine';

export class PayrollProfile extends BaseModel {
  static override tableName = 'payroll_profiles';

  id!: number;
  tenantId!: number;
  userId!: number | null;
  vardasPavarde!: string;
  pareigos!: string;
  sutartiesTipas!: ContractType;
  /** Decimal(10,2) — preserved as string per Objection convention. */
  atlyginimasBruto!: string;
  /** Decimal(10,2) — preserved as string per Objection convention. */
  priedai!: string;
  galiojaNuo!: string;
  galiojaIki!: string | null;
  createdAt!: string;
  updatedAt!: string;

  // Eager-loaded
  tenant?: import('./Tenant').Tenant;
  user?: import('./User').User;
  distributions?: import('./PayrollDistribution').PayrollDistribution[];

  static override get jsonSchema(): JSONSchema {
    return {
      type: 'object',
      required: [
        'tenantId',
        'vardasPavarde',
        'pareigos',
        'sutartiesTipas',
        'atlyginimasBruto',
        'galiojaNuo',
      ],
      properties: {
        id: { type: 'integer' },
        tenantId: { type: 'integer' },
        userId: { type: ['integer', 'null'] },
        vardasPavarde: { type: 'string', minLength: 1, maxLength: 200 },
        pareigos: { type: 'string', minLength: 1, maxLength: 200 },
        sutartiesTipas: {
          type: 'string',
          enum: ['darbo', 'paslaugu', 'autorine'],
        },
        atlyginimasBruto: { type: 'string' },
        priedai: { type: 'string' },
        galiojaNuo: { type: 'string' },
        galiojaIki: { type: ['string', 'null'] },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' },
      },
    };
  }

  static override get relationMappings(): RelationMappings {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Tenant } = require('./Tenant') as typeof import('./Tenant');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { User } = require('./User') as typeof import('./User');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PayrollDistribution } =
      require('./PayrollDistribution') as typeof import('./PayrollDistribution');

    return {
      tenant: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Tenant,
        join: { from: 'payroll_profiles.tenant_id', to: 'tenants.id' },
      },
      user: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: User,
        join: { from: 'payroll_profiles.user_id', to: 'users.id' },
      },
      distributions: {
        relation: BaseModel.HasManyRelation,
        modelClass: PayrollDistribution,
        join: {
          from: 'payroll_profiles.id',
          to: 'payroll_distributions.payroll_profile_id',
        },
      },
    };
  }
}
