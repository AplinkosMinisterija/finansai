/**
 * RequestReport — ketvirtinis arba metinis atsiskaitymas už patvirtintą prašymą
 * (issue #2).
 */
import type { RelationMappings } from 'objection';
import { BaseModel } from './Base';

export type ReportStatus = 'DRAFT' | 'SUBMITTED';

export class RequestReport extends BaseModel {
  static override tableName = 'request_reports';

  id!: number;
  requestId!: number;
  periodYear!: number;
  periodQuarter!: number | null;
  amountUsed!: string;
  description!: string | null;
  status!: ReportStatus;
  submittedByUserId!: number;
  submittedAt!: string | null;
  createdAt!: string;
  updatedAt!: string;

  submittedByUser?: import('./User').User;

  static override get relationMappings(): RelationMappings {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { User } = require('./User') as typeof import('./User');
    return {
      submittedByUser: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: User,
        join: { from: 'request_reports.submitted_by_user_id', to: 'users.id' },
      },
    };
  }
}
