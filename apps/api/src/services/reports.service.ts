/**
 * Reports servisas (Iter 14, FVM-6).
 *
 * 3 ataskaitos pagal docx §4.5 + F12-F14:
 *  - `budgetExecution`     (F12) — Biudžeto vykdymo (planas vs faktinis vs likutis)
 *  - `specProgramExecution` (F13) — Spec. programos (prašyta → patvirtinta → panaudota)
 *  - `payrollDistribution`  (F14) — DU paskirstymas (kas kiek iš kurio šaltinio)
 *
 * SAUGUMO MODELIS (per ADR-005 + docx §4.4):
 *
 * `budgetExecution`:
 *  - Visi autentifikuoti vartotojai (tenant-scoped)
 *  - org_user / specialist VISADA pra siūlomas BE DU info — DU expense'ai
 *    NEįskaitomi į `faktine` SUM, DU kategorijos eilutės PAŠALINTOS
 *  - org_admin / AM admin — pilna ataskaita
 *
 * `specProgramExecution`:
 *  - Tenant-scoped per `canViewRequest` analogija — bet kadangi tai
 *    spec.programos (ne DU), DU filter neaktualus
 *  - Specialist (org user) gali matyti TIK savo sukurtus prašymus per
 *    `canViewRequest` logiką (skip jei kompleksiška — Iter 14 priimam, kad
 *    org_user mato visus savo tenant'o spec.programų prašymus)
 *  - Iter 14 supaprastinta: tenant scope tik (be createdByUserId filter'io)
 *
 * `payrollDistribution`:
 *  - `requireDuAccess(meta, tenantId)` PIRMASIS guard'as
 *  - Specialist (org user) ⇒ 403 (negali nei generuoti, nei matyti)
 *  - Org admin ⇒ tik savo tenant'as
 *  - AM admin ⇒ visi tenant'ai (gali filter'inti per `tenantId` param)
 *
 * Formatas (`format` param):
 *  - `json` (default) — JSON atsakymas
 *  - `xlsx` — Buffer per `exceljs`; Content-Type per `ctx.meta.$responseType`
 *  - `pdf`  — Buffer per `pdfkit` su DejaVu Sans (LT diakritiniai)
 *
 * Failo pavadinimas binary response atveju:
 *  - `biudzeto-vykdymas-{year}-{generatedAt-slug}.xlsx`
 *  - `spec-programos-{year}-{generatedAt-slug}.xlsx`
 *  - `du-paskirstymas-{from}-{to}-{generatedAt-slug}.xlsx`
 *
 * REST aliases (`api.service.ts`):
 *  - GET /reports/budget-execution?year=...&tenantId=...&format=...
 *  - GET /reports/spec-program-execution?year=...&tenantId=...&format=...
 *  - GET /reports/payroll-distribution?from=...&to=...&tenantId=...&format=...
 */
import type { ServiceSchema, Context } from 'moleculer';
import { Errors } from 'moleculer';
import type {
  BudgetExecutionCategoryRow,
  BudgetExecutionReport,
  BudgetExecutionReportQuery,
  BudgetExecutionSourceSection,
  PayrollDistributionProfileSection,
  PayrollDistributionReport,
  PayrollDistributionReportQuery,
  PayrollDistributionSourceRow,
  PayrollDistributionSourceTotal,
  ReportFormat,
  SpecProgramItem,
  SpecProgramReport,
  SpecProgramReportQuery,
} from '@biip-finansai/shared';

import { BudgetAllocationV2 } from '../models/BudgetAllocationV2';
import { ClassifierItem } from '../models/ClassifierItem';
import { Expense } from '../models/Expense';
import { FundingSource } from '../models/FundingSource';
import { PayrollProfile } from '../models/PayrollProfile';
import { Project } from '../models/Project';
import { Request as RequestModel } from '../models/Request';
import { Tenant } from '../models/Tenant';
import { centsToAmount, toCents } from '../utils/money';
import {
  calculatePercentUsed,
  calculateWarningFlags,
} from '../utils/fvm';
import {
  canViewPayroll,
  isAmAdminUser,
  requireDuAccess,
} from '../utils/permissions';
import {
  generateBudgetExecutionXlsx,
  generateSpecProgramXlsx,
  generatePayrollDistributionXlsx,
} from '../utils/reports/xlsx';
import {
  generateBudgetExecutionPdf,
  generateSpecProgramPdf,
  generatePayrollDistributionPdf,
} from '../utils/reports/pdf';
import type { AuthMeta } from './auth.service';

