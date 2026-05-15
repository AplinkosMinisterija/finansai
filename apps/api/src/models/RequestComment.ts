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
  | 'rejected';

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

  static override get relationMappings(): RelationMappings {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { User } = require('./User') as typeof import('./User');
    return {
      authorUser: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: User,
        join: { from: 'request_comments.author_user_id', to: 'users.id' },
      },
    };
  }
}
