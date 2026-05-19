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
  CostCategoryStats,
  DashboardActivityItem,
  DashboardData,
  DashboardPerTenantStats,
  DashboardStats,
  FinancingRequest as RequestDTO,
} from '@biip-finansai/shared';
import { Request } from '../models/Request';
import { RequestComment } from '../models/RequestComment';
import { Tenant } from '../models/Tenant';
import { User } from '../models/User';
import type { AuthMeta } from './auth.service';

interface RequestWithRels extends Request {
  tenant?: Tenant;
  createdByUser?: User;
  decidedByUser?: User;
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
    decisionGrantedAmount: r.decisionGrantedAmount === null ? null : String(r.decisionGrantedAmount),
    decisionFundingSource: r.decisionFundingSource,
    decisionProtocol: r.decisionProtocol,
    decisionOrder: r.decisionOrder,
    decidedAt: r.decidedAt,
    decidedByUserId: r.decidedByUserId,
    decidedByName: r.decidedByUser?.fullName ?? null,
    submittedAt: r.submittedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function totalRequestedFromRow(r: Request): number {
  return (
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
        const allRequests = (await scopedRequestQuery(me).select(
          'requests.id',
          'requests.status',
          'requests.tenant_id',
          'requests.cost_equipment',
          'requests.cost_creation',
          'requests.cost_analysis',
          'requests.cost_development',
          'requests.cost_maintenance',
          'requests.cost_modernization',
          'requests.cost_decommissioning',
          'requests.decision_granted_amount',
          'requests.created_at',
        )) as Request[];

        const byStatus = {
          DRAFT: 0,
          SUBMITTED: 0,
          RETURNED: 0,
          APPROVED: 0,
          REJECTED: 0,
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
          { label: string; field: keyof Request; requested: number; approved: number; rejected: number; count: number }
        > = {
          du: { label: 'DU / Atlyginimai', field: 'costDu', requested: 0, approved: 0, rejected: 0, count: 0 },
          equipment: {
            label: 'Įranga / licencijos',
            field: 'costEquipment',
            requested: 0,
            approved: 0,
            rejected: 0,
            count: 0,
          },
          creation: { label: 'Kūrimas', field: 'costCreation', requested: 0, approved: 0, rejected: 0, count: 0 },
          analysis: { label: 'Analizė', field: 'costAnalysis', requested: 0, approved: 0, rejected: 0, count: 0 },
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
          if (r.status in amountsByStatus) {
            amountsByStatus[r.status as keyof typeof amountsByStatus] +=
              r.status === 'APPROVED' && r.decisionGrantedAmount !== null
                ? Number(r.decisionGrantedAmount)
                : requestedAmt;
          }
          const createdYear = new Date(r.createdAt).getFullYear();
          if (createdYear === year) {
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
            .withGraphFetched('[tenant, createdByUser, decidedByUser]')
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
            .withGraphFetched('[tenant, createdByUser, decidedByUser]')
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
            };
            let totalReq = 0;
            let totalApr = 0;
            for (const r of rowsForT) {
              bs[r.status]++;
              const y = new Date(r.createdAt).getFullYear();
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
        const submittedByMonth: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));
        const approvedByMonth: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));

        // Fetch detalė trendui
        if (allRequests.length > 0) {
          const ids = allRequests.map((r) => r.id);
          const fullRequests = (await scopedRequestQuery(me)
            .whereIn('requests.id', ids)
            .select('requests.submitted_at', 'requests.decided_at', 'requests.status')) as Request[];
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
        };
      },
    },
  },
};

export default DashboardService;
