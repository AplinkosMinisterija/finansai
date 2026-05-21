/**
 * API gateway servisas.
 *
 * Atsakingas už:
 *  - cookie parsing (manualus — be papildomų deps)
 *  - session resolution per auth.resolveSession
 *  - HttpOnly cookie nustatymas/išvalymas po login/logout
 *  - public ir protected route grupių išskyrimas
 *  - pilno AuthUser (su tenant) atnaujinimas per auth.resolveUser
 */
import type { ServiceSchema, Context } from 'moleculer';
import type { IncomingMessage, ServerResponse } from 'http';
import ApiGateway from 'moleculer-web';
import type { AuthUser } from '@biip-finansai/shared';

const WebErrors = ApiGateway.Errors;
import type { AuthMeta, SessionPayload } from './auth.service';

const SESSION_COOKIE_NAME = 'finansai_session';
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

interface AugmentedRequest extends IncomingMessage {
  $ctx?: Context<unknown, AuthMeta & { sessionToken?: string }>;
  $action?: { name?: string };
  $params?: unknown;
  parsedCookies?: Record<string, string>;
  cookies?: Record<string, string>;
}

type AugmentedResponse = ServerResponse;

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const name = trimmed.slice(0, eqIdx).trim();
    const rawValue = trimmed.slice(eqIdx + 1).trim();
    let value: string;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      continue;
    }
    if (name) result[name] = value;
  }
  return result;
}

