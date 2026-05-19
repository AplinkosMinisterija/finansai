/**
 * Prikabintų dokumentų servisas (issue #13).
 *
 * - list/download: visi, kurie mato prašymą (per canViewRequest).
 * - upload: AM admin (kanclerio potvarkis prie patvirtinimo) arba prašymo
 *   teikėjas (sąskaitos, kiti dokumentai prie atsiskaitymo — busimo #2).
 * - delete: uploader arba AM admin.
 *
 * Saugoma DB kaip base64 — limit'as 5 MB per failą.
 */
import type { ServiceSchema, Context } from 'moleculer';
import { Errors } from 'moleculer';
import type {
  RequestAttachment as AttachmentDTO,
  RequestAttachmentUploadRequest,
} from '@biip-finansai/shared';
import { Request } from '../models/Request';
import type { RequestStatus } from '../models/Request';
import { RequestAttachment } from '../models/RequestAttachment';
import { canViewRequest } from '../utils/permissions';
import type { AuthMeta } from './auth.service';
import type { User } from '../models/User';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_KINDS = ['order_pdf', 'invoice', 'other'] as const;
const ALLOWED_MIME_PREFIX = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];

interface AttachmentWithUser extends RequestAttachment {
  uploadedByUser?: User;
}

function toDTO(a: AttachmentWithUser): AttachmentDTO {
  return {
    id: a.id,
    requestId: a.requestId,
    kind: a.kind,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    uploadedByUserId: a.uploadedByUserId,
    uploadedByName: a.uploadedByUser?.fullName,
    createdAt: a.createdAt,
  };
}

function requireMe(ctx: Context<unknown, AuthMeta>): NonNullable<AuthMeta['user']> {
  if (!ctx.meta.user) {
    throw new Errors.MoleculerClientError('Neautentifikuota', 401, 'AUTH_REQUIRED');
  }
  return ctx.meta.user;
}

function canUpload(
  viewer: NonNullable<AuthMeta['user']>,
  r: { tenantId: number; createdByUserId: number; status: RequestStatus },
  kind: string,
): boolean {
  if (!canViewRequest(viewer, r)) return false;
  // Kanclerio potvarkis — tik AM (sprendimo dalies dokumentas).
  if (kind === 'order_pdf') {
    return viewer.tenantIsApprover;
  }
  // Sąskaitos / kiti — teikėjas arba AM admin.
  return true;
}

function decodeBase64(s: string): Buffer | null {
  try {
    const buf = Buffer.from(s, 'base64');
    // Buffer.from leniencijiškas: jei input'e netinkamų simbolių, jis praleidžia.
    // Patikrinam round-trip: ar re-encode'intas atitinka įvestį (ignoruojant whitespace).
    const reencoded = buf.toString('base64');
    const cleaned = s.replace(/\s/g, '');
    if (reencoded !== cleaned) return null;
    return buf;
  } catch {
    return null;
  }
}

