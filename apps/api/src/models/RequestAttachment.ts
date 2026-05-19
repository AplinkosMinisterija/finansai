/**
 * RequestAttachment — prie prašymo prikabintas dokumentas.
 * Pradžiai saugomas DB kaip base64 (LOB lauke), vėliau bus pakeista į blob/MinIO.
 */
import type { RelationMappings } from 'objection';
import { BaseModel } from './Base';

export type AttachmentKind = 'order_pdf' | 'invoice' | 'other';

export class RequestAttachment extends BaseModel {
  static override tableName = 'request_attachments';

  id!: number;
  requestId!: number;
  kind!: AttachmentKind;
  fileName!: string;
  mimeType!: string;
  sizeBytes!: number;
  dataBase64!: string;
  uploadedByUserId!: number;
  createdAt!: string;

  uploadedByUser?: import('./User').User;
  request?: import('./Request').Request;

  static override get relationMappings(): RelationMappings {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { User } = require('./User') as typeof import('./User');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Request } = require('./Request') as typeof import('./Request');
    return {
      uploadedByUser: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: User,
        join: { from: 'request_attachments.uploaded_by_user_id', to: 'users.id' },
      },
      request: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Request,
        join: { from: 'request_attachments.request_id', to: 'requests.id' },
      },
    };
  }
}
