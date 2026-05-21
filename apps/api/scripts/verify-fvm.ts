/**
 * FVM verification skriptas (Iter 16, FVM-8).
 *
 * Standalone Node skriptas, kuris patikrina, ar FVM migracijos paleistos
 * korektiškai ir visi būtini schema elementai egzistuoja prieš staging
 * deploy'ą.
 *
 * Paleidimas:
 *   yarn workspace @biip-finansai/api tsx scripts/verify-fvm.ts
 *
 * Tikrinama (kiekvienas check'as → PASS/FAIL su detalėmis):
 *   1. Visos FVM lentelės egzistuoja
 *   2. Klasifikatoriai seedinti (funding_source_type + budget_category)
 *      su privalomais items'ais
 *   3. expenses.payroll_profile_id kolona egzistuoja (Iter 14 migracija)
 *   4. projects.is_du_system kolona egzistuoja (Iter 13.x migracija)
 *   5. Visi FVM endpoint'ai api.service.ts whitelist'e
 *   6. Visos FVM migracijos užregistruotos knex_migrations lentelėje
 *
 * Exit codes:
 *   0 — visi check'ai PASS
 *   1 — bent vienas FAIL
 *
 * Susiję dokumentai:
 *  - docs/fvm/iter-16-deploy.md — DevOps brief
 *  - docs/fvm/staging-deploy-plan.md — staging deploy procedure
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import knexFactory, { type Knex } from 'knex';
import { createKnexConfig } from '../src/database/knexfile';

// --- ANSI spalvos (terminal output'ui) --------------------------------------

const COLOR_GREEN = '\x1b[32m';
const COLOR_RED = '\x1b[31m';
const COLOR_YELLOW = '\x1b[33m';
const COLOR_BOLD = '\x1b[1m';
const COLOR_RESET = '\x1b[0m';

// --- Tikrinimo rezultato apvalkalas -----------------------------------------

interface CheckResult {
  name: string;
  ok: boolean;
  details: string[];
}

const results: CheckResult[] = [];

function ok(name: string, details: string[] = []): void {
  results.push({ name, ok: true, details });
}

function fail(name: string, details: string[]): void {
  results.push({ name, ok: false, details });
}

// --- Privaloma FVM struktūra ------------------------------------------------

const FVM_TABLES = [
  'funding_sources',
  'budget_allocations_v2',
  'projects',
  'expenses',
  'payroll_profiles',
  'payroll_distributions',
] as const;

const FUNDING_SOURCE_TYPE_ITEMS = ['biudzetas', 'es', 'kita'] as const;
const BUDGET_CATEGORY_ITEMS = [
  'du',
  'spec_programa',
  'prekes_paslaugos',
  'investicijos',
  'kita',
] as const;

const FVM_REQUIRED_ENDPOINTS = [
  // Funding sources (Iter 9)
  'fundingSources.list',
  'fundingSources.get',
  'fundingSources.create',
  'fundingSources.update',
  'fundingSources.delete',
  'fundingSources.copyFromYear',
  // Budget allocations v2 (Iter 9)
  'budgetAllocations.list',
  'budgetAllocations.get',
  'budgetAllocations.summary',
  'budgetAllocations.create',
  'budgetAllocations.update',
  'budgetAllocations.delete',
  // Projects (Iter 11)
  'projects.list',
  'projects.get',
  'projects.summary',
  'projects.create',
  'projects.update',
  'projects.delete',
  'projects.changeStatus',
  // Expenses (Iter 12)
  'expenses.list',
  'expenses.get',
  'expenses.budgetSummary',
  'expenses.create',
  'expenses.update',
  'expenses.delete',
  // Payroll (Iter 13)
  'payroll.computeMonth',
  'payroll.listProfiles',
  'payroll.getProfile',
  'payroll.createProfile',
  'payroll.updateProfile',
  'payroll.deleteProfile',
  'payroll.listDistributions',
  'payroll.createDistribution',
  'payroll.updateDistribution',
  'payroll.deleteDistribution',
  // Reports (Iter 14)
  'reports.budgetExecution',
  'reports.specProgramExecution',
  'reports.payrollDistribution',
  // Request → FVM project (Iter 11)
  'requests.createFvmProject',
  // Dashboard FVM summary (Iter 15)
  'dashboard.fvmSummary',
] as const;

const FVM_MIGRATIONS = [
  '20260522100000_create_fvm_foundation.ts',
  '20260523100000_add_fvm_fields_to_requests.ts',
  '20260524100000_create_projects.ts',
  '20260525100000_create_expenses.ts',
  '20260526100000_create_payroll.ts',
  '20260526200000_add_is_du_system_to_projects.ts',
  '20260527100000_add_payroll_profile_to_expenses.ts',
] as const;

// --- Check'ai ---------------------------------------------------------------

/**
 * Check #1: Visos FVM lentelės egzistuoja.
 */
