/**
 * Jest global teardown — vyksta VIENĄ kartą po visų test failų.
 *
 * Pagal brief'ą: DB ne-drop'inam, kad būtų galima inspect'inti failure
 * lokaliai (`psql finansai_test`). Šis hook'as tik užtikrina, kad jokios
 * šalutinės connections nepasiliktų — jest pasibaigs švariai.
 *
 * Per-test `getTestKnex()` instance'ai uždaromi pačiame test'e per
 * `afterAll` (žr. `helpers/db.ts` ir spec'ų pavyzdžius). Šis teardown
 * yra paskutinis safety net.
 */
export default async function globalTeardown(): Promise<void> {
  // Šiuo metu nieko aktyvaus — placeholder ateičiai (pvz., shared test
  // resource cleanup). Knex/Redis closing'as vyksta test failuose pačiuose.
}