const RequestAttachmentsService: ServiceSchema = {
  name: 'requestAttachments',

  actions: {
    list: {
      params: { requestId: { type: 'number', integer: true, convert: true } },
      async handler(
        ctx: Context<{ requestId: number }, AuthMeta>,
      ): Promise<AttachmentDTO[]> {
        const me = requireMe(ctx);
        const r = await Request.query().findById(ctx.params.requestId);
        if (!r) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        if (!canViewRequest(me, { tenantId: r.tenantId, createdByUserId: r.createdByUserId, status: r.status })) {
          throw new Errors.MoleculerClientError('Neturite teisės', 403, 'FORBIDDEN');
        }
        const rows = (await RequestAttachment.query()
          .where('request_id', r.id)
          .withGraphFetched('uploadedByUser')
          .orderBy('created_at', 'desc')) as AttachmentWithUser[];
        return rows.map(toDTO);
      },
    },

    upload: {
      params: {
        requestId: { type: 'number', integer: true, convert: true },
        kind: { type: 'enum', values: ALLOWED_KINDS },
        fileName: { type: 'string', min: 1, max: 255 },
        mimeType: { type: 'string', min: 1, max: 100 },
        dataBase64: { type: 'string', min: 1 },
      },
      async handler(
        ctx: Context<{ requestId: number } & RequestAttachmentUploadRequest, AuthMeta>,
      ): Promise<AttachmentDTO> {
        const me = requireMe(ctx);
        const r = await Request.query().findById(ctx.params.requestId);
        if (!r) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        const { kind, fileName, mimeType, dataBase64 } = ctx.params;

        if (!canUpload(me, { tenantId: r.tenantId, createdByUserId: r.createdByUserId, status: r.status }, kind)) {
          throw new Errors.MoleculerClientError(
            'Neturite teisės įkelti šio tipo dokumento',
            403,
            'FORBIDDEN',
          );
        }

        if (!ALLOWED_MIME_PREFIX.some((m) => mimeType.startsWith(m))) {
          throw new Errors.MoleculerClientError(
            'Leidžiami tik PDF arba paveiksliuko (PNG/JPG) failai',
            400,
            'INVALID_MIME',
          );
        }

        // Pašalinam galimą "data:application/pdf;base64," prefix'ą.
        const cleanBase64 = dataBase64.includes(',')
          ? (dataBase64.split(',', 2)[1] ?? '')
          : dataBase64;

        const buf = decodeBase64(cleanBase64);
        if (!buf) {
          throw new Errors.MoleculerClientError(
            'Neteisingas failo turinys (base64 dekodavimas nepavyko)',
            400,
            'INVALID_BASE64',
          );
        }

        // Tikslus baitų dydis iš dekoduoto buferio.
        const sizeBytes = buf.length;
        if (sizeBytes > MAX_FILE_BYTES) {
          throw new Errors.MoleculerClientError(
            `Failas per didelis (max ${MAX_FILE_BYTES / 1024 / 1024} MB)`,
            400,
            'FILE_TOO_LARGE',
          );
        }

        const inserted = await RequestAttachment.query().insert({
          requestId: r.id,
          kind,
          fileName,
          mimeType,
          sizeBytes,
          dataBase64: cleanBase64,
          uploadedByUserId: me.id,
        });
        const withUser = (await RequestAttachment.query()
          .findById(inserted.id)
          .withGraphFetched('uploadedByUser')) as AttachmentWithUser | undefined;
        if (!withUser) throw new Error('Insert failed');
        return toDTO(withUser);
      },
    },

    download: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(
        ctx: Context<{ id: number }, AuthMeta>,
      ): Promise<{ fileName: string; mimeType: string; dataBase64: string }> {
        const me = requireMe(ctx);
        const a = await RequestAttachment.query().findById(ctx.params.id);
        if (!a) {
          throw new Errors.MoleculerClientError('Dokumentas nerastas', 404, 'ATTACHMENT_NOT_FOUND');
        }
        const r = await Request.query().findById(a.requestId);
        if (!r) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        if (!canViewRequest(me, { tenantId: r.tenantId, createdByUserId: r.createdByUserId, status: r.status })) {
          throw new Errors.MoleculerClientError('Neturite teisės', 403, 'FORBIDDEN');
        }
        return {
          fileName: a.fileName,
          mimeType: a.mimeType,
          dataBase64: a.dataBase64,
        };
      },
    },

    delete: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<{ ok: true }> {
        const me = requireMe(ctx);
        const a = await RequestAttachment.query().findById(ctx.params.id);
        if (!a) {
          throw new Errors.MoleculerClientError('Dokumentas nerastas', 404, 'ATTACHMENT_NOT_FOUND');
        }
        const r = await Request.query().findById(a.requestId);
        if (!r) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        // Tinka uploader'is arba AM admin.
        const isAmAdmin = me.tenantIsApprover && me.role === 'admin';
        if (a.uploadedByUserId !== me.id && !isAmAdmin) {
          throw new Errors.MoleculerClientError(
            'Galite ištrinti tik savo įkeltą dokumentą',
            403,
            'FORBIDDEN',
          );
        }
        await RequestAttachment.query().deleteById(a.id);
        return { ok: true };
      },
    },
  },
};

export default RequestAttachmentsService;