const SPEC_PROGRAMA_CODE = 'spec_programa';

/** Suderiname formato variantus. */
const FORMAT_VALUES: readonly ReportFormat[] = ['json', 'xlsx', 'pdf'];

function requireMe(ctx: Context<unknown, AuthMeta>): NonNullable<AuthMeta['user']> {
  if (!ctx.meta.user) {
    throw new Errors.MoleculerClientError(
      'Neautentifikuota',
      401,
      'AUTH_REQUIRED',
    );
  }
  return ctx.meta.user;
}

/**
 * Slug'as failo pavadinimui — paima ISO timestamp ir paverčia jį
 * filesystem-saugiu identifikatoriumi.
 */
function slugifyTimestamp(iso: string): string {
  return iso.replace(/[^0-9TZ:-]/g, '').replace(/[:.]/g, '');
}

/**
 * Nustato Moleculer.web binary response meta (`$responseType` +
 * `Content-Disposition`). Iškvietėjas turi grąžinti `Buffer`.
 *
 * @param meta - Aktyvus `ctx.meta`.
 * @param mimeType - MIME tipas (xlsx / pdf).
 * @param fileName - Atsisiunčiamo failo pavadinimas (be path).
 */
function setBinaryResponseMeta(
  meta: AuthMeta,
  mimeType: string,
  fileName: string,
): void {
  // Moleculer.web extension: $responseType + $responseHeaders override
  // default `application/json` Content-Type.
  // Failo pavadinime gali būti LT diakritinių — naudojam `filename*=` RFC 5987
  // (UTF-8 encoded), kad naršyklės teisingai dekoduotų.
  const encoded = encodeURIComponent(fileName);
  const m = meta as AuthMeta & {
    $responseType?: string;
    $responseHeaders?: Record<string, string>;
  };
  m.$responseType = mimeType;
  m.$responseHeaders = {
    'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encoded}`,
  };
}

/**
 * Patikrina, ar org admin / org user gali pasirinkti `tenantId` filter'ą.
 *
 * - AM admin: gali pasirinkti bet kurį tenant'ą arba palikti `undefined`
 *   (gauna visus).
 * - AM user (scope null): tas pats kaip AM admin (ataskaitose).
 * - AM user (scope=[ids]): jei `tenantId` nurodytas — turi būti scope'e;
 *   jei `undefined` — apriboja scope'u.
 * - Org admin / org user: gali matyti TIK savo tenant'ą. Jei `tenantId`
 *   nurodytas ir ne savo — 403. Jei `undefined` — implicit'iškai savo.
 *
 * @returns Efektyvus `tenantId` filter'is (null = visi pagal scope).
 */
function resolveTenantScope(
  me: NonNullable<AuthMeta['user']>,
  requestedTenantId: number | undefined,
): { tenantId: number | null; scopeIds: number[] | null } {
  // AM admin
  if (me.role === 'admin' && me.tenantIsApprover) {
    if (requestedTenantId !== undefined) {
      return { tenantId: requestedTenantId, scopeIds: null };
    }
    return { tenantId: null, scopeIds: null };
  }
  // AM user
  if (me.tenantIsApprover) {
    if (me.amScopeOrgIds !== null) {
      if (requestedTenantId !== undefined) {
        if (!me.amScopeOrgIds.includes(requestedTenantId)) {
          throw new Errors.MoleculerClientError(
            'Pasirinkta organizacija nepasiekiama jūsų matomumo zonoje',
            403,
            'TENANT_OUT_OF_SCOPE',
          );
        }
        return { tenantId: requestedTenantId, scopeIds: null };
      }
      return { tenantId: null, scopeIds: me.amScopeOrgIds };
    }
    // Scope null = visi tenant'ai
    if (requestedTenantId !== undefined) {
      return { tenantId: requestedTenantId, scopeIds: null };
    }
    return { tenantId: null, scopeIds: null };
  }
  // Org admin / org user — tik savo
  if (requestedTenantId !== undefined && requestedTenantId !== me.tenantId) {
    throw new Errors.MoleculerClientError(
      'Neturite teisės matyti kitos organizacijos duomenų',
      403,
      'FORBIDDEN',
    );
  }
  return { tenantId: me.tenantId, scopeIds: null };
}

