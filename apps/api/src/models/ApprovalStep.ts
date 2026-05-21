/**
 * ApprovalStep — vienas aprobacijos workflow žingsnis (issue #9).
 *
 * Pastaba: `approval_steps` lentelė neturi `updated_at` kolonos (žr.
 * `20260519160000_create_approval_steps.ts`). `BaseModel.$beforeUpdate`
 * default'iškai bandytų set'inti `updatedAt`, kas sukeltų PG error patch'o metu.
 * Todėl no-op'inam `$beforeUpdate` čia.
 */
import type { RelationMappings } from 'objection';
import { BaseModel } from './Base';

export type ApprovalStepStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED';

export class ApprovalStep extends BaseModel {
  static override tableName = 'approval_steps';

  id!: number;
  requestId!: number;
  sequence!: number;
  levelCode!: string;
  levelName!: string;
  status!: ApprovalStepStatus;
  decidedByUserId!: number | null;
  decidedAt!: string | null;
  comment!: string | null;
  createdAt!: string;

  decidedByUser?: import('./User').User;

  // Lentelė neturi `updated_at` — overrride'inam Base'o $beforeUpdate kaip no-op.
  override $beforeUpdate(): void {
    // no-op
  }

  static override get relationMappings(): RelationMappings {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { User } = require('./User') as typeof import('./User');
    return {
      decidedByUser: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: User,
        join: { from: 'approval_steps.decided_by_user_id', to: 'users.id' },
      },
    };
  }
}
