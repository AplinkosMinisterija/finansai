/**
 * Po-MVP seed: demo aprobacijos žingsniai (#9), atsiskaitymai (#2),
 * prikabinti dokumentai (#13).
 *
 * Vykdomas po 01 (prašymai) ir 02 (klasifikatoriai). Idempotent — truncatina
 * tik šio seed'o lenteles.
 *
 * Tikslas — kad Giedrei testuojant į kiekvieną feature'ą tikti realūs duomenys,
 * o ne tušti komponentai.
 */
import type { Knex } from 'knex';

// Minimalus 1x1 PDF placeholder (validus PDF su tuščiu puslapiu, ~1 KB base64).
// Naudojamas tik kaip demo failas — turinys nereikšmingas, svarbu kad mime + dydis OK.
const DEMO_PDF_BASE64 =
  'JVBERi0xLjQKJeLjz9MKMyAwIG9iago8PC9MZW5ndGggNiAwIFIvRmlsdGVyIC9GbGF0ZURlY29kZT4+CnN0cmVhbQp4nFWMOw7CMBAFr/IqRkLY3thrJ0FCQpwiVQpKBKlSpKBLwf2hMHEISXEMM2/2DSdkb6E0hQbDscQzbqGWBN0Q4o5JEZCDXOEcyckSScVNvqkx5oASJYCKDWUkqxa1xkRrLNoVUJpfvKfk+/IhRVKfDvKgWtZE8w7+0hT+P+Dw9wO5GBoOCmVuZHN0cmVhbQplbmRvYmoKNiAwIG9iago2OQplbmRvYmoKNCAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3ggWzAgMCAxMDAgMTAwXQovUmVzb3VyY2VzPDw+Pi9Db250ZW50cyAzIDAgUi9QYXJlbnQgMiAwIFI+PgplbmRvYmoKNSAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDEvS2lkcyBbNCAwIFJdPj4KZW5kb2JqCjEgMCBvYmoKPDwvVHlwZSAvQ2F0YWxvZy9QYWdlcyA1IDAgUj4+CmVuZG9iagoyIDAgb2JqCjw8L1RpdGxlIChEZW1vIFBERikvUHJvZHVjZXIgKEFNIEZpbmFuc2FpKT4+CmVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDA0MTYgMDAwMDAgbiAKMDAwMDAwMDQ2NSAwMDAwMCBuIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAyMzcgMDAwMDAgbiAKMDAwMDAwMDM2NSAwMDAwMCBuIAowMDAwMDAwMjE2IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA3L1Jvb3QgMSAwIFIvSW5mbyAyIDAgUj4+CnN0YXJ0eHJlZgo1MTcKJSVFT0YK';

