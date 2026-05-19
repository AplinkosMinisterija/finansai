/**
 * Atsiskaitymų servisas (issue #2).
 *
 * Prielaidos (Giedrei testuojant — pataisys):
 *  - Vienas atsiskaitymas per (request, year, quarter) — unique constraint.
 *  - Teikėjas pats inicijuoja per UI (DRAFT → submit).
 *  - „Vykdomi" = APPROVED statuso prašymai.
 *  - AM mato visus per scope, gali komentuoti per request_comments.
 *
 * Permissions:
 *  - list/get: tas pats kaip canView (per request).
 *  - upsert/submit/delete: teikėjas iš tos tenant arba AM admin „on behalf".
 *    AM tvirtintojai (kiti) NEgali kurti — tik matyti.
 */
import type { ServiceSchema, Context } from 'moleculer';
import { Errors } from 'moleculer';
import type {
  RequestReport as ReportDTO,
  RequestReportUpsertRequest,
} from '@biip-finansai/shared';
import { Request } from '../models/Request';
import type { RequestStatus } from '../models/Request';
import { RequestReport } from '../models/RequestReport';
import { normalizeAmount } from '../utils/money';
import { canViewRequest } from '../utils/permissions';
import type { AuthMeta } from './auth.service';
import type { User } from '../models/User';

interface ReportWithUser extends RequestReport {
  submittedByUser?: User;
}

