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
  /** Issue #9: AM tvirtintojo aprobacijos lygiai (approval_levels kodai). */
  approvalLevelCodes?: string[];
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
    // Issue #9: AM paraiškų administratorius — 1-as workflow žingsnis.
    approvalLevelCodes: ['AM_ADMIN'],
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
  // Issue #9: demo daugiapakopio workflow tvirtintojai (departamentas, kancleris).
  {
    username: 'am-departamentas',
    password: 'demo',
    fullName: 'Rasa Departamento Vadovė',
    email: 'rasa.departamentas@am.lt',
    role: 'user',
    tenantCode: 'AM',
    approvalLevelCodes: ['DEPARTMENT'],
  },
  {
    username: 'am-kancleris',
    password: 'demo',
    fullName: 'Tomas Kancleris',
    email: 'tomas.kancleris@am.lt',
    role: 'user',
    tenantCode: 'AM',
    approvalLevelCodes: ['CHANCELLOR'],
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
  status: 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'APPROVED' | 'REJECTED' | 'NEAKTUALU';
  /** Metai prašymui/planui. Default = currentYear. > currentYear = planas. */
  year?: number;
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
    kind: 'comment' | 'submitted' | 'returned' | 'approved' | 'rejected' | 'marked_not_relevant';
    body?: string;
    metadata?: Record<string, unknown>;
  }>;
}

// ── Helper'iai REQUESTS array kompaktiškumui ──

function approved(amount: number, year: 2025 | 2026, by: string, num: number) {
  // Šaltinio programa — klasifikatoriaus `source_program` kodas (issue #8).
  // Mišinio dėl demo įvairovės: didžioji dalis iš IT biudžeto, kelios iš ES.
  const sources = ['AM_IT_BUDGET', 'AM_IT_BUDGET', 'AM_IT_BUDGET', 'AM_DEVELOPMENT', 'EU_FUNDS'];
  return {
    decisionAmount: amount,
    decisionSource: sources[num % sources.length]!,
    decisionProtocol: `AM-FIN-${year}/${String(num).padStart(3, '0')}`,
    decisionOrder: `AM Įsakymas ${year}/A-${100 + num}`,
    decisionByUsername: by,
  };
}

function approvedComments(by: string, am: string, body?: string): RequestSeed['comments'] {
  return [
    { authorUsername: by, kind: 'submitted' },
    {
      authorUsername: am,
      kind: 'approved',
      body,
      metadata: { fromStatus: 'SUBMITTED', toStatus: 'APPROVED' },
    },
  ];
}

function rejectedComments(by: string, am: string, body: string): RequestSeed['comments'] {
  return [
    { authorUsername: by, kind: 'submitted' },
    {
      authorUsername: am,
      kind: 'rejected',
      body,
      metadata: { fromStatus: 'SUBMITTED', toStatus: 'REJECTED' },
    },
  ];
}

function returnedComments(by: string, am: string, body: string): RequestSeed['comments'] {
  return [
    { authorUsername: by, kind: 'submitted' },
    {
      authorUsername: am,
      kind: 'returned',
      body,
      metadata: { fromStatus: 'SUBMITTED', toStatus: 'RETURNED' },
    },
  ];
}

