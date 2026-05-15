/**
 * Iter 1+2 seed: tenants, users + pavyzdiniai prašymai.
 *
 * Idempotent — truncatina ir įdeda iš naujo. Visi demo passwordai = "demo".
 */
import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';

interface TenantSeed {
  code: string;
  name: string;
  isApprover: boolean;
}

const TENANTS: TenantSeed[] = [
  { code: 'AM', name: 'Aplinkos ministerija', isApprover: true },
  { code: 'AAD', name: 'Aplinkos apsaugos departamentas', isApprover: false },
  { code: 'VSTT', name: 'Valstybinė saugomų teritorijų tarnyba', isApprover: false },
  { code: 'LGT', name: 'Lietuvos geologijos tarnyba', isApprover: false },
];

interface UserSeed {
  username: string;
  password: string;
  fullName: string;
  email: string;
  role: 'am_admin' | 'am_user' | 'org_admin' | 'org_user';
  tenantCode: string;
  amScopeOrgCodes?: string[] | null;
}

const USERS: UserSeed[] = [
  { username: 'am-admin', password: 'demo', fullName: 'AM Administratorius', email: 'admin@am.lt', role: 'am_admin', tenantCode: 'AM' },
  { username: 'demo', password: 'demo', fullName: 'Demo Administratorius', email: 'demo@am.lt', role: 'am_admin', tenantCode: 'AM' },
  { username: 'am-user', password: 'demo', fullName: 'AM Specialistas (visi)', email: 'specialistas@am.lt', role: 'am_user', tenantCode: 'AM' },
  { username: 'am-user-aad', password: 'demo', fullName: 'AM Specialistas (AAD)', email: 'aad-koordinatorius@am.lt', role: 'am_user', tenantCode: 'AM', amScopeOrgCodes: ['AAD'] },
  { username: 'aad-admin', password: 'demo', fullName: 'AAD Administratorius', email: 'admin@aad.lt', role: 'org_admin', tenantCode: 'AAD' },
  { username: 'aad-user', password: 'demo', fullName: 'AAD Specialistas', email: 'specialistas@aad.lt', role: 'org_user', tenantCode: 'AAD' },
  { username: 'vstt-admin', password: 'demo', fullName: 'VSTT Administratorius', email: 'admin@vstt.lt', role: 'org_admin', tenantCode: 'VSTT' },
  { username: 'vstt-user', password: 'demo', fullName: 'VSTT Specialistas', email: 'specialistas@vstt.lt', role: 'org_user', tenantCode: 'VSTT' },
  { username: 'lgt-admin', password: 'demo', fullName: 'LGT Administratorius', email: 'admin@lgt.lt', role: 'org_admin', tenantCode: 'LGT' },
  { username: 'lgt-user', password: 'demo', fullName: 'LGT Specialistas', email: 'specialistas@lgt.lt', role: 'org_user', tenantCode: 'LGT' },
];

interface RequestSeed {
  tenantCode: string;
  createdByUsername: string;
  status: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'APPROVED' | 'REJECTED';
  projectName: string;
  systemCode?: string;
  projectType?: string;
  description?: string;
  plannedWorks?: string;
  priority?: number;
  procurementStage?: string;
  costEquipment?: number;
  costMaintenance?: number;
  costDevelopment?: number;
  costAnalysis?: number;
  fundingFromIt?: number;
  q1?: number;
  q2?: number;
  q3?: number;
  q4?: number;
  responsibleInstitution?: string;
  executorName?: string;
  executorEmail?: string;
  implementationDeadline?: string;
  // Sprendimas (jei APPROVED/REJECTED/RETURNED)
  decisionAmount?: number;
  decisionSource?: string;
  decisionProtocol?: string;
  decisionOrder?: string;
  decisionByUsername?: string;
  // Komentarai (kronologiškai)
  comments?: Array<{
    authorUsername: string;
    kind: 'comment' | 'submitted' | 'returned' | 'approved' | 'rejected';
    body?: string;
    metadata?: Record<string, unknown>;
  }>;
}