function toDTO(r: ReportWithUser): ReportDTO {
  return {
    id: r.id,
    requestId: r.requestId,
    periodYear: r.periodYear,
    periodQuarter: r.periodQuarter,
    amountUsed: String(r.amountUsed),
    description: r.description,
    status: r.status,
    submittedByUserId: r.submittedByUserId,
    submittedByName: r.submittedByUser?.fullName,
    submittedAt: r.submittedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function requireMe(ctx: Context<unknown, AuthMeta>): NonNullable<AuthMeta['user']> {
  if (!ctx.meta.user) {
    throw new Errors.MoleculerClientError('Neautentifikuota', 401, 'AUTH_REQUIRED');
  }
  return ctx.meta.user;
}

function canManageReport(
  viewer: NonNullable<AuthMeta['user']>,
  r: { tenantId: number; createdByUserId: number; status: RequestStatus },
): boolean {
  // AM admin gali „on behalf" — bet praktiškai retai. Pradžiai leidžiama.
  if (viewer.tenantIsApprover) return viewer.role === 'admin';
  if (r.tenantId !== viewer.tenantId) return false;
  if (viewer.role === 'admin') return true;
  return r.createdByUserId === viewer.id;
}

const RequestReportsService: ServiceSchema = {
  name: 'requestReports',

  actions: {
    list: {
      params: { requestId: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ requestId: number }, AuthMeta>): Promise<ReportDTO[]> {
        const me = requireMe(ctx);
        const r = await Request.query().findById(ctx.params.requestId);
        if (!r) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        if (!canViewRequest(me, { tenantId: r.tenantId, createdByUserId: r.createdByUserId, status: r.status })) {
          throw new Errors.MoleculerClientError('Neturite teisės', 403, 'FORBIDDEN');
        }
        const rows = (await RequestReport.query()
          .where('request_id', r.id)
          .withGraphFetched('submittedByUser')
          .orderBy([
            { column: 'period_year', order: 'desc' },
            { column: 'period_quarter', order: 'desc', nulls: 'last' },
          ])) as ReportWithUser[];
        return rows.map(toDTO);
      },
    },

    upsert: {
      params: {
        requestId: { type: 'number', integer: true, convert: true },
        periodYear: { type: 'number', integer: true, convert: true },
        periodQuarter: { type: 'number', integer: true, optional: true, nullable: true, convert: true },
        amountUsed: { type: 'any' },
        description: { type: 'string', optional: true, nullable: true, max: 4000 },
      },
      async handler(
        ctx: Context<{ requestId: number } & RequestReportUpsertRequest, AuthMeta>,
      ): Promise<ReportDTO> {
        const me = requireMe(ctx);
        const r = await Request.query().findById(ctx.params.requestId);
        if (!r) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        if (r.status !== 'APPROVED') {
          throw new Errors.MoleculerClientError(
            'Atsiskaitymą galima pateikti tik patvirtintam prašymui',
            400,
            'REQUEST_NOT_APPROVED',
          );
        }
        if (!canManageReport(me, { tenantId: r.tenantId, createdByUserId: r.createdByUserId, status: r.status })) {
          throw new Errors.MoleculerClientError('Neturite teisės', 403, 'FORBIDDEN');
        }
        const p = ctx.params;
        if (p.periodQuarter !== null && p.periodQuarter !== undefined) {
          if (p.periodQuarter < 1 || p.periodQuarter > 4) {
            throw new Errors.MoleculerClientError(
              'Ketvirtis turi būti tarp 1 ir 4 (arba praleisti — metinis)',
              400,
              'INVALID_QUARTER',
            );
          }
        }
        const existing = await RequestReport.query()
          .where({
            request_id: r.id,
            period_year: p.periodYear,
            period_quarter: p.periodQuarter ?? null,
          })
          .first();
        if (existing) {
          if (existing.status === 'SUBMITTED') {
            throw new Errors.MoleculerClientError(
              'Šio periodo atsiskaitymas jau pateiktas — neredaguojamas',
              400,
              'REPORT_LOCKED',
            );
          }
          await RequestReport.query().findById(existing.id).patch({
            amountUsed: normalizeAmount(p.amountUsed),
            description: p.description ?? null,
          });
          const full = (await RequestReport.query()
            .findById(existing.id)
            .withGraphFetched('submittedByUser')) as ReportWithUser | undefined;
          if (!full) throw new Error('Updated report not found');
          return toDTO(full);
        }
        const inserted = await RequestReport.query().insert({
          requestId: r.id,
          periodYear: p.periodYear,
          periodQuarter: p.periodQuarter ?? null,
          amountUsed: normalizeAmount(p.amountUsed),
          description: p.description ?? null,
          status: 'DRAFT',
          submittedByUserId: me.id,
        });
        const full = (await RequestReport.query()
          .findById(inserted.id)
          .withGraphFetched('submittedByUser')) as ReportWithUser | undefined;
        if (!full) throw new Error('Inserted report not found');
        return toDTO(full);
      },
    },

    submit: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<ReportDTO> {
        const me = requireMe(ctx);
        const report = await RequestReport.query().findById(ctx.params.id);
        if (!report) {
          throw new Errors.MoleculerClientError('Atsiskaitymas nerastas', 404, 'REPORT_NOT_FOUND');
        }
        const r = await Request.query().findById(report.requestId);
        if (!r) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        if (!canManageReport(me, { tenantId: r.tenantId, createdByUserId: r.createdByUserId, status: r.status })) {
          throw new Errors.MoleculerClientError('Neturite teisės', 403, 'FORBIDDEN');
        }
        if (report.status === 'SUBMITTED') {
          throw new Errors.MoleculerClientError('Jau pateiktas', 400, 'ALREADY_SUBMITTED');
        }
        await RequestReport.query().findById(report.id).patch({
          status: 'SUBMITTED',
          submittedAt: new Date().toISOString(),
          submittedByUserId: me.id,
        });
        const full = (await RequestReport.query()
          .findById(report.id)
          .withGraphFetched('submittedByUser')) as ReportWithUser | undefined;
        if (!full) throw new Error('Submitted report not found');
        return toDTO(full);
      },
    },

    delete: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<{ ok: true }> {
        const me = requireMe(ctx);
        const report = await RequestReport.query().findById(ctx.params.id);
        if (!report) {
          throw new Errors.MoleculerClientError('Atsiskaitymas nerastas', 404, 'REPORT_NOT_FOUND');
        }
        if (report.status === 'SUBMITTED') {
          throw new Errors.MoleculerClientError(
            'Pateiktas atsiskaitymas neištrinamas',
            400,
            'ALREADY_SUBMITTED',
          );
        }
        const r = await Request.query().findById(report.requestId);
        if (!r) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        if (!canManageReport(me, { tenantId: r.tenantId, createdByUserId: r.createdByUserId, status: r.status })) {
          throw new Errors.MoleculerClientError('Neturite teisės', 403, 'FORBIDDEN');
        }
        await RequestReport.query().deleteById(report.id);
        return { ok: true };
      },
    },
  },
};

export default RequestReportsService;