async function checkFvmTables(knex: Knex): Promise<void> {
  const missing: string[] = [];
  for (const t of FVM_TABLES) {
    const exists = await knex.schema.hasTable(t);
    if (!exists) missing.push(t);
  }
  if (missing.length === 0) {
    ok('FVM lentelės egzistuoja', [
      `Rastos visos ${FVM_TABLES.length} lentelės: ${FVM_TABLES.join(', ')}`,
    ]);
  } else {
    fail('FVM lentelės egzistuoja', [
      `Trūksta ${missing.length} lentelių: ${missing.join(', ')}`,
      'Paleisk: yarn workspace @biip-finansai/api db:migrate',
    ]);
  }
}

/**
 * Check #2: Klasifikatoriai seedinti.
 */
async function checkClassifiers(knex: Knex): Promise<void> {
  const groups = [
    {
      groupCode: 'funding_source_type',
      expectedItems: FUNDING_SOURCE_TYPE_ITEMS,
    },
    {
      groupCode: 'budget_category',
      expectedItems: BUDGET_CATEGORY_ITEMS,
    },
  ];

  const issues: string[] = [];
  for (const g of groups) {
    const group = (await knex('classifier_groups')
      .where({ code: g.groupCode })
      .first<{ id: number }>('id')) as { id: number } | undefined;
    if (!group) {
      issues.push(`Grupė '${g.groupCode}' nerasta classifier_groups lentelėje`);
      continue;
    }
    const items = (await knex('classifier_items')
      .where({ group_id: group.id })
      .select<Array<{ code: string }>>('code')) as Array<{ code: string }>;
    const foundCodes = new Set(items.map((i) => i.code));
    const missingItems = g.expectedItems.filter((c) => !foundCodes.has(c));
    if (missingItems.length > 0) {
      issues.push(
        `Grupėje '${g.groupCode}' trūksta items: ${missingItems.join(', ')}`,
      );
    }
  }

  if (issues.length === 0) {
    ok('FVM klasifikatoriai seedinti', [
      `funding_source_type: ${FUNDING_SOURCE_TYPE_ITEMS.join(', ')}`,
      `budget_category: ${BUDGET_CATEGORY_ITEMS.join(', ')}`,
    ]);
  } else {
    fail('FVM klasifikatoriai seedinti', issues);
  }
}

/**
 * Check #3: expenses.payroll_profile_id kolona egzistuoja.
 */
async function checkExpensesPayrollProfileColumn(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('expenses');
  if (!hasTable) {
    fail('expenses.payroll_profile_id kolona', [
      'expenses lentelė neegzistuoja — paleisk migracijas',
    ]);
    return;
  }
  const hasColumn = await knex.schema.hasColumn('expenses', 'payroll_profile_id');
  if (!hasColumn) {
    fail('expenses.payroll_profile_id kolona', [
      'Kolonos nėra — migracija 20260527100000 nepaleista',
    ]);
    return;
  }

  // Patikrinam FK egzistavimą per information_schema (PG-specific).
  const fkRows = (await knex.raw(`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'expenses'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) LIKE '%payroll_profile_id%'
  `)) as { rows: Array<{ conname: string }> };
  if (fkRows.rows.length === 0) {
    fail('expenses.payroll_profile_id kolona', [
      'Kolona egzistuoja, BET FK į payroll_profiles trūksta',
    ]);
    return;
  }
  ok('expenses.payroll_profile_id kolona', [
    `Kolona + FK egzistuoja (constraint: ${fkRows.rows[0]?.conname})`,
  ]);
}