/**
 * Loaduoja tenant pavadinimą per tenantId. Jei null — grąžina null.
 * Naudojama report header'iui (UI rodymui).
 */
async function loadTenantName(tenantId: number | null): Promise<string | null> {
  if (tenantId === null) return null;
  const t = (await Tenant.query()
    .findById(tenantId)
    .select('name')) as { name: string } | undefined;
  return t?.name ?? null;
}

// ---------- F12 budget execution helpers ----------

/**
 * Užkrauna allocations su funding source + category classifier item;
 * filter'ina pagal year + tenant scope + DU filter (pagal `canViewPayroll`).
 */
async function loadAllocationsForBudgetExec(
  me: NonNullable<AuthMeta['user']>,
  year: number,
  resolvedTenantId: number | null,
  scopeIds: number[] | null,
): Promise<
  Array<
    BudgetAllocationV2 & {
      fundingSource?: FundingSource & {
        tipasClassifierItem?: ClassifierItem;
      };
      categoryClassifierItem?: ClassifierItem;
    }
  >
> {
  const q = BudgetAllocationV2.query()
    .withGraphFetched(
      '[categoryClassifierItem, fundingSource.[tipasClassifierItem]]',
    )
    .where('budget_allocations_v2.metai', year)
    .orderBy([
      { column: 'budget_allocations_v2.funding_source_id', order: 'asc' },
      { column: 'budget_allocations_v2.pavadinimas', order: 'asc' },
    ]);

  // Tenant scope
  if (resolvedTenantId !== null) {
    q.whereExists((qb) => {
      qb.from('funding_sources')
        .whereRaw(
          'funding_sources.id = budget_allocations_v2.funding_source_id',
        )
        .where('funding_sources.tenant_id', resolvedTenantId);
    });
  } else if (scopeIds !== null) {
    if (scopeIds.length === 0) return [];
    q.whereExists((qb) => {
      qb.from('funding_sources')
        .whereRaw(
          'funding_sources.id = budget_allocations_v2.funding_source_id',
        )
        .whereIn('funding_sources.tenant_id', scopeIds);
    });
  }

  // DU filter — analogiškai `expenses.budgetSummary` + `budgetAllocations.list`
  if (!canViewPayroll(me)) {
    q.whereNotExists((qb) => {
      qb.from('classifier_items')
        .whereRaw(
          'classifier_items.id = budget_allocations_v2.category_classifier_item_id',
        )
        .where('classifier_items.code', 'du');
    });
  }

  return (await q) as Array<
    BudgetAllocationV2 & {
      fundingSource?: FundingSource & {
        tipasClassifierItem?: ClassifierItem;
      };
      categoryClassifierItem?: ClassifierItem;
    }
  >;
}

/**
 * Per kiekvieną allocation paima `SUM(expenses.suma)` su DU filter'iu
 * (jei vartotojas neturi DU teisės). Vienoje GROUP BY užklausoje.
 */
async function loadFaktineByAllocation(
  me: NonNullable<AuthMeta['user']>,
  allocationIds: number[],
): Promise<Map<number, number>> {
  if (allocationIds.length === 0) return new Map();
  const expenseQ = Expense.query()
    .select('budget_allocation_id')
    .sum('suma as total')
    .whereIn('budget_allocation_id', allocationIds)
    .groupBy('budget_allocation_id');
  if (!canViewPayroll(me)) {
    expenseQ.whereNot('expenses.tipas', 'du');
  }
  const expenseRows = (await expenseQ) as unknown as Array<{
    budgetAllocationId: number;
    total: string | null;
  }>;
  const out = new Map<number, number>();
  for (const r of expenseRows) {
    out.set(r.budgetAllocationId, toCents(r.total));
  }
  return out;
}

// ---------- F14 payroll distribution helpers ----------

interface ExpenseWithProject {
  id: number;
  budgetAllocationId: number;
  payrollProfileId: number | null;
  suma: string;
  saltinioDalis: Array<{ funding_source_id: number; suma: string }> | null;
}

interface ProfileMin {
  id: number;
  tenantId: number;
  vardasPavarde: string;
  pareigos: string;
  tenant?: { id: number; code: string; name: string };
}

interface FundingSourceMin {
  id: number;
  pavadinimas: string;
  kodas: string;
}

