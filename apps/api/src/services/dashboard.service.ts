/**
 * Dashboard servisas — pradžios ekrano duomenys, scoped pagal vartotojo rolę.
 *
 * Grąžina:
 *   - stats: skaičiukai per statusą + sumos
 *   - actionable: prašymai kuriems reikia mano veiksmų (RETURNED/DRAFT submitter'iui,
 *     arba nieko AM rolėms — joms aktualūs pendingReview)
 *   - pendingReview: SUBMITTED prašymai laukiantys AM tvirtinimo (tik AM rolėms)
 *   - recentActivity: paskutiniai 10 komentarų visuose matomuose prašymuose
 *   - perTenantBreakdown: agregatai per organizaciją (tik AM rolėms)
 */
import type { ServiceSchema, Context } from 'moleculer';
import { Errors } from 'moleculer';
import type {
  BudgetCategoryStats,
  BudgetWarningItem,
  CostCategoryStats,
  DashboardActivityItem,
  DashboardData,
  DashboardPerTenantStats,
  DashboardStats,
  FinancingRequest as RequestDTO,
  FvmSummaryResponse,
  UpcomingDeadline,
} from '@biip-finansai/shared';
import { BudgetAllocationV2 } from '../models/BudgetAllocationV2';
import { Expense } from '../models/Expense';
import { FundingSource } from '../models/FundingSource';
import { Project } from '../models/Project';
import { Request } from '../models/Request';
import { RequestComment } from '../models/RequestComment';
import { ClassifierItem } from '../models/ClassifierItem';
import { Tenant } from '../models/Tenant';
import { User } from '../models/User';
import { centsToAmount, toCents } from '../utils/money';
import { calculatePercentUsed, calculateWarningFlags } from '../utils/fvm';
import { canAccessTenant, canViewPayroll } from '../utils/permissions';
import type { AuthMeta } from './auth.service';

interface RequestWithRels extends Request {
  tenant?: Tenant;
  createdByUser?: User;
  decidedByUser?: User;
  budgetCategory?: ClassifierItem;
  fundingSourceType?: ClassifierItem;
}

interface CommentWithRels extends RequestComment {
  authorUser?: User;
  request?: Request & { tenant?: Tenant };
}

function requireMe(ctx: Context<unknown, AuthMeta>): NonNullable<AuthMeta['user']> {
  if (!ctx.meta.user) {
    throw new Errors.MoleculerClientError('Neautentifikuota', 401, 'AUTH_REQUIRED');
  }
  return ctx.meta.user;
}

