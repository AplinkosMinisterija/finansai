/**
 * User modelis (login accounts) — Iter 1 versija su tenant.
 */
import type { RelationMappings } from 'objection';
import bcrypt from 'bcryptjs';
import type { UserRole } from '@biip-finansai/shared';
import { BaseModel } from './Base';

export class User extends BaseModel {
  static override tableName = 'users';

  id!: number;
  username!: string;
  passwordHash!: string;
  fullName!: string;
  email!: string | null;
  role!: UserRole;
  tenantId!: number;
  /** AM userio scope. NULL = visos org'os. */
  amScopeOrgIds!: number[] | null;
  active!: boolean;
  createdAt!: string;
  updatedAt!: string;

  // Eager-loaded
  tenant?: import('./Tenant').Tenant;

  static override get relationMappings(): RelationMappings {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Tenant } = require('./Tenant') as typeof import('./Tenant');

    return {
      tenant: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: Tenant,
        join: {
          from: 'users.tenant_id',
          to: 'tenants.id',
        },
      },
    };
  }

  async verifyPassword(plain: string): Promise<boolean> {
    return bcrypt.compare(plain, this.passwordHash);
  }

  override $formatJson(json: Record<string, unknown>): Record<string, unknown> {
    const result = super.$formatJson(json);
    delete result['passwordHash'];
    return result;
  }
}
