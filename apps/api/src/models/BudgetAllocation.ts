/**
 * BudgetAllocation — biudžeto skaidymas pagal klasifikatoriaus item'ą.
 */
import type { RelationMappings } from 'objection';
import { BaseModel } from './Base';

export class BudgetAllocation extends BaseModel {
  static override tableName = 'budget_allocations';

  id!: number;
  budgetId!: number;
  classifierItemId!: number;
  amount!: string;
  createdAt!: string;
  updatedAt!: string;

  budget?: import('./Budget').Budget;
  classifierItem?: import('./ClassifierItem').ClassifierItem;

  static override get relationMappings(): RelationMappings {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Budget } = require('./Budget') as typeof import('./Budget');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ClassifierItem } = require('./ClassifierItem') as typeof import('./ClassifierItem');
    return {
      budget: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Budget,
        join: { from: 'budget_allocations.budget_id', to: 'budgets.id' },
      },
      classifierItem: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: ClassifierItem,
        join: { from: 'budget_allocations.classifier_item_id', to: 'classifier_items.id' },
      },
    };
  }
}
