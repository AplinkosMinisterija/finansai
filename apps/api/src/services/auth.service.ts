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
import { getRedis } from '../utils/redis';

const SESSION_PREFIX = 'finansai:session:';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionPayload {
  userId: number;
  role: UserRole;
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

function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
  };
}

const AuthService: ServiceSchema = {
  name: 'auth',

  actions: {
    login: {
      params: {
        username: { type: 'string', min: 1, max: 64 },
        password: { type: 'string', min: 1, max: 200 },
      },
      async handler(this: { logger: { warn: Function } }, ctx: LoginContext): Promise<AuthLoginResponse> {
        const { username, password } = ctx.params;

        const user = await User.query().findOne({ username });

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

        const token = crypto.randomBytes(32).toString('hex');
        const payload: SessionPayload = {
          userId: user.id,
          role: user.role,
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
          throw new Errors.MoleculerClientError(
            'Neautentifikuota',
            401,
            'AUTH_REQUIRED',
          );
        }
        const user = await User.query().findById(authUser.id);
        if (!user || !user.active) {
          throw new Errors.MoleculerClientError(
            'Vartotojas nerastas',
            401,
            'AUTH_USER_NOT_FOUND',
          );
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
  },
};

export type { MoleculerErrors };
export default AuthService;
