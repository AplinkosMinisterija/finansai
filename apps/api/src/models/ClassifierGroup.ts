/**
 * ClassifierGroup — klasifikatoriaus grupė (pvz. „funding_type", „is_system",
 * „project_type", „source_program").
 */
import type { RelationMappings } from 'objection';
import { BaseModel } from './Base';

export class ClassifierGroup extends BaseModel {
  static override tableName = 'classifier_groups';

  id!: number;
  code!: string;
  name!: string;
  description!: string | null;
  active!: boolean;
  createdAt!: string;
  updatedAt!: string;

  items?: import('./ClassifierItem').ClassifierItem[];

  static override get relationMappings(): RelationMappings {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ClassifierItem } = require('./ClassifierItem') as typeof import('./ClassifierItem');
    return {
      items: {
        relation: BaseModel.HasManyRelation,
        modelClass: ClassifierItem,
        join: { from: 'classifier_groups.id', to: 'classifier_items.group_id' },
      },
    };
  }
}
