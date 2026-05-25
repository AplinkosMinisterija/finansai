/**
 * UAT #42 (PA-006): į `requests` lentelę pridedam `decision_order_date` —
 * AM sprendimo (įsakymo) data.
 *
 * Kontekstas: sprendimo formoje „Įsakymas (data, nr.)" buvo laisvo teksto
 * laukas (`decision_order`). Datai dabar naudojam atskirą date-picker lauką
 * (`decision_order_date`), o `decision_order` lieka įsakymo numeriui/pavadinimui.
 *
 * Laukas nullable — backward compatibility seniems prašymams.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('requests', (t) => {
    t.date('decision_order_date').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('requests', (t) => {
    t.dropColumn('decision_order_date');
  });
}
