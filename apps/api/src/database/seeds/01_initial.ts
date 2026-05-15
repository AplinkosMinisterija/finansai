/**
 * Iter 6 seed: tenants + users (admin/user rolės) + pavyzdiniai prašymai.
 *
 * Idempotent — truncatina ir įdeda iš naujo. Visi demo passwordai = "demo".
 *
 * Role'ės semantika nustatoma per `tenant.is_approver`:
 *   - is_approver=true  (AM)  → admin/user yra "tvirtintojai"
 *   - is_approver=false (kiti) → admin/user yra "teikėjai"
 */
import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';

interface TenantSeed {
  code: string;
  name: string;
  description: string;
  isApprover: boolean;
}

const TENANTS: TenantSeed[] = [
  {
    code: 'AM',
    name: 'Aplinkos ministerija',
    description: 'Pagrindinė ministerija. Tvirtina pavaldžių institucijų finansavimo prašymus.',
    isApprover: true,
  },
  {
    code: 'AAD',
    name: 'Aplinkos apsaugos departamentas',
    description: 'Vykdomoji institucija aplinkos apsaugos kontrolės srityje.',
    isApprover: false,
  },
  {
    code: 'VSTT',
    name: 'Valstybinė saugomų teritorijų tarnyba',
    description: 'Tvarko saugomas teritorijas (parkus, rezervatus, draustinius).',
    isApprover: false,
  },
  {
    code: 'LGT',
    name: 'Lietuvos geologijos tarnyba',
    description: 'Vykdo geologijos ir žemės gelmių stebėseną bei tyrimus.',
    isApprover: false,
  },
];

interface UserSeed {
  username: string;
  password: string;
  fullName: string;
  email: string;
  role: 'admin' | 'user';
  tenantCode: string;
  amScopeOrgCodes?: string[] | null;
}

const USERS: UserSeed[] = [
  // AM (approver)
  {
    username: 'demo',
    password: 'demo',
    fullName: 'Demo Administratorius',
    email: 'demo@am.lt',
    role: 'admin',
    tenantCode: 'AM',
  },
  {
    username: 'am-admin',
    password: 'demo',
    fullName: 'Jonas Administratorius',
    email: 'jonas.administratorius@am.lt',
    role: 'admin',
    tenantCode: 'AM',
  },
  {
    username: 'am-user',
    password: 'demo',
    fullName: 'Petras Specialistas',
    email: 'petras.specialistas@am.lt',
    role: 'user',
    tenantCode: 'AM',
    // null = visos org'os
  },
  {
    username: 'am-user-aad',
    password: 'demo',
    fullName: 'Agnė AAD Koordinatorė',
    email: 'agne.koordinatore@am.lt',
    role: 'user',
    tenantCode: 'AM',
    amScopeOrgCodes: ['AAD'],
  },
  // AAD
  {
    username: 'aad-admin',
    password: 'demo',
    fullName: 'AAD Administratorius',
    email: 'admin@aad.lt',
    role: 'admin',
    tenantCode: 'AAD',
  },
  {
    username: 'aad-user',
    password: 'demo',
    fullName: 'AAD Specialistas',
    email: 'specialistas@aad.lt',
    role: 'user',
    tenantCode: 'AAD',
  },
  // VSTT
  {
    username: 'vstt-admin',
    password: 'demo',
    fullName: 'VSTT Administratorius',
    email: 'admin@vstt.lt',
    role: 'admin',
    tenantCode: 'VSTT',
  },
  {
    username: 'vstt-user',
    password: 'demo',
    fullName: 'VSTT Specialistas',
    email: 'specialistas@vstt.lt',
    role: 'user',
    tenantCode: 'VSTT',
  },
  // LGT
  {
    username: 'lgt-admin',
    password: 'demo',
    fullName: 'LGT Administratorius',
    email: 'admin@lgt.lt',
    role: 'admin',
    tenantCode: 'LGT',
  },
  {
    username: 'lgt-user',
    password: 'demo',
    fullName: 'LGT Specialistas',
    email: 'specialistas@lgt.lt',
    role: 'user',
    tenantCode: 'LGT',
  },
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
  costDu?: number;
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
  decisionAmount?: number;
  decisionSource?: string;
  decisionProtocol?: string;
  decisionOrder?: string;
  decisionByUsername?: string;
  /** Optionaliai konkretūs offset'ai nuo dabarties (dienomis), trends'ams. */
  submittedDaysAgo?: number;
  decidedDaysAgo?: number;
  comments?: Array<{
    authorUsername: string;
    kind: 'comment' | 'submitted' | 'returned' | 'approved' | 'rejected';
    body?: string;
    metadata?: Record<string, unknown>;
  }>;
}