function buildSetCookie(token: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    `Max-Age=${SESSION_COOKIE_MAX_AGE}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function buildClearCookie(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function isSecureCookieRequested(): boolean {
  if (process.env.SESSION_COOKIE_SECURE) {
    return process.env.SESSION_COOKIE_SECURE === 'true';
  }
  return process.env.ENVIRONMENT === 'production';
}

const ApiService: ServiceSchema = {
  name: 'api',
  mixins: [ApiGateway],

  settings: {
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
    ip: '0.0.0.0',

    use: [
      (
        req: AugmentedRequest,
        _res: AugmentedResponse,
        next: () => void,
      ): void => {
        const cookies = parseCookies(req.headers.cookie);
        req.parsedCookies = cookies;
        req.cookies = cookies;
        next();
      },
    ],

    routes: [
      {
        name: 'public',
        path: '/finansai',
        whitelist: ['api.ping', 'api.health'],
        use: [],
        authentication: false,
        mergeParams: true,
        autoAliases: false,
        aliases: {
          'GET /ping': 'api.ping',
          'GET /health': 'api.health',
        },
        bodyParsers: {
          json: { strict: false, limit: '1MB' },
          urlencoded: { extended: true, limit: '1MB' },
        },
        mappingPolicy: 'restrict',
        logging: true,
      },

      {
        name: 'auth',
        path: '/finansai/auth',
        whitelist: ['auth.login', 'auth.logout', 'auth.me'],
        use: [],
        authentication: true,
        mergeParams: true,
        autoAliases: false,
        aliases: {
          'POST /login': 'auth.login',
          'POST /logout': 'auth.logout',
          'GET /me': 'auth.me',
        },
        onBeforeCall(
          ctx: Context<unknown, AuthMeta & { sessionToken?: string }>,
          _route: unknown,
          req: AugmentedRequest,
        ): void {
          const token = req.parsedCookies?.[SESSION_COOKIE_NAME];
          if (token) {
            ctx.meta.sessionToken = token;
          }
        },
        onAfterCall(
          ctx: Context<unknown, AuthMeta>,
          _route: unknown,
          _req: AugmentedRequest,
          res: AugmentedResponse,
          data: unknown,
        ): unknown {
          const secure = isSecureCookieRequested();
          if (ctx.meta.setSessionCookie) {
            res.setHeader(
              'Set-Cookie',
              buildSetCookie(ctx.meta.setSessionCookie, secure),
            );
          }
          if (ctx.meta.clearSessionCookie) {
            res.setHeader('Set-Cookie', buildClearCookie(secure));
          }
          return data;
        },
        bodyParsers: {
          json: { strict: false, limit: '1MB' },
          urlencoded: { extended: true, limit: '1MB' },
        },
        mappingPolicy: 'restrict',
        logging: true,
      },

      {
        name: 'protected',
        path: '/finansai',
        whitelist: [
          'tenants.*',
          'users.*',
          'requests.*',
          'dashboard.*',
          'classifiers.*',
          'budgets.*',
          'fundingSources.*',
          'budgetAllocations.*',
          'requestAttachments.*',
          'requestReports.*',
        ],
        use: [],
        authentication: true,
        authorization: true,
        mergeParams: true,
        autoAliases: false,
        aliases: {
          'GET /tenants': 'tenants.list',
          'GET /tenants/:id': 'tenants.get',
          'POST /tenants': 'tenants.create',
          'PATCH /tenants/:id': 'tenants.update',
          'DELETE /tenants/:id': 'tenants.delete',

          'GET /users': 'users.list',
          'GET /users/:id': 'users.get',
          'POST /users': 'users.create',
          'PATCH /users/:id': 'users.update',
          'DELETE /users/:id': 'users.delete',

          'GET /requests': 'requests.list',
          'GET /requests/:id': 'requests.get',
          'POST /requests': 'requests.create',
          'PATCH /requests/:id': 'requests.update',
          'POST /requests/:id/submit': 'requests.submit',
          'POST /requests/:id/convert-to-current-year': 'requests.convertPlanToCurrentYear',
          'DELETE /requests/:id': 'requests.delete',
          'POST /requests/:id/decision': 'requests.decision',
          'POST /requests/:id/comments': 'requests.addComment',

          'GET /dashboard': 'dashboard.get',

          'GET /classifiers/groups': 'classifiers.listGroups',
          'GET /classifiers/groups/:id': 'classifiers.getGroup',
          'POST /classifiers/groups': 'classifiers.createGroup',
          'PATCH /classifiers/groups/:id': 'classifiers.updateGroup',
          'DELETE /classifiers/groups/:id': 'classifiers.deleteGroup',
          'GET /classifiers/items': 'classifiers.listItems',
          'GET /classifiers/items/:id': 'classifiers.getItem',
          'POST /classifiers/items': 'classifiers.createItem',
          'PATCH /classifiers/items/:id': 'classifiers.updateItem',
          'DELETE /classifiers/items/:id': 'classifiers.deleteItem',

          'GET /budgets': 'budgets.list',
          'GET /budgets/year/:year': 'budgets.getByYear',
          'GET /budgets/:id': 'budgets.get',
          'POST /budgets': 'budgets.upsert',
          'DELETE /budgets/:id': 'budgets.delete',

          'GET /funding-sources': 'fundingSources.list',
          'GET /funding-sources/:id': 'fundingSources.get',
          'POST /funding-sources': 'fundingSources.create',
          'PATCH /funding-sources/:id': 'fundingSources.update',
          'DELETE /funding-sources/:id': 'fundingSources.delete',

          'GET /budget-allocations': 'budgetAllocations.list',
          'GET /budget-allocations/:id': 'budgetAllocations.get',
          'GET /budget-allocations/:id/summary': 'budgetAllocations.summary',
          'POST /budget-allocations': 'budgetAllocations.create',
          'PATCH /budget-allocations/:id': 'budgetAllocations.update',
          'DELETE /budget-allocations/:id': 'budgetAllocations.delete',

          'GET /requests/:requestId/attachments': 'requestAttachments.list',
          'POST /requests/:requestId/attachments': 'requestAttachments.upload',
          'GET /attachments/:id/download': 'requestAttachments.download',
          'DELETE /attachments/:id': 'requestAttachments.delete',

          'GET /requests/:requestId/reports': 'requestReports.list',
          'POST /requests/:requestId/reports': 'requestReports.upsert',
          'POST /reports/:id/submit': 'requestReports.submit',
          'DELETE /reports/:id': 'requestReports.delete',
        },
        bodyParsers: {
          // 10MB JSON — leidžia įkelti ~5MB failus base64 enkoduotame payload'e.
          json: { strict: false, limit: '10MB' },
          urlencoded: { extended: true, limit: '1MB' },
        },
        mappingPolicy: 'restrict',
        logging: true,
      },
    ],

    log4XXResponses: false,
    logRequestParams: null,
    logResponseData: null,

    assets: { folder: 'public', options: {} },
  },

  methods: {
    async authenticate(
      this: { broker: { call: Function } },
      ctx: Context<unknown, AuthMeta & { sessionToken?: string }>,
      _route: unknown,
      req: AugmentedRequest,
    ): Promise<unknown> {
      const token = req.parsedCookies?.[SESSION_COOKIE_NAME];
      if (!token) {
        return null;
      }
      ctx.meta.sessionToken = token;
      const payload = (await this.broker.call('auth.resolveSession', {
        token,
      })) as SessionPayload | null;
      if (!payload) {
        return null;
      }
      // Pilnas user'is — su tenant info ir scope. Reikia visiems guard'ams.
      const user = (await this.broker.call('auth.resolveUser', {
        userId: payload.userId,
      })) as AuthUser | null;
      if (!user) {
        return null;
      }
      ctx.meta.user = user;
      return user;
    },

    authorize(
      ctx: Context<unknown, AuthMeta>,
      _route: unknown,
      _req: AugmentedRequest,
    ): void {
      if (!ctx.meta.user) {
        throw new WebErrors.UnAuthorizedError(WebErrors.ERR_NO_TOKEN, null);
      }
    },
  },

  actions: {
    ping: {
      rest: 'GET /ping',
      handler(): { ok: true; ts: string } {
        return { ok: true, ts: new Date().toISOString() };
      },
    },
    health: {
      rest: 'GET /health',
      async handler(this: { broker: { nodeID: string } }): Promise<{
        status: 'ok';
        node: string;
        uptime: number;
        version: string;
      }> {
        return {
          status: 'ok',
          node: this.broker.nodeID,
          uptime: process.uptime(),
          version: process.env.VERSION || 'dev',
        };
      },
    },
  },
};

export default ApiService;
