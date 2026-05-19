/**
 * Budget — metinis biudžetas (vienas įrašas vieneriems metams).
 */
import type { RelationMappings } from 'objection';
import { BaseModel } from './Base';

export class Budget extends BaseModel {
  static override tableName = 'budgets';

  id!: number;
  year!: number;
  totalAmount!: string;
  notes!: string | null;
  createdAt!: string;
  updatedAt!: string;

  allocations?: import('./BudgetAllocation').BudgetAllocation[];

  static override get relationMappings(): RelationMappings {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BudgetAllocation } =
      require('./BudgetAllocation') as typeof import('./BudgetAllocation');
    return {
      allocations: {
        relation: BaseModel.HasManyRelation,
        modelClass: BudgetAllocation,
        join: { from: 'budgets.id', to: 'budget_allocations.budget_id' },
      },
    };
  }
}
