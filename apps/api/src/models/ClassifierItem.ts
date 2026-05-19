/**
 * ClassifierItem — klasifikatoriaus reikšmė grupėje. Palaiko 1 lygio hierarchiją
 * (parent_id self-FK), pvz. „IT" → „Licencijos", „Įranga".
 */
import type { RelationMappings } from 'objection';
import { BaseModel } from './Base';

export class ClassifierItem extends BaseModel {
  static override tableName = 'classifier_items';

  id!: number;
  groupId!: number;
  parentId!: number | null;
  code!: string;
  name!: string;
  sortOrder!: number;
  active!: boolean;
  createdAt!: string;
  updatedAt!: string;

  group?: import('./ClassifierGroup').ClassifierGroup;
  parent?: ClassifierItem;
  children?: ClassifierItem[];

  static override get relationMappings(): RelationMappings {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ClassifierGroup } = require('./ClassifierGroup') as typeof import('./ClassifierGroup');
    return {
      group: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: ClassifierGroup,
        join: { from: 'classifier_items.group_id', to: 'classifier_groups.id' },
      },
      parent: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: ClassifierItem,
        join: { from: 'classifier_items.parent_id', to: 'classifier_items.id' },
      },
      children: {
        relation: BaseModel.HasManyRelation,
        modelClass: ClassifierItem,
        join: { from: 'classifier_items.id', to: 'classifier_items.parent_id' },
      },
    };
  }
}
