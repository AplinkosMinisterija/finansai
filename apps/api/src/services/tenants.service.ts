/**
 * Tenants servisas — organizacijos.
 *
 * - list: visi (read-only)
 * - get: visi (read-only)
 * - create/update/delete: tik aprover tenant'o `admin` (AM admin)
 */
import type { ServiceSchema, Context } from 'moleculer';
import { Errors } from 'moleculer';
import type {
  Tenant as TenantDTO,
  TenantCreateRequest,
  TenantUpdateRequest,
} from '@biip-finansai/shared';
import { Tenant } from '../models/Tenant';
import { User } from '../models/User';
import { Request } from '../models/Request';
import type { AuthMeta } from './auth.service';

function toDTO(t: Tenant, counts?: { users: number; requests: number }): TenantDTO {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    isApprover: t.isApprover,
    active: t.active,
    usersCount: counts?.users,
    requestsCount: counts?.requests,
  };
}

function requireMe(ctx: Context<unknown, AuthMeta>): NonNullable<AuthMeta['user']> {
  if (!ctx.meta.user) {
    throw new Errors.MoleculerClientError('Neautentifikuota', 401, 'AUTH_REQUIRED');
  }
  return ctx.meta.user;
}

function requireSuperAdmin(me: NonNullable<AuthMeta['user']>): void {
  if (!me.tenantIsApprover || me.role !== 'admin') {
    throw new Errors.MoleculerClientError(
      'Šis veiksmas leidžiamas tik AM administratoriui',
      403,
      'FORBIDDEN',
    );
  }
}

const TenantsService: ServiceSchema = {
  name: 'tenants',

  actions: {
    list: {
      params: {
        withCounts: { type: 'boolean', optional: true, convert: true, default: false },
      },
      async handler(ctx: Context<{ withCounts?: boolean }, AuthMeta>): Promise<TenantDTO[]> {
        const tenants = await Tenant.query().orderByRaw('is_approver DESC, code ASC');
        if (!ctx.params.withCounts) {
          return tenants.map((t) => toDTO(t));
        }
        // Skaičiukai per tenant — paprasti agreguoti query'iai
        const userCounts = (await User.query()
          .select('tenant_id')
          .count('* as count')
          .groupBy('tenant_id')) as unknown as Array<{ tenantId: number; count: string }>;
        const requestCounts = (await Request.query()
          .select('tenant_id')
          .count('* as count')
          .groupBy('tenant_id')) as unknown as Array<{ tenantId: number; count: string }>;
        const userMap = new Map(userCounts.map((c) => [c.tenantId, Number(c.count)]));
        const requestMap = new Map(requestCounts.map((c) => [c.tenantId, Number(c.count)]));
        return tenants.map((t) =>
          toDTO(t, {
            users: userMap.get(t.id) ?? 0,
            requests: requestMap.get(t.id) ?? 0,
          }),
        );
      },
    },

    get: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }>): Promise<TenantDTO> {
        const t = await Tenant.query().findById(ctx.params.id);
        if (!t) {
          throw new Errors.MoleculerClientError('Organizacija nerasta', 404, 'TENANT_NOT_FOUND');
        }
        return toDTO(t);
      },
    },

    create: {
      params: {
        code: { type: 'string', min: 1, max: 32 },
        name: { type: 'string', min: 1, max: 200 },
        description: { type: 'string', optional: true, nullable: true, max: 2000 },
        isApprover: { type: 'boolean', optional: true, default: false },
        active: { type: 'boolean', optional: true, default: true },
      },
      async handler(ctx: Context<TenantCreateRequest, AuthMeta>): Promise<TenantDTO> {
        const me = requireMe(ctx);
        requireSuperAdmin(me);
        const p = ctx.params;
        const exists = await Tenant.query().findOne({ code: p.code });
        if (exists) {
          throw new Errors.MoleculerClientError(
            'Tokio kodo organizacija jau egzistuoja',
            409,
            'TENANT_CODE_TAKEN',
          );
        }
        const inserted = await Tenant.query().insert({
          code: p.code,
          name: p.name,
          description: p.description ?? null,
          isApprover: p.isApprover ?? false,
          active: p.active ?? true,
        });
        return toDTO(inserted);
      },
    },

    update: {
      params: {
        id: { type: 'number', integer: true, convert: true },
        code: { type: 'string', optional: true, min: 1, max: 32 },
        name: { type: 'string', optional: true, min: 1, max: 200 },
        description: { type: 'string', optional: true, nullable: true, max: 2000 },
        isApprover: { type: 'boolean', optional: true },
        active: { type: 'boolean', optional: true },
      },
      async handler(
        ctx: Context<TenantUpdateRequest & { id: number }, AuthMeta>,
      ): Promise<TenantDTO> {
        const me = requireMe(ctx);
        requireSuperAdmin(me);
        const target = await Tenant.query().findById(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError('Organizacija nerasta', 404, 'TENANT_NOT_FOUND');
        }
        const p = ctx.params;
        if (p.code !== undefined && p.code !== target.code) {
          const exists = await Tenant.query().findOne({ code: p.code });
          if (exists) {
            throw new Errors.MoleculerClientError(
              'Tokio kodo organizacija jau egzistuoja',
              409,
              'TENANT_CODE_TAKEN',
            );
          }
        }
        const patch: Record<string, unknown> = {};
        if (p.code !== undefined) patch['code'] = p.code;
        if (p.name !== undefined) patch['name'] = p.name;
        if (p.description !== undefined) patch['description'] = p.description;
        if (p.isApprover !== undefined) patch['isApprover'] = p.isApprover;
        if (p.active !== undefined) patch['active'] = p.active;
        await Tenant.query().findById(target.id).patch(patch);
        const updated = await Tenant.query().findById(target.id);
        if (!updated) throw new Error('Updated tenant not found');
        return toDTO(updated);
      },
    },

    delete: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<{ ok: true }> {
        const me = requireMe(ctx);
        requireSuperAdmin(me);
        const target = await Tenant.query().findById(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError('Organizacija nerasta', 404, 'TENANT_NOT_FOUND');
        }
        if (target.id === me.tenantId) {
          throw new Errors.MoleculerClientError(
            'Negalima ištrinti savo organizacijos',
            400,
            'CANNOT_DELETE_OWN',
          );
        }
        const hasUsers = await User.query().where('tenant_id', target.id).resultSize();
        if (hasUsers > 0) {
          throw new Errors.MoleculerClientError(
            'Organizacijoje yra vartotojų — pirma juos perkelkite ar ištrinkite',
            409,
            'TENANT_HAS_USERS',
          );
        }
        const hasRequests = await Request.query().where('tenant_id', target.id).resultSize();
        if (hasRequests > 0) {
          throw new Errors.MoleculerClientError(
            'Organizacija turi prašymų — ištrynimas negalimas',
            409,
            'TENANT_HAS_REQUESTS',
          );
        }
        await Tenant.query().deleteById(target.id);
        return { ok: true };
      },
    },
  },
};

export default TenantsService;
