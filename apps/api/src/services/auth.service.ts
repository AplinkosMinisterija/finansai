/**
 * Autentifikacijos servisas.
 *
 * Sesija — random 32-byte hex token Redis'e, raktas `finansai:session:<token>`,
 * TTL 7 dienos. Cookie nustatomas API gateway response interceptor'iuje
 * (žr. api.service.ts).
 */
import crypto from 'crypto';
import type { ServiceSchema, Context, Errors as MoleculerErrors } from 'moleculer';
import { Errors } from 'moleculer';
import type {
  AuthLoginResponse,
  AuthLoginRequest,
  AuthMeResponse,
  AuthUser,
  UserRole,
} from '@biip-finansai/shared';
import { User } from '../models/User';
import { Tenant } from '../models/Tenant';
import { getRedis } from '../utils/redis';

const SESSION_PREFIX = 'finansai:session:';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionPayload {
  userId: number;
  role: UserRole;
  tenantId: number;
  createdAt: string;
}

export interface AuthMeta {
  user?: AuthUser;
  setSessionCookie?: string;
  clearSessionCookie?: boolean;
}

export type LoginParams = AuthLoginRequest;

interface LoginContext extends Context<LoginParams, AuthMeta> {}
interface LogoutContext extends Context<unknown, AuthMeta & { sessionToken?: string }> {}
interface MeContext extends Context<unknown, AuthMeta> {}

interface UserWithTenant extends User {
  tenant?: Tenant;
}

function toAuthUser(user: UserWithTenant): AuthUser {
  const tenant = user.tenant;
  if (!tenant) {
    throw new Error(`User ${user.id} loaded without tenant`);
  }
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    tenantCode: tenant.code,
    tenantName: tenant.name,
    tenantIsApprover: tenant.isApprover,
    amScopeOrgIds: user.amScopeOrgIds,
  };
}

async function loadUserWithTenant(id: number): Promise<UserWithTenant | undefined> {
  const u = await User.query().findById(id).withGraphFetched('tenant');
  return u as UserWithTenant | undefined;
}

const AuthService: ServiceSchema = {
  name: 'auth',

  actions: {
    login: {
      params: {
        username: { type: 'string', min: 1, max: 64 },
        password: { type: 'string', min: 1, max: 200 },
      },
      async handler(
        this: { logger: { warn: Function } },
        ctx: LoginContext,
      ): Promise<AuthLoginResponse> {
        const { username, password } = ctx.params;

        const user = (await User.query()
          .findOne({ username })
          .withGraphFetched('tenant')) as UserWithTenant | undefined;

        if (!user || !user.active) {
          this.logger.warn(`Login failed: user not found or inactive`, { username });
          throw new Errors.MoleculerClientError(
            'Neteisingas vartotojo vardas arba slaptažodis',
            401,
            'AUTH_INVALID_CREDENTIALS',
          );
        }
        const ok = await user.verifyPassword(password);
        if (!ok) {
          throw new Errors.MoleculerClientError(
            'Neteisingas vartotojo vardas arba slaptažodis',
            401,
            'AUTH_INVALID_CREDENTIALS',
          );
        }
        if (!user.tenant) {
          throw new Errors.MoleculerClientError(
            'Vartotojas neturi organizacijos',
            500,
            'AUTH_NO_TENANT',
          );
        }

        const token = crypto.randomBytes(32).toString('hex');
        const payload: SessionPayload = {
          userId: user.id,
          role: user.role,
          tenantId: user.tenantId,
          createdAt: new Date().toISOString(),
        };
        const redis = getRedis();
        if (redis.status === 'wait' || redis.status === 'end') {
          await redis.connect();
        }
        await redis.set(
          SESSION_PREFIX + token,
          JSON.stringify(payload),
          'EX',
          SESSION_TTL_SECONDS,
        );

        ctx.meta.setSessionCookie = token;

        return { user: toAuthUser(user) };
      },
    },

    logout: {
      async handler(
        this: { logger: { info: Function } },
        ctx: LogoutContext,
      ): Promise<{ ok: true }> {
        const token = ctx.meta.sessionToken;
        if (token) {
          const redis = getRedis();
          if (redis.status === 'wait' || redis.status === 'end') {
            await redis.connect();
          }
          await redis.del(SESSION_PREFIX + token);
        }
        ctx.meta.clearSessionCookie = true;
        return { ok: true };
      },
    },

    me: {
      async handler(ctx: MeContext): Promise<AuthMeResponse> {
        const authUser = ctx.meta.user;
        if (!authUser) {
          throw new Errors.MoleculerClientError('Neautentifikuota', 401, 'AUTH_REQUIRED');
        }
        const user = await loadUserWithTenant(authUser.id);
        if (!user || !user.active) {
          throw new Errors.MoleculerClientError('Vartotojas nerastas', 401, 'AUTH_USER_NOT_FOUND');
        }
        return { user: toAuthUser(user) };
      },
    },

    resolveSession: {
      visibility: 'public',
      params: {
        token: { type: 'string', min: 1 },
      },
      async handler(
        ctx: Context<{ token: string }>,
      ): Promise<SessionPayload | null> {
        const redis = getRedis();
        if (redis.status === 'wait' || redis.status === 'end') {
          await redis.connect();
        }
        const raw = await redis.get(SESSION_PREFIX + ctx.params.token);
        if (!raw) return null;
        try {
          return JSON.parse(raw) as SessionPayload;
        } catch {
          return null;
        }
      },
    },

    /**
     * Vidinė pagalbinė — naudoja api gateway authenticate hook'as.
     * Grąžina pilną AuthUser su tenant info.
     */
    resolveUser: {
      visibility: 'public',
      params: {
        userId: { type: 'number', integer: true },
      },
      async handler(ctx: Context<{ userId: number }>): Promise<AuthUser | null> {
        const u = await loadUserWithTenant(ctx.params.userId);
        if (!u || !u.active || !u.tenant) return null;
        return toAuthUser(u);
      },
    },
  },
};

export type { MoleculerErrors };
export default AuthService;