const REQUESTS: RequestSeed[] = [
  // ╔══════════════════════════════════════════════════════════════╗
  // ║ HISTORICAL APPROVED — 12 mėn dinamikos pagrindas             ║
  // ╚══════════════════════════════════════════════════════════════╝

  // ── 2025-05/06 (~340-300 dienų atgal) ──
  {
    tenantCode: 'LGT',
    createdByUsername: 'lgt-admin',
    status: 'APPROVED',
    projectName: 'Geofiziniai matavimai 2025',
    systemCode: 'GELMES',
    projectType: 'RESEARCH',
    priority: 2,
    procurementStage: 'Užbaigta',
    costAnalysis: 8000,
    costDevelopment: 14000,
    fundingFromIt: 22000,
    q2: 11000,
    q3: 11000,
    responsibleInstitution: 'LGT',
    executorName: 'Rasa Janušienė',
    executorEmail: 'rasa.janusiene@lgt.lt',
    implementationDeadline: '2025-12-15',
    submittedDaysAgo: 340,
    decidedDaysAgo: 332,
    ...approved(22000, 2025, 'am-admin', 12),
    comments: approvedComments('lgt-admin', 'am-admin'),
  },
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-admin',
    status: 'APPROVED',
    projectName: 'AADIS centrinio modulio licencijos 2025',
    systemCode: 'AADIS',
    projectType: 'SOFTWARE',
    priority: 1,
    procurementStage: 'Sutartis pasirašyta',
    costEquipment: 28000,
    fundingFromIt: 28000,
    q2: 28000,
    responsibleInstitution: 'AAD',
    executorName: 'Tomas Burba',
    executorEmail: 'tomas.burba@aad.lt',
    implementationDeadline: '2025-12-31',
    submittedDaysAgo: 335,
    decidedDaysAgo: 325,
    ...approved(28000, 2025, 'am-admin', 15),
    comments: approvedComments(
      'aad-admin',
      'am-admin',
      'Licencijos kasmetinis atnaujinimas — patvirtinta pilnai.',
    ),
  },

  // ── 2025-07 (~305-280 dienų) ──
  {
    tenantCode: 'VSTT',
    createdByUsername: 'vstt-admin',
    status: 'APPROVED',
    projectName: 'VSTT mokymų platforma',
    systemCode: null as unknown as string,
    projectType: 'IT_SYSTEM',
    priority: 3,
    procurementStage: 'Įdiegta',
    costDevelopment: 12000,
    costMaintenance: 3000,
    fundingFromIt: 15000,
    q3: 8000,
    q4: 7000,
    responsibleInstitution: 'VSTT',
    executorName: 'Aušra Petrulienė',
    executorEmail: 'ausra.petruliene@vstt.lt',
    implementationDeadline: '2026-03-31',
    submittedDaysAgo: 305,
    decidedDaysAgo: 298,
    ...approved(15000, 2025, 'am-user', 22),
    comments: approvedComments('vstt-admin', 'am-user'),
  },
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-user',
    status: 'APPROVED',
    projectName: 'AADIS palaikymas Q3-Q4 2025',
    systemCode: 'AADIS',
    projectType: 'IT_SUPPORT',
    priority: 1,
    procurementStage: 'Vykdoma',
    costMaintenance: 8500,
    fundingFromIt: 8500,
    q3: 4500,
    q4: 4000,
    responsibleInstitution: 'AAD',
    executorName: 'Tomas Burba',
    executorEmail: 'tomas.burba@aad.lt',
    implementationDeadline: '2025-12-31',
    submittedDaysAgo: 300,
    decidedDaysAgo: 290,
    ...approved(8500, 2025, 'am-user', 25),
    comments: approvedComments('aad-user', 'am-user'),
  },

  // ── 2025-08 (~275-260 dienų) ──
  {
    tenantCode: 'LGT',
    createdByUsername: 'lgt-user',
    status: 'APPROVED',
    projectName: 'GELMES vartotojų vadovas',
    systemCode: 'GELMES',
    projectType: 'DOCUMENTATION',
    priority: 4,
    procurementStage: 'Užbaigta',
    costAnalysis: 4000,
    costDevelopment: 8000,
    fundingFromIt: 12000,
    q3: 6000,
    q4: 6000,
    responsibleInstitution: 'LGT',
    executorName: 'Vilma Klimaitė',
    executorEmail: 'vilma.klimaite@lgt.lt',
    implementationDeadline: '2025-12-31',
    submittedDaysAgo: 275,
    decidedDaysAgo: 268,
    ...approved(12000, 2025, 'am-user', 28),
    comments: approvedComments('lgt-user', 'am-user'),
  },
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-admin',
    status: 'APPROVED',
    projectName: 'AADIS API integracija su VATESI',
    systemCode: 'AADIS',
    projectType: 'IT_INTEGRATION',
    priority: 2,
    procurementStage: 'Užbaigta',
    costAnalysis: 6000,
    costDevelopment: 22000,
    costMaintenance: 7000,
    fundingFromIt: 35000,
    q3: 15000,
    q4: 20000,
    responsibleInstitution: 'AAD',
    executorName: 'Mantas Daunoras',
    executorEmail: 'mantas.daunoras@aad.lt',
    implementationDeadline: '2026-04-30',
    submittedDaysAgo: 270,
    decidedDaysAgo: 260,
    ...approved(35000, 2025, 'am-admin', 31),
    comments: approvedComments(
      'aad-admin',
      'am-admin',
      'Integracija svarbi tarpžinybiniam darbui.',
    ),
  },
  {
    tenantCode: 'VSTT',
    createdByUsername: 'vstt-user',
    status: 'REJECTED',
    projectName: 'Dronų eksperimentinė programa — pirminis bandymas',
    systemCode: 'GEOSTT',
    projectType: 'RESEARCH',
    priority: 4,
    procurementStage: 'Pradėtas',
    costEquipment: 12000,
    costDevelopment: 18000,
    fundingFromIt: 30000,
    q3: 15000,
    q4: 15000,
    responsibleInstitution: 'VSTT',
    executorName: 'Aušra Petrulienė',
    executorEmail: 'ausra.petruliene@vstt.lt',
    implementationDeadline: '2026-06-30',
    submittedDaysAgo: 268,
    decidedDaysAgo: 255,
    decisionByUsername: 'am-user',
    comments: rejectedComments(
      'vstt-user',
      'am-user',
      'Šiame etape eksperimentiniams projektams finansavimas neskiriamas. Rekomenduojame teikti pakartotinai 2026 m. ciklui su detalesniu galimybių tyrimu.',
    ),
  },

  // ── 2025-09 (~245-230 dienų) — peak season ──
  {
    tenantCode: 'VSTT',
    createdByUsername: 'vstt-admin',
    status: 'APPROVED',
    projectName: 'GIS lokacijų atvaizdavimo modulis',
    systemCode: 'GEOSTT',
    projectType: 'NEW_DEVELOPMENT',
    priority: 2,
    procurementStage: 'Įdiegta',
    costAnalysis: 4000,
    costDevelopment: 14000,
    fundingFromIt: 18000,
    q3: 9000,
    q4: 9000,
    responsibleInstitution: 'VSTT',
    executorName: 'Jonas Vaitkus',
    executorEmail: 'jonas.vaitkus@vstt.lt',
    implementationDeadline: '2026-03-31',
    submittedDaysAgo: 245,
    decidedDaysAgo: 236,
    ...approved(18000, 2025, 'am-admin', 35),
    comments: approvedComments('vstt-admin', 'am-admin'),
  },
  {
    tenantCode: 'LGT',
    createdByUsername: 'lgt-admin',
    status: 'APPROVED',
    projectName: 'Mokslo duomenų portalo plėtra',
    systemCode: 'GELMES',
    projectType: 'NEW_DEVELOPMENT',
    priority: 1,
    procurementStage: 'Užbaigta',
    costAnalysis: 10000,
    costDevelopment: 32000,
    costMaintenance: 8000,
    fundingFromIt: 50000,
    q3: 25000,
    q4: 25000,
    responsibleInstitution: 'LGT',
    executorName: 'Rasa Janušienė',
    executorEmail: 'rasa.janusiene@lgt.lt',
    implementationDeadline: '2026-06-30',
    submittedDaysAgo: 240,
    decidedDaysAgo: 230,
    ...approved(50000, 2025, 'am-admin', 38),
    comments: approvedComments(
      'lgt-admin',
      'am-admin',
      'Portalas atveria duomenis mokslo bendruomenei — patvirtinta visa apimtimi.',
    ),
  },

  // ── 2025-10 (~220-200 dienų) ──
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-user',
    status: 'APPROVED',
    projectName: 'AADIS palaikymas Q1-Q2 2026',
    systemCode: 'AADIS',
    projectType: 'IT_SUPPORT',
    priority: 1,
    procurementStage: 'Vykdoma',
    costMaintenance: 28000,
    fundingFromIt: 28000,
    q1: 14000,
    q2: 14000,
    responsibleInstitution: 'AAD',
    executorName: 'Tomas Burba',
    executorEmail: 'tomas.burba@aad.lt',
    implementationDeadline: '2026-06-30',
    submittedDaysAgo: 220,
    decidedDaysAgo: 210,
    ...approved(28000, 2025, 'am-admin', 45),
    comments: approvedComments('aad-user', 'am-admin'),
  },
  {
    tenantCode: 'LGT',
    createdByUsername: 'lgt-user',
    status: 'APPROVED',
    projectName: 'GELMES paieškos optimizacija',
    systemCode: 'GELMES',
    projectType: 'MODERNIZATION',
    priority: 3,
    procurementStage: 'Užbaigta',
    costDevelopment: 7500,
    fundingFromIt: 9500,
    costAnalysis: 2000,
    q4: 9500,
    responsibleInstitution: 'LGT',
    executorName: 'Vilma Klimaitė',
    executorEmail: 'vilma.klimaite@lgt.lt',
    implementationDeadline: '2026-02-28',
    submittedDaysAgo: 215,
    decidedDaysAgo: 205,
    ...approved(9500, 2025, 'am-user', 48),
    comments: approvedComments('lgt-user', 'am-user'),
  },
  {
    tenantCode: 'VSTT',
    createdByUsername: 'vstt-user',
    status: 'APPROVED',
    projectName: 'GeoSTT serverio atnaujinimas',
    systemCode: 'GEOSTT',
    projectType: 'INFRASTRUCTURE',
    priority: 2,
    procurementStage: 'Įdiegta',
    costEquipment: 25000,
    fundingFromIt: 25000,
    q4: 25000,
    responsibleInstitution: 'VSTT',
    executorName: 'Aušra Petrulienė',
    executorEmail: 'ausra.petruliene@vstt.lt',
    implementationDeadline: '2025-12-31',
    submittedDaysAgo: 210,
    decidedDaysAgo: 200,
    ...approved(25000, 2025, 'am-admin', 52),
    comments: approvedComments('vstt-user', 'am-admin'),
  },

  // ── 2025-11 (~185-170 dienų) ──
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-admin',
    status: 'APPROVED',
    projectName: 'Ugniasienės licencijų atnaujinimas 2025',
    systemCode: 'AADIS',
    projectType: 'SOFTWARE',
    priority: 1,
    procurementStage: 'Sutartis pasirašyta',
    costEquipment: 17500,
    fundingFromIt: 17500,
    q4: 17500,
    responsibleInstitution: 'AAD',
    executorName: 'Mantas Daunoras',
    executorEmail: 'mantas.daunoras@aad.lt',
    implementationDeadline: '2025-12-31',
    submittedDaysAgo: 185,
    decidedDaysAgo: 178,
    ...approved(17500, 2025, 'am-user', 55),
    comments: approvedComments('aad-admin', 'am-user'),
  },
  {
    tenantCode: 'VSTT',
    createdByUsername: 'vstt-admin',
    status: 'APPROVED',
    projectName: 'GeoSTT mobiliosios programėlės plėtra',
    systemCode: 'GEOSTT',
    projectType: 'SOFTWARE',
    priority: 2,
    procurementStage: 'Užbaigta',
    costAnalysis: 5000,
    costDevelopment: 35000,
    fundingFromIt: 40000,
    q4: 15000,
    q1: 15000,
    q2: 10000,
    responsibleInstitution: 'VSTT',
    executorName: 'Aušra Petrulienė',
    executorEmail: 'ausra.petruliene@vstt.lt',
    implementationDeadline: '2026-05-31',
    submittedDaysAgo: 180,
    decidedDaysAgo: 170,
    ...approved(40000, 2025, 'am-admin', 58),
    comments: approvedComments('vstt-admin', 'am-admin'),
  },
  {
    tenantCode: 'LGT',
    createdByUsername: 'lgt-user',
    status: 'REJECTED',
    projectName: 'Geofiziniai matavimai 2026 — prototipas',
    systemCode: 'GELMES',
    projectType: 'RESEARCH',
    priority: 5,
    procurementStage: 'Pradėtas',
    costAnalysis: 3000,
    costDevelopment: 8000,
    fundingFromIt: 11000,
    q1: 11000,
    responsibleInstitution: 'LGT',
    executorName: 'Vilma Klimaitė',
    executorEmail: 'vilma.klimaite@lgt.lt',
    implementationDeadline: '2026-04-30',
    submittedDaysAgo: 175,
    decidedDaysAgo: 165,
    decisionByUsername: 'am-user',
    comments: rejectedComments(
      'lgt-user',
      'am-user',
      'Projekto apimtis nepakankamai pagrįsta. Prašome pateikti detalesnį pasiūlymą atskirai 2026 m. metiniam planui.',
    ),
  },
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-user',
    status: 'APPROVED',
    projectName: 'AADIS ataskaitų modulis',
    systemCode: 'AADIS',
    projectType: 'NEW_DEVELOPMENT',
    priority: 2,
    procurementStage: 'Užbaigta',
    costAnalysis: 4500,
    costDevelopment: 18000,
    fundingFromIt: 22500,
    q4: 8000,
    q1: 14500,
    responsibleInstitution: 'AAD',
    executorName: 'Tomas Burba',
    executorEmail: 'tomas.burba@aad.lt',
    implementationDeadline: '2026-03-31',
    submittedDaysAgo: 170,
    decidedDaysAgo: 160,
    ...approved(22500, 2025, 'am-admin', 62),
    comments: approvedComments('aad-user', 'am-admin'),
  },

  // ── 2025-12 (~155-145 dienų) ──
  {
    tenantCode: 'LGT',
    createdByUsername: 'lgt-admin',
    status: 'APPROVED',
    projectName: 'GELMES integracija su EUR-Lex duomenimis',
    systemCode: 'GELMES',
    projectType: 'IT_INTEGRATION',
    priority: 2,
    procurementStage: 'Užbaigta',
    costAnalysis: 8000,
    costDevelopment: 24000,
    fundingFromIt: 32000,
    q1: 16000,
    q2: 16000,
    responsibleInstitution: 'LGT',
    executorName: 'Rasa Janušienė',
    executorEmail: 'rasa.janusiene@lgt.lt',
    implementationDeadline: '2026-06-30',
    submittedDaysAgo: 155,
    decidedDaysAgo: 145,
    ...approved(32000, 2025, 'am-user', 66),
    comments: approvedComments('lgt-admin', 'am-user'),
  },
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-admin',
    status: 'APPROVED',
    projectName: 'AADIS performance optimizacija',
    systemCode: 'AADIS',
    projectType: 'MODERNIZATION',
    priority: 2,
    procurementStage: 'Vykdoma',
    costAnalysis: 3000,
    costDevelopment: 15000,
    fundingFromIt: 18000,
    q1: 9000,
    q2: 9000,
    responsibleInstitution: 'AAD',
    executorName: 'Mantas Daunoras',
    executorEmail: 'mantas.daunoras@aad.lt',
    implementationDeadline: '2026-04-30',
    submittedDaysAgo: 145,
    decidedDaysAgo: 137,
    ...approved(18000, 2026, 'am-admin', 5),
    comments: approvedComments('aad-admin', 'am-admin'),
  },

  // ── 2026-01 (~140-105 dienų) ──
  {
    tenantCode: 'VSTT',
    createdByUsername: 'vstt-user',
    status: 'APPROVED',
    projectName: 'VSTT GIS duomenų bazės modernizavimas',
    systemCode: 'GEOSTT',
    projectType: 'NEW_DEVELOPMENT',
    priority: 1,
    procurementStage: 'Vykdoma',
    costAnalysis: 6000,
    costDevelopment: 26000,
    costMaintenance: 8000,
    fundingFromIt: 40000,
    q1: 15000,
    q2: 15000,
    q3: 10000,
    responsibleInstitution: 'VSTT',
    executorName: 'Aušra Petrulienė',
    executorEmail: 'ausra.petruliene@vstt.lt',
    implementationDeadline: '2026-09-30',
    submittedDaysAgo: 140,
    decidedDaysAgo: 130,
    ...approved(40000, 2026, 'am-admin', 8),
    comments: approvedComments('vstt-user', 'am-admin'),
  },
  {
    tenantCode: 'LGT',
    createdByUsername: 'am-admin',
    status: 'APPROVED',
    projectName: 'LGT serverio atnaujinimas (AM admin pavedimu)',
    systemCode: 'GELMES',
    projectType: 'INFRASTRUCTURE',
    priority: 1,
    procurementStage: 'Įdiegta',
    costEquipment: 15500,
    fundingFromIt: 15500,
    q1: 15500,
    responsibleInstitution: 'LGT',
    executorName: 'Rasa Janušienė',
    executorEmail: 'rasa.janusiene@lgt.lt',
    implementationDeadline: '2026-02-28',
    submittedDaysAgo: 125,
    decidedDaysAgo: 115,
    ...approved(15500, 2026, 'am-user', 11),
    comments: approvedComments('am-admin', 'am-user', 'Suteikta — kritinis poreikis.'),
  },
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-user',
    status: 'APPROVED',
    projectName: 'AADIS palaikymas Q3-Q4 2025',
    systemCode: 'AADIS',
    projectType: 'IT_SUPPORT',
    priority: 1,
    procurementStage: 'Užbaigta',
    costMaintenance: 18000,
    fundingFromIt: 18000,
    q3: 9000,
    q4: 9000,
    responsibleInstitution: 'AAD',
    executorName: 'Tomas Burba',
    executorEmail: 'tomas.burba@aad.lt',
    implementationDeadline: '2025-12-31',
    submittedDaysAgo: 105,
    decidedDaysAgo: 95,
    ...approved(18000, 2026, 'am-user', 14),
    comments: approvedComments('aad-user', 'am-user'),
  },

  // ── 2026-02 (~100-75 dienų) ──
  {
    tenantCode: 'VSTT',
    createdByUsername: 'vstt-admin',
    status: 'APPROVED',
    projectName: 'GeoSTT API plėtra',
    systemCode: 'GEOSTT',
    projectType: 'IT_INTEGRATION',
    priority: 2,
    procurementStage: 'Vykdoma',
    costAnalysis: 4000,
    costDevelopment: 18000,
    fundingFromIt: 22000,
    q2: 11000,
    q3: 11000,
    responsibleInstitution: 'VSTT',
    executorName: 'Jonas Vaitkus',
    executorEmail: 'jonas.vaitkus@vstt.lt',
    implementationDeadline: '2026-09-30',
    submittedDaysAgo: 100,
    decidedDaysAgo: 90,
    ...approved(22000, 2026, 'am-admin', 17),
    comments: approvedComments('vstt-admin', 'am-admin'),
  },
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-user',
    status: 'REJECTED',
    projectName: 'Stebėjimo įrangos atnaujinimas',
    systemCode: 'AADIS',
    projectType: 'OTHER',
    priority: 4,
    procurementStage: 'Pradėtas',
    costEquipment: 28000,
    fundingFromIt: 28000,
    q2: 28000,
    responsibleInstitution: 'AAD',
    executorName: 'Tomas Burba',
    executorEmail: 'tomas.burba@aad.lt',
    implementationDeadline: '2026-08-31',
    submittedDaysAgo: 95,
    decidedDaysAgo: 85,
    decisionByUsername: 'am-admin',
    comments: rejectedComments(
      'aad-user',
      'am-admin',
      'Specifikacija per daug neapibrėžta. Prašome detalizuoti reikalavimus ir teikti pakartotinai su atskira tiekėjų analize.',
    ),
  },
  {
    tenantCode: 'LGT',
    createdByUsername: 'lgt-user',
    status: 'APPROVED',
    projectName: 'Geologijos atlasas — duomenų konsolidacija',
    systemCode: 'GELMES',
    projectType: 'IT_SYSTEM',
    priority: 3,
    procurementStage: 'Vykdoma',
    costAnalysis: 3000,
    costDevelopment: 5000,
    fundingFromIt: 8000,
    q2: 4000,
    q3: 4000,
    responsibleInstitution: 'LGT',
    executorName: 'Vilma Klimaitė',
    executorEmail: 'vilma.klimaite@lgt.lt',
    implementationDeadline: '2026-10-31',
    submittedDaysAgo: 80,
    decidedDaysAgo: 72,
    ...approved(8000, 2026, 'am-user', 20),
    comments: approvedComments('lgt-user', 'am-user'),
  },
  {
    tenantCode: 'VSTT',
    createdByUsername: 'vstt-user',
    status: 'APPROVED',
    projectName: 'Saugomų teritorijų ribų atvaizdavimas',
    systemCode: 'GEOSTT',
    projectType: 'NEW_DEVELOPMENT',
    priority: 3,
    procurementStage: 'Vykdoma',
    costAnalysis: 3500,
    costDevelopment: 13000,
    fundingFromIt: 16500,
    q2: 8000,
    q3: 8500,
    responsibleInstitution: 'VSTT',
    executorName: 'Aušra Petrulienė',
    executorEmail: 'ausra.petruliene@vstt.lt',
    implementationDeadline: '2026-08-31',
    submittedDaysAgo: 75,
    decidedDaysAgo: 65,
    ...approved(16500, 2026, 'am-admin', 22),
    comments: approvedComments('vstt-user', 'am-admin'),
  },

  // ── 2026-03 (~55-45 dienų) ──
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-admin',
    status: 'APPROVED',
    projectName: 'Specialistų mokymai 2026',
    systemCode: null as unknown as string,
    projectType: 'TRAINING',
    priority: 3,
    procurementStage: 'Vykdoma',
    costAnalysis: 4000,
    costDevelopment: 20000,
    fundingFromIt: 24000,
    q3: 12000,
    q4: 12000,
    responsibleInstitution: 'AAD',
    executorName: 'Mantas Daunoras',
    executorEmail: 'mantas.daunoras@aad.lt',
    implementationDeadline: '2026-11-30',
    submittedDaysAgo: 55,
    decidedDaysAgo: 45,
    ...approved(24000, 2026, 'am-user', 25),
    comments: approvedComments('aad-admin', 'am-user'),
  },
  {
    tenantCode: 'LGT',
    createdByUsername: 'lgt-admin',
    status: 'REJECTED',
    projectName: 'Eksperimentinis seizmologinių duomenų modulis',
    systemCode: 'GELMES',
    projectType: 'RESEARCH',
    priority: 5,
    procurementStage: 'Pradėtas',
    costAnalysis: 7000,
    costDevelopment: 25000,
    fundingFromIt: 32000,
    q3: 16000,
    q4: 16000,
    responsibleInstitution: 'LGT',
    executorName: 'Rasa Janušienė',
    executorEmail: 'rasa.janusiene@lgt.lt',
    implementationDeadline: '2027-03-31',
    submittedDaysAgo: 50,
    decidedDaysAgo: 38,
    decisionByUsername: 'am-admin',
    comments: rejectedComments(
      'lgt-admin',
      'am-admin',
      'Šių metų finansavimo apimtyje neturime laisvų resursų. Rekomenduojame teikti 2027 m. ciklui pradiniame plano etape.',
    ),
  },
  {
    tenantCode: 'AAD',
    createdByUsername: 'am-admin',
    status: 'APPROVED',
    projectName: 'AAD audito sistemos paslaugos (AM admin pavedimu)',
    systemCode: 'AADIS',
    projectType: 'IT_SUPPORT',
    priority: 2,
    procurementStage: 'Vykdoma',
    costAnalysis: 2500,
    costMaintenance: 9500,
    fundingFromIt: 12000,
    q3: 6000,
    q4: 6000,
    responsibleInstitution: 'AAD',
    executorName: 'Tomas Burba',
    executorEmail: 'tomas.burba@aad.lt',
    implementationDeadline: '2026-12-31',
    submittedDaysAgo: 45,
    decidedDaysAgo: 35,
    ...approved(12000, 2026, 'am-admin', 28),
    comments: approvedComments(
      'am-admin',
      'am-admin',
      'AM administratorius suformulavo prašymą už AAD — patvirtinta po peržiūros.',
    ),
  },

  // ╔══════════════════════════════════════════════════════════════╗
  // ║ ACTIVE / PENDING — kas dabar matomas queue'ose                ║
  // ╚══════════════════════════════════════════════════════════════╝

  // ── SUBMITTED (laukia AM tvirtinimo) ──
  {
    tenantCode: 'LGT',
    createdByUsername: 'lgt-user',
    status: 'SUBMITTED',
    projectName: 'GELMES UX redizainas',
    systemCode: 'GELMES',
    projectType: 'OTHER',
    priority: 3,
    procurementStage: 'Pradėtas',
    costAnalysis: 6000,
    costDevelopment: 22000,
    fundingFromIt: 28000,
    q3: 14000,
    q4: 14000,
    responsibleInstitution: 'LGT',
    executorName: 'Vilma Klimaitė',
    executorEmail: 'vilma.klimaite@lgt.lt',
    implementationDeadline: '2026-12-31',
    submittedDaysAgo: 30,
    comments: [{ authorUsername: 'lgt-user', kind: 'submitted' }],
  },
  {
    tenantCode: 'VSTT',
    createdByUsername: 'vstt-admin',
    status: 'SUBMITTED',
    projectName: 'Lankytojų centrų IT infrastruktūra',
    systemCode: 'GEOSTT',
    projectType: 'INFRASTRUCTURE',
    priority: 2,
    procurementStage: 'Pradėtas',
    costEquipment: 32000,
    costMaintenance: 6000,
    fundingFromIt: 38000,
    q3: 20000,
    q4: 18000,
    responsibleInstitution: 'VSTT',
    executorName: 'Jonas Vaitkus',
    executorEmail: 'jonas.vaitkus@vstt.lt',
    implementationDeadline: '2026-11-30',
    submittedDaysAgo: 22,
    comments: [{ authorUsername: 'vstt-admin', kind: 'submitted' }],
  },
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-user',
    status: 'SUBMITTED',
    projectName: 'AADIS palaikymas Q3-Q4 2026',
    systemCode: 'AADIS',
    projectType: 'IT_SUPPORT',
    priority: 1,
    procurementStage: 'Pradėtas',
    costMaintenance: 18000,
    fundingFromIt: 18000,
    q3: 9000,
    q4: 9000,
    responsibleInstitution: 'AAD',
    executorName: 'Tomas Burba',
    executorEmail: 'tomas.burba@aad.lt',
    implementationDeadline: '2026-12-31',
    submittedDaysAgo: 14,
    comments: [{ authorUsername: 'aad-user', kind: 'submitted' }],
  },
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-admin',
    status: 'SUBMITTED',
    projectName: 'AADIS DR (disaster recovery) sprendimas',
    systemCode: 'AADIS',
    projectType: 'INFRASTRUCTURE',
    priority: 1,
    procurementStage: 'Pradėtas',
    costAnalysis: 4000,
    costDevelopment: 12000,
    costMaintenance: 8000,
    fundingFromIt: 24000,
    q3: 10000,
    q4: 14000,
    responsibleInstitution: 'AAD',
    executorName: 'Mantas Daunoras',
    executorEmail: 'mantas.daunoras@aad.lt',
    implementationDeadline: '2026-12-15',
    submittedDaysAgo: 8,
    comments: [{ authorUsername: 'aad-admin', kind: 'submitted' }],
  },
  {
    tenantCode: 'LGT',
    createdByUsername: 'am-admin',
    status: 'SUBMITTED',
    projectName: 'Geologijos seminarai 2026 (AM admin pavedimu)',
    systemCode: null as unknown as string,
    projectType: 'TRAINING',
    priority: 4,
    procurementStage: 'Pradėtas',
    costAnalysis: 2000,
    costDevelopment: 6000,
    fundingFromIt: 8000,
    q3: 4000,
    q4: 4000,
    responsibleInstitution: 'LGT',
    executorName: 'Rasa Janušienė',
    executorEmail: 'rasa.janusiene@lgt.lt',
    implementationDeadline: '2026-12-31',
    submittedDaysAgo: 5,
    comments: [
      {
        authorUsername: 'am-admin',
        kind: 'submitted',
        body: 'Sukurta AM administratoriaus pavedimu — LGT vadovas patvirtino prioritetus.',
      },
    ],
  },

  // ── RETURNED (grąžinta pataisymui — submitter'is dirba) ──
  {
    tenantCode: 'VSTT',
    createdByUsername: 'vstt-user',
    status: 'RETURNED',
    projectName: 'Saugomų teritorijų geoportalo plėtra',
    systemCode: 'GEOSTT',
    projectType: 'NEW_DEVELOPMENT',
    priority: 2,
    procurementStage: 'Pradėtas',
    costAnalysis: 8000,
    costDevelopment: 26000,
    fundingFromIt: 34000,
    q3: 17000,
    q4: 17000,
    responsibleInstitution: 'VSTT',
    executorName: 'Aušra Petrulienė',
    executorEmail: 'ausra.petruliene@vstt.lt',
    implementationDeadline: '2026-11-30',
    submittedDaysAgo: 25,
    decidedDaysAgo: 18,
    decisionByUsername: 'am-admin',
    comments: returnedComments(
      'vstt-user',
      'am-admin',
      'Reikalingas detalesnis planuojamų darbų aprašymas — kokios konkretiai funkcijos bus įdiegtos pirmajame etape. Taip pat patikslinkite ketvirčių išskirstymą.',
    ),
  },
  {
    tenantCode: 'LGT',
    createdByUsername: 'lgt-admin',
    status: 'RETURNED',
    projectName: 'Geologijos duomenų bazės migracija',
    systemCode: 'GELMES',
    projectType: 'MODERNIZATION',
    priority: 1,
    procurementStage: 'Pradėtas',
    costAnalysis: 5000,
    costDevelopment: 18000,
    costMaintenance: 4000,
    fundingFromIt: 27000,
    q3: 14000,
    q4: 13000,
    responsibleInstitution: 'LGT',
    executorName: 'Rasa Janušienė',
    executorEmail: 'rasa.janusiene@lgt.lt',
    implementationDeadline: '2026-12-31',
    submittedDaysAgo: 20,
    decidedDaysAgo: 14,
    decisionByUsername: 'am-user',
    comments: returnedComments(
      'lgt-admin',
      'am-user',
      'Trūksta DR (disaster recovery) plano duomenų migracijos metu. Pridėkite rizikos vertinimą ir atsarginių kopijų strategiją.',
    ),
  },
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-user',
    status: 'RETURNED',
    projectName: 'AADIS audito paslaugos',
    systemCode: 'AADIS',
    projectType: 'IT_SUPPORT',
    priority: 2,
    procurementStage: 'Pradėtas',
    costAnalysis: 4500,
    costMaintenance: 5500,
    fundingFromIt: 10000,
    q3: 5000,
    q4: 5000,
    responsibleInstitution: 'AAD',
    executorName: 'Tomas Burba',
    executorEmail: 'tomas.burba@aad.lt',
    implementationDeadline: '2026-12-31',
    submittedDaysAgo: 6,
    decidedDaysAgo: 3,
    decisionByUsername: 'am-user',
    comments: returnedComments(
      'aad-user',
      'am-user',
      'Patikslinkite, ar tai vienkartinis auditas, ar metinė paslauga. Nuo to priklauso finansavimo šaltinio pasirinkimas.',
    ),
  },

  // ── DRAFT (juodraščiai — kuriama dabar) ──
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-user',
    status: 'DRAFT',
    projectName: 'AADIS modernizavimas — 2026 etapas',
    systemCode: 'AADIS',
    projectType: 'NEW_DEVELOPMENT',
    priority: 1,
    procurementStage: 'Pradėtas',
    costAnalysis: 8000,
    costDevelopment: 32000,
    costMaintenance: 12000,
    fundingFromIt: 52000,
    q3: 26000,
    q4: 26000,
    responsibleInstitution: 'AAD',
    executorName: 'Tomas Burba',
    executorEmail: 'tomas.burba@aad.lt',
    implementationDeadline: '2026-12-31',
    comments: [],
  },
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-admin',
    status: 'DRAFT',
    projectName: 'AADIS naujovės 2026 Q3',
    systemCode: 'AADIS',
    projectType: 'NEW_DEVELOPMENT',
    priority: 3,
    procurementStage: 'Pradėtas',
    costAnalysis: 3000,
    costDevelopment: 11000,
    fundingFromIt: 14000,
    q3: 7000,
    q4: 7000,
    responsibleInstitution: 'AAD',
    executorName: 'Mantas Daunoras',
    executorEmail: 'mantas.daunoras@aad.lt',
    implementationDeadline: '2027-03-31',
    comments: [],
  },
  {
    tenantCode: 'VSTT',
    createdByUsername: 'vstt-user',
    status: 'DRAFT',
    projectName: 'GeoSTT integracija su LANDSAT duomenimis',
    systemCode: 'GEOSTT',
    projectType: 'IT_INTEGRATION',
    priority: 3,
    procurementStage: 'Pradėtas',
    costAnalysis: 5000,
    costDevelopment: 14000,
    fundingFromIt: 19000,
    q4: 19000,
    responsibleInstitution: 'VSTT',
    executorName: 'Aušra Petrulienė',
    executorEmail: 'ausra.petruliene@vstt.lt',
    implementationDeadline: '2027-03-31',
    comments: [],
  },
  {
    tenantCode: 'LGT',
    createdByUsername: 'lgt-user',
    status: 'DRAFT',
    projectName: 'Žemės gelmių stebėsenos sistemos atnaujinimas',
    systemCode: 'GELMES',
    projectType: 'NEW_DEVELOPMENT',
    priority: 2,
    procurementStage: 'Pradėtas',
    costAnalysis: 6000,
    costDevelopment: 22000,
    fundingFromIt: 28000,
    q3: 14000,
    q4: 14000,
    responsibleInstitution: 'LGT',
    executorName: 'Vilma Klimaitė',
    executorEmail: 'vilma.klimaite@lgt.lt',
    implementationDeadline: '2026-12-31',
    comments: [],
  },
  {
    tenantCode: 'LGT',
    createdByUsername: 'lgt-admin',
    status: 'DRAFT',
    projectName: 'GELMES analitikos modulis',
    systemCode: 'GELMES',
    projectType: 'NEW_DEVELOPMENT',
    priority: 3,
    procurementStage: 'Pradėtas',
    costAnalysis: 4000,
    costDevelopment: 18000,
    fundingFromIt: 22000,
    q3: 11000,
    q4: 11000,
    responsibleInstitution: 'LGT',
    executorName: 'Rasa Janušienė',
    executorEmail: 'rasa.janusiene@lgt.lt',
    implementationDeadline: '2027-06-30',
    comments: [],
  },
  {
    tenantCode: 'VSTT',
    createdByUsername: 'vstt-admin',
    status: 'DRAFT',
    projectName: 'VSTT mokymų platformos plėtra 2027',
    systemCode: null as unknown as string,
    projectType: 'NEW_DEVELOPMENT',
    priority: 4,
    procurementStage: 'Pradėtas',
    costAnalysis: 2500,
    costDevelopment: 8500,
    fundingFromIt: 11000,
    q4: 11000,
    responsibleInstitution: 'VSTT',
    executorName: 'Jonas Vaitkus',
    executorEmail: 'jonas.vaitkus@vstt.lt',
    implementationDeadline: '2027-09-30',
    comments: [],
  },

  // ╔══════════════════════════════════════════════════════════════╗
  // ║ MULTI-YEAR PLANAI (issue #4)                                 ║
  // ║ year > currentYear → planai. Atspindi Giedrės pavyzdį:       ║
  // ║ „planavom iki 2029 m. imtinai".                              ║
  // ╚══════════════════════════════════════════════════════════════╝

  // 2027 m. — pateiktas planas (AAD, AADIS DR sprendimas)
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-admin',
    status: 'SUBMITTED',
    year: new Date().getFullYear() + 1,
    projectName: 'AADIS DR plėtra — 2 etapas (2027 m. planas)',
    systemCode: 'AADIS',
    projectType: 'INFRASTRUCTURE',
    priority: 1,
    procurementStage: 'Pradėtas',
    description:
      'Pirminis planas 2027 m. — disaster recovery antras etapas: cross-region replikacija.',
    plannedWorks: 'Tinklo segmentavimas, antras data center, backup procedūrų automatizavimas.',
    costEquipment: 45000,
    costDevelopment: 35000,
    fundingFromIt: 80000,
    q1: 20000,
    q2: 25000,
    q3: 20000,
    q4: 15000,
    responsibleInstitution: 'AAD',
    executorName: 'Tomas Burba',
    executorEmail: 'tomas.burba@aad.lt',
    implementationDeadline: '2027-11-30',
    submittedDaysAgo: 30,
    comments: [{ authorUsername: 'aad-admin', kind: 'submitted' }],
  },

  // 2027 m. — DRAFT planas (LGT, paliktas dar pildyti)
  {
    tenantCode: 'LGT',
    createdByUsername: 'lgt-admin',
    status: 'DRAFT',
    year: new Date().getFullYear() + 1,
    projectName: 'GELMES — istorinių duomenų skaitmenizavimo programa (2027 m. planas)',
    systemCode: 'GELMES',
    projectType: 'NEW_DEVELOPMENT',
    priority: 2,
    procurementStage: 'Pradėtas',
    description:
      'Planuojamas 2027 m. projektas — popierinių žemės gelmių dokumentų skaitmenizavimas.',
    plannedWorks: "OCR, metaduomenų extract'inimas, integracija su GELMES paieška.",
    costAnalysis: 15000,
    costDevelopment: 50000,
    fundingFromIt: 65000,
    q1: 10000,
    q2: 25000,
    q3: 20000,
    q4: 10000,
    responsibleInstitution: 'LGT',
    executorName: 'Rasa Janušienė',
    executorEmail: 'rasa.janusiene@lgt.lt',
    implementationDeadline: '2027-12-15',
    comments: [],
  },

  // 2028 m. — pateiktas planas (VSTT, GIS modernizavimas)
  {
    tenantCode: 'VSTT',
    createdByUsername: 'vstt-admin',
    status: 'SUBMITTED',
    year: new Date().getFullYear() + 2,
    projectName: 'GEOSTT — pilna platformos modernizavimo programa (2028 m. planas)',
    systemCode: 'GEOSTT',
    projectType: 'MODERNIZATION',
    priority: 1,
    procurementStage: 'Pradėtas',
    description: 'Strateginis 2028 m. planas — GEOSTT pereinama į cloud-native architektūrą.',
    plannedWorks: 'Microservices migracija, OpenLayers atnaujinimas, mobile-first UI.',
    costAnalysis: 25000,
    costDevelopment: 95000,
    costMaintenance: 20000,
    fundingFromIt: 140000,
    q1: 30000,
    q2: 40000,
    q3: 40000,
    q4: 30000,
    responsibleInstitution: 'VSTT',
    executorName: 'Jonas Vaitkus',
    executorEmail: 'jonas.vaitkus@vstt.lt',
    implementationDeadline: '2028-12-31',
    submittedDaysAgo: 15,
    comments: [{ authorUsername: 'vstt-admin', kind: 'submitted' }],
  },

  // 2029 m. — DRAFT planas (AAD, ilgalaikis strateginis)
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-user',
    status: 'DRAFT',
    year: new Date().getFullYear() + 3,
    projectName: 'AADIS — AI moduliai inspekcijoms (2029 m. ilgalaikis planas)',
    systemCode: 'AADIS',
    projectType: 'NEW_DEVELOPMENT',
    priority: 2,
    procurementStage: 'Pradėtas',
    description:
      'Ilgalaikis 2029 m. tikslas — AI/ML modeliai aplinkosaugos inspekcijų prioritetams.',
    plannedWorks: 'Duomenų katalogavimas, ML modelio mokymas, integracija su AADIS workflow.',
    costAnalysis: 30000,
    costDevelopment: 70000,
    fundingFromIt: 100000,
    q1: 20000,
    q2: 30000,
    q3: 30000,
    q4: 20000,
    responsibleInstitution: 'AAD',
    executorName: 'Eglė Petrauskaitė',
    executorEmail: 'egle.petrauskaite@aad.lt',
    implementationDeadline: '2029-12-15',
    comments: [],
  },

  // ── NEAKTUALŪS (#9 proceso schema: planas pažymimas „neaktualiu") ──
  // 2028 m. planas, kuris tapo nebeaktualus (pvz. projektas atšauktas /
  // perkeltas). Demonstruoja „Neaktualu" būseną + „Neaktualūs" filtrą.
  {
    tenantCode: 'VSTT',
    createdByUsername: 'vstt-user',
    status: 'NEAKTUALU',
    year: new Date().getFullYear() + 2,
    projectName: 'GEOSTT — papildomi 3D sluoksniai (2028 m. planas, atšaukta)',
    systemCode: 'GEOSTT',
    projectType: 'NEW_DEVELOPMENT',
    priority: 3,
    procurementStage: 'Pradėtas',
    description: 'Planuotas 2028 m. projektas — vėliau pažymėtas neaktualiu (poreikis atkrito).',
    plannedWorks: '3D vizualizacijos sluoksniai GEOSTT žemėlapiams.',
    costDevelopment: 40000,
    fundingFromIt: 40000,
    q1: 10000,
    q2: 10000,
    q3: 10000,
    q4: 10000,
    responsibleInstitution: 'VSTT',
    executorName: 'Jonas Vaitkus',
    executorEmail: 'jonas.vaitkus@vstt.lt',
    implementationDeadline: '2028-12-31',
    comments: [
      {
        authorUsername: 'vstt-user',
        kind: 'marked_not_relevant',
        body: 'Pažymėta neaktualiu — poreikis perkeltas į GEOSTT modernizavimo programą.',
        metadata: { fromStatus: 'DRAFT', toStatus: 'NEAKTUALU' },
      },
    ],
  },

  // 2029 m. planas, pažymėtas neaktualiu (AAD).
  {
    tenantCode: 'AAD',
    createdByUsername: 'aad-user',
    status: 'NEAKTUALU',
    year: new Date().getFullYear() + 3,
    projectName: 'AADIS — atskira mobili aplikacija (2029 m. idėja, atidėta)',
    systemCode: 'AADIS',
    projectType: 'NEW_DEVELOPMENT',
    priority: 4,
    procurementStage: 'Pradėtas',
    description:
      'Ankstyva 2029 m. idėja — pažymėta neaktualiu, funkcijos integruojamos į AADIS web.',
    plannedWorks: 'Native mobili aplikacija inspektoriams.',
    costDevelopment: 60000,
    fundingFromIt: 60000,
    q1: 15000,
    q2: 15000,
    q3: 15000,
    q4: 15000,
    responsibleInstitution: 'AAD',
    executorName: 'Eglė Petrauskaitė',
    executorEmail: 'egle.petrauskaite@aad.lt',
    implementationDeadline: '2029-12-31',
    comments: [
      {
        authorUsername: 'aad-user',
        kind: 'marked_not_relevant',
        body: 'Pažymėta neaktualiu — funkcionalumas perkeltas į AADIS web (responsive).',
        metadata: { fromStatus: 'DRAFT', toStatus: 'NEAKTUALU' },
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
  // Iter 16 (FVM-8): jei FVM lentelės egzistuoja ir turi duomenų — pirma
  // jas išvalom, kad tenant'ų delete'as nelaužtų FK constraint'o
  // (`funding_sources.tenant_id`, `projects.tenant_id`, etc.). Pilna FK
  // chain'ą atvirkščiu order'iu valom.
  const hasExpenses = await knex.schema.hasTable('expenses');
  if (hasExpenses) {
    await knex('expenses').del();
    await knex.raw('ALTER SEQUENCE expenses_id_seq RESTART WITH 1');
  }
  const hasPayrollDistributions = await knex.schema.hasTable('payroll_distributions');
  if (hasPayrollDistributions) {
    await knex('payroll_distributions').del();
    await knex.raw('ALTER SEQUENCE payroll_distributions_id_seq RESTART WITH 1');
  }
  const hasPayrollProfiles = await knex.schema.hasTable('payroll_profiles');
  if (hasPayrollProfiles) {
    await knex('payroll_profiles').del();
    await knex.raw('ALTER SEQUENCE payroll_profiles_id_seq RESTART WITH 1');
  }
  const hasProjects = await knex.schema.hasTable('projects');
  if (hasProjects) {
    await knex('projects').del();
    await knex.raw('ALTER SEQUENCE projects_id_seq RESTART WITH 1');
  }
  const hasBudgetAllocationsV2 = await knex.schema.hasTable('budget_allocations_v2');
  if (hasBudgetAllocationsV2) {
    await knex('budget_allocations_v2').del();
    await knex.raw('ALTER SEQUENCE budget_allocations_v2_id_seq RESTART WITH 1');
  }
  const hasFundingSources = await knex.schema.hasTable('funding_sources');
  if (hasFundingSources) {
    await knex('funding_sources').del();
    await knex.raw('ALTER SEQUENCE funding_sources_id_seq RESTART WITH 1');
  }

  // Iter 16: prieš requests delete — išvalom child'us su RESTRICT FK į users
  // (request_attachments.uploaded_by_user_id, request_reports.created_by_user_id).
  // CASCADE iš requests automatiškai pašalintų visus subrecords, bet jei
  // requests ne CASCADE'inami (RESTRICT'as), reikia explicit'iškai.
  const hasRequestAttachments = await knex.schema.hasTable('request_attachments');
  if (hasRequestAttachments) {
    await knex('request_attachments').del();
    await knex.raw('ALTER SEQUENCE request_attachments_id_seq RESTART WITH 1');
  }
  const hasRequestReports = await knex.schema.hasTable('request_reports');
  if (hasRequestReports) {
    await knex('request_reports').del();
    await knex.raw('ALTER SEQUENCE request_reports_id_seq RESTART WITH 1');
  }
  const hasApprovalSteps = await knex.schema.hasTable('approval_steps');
  if (hasApprovalSteps) {
    await knex('approval_steps').del();
    await knex.raw('ALTER SEQUENCE approval_steps_id_seq RESTART WITH 1');
  }

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
        approval_level_codes: u.approvalLevelCodes ?? [],
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
    const submittedAt =
      r.submittedDaysAgo !== undefined
        ? daysAgoIso(r.submittedDaysAgo)
        : r.status !== 'DRAFT' && r.status !== 'NEAKTUALU'
          ? new Date().toISOString()
          : null;
    const decidedAt =
      r.decidedDaysAgo !== undefined
        ? daysAgoIso(r.decidedDaysAgo)
        : r.status === 'APPROVED' || r.status === 'REJECTED' || r.status === 'RETURNED'
          ? new Date().toISOString()
          : null;

    const inserted = (await knex('requests')
      .insert({
        tenant_id: tenantId,
        created_by_user_id: createdById,
        status: r.status,
        year: r.year ?? new Date().getFullYear(),
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