function toRequestDTO(r: RequestWithRels): RequestDTO {
  if (!r.tenant || !r.createdByUser) {
    throw new Error(`Request ${r.id} without relations`);
  }
  return {
    id: r.id,
    tenantId: r.tenantId,
    tenantCode: r.tenant.code,
    tenantName: r.tenant.name,
    createdByUserId: r.createdByUserId,
    createdByName: r.createdByUser.fullName,
    status: r.status,
    year: r.year,
    projectName: r.projectName,
    systemCode: r.systemCode,
    projectType: r.projectType,
    description: r.description,
    plannedWorks: r.plannedWorks,
    priority: r.priority,
    procurementStage: r.procurementStage,
    costDu: String(r.costDu),
    costEquipment: String(r.costEquipment),
    costCreation: String(r.costCreation),
    costAnalysis: String(r.costAnalysis),
    costDevelopment: String(r.costDevelopment),
    costMaintenance: String(r.costMaintenance),
    costModernization: String(r.costModernization),
    costDecommissioning: String(r.costDecommissioning),
    fundingFromIt: String(r.fundingFromIt),
    otherFunds: String(r.otherFunds),
    otherFundsSource: r.otherFundsSource,
    q1Amount: String(r.q1Amount),
    q2Amount: String(r.q2Amount),
    q3Amount: String(r.q3Amount),
    q4Amount: String(r.q4Amount),
    responsibleInstitution: r.responsibleInstitution,
    executorName: r.executorName,
    executorEmail: r.executorEmail,
    implementationDeadline: r.implementationDeadline,
    submitterNotes: r.submitterNotes,
    decisionGrantedAmount:
      r.decisionGrantedAmount === null ? null : String(r.decisionGrantedAmount),
    decisionFundingSource: r.decisionFundingSource,
    decisionProtocol: r.decisionProtocol,
    decisionOrder: r.decisionOrder,
    decisionOrderDate: r.decisionOrderDate,
    decidedAt: r.decidedAt,
    decidedByUserId: r.decidedByUserId,
    decidedByName: r.decidedByUser?.fullName ?? null,
    // FVM laukai (Iter 10)
    budgetCategoryId: r.budgetCategoryId,
    budgetCategoryCode: r.budgetCategory?.code ?? null,
    budgetCategoryName: r.budgetCategory?.name ?? null,
    fundingSourceTypeId: r.fundingSourceTypeId,
    fundingSourceTypeCode: r.fundingSourceType?.code ?? null,
    fundingSourceTypeName: r.fundingSourceType?.name ?? null,
    specProgramFundingType: r.specProgramFundingType,
    fvmProjectId: r.fvmProjectId,
    submittedAt: r.submittedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// Kanoninė „prašyta" suma — VISI 8 cost laukai, ĮSKAITANT DU (sprendimas
// 2026-06-14). Atitinka RequestWizard „Iš viso prašoma", plano→prašymo costSum
// ir F13 ataskaitą. costDu prašyme — planuojama eilutė, NE faktinis atlyginimas
// (NĖRA DU-jautrus, ADR-005). Anksčiau DU buvo praleidžiamas → nesutapdavo su
// kaštų kategorijų grafiku; dabar nuoseklu visur (įsk. AI cost_categories).
function totalRequestedFromRow(r: Request): number {
  return (
    Number(r.costDu) +
    Number(r.costEquipment) +
    Number(r.costCreation) +
    Number(r.costAnalysis) +
    Number(r.costDevelopment) +
    Number(r.costMaintenance) +
    Number(r.costModernization) +
    Number(r.costDecommissioning)
  );
}

/**
 * Sukuria base query'į prašymams su scope filtru pagal user'į.
 */
function scopedRequestQuery(me: NonNullable<AuthMeta['user']>) {
  const q = Request.query();
  if (me.tenantIsApprover) {
    if (me.role === 'user' && me.amScopeOrgIds !== null) {
      if (me.amScopeOrgIds.length === 0) {
        q.whereRaw('FALSE');
      } else {
        q.whereIn('requests.tenant_id', me.amScopeOrgIds);
      }
    }
    // admin — visi
    // Issue/UR: AM nemato pavaldžių institucijų juodraščių — tik savo „on behalf" sukurtus.
    q.where((qb) => {
      qb.whereNot('requests.status', 'DRAFT').orWhere('requests.created_by_user_id', me.id);
    });
  } else {
    if (me.role === 'admin') {
      q.where('requests.tenant_id', me.tenantId);
    } else {
      q.where('requests.tenant_id', me.tenantId).andWhere('requests.created_by_user_id', me.id);
    }
  }
  return q;
}

const DashboardService: ServiceSchema = {
  name: 'dashboard',

  actions: {
    get: {
      async handler(ctx: Context<unknown, AuthMeta>): Promise<DashboardData> {
        const me = requireMe(ctx);
        const isApprover = me.tenantIsApprover;
        const year = new Date().getFullYear();

        // ===== Stats =====
        // Visi prašymai scoped — agreguojam per statusą
        // Pastaba: dashboard statistika apima visus metus + visus statusus (įsk. planus).
        const allRequests = (await scopedRequestQuery(me).select(
          'requests.id',
          'requests.status',
          'requests.tenant_id',
          'requests.year',
          'requests.cost_du',
          'requests.cost_equipment',
          'requests.cost_creation',
          'requests.cost_analysis',
          'requests.cost_development',
          'requests.cost_maintenance',
          'requests.cost_modernization',
          'requests.cost_decommissioning',
          'requests.decision_granted_amount',
          'requests.budget_category_id',
          'requests.created_at',
        )) as Request[];

        const byStatus = {
          DRAFT: 0,
          SUBMITTED: 0,
          RETURNED: 0,
          APPROVED: 0,
          REJECTED: 0,
          // Issue #9: neaktualūs (soft-archive).
          NEAKTUALU: 0,
        };
        const amountsByStatus = {
          SUBMITTED: 0,
          RETURNED: 0,
          APPROVED: 0,
          REJECTED: 0,
        };
        let totalRequestedThisYear = 0;
        let totalApprovedThisYear = 0;
        let totalRejectedThisYear = 0;

        const categoryAccumulator: Record<
          CostCategoryStats['key'],
          {
            label: string;
            field: keyof Request;
            requested: number;
            approved: number;
            rejected: number;
            count: number;
          }
        > = {
          du: {
            label: 'DU / Atlyginimai',
            field: 'costDu',
            requested: 0,
            approved: 0,
            rejected: 0,
            count: 0,
          },
          equipment: {
            label: 'Įranga / licencijos',
            field: 'costEquipment',
            requested: 0,
            approved: 0,
            rejected: 0,
            count: 0,
          },
          creation: {
            label: 'Kūrimas',
            field: 'costCreation',
            requested: 0,
            approved: 0,
            rejected: 0,
            count: 0,
          },
          analysis: {
            label: 'Analizė',
            field: 'costAnalysis',
            requested: 0,
            approved: 0,
            rejected: 0,
            count: 0,
          },
          development: {
            label: 'Vystymas',
            field: 'costDevelopment',
            requested: 0,
            approved: 0,
            rejected: 0,
            count: 0,
          },
          maintenance: {
            label: 'Palaikymas',
            field: 'costMaintenance',
            requested: 0,
            approved: 0,
            rejected: 0,
            count: 0,
          },
          modernization: {
            label: 'Modernizavimas',
            field: 'costModernization',
            requested: 0,
            approved: 0,
            rejected: 0,
            count: 0,
          },
          decommissioning: {
            label: 'Likvidavimas',
            field: 'costDecommissioning',
            requested: 0,
            approved: 0,
            rejected: 0,
            count: 0,
          },
        };

        for (const r of allRequests) {
          byStatus[r.status]++;
          const requestedAmt = totalRequestedFromRow(r);
          // Naudojam paraiškos `year` lauką (kuriai metams skirta), o ne sukūrimo datą.
          // Audit #8 (2026-05-19) — patikrinta, year filtras veikia teisingai
          // dėka issue #4 (PR #16): `createdYear` keista į `r.year` ir mainline,
          // ir per-tenant breakdown'e. Patvirtinti planai iš ateinančių metų
          // į einamųjų metų stats'ą nepatenka.
          if (r.year === year) {
            if (r.status in amountsByStatus) {
              amountsByStatus[r.status as keyof typeof amountsByStatus] +=
                r.status === 'APPROVED' && r.decisionGrantedAmount !== null
                  ? Number(r.decisionGrantedAmount)
                  : requestedAmt;
            }
            totalRequestedThisYear += requestedAmt;
            if (r.status === 'APPROVED' && r.decisionGrantedAmount !== null) {
              totalApprovedThisYear += Number(r.decisionGrantedAmount);
            }
            if (r.status === 'REJECTED') {
              totalRejectedThisYear += requestedAmt;
            }
            // Per-category breakdown — naudojam prašytas sumas iš laukų; patvirtintai
            // sumai naudojam proporciją (jei skirta != prašyta).
            const approvedRatio =
              r.status === 'APPROVED' && r.decisionGrantedAmount !== null && requestedAmt > 0
                ? Number(r.decisionGrantedAmount) / requestedAmt
                : r.status === 'APPROVED'
                  ? 1
                  : 0;
            for (const key of Object.keys(categoryAccumulator) as CostCategoryStats['key'][]) {
              const acc = categoryAccumulator[key];
              const value = Number(r[acc.field] ?? 0);
              if (value === 0) continue;
              acc.count += 1;
              acc.requested += value;
              if (r.status === 'APPROVED') {
                acc.approved += value * approvedRatio;
              } else if (r.status === 'REJECTED') {
                acc.rejected += value;
              }
            }
          }
        }

        // Users count — tik admin'ams
        let usersCount = 0;
        if (me.role === 'admin') {
          if (me.tenantIsApprover) {
            usersCount = await User.query().resultSize();
          } else {
            usersCount = await User.query().where('tenant_id', me.tenantId).resultSize();
          }
        }

        const stats: DashboardStats = {
          totalRequests: allRequests.length,
          byStatus,
          amountsByStatus,
          totalRequestedThisYear,
          totalApprovedThisYear,
          totalRejectedThisYear,
          usersCount,
        };

        const costCategories: CostCategoryStats[] = (
          Object.keys(categoryAccumulator) as CostCategoryStats['key'][]
        )
          .map((key) => {
            const acc = categoryAccumulator[key];
            return {
              key,
              label: acc.label,
              requested: Math.round(acc.requested * 100) / 100,
              approved: Math.round(acc.approved * 100) / 100,
              rejected: Math.round(acc.rejected * 100) / 100,
              count: acc.count,
            };
          })
          .filter((c) => c.requested > 0 || c.approved > 0 || c.rejected > 0);

        // ===== Actionable (submitter perspektyva) =====
        // RETURNED + DRAFT — top 5 naujausi
        let actionable: RequestDTO[] = [];
        if (!isApprover) {
          const rows = (await scopedRequestQuery(me)
            .withGraphFetched(
              '[tenant, createdByUser, decidedByUser, budgetCategory, fundingSourceType]',
            )
            .whereIn('requests.status', ['RETURNED', 'DRAFT'])
            .orderByRaw("CASE WHEN requests.status = 'RETURNED' THEN 0 ELSE 1 END")
            .orderBy('requests.updated_at', 'desc')
            .limit(5)) as RequestWithRels[];
          actionable = rows.map(toRequestDTO);
        }

        // ===== Pending review (AM perspektyva) =====
        let pendingReview: RequestDTO[] = [];
        if (isApprover) {
          const rows = (await scopedRequestQuery(me)
            .withGraphFetched(
              '[tenant, createdByUser, decidedByUser, budgetCategory, fundingSourceType]',
            )
            .where('requests.status', 'SUBMITTED')
            .orderBy('requests.submitted_at', 'asc')
            .limit(8)) as RequestWithRels[];
          pendingReview = rows.map(toRequestDTO);
        }

        // ===== Recent activity (komentarai + statuso pakeitimai) =====
        // 10 paskutinių komentarų visuose matomuose prašymuose
        const recentActivity: DashboardActivityItem[] = [];
        if (allRequests.length > 0) {
          const visibleIds = allRequests.map((r) => r.id);
          const comments = (await RequestComment.query()
            .whereIn('request_id', visibleIds)
            .withGraphFetched('[authorUser, request.tenant]')
            .orderBy('created_at', 'desc')
            .limit(10)) as CommentWithRels[];

          for (const c of comments) {
            if (!c.authorUser || !c.request || !c.request.tenant) continue;
            recentActivity.push({
              requestId: c.requestId,
              projectName: c.request.projectName,
              tenantCode: c.request.tenant.code,
              kind: c.kind,
              body: c.body,
              authorName: c.authorUser.fullName,
              authorRole: c.authorUser.role,
              createdAt: c.createdAt,
            });
          }
        }

        // ===== Per-tenant breakdown (approver rolėms) =====
        let perTenantBreakdown: DashboardPerTenantStats[] | undefined;
        if (isApprover) {
          const tenants = await Tenant.query().where('is_approver', false).orderBy('code');
          const visibleTenants =
            me.role === 'user' && me.amScopeOrgIds !== null
              ? tenants.filter((t) => me.amScopeOrgIds!.includes(t.id))
              : tenants;

          perTenantBreakdown = visibleTenants.map((t) => {
            const rowsForT = allRequests.filter((r) => r.tenantId === t.id);
            const bs = {
              DRAFT: 0,
              SUBMITTED: 0,
              RETURNED: 0,
              APPROVED: 0,
              REJECTED: 0,
              // Issue #9: neaktualūs (soft-archive).
              NEAKTUALU: 0,
            };
            let totalReq = 0;
            let totalApr = 0;
            // Per-tenant sumos (`totalReq`, `totalApr`) filtruojamos pagal `r.year === year`,
            // kad ateinančių metų planai nepatektų į einamųjų metų statistikas.
            // `bs` (byStatus) ir grąžinamas `total` apima visus metus — tai sąmoningai,
            // kad AM matytų pilną tenant'o veiklos vaizdą per visą gyvavimo laiką.
            for (const r of rowsForT) {
              bs[r.status]++;
              const y = r.year;
              if (y === year) {
                totalReq += totalRequestedFromRow(r);
                if (r.status === 'APPROVED' && r.decisionGrantedAmount !== null) {
                  totalApr += Number(r.decisionGrantedAmount);
                }
              }
            }
            return {
              tenantId: t.id,
              tenantCode: t.code,
              tenantName: t.name,
              total: rowsForT.length,
              byStatus: bs,
              totalRequested: totalReq,
              totalApproved: totalApr,
            };
          });
        }

        // ===== Monthly trend (12 mėn) =====
        // Skaičiuojam pateikimus (submitted_at) ir patvirtinimus (decided_at)
        const trendStart = new Date();
        trendStart.setMonth(trendStart.getMonth() - 11);
        trendStart.setDate(1);
        trendStart.setHours(0, 0, 0, 0);

        const months: string[] = [];
        for (let i = 0; i < 12; i++) {
          const d = new Date(trendStart);
          d.setMonth(d.getMonth() + i);
          months.push(d.toISOString().slice(0, 7)); // YYYY-MM
        }
        const submittedByMonth: Record<string, number> = Object.fromEntries(
          months.map((m) => [m, 0]),
        );
        const approvedByMonth: Record<string, number> = Object.fromEntries(
          months.map((m) => [m, 0]),
        );

        // Fetch detalė trendui
        if (allRequests.length > 0) {
          const ids = allRequests.map((r) => r.id);
          const fullRequests = (await scopedRequestQuery(me)
            .whereIn('requests.id', ids)
            .select(
              'requests.submitted_at',
              'requests.decided_at',
              'requests.status',
            )) as Request[];
          for (const r of fullRequests) {
            if (r.submittedAt) {
              const m = new Date(r.submittedAt).toISOString().slice(0, 7);
              if (m in submittedByMonth) submittedByMonth[m]!++;
            }
            if (r.decidedAt && r.status === 'APPROVED') {
              const m = new Date(r.decidedAt).toISOString().slice(0, 7);
              if (m in approvedByMonth) approvedByMonth[m]!++;
            }
          }
        }

        const monthlyTrend = months.map((m) => ({
          month: m,
          submitted: submittedByMonth[m] ?? 0,
          approved: approvedByMonth[m] ?? 0,
        }));

        // ===== Budget category stats (FVM Iter 10, P06 docx §3.4) =====
        // Agreguojam prašymus pagal `budget_category_id`. Į stats'ą TIK įtraukiami
        // prašymai su not-null `budgetCategoryId` — t.y. FVM-aware prašymai.
        // Pastaba: naudojam in-memory agregaciją iš jau užkrauto `allRequests`
        // dataset'o (konsistentiškai su costCategories logika) + atskira užklausa
        // ClassifierItem'ams (gauti code+name).
        const budgetCategoryAcc: Map<
          number,
          { totalRequestedCents: number; totalGrantedCents: number; count: number }
        > = new Map();
        for (const r of allRequests) {
          if (r.budgetCategoryId === null || r.budgetCategoryId === undefined) {
            // NULL budget_category_id — neįtraukiam (legacy/be-FVM prašymai).
            continue;
          }
          const requestedCents = toCents(totalRequestedFromRow(r));
          const grantedCents =
            r.status === 'APPROVED' && r.decisionGrantedAmount !== null
              ? toCents(r.decisionGrantedAmount)
              : 0;
          const existing = budgetCategoryAcc.get(r.budgetCategoryId) ?? {
            totalRequestedCents: 0,
            totalGrantedCents: 0,
            count: 0,
          };
          existing.totalRequestedCents += requestedCents;
          existing.totalGrantedCents += grantedCents;
          existing.count += 1;
          budgetCategoryAcc.set(r.budgetCategoryId, existing);
        }

        let budgetCategoryStats: BudgetCategoryStats[] = [];
        if (budgetCategoryAcc.size > 0) {
          const categoryIds = [...budgetCategoryAcc.keys()];
          const items = (await ClassifierItem.query().whereIn(
            'id',
            categoryIds,
          )) as ClassifierItem[];
          const itemsById = new Map(items.map((it) => [it.id, it]));
          budgetCategoryStats = categoryIds
            .map((id) => {
              const acc = budgetCategoryAcc.get(id)!;
              const item = itemsById.get(id);
              return {
                categoryItemId: id,
                categoryCode: item?.code ?? '',
                categoryName: item?.name ?? '',
                totalRequested: centsToAmount(acc.totalRequestedCents),
                totalGranted: centsToAmount(acc.totalGrantedCents),
                count: acc.count,
              };
            })
            // Stabilus sort'as — pagal code'ą (LT konvencija: alfabetiškai). Bus
            // konsistencija UI'ui ir testams.
            .sort((a, b) => a.categoryCode.localeCompare(b.categoryCode));
        }

        return {
          role: me.role,
          tenantIsApprover: me.tenantIsApprover,
          year,
          stats,
          actionable,
          pendingReview,
          recentActivity,
          perTenantBreakdown,
          monthlyTrend,
          costCategories,
          budgetCategoryStats,
        };
      },
    },

    /**
     * FVM Dashboard suvestinė (Iter 15, F15).
     *
     * Grąžina:
     *  - budgetTotals: agregatas per visus allocations year'e (planuota, faktinė,
     *    likutis, percentUsed + warning flag'ai)
     *  - topWarnings: top 5 BudgetWarningItem (allocation lygyje) — surūšiuoti
     *    pagal percentUsed desc, atrenkami su isWarning || isOver
     *  - upcomingDeadlines: projektai su pabaigosData per [now, now+30d];
     *    statusas NE 'baigta' ir NE 'uzdaryta'
     *  - activeProjectsCount + completedProjectsCount
     *  - totalSourcesCount + totalAllocationsCount
     *
     * Tenant scope (ADR-005):
     *  - AM admin: visi tenant'ai
     *  - AM user su scope: scope'o tenant'ai
     *  - Org user / admin: tik savo tenant'as
     *  - !canViewPayroll: DU expense'ai ir DU allocations excluded iš
     *    agregacijos (defense-in-depth)
     *
     * Params:
     *  - year (required): metai
     *  - tenantId (optional, AM admin only): filter konkrečiu tenant'u
     */
    fvmSummary: {
      params: {
        year: { type: 'number', integer: true, convert: true, min: 2000, max: 3000 },
        tenantId: {
          type: 'number',
          integer: true,
          optional: true,
          convert: true,
        },
      },
      async handler(
        ctx: Context<{ year: number; tenantId?: number }, AuthMeta>,
      ): Promise<FvmSummaryResponse> {
        const me = requireMe(ctx);
        const year = ctx.params.year;
        const tenantFilter = ctx.params.tenantId;

        // Institucijos pjūvis (tenantId) leidžiamas, jei vartotojas TĄ instituciją
        // mato pagal scope: AM admin — bet kurią; AM specialistas — savo scope
        // ribose; org — tik savą. Filtras taikomas kaip PAPILDOMAS intersect (žr.
        // scope funkcijas), todėl net be šio guard'o negalėtų praplėsti matomumo;
        // guard duoda aiškų 403 vietoj tylaus tuščio rezultato (ADR-005).
        if (tenantFilter !== undefined && !canAccessTenant(me, tenantFilter)) {
          throw new Errors.MoleculerClientError(
            'Nepasiekiama institucija filtrui',
            403,
            'TENANT_FILTER_FORBIDDEN',
          );
        }

        // ===== Helper'is — taikom tenant scope į BudgetAllocationV2 query =====
        // Patterns:
        //  - AM admin: jei tenantFilter — filtruoja per shared funding_sources;
        //    kitaip visi
        //  - AM user su scope=null: visi
        //  - AM user su scope=[ids]: tik scope tenant'ai
        //  - Org admin/user: tik savo tenant'as
        // Kiekviena scope funkcija: (1) bazinis role scope, (2) PAPILDOMAS
        // institucijos pjūvis (tenantFilter) kaip INTERSECT — gali tik susiaurinti,
        // niekada nepraplėsti (saugu visoms rolėms; guard jau patikrino matomumą).
        function applyAllocationTenantScope(
          q: ReturnType<typeof BudgetAllocationV2.query>,
        ): 'empty' | 'ok' {
          if (me.tenantIsApprover) {
            if (me.role !== 'admin') {
              // AM specialistas
              if (me.amScopeOrgIds !== null) {
                if (me.amScopeOrgIds.length === 0) return 'empty';
                q.whereExists((qb) => {
                  qb.from('funding_sources')
                    .whereRaw('funding_sources.id = budget_allocations_v2.funding_source_id')
                    .whereIn('funding_sources.tenant_id', me.amScopeOrgIds!);
                });
              }
            }
          } else {
            // Org admin / org user
            q.whereExists((qb) => {
              qb.from('funding_sources')
                .whereRaw('funding_sources.id = budget_allocations_v2.funding_source_id')
                .where('funding_sources.tenant_id', me.tenantId);
            });
          }
          if (tenantFilter !== undefined) {
            q.whereExists((qb) => {
              qb.from('funding_sources')
                .whereRaw('funding_sources.id = budget_allocations_v2.funding_source_id')
                .where('funding_sources.tenant_id', tenantFilter);
            });
          }
          return 'ok';
        }

        function applyFundingSourceTenantScope(
          q: ReturnType<typeof FundingSource.query>,
        ): 'empty' | 'ok' {
          if (me.tenantIsApprover) {
            if (me.role !== 'admin') {
              if (me.amScopeOrgIds !== null) {
                if (me.amScopeOrgIds.length === 0) return 'empty';
                q.whereIn('tenant_id', me.amScopeOrgIds);
              }
            }
          } else {
            q.where('tenant_id', me.tenantId);
          }
          if (tenantFilter !== undefined) {
            q.where('tenant_id', tenantFilter);
          }
          return 'ok';
        }

        function applyProjectTenantScope(q: ReturnType<typeof Project.query>): 'empty' | 'ok' {
          if (me.tenantIsApprover) {
            if (me.role !== 'admin') {
              if (me.amScopeOrgIds !== null) {
                if (me.amScopeOrgIds.length === 0) return 'empty';
                q.whereIn('projects.tenant_id', me.amScopeOrgIds);
              }
            }
          } else {
            q.where('projects.tenant_id', me.tenantId);
          }
          if (tenantFilter !== undefined) {
            q.where('projects.tenant_id', tenantFilter);
          }
          return 'ok';
        }

        // ===== Allocations + warnings =====
        const allocQ = BudgetAllocationV2.query()
          .withGraphFetched('fundingSource')
          .where('budget_allocations_v2.metai', year);
        const allocScope = applyAllocationTenantScope(allocQ);

        // ADR-005 (defense-in-depth): DU allocations paslepiam ne-DU
        // vartotojams.
        if (!canViewPayroll(me)) {
          allocQ.whereNotExists((qb) => {
            qb.from('classifier_items')
              .whereRaw('classifier_items.id = budget_allocations_v2.category_classifier_item_id')
              .where('classifier_items.code', 'du');
          });
        }

        const allocations =
          allocScope === 'empty'
            ? []
            : ((await allocQ) as Array<BudgetAllocationV2 & { fundingSource?: FundingSource }>);

        // Faktinė per allocations vienoje GROUP BY užklausoje.
        const allocationIds = allocations.map((a) => a.id);
        const faktineByAllocation = new Map<number, number>();
        if (allocationIds.length > 0) {
          const expenseQ = Expense.query()
            .select('budget_allocation_id')
            .sum('suma as total')
            .whereIn('budget_allocation_id', allocationIds)
            .groupBy('budget_allocation_id');
          // ADR-005: defense-in-depth — DU expense'ai neįskaitomi ne-DU
          // vartotojams.
          if (!canViewPayroll(me)) {
            expenseQ.whereNot('expenses.tipas', 'du');
          }
          const expenseRows = (await expenseQ) as unknown as Array<{
            budgetAllocationId: number;
            total: string | null;
          }>;
          for (const row of expenseRows) {
            faktineByAllocation.set(row.budgetAllocationId, toCents(row.total));
          }
        }

        const allocationItems: BudgetWarningItem[] = allocations.map((alloc) => {
          const planuotaCents = toCents(alloc.planuotaSuma);
          const faktineCents = faktineByAllocation.get(alloc.id) ?? 0;
          const likutisCents = planuotaCents - faktineCents;
          const percentUsed = calculatePercentUsed(planuotaCents, faktineCents);
          const flags = calculateWarningFlags(percentUsed);
          return {
            allocationId: alloc.id,
            allocationName: alloc.pavadinimas,
            fundingSourceName: alloc.fundingSource?.pavadinimas ?? '',
            planuota: centsToAmount(planuotaCents),
            faktine: centsToAmount(faktineCents),
            likutis: centsToAmount(likutisCents),
            percentUsed,
            isWarning: flags.isWarning,
            isOver: flags.isOver,
          };
        });

        // Agregavimas — bendras planuota + faktinė per visus allocations
        let totalPlanuotaCents = 0;
        let totalFaktineCents = 0;
        for (const item of allocationItems) {
          totalPlanuotaCents += toCents(item.planuota);
          totalFaktineCents += toCents(item.faktine);
        }
        const totalLikutisCents = totalPlanuotaCents - totalFaktineCents;
        const totalPercentUsed = calculatePercentUsed(totalPlanuotaCents, totalFaktineCents);
        const totalFlags = calculateWarningFlags(totalPercentUsed);

        // Top 5 warning'ai — tik tie su isWarning || isOver, surūšiuoti
        // percentUsed desc.
        const topWarnings = allocationItems
          .filter((i) => i.isWarning || i.isOver)
          .sort((a, b) => b.percentUsed - a.percentUsed)
          .slice(0, 5);

        // ===== Upcoming deadlines (next 30d) =====
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const horizon = new Date(now);
        horizon.setDate(horizon.getDate() + 30);
        const horizonStr = horizon.toISOString().slice(0, 10);

        const deadlineQ = Project.query()
          .where('projects.pabaigos_data', '>=', today)
          .andWhere('projects.pabaigos_data', '<=', horizonStr)
          .whereNotIn('projects.statusas', ['baigta', 'uzdaryta'])
          .orderBy('projects.pabaigos_data', 'asc');
        const deadlineScope = applyProjectTenantScope(deadlineQ);
        // ADR-005: DU sistemos projektai paslepiami ne-DU vartotojams.
        if (!canViewPayroll(me)) {
          deadlineQ.where('projects.is_du_system', false);
        }

        const deadlineProjects = deadlineScope === 'empty' ? [] : ((await deadlineQ) as Project[]);

        const upcomingDeadlines: UpcomingDeadline[] = deadlineProjects
          .filter((p) => p.pabaigosData !== null)
          .map((p) => {
            // pabaigosData YYYY-MM-DD; daysUntil — sveika dienų skirtumas
            const target = new Date(`${p.pabaigosData}T00:00:00Z`);
            const todayUtc = new Date(`${today}T00:00:00Z`);
            const diffMs = target.getTime() - todayUtc.getTime();
            const daysUntil = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            return {
              type: 'project_end' as const,
              id: p.id,
              name: p.pavadinimas,
              date: p.pabaigosData!,
              daysUntil,
            };
          });

        // ===== Projects count (active + completed) =====
        const activeQ = Project.query()
          .whereIn('projects.statusas', ['planuojama', 'vykdoma'])
          .resultSize();
        const completedQ = Project.query()
          .whereIn('projects.statusas', ['baigta', 'uzdaryta'])
          .resultSize();
        // Tenant scope applied through query builder — call apply with same.
        // resultSize() grąžina Promise<number>, bet builder modifikuojamas
        // prieš tai — pasinaudojam tuo, kad applyProjectTenantScope grąžina
        // 'empty'/'ok', o builder mutacijos atliekamos tuo pačiu metu su
        // resultSize Promise grandinėle.
        // Praktikoje paprastai pratęsime per kopiją:
        const activeQBuilder = Project.query().whereIn('projects.statusas', [
          'planuojama',
          'vykdoma',
        ]);
        const activeScope = applyProjectTenantScope(activeQBuilder);
        if (!canViewPayroll(me)) {
          activeQBuilder.where('projects.is_du_system', false);
        }

        const completedQBuilder = Project.query().whereIn('projects.statusas', [
          'baigta',
          'uzdaryta',
        ]);
        const completedScope = applyProjectTenantScope(completedQBuilder);
        if (!canViewPayroll(me)) {
          completedQBuilder.where('projects.is_du_system', false);
        }

        const [activeProjectsCount, completedProjectsCount] = await Promise.all([
          activeScope === 'empty' ? Promise.resolve(0) : activeQBuilder.resultSize(),
          completedScope === 'empty' ? Promise.resolve(0) : completedQBuilder.resultSize(),
        ]);
        // Pridėtoji `activeQ` / `completedQ` viršuje liko nenaudojama (palikta
        // dėl noise — Promise.all'inam tik builder'ius).
        void activeQ;
        void completedQ;

        // ===== Sources + allocations count =====
        const sourcesQB = FundingSource.query().where('metai', year);
        const sourcesScope = applyFundingSourceTenantScope(sourcesQB);

        const allocationsCountQB = BudgetAllocationV2.query().where(
          'budget_allocations_v2.metai',
          year,
        );
        const allocationsCountScope = applyAllocationTenantScope(allocationsCountQB);
        if (!canViewPayroll(me)) {
          allocationsCountQB.whereNotExists((qb) => {
            qb.from('classifier_items')
              .whereRaw('classifier_items.id = budget_allocations_v2.category_classifier_item_id')
              .where('classifier_items.code', 'du');
          });
        }

        const [totalSourcesCount, totalAllocationsCount] = await Promise.all([
          sourcesScope === 'empty' ? Promise.resolve(0) : sourcesQB.resultSize(),
          allocationsCountScope === 'empty' ? Promise.resolve(0) : allocationsCountQB.resultSize(),
        ]);

        return {
          year,
          generatedAt: new Date().toISOString(),
          budgetTotals: {
            planuota: centsToAmount(totalPlanuotaCents),
            faktine: centsToAmount(totalFaktineCents),
            likutis: centsToAmount(totalLikutisCents),
            percentUsed: totalPercentUsed,
            isWarning: totalFlags.isWarning,
            isOver: totalFlags.isOver,
          },
          topWarnings,
          upcomingDeadlines,
          activeProjectsCount,
          completedProjectsCount,
          totalSourcesCount,
          totalAllocationsCount,
        };
      },
    },
  },
};

export default DashboardService;