/**
 * Bendra payrollDistribution agregacija. Užkrauna:
 *  - DU expense'us per laikotarpį (tipas='du', data per from/to);
 *    tenant scope per project.tenant_id.
 *  - Allocation -> FundingSource mapping (single-source fallback).
 *  - Profile metadata per `payroll_profile_id`.
 *  - FundingSource metadata per visus naudotus šaltinius.
 *
 * Grąžina struktūrintą `PayrollDistributionReport`.
 */
async function aggregatePayrollDistribution(
  from: string,
  to: string,
  resolvedTenantId: number | null,
  scopeIds: number[] | null,
  tenantName: string | null,
  generatedAt: string,
): Promise<PayrollDistributionReport> {
  // 1) Load DU expense'us su tenant scope
  const expenseQ = Expense.query()
    .where('expenses.tipas', 'du')
    .where('expenses.data', '>=', from)
    .where('expenses.data', '<=', to)
    .select(
      'expenses.id as id',
      'expenses.budget_allocation_id as budgetAllocationId',
      'expenses.payroll_profile_id as payrollProfileId',
      'expenses.suma as suma',
      'expenses.saltinio_dalis as saltinioDalis',
    );
  if (resolvedTenantId !== null) {
    expenseQ.whereExists((qb) => {
      qb.from('projects')
        .whereRaw('projects.id = expenses.project_id')
        .where('projects.tenant_id', resolvedTenantId);
    });
  } else if (scopeIds !== null) {
    if (scopeIds.length === 0) {
      return {
        from,
        to,
        generatedAt,
        tenantId: null,
        tenantName: null,
        grandTotal: '0.00',
        byProfile: [],
        totalsBySource: [],
      };
    }
    expenseQ.whereExists((qb) => {
      qb.from('projects')
        .whereRaw('projects.id = expenses.project_id')
        .whereIn('projects.tenant_id', scopeIds);
    });
  }
  const rawExpenses = (await expenseQ) as unknown as ExpenseWithProject[];

  if (rawExpenses.length === 0) {
    return {
      from,
      to,
      generatedAt,
      tenantId: resolvedTenantId,
      tenantName,
      grandTotal: '0.00',
      byProfile: [],
      totalsBySource: [],
    };
  }

  // 2) Allocation -> FundingSource lookup (single-source fallback).
  const allocIds = new Set<number>();
  for (const e of rawExpenses) allocIds.add(e.budgetAllocationId);
  const allocRows = (await BudgetAllocationV2.query()
    .whereIn('id', Array.from(allocIds))
    .select('id', 'funding_source_id as fundingSourceId')) as Array<{
    id: number;
    fundingSourceId: number;
  }>;
  const allocToSource = new Map<number, number>();
  for (const r of allocRows) allocToSource.set(r.id, r.fundingSourceId);

  // 3) Profile metadata
  const profileIds = new Set<number>();
  for (const e of rawExpenses) {
    if (e.payrollProfileId !== null) profileIds.add(e.payrollProfileId);
  }
  const profiles = (await PayrollProfile.query()
    .whereIn('payroll_profiles.id', Array.from(profileIds))
    .withGraphFetched('tenant')) as unknown as ProfileMin[];
  const profileById = new Map<number, ProfileMin>();
  for (const p of profiles) profileById.set(p.id, p);

  // 4) Per-profile / per-source agregacija (centais).
  //    Naudojam map<profileId, map<fundingSourceId, totalCents>>.
  const byProfileMap = new Map<number, Map<number, number>>();
  // NULL profile bucket — jei kažkokie DU expense'ai be profile FK
  // (legacy / backfill missed); rodom kaip „Nenustatytas darbuotojas".
  const ORPHAN_PROFILE_KEY = -1;
  const byTotalsBySourceMap = new Map<number, number>();

  let grandTotalCents = 0;

  for (const e of rawExpenses) {
    const profileKey = e.payrollProfileId ?? ORPHAN_PROFILE_KEY;
    let bySource = byProfileMap.get(profileKey);
    if (!bySource) {
      bySource = new Map<number, number>();
      byProfileMap.set(profileKey, bySource);
    }

    if (e.saltinioDalis !== null && Array.isArray(e.saltinioDalis)) {
      for (const split of e.saltinioDalis) {
        const sumCents = toCents(split.suma);
        if (sumCents <= 0) continue;
        const fsId = split.funding_source_id;
        bySource.set(fsId, (bySource.get(fsId) ?? 0) + sumCents);
        byTotalsBySourceMap.set(
          fsId,
          (byTotalsBySourceMap.get(fsId) ?? 0) + sumCents,
        );
        grandTotalCents += sumCents;
      }
    } else {
      // Single-source fallback per allocation
      const fsId = allocToSource.get(e.budgetAllocationId);
      if (fsId === undefined) continue;
      const sumCents = toCents(e.suma);
      if (sumCents <= 0) continue;
      bySource.set(fsId, (bySource.get(fsId) ?? 0) + sumCents);
      byTotalsBySourceMap.set(
        fsId,
        (byTotalsBySourceMap.get(fsId) ?? 0) + sumCents,
      );
      grandTotalCents += sumCents;
    }
  }

  // 5) Per FundingSource metadata
  const allFsIds = new Set<number>();
  for (const fsId of byTotalsBySourceMap.keys()) allFsIds.add(fsId);
  const fsRows = (await FundingSource.query()
    .whereIn('id', Array.from(allFsIds))
    .select('id', 'pavadinimas', 'kodas')) as FundingSourceMin[];
  const fsById = new Map<number, FundingSourceMin>();
  for (const f of fsRows) fsById.set(f.id, f);

  // 6) Build byProfile
  const byProfile: PayrollDistributionProfileSection[] = [];
  for (const [profileKey, sourceMap] of byProfileMap.entries()) {
    const profile = profileKey === ORPHAN_PROFILE_KEY
      ? null
      : profileById.get(profileKey);
    const bySource: PayrollDistributionSourceRow[] = [];
    let totalCents = 0;
    for (const [fsId, cents] of sourceMap.entries()) {
      const fs = fsById.get(fsId);
      bySource.push({
        fundingSourceId: fsId,
        fundingSourceName: fs?.pavadinimas ?? '— nežinomas šaltinis —',
        fundingSourceCode: fs?.kodas ?? '',
        sumaPerLaikotarpi: centsToAmount(cents),
      });
      totalCents += cents;
    }
    bySource.sort((a, b) =>
      a.fundingSourceName.localeCompare(b.fundingSourceName, 'lt'),
    );
    byProfile.push({
      profileId: profile?.id ?? ORPHAN_PROFILE_KEY,
      vardasPavarde: profile?.vardasPavarde ?? '— Nenustatytas darbuotojas —',
      pareigos: profile?.pareigos ?? '—',
      tenantId: profile?.tenantId ?? resolvedTenantId ?? 0,
      tenantCode: profile?.tenant?.code ?? '—',
      tenantName: profile?.tenant?.name ?? '—',
      totalPerLaikotarpi: centsToAmount(totalCents),
      bySource,
    });
  }
  byProfile.sort((a, b) =>
    a.vardasPavarde.localeCompare(b.vardasPavarde, 'lt'),
  );

  // 7) Build totalsBySource
  const totalsBySource: PayrollDistributionSourceTotal[] = [];
  for (const [fsId, cents] of byTotalsBySourceMap.entries()) {
    const fs = fsById.get(fsId);
    totalsBySource.push({
      fundingSourceId: fsId,
      fundingSourceName: fs?.pavadinimas ?? '— nežinomas šaltinis —',
      fundingSourceCode: fs?.kodas ?? '',
      total: centsToAmount(cents),
    });
  }
  totalsBySource.sort((a, b) =>
    a.fundingSourceName.localeCompare(b.fundingSourceName, 'lt'),
  );

  return {
    from,
    to,
    generatedAt,
    tenantId: resolvedTenantId,
    tenantName,
    grandTotal: centsToAmount(grandTotalCents),
    byProfile,
    totalsBySource,
  };
}

