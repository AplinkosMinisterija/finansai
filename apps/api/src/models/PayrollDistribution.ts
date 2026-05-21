/**
 * PayrollDistribution modelis — DU paskirstymas tarp finansavimo šaltinių
 * (Iter 13, FVM-5).
 *
 * Atsako į klausimą „Kiek procentų / kokia fiksuota suma iš kiekvieno
 * finansavimo šaltinio?" — kiekvienas distribution'as eilutė per profile.
 * Lentelė `payroll_distributions` sukurta `20260526100000_create_payroll.ts`
 * migracija.
 *
 * `paskirstymo_tipas`:
 *  - `procentais` — `reiksme` yra procentai (0-100). Suma per profile per
 *    overlapping period ≤ 100 (servisas tikrina).
 *  - `fiksuota` — `reiksme` yra fiksuota suma eurais.
 *
 * `reiksme` decimal(10, 4) — leidžia tikslius procentus (pvz. 33.3333%) arba
 * fiksuotas sumas eurais. SUM(procentais.reiksme) per profile per overlap'inantį
 * periodą ≤ 100 — tikrinama servise (per-row CHECK nepakanka agregacijai).
 *
 * Periodų logika (`galioja_nuo`, `galioja_iki`):
 *  - Paskirstymas gali keistis per laiką — saugom istorinę versiją.
 *  - `galioja_iki = NULL` — paskirstymas vis dar galioja.
 *
 * FK politika:
 *  - `payroll_profile_id` CASCADE — ištrynus profile, distributions automatiškai
 *    ištrinami (distribution be profile prasmės neturi).
 *  - `funding_source_id` RESTRICT — finansavimo šaltinio ištrynimas blokuojamas,
 *    kol yra rišamų distributions (ataskaitų istorija privalo išlikti pilna).
 *
 * Detali architektūra — `docs/fvm/01-architecture.md` §payroll_distributions.
 */
import type { JSONSchema, RelationMappings } from 'objection';

import { BaseModel } from './Base';

export type DistributionType = 'procentais' | 'fiksuota';

export class PayrollDistribution extends BaseModel {
  static override tableName = 'payroll_distributions';

  id!: number;
  payrollProfileId!: number;
  fundingSourceId!: number;
  paskirstymoTipas!: DistributionType;
  /** Decimal(10,4) — procentai (0-100) arba fiksuota suma eurais. */
  reiksme!: string;
  galiojaNuo!: string;
  galiojaIki!: string | null;
  createdAt!: string;
  updatedAt!: string;

  // Eager-loaded
  payrollProfile?: import('./PayrollProfile').PayrollProfile;
  fundingSource?: import('./FundingSource').FundingSource;

  static override get jsonSchema(): JSONSchema {
    return {
      type: 'object',
      required: [
        'payrollProfileId',
        'fundingSourceId',
        'paskirstymoTipas',
        'reiksme',
        'galiojaNuo',
      ],
      properties: {
        id: { type: 'integer' },
        payrollProfileId: { type: 'integer' },
        fundingSourceId: { type: 'integer' },
        paskirstymoTipas: {
          type: 'string',
          enum: ['procentais', 'fiksuota'],
        },
        reiksme: { type: 'string' },
        galiojaNuo: { type: 'string' },
        galiojaIki: { type: ['string', 'null'] },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' },
      },
    };
  }

  static override get relationMappings(): RelationMappings {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PayrollProfile } =
      require('./PayrollProfile') as typeof import('./PayrollProfile');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { FundingSource } =
      require('./FundingSource') as typeof import('./FundingSource');

    return {
      payrollProfile: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: PayrollProfile,
        join: {
          from: 'payroll_distributions.payroll_profile_id',
          to: 'payroll_profiles.id',
        },
      },
      fundingSource: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: FundingSource,
        join: {
          from: 'payroll_distributions.funding_source_id',
          to: 'funding_sources.id',
        },
      },
    };
  }
}