export async function seed(knex: Knex): Promise<void> {
  // Saugumas — patikrinam, ar atitinkamos lentelės yra po migracijų.
  if (!(await knex.schema.hasTable('approval_steps'))) return;
  if (!(await knex.schema.hasTable('requests'))) return;

  await knex('approval_steps').del();
  await knex.raw('ALTER SEQUENCE approval_steps_id_seq RESTART WITH 1');
  if (await knex.schema.hasTable('request_attachments')) {
    await knex('request_attachments').del();
    await knex.raw('ALTER SEQUENCE request_attachments_id_seq RESTART WITH 1');
  }
  if (await knex.schema.hasTable('request_reports')) {
    await knex('request_reports').del();
    await knex.raw('ALTER SEQUENCE request_reports_id_seq RESTART WITH 1');
  }

  // 1) Aprobacijos žingsniai — visiems pateiktiems / spręstiems prašymams.
  //    AAD scope: 1 žingsnis su level_code = AM_ADMIN.
  const requests = (await knex('requests').select(
    'id',
    'status',
    'decided_by_user_id',
    'decided_at',
    'submitted_at',
  )) as Array<{
    id: number;
    status: string;
    decided_by_user_id: number | null;
    decided_at: string | null;
    submitted_at: string | null;
  }>;

  for (const r of requests) {
    // DRAFT — neturėjo būti pateiktas, žingsnių nesukuriam.
    if (r.status === 'DRAFT') continue;

    let stepStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED';
    if (r.status === 'SUBMITTED') stepStatus = 'PENDING';
    else if (r.status === 'APPROVED') stepStatus = 'APPROVED';
    else if (r.status === 'REJECTED') stepStatus = 'REJECTED';
    else if (r.status === 'RETURNED') stepStatus = 'RETURNED';
    else continue;

    await knex('approval_steps').insert({
      request_id: r.id,
      sequence: 1,
      level_code: 'AM_ADMIN',
      level_name: 'AM administratorius',
      status: stepStatus,
      decided_by_user_id: stepStatus === 'PENDING' ? null : r.decided_by_user_id,
      decided_at: stepStatus === 'PENDING' ? null : r.decided_at,
      comment: null,
    });
  }

  // 2) Demo dokumentai — vienas potvarkio PDF prie pirmų 3 APPROVED prašymų.
  if (await knex.schema.hasTable('request_attachments')) {
    const approvedRequests = (await knex('requests')
      .where('status', 'APPROVED')
      .whereNotNull('decided_by_user_id')
      .orderBy('id', 'asc')
      .limit(3)
      .select('id', 'decided_by_user_id', 'decision_order')) as Array<{
      id: number;
      decided_by_user_id: number;
      decision_order: string | null;
    }>;

    for (const r of approvedRequests) {
      const fileName = `${(r.decision_order ?? `potvarkis-${r.id}`).replace(/[^\w.-]/g, '_')}.pdf`;
      await knex('request_attachments').insert({
        request_id: r.id,
        kind: 'order_pdf',
        file_name: fileName,
        mime_type: 'application/pdf',
        size_bytes: Math.floor((DEMO_PDF_BASE64.length * 3) / 4),
        data_base64: DEMO_PDF_BASE64,
        uploaded_by_user_id: r.decided_by_user_id,
      });
    }
  }

  // 3) Demo atsiskaitymai — Q1 SUBMITTED + Q2 DRAFT prie pirmojo APPROVED prašymo
  //    (kuris turi `aad-admin` arba pan. teikėją).
  if (await knex.schema.hasTable('request_reports')) {
    const firstApproved = (await knex('requests')
      .where('status', 'APPROVED')
      .whereNotNull('decision_granted_amount')
      .orderBy('id', 'asc')
      .first('id', 'created_by_user_id', 'decision_granted_amount', 'year')) as
      | {
          id: number;
          created_by_user_id: number;
          decision_granted_amount: string | null;
          year: number;
        }
      | undefined;

    if (firstApproved) {
      const grantedAmount = Number.parseFloat(firstApproved.decision_granted_amount ?? '0') || 0;
      // Q1: 30% panaudota, SUBMITTED
      await knex('request_reports').insert({
        request_id: firstApproved.id,
        period_year: firstApproved.year,
        period_quarter: 1,
        amount_used: (grantedAmount * 0.3).toFixed(2),
        description:
          'Q1 atsiskaitymas: pradinis darbų etapas. Licencijų pirkimas, komandos kompetencijų ugdymas.',
        status: 'SUBMITTED',
        submitted_by_user_id: firstApproved.created_by_user_id,
        submitted_at: new Date().toISOString(),
      });
      // Q2: 25% panaudota, DRAFT (vis dar pildomas)
      await knex('request_reports').insert({
        request_id: firstApproved.id,
        period_year: firstApproved.year,
        period_quarter: 2,
        amount_used: (grantedAmount * 0.25).toFixed(2),
        description: 'Q2 atsiskaitymas (juodraštis) — pildoma.',
        status: 'DRAFT',
        submitted_by_user_id: firstApproved.created_by_user_id,
        submitted_at: null,
      });
    }
  }
}
