/**
 * Users servisas — CRUD su role-based scope.
 *
 * Scope rules (žr. docs/04-vartotoju-modelis.md):
 * - am_admin: visi vartotojai, gali valdyti AM vartotojus
 * - am_user: read-only AM + scope orgs
 * - org_admin: savo tenant vartotojai, gali juos valdyti
 * - org_user: tik save (read-only)
 */
import type { ServiceSchema, Context } from 'moleculer';
import { Errors } from 'moleculer';
import bcrypt from 'bcryptjs';
import type {
  PaginatedResponse,
  User as UserDTO,
  UserCreateRequest,
  UserListQuery,
  UserRole,
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

/**
 * Įvertina, ar `viewer` mato `target` user'į (list/get).
 */
function canView(viewer: NonNullable<AuthMeta['user']>, target: UserDTO): boolean {
  if (viewer.role === 'am_admin') return true;
  if (viewer.role === 'am_user') {
    // Visus AM vartotojus + scope organizacijų vartotojus
    if (target.tenantCode === 'AM') return true;
    if (viewer.amScopeOrgIds === null) return true;
    return viewer.amScopeOrgIds.includes(target.tenantId);
  }
  // org_admin / org_user: tik savo tenant
  if (target.tenantId !== viewer.tenantId) return false;
  if (viewer.role === 'org_admin') return true;
  // org_user — tik save
  return target.id === viewer.id;
}

/**
 * Įvertina, ar `viewer` gali valdyti (create/update/delete) `target` user'į.
 */
function canManage(viewer: NonNullable<AuthMeta['user']>, target: { tenantId: number; tenantCode?: string }): boolean {
  if (viewer.role === 'am_admin') {
    // am_admin valdo AM vartotojus + visus kitus
    return true;
  }
  if (viewer.role === 'org_admin') {
    // org_admin valdo TIK savo org
    return target.tenantId === viewer.tenantId;
  }
  return false;
}

/**
 * Įvertina, ar leidžiama suteikti tokį `role` su tokia `tenantId` kombinacija.
 */
async function validateRoleAndTenant(role: UserRole, tenantId: number): Promise<void> {
  const tenant = await Tenant.query().findById(tenantId);
  if (!tenant) {
    throw new Errors.MoleculerClientError('Organizacija nerasta', 400, 'TENANT_NOT_FOUND');
  }
  if (!tenant.active) {
    throw new Errors.MoleculerClientError('Organizacija neaktyvi', 400, 'TENANT_INACTIVE');
  }
  const isAmRole = role === 'am_admin' || role === 'am_user';
  if (isAmRole && tenant.code !== 'AM') {
    throw new Errors.MoleculerClientError(
      'AM rolės galimos tik AM organizacijoje',
      400,
      'ROLE_TENANT_MISMATCH',
    );
  }
  if (!isAmRole && tenant.code === 'AM') {
    throw new Errors.MoleculerClientError(
      'Pavaldžios institucijos rolės negalimos AM organizacijoje',
      400,
      'ROLE_TENANT_MISMATCH',
    );
  }
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

        // Scope pre-filter — performance, ne security (security finalas — canView)
        if (me.role === 'org_admin' || me.role === 'org_user') {
          query.where('users.tenant_id', me.tenantId);
        } else if (me.role === 'am_user') {
          const amTenant = await Tenant.query().findOne({ code: 'AM' });
          const visibleTenantIds = new Set<number>();
          if (amTenant) visibleTenantIds.add(amTenant.id);
          if (me.amScopeOrgIds === null) {
            // nieko nefiltruojam
          } else {
            for (const id of me.amScopeOrgIds) visibleTenantIds.add(id);
            query.whereIn('users.tenant_id', Array.from(visibleTenantIds));
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

        // org_user matomumas — tik save
        const filtered =
          me.role === 'org_user'
            ? items.filter((u) => u.id === me.id)
            : items;

        return {
          items: filtered.map(toDTO),
          total: me.role === 'org_user' ? filtered.length : total,
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
        role: { type: 'enum', values: ['am_admin', 'am_user', 'org_admin', 'org_user'] },
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

        await validateRoleAndTenant(p.role, p.tenantId);

        // Tik AM rolėms gali būti `am_scope_org_ids`
        const isAmRole = p.role === 'am_admin' || p.role === 'am_user';
        const amScope = isAmRole ? (p.amScopeOrgIds ?? null) : null;

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
        role: { type: 'enum', optional: true, values: ['am_admin', 'am_user', 'org_admin', 'org_user'] },
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

        const newRole = p.role ?? target.role;
        await validateRoleAndTenant(newRole, targetTenantId);

        const isAmRole = newRole === 'am_admin' || newRole === 'am_user';

        const patch: Record<string, unknown> = {};
        if (p.username !== undefined) patch['username'] = p.username;
        if (p.fullName !== undefined) patch['fullName'] = p.fullName;
        if (p.email !== undefined) patch['email'] = p.email;
        if (p.role !== undefined) patch['role'] = p.role;
        if (p.tenantId !== undefined) patch['tenantId'] = p.tenantId;
        if (p.active !== undefined) patch['active'] = p.active;
        if (p.amScopeOrgIds !== undefined) {
          patch['amScopeOrgIds'] = isAmRole ? p.amScopeOrgIds : null;
        } else if (p.role !== undefined && !isAmRole) {
          // Jei keičiame iš AM rolės į org rolę — išvalom scope
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