const ReportsService: ServiceSchema = {
  name: 'reports',

  actions: {
    /**
     * F12 — Biudžeto vykdymo ataskaita.
     */
    budgetExecution: {
      params: {
        year: {
          type: 'number',
          integer: true,
          convert: true,
          min: 2000,
          max: 3000,
        },
        tenantId: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
        },
        format: {
          type: 'enum',
          values: FORMAT_VALUES,
          optional: true,
        },
      },
      async handler(
        ctx: Context<BudgetExecutionReportQuery, AuthMeta>,
      ): Promise<BudgetExecutionReport | Buffer> {
        const me = requireMe(ctx);
        const year = ctx.params.year;
        const format = ctx.params.format ?? 'json';

        const { tenantId: resolvedTenantId, scopeIds } = resolveTenantScope(
          me,
          ctx.params.tenantId,
        );
        const tenantName = await loadTenantName(resolvedTenantId);

        const generatedAt = new Date().toISOString();

        const allocations = await loadAllocationsForBudgetExec(
          me,
          year,
          resolvedTenantId,
          scopeIds,
        );
        const allocationIds = allocations.map((a) => a.id);
        const faktineByAllocation = await loadFaktineByAllocation(
          me,
          allocationIds,
        );

        // Group per fundingSource
        const sourceMap = new Map<number, BudgetExecutionSourceSection>();
        let totalPlanuotaCents = 0;
        let totalFaktineCents = 0;

        for (const alloc of allocations) {
          const planuotaCents = toCents(alloc.planuotaSuma);
          const faktineCents = faktineByAllocation.get(alloc.id) ?? 0;
          const likutisCents = planuotaCents - faktineCents;
          const percentUsed = calculatePercentUsed(
            planuotaCents,
            faktineCents,
          );
          const flags = calculateWarningFlags(percentUsed);

          const fsId = alloc.fundingSourceId;
          let section = sourceMap.get(fsId);
          if (!section) {
            section = {
              fundingSourceId: fsId,
              fundingSourceName: alloc.fundingSource?.pavadinimas ?? '—',
              fundingSourceTypeCode:
                alloc.fundingSource?.tipasClassifierItem?.code ?? '—',
              fundingSourceTypeName:
                alloc.fundingSource?.tipasClassifierItem?.name ?? '—',
              planuota: '0.00',
              faktine: '0.00',
              likutis: '0.00',
              percentUsed: 0,
              byCategory: [],
            };
            sourceMap.set(fsId, section);
          }

          const catRow: BudgetExecutionCategoryRow = {
            categoryItemId: alloc.id,
            categoryCode: alloc.categoryClassifierItem?.code ?? '—',
            categoryName: alloc.categoryClassifierItem?.name ?? '—',
            allocationName: alloc.pavadinimas,
            planuota: centsToAmount(planuotaCents),
            faktine: centsToAmount(faktineCents),
            likutis: centsToAmount(likutisCents),
            percentUsed,
            isWarning: flags.isWarning,
            isOver: flags.isOver,
          };
          section.byCategory.push(catRow);

          // Sum per source
          const sectionPlanCents =
            toCents(section.planuota) + planuotaCents;
          const sectionFakCents =
            toCents(section.faktine) + faktineCents;
          section.planuota = centsToAmount(sectionPlanCents);
          section.faktine = centsToAmount(sectionFakCents);
          section.likutis = centsToAmount(sectionPlanCents - sectionFakCents);
          section.percentUsed = calculatePercentUsed(
            sectionPlanCents,
            sectionFakCents,
          );

          totalPlanuotaCents += planuotaCents;
          totalFaktineCents += faktineCents;
        }

        const bySource = Array.from(sourceMap.values());
        bySource.sort((a, b) =>
          a.fundingSourceName.localeCompare(b.fundingSourceName, 'lt'),
        );

        const data: BudgetExecutionReport = {
          year,
          generatedAt,
          tenantId: resolvedTenantId,
          tenantName,
          totalPlanuota: centsToAmount(totalPlanuotaCents),
          totalFaktine: centsToAmount(totalFaktineCents),
          totalLikutis: centsToAmount(totalPlanuotaCents - totalFaktineCents),
          bySource,
        };

        if (format === 'xlsx') {
          const buf = await generateBudgetExecutionXlsx(data);
          const fileName = `biudzeto-vykdymas-${year}-${slugifyTimestamp(generatedAt)}.xlsx`;
          setBinaryResponseMeta(
            ctx.meta,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            fileName,
          );
          return buf;
        }
        if (format === 'pdf') {
          const buf = await generateBudgetExecutionPdf(data);
          const fileName = `biudzeto-vykdymas-${year}-${slugifyTimestamp(generatedAt)}.pdf`;
          setBinaryResponseMeta(ctx.meta, 'application/pdf', fileName);
          return buf;
        }
        return data;
      },
    },

    /**
     * F13 — Spec. programų ataskaita.
     */
    specProgramExecution: {
      params: {
        year: {
          type: 'number',
          integer: true,
          convert: true,
          min: 2000,
          max: 3000,
        },
        tenantId: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
        },
        format: {
          type: 'enum',
          values: FORMAT_VALUES,
          optional: true,
        },
      },
      async handler(
        ctx: Context<SpecProgramReportQuery, AuthMeta>,
      ): Promise<SpecProgramReport | Buffer> {
        const me = requireMe(ctx);
        const year = ctx.params.year;
        const format = ctx.params.format ?? 'json';

        const { tenantId: resolvedTenantId, scopeIds } = resolveTenantScope(
          me,
          ctx.params.tenantId,
        );
        const tenantName = await loadTenantName(resolvedTenantId);

        const generatedAt = new Date().toISOString();

        // Load APPROVED spec_programa requests šitam year
        // su budget_category.code = 'spec_programa'
        const reqQ = RequestModel.query()
          .withGraphFetched('[tenant, budgetCategory]')
          .where('requests.status', 'APPROVED')
          .where('requests.year', year)
          .whereExists((qb) => {
            qb.from('classifier_items')
              .whereRaw('classifier_items.id = requests.budget_category_id')
              .where('classifier_items.code', SPEC_PROGRAMA_CODE);
          })
          .orderBy([
            { column: 'requests.tenant_id', order: 'asc' },
            { column: 'requests.id', order: 'asc' },
          ]);

        if (resolvedTenantId !== null) {
          reqQ.where('requests.tenant_id', resolvedTenantId);
        } else if (scopeIds !== null) {
          if (scopeIds.length === 0) {
            const empty: SpecProgramReport = {
              year,
              generatedAt,
              tenantId: null,
              tenantName: null,
              totalPrasyta: '0.00',
              totalPatvirtinta: '0.00',
              totalPanaudota: '0.00',
              items: [],
            };
            return format === 'json' ? empty : await renderSpecXlsxOrPdf(
              ctx,
              empty,
              year,
              generatedAt,
              format,
            );
          }
          reqQ.whereIn('requests.tenant_id', scopeIds);
        }

        const requests = (await reqQ) as Array<
          RequestModel & {
            tenant?: Tenant;
            budgetCategory?: ClassifierItem;
          }
        >;

        // Per project (jei sukurtas) — gauname panaudota = SUM(expenses.suma)
        const projectIds = requests
          .map((r) => r.fvmProjectId)
          .filter((id): id is number => id !== null);
        const projectsById = new Map<number, Project>();
        let panaudotaByProject = new Map<number, number>();
        if (projectIds.length > 0) {
          const projects = (await Project.query().whereIn(
            'id',
            projectIds,
          )) as Project[];
          for (const p of projects) projectsById.set(p.id, p);

          const expenseRows = (await Expense.query()
            .select('project_id')
            .sum('suma as total')
            .whereIn('project_id', projectIds)
            .groupBy('project_id')) as unknown as Array<{
            projectId: number;
            total: string | null;
          }>;
          for (const er of expenseRows) {
            panaudotaByProject.set(er.projectId, toCents(er.total));
          }
        }

        const items: SpecProgramItem[] = [];
        let totalPrasytaCents = 0;
        let totalPatvirtintaCents = 0;
        let totalPanaudotaCents = 0;

        for (const r of requests) {
          const prasytaCents =
            toCents(r.costDu) +
            toCents(r.costEquipment) +
            toCents(r.costCreation) +
            toCents(r.costAnalysis) +
            toCents(r.costDevelopment) +
            toCents(r.costMaintenance) +
            toCents(r.costModernization) +
            toCents(r.costDecommissioning);
          const patvirtintaCents = toCents(r.decisionGrantedAmount ?? '0');
          const panaudotaCents = r.fvmProjectId !== null
            ? panaudotaByProject.get(r.fvmProjectId) ?? 0
            : 0;
          const likutisCents = patvirtintaCents - panaudotaCents;
          const percentUsed = calculatePercentUsed(
            patvirtintaCents,
            panaudotaCents,
          );
          const proj = r.fvmProjectId !== null
            ? projectsById.get(r.fvmProjectId)
            : undefined;

          items.push({
            requestId: r.id,
            requestProjectName: r.projectName,
            tenantId: r.tenantId,
            tenantCode: r.tenant?.code ?? '—',
            tenantName: r.tenant?.name ?? '—',
            budgetCategoryCode: r.budgetCategory?.code ?? SPEC_PROGRAMA_CODE,
            specProgramFundingType: r.specProgramFundingType,
            prasyta: centsToAmount(prasytaCents),
            patvirtinta: centsToAmount(patvirtintaCents),
            panaudota: centsToAmount(panaudotaCents),
            likutis: centsToAmount(likutisCents),
            percentUsed,
            projektoId: proj?.id ?? null,
            projektoStatusas: proj?.statusas ?? null,
          });

          totalPrasytaCents += prasytaCents;
          totalPatvirtintaCents += patvirtintaCents;
          totalPanaudotaCents += panaudotaCents;
        }

        const data: SpecProgramReport = {
          year,
          generatedAt,
          tenantId: resolvedTenantId,
          tenantName,
          totalPrasyta: centsToAmount(totalPrasytaCents),
          totalPatvirtinta: centsToAmount(totalPatvirtintaCents),
          totalPanaudota: centsToAmount(totalPanaudotaCents),
          items,
        };

        if (format === 'json') return data;
        return renderSpecXlsxOrPdf(ctx, data, year, generatedAt, format);
      },
    },

    /**
     * F14 — DU paskirstymo ataskaita. SAUGUMO PRIORITETINĖ.
     */
    payrollDistribution: {
      params: {
        from: { type: 'string', min: 1 },
        to: { type: 'string', min: 1 },
        tenantId: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
        },
        format: {
          type: 'enum',
          values: FORMAT_VALUES,
          optional: true,
        },
      },
      async handler(
        ctx: Context<PayrollDistributionReportQuery, AuthMeta>,
      ): Promise<PayrollDistributionReport | Buffer> {
        // SAUGUMO GATE PIRMASIS — prieš bet kokias DB query'es.
        // requireDuAccess: AM admin (be tenant'o) + Org admin (savo tenant).
        // Specialist (org user) ⇒ 403, net be tenantId.
        requireDuAccess(ctx.meta, ctx.params.tenantId);
        const me = ctx.meta.user!;

        const { from, to } = ctx.params;
        const format = ctx.params.format ?? 'json';

        // Date validation
        if (from > to) {
          throw new Errors.MoleculerClientError(
            'Pradžios data negali būti vėlesnė už pabaigos datą',
            400,
            'INVALID_DATE_RANGE',
          );
        }

        // Tenant scope: AM admin pasirenka per tenantId; org_admin
        // visada savo tenant.
        let resolvedTenantId: number | null;
        let scopeIds: number[] | null = null;
        if (isAmAdminUser(me)) {
          resolvedTenantId = ctx.params.tenantId ?? null;
        } else {
          // Org admin (po requireDuAccess'o — garantuotai admin tenant'e).
          resolvedTenantId = me.tenantId;
        }
        const tenantName = await loadTenantName(resolvedTenantId);
        const generatedAt = new Date().toISOString();

        const data = await aggregatePayrollDistribution(
          from,
          to,
          resolvedTenantId,
          scopeIds,
          tenantName,
          generatedAt,
        );

        if (format === 'xlsx') {
          const buf = await generatePayrollDistributionXlsx(data);
          const fileName = `du-paskirstymas-${from}-${to}-${slugifyTimestamp(generatedAt)}.xlsx`;
          setBinaryResponseMeta(
            ctx.meta,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            fileName,
          );
          return buf;
        }
        if (format === 'pdf') {
          const buf = await generatePayrollDistributionPdf(data);
          const fileName = `du-paskirstymas-${from}-${to}-${slugifyTimestamp(generatedAt)}.pdf`;
          setBinaryResponseMeta(ctx.meta, 'application/pdf', fileName);
          return buf;
        }
        return data;
      },
    },
  },
};

/**
 * Helper'is — spec.programos ataskaitos xlsx / pdf renderavimui + meta'as.
 */
async function renderSpecXlsxOrPdf(
  ctx: Context<unknown, AuthMeta>,
  data: SpecProgramReport,
  year: number,
  generatedAt: string,
  format: ReportFormat,
): Promise<Buffer> {
  if (format === 'xlsx') {
    const buf = await generateSpecProgramXlsx(data);
    const fileName = `spec-programos-${year}-${slugifyTimestamp(generatedAt)}.xlsx`;
    setBinaryResponseMeta(
      ctx.meta,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName,
    );
    return buf;
  }
  // pdf
  const buf = await generateSpecProgramPdf(data);
  const fileName = `spec-programos-${year}-${slugifyTimestamp(generatedAt)}.pdf`;
  setBinaryResponseMeta(ctx.meta, 'application/pdf', fileName);
  return buf;
}

export default ReportsService;