const REQUESTS: RequestSeed[] = [
  // 1. AAD — DRAFT
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-user',
    status: 'DRAFT',
    projectName: 'AADIS modernizavimas — 2026 etapas',
    systemCode: 'AADIS',
    projectType: 'IT sistema',
    description: 'Aplinkos apsaugos departamento informacinės sistemos modernizavimas — funkcionalumo praplėtimas ir saugumo užtikrinimas.',
    plannedWorks: 'Architektūros pertvarkymas, naujų modulių diegimas, integracija su MinIO.',
    priority: 2,
    procurementStage: 'Pradėtas',
    costDevelopment: 35000,
    costMaintenance: 12000,
    fundingFromIt: 47000,
    q1: 10000,
    q2: 15000,
    q3: 12000,
    q4: 10000,
    responsibleInstitution: 'AAD',
    executorName: 'Tomas Kazlauskas',
    executorEmail: 'tomas.kazlauskas@aad.lt',
    implementationDeadline: '2026-12-31',
  },

  // 2. VSTT — SUBMITTED (laukia AM tvirtinimo)
  {
    tenantCode: 'VSTT',
    createdByUsername: 'vstt-user',
    status: 'SUBMITTED',
    projectName: 'Saugomų teritorijų geoportalo plėtra',
    systemCode: 'GEOSTT',
    projectType: 'IT sistema',
    description: 'Geoportalo platformos atnaujinimas, naujų sluoksnių pridėjimas, mobiliosios versijos paleidimas.',
    plannedWorks: 'Frontend perrašymas (React), backend API plėtra, mobiliosios versijos PWA.',
    priority: 1,
    procurementStage: 'Vykdomas',
    costDevelopment: 60000,
    costMaintenance: 18000,
    costEquipment: 5000,
    fundingFromIt: 83000,
    q1: 20000,
    q2: 25000,
    q3: 25000,
    q4: 13000,
    responsibleInstitution: 'VSTT',
    executorName: 'Eglė Vaitkutė',
    executorEmail: 'egle.vaitkute@vstt.lt',
    implementationDeadline: '2026-11-30',
    comments: [
      { authorUsername: 'vstt-user', kind: 'submitted' },
    ],
  },

  // 3. LGT — RETURNED (AM grąžino pataisymui)
  {
    tenantCode: 'LGT',
    createdByUsername: 'lgt-user',
    status: 'RETURNED',
    projectName: 'Geologijos duomenų bazės migracija',
    systemCode: 'LGTDB',
    projectType: 'Migracija',
    description: 'Senos Oracle DB migracija į PostgreSQL/PostGIS aplinką.',
    plannedWorks: 'Schema mappingas, ETL skriptai, paralelinė validacija, cutover.',
    priority: 3,
    procurementStage: 'Pradėtas',
    costDevelopment: 28000,
    costAnalysis: 8000,
    fundingFromIt: 36000,
    q1: 10000,
    q2: 14000,
    q3: 8000,
    q4: 4000,
    responsibleInstitution: 'LGT',
    executorName: 'Marius Petraitis',
    executorEmail: 'marius.petraitis@lgt.lt',
    implementationDeadline: '2026-10-31',
    decisionByUsername: 'am-admin',
    comments: [
      { authorUsername: 'lgt-user', kind: 'submitted' },
      {
        authorUsername: 'am-admin',
        kind: 'returned',
        body: 'Trūksta detalesnio rizikų aprašymo ir kvartalinis paskirstymas neatitinka bendros sumos. Pakoreguokite Q3-Q4 ir pridėkite migracijos rizikas su prevencija.',
        metadata: { fromStatus: 'SUBMITTED', toStatus: 'RETURNED' },
      },
    ],
  },

  // 4. AAD — APPROVED
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-admin',
    status: 'APPROVED',
    projectName: 'Ugniasienės licencijų atnaujinimas 2026',
    systemCode: 'INFRA',
    projectType: 'Licencijos',
    description: 'Tinklo apsaugos ugniasienės licencijų pratęsimas 12 mėn.',
    plannedWorks: 'Licencijų pirkimas, diegimas, konfigūracijos patikra.',
    priority: 1,
    procurementStage: 'Užbaigtas',
    costEquipment: 22000,
    fundingFromIt: 22000,
    q1: 22000,
    responsibleInstitution: 'AAD',
    executorName: 'Lina Petrauskienė',
    executorEmail: 'lina.petrauskiene@aad.lt',
    implementationDeadline: '2026-04-30',
    decisionAmount: 22000,
    decisionSource: 'Valstybės biudžeto lėšos (Aplinkos ministerija)',
    decisionProtocol: 'AM/IT-2026/04 (2026-04-15)',
    decisionOrder: 'A-2026/132',
    decisionByUsername: 'demo',
    comments: [
      { authorUsername: 'aad-admin', kind: 'submitted' },
      {
        authorUsername: 'demo',
        kind: 'approved',
        body: 'Patvirtinta. Skirta visa prašyta suma.',
        metadata: { fromStatus: 'SUBMITTED', toStatus: 'APPROVED' },
      },
    ],
  },

  // 5. VSTT — REJECTED
  {
    tenantCode: 'VSTT',
    createdByUsername: 'vstt-admin',
    status: 'REJECTED',
    projectName: 'Eksperimentinis dronų valdymo modulis',
    systemCode: 'GEOSTT',
    projectType: 'IT sistema',
    description: 'Bandomasis dronų užduočių planavimo modulis.',
    plannedWorks: 'Spec, prototipas, integracinis bandymas.',
    priority: 5,
    procurementStage: 'Pradėtas',
    costDevelopment: 18000,
    fundingFromIt: 18000,
    q1: 6000,
    q2: 6000,
    q3: 6000,
    responsibleInstitution: 'VSTT',
    executorName: 'Jonas Vaitkus',
    executorEmail: 'jonas.vaitkus@vstt.lt',
    implementationDeadline: '2026-09-30',
    decisionByUsername: 'am-user',
    comments: [
      { authorUsername: 'vstt-admin', kind: 'submitted' },
      {
        authorUsername: 'am-user',
        kind: 'rejected',
        body: 'Šiuo metu finansavimas neskiriamas — projektas nepatenka į prioritetinį 2026 m. plano sąrašą. Galite teikti pakartotinai kitiems metams.',
        metadata: { fromStatus: 'SUBMITTED', toStatus: 'REJECTED' },
      },
    ],
  },

  // 6. AAD — SUBMITTED (kitas pavyzdys AM puseje)
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-user',
    status: 'SUBMITTED',
    projectName: 'AADIS palaikymo paslaugos 2026',
    systemCode: 'AADIS',
    projectType: 'Palaikymas',
    description: 'Tęstinis IS palaikymas, SLA pagrindu.',
    plannedWorks: 'Incidentų valdymas, smulkūs patobulinimai, naudotojų konsultacijos.',
    priority: 2,
    procurementStage: 'Vykdomas',
    costMaintenance: 48000,
    fundingFromIt: 48000,
    q1: 12000,
    q2: 12000,
    q3: 12000,
    q4: 12000,
    responsibleInstitution: 'AAD',
    executorName: 'Renaldas Klimas',
    executorEmail: 'renaldas.klimas@aad.lt',
    implementationDeadline: '2026-12-31',
    comments: [{ authorUsername: 'aad-user', kind: 'submitted' }],
  },

  // 7. LGT — DRAFT
  {
    tenantCode: 'LGT',
    createdByUsername: 'lgt-admin',
    status: 'DRAFT',
    projectName: 'Žemės gelmių stebėsenos sistemos atnaujinimas',
    systemCode: 'GELMES',
    projectType: 'IT sistema',
    description: 'Stebėsenos sistemos vidinis atnaujinimas + sąsajos su EU portalu.',
    priority: 4,
    costAnalysis: 5000,
    costDevelopment: 15000,
    fundingFromIt: 20000,
    q1: 5000,
    q2: 10000,
    q3: 5000,
    responsibleInstitution: 'LGT',
  },
];

