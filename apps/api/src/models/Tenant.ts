/**
 * Tenant modelis — organizacija (AM + pavaldžios institucijos).
 */
import { BaseModel } from './Base';

export class Tenant extends BaseModel {
  static override tableName = 'tenants';

  id!: number;
  code!: string;
  name!: string;
  description!: string | null;
  isApprover!: boolean;
  active!: boolean;
  createdAt!: string;
  updatedAt!: string;
}
