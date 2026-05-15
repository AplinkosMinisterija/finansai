/**
 * User modelis (login accounts) — Iter 0 versija.
 *
 * Iter 1 papildys: `tenantId`, `amScopeOrgIds` (AM userio scope per org).
 */
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
  active!: boolean;
  createdAt!: string;
  updatedAt!: string;

  /**
   * Patikrina, ar pateiktas plain-text password atitinka hash'ą.
   */
  async verifyPassword(plain: string): Promise<boolean> {
    return bcrypt.compare(plain, this.passwordHash);
  }

  override $formatJson(json: Record<string, unknown>): Record<string, unknown> {
    const result = super.$formatJson(json);
    delete result['passwordHash'];
    return result;
  }
}
