/**
 * Request modelis (finansavimo prašymas).
 */
import type { RelationMappings } from 'objection';
import { BaseModel } from './Base';

export type RequestStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'RETURNED'
  | 'APPROVED'
  | 'REJECTED';

export class Request extends BaseModel {
  static override tableName = 'requests';

  id!: number;
  tenantId!: number;
  createdByUserId!: number;
  status!: RequestStatus;
  /** Kuriai metams skirtas prašymas/planas (issue #4). */
  year!: number;

  // 1. Pagrindinė info
  projectName!: string;
  systemCode!: string | null;
  projectType!: string | null;
  description!: string | null;
  plannedWorks!: string | null;
  priority!: number | null;
  procurementStage!: string | null;

  // 2. Finansavimas
  costDu!: string;
  costEquipment!: string;
  costCreation!: string;
  costAnalysis!: string;
  costDevelopment!: string;
  costMaintenance!: string;
  costModernization!: string;
  costDecommissioning!: string;
  fundingFromIt!: string;
  otherFunds!: string;
  otherFundsSource!: string | null;

  // 3. Ketv. paskirstymas
  q1Amount!: string;
  q2Amount!: string;
  q3Amount!: string;
  q4Amount!: string;

  // 4. Atsakingi
  responsibleInstitution!: string | null;
  executorName!: string | null;
  executorEmail!: string | null;
  implementationDeadline!: string | null;
  submitterNotes!: string | null;

  // 5. Sprendimas
  decisionGrantedAmount!: string | null;
  decisionFundingSource!: string | null;
  decisionProtocol!: string | null;
  decisionOrder!: string | null;
  decidedAt!: string | null;
  decidedByUserId!: number | null;

  submittedAt!: string | null;
  createdAt!: string;
  updatedAt!: string;

  // Eager
  tenant?: import('./Tenant').Tenant;
  createdByUser?: import('./User').User;
  decidedByUser?: import('./User').User;
  comments?: import('./RequestComment').RequestComment[];
  approvalSteps?: import('./ApprovalStep').ApprovalStep[];

  static override get relationMappings(): RelationMappings {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Tenant } = require('./Tenant') as typeof import('./Tenant');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { User } = require('./User') as typeof import('./User');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RequestComment } = require('./RequestComment') as typeof import('./RequestComment');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ApprovalStep } = require('./ApprovalStep') as typeof import('./ApprovalStep');

    return {
      tenant: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Tenant,
        join: { from: 'requests.tenant_id', to: 'tenants.id' },
      },
      createdByUser: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: User,
        join: { from: 'requests.created_by_user_id', to: 'users.id' },
      },
      decidedByUser: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: User,
        join: { from: 'requests.decided_by_user_id', to: 'users.id' },
      },
      comments: {
        relation: BaseModel.HasManyRelation,
        modelClass: RequestComment,
        join: { from: 'requests.id', to: 'request_comments.request_id' },
      },
      approvalSteps: {
        relation: BaseModel.HasManyRelation,
        modelClass: ApprovalStep,
        join: { from: 'requests.id', to: 'approval_steps.request_id' },
      },
    };
  }
}
