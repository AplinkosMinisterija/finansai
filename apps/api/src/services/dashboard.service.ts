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
  if (me.role === 'org_admin') {
    q.where('requests.tenant_id', me.tenantId);
  } else if (me.role === 'org_user') {
    q.where('requests.tenant_id', me.tenantId).andWhere('requests.created_by_user_id', me.id);
  } else if (me.role === 'am_user' && me.amScopeOrgIds !== null) {
    if (me.amScopeOrgIds.length === 0) {
      q.whereRaw('FALSE');
    } else {
      q.whereIn('requests.tenant_id', me.amScopeOrgIds);
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
        const isAmRole = me.role === 'am_admin' || me.role === 'am_user';
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
        let totalRequestedThisYear = 0;
        let totalApprovedThisYear = 0;

        for (const r of allRequests) {
          byStatus[r.status]++;
          const createdYear = new Date(r.createdAt).getFullYear();
          if (createdYear === year) {
            totalRequestedThisYear += totalRequestedFromRow(r);
            if (r.status === 'APPROVED' && r.decisionGrantedAmount !== null) {
              totalApprovedThisYear += Number(r.decisionGrantedAmount);
            }
          }
        }

        // Users count — tik admin'ams
        let usersCount = 0;
        if (me.role === 'am_admin') {
          const result = await User.query().resultSize();
          usersCount = result;
        } else if (me.role === 'org_admin') {
          usersCount = await User.query().where('tenant_id', me.tenantId).resultSize();
        }

        const stats: DashboardStats = {
          totalRequests: allRequests.length,
          byStatus,
          totalRequestedThisYear,
          totalApprovedThisYear,
          usersCount,
        };

        // ===== Actionable (submitter perspektyva) =====
        // RETURNED + DRAFT — top 5 naujausi
        let actionable: RequestDTO[] = [];
        if (!isAmRole) {
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
        if (isAmRole) {
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

        // ===== Per-tenant breakdown (AM rolėms) =====
        let perTenantBreakdown: DashboardPerTenantStats[] | undefined;
        if (isAmRole) {
          const tenants = await Tenant.query().where('code', '!=', 'AM').orderBy('code');
          const visibleTenants =
            me.role === 'am_user' && me.amScopeOrgIds !== null
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

        return {
          role: me.role,
          year,
          stats,
          actionable,
          pendingReview,
          recentActivity,
          perTenantBreakdown,
        };
      },
    },
  },
};

export default DashboardService;
