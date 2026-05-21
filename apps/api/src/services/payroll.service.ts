/**
 * Payroll servisas (Iter 13, FVM-5) — DU (atlyginimų) duomenys.
 *
 * SAUGUMO PRIORITETINIS servisas — DU duomenys griežtai apsaugoti per docx §4.4:
 *  - AM administratorius mato visus tenant'us
 *  - Org admin mato TIK savo tenant'ą
 *  - Specialistas (`role='user'`) — NEMATO net savo (per docx §4.4 explicit
 *    reikalavimas „Specialistas savo duomenų nematosi")
 *
 * KIEKVIENAS endpoint'as PIRMAS kviečia `requireDuAccess(meta, tenantId?)` arba
 * `requireAmDuAccess(meta)` — PRIEŠ bet kokias kitas operacijas (DB query,
 * validation, etc.). Jokia operacija šiame servise nevykdoma be permission
 * gate'o.
 *
 * Apima docx funkcionalumus:
 *  - F09: Darbuotojo finansinio profilio ir DU paskirstymo valdymas
 *  - F10: Automatinis mėnesio DU kaštų paskaičiavimas pagal šaltinį
 *
 * Per ADR-003 — tik bruto + priedai, BE Sodra/GPM mokesčių apskaitos.
 *
 * REST aliases (`api.service.ts`):
 *  - GET    /payroll-profiles                     → payroll.listProfiles
 *  - GET    /payroll-profiles/:id                 → payroll.getProfile
 *  - POST   /payroll-profiles                     → payroll.createProfile
 *  - PATCH  /payroll-profiles/:id                 → payroll.updateProfile
 *  - DELETE /payroll-profiles/:id                 → payroll.deleteProfile
 *  - GET    /payroll-distributions                → payroll.listDistributions
 *  - POST   /payroll-distributions                → payroll.createDistribution
 *  - PATCH  /payroll-distributions/:id            → payroll.updateDistribution
 *  - DELETE /payroll-distributions/:id            → payroll.deleteDistribution
 *  - POST   /payroll/compute?month=YYYY-MM        → payroll.computeMonth
 */
import type { ServiceSchema, Context } from 'moleculer';
import { Errors } from 'moleculer';
import type { Knex } from 'knex';
import type {
  ContractType,
  DistributionType,
  PayrollProfile as PayrollProfileDTO,
  PayrollProfileCreateDTO,
  PayrollProfileUpdateDTO,
  PayrollProfileListQuery,
  PayrollDistribution as PayrollDistributionDTO,
  PayrollDistributionCreateDTO,
  PayrollDistributionUpdateDTO,
  PayrollDistributionListQuery,
  ComputeMonthResponse,
} from '@biip-finansai/shared';

import { BudgetAllocationV2 } from '../models/BudgetAllocationV2';
import { ClassifierItem } from '../models/ClassifierItem';
import { Expense } from '../models/Expense';
import { FundingSource } from '../models/FundingSource';
import { PayrollDistribution } from '../models/PayrollDistribution';
import { PayrollProfile } from '../models/PayrollProfile';
import { Project } from '../models/Project';
import { Tenant } from '../models/Tenant';
import { User } from '../models/User';
import {
  centsToAmount,
  normalizeAmount,
  toCents,
} from '../utils/money';
import { requireAmDuAccess, requireDuAccess } from '../utils/permissions';
import type { AuthMeta } from './auth.service';

const CONTRACT_TYPES: readonly ContractType[] = [
  'darbo',
  'paslaugu',
  'autorine',
];

const DISTRIBUTION_TYPES: readonly DistributionType[] = [
  'procentais',
  'fiksuota',
];

/** Klasifikatoriaus item code DU biudžeto eilutei (`budget_category` grupėje). */
const DU_CATEGORY_CODE = 'du';

/** Klasifikatoriaus item code DU expense system project'o tipui. */
const DU_SYSTEM_PROJECT_TIPAS = 'veikla';

/** Pavadinimo prefiksas DU system project'ui (paieška per tenant). */
const DU_SYSTEM_PROJECT_NAME_PREFIX = 'DU expense system';

/**
 * `expenses.aprasymas` formatas computeMonth metu — naudojamas idempotency'iui
 * (mėnesio recompute ištrina senus įrašus per prefix LIKE).
 *
 * Format: `DU YYYY-MM: <profile.vardas_pavarde>`
 *
 * MaxLen: 'DU YYYY-MM: ' (12) + 200 (vardas_pavarde) = 212 < 500 (expense max).
 */
function buildExpenseAprasymas(month: string, vardasPavarde: string): string {
  return `DU ${month}: ${vardasPavarde}`;
}

/** Mėnesio recompute idempotency'iui — prefix per kurį LIKE'inami senieji. */
function buildExpenseAprasymasMonthPrefix(month: string): string {
  return `DU ${month}: %`;
}

type PayrollProfileWithRels = PayrollProfile & {
  tenant?: Tenant;
  user?: User;
};

type PayrollDistributionWithRels = PayrollDistribution & {
  fundingSource?: FundingSource;
  payrollProfile?: PayrollProfile;
};

