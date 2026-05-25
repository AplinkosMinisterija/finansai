/**
 * RequestComment — ping-pong komentaras + audit log.
 */
import type { RelationMappings } from 'objection';
import { BaseModel } from './Base';

export type RequestCommentKind =
  | 'comment'
  | 'status_change'
  | 'submitted'
  | 'returned'
  | 'approved'
  | 'rejected'
  // Issue #9: archyvavimas / grąžinimas į juodraštį.
  | 'marked_not_relevant'
  | 'reactivated';

export class RequestComment extends BaseModel {
  static override tableName = 'request_comments';

  id!: number;
  requestId!: number;
  authorUserId!: number;
  kind!: RequestCommentKind;
  body!: string | null;
  metadata!: Record<string, unknown> | null;
  createdAt!: string;

  authorUser?: import('./User').User;
  request?: import('./Request').Request;

  static override get relationMappings(): RelationMappings {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { User } = require('./User') as typeof import('./User');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Request } = require('./Request') as typeof import('./Request');
    return {
      authorUser: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: User,
        join: { from: 'request_comments.author_user_id', to: 'users.id' },
      },
      request: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Request,
        join: { from: 'request_comments.request_id', to: 'requests.id' },
      },
    };
  }
}