const REQUESTS: RequestSeed[] = [
  // ── DRAFT ──
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

  // ── SUBMITTED — laukia AM tvirtinimo ──
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
    submittedDaysAgo: 2,
    comments: [{ authorUsername: 'vstt-user', kind: 'submitted' }],
  },
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
    submittedDaysAgo: 5,
    comments: [{ authorUsername: 'aad-user', kind: 'submitted' }],
  },
  // SUBMITTED — AM admin sukurtas pavaldžios org vardu
  {
    tenantCode: 'LGT',
    createdByUsername: 'demo',
    status: 'SUBMITTED',
    projectName: 'GELMES interfaceų lokalizacija (AM admin pavedimu)',
    systemCode: 'GELMES',
    projectType: 'Lokalizacija',
    description: 'Pavedimas, kad AM admin sukurtų prašymą LGT vardu — testinis flow.',
    plannedWorks: 'Lokalizacijos atnaujinimas, kalbų failo refaktoringas.',
    priority: 3,
    procurementStage: 'Pradėtas',
    costDevelopment: 8000,
    fundingFromIt: 8000,
    q1: 4000,
    q2: 4000,
    responsibleInstitution: 'LGT',
    executorName: 'Marius Petraitis',
    executorEmail: 'marius.petraitis@lgt.lt',
    submittedDaysAgo: 1,
    comments: [{ authorUsername: 'demo', kind: 'submitted' }],
  },

  // ── RETURNED ──
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
    submittedDaysAgo: 10,
    decidedDaysAgo: 7,
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

  // ── APPROVED ──
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
    submittedDaysAgo: 60,
    decidedDaysAgo: 45,
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
  {
    tenantCode: 'VSTT',
    createdByUsername: 'vstt-admin',
    status: 'APPROVED',
    projectName: 'GeoSTT serverio atnaujinimas',
    systemCode: 'GEOSTT',
    projectType: 'Įranga',
    description: 'Senstančio serverio (2018 m.) keitimas naujesniu.',
    priority: 2,
    procurementStage: 'Užbaigtas',
    costEquipment: 18000,
    fundingFromIt: 18000,
    q1: 18000,
    responsibleInstitution: 'VSTT',
    executorName: 'Audrius Tamošaitis',
    implementationDeadline: '2026-03-15',
    decisionAmount: 17500,
    decisionSource: 'Valstybės biudžeto lėšos',
    decisionProtocol: 'AM/IT-2026/02',
    decisionOrder: 'A-2026/45',
    decisionByUsername: 'am-admin',
    submittedDaysAgo: 90,
    decidedDaysAgo: 75,
    comments: [
      { authorUsername: 'vstt-admin', kind: 'submitted' },
      {
        authorUsername: 'am-admin',
        kind: 'approved',
        body: 'Patvirtinta. Suma sumažinta atsižvelgiant į rinkos kainų derybas.',
        metadata: { fromStatus: 'SUBMITTED', toStatus: 'APPROVED' },
      },
    ],
  },
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-admin',
    status: 'APPROVED',
    projectName: 'Specialistų mokymai 2026',
    systemCode: 'HR',
    projectType: 'Mokymai',
    description: 'Aplinkos apsaugos specialistų kvalifikacijos kėlimas.',
    priority: 3,
    costDu: 0,
    costMaintenance: 6000,
    fundingFromIt: 6000,
    q2: 3000,
    q3: 3000,
    responsibleInstitution: 'AAD',
    executorName: 'Lina Petrauskienė',
    implementationDeadline: '2026-09-30',
    decisionAmount: 5500,
    decisionSource: 'Valstybės biudžeto lėšos',
    decisionProtocol: 'AM/IT-2026/03',
    decisionOrder: 'A-2026/89',
    decisionByUsername: 'am-user',
    submittedDaysAgo: 30,
    decidedDaysAgo: 20,
    comments: [
      { authorUsername: 'aad-admin', kind: 'submitted' },
      {
        authorUsername: 'am-user',
        kind: 'approved',
        body: 'Patvirtinta.',
        metadata: { fromStatus: 'SUBMITTED', toStatus: 'APPROVED' },
      },
    ],
  },

  // ── REJECTED ──
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
    submittedDaysAgo: 40,
    decidedDaysAgo: 25,
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
];

function daysAgoIso(days?: number): string | null {
  if (days === undefined) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export async function seed(knex: Knex): Promise<void> {
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
      .insert({
        code: t.code,
        name: t.name,
        description: t.description,
        is_approver: t.isApprover,
        active: true,
      })
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

  // 3) Requests + comments
  if (!hasRequests) return;

  for (const r of REQUESTS) {
    const tenantId = tenantIdByCode[r.tenantCode];
    const createdById = userIdByUsername[r.createdByUsername];
    const decidedById = r.decisionByUsername ? userIdByUsername[r.decisionByUsername] : null;
    if (tenantId === undefined || createdById === undefined) {
      throw new Error(`Request seed link broken: ${r.projectName}`);
    }
    const submittedAt = r.submittedDaysAgo !== undefined
      ? daysAgoIso(r.submittedDaysAgo)
      : r.status !== 'DRAFT' ? new Date().toISOString() : null;
    const decidedAt = r.decidedDaysAgo !== undefined
      ? daysAgoIso(r.decidedDaysAgo)
      : (r.status === 'APPROVED' || r.status === 'REJECTED' || r.status === 'RETURNED'
          ? new Date().toISOString()
          : null);

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
        cost_analysis: r.costAnalysis ?? 0,
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