function profileToDTO(p: PayrollProfileWithRels): PayrollProfileDTO {
  return {
    id: p.id,
    tenantId: p.tenantId,
    tenantCode: p.tenant?.code,
    tenantName: p.tenant?.name,
    userId: p.userId,
    userFullName: p.user?.fullName ?? null,
    vardasPavarde: p.vardasPavarde,
    pareigos: p.pareigos,
    sutartiesTipas: p.sutartiesTipas,
    atlyginimasBruto: p.atlyginimasBruto,
    priedai: p.priedai,
    galiojaNuo: p.galiojaNuo,
    galiojaIki: p.galiojaIki,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function distributionToDTO(
  d: PayrollDistributionWithRels,
): PayrollDistributionDTO {
  return {
    id: d.id,
    payrollProfileId: d.payrollProfileId,
    fundingSourceId: d.fundingSourceId,
    fundingSourceName: d.fundingSource?.pavadinimas,
    fundingSourceCode: d.fundingSource?.kodas,
    paskirstymoTipas: d.paskirstymoTipas,
    reiksme: d.reiksme,
    galiojaNuo: d.galiojaNuo,
    galiojaIki: d.galiojaIki,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

/** Validate'ina laikotarpio logiką: jei abi nurodytos — pradzia <= pabaiga. */
function validateDates(
  galiojaNuo: string,
  galiojaIki: string | null | undefined,
): void {
  if (galiojaIki === null || galiojaIki === undefined) return;
  if (galiojaNuo > galiojaIki) {
    throw new Errors.MoleculerClientError(
      'Galiojimo pradžios data negali būti vėlesnė už pabaigos datą',
      400,
      'INVALID_DATE_RANGE',
    );
  }
}

/**
 * Du laikotarpiai overlap'inasi jei: aStart <= bEnd AND bStart <= aEnd.
 * NULL galiojaIki traktuojamas kaip „neribota ateitis".
 */
function periodsOverlap(
  aStart: string,
  aEnd: string | null,
  bStart: string,
  bEnd: string | null,
): boolean {
  const aEndEff = aEnd ?? '9999-12-31';
  const bEndEff = bEnd ?? '9999-12-31';
  return aStart <= bEndEff && bStart <= aEndEff;
}

/**
 * Tikrina, kad SUM(procentais.reiksme) per profile per periodą su nauju
 * distribution'u <= 100. Jei viršys — throw'ina 400 LT klaidą.
 *
 * @param trx - Aktyvi transakcija (jei reikia).
 * @param payrollProfileId - Profile, kurio distributions tikrinami.
 * @param newType - Naujo distribution'o tipas.
 * @param newReiksme - Naujo distribution'o reikšmė (procentais arba fiksuota).
 * @param newGaliojaNuo - Naujo distribution'o galioja_nuo.
 * @param newGaliojaIki - Naujo distribution'o galioja_iki.
 * @param excludeId - Update atveju — egzistuojančio distribution'o ID, kurį
 *   reikia ignoruoti per agregaciją (kad neskaičiuotumėm dvigubai).
 */
async function validateDistributionPercentSum(
  trx: Knex.Transaction | undefined,
  payrollProfileId: number,
  newType: DistributionType,
  newReiksme: string,
  newGaliojaNuo: string,
  newGaliojaIki: string | null,
  excludeId?: number,
): Promise<void> {
  // Tik procentais — fiksuota nekuria SUM constraint'o (skirtinga semantika).
  if (newType !== 'procentais') return;

  const newReiksmeNum = Number(newReiksme);
  if (!Number.isFinite(newReiksmeNum) || newReiksmeNum < 0) {
    throw new Errors.MoleculerClientError(
      'Procentų reikšmė turi būti teigiamas skaičius',
      400,
      'INVALID_DISTRIBUTION_VALUE',
    );
  }
  if (newReiksmeNum > 100) {
    throw new Errors.MoleculerClientError(
      'Vienos paskirstymo eilutės procentai negali viršyti 100',
      400,
      'INVALID_DISTRIBUTION_VALUE',
    );
  }

  // Visi šios profile'os esami procentais distributions
  const baseQ = (trx
    ? PayrollDistribution.query(trx)
    : PayrollDistribution.query()
  )
    .where('payroll_profile_id', payrollProfileId)
    .where('paskirstymo_tipas', 'procentais');
  const query = excludeId !== undefined ? baseQ.whereNot('id', excludeId) : baseQ;
  const existing = (await query) as PayrollDistribution[];

  // Per kiekvieną overlap'inantį periodą sumuojam (sumas konvertuojam į
  // four-decimal integer'į, kad išvengtume float drift'o; reiksme decimal(10,4)
  // -> *10000).
  const newScaled = Math.round(newReiksmeNum * 10000);
  let maxOverlapSumScaled = newScaled;
  for (const d of existing) {
    if (
      !periodsOverlap(newGaliojaNuo, newGaliojaIki, d.galiojaNuo, d.galiojaIki)
    ) {
      continue;
    }
    const dScaled = Math.round(Number(d.reiksme) * 10000);
    maxOverlapSumScaled += dScaled;
  }
  // 100% = 100 * 10000 = 1_000_000 scaled units
  if (maxOverlapSumScaled > 1_000_000) {
    throw new Errors.MoleculerClientError(
      'Paskirstymo procentų suma per laikotarpį negali viršyti 100',
      400,
      'DISTRIBUTION_SUM_EXCEEDS_100',
    );
  }
}

/**
 * Patikrina, kad finansavimo šaltinis egzistuoja ir priklauso `tenantId`
 * tenant'ui.
 */
async function validateFundingSourceTenant(
  fundingSourceId: number,
  tenantId: number,
): Promise<FundingSource> {
  const fs = await FundingSource.query().findById(fundingSourceId);
  if (!fs) {
    throw new Errors.MoleculerClientError(
      'Finansavimo šaltinis nerastas',
      400,
      'INVALID_FUNDING_SOURCE',
    );
  }
  if (fs.tenantId !== tenantId) {
    throw new Errors.MoleculerClientError(
      'Finansavimo šaltinis priklauso kitai organizacijai',
      400,
      'FUNDING_SOURCE_TENANT_MISMATCH',
    );
  }
  return fs;
}

/**
 * Auto-create helper: ieško DU expense system project'o tame tenant'e
 * (per pavadinimo prefix paiešką). Jei nėra — sukuria su tipas='veikla'.
 *
 * Sąmoningas pasirinkimas: DU expense'ai turi konkretų projektą per tenant
 * (kad projekto/biudžeto summary integracija veiktų). Kadangi DU yra atskira
 * mechanika ne susieta su konkrečiu projektu — naudojam vieną „sistemos"
 * projektą per tenant'ą + per DU biudžeto eilutę.
 *
 * @returns Project'o ID.
 */
async function ensureDuSystemProject(
  trx: Knex.Transaction,
  tenantId: number,
  duAllocationId: number,
): Promise<number> {
  // Po Iter 13.x saugumo patch'o paieška vyksta pirmiausia per `is_du_system`
  // flag'ą (robustinis identifikatorius); pavadinimo `like` prefix lieka
  // kaip backup'as, jei kažkas turi senų įrašų be flag'o (migracijos
  // backfill'as turėtų užtikrinti, kad jų nebūtų — bet defensive code).
  const existing = (await trx('projects')
    .where('tenant_id', tenantId)
    .where('is_du_system', true)
    .first('id')) as { id: number } | undefined;
  if (existing) return existing.id;

  const inserted = (await trx('projects')
    .insert({
      tenant_id: tenantId,
      budget_allocation_id: duAllocationId,
      request_id: null,
      pavadinimas: `${DU_SYSTEM_PROJECT_NAME_PREFIX} (auto)`,
      tipas: DU_SYSTEM_PROJECT_TIPAS,
      biudzetas: '0.00',
      pradzios_data: null,
      pabaigos_data: null,
      statusas: 'vykdoma',
      atsakingas_user_id: null,
      aprasymas:
        'Auto-sukurtas sistemos projektas DU mėnesinių apskaičiavimų išlaidoms talpinti. ' +
        'Žr. payroll.computeMonth.',
      // Iter 13.x saugumo patch'as: pažymim, kad šis projektas yra DU sistemos
      // projektas — filter'inamas atskirai per `canViewPayroll` gate'us
      // expenses + projects servisuose.
      is_du_system: true,
    })
    .returning('id')) as Array<{ id: number }>;
  const id = inserted[0]?.id;
  if (id === undefined) {
    throw new Errors.MoleculerClientError(
      'Nepavyko sukurti DU sistemos projekto',
      500,
      'DU_SYSTEM_PROJECT_CREATE_FAILED',
    );
  }
  return id;
}

/**
 * Auto-discover helper: ieško DU biudžeto eilutės (`budget_category=du`)
 * tame tenant'e konkrečiais metais. Jei nėra — throw'ina 400 LT, NE
 * auto-create (biudžeto eilutės AM admin valdo eksplicit'iškai).
 *
 * @returns BudgetAllocationV2 ID.
 */
async function ensureDuAllocation(
  trx: Knex.Transaction,
  tenantId: number,
  year: number,
): Promise<number> {
  // budget_category -> classifier_items (code='du') -> categoryClassifierItemId
  const duCategoryItem = (await trx('classifier_items as ci')
    .join('classifier_groups as cg', 'cg.id', 'ci.group_id')
    .where('cg.code', 'budget_category')
    .where('ci.code', DU_CATEGORY_CODE)
    .first<{ id: number }>('ci.id as id')) as { id: number } | undefined;
  if (!duCategoryItem) {
    throw new Errors.MoleculerClientError(
      'DU biudžeto kategorija klasifikatoriuje nerasta',
      500,
      'DU_CATEGORY_NOT_FOUND',
    );
  }

  // budget_allocations_v2 -> funding_sources (tenant scope chain)
  const alloc = (await trx('budget_allocations_v2 as ba')
    .join('funding_sources as fs', 'fs.id', 'ba.funding_source_id')
    .where('fs.tenant_id', tenantId)
    .where('ba.metai', year)
    .where('ba.category_classifier_item_id', duCategoryItem.id)
    .first<{ id: number }>('ba.id as id')) as { id: number } | undefined;
  if (!alloc) {
    throw new Errors.MoleculerClientError(
      `DU biudžeto eilutė nesukurta (kategorija=du), ${year} metams`,
      400,
      'DU_ALLOCATION_NOT_FOUND',
    );
  }
  return alloc.id;
}

/** Konvertuoja YYYY-MM string'ą į pirmos ir paskutinės mėnesio dienos. */
function monthBounds(month: string): { start: string; end: string } {
  // Validation per regex — kviečiantysis garantuoja format'ą.
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const m = Number(monthStr);
  // Paskutinė mėnesio diena — naudojam Date object'ą trumpam.
  const lastDate = new Date(Date.UTC(year, m, 0)); // m+1 mėnesio 0-oji diena = paskutinė šio mėnesio diena
  const dd = String(lastDate.getUTCDate()).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${dd}`,
  };
}

const PayrollService: ServiceSchema = {
  name: 'payroll',

  actions: {
    listProfiles: {
      params: {
        tenantId: { type: 'number', integer: true, optional: true, convert: true },
        userId: { type: 'number', integer: true, optional: true, convert: true },
        active: { type: 'boolean', optional: true, convert: true },
      },
      async handler(
        ctx: Context<PayrollProfileListQuery, AuthMeta>,
      ): Promise<PayrollProfileDTO[]> {
        // SAUGUMO GATE PIRMAS — prieš bet kokias operacijas.
        // Jei filter'is `tenantId` nurodytas — org_admin gali tik savo tenant'ą.
        // Jei NEnurodytas — org_admin gauna VISADA tik savo tenant'ą per
        // automatinį scoping žemiau (AM admin gauna visus).
        requireDuAccess(ctx.meta, ctx.params.tenantId);
        const me = ctx.meta.user!; // garantuotas po requireDuAccess

        const q = PayrollProfile.query()
          .withGraphFetched('[tenant, user]')
          .orderBy([
            { column: 'payroll_profiles.tenant_id', order: 'asc' },
            { column: 'payroll_profiles.vardas_pavarde', order: 'asc' },
            { column: 'payroll_profiles.id', order: 'desc' },
          ]);

        // Tenant scope:
        //  - AM admin: visi (arba filter pagal ctx.params.tenantId)
        //  - Org admin: tik savo tenant'as
        const isAmAdmin = me.role === 'admin' && me.tenantIsApprover;
        if (isAmAdmin) {
          if (ctx.params.tenantId !== undefined) {
            q.where('payroll_profiles.tenant_id', ctx.params.tenantId);
          }
        } else {
          // Org admin (po requireDuAccess'o jau garantuotas)
          q.where('payroll_profiles.tenant_id', me.tenantId);
        }

        if (ctx.params.userId !== undefined) {
          q.where('payroll_profiles.user_id', ctx.params.userId);
        }
        if (ctx.params.active === true) {
          const today = new Date().toISOString().slice(0, 10);
          q.where('payroll_profiles.galioja_nuo', '<=', today).where((qb) => {
            qb.whereNull('payroll_profiles.galioja_iki').orWhere(
              'payroll_profiles.galioja_iki',
              '>=',
              today,
            );
          });
        }

        const rows = (await q) as PayrollProfileWithRels[];
        return rows.map(profileToDTO);
      },
    },

    getProfile: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(
        ctx: Context<{ id: number }, AuthMeta>,
      ): Promise<PayrollProfileDTO> {
        // SAUGUMO GATE: pirma pirmasis pass — be tenantId (auth check),
        // tada specifinis tenant patikrinimas pagal profile'ą.
        requireDuAccess(ctx.meta);

        const p = await PayrollProfile.query()
          .findById(ctx.params.id)
          .withGraphFetched('[tenant, user]');
        if (!p) {
          throw new Errors.MoleculerClientError(
            'DU profilis nerastas',
            404,
            'PAYROLL_PROFILE_NOT_FOUND',
          );
        }
        // Antras gate'as — tenant scoping su konkrečiu profile.tenantId.
        requireDuAccess(ctx.meta, p.tenantId);
        return profileToDTO(p as PayrollProfileWithRels);
      },
    },

    createProfile: {
      params: {
        tenantId: { type: 'number', integer: true, convert: true },
        userId: {
          type: 'number',
          integer: true,
          optional: true,
          nullable: true,
          convert: true,
        },
        vardasPavarde: { type: 'string', min: 1, max: 200 },
        pareigos: { type: 'string', min: 1, max: 200 },
        sutartiesTipas: { type: 'enum', values: CONTRACT_TYPES },
        atlyginimasBruto: { type: 'string', min: 1 },
        priedai: { type: 'string', optional: true },
        galiojaNuo: { type: 'string', min: 1 },
        galiojaIki: { type: 'string', optional: true, nullable: true },
      },
      async handler(
        ctx: Context<PayrollProfileCreateDTO, AuthMeta>,
      ): Promise<PayrollProfileDTO> {
        // SAUGUMO GATE PIRMAS — su tenantId checki org_admin'ui.
        requireDuAccess(ctx.meta, ctx.params.tenantId);

        const p = ctx.params;

        // Tenant'as egzistuoja + aktyvus
        const tenant = await Tenant.query().findById(p.tenantId);
        if (!tenant || !tenant.active) {
          throw new Errors.MoleculerClientError(
            'Organizacija nerasta arba neaktyvi',
            400,
            'INVALID_TENANT',
          );
        }

        // user_id (jei nurodytas) — tenant match
        if (p.userId !== undefined && p.userId !== null) {
          const u = await User.query().findById(p.userId);
          if (!u) {
            throw new Errors.MoleculerClientError(
              'Vartotojas nerastas',
              400,
              'INVALID_USER',
            );
          }
          if (u.tenantId !== p.tenantId) {
            throw new Errors.MoleculerClientError(
              'Vartotojas priklauso kitai organizacijai',
              400,
              'USER_TENANT_MISMATCH',
            );
          }
        }

        // Sumos validation: bruto > 0, priedai >= 0
        const brutoNormalized = normalizeAmount(p.atlyginimasBruto);
        if (toCents(brutoNormalized) <= 0) {
          throw new Errors.MoleculerClientError(
            'Bruto atlyginimas turi būti didesnis už 0',
            400,
            'INVALID_AMOUNT',
          );
        }
        const priedaiNormalized = normalizeAmount(p.priedai ?? '0');

        // Datų validation
        validateDates(p.galiojaNuo, p.galiojaIki);

        const knex = PayrollProfile.knex();
        const created = await knex.transaction(async (trx) => {
          return await PayrollProfile.query(trx).insert({
            tenantId: p.tenantId,
            userId: p.userId ?? null,
            vardasPavarde: p.vardasPavarde,
            pareigos: p.pareigos,
            sutartiesTipas: p.sutartiesTipas,
            atlyginimasBruto: brutoNormalized,
            priedai: priedaiNormalized,
            galiojaNuo: p.galiojaNuo,
            galiojaIki: p.galiojaIki ?? null,
          });
        });

        const out = await PayrollProfile.query()
          .findById(created.id)
          .withGraphFetched('[tenant, user]');
        return profileToDTO(out as PayrollProfileWithRels);
      },
    },

    updateProfile: {
      params: {
        id: { type: 'number', integer: true, convert: true },
        userId: {
          type: 'number',
          integer: true,
          optional: true,
          nullable: true,
          convert: true,
        },
        vardasPavarde: { type: 'string', optional: true, min: 1, max: 200 },
        pareigos: { type: 'string', optional: true, min: 1, max: 200 },
        sutartiesTipas: {
          type: 'enum',
          values: CONTRACT_TYPES,
          optional: true,
        },
        atlyginimasBruto: { type: 'string', optional: true, min: 1 },
        priedai: { type: 'string', optional: true },
        galiojaNuo: { type: 'string', optional: true, min: 1 },
        galiojaIki: { type: 'string', optional: true, nullable: true },
      },
      async handler(
        ctx: Context<PayrollProfileUpdateDTO & { id: number }, AuthMeta>,
      ): Promise<PayrollProfileDTO> {
        // SAUGUMO GATE PIRMAS — auth check.
        requireDuAccess(ctx.meta);

        const target = await PayrollProfile.query().findById(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError(
            'DU profilis nerastas',
            404,
            'PAYROLL_PROFILE_NOT_FOUND',
          );
        }
        // Antras gate'as — tenant scoping su konkrečiu target.tenantId.
        requireDuAccess(ctx.meta, target.tenantId);

        const p = ctx.params;
        const patch: Record<string, unknown> = {};

        if (p.userId !== undefined) {
          if (p.userId === null) {
            patch['userId'] = null;
          } else {
            const u = await User.query().findById(p.userId);
            if (!u) {
              throw new Errors.MoleculerClientError(
                'Vartotojas nerastas',
                400,
                'INVALID_USER',
              );
            }
            if (u.tenantId !== target.tenantId) {
              throw new Errors.MoleculerClientError(
                'Vartotojas priklauso kitai organizacijai',
                400,
                'USER_TENANT_MISMATCH',
              );
            }
            patch['userId'] = p.userId;
          }
        }
        if (p.vardasPavarde !== undefined)
          patch['vardasPavarde'] = p.vardasPavarde;
        if (p.pareigos !== undefined) patch['pareigos'] = p.pareigos;
        if (p.sutartiesTipas !== undefined)
          patch['sutartiesTipas'] = p.sutartiesTipas;
        if (p.atlyginimasBruto !== undefined) {
          const norm = normalizeAmount(p.atlyginimasBruto);
          if (toCents(norm) <= 0) {
            throw new Errors.MoleculerClientError(
              'Bruto atlyginimas turi būti didesnis už 0',
              400,
              'INVALID_AMOUNT',
            );
          }
          patch['atlyginimasBruto'] = norm;
        }
        if (p.priedai !== undefined) {
          patch['priedai'] = normalizeAmount(p.priedai);
        }

        // Datas validate'inam su likusiom (iš target'o, jei nepakeičiamos).
        const effectiveNuo =
          p.galiojaNuo === undefined ? target.galiojaNuo : p.galiojaNuo;
        const effectiveIki =
          p.galiojaIki === undefined ? target.galiojaIki : p.galiojaIki;
        validateDates(effectiveNuo, effectiveIki);
        if (p.galiojaNuo !== undefined) patch['galiojaNuo'] = p.galiojaNuo;
        if (p.galiojaIki !== undefined) patch['galiojaIki'] = p.galiojaIki;

        await PayrollProfile.query().findById(target.id).patch(patch);
        const out = await PayrollProfile.query()
          .findById(target.id)
          .withGraphFetched('[tenant, user]');
        return profileToDTO(out as PayrollProfileWithRels);
      },
    },

    deleteProfile: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(
        ctx: Context<{ id: number }, AuthMeta>,
      ): Promise<{ ok: true }> {
        requireDuAccess(ctx.meta);

        const target = await PayrollProfile.query().findById(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError(
            'DU profilis nerastas',
            404,
            'PAYROLL_PROFILE_NOT_FOUND',
          );
        }
        requireDuAccess(ctx.meta, target.tenantId);

        // RESTRICT jei egzistuoja distributions (CASCADE leistume DB lygyje,
        // bet semantiškai geriau atskirti ištrynimą — vartotojas mato klaidą
        // ir gali sąmoningai ištrinti distributions pirma).
        const distCount = (await PayrollDistribution.query()
          .where('payroll_profile_id', target.id)
          .resultSize()) as number;
        if (distCount > 0) {
          throw new Errors.MoleculerClientError(
            'Negalima ištrinti DU profilio, kol egzistuoja jo paskirstymo eilutės. ' +
              'Ištrinkite paskirstymus pirma.',
            409,
            'PAYROLL_PROFILE_HAS_DISTRIBUTIONS',
          );
        }

        await PayrollProfile.query().deleteById(target.id);
        return { ok: true };
      },
    },

    listDistributions: {
      params: {
        profileId: { type: 'number', integer: true, optional: true, convert: true },
        sourceId: { type: 'number', integer: true, optional: true, convert: true },
      },
      async handler(
        ctx: Context<PayrollDistributionListQuery, AuthMeta>,
      ): Promise<PayrollDistributionDTO[]> {
        // SAUGUMO GATE PIRMAS — auth check.
        requireDuAccess(ctx.meta);
        const me = ctx.meta.user!;

        // Jei profileId nurodytas — patikrinam, kad org_admin pasiekia tik
        // savo tenant'o profile'us.
        if (ctx.params.profileId !== undefined) {
          const profile = await PayrollProfile.query().findById(
            ctx.params.profileId,
          );
          if (!profile) {
            throw new Errors.MoleculerClientError(
              'DU profilis nerastas',
              404,
              'PAYROLL_PROFILE_NOT_FOUND',
            );
          }
          requireDuAccess(ctx.meta, profile.tenantId);
        }

        const q = PayrollDistribution.query()
          .withGraphFetched('[fundingSource, payrollProfile]')
          .orderBy([
            { column: 'payroll_distributions.payroll_profile_id', order: 'asc' },
            { column: 'payroll_distributions.galioja_nuo', order: 'asc' },
            { column: 'payroll_distributions.id', order: 'asc' },
          ]);

        // Tenant scope per profile.tenant_id chain (ne tiesioginis, bet
        // implicit per profileId arba scoped lookup).
        const isAmAdmin = me.role === 'admin' && me.tenantIsApprover;
        if (!isAmAdmin) {
          // Org admin — tik savo tenant'o distributions
          q.whereExists((qb) => {
            qb.from('payroll_profiles')
              .whereRaw(
                'payroll_profiles.id = payroll_distributions.payroll_profile_id',
              )
              .where('payroll_profiles.tenant_id', me.tenantId);
          });
        }

        if (ctx.params.profileId !== undefined) {
          q.where(
            'payroll_distributions.payroll_profile_id',
            ctx.params.profileId,
          );
        }
        if (ctx.params.sourceId !== undefined) {
          q.where(
            'payroll_distributions.funding_source_id',
            ctx.params.sourceId,
          );
        }

        const rows = (await q) as PayrollDistributionWithRels[];
        return rows.map(distributionToDTO);
      },
    },

    createDistribution: {
      params: {
        payrollProfileId: { type: 'number', integer: true, convert: true },
        fundingSourceId: { type: 'number', integer: true, convert: true },
        paskirstymoTipas: { type: 'enum', values: DISTRIBUTION_TYPES },
        reiksme: { type: 'string', min: 1 },
        galiojaNuo: { type: 'string', min: 1 },
        galiojaIki: { type: 'string', optional: true, nullable: true },
      },
      async handler(
        ctx: Context<PayrollDistributionCreateDTO, AuthMeta>,
      ): Promise<PayrollDistributionDTO> {
        // SAUGUMO GATE PIRMAS — auth check.
        requireDuAccess(ctx.meta);

        const p = ctx.params;

        // Profile egzistuoja + tenant scope check
        const profile = await PayrollProfile.query().findById(p.payrollProfileId);
        if (!profile) {
          throw new Errors.MoleculerClientError(
            'DU profilis nerastas',
            400,
            'INVALID_PAYROLL_PROFILE',
          );
        }
        requireDuAccess(ctx.meta, profile.tenantId);

        // Funding source egzistuoja + tenant match
        await validateFundingSourceTenant(p.fundingSourceId, profile.tenantId);

        // reiksme validation
        const reiksmeNum = Number(p.reiksme);
        if (!Number.isFinite(reiksmeNum) || reiksmeNum <= 0) {
          throw new Errors.MoleculerClientError(
            'Paskirstymo reikšmė turi būti didesnė už 0',
            400,
            'INVALID_DISTRIBUTION_VALUE',
          );
        }
        if (p.paskirstymoTipas === 'procentais' && reiksmeNum > 100) {
          throw new Errors.MoleculerClientError(
            'Procentų reikšmė negali viršyti 100',
            400,
            'INVALID_DISTRIBUTION_VALUE',
          );
        }

        // Datų validation
        validateDates(p.galiojaNuo, p.galiojaIki);

        // SUM(procentais) per overlap'inantį periodą ≤ 100
        await validateDistributionPercentSum(
          undefined,
          p.payrollProfileId,
          p.paskirstymoTipas,
          p.reiksme,
          p.galiojaNuo,
          p.galiojaIki ?? null,
        );

        const knex = PayrollDistribution.knex();
        const inserted = await knex.transaction(async (trx) => {
          return await PayrollDistribution.query(trx).insert({
            payrollProfileId: p.payrollProfileId,
            fundingSourceId: p.fundingSourceId,
            paskirstymoTipas: p.paskirstymoTipas,
            reiksme: p.reiksme,
            galiojaNuo: p.galiojaNuo,
            galiojaIki: p.galiojaIki ?? null,
          });
        });

        const out = await PayrollDistribution.query()
          .findById(inserted.id)
          .withGraphFetched('[fundingSource, payrollProfile]');
        return distributionToDTO(out as PayrollDistributionWithRels);
      },
    },

    updateDistribution: {
      params: {
        id: { type: 'number', integer: true, convert: true },
        fundingSourceId: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
        },
        paskirstymoTipas: {
          type: 'enum',
          values: DISTRIBUTION_TYPES,
          optional: true,
        },
        reiksme: { type: 'string', optional: true, min: 1 },
        galiojaNuo: { type: 'string', optional: true, min: 1 },
        galiojaIki: { type: 'string', optional: true, nullable: true },
      },
      async handler(
        ctx: Context<PayrollDistributionUpdateDTO & { id: number }, AuthMeta>,
      ): Promise<PayrollDistributionDTO> {
        // SAUGUMO GATE PIRMAS — auth check.
        requireDuAccess(ctx.meta);

        const target = await PayrollDistribution.query().findById(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError(
            'DU paskirstymas nerastas',
            404,
            'PAYROLL_DISTRIBUTION_NOT_FOUND',
          );
        }
        const profile = await PayrollProfile.query().findById(
          target.payrollProfileId,
        );
        if (!profile) {
          throw new Errors.MoleculerClientError(
            'DU profilis nerastas',
            500,
            'PAYROLL_PROFILE_INCONSISTENT',
          );
        }
        requireDuAccess(ctx.meta, profile.tenantId);

        const p = ctx.params;

        const effectiveFundingSourceId =
          p.fundingSourceId === undefined
            ? target.fundingSourceId
            : p.fundingSourceId;
        const effectiveTipas =
          p.paskirstymoTipas === undefined
            ? target.paskirstymoTipas
            : p.paskirstymoTipas;
        const effectiveReiksme =
          p.reiksme === undefined ? target.reiksme : p.reiksme;
        const effectiveNuo =
          p.galiojaNuo === undefined ? target.galiojaNuo : p.galiojaNuo;
        const effectiveIki =
          p.galiojaIki === undefined ? target.galiojaIki : p.galiojaIki;

        if (p.fundingSourceId !== undefined) {
          await validateFundingSourceTenant(
            effectiveFundingSourceId,
            profile.tenantId,
          );
        }

        // reiksme validation
        const reiksmeNum = Number(effectiveReiksme);
        if (!Number.isFinite(reiksmeNum) || reiksmeNum <= 0) {
          throw new Errors.MoleculerClientError(
            'Paskirstymo reikšmė turi būti didesnė už 0',
            400,
            'INVALID_DISTRIBUTION_VALUE',
          );
        }
        if (effectiveTipas === 'procentais' && reiksmeNum > 100) {
          throw new Errors.MoleculerClientError(
            'Procentų reikšmė negali viršyti 100',
            400,
            'INVALID_DISTRIBUTION_VALUE',
          );
        }

        validateDates(effectiveNuo, effectiveIki);

        // SUM(procentais) re-validation — su exclude target.id (kad neskaičiuotume
        // dvigubai).
        await validateDistributionPercentSum(
          undefined,
          target.payrollProfileId,
          effectiveTipas,
          effectiveReiksme,
          effectiveNuo,
          effectiveIki,
          target.id,
        );

        const patch: Record<string, unknown> = {};
        if (p.fundingSourceId !== undefined)
          patch['fundingSourceId'] = p.fundingSourceId;
        if (p.paskirstymoTipas !== undefined)
          patch['paskirstymoTipas'] = p.paskirstymoTipas;
        if (p.reiksme !== undefined) patch['reiksme'] = p.reiksme;
        if (p.galiojaNuo !== undefined) patch['galiojaNuo'] = p.galiojaNuo;
        if (p.galiojaIki !== undefined) patch['galiojaIki'] = p.galiojaIki;

        await PayrollDistribution.query().findById(target.id).patch(patch);
        const out = await PayrollDistribution.query()
          .findById(target.id)
          .withGraphFetched('[fundingSource, payrollProfile]');
        return distributionToDTO(out as PayrollDistributionWithRels);
      },
    },

    deleteDistribution: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(
        ctx: Context<{ id: number }, AuthMeta>,
      ): Promise<{ ok: true }> {
        requireDuAccess(ctx.meta);

        const target = await PayrollDistribution.query().findById(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError(
            'DU paskirstymas nerastas',
            404,
            'PAYROLL_DISTRIBUTION_NOT_FOUND',
          );
        }
        const profile = await PayrollProfile.query().findById(
          target.payrollProfileId,
        );
        if (!profile) {
          throw new Errors.MoleculerClientError(
            'DU profilis nerastas',
            500,
            'PAYROLL_PROFILE_INCONSISTENT',
          );
        }
        requireDuAccess(ctx.meta, profile.tenantId);

        await PayrollDistribution.query().deleteById(target.id);
        return { ok: true };
      },
    },

    /**
     * Apskaičiuoja DU expense'us nurodytam mėnesiui.
     *
     * SAUGUMO REIKALAVIMAS: TIK AM administratorius (`requireAmDuAccess`).
     * Org admin'as net savo tenant'e negali — operacija paliečia visus
     * tenant'us, tad reikia visiškai privilegijuotos paskyros.
     *
     * Logic:
     *  1. Per kiekvieną tenant'ą paliečia visus aktyvius profile'us tame
     *     mėnesyje. (Filter'ais: galioja_nuo <= mėnesio paskutinė diena AND
     *     (galioja_iki NULL OR galioja_iki >= mėnesio pirma diena).)
     *  2. Idempotency: ištrina visus expense'us su:
     *       tipas='du' AND aprasymas LIKE 'DU YYYY-MM: %'
     *     PRIEŠ naujų sukūrimą.
     *  3. Per kiekvieną profile aktyvų mėnesyje:
     *     monthly_total = atlyginimas_bruto + priedai
     *     Per kiekvieną distribution aktyvią tame mėnesyje:
     *       amount = jei procentais: monthly_total × reiksme/100
     *               jei fiksuota:   reiksme
     *     Sukuria expense su:
     *       tipas='du', suma=amount, data=mėnesio paskutinė diena,
     *       aprasymas=`DU YYYY-MM: <vardas_pavarde>`,
     *       project_id = DU sistemos projektas per tenant (auto-create jei
     *         nėra),
     *       budget_allocation_id = DU biudžeto eilutė per tenant per metus
     *         (jei nėra — 400 LT klaida).
     *  4. Visa transakcijoje.
     *
     * Mėnesio dalinis galiojimas: pasirinkimas — full month suma (NE
     * proportional). Pagrindimas: docx §4.4 supaprastintas DU modelis;
     * proportional skaičiavimas reikalauja dienų skaičiaus logikos, kuri
     * komplikuoja paprasčiausią finansinį planavimą. Jei reikės — atskira
     * fazė.
     */
    computeMonth: {
      params: {
        month: {
          type: 'string',
          pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$',
        },
      },
      async handler(
        ctx: Context<{ month: string }, AuthMeta>,
      ): Promise<ComputeMonthResponse> {
        // SAUGUMO GATE PIRMAS — tik AM admin.
        requireAmDuAccess(ctx.meta);
        const me = ctx.meta.user!;

        const month = ctx.params.month;
        const { start, end } = monthBounds(month);
        const year = Number(month.slice(0, 4));

        // Surenkam visus aktyvius profile'us mėnesyje su distributions
        // (per visus tenant'us — AM admin scope).
        const profiles = (await PayrollProfile.query()
          .withGraphFetched('[distributions]')
          .where('galioja_nuo', '<=', end)
          .where((qb) => {
            qb.whereNull('galioja_iki').orWhere('galioja_iki', '>=', start);
          })
          .orderBy([
            { column: 'tenant_id', order: 'asc' },
            { column: 'id', order: 'asc' },
          ])) as Array<
          PayrollProfile & { distributions?: PayrollDistribution[] }
        >;

        // Auto-resolve DU allocation + system project per tenant'ą
        // (cache'inam per call'ą).
        const knex = PayrollProfile.knex();
        const result = await knex.transaction(async (trx) => {
          // 1) Idempotency: ištrinam senus DU expense'us šio mėnesio.
          const aprasymasPrefix = buildExpenseAprasymasMonthPrefix(month);
          await trx('expenses')
            .where('tipas', 'du')
            .where('aprasymas', 'like', aprasymasPrefix)
            .delete();

          // 2) Per tenant'ą — auto-resolve DU allocation + project.
          const allocByTenant = new Map<number, number>();
          const projectByTenant = new Map<number, number>();

          let expensesCreated = 0;
          let totalCents = 0;

          for (const profile of profiles) {
            const tenantId = profile.tenantId;

            let allocId = allocByTenant.get(tenantId);
            if (allocId === undefined) {
              allocId = await ensureDuAllocation(trx, tenantId, year);
              allocByTenant.set(tenantId, allocId);
            }

            let projectId = projectByTenant.get(tenantId);
            if (projectId === undefined) {
              projectId = await ensureDuSystemProject(trx, tenantId, allocId);
              projectByTenant.set(tenantId, projectId);
            }

            const brutoCents = toCents(profile.atlyginimasBruto);
            const priedaiCents = toCents(profile.priedai);
            const monthlyTotalCents = brutoCents + priedaiCents;
            if (monthlyTotalCents <= 0) continue;

            const dists = (profile.distributions ?? []) as PayrollDistribution[];

            // Per kiekvieną distribution aktyvią tame mėnesyje:
            for (const d of dists) {
              if (
                !periodsOverlap(d.galiojaNuo, d.galiojaIki, start, end)
              ) {
                continue;
              }
              let amountCents = 0;
              if (d.paskirstymoTipas === 'procentais') {
                const pct = Number(d.reiksme);
                if (!Number.isFinite(pct) || pct <= 0) continue;
                amountCents = Math.round((monthlyTotalCents * pct) / 100);
              } else {
                amountCents = toCents(d.reiksme);
              }
              if (amountCents <= 0) continue;

              const sumaStr = centsToAmount(amountCents);
              const aprasymas = buildExpenseAprasymas(
                month,
                profile.vardasPavarde,
              );

              await Expense.query(trx).insert({
                projectId,
                budgetAllocationId: allocId,
                tipas: 'du',
                suma: sumaStr,
                data: end,
                aprasymas,
                saltinioDalis: [
                  {
                    funding_source_id: d.fundingSourceId,
                    suma: sumaStr,
                  },
                ],
                createdByUserId: me.id,
              });
              expensesCreated += 1;
              totalCents += amountCents;
            }
          }

          return {
            expensesCreated,
            totalCents,
            profilesProcessed: profiles.length,
          };
        });

        return {
          status: 'computed',
          month,
          profilesProcessed: result.profilesProcessed,
          expensesCreated: result.expensesCreated,
          totalAmount: centsToAmount(result.totalCents),
        };
      },
    },
  },
};

// Type exports for tests.
export { CONTRACT_TYPES, DISTRIBUTION_TYPES };
// Suppress unused warning - BudgetAllocationV2 and ClassifierItem are used via raw queries.
void BudgetAllocationV2;
void ClassifierItem;

export default PayrollService;
