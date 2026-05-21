/**
 * Per-test ENV setup (`setupFiles` Jest config).
 *
 * Paleidžiamas KIEKVIENAM test failui PRIEŠ test framework'ą — tinkamas
 * vieta užtikrinti, kad ENV kintamieji jau yra prieš tai, kai bet kuris
 * `src/` modulis (`knexfile`, `redis`, ...) inicializuojasi `import` metu.
 *
 * - `NODE_ENV='test'` — kad nedaryti dev-only side effect'ų
 * - `DB_CONNECTION` — visi `src/database/db.ts` callai naudos test DB
 * - `LOGLEVEL` — testuose tylu (override `.env`'ą iš dev seto)
 * - `REDIS_URL` — atskiras Redis namespace nenaudojamas (testai mock'us
 *   patys spręs), bet vis tiek ne-prod URL'as
 *
 * `TEST_DB_CONNECTION` (CI/CD frindly) — override; fallback į localhost
 * `finansai_test` DB sukurta `global-setup.ts` metu.
 *
 * Sąmoningai NEĮKELIAME `dotenv/config` — `.env` yra DEV kontekstui (be kita
 * ko nustato `DB_CONNECTION=...finansai` ir `LOGLEVEL=info`), test'uose tai
 * būtų nuoteka. Jei reikia ENV override'inti CI'uje — eksportuok iš shell'o.
 */

const DEFAULT_TEST_CONNECTION =
  'postgresql://finansai:finansai@localhost:5433/finansai_test';

process.env['NODE_ENV'] = 'test';

const testConn = process.env['TEST_DB_CONNECTION'] ?? DEFAULT_TEST_CONNECTION;
process.env['DB_CONNECTION'] = testConn;
process.env['TEST_DB_CONNECTION'] = testConn;

if (!process.env['REDIS_URL']) {
  process.env['REDIS_URL'] = 'redis://localhost:6380';
}

// Tylus logger broker'iui. `.env` faile dažnai būna `LOGLEVEL=info` (dev'ui),
// tačiau ji jau gali būti įkrauta prieš mus per `global-setup`-> knexfile'o
// `import 'dotenv/config'`. Todėl test'uose force'inam 'error', NEBENT
// pats vartotojas eksplicitiškai paleido su LOGLEVEL=debug/info shell'e.
//
// Heuristika: kai LOGLEVEL nesetinta arba lygus 'info' (default'as iš .env),
// laikom kad tai ne explicit override — force'inam 'error'. Kitos reikšmės
// (debug, trace, warn) — paliekam kaip explicit user choice.
const currentLogLevel = process.env['LOGLEVEL'];
if (
  currentLogLevel === undefined ||
  currentLogLevel === '' ||
  currentLogLevel === 'info'
) {
  process.env['LOGLEVEL'] = 'error';
}
