/**
 * Pradinis seed'as (Iter 0) — vienas `demo` admin account.
 * Iter 1 papildys: AM tenant + 3 pavaldžios institucijos + 8+ demo accounts.
 */
import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';

interface UserSeed {
  username: string;
  password: string;
  fullName: string;
  email: string;
  role: 'admin' | 'am_admin' | 'am_user' | 'org_admin' | 'org_user';
}

const USERS: UserSeed[] = [
  {
    username: 'demo',
    password: 'demo',
    fullName: 'Demo Administratorius',
    email: 'demo@am.lt',
    role: 'admin',
  },
];

export async function seed(knex: Knex): Promise<void> {
  await knex('users').del();
  await knex.raw('ALTER SEQUENCE users_id_seq RESTART WITH 1');

  for (const u of USERS) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await knex('users').insert({
      username: u.username,
      password_hash: passwordHash,
      full_name: u.fullName,
      email: u.email,
      role: u.role,
      active: true,
    });
  }
}