export async function seed(knex: Knex): Promise<void> {
  // Trinam viską reverse-order'iu.
  const hasRequests = await knex.schema.hasTable('requests');
  if (hasRequests) {
    await knex('request_comments').del();
    await knex('requests').del();
    await knex.raw('ALTER SEQUENCE requests_id_seq RESTART WITH 1');
    await knex.raw('ALTER SEQUENCE request_comments_id_seq RESTART WITH 1');
  }
  await knex('users').del();
  await knex('tenants').del();

  await knex.raw('ALTER SEQUENCE users_id_seq RESTART WITH 1');
  await knex.raw('ALTER SEQUENCE tenants_id_seq RESTART WITH 1');

  // 1) Tenants
  const tenantIdByCode: Record<string, number> = {};
  for (const t of TENANTS) {
    const inserted = (await knex('tenants')
      .insert({ code: t.code, name: t.name, is_approver: t.isApprover, active: true })
      .returning('id')) as Array<{ id: number }>;
    const firstRow = inserted[0];
    if (!firstRow) throw new Error(`Tenant insert failed: ${t.code}`);
    tenantIdByCode[t.code] = firstRow.id;
  }

  // 2) Users
  const userIdByUsername: Record<string, number> = {};
  for (const u of USERS) {
    const tenantId = tenantIdByCode[u.tenantCode];
    if (tenantId === undefined) {
      throw new Error(`Tenant code not found for user ${u.username}: ${u.tenantCode}`);
    }
    let amScopeOrgIds: number[] | null = null;
    if (u.amScopeOrgCodes !== undefined && u.amScopeOrgCodes !== null) {
      amScopeOrgIds = u.amScopeOrgCodes.map((c) => {
        const id = tenantIdByCode[c];
        if (id === undefined) throw new Error(`Scope tenant not found: ${c}`);
        return id;
      });
    }
    const passwordHash = await bcrypt.hash(u.password, 10);
    const inserted = (await knex('users')
      .insert({
        username: u.username,
        password_hash: passwordHash,
        full_name: u.fullName,
        email: u.email,
        role: u.role,
        tenant_id: tenantId,
        am_scope_org_ids: amScopeOrgIds,
        active: true,
      })
      .returning('id')) as Array<{ id: number }>;
    const firstRow = inserted[0];
    if (!firstRow) throw new Error(`User insert failed: ${u.username}`);
    userIdByUsername[u.username] = firstRow.id;
  }

  // 3) Requests + comments (jei lentelės jau migruotos)
  if (!hasRequests) return;

  const now = new Date().toISOString();

  for (const r of REQUESTS) {
    const tenantId = tenantIdByCode[r.tenantCode];
    const createdById = userIdByUsername[r.createdByUsername];
    const decidedById = r.decisionByUsername ? userIdByUsername[r.decisionByUsername] : null;
    if (tenantId === undefined || createdById === undefined) {
      throw new Error(`Request seed link broken: ${r.projectName}`);
    }
    const submittedAt = r.status !== 'DRAFT' ? now : null;
    const decidedAt = r.status === 'APPROVED' || r.status === 'REJECTED' || r.status === 'RETURNED' ? now : null;

    const inserted = (await knex('requests')
      .insert({
        tenant_id: tenantId,
        created_by_user_id: createdById,
        status: r.status,
        project_name: r.projectName,
        system_code: r.systemCode ?? null,
        project_type: r.projectType ?? null,
        description: r.description ?? null,
        planned_works: r.plannedWorks ?? null,
        priority: r.priority ?? null,
        procurement_stage: r.procurementStage ?? null,
        cost_du: 0,
        cost_equipment: r.costEquipment ?? 0,
        cost_creation: 0,
        cost_analysis: 0,
        cost_development: r.costDevelopment ?? 0,
        cost_maintenance: r.costMaintenance ?? 0,
        cost_modernization: 0,
        cost_decommissioning: 0,
        funding_from_it: r.fundingFromIt ?? 0,
        other_funds: 0,
        other_funds_source: null,
        q1_amount: r.q1 ?? 0,
        q2_amount: r.q2 ?? 0,
        q3_amount: r.q3 ?? 0,
        q4_amount: r.q4 ?? 0,
        responsible_institution: r.responsibleInstitution ?? null,
        executor_name: r.executorName ?? null,
        executor_email: r.executorEmail ?? null,
        implementation_deadline: r.implementationDeadline ?? null,
        submitter_notes: null,
        decision_granted_amount: r.decisionAmount ?? null,
        decision_funding_source: r.decisionSource ?? null,
        decision_protocol: r.decisionProtocol ?? null,
        decision_order: r.decisionOrder ?? null,
        decided_at: decidedAt,
        decided_by_user_id: decidedById,
        submitted_at: submittedAt,
      })
      .returning('id')) as Array<{ id: number }>;
    const reqId = inserted[0]?.id;
    if (!reqId) throw new Error(`Request insert failed: ${r.projectName}`);

    for (const c of r.comments ?? []) {
      const authorId = userIdByUsername[c.authorUsername];
      if (authorId === undefined) {
        throw new Error(`Comment author not found: ${c.authorUsername}`);
      }
      await knex('request_comments').insert({
        request_id: reqId,
        author_user_id: authorId,
        kind: c.kind,
        body: c.body ?? null,
        metadata: c.metadata ? JSON.stringify(c.metadata) : null,
      });
    }
  }
}