/**
 * Check #4: projects.is_du_system kolona egzistuoja.
 */
async function checkProjectsIsDuSystemColumn(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('projects');
  if (!hasTable) {
    fail('projects.is_du_system kolona', [
      'projects lentelė neegzistuoja — paleisk migracijas',
    ]);
    return;
  }
  const hasColumn = await knex.schema.hasColumn('projects', 'is_du_system');
  if (!hasColumn) {
    fail('projects.is_du_system kolona', [
      'Kolonos nėra — migracija 20260526200000 nepaleista',
    ]);
    return;
  }

  // Default check — turi būti `false`.
  const colInfo = (await knex.raw(`
    SELECT column_default, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'is_du_system'
  `)) as {
    rows: Array<{
      column_default: string | null;
      is_nullable: string;
      data_type: string;
    }>;
  };

  const details: string[] = [];
  const info = colInfo.rows[0];
  if (info) {
    details.push(`Type: ${info.data_type}, nullable: ${info.is_nullable}`);
    details.push(`Default: ${info.column_default ?? '(none)'}`);
  }

  // Partial indeksas turi būti.
  const idxRows = (await knex.raw(`
    SELECT indexname
    FROM pg_indexes
    WHERE tablename = 'projects' AND indexname = 'idx_projects_is_du_system'
  `)) as { rows: Array<{ indexname: string }> };
  if (idxRows.rows.length === 0) {
    fail('projects.is_du_system kolona', [
      ...details,
      'Trūksta partial indekso idx_projects_is_du_system',
    ]);
    return;
  }
  details.push(`Partial indeksas: ${idxRows.rows[0]?.indexname} (OK)`);
  ok('projects.is_du_system kolona', details);
}

/**
 * Check #5: Visi FVM endpoint'ai api.service.ts whitelist'e.
 *
 * Skaitomas pats `api.service.ts` failas tekstu — ieškoma kiekvieno
 * action'o reference (string match'as `'serviceName.actionName'`).
 * Tai paprastesnis check'as nei runtime'ainis Moleculer broker'io
 * launch'as ir suteikia greitą feedback'ą jei kažkas pamiršta atnaujinti
 * whitelist'ą.
 */
function checkApiEndpoints(): void {
  const apiServicePath = join(
    __dirname,
    '..',
    'src',
    'services',
    'api.service.ts',
  );
  let content: string;
  try {
    content = readFileSync(apiServicePath, 'utf-8');
  } catch (err) {
    fail('FVM endpoint\'ai whitelist\'e', [
      `Nepavyko nuskaityti ${apiServicePath}: ${(err as Error).message}`,
    ]);
    return;
  }

  // Patikrinam ar service'ai įtraukti į whitelist (wildcard formą).
  const requiredWhitelistEntries = [
    "'fundingSources.*'",
    "'budgetAllocations.*'",
    "'projects.*'",
    "'expenses.*'",
    "'payroll.*'",
    "'reports.*'",
  ];

  const missingWhitelist: string[] = [];
  for (const entry of requiredWhitelistEntries) {
    if (!content.includes(entry)) {
      missingWhitelist.push(entry);
    }
  }

  // Patikrinam ar visi konkretūs action'ai pamatomi alias'uose
  // (target string string'inant kaip `'serviceName.actionName'`).
  const missingEndpoints: string[] = [];
  for (const endpoint of FVM_REQUIRED_ENDPOINTS) {
    if (!content.includes(`'${endpoint}'`)) {
      missingEndpoints.push(endpoint);
    }
  }

  const allOk = missingWhitelist.length === 0 && missingEndpoints.length === 0;
  if (allOk) {
    ok('FVM endpoint\'ai whitelist\'e', [
      `Whitelist wildcard'ai: ${requiredWhitelistEntries.length}`,
      `Konkretūs action'ai: ${FVM_REQUIRED_ENDPOINTS.length}`,
    ]);
  } else {
    const details: string[] = [];
    if (missingWhitelist.length > 0) {
      details.push(`Trūksta whitelist'e: ${missingWhitelist.join(', ')}`);
    }
    if (missingEndpoints.length > 0) {
      details.push(
        `Trūksta alias'ų: ${missingEndpoints.slice(0, 5).join(', ')}${missingEndpoints.length > 5 ? ` ... (+${missingEndpoints.length - 5})` : ''}`,
      );
    }
    fail('FVM endpoint\'ai whitelist\'e', details);
  }
}

