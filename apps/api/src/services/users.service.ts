/**
 * Users servisas — CRUD su role+tenant scope.
 *
 * Modelis: rolės yra tik `admin` ir `user`. Faktinę galią suteikia tenant'as:
 *
 * | Tenant            | admin                                  | user                                  |
 * |-------------------|----------------------------------------|---------------------------------------|
 * | is_approver=true  | visi vartotojai, AM vartotojų CRUD    | AM vartotojai (read-only)             |
 * | is_approver=false | savo tenant vartotojų CRUD             | tik save (read-only)                  |
 */
import type { ServiceSchema, Context } from 'moleculer';
import { Errors } from 'moleculer';
import bcrypt from 'bcryptjs';
import type {
  PaginatedResponse,
  User as UserDTO,
  UserCreateRequest,
  UserListQuery,
  UserUpdateRequest,
} from '@biip-finansai/shared';
import { User } from '../models/User';
import { Tenant } from '../models/Tenant';
import type { AuthMeta } from './auth.service';

interface UserWithTenant extends User {
  tenant?: Tenant;
}

function toDTO(u: UserWithTenant): UserDTO {
  const tenant = u.tenant;
  if (!tenant) {
    throw new Error(`User ${u.id} loaded without tenant`);
  }
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    email: u.email,
    role: u.role,
    tenantId: u.tenantId,
    tenantCode: tenant.code,
    tenantName: tenant.name,
    tenantIsApprover: tenant.isApprover,
    amScopeOrgIds: u.amScopeOrgIds,
    active: u.active,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

function requireMe(ctx: Context<unknown, AuthMeta>): NonNullable<AuthMeta['user']> {
  if (!ctx.meta.user) {
    throw new Errors.MoleculerClientError('Neautentifikuota', 401, 'AUTH_REQUIRED');
  }
  return ctx.meta.user;
}

async function loadUser(id: number): Promise<UserWithTenant | undefined> {
  const u = await User.query().findById(id).withGraphFetched('tenant');
  return u as UserWithTenant | undefined;
}

/** Įvertina, ar `viewer` mato `target` user'į (list/get). */
function canView(viewer: NonNullable<AuthMeta['user']>, target: UserDTO): boolean {
  if (viewer.tenantIsApprover) {
    // AM admin = visi; AM user = AM + scope orgs (read-only)
    if (viewer.role === 'admin') return true;
    if (target.tenantIsApprover) return true; // mato visus AM (read-only)
    if (viewer.amScopeOrgIds === null) return true;
    return viewer.amScopeOrgIds.includes(target.tenantId);
  }
  // Pavaldi institucija
  if (target.tenantId !== viewer.tenantId) return false;
  if (viewer.role === 'admin') return true;
  return target.id === viewer.id;
}

/** Įvertina, ar `viewer` gali valdyti (create/update/delete) `target` user'į. */
function canManage(
  viewer: NonNullable<AuthMeta['user']>,
  target: { tenantId: number },
): boolean {
  if (viewer.role !== 'admin') return false;
  if (viewer.tenantIsApprover) {
    // AM admin — gali valdyti tik AM vartotojus
    // (pavaldžių org admin valdymas — pačios org admin atsakomybė)
    // Tačiau techniškai AM admin gali ir pavaldžių — leiskim
    return true;
  }
  // Org admin — tik savo tenant
  return target.tenantId === viewer.tenantId;
}

async function loadTenant(tenantId: number): Promise<Tenant | undefined> {
  return Tenant.query().findById(tenantId);
}

const UsersService: ServiceSchema = {
  name: 'users',

  actions: {
    list: {
      params: {
        q: { type: 'string', optional: true },
        tenantId: { type: 'number', integer: true, optional: true, convert: true },
        page: { type: 'number', integer: true, optional: true, default: 1, convert: true },
        pageSize: { type: 'number', integer: true, optional: true, default: 50, convert: true },
      },
      async handler(ctx: Context<UserListQuery, AuthMeta>): Promise<PaginatedResponse<UserDTO>> {
        const me = requireMe(ctx);
        const { q, tenantId } = ctx.params;
        const page = ctx.params.page ?? 1;
        const pageSize = Math.min(ctx.params.pageSize ?? 50, 200);

        const query = User.query().withGraphFetched('tenant').orderBy('users.id');

        // Scope pre-filter
        if (!me.tenantIsApprover) {
          query.where('users.tenant_id', me.tenantId);
        } else if (me.role === 'user') {
          // AM specialistas — AM vartotojai + scope orgs
          const amTenant = await Tenant.query().findOne({ isApprover: true });
          const visibleTenantIds: number[] = amTenant ? [amTenant.id] : [];
          if (me.amScopeOrgIds === null) {
            // nieko nefiltruojam — mato visus
          } else {
            visibleTenantIds.push(...me.amScopeOrgIds);
            query.whereIn('users.tenant_id', visibleTenantIds);
          }
        }

        if (q !== undefined && q.trim() !== '') {
          const like = `%${q.trim().toLowerCase()}%`;
          query.where((b) => {
            b.whereRaw('LOWER(users.username) LIKE ?', [like])
              .orWhereRaw('LOWER(users.full_name) LIKE ?', [like])
              .orWhereRaw('LOWER(COALESCE(users.email, \'\')) LIKE ?', [like]);
          });
        }
        if (tenantId !== undefined) {
          query.where('users.tenant_id', tenantId);
        }

        const total = await query.clone().resultSize();
        const items = (await query
          .offset((page - 1) * pageSize)
          .limit(pageSize)) as UserWithTenant[];

        // Org user — tik save
        const filtered =
          !me.tenantIsApprover && me.role === 'user'
            ? items.filter((u) => u.id === me.id)
            : items;

        return {
          items: filtered.map(toDTO),
          total: !me.tenantIsApprover && me.role === 'user' ? filtered.length : total,
          page,
          pageSize,
        };
      },
    },

    get: {
      params: {
        id: { type: 'number', integer: true, convert: true },
      },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<UserDTO> {
        const me = requireMe(ctx);
        const u = await loadUser(ctx.params.id);
        if (!u) {
          throw new Errors.MoleculerClientError('Vartotojas nerastas', 404, 'USER_NOT_FOUND');
        }
        const dto = toDTO(u);
        if (!canView(me, dto)) {
          throw new Errors.MoleculerClientError('Neturite teisės matyti šio vartotojo', 403, 'FORBIDDEN');
        }
        return dto;
      },
    },

    create: {
      params: {
        username: { type: 'string', min: 1, max: 64 },
        password: { type: 'string', min: 4, max: 200 },
        fullName: { type: 'string', min: 1, max: 200 },
        email: { type: 'string', optional: true, max: 200 },
        role: { type: 'enum', values: ['admin', 'user'] },
        tenantId: { type: 'number', integer: true, convert: true },
        amScopeOrgIds: { type: 'array', items: 'number', optional: true, nullable: true },
        active: { type: 'boolean', optional: true, default: true },
      },
      async handler(ctx: Context<UserCreateRequest, AuthMeta>): Promise<UserDTO> {
        const me = requireMe(ctx);
        const p = ctx.params;

        if (!canManage(me, { tenantId: p.tenantId })) {
          throw new Errors.MoleculerClientError('Neturite teisės kurti šio vartotojo', 403, 'FORBIDDEN');
        }

        const tenant = await loadTenant(p.tenantId);
        if (!tenant) {
          throw new Errors.MoleculerClientError('Organizacija nerasta', 400, 'TENANT_NOT_FOUND');
        }
        if (!tenant.active) {
          throw new Errors.MoleculerClientError('Organizacija neaktyvi', 400, 'TENANT_INACTIVE');
        }

        // Scope orgs aktualus tik approver tenant `user` rolei
        const amScope = tenant.isApprover && p.role === 'user' ? (p.amScopeOrgIds ?? null) : null;

        const exists = await User.query().findOne({ username: p.username });
        if (exists) {
          throw new Errors.MoleculerClientError('Vartotojo vardas jau egzistuoja', 409, 'USERNAME_TAKEN');
        }

        const passwordHash = await bcrypt.hash(p.password, 10);
        const inserted = await User.query().insert({
          username: p.username,
          passwordHash,
          fullName: p.fullName,
          email: p.email ?? null,
          role: p.role,
          tenantId: p.tenantId,
          amScopeOrgIds: amScope,
          active: p.active ?? true,
        });

        const full = await loadUser(inserted.id);
        if (!full) throw new Error('Inserted user not found');
        return toDTO(full);
      },
    },

    update: {
      params: {
        id: { type: 'number', integer: true, convert: true },
        username: { type: 'string', optional: true, min: 1, max: 64 },
        password: { type: 'string', optional: true, min: 4, max: 200 },
        fullName: { type: 'string', optional: true, min: 1, max: 200 },
        email: { type: 'string', optional: true, nullable: true, max: 200 },
        role: { type: 'enum', optional: true, values: ['admin', 'user'] },
        tenantId: { type: 'number', integer: true, optional: true, convert: true },
        amScopeOrgIds: { type: 'array', items: 'number', optional: true, nullable: true },
        active: { type: 'boolean', optional: true },
      },
      async handler(ctx: Context<UserUpdateRequest & { id: number }, AuthMeta>): Promise<UserDTO> {
        const me = requireMe(ctx);
        const p = ctx.params;
        const target = await loadUser(p.id);
        if (!target) {
          throw new Errors.MoleculerClientError('Vartotojas nerastas', 404, 'USER_NOT_FOUND');
        }

        const targetTenantId = p.tenantId ?? target.tenantId;
        if (!canManage(me, { tenantId: targetTenantId }) || !canManage(me, { tenantId: target.tenantId })) {
          throw new Errors.MoleculerClientError('Neturite teisės redaguoti šio vartotojo', 403, 'FORBIDDEN');
        }

        const newTenantId = targetTenantId;
        const tenant = await loadTenant(newTenantId);
        if (!tenant) {
          throw new Errors.MoleculerClientError('Organizacija nerasta', 400, 'TENANT_NOT_FOUND');
        }

        const newRole = p.role ?? target.role;
        const patch: Record<string, unknown> = {};
        if (p.username !== undefined) patch['username'] = p.username;
        if (p.fullName !== undefined) patch['fullName'] = p.fullName;
        if (p.email !== undefined) patch['email'] = p.email;
        if (p.role !== undefined) patch['role'] = p.role;
        if (p.tenantId !== undefined) patch['tenantId'] = p.tenantId;
        if (p.active !== undefined) patch['active'] = p.active;

        // amScopeOrgIds reset'inam, jei tenant/role pakeitimas pakeičia jo aktualumą
        const scopeRelevant = tenant.isApprover && newRole === 'user';
        if (p.amScopeOrgIds !== undefined) {
          patch['amScopeOrgIds'] = scopeRelevant ? p.amScopeOrgIds : null;
        } else if (!scopeRelevant && target.amScopeOrgIds !== null) {
          // Jei scope tapo nebeaktualus — išvalom
          patch['amScopeOrgIds'] = null;
        }

        if (p.password !== undefined) {
          patch['passwordHash'] = await bcrypt.hash(p.password, 10);
        }

        if (p.username !== undefined && p.username !== target.username) {
          const exists = await User.query().findOne({ username: p.username });
          if (exists) {
            throw new Errors.MoleculerClientError('Vartotojo vardas jau egzistuoja', 409, 'USERNAME_TAKEN');
          }
        }

        await User.query().findById(p.id).patch(patch);
        const full = await loadUser(p.id);
        if (!full) throw new Error('Updated user not found');
        return toDTO(full);
      },
    },

    delete: {
      params: {
        id: { type: 'number', integer: true, convert: true },
      },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<{ ok: true }> {
        const me = requireMe(ctx);
        const target = await loadUser(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError('Vartotojas nerastas', 404, 'USER_NOT_FOUND');
        }
        if (!canManage(me, { tenantId: target.tenantId })) {
          throw new Errors.MoleculerClientError('Neturite teisės šalinti šio vartotojo', 403, 'FORBIDDEN');
        }
        if (target.id === me.id) {
          throw new Errors.MoleculerClientError('Negalima ištrinti savęs', 400, 'CANNOT_DELETE_SELF');
        }
        await User.query().deleteById(ctx.params.id);
        return { ok: true };
      },
    },
  },
};

export default UsersService;