/**
 * Check #6: Visos FVM migracijos užregistruotos knex_migrations lentelėje.
 */
async function checkMigrationsApplied(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('knex_migrations');
  if (!hasTable) {
    fail('FVM migracijos paleistos', [
      'knex_migrations lentelė neegzistuoja — nepaleista nei viena migracija',
    ]);
    return;
  }

  const rows = (await knex('knex_migrations').select<Array<{ name: string }>>(
    'name',
  )) as Array<{ name: string }>;
  const appliedSet = new Set(rows.map((r) => r.name));

  const missing: string[] = [];
  for (const m of FVM_MIGRATIONS) {
    // Knex saugo su .ts arba .js extension priklausomai nuo runtime'o.
    const base = m.replace(/\.ts$/, '');
    const hasTs = appliedSet.has(m);
    const hasJs = appliedSet.has(`${base}.js`);
    if (!hasTs && !hasJs) missing.push(m);
  }

  if (missing.length === 0) {
    ok('FVM migracijos paleistos', [
      `Visos ${FVM_MIGRATIONS.length} FVM migracijos užregistruotos`,
    ]);
  } else {
    fail('FVM migracijos paleistos', [
      `Trūksta ${missing.length} migracijų: ${missing.join(', ')}`,
      'Paleisk: yarn workspace @biip-finansai/api db:migrate',
    ]);
  }
}

// --- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`${COLOR_BOLD}\nFVM Verification — Iter 16 (FVM-8)${COLOR_RESET}`);
  console.log('═'.repeat(60));

  const knex = knexFactory(createKnexConfig());

  try {
    // Greitas DB ping prieš įvairius check'us.
    try {
      await knex.raw('SELECT 1');
    } catch (err) {
      console.error(
        `${COLOR_RED}DB connection FAIL: ${(err as Error).message}${COLOR_RESET}`,
      );
      console.error('Patikrink DB_CONNECTION env kintamąjį.');
      process.exit(1);
    }

    await checkFvmTables(knex);
    await checkClassifiers(knex);
    await checkExpensesPayrollProfileColumn(knex);
    await checkProjectsIsDuSystemColumn(knex);
    checkApiEndpoints();
    await checkMigrationsApplied(knex);
  } finally {
    await knex.destroy();
  }

  // Output sumavimas.
  let passCount = 0;
  let failCount = 0;
  for (const r of results) {
    const tag = r.ok
      ? `${COLOR_GREEN}PASS${COLOR_RESET}`
      : `${COLOR_RED}FAIL${COLOR_RESET}`;
    console.log(`\n[${tag}] ${COLOR_BOLD}${r.name}${COLOR_RESET}`);
    for (const d of r.details) {
      const indent = r.ok ? COLOR_GREEN : COLOR_YELLOW;
      console.log(`       ${indent}${d}${COLOR_RESET}`);
    }
    if (r.ok) passCount += 1;
    else failCount += 1;
  }

  console.log('\n' + '═'.repeat(60));
  console.log(
    `${COLOR_BOLD}Total:${COLOR_RESET} ${COLOR_GREEN}${passCount} PASS${COLOR_RESET}, ${failCount > 0 ? COLOR_RED : ''}${failCount} FAIL${failCount > 0 ? COLOR_RESET : ''}`,
  );

  if (failCount > 0) {
    console.log(
      `${COLOR_RED}${COLOR_BOLD}\n✗ FVM verification FAIL${COLOR_RESET}`,
    );
    process.exit(1);
  } else {
    console.log(
      `${COLOR_GREEN}${COLOR_BOLD}\n✓ FVM verification PASS${COLOR_RESET}`,
    );
    process.exit(0);
  }
}

// Top-level await ne visada palaikomas — wrap'iname.
main().catch((err) => {
  console.error(`${COLOR_RED}Unhandled error:${COLOR_RESET}`, err);
  process.exit(1);
});
