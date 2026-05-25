import { describe, expect, it } from 'vitest';
import type {
  ApprovalStep,
  AuthUser,
  FinancingRequest,
  RequestStatus,
} from '@biip-finansai/shared';
import {
  canCreate,
  canDecide,
  canDecideStep,
  canDelete,
  canEdit,
  canMarkNotRelevant,
  canReactivate,
  canSubmit,
  currentPendingStep,
  fmtEur,
  isCreateOnBehalf,
  isDeadlineOverdue,
  STATUS_LABELS,
  STATUS_VARIANTS,
  totalQuarterly,
  totalRequested,
} from './requests';

function makeSubmitter(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 100,
    username: 'u',
    fullName: 'Test User',
    email: 'u@aad.lt',
    role: 'user',
    tenantId: 2,
    tenantCode: 'AAD',
    tenantName: 'AAD',
    tenantIsApprover: false,
    amScopeOrgIds: null,
    approvalLevelCodes: [],
    ...overrides,
  };
}

function makeApprover(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 1,
    username: 'am',
    fullName: 'AM Admin',
    email: 'am@am.lt',
    role: 'admin',
    tenantId: 1,
    tenantCode: 'AM',
    tenantName: 'Aplinkos ministerija',
    tenantIsApprover: true,
    amScopeOrgIds: null,
    approvalLevelCodes: [],
    ...overrides,
  };
}

function makeRequest(overrides: Partial<FinancingRequest> = {}): FinancingRequest {
  return {
    id: 1,
    tenantId: 2,
    tenantCode: 'AAD',
    tenantName: 'AAD',
    createdByUserId: 100,
    createdByName: 'Test',
    status: 'DRAFT' as RequestStatus,
    year: 2026,
    projectName: 'Projektas',
    systemCode: null,
    projectType: null,
    description: null,
    plannedWorks: null,
    priority: null,
    procurementStage: null,
    costDu: '0',
    costEquipment: '100',
    costCreation: '0',
    costAnalysis: '0',
    costDevelopment: '200',
    costMaintenance: '0',
    costModernization: '0',
    costDecommissioning: '0',
    fundingFromIt: '300',
    otherFunds: '0',
    otherFundsSource: null,
    q1Amount: '100',
    q2Amount: '100',
    q3Amount: '50',
    q4Amount: '50',
    responsibleInstitution: null,
    executorName: null,
    executorEmail: null,
    implementationDeadline: null,
    submitterNotes: null,
    decisionGrantedAmount: null,
    decisionFundingSource: null,
    decisionProtocol: null,
    decisionOrder: null,
    decisionOrderDate: null,
    decidedAt: null,
    decidedByUserId: null,
    decidedByName: null,
    // FVM Iter 10 laukai (visi nullable defaults)
    budgetCategoryId: null,
    budgetCategoryCode: null,
    budgetCategoryName: null,
    fundingSourceTypeId: null,
    fundingSourceTypeCode: null,
    fundingSourceTypeName: null,
    specProgramFundingType: null,
    fvmProjectId: null,
    submittedAt: null,
    createdAt: '2026-05-15T00:00:00Z',
    updatedAt: '2026-05-15T00:00:00Z',
    ...overrides,
  };
}

describe('totalRequested', () => {
  it('sumuoja sąnaudų laukus be DU', () => {
    const r = makeRequest({ costEquipment: '100.50', costDevelopment: '250' });
    expect(totalRequested(r)).toBe(350.5);
  });
});

describe('totalQuarterly', () => {
  it('sumuoja Q1-Q4', () => {
    const r = makeRequest({ q1Amount: '100', q2Amount: '100', q3Amount: '50', q4Amount: '50' });
    expect(totalQuarterly(r)).toBe(300);
  });
});

describe('fmtEur', () => {
  it('formatuoja LT lokale', () => {
    const result = fmtEur(1234.56);
    expect(result).toMatch(/1\s?234/);
    expect(result).toMatch(/€/);
  });

  it('grąžina — kai null', () => {
    expect(fmtEur(null)).toBe('—');
    expect(fmtEur(undefined)).toBe('—');
  });
});

describe('canCreate', () => {
  it('teikėjai (visi) gali kurti', () => {
    expect(canCreate(makeSubmitter({ role: 'user' }))).toBe(true);
    expect(canCreate(makeSubmitter({ role: 'admin' }))).toBe(true);
  });
  it('AM admin gali kurti kitos org. vardu', () => {
    expect(canCreate(makeApprover({ role: 'admin' }))).toBe(true);
  });
  it('AM specialistai negali kurti', () => {
    expect(canCreate(makeApprover({ role: 'user' }))).toBe(false);
  });
  it('null user negali', () => {
    expect(canCreate(null)).toBe(false);
  });
});

describe('isCreateOnBehalf', () => {
  it('true tik AM admin', () => {
    expect(isCreateOnBehalf(makeApprover({ role: 'admin' }))).toBe(true);
    expect(isCreateOnBehalf(makeApprover({ role: 'user' }))).toBe(false);
    expect(isCreateOnBehalf(makeSubmitter({ role: 'admin' }))).toBe(false);
    expect(isCreateOnBehalf(makeSubmitter({ role: 'user' }))).toBe(false);
  });
});

describe('canEdit', () => {
  it('savininkas (org. spec.) gali redaguoti DRAFT', () => {
    const u = makeSubmitter({ id: 100 });
    const r = makeRequest({ status: 'DRAFT', createdByUserId: 100 });
    expect(canEdit(u, r)).toBe(true);
  });

  it('savininkas gali redaguoti RETURNED', () => {
    const u = makeSubmitter({ id: 100 });
    const r = makeRequest({ status: 'RETURNED', createdByUserId: 100 });
    expect(canEdit(u, r)).toBe(true);
  });

  it('negalima redaguoti SUBMITTED', () => {
    const u = makeSubmitter({ id: 100 });
    const r = makeRequest({ status: 'SUBMITTED', createdByUserId: 100 });
    expect(canEdit(u, r)).toBe(false);
  });

  it('negalima redaguoti APPROVED', () => {
    const u = makeSubmitter({ id: 100 });
    const r = makeRequest({ status: 'APPROVED', createdByUserId: 100 });
    expect(canEdit(u, r)).toBe(false);
  });

  it('kitas spec. negali redaguoti svetimo', () => {
    const u = makeSubmitter({ id: 100 });
    const r = makeRequest({ status: 'DRAFT', createdByUserId: 999 });
    expect(canEdit(u, r)).toBe(false);
  });

  it('org. admin gali redaguoti bet kurio savo tenant DRAFT', () => {
    const admin = makeSubmitter({ role: 'admin' });
    const r = makeRequest({ status: 'DRAFT', createdByUserId: 999 });
    expect(canEdit(admin, r)).toBe(true);
  });

  it('kito tenant org. admin negali redaguoti', () => {
    const admin = makeSubmitter({ role: 'admin', tenantId: 99 });
    const r = makeRequest({ status: 'DRAFT', tenantId: 2 });
    expect(canEdit(admin, r)).toBe(false);
  });

  it('AM admin gali redaguoti tik savo „on behalf" prašymus', () => {
    const am = makeApprover({ id: 1 });
    const ownDraft = makeRequest({ status: 'DRAFT', tenantId: 2, createdByUserId: 1 });
    const someoneElse = makeRequest({ status: 'DRAFT', tenantId: 2, createdByUserId: 100 });
    expect(canEdit(am, ownDraft)).toBe(true);
    expect(canEdit(am, someoneElse)).toBe(false);
  });

  it('AM specialistas niekada negali redaguoti', () => {
    const am = makeApprover({ role: 'user' });
    const r = makeRequest({ status: 'DRAFT', tenantId: 2, createdByUserId: am.id });
    expect(canEdit(am, r)).toBe(false);
  });
});

describe('canSubmit', () => {
  it('toks pats kaip canEdit', () => {
    const u = makeSubmitter();
    const r = makeRequest({ status: 'DRAFT', createdByUserId: 100 });
    expect(canSubmit(u, r)).toBe(canEdit(u, r));
  });
});

describe('canDecide', () => {
  it('AM admin gali decide SUBMITTED', () => {
    const u = makeApprover();
    const r = makeRequest({ status: 'SUBMITTED', tenantId: 2 });
    expect(canDecide(u, r)).toBe(true);
  });

  it('AM admin negali decide ne-SUBMITTED', () => {
    const u = makeApprover();
    const r = makeRequest({ status: 'APPROVED', tenantId: 2 });
    expect(canDecide(u, r)).toBe(false);
  });

  it('AM specialistas su scope mato tik scope orgs', () => {
    const u = makeApprover({ role: 'user', amScopeOrgIds: [2] });
    expect(canDecide(u, makeRequest({ status: 'SUBMITTED', tenantId: 2 }))).toBe(true);
    expect(canDecide(u, makeRequest({ status: 'SUBMITTED', tenantId: 3 }))).toBe(false);
  });

  it('AM specialistas su NULL scope mato visus', () => {
    const u = makeApprover({ role: 'user', amScopeOrgIds: null });
    expect(canDecide(u, makeRequest({ status: 'SUBMITTED', tenantId: 5 }))).toBe(true);
  });

  it('teikėjai (org.) niekada negali decide', () => {
    expect(canDecide(makeSubmitter({ role: 'admin' }), makeRequest({ status: 'SUBMITTED' }))).toBe(
      false,
    );
    expect(canDecide(makeSubmitter({ role: 'user' }), makeRequest({ status: 'SUBMITTED' }))).toBe(
      false,
    );
  });
});

describe('canDelete', () => {
  it('tik DRAFT, savininko (teikėjas)', () => {
    const u = makeSubmitter({ id: 100 });
    expect(canDelete(u, makeRequest({ status: 'DRAFT', createdByUserId: 100 }))).toBe(true);
    expect(canDelete(u, makeRequest({ status: 'SUBMITTED', createdByUserId: 100 }))).toBe(false);
    expect(canDelete(u, makeRequest({ status: 'DRAFT', createdByUserId: 999 }))).toBe(false);
  });

  it('AM admin gali ištrinti tik savo „on behalf" DRAFT', () => {
    const am = makeApprover({ id: 1 });
    expect(canDelete(am, makeRequest({ status: 'DRAFT', tenantId: 2, createdByUserId: 1 }))).toBe(
      true,
    );
    expect(canDelete(am, makeRequest({ status: 'DRAFT', tenantId: 2, createdByUserId: 100 }))).toBe(
      false,
    );
  });

  // Issue #9: NEAKTUALU prašymą savininkas gali ištrinti.
  it('Issue #9: savininkas gali ištrinti NEAKTUALU prašymą', () => {
    const u = makeSubmitter({ id: 100 });
    expect(canDelete(u, makeRequest({ status: 'NEAKTUALU', createdByUserId: 100 }))).toBe(true);
    expect(canDelete(u, makeRequest({ status: 'NEAKTUALU', createdByUserId: 999 }))).toBe(false);
  });
});

// Issue #9: NEAKTUALU perėjimų helper'iai.
describe('canMarkNotRelevant (Issue #9)', () => {
  it('savininkas gali pažymėti DRAFT/RETURNED neaktualiu', () => {
    const u = makeSubmitter({ id: 100 });
    expect(canMarkNotRelevant(u, makeRequest({ status: 'DRAFT', createdByUserId: 100 }))).toBe(
      true,
    );
    expect(canMarkNotRelevant(u, makeRequest({ status: 'RETURNED', createdByUserId: 100 }))).toBe(
      true,
    );
  });

  it('negalima pažymėti neaktualiu pateikto/patvirtinto/jau neaktualaus', () => {
    const u = makeSubmitter({ id: 100 });
    expect(canMarkNotRelevant(u, makeRequest({ status: 'SUBMITTED', createdByUserId: 100 }))).toBe(
      false,
    );
    expect(canMarkNotRelevant(u, makeRequest({ status: 'APPROVED', createdByUserId: 100 }))).toBe(
      false,
    );
    expect(canMarkNotRelevant(u, makeRequest({ status: 'NEAKTUALU', createdByUserId: 100 }))).toBe(
      false,
    );
  });

  it('pašalinis spec. negali pažymėti svetimo', () => {
    const u = makeSubmitter({ id: 100 });
    expect(canMarkNotRelevant(u, makeRequest({ status: 'DRAFT', createdByUserId: 999 }))).toBe(
      false,
    );
  });

  it('AM admin gali pažymėti tik savo „on behalf" juodraštį', () => {
    const am = makeApprover({ id: 1 });
    expect(
      canMarkNotRelevant(am, makeRequest({ status: 'DRAFT', tenantId: 2, createdByUserId: 1 })),
    ).toBe(true);
    expect(
      canMarkNotRelevant(am, makeRequest({ status: 'DRAFT', tenantId: 2, createdByUserId: 100 })),
    ).toBe(false);
  });
});

describe('canReactivate (Issue #9)', () => {
  it('savininkas gali grąžinti NEAKTUALU į juodraštį', () => {
    const u = makeSubmitter({ id: 100 });
    expect(canReactivate(u, makeRequest({ status: 'NEAKTUALU', createdByUserId: 100 }))).toBe(true);
  });

  it('negalima grąžinti ne-NEAKTUALU prašymo', () => {
    const u = makeSubmitter({ id: 100 });
    expect(canReactivate(u, makeRequest({ status: 'DRAFT', createdByUserId: 100 }))).toBe(false);
  });

  it('pašalinis spec. negali grąžinti svetimo', () => {
    const u = makeSubmitter({ id: 100 });
    expect(canReactivate(u, makeRequest({ status: 'NEAKTUALU', createdByUserId: 999 }))).toBe(
      false,
    );
  });
});

describe('STATUS_LABELS', () => {
  it('turi visus statusus su LT label (įsk. Issue #9 NEAKTUALU)', () => {
    expect(STATUS_LABELS.DRAFT).toBe('Juodraštis');
    expect(STATUS_LABELS.SUBMITTED).toBe('Pateiktas');
    expect(STATUS_LABELS.RETURNED).toBe('Grąžintas pataisymui');
    expect(STATUS_LABELS.APPROVED).toBe('Patvirtintas');
    expect(STATUS_LABELS.REJECTED).toBe('Atmestas');
    expect(STATUS_LABELS.NEAKTUALU).toBe('Neaktualus');
    expect(STATUS_VARIANTS.NEAKTUALU).toBe('muted');
  });
});

describe('isDeadlineOverdue (UAT #42 PA-010)', () => {
  const now = new Date('2026-05-25T12:00:00Z');

  it('grąžina true praėjusiam terminui (ne galutinis statusas)', () => {
    const r = makeRequest({ status: 'APPROVED', implementationDeadline: '2026-05-24' });
    expect(isDeadlineOverdue(r, now)).toBe(true);
  });

  it('grąžina false ateities terminui', () => {
    const r = makeRequest({ status: 'APPROVED', implementationDeadline: '2026-12-31' });
    expect(isDeadlineOverdue(r, now)).toBe(false);
  });

  it('grąžina false kai terminas nenustatytas', () => {
    const r = makeRequest({ status: 'SUBMITTED', implementationDeadline: null });
    expect(isDeadlineOverdue(r, now)).toBe(false);
  });

  it('grąžina false atmestam prašymui (galutinis statusas)', () => {
    const r = makeRequest({ status: 'REJECTED', implementationDeadline: '2020-01-01' });
    expect(isDeadlineOverdue(r, now)).toBe(false);
  });

  // Issue #9: neaktualaus prašymo terminas neflag'inamas.
  it('grąžina false neaktualiam (NEAKTUALU) prašymui', () => {
    const r = makeRequest({ status: 'NEAKTUALU', implementationDeadline: '2020-01-01' });
    expect(isDeadlineOverdue(r, now)).toBe(false);
  });

  it('grąžina false kai terminas — šiandien (dar nepraėjęs)', () => {
    const r = makeRequest({ status: 'APPROVED', implementationDeadline: '2026-05-25' });
    expect(isDeadlineOverdue(r, now)).toBe(false);
  });
});

// ---------- Issue #9: per-žingsnį sprendimo teisė ----------

function makeStep(overrides: Partial<ApprovalStep> = {}): ApprovalStep {
  return {
    id: 1,
    requestId: 1,
    sequence: 1,
    levelCode: 'AM_ADMIN',
    levelName: 'AM administratorius',
    status: 'PENDING',
    decidedByUserId: null,
    decidedByName: null,
    decidedAt: null,
    comment: null,
    createdAt: '2026-05-15T00:00:00Z',
    ...overrides,
  };
}

describe('currentPendingStep', () => {
  it('grąžina mažiausio sequence PENDING žingsnį', () => {
    const steps = [
      makeStep({ id: 1, sequence: 1, status: 'APPROVED' }),
      makeStep({ id: 2, sequence: 2, status: 'PENDING', levelCode: 'DEPARTMENT' }),
      makeStep({ id: 3, sequence: 3, status: 'PENDING', levelCode: 'CHANCELLOR' }),
    ];
    expect(currentPendingStep(steps)?.id).toBe(2);
  });

  it('grąžina undefined kai nėra PENDING', () => {
    expect(currentPendingStep([makeStep({ status: 'APPROVED' })])).toBeUndefined();
    expect(currentPendingStep([])).toBeUndefined();
    expect(currentPendingStep(undefined)).toBeUndefined();
  });
});

describe('canDecideStep', () => {
  const submitted = makeRequest({ status: 'SUBMITTED' });

  it('AM admin (super) gali bet kurį žingsnį', () => {
    const admin = makeApprover({ role: 'admin' });
    const step = makeStep({ levelCode: 'CHANCELLOR' });
    expect(canDecideStep(admin, submitted, step)).toBe(true);
  });

  it('AM user su atitinkamu lygiu — gali', () => {
    const user = makeApprover({ role: 'user', approvalLevelCodes: ['DEPARTMENT'] });
    const step = makeStep({ levelCode: 'DEPARTMENT' });
    expect(canDecideStep(user, submitted, step)).toBe(true);
  });

  it('AM user be atitinkamo lygio — negali', () => {
    const user = makeApprover({ role: 'user', approvalLevelCodes: ['DEPARTMENT'] });
    const step = makeStep({ levelCode: 'AM_ADMIN' });
    expect(canDecideStep(user, submitted, step)).toBe(false);
  });

  it('legacy be žingsnio (currentStep undefined) → kaip canDecide', () => {
    const user = makeApprover({ role: 'user', approvalLevelCodes: [] });
    expect(canDecideStep(user, submitted, undefined)).toBe(true);
  });

  it('ne SUBMITTED prašymas — negali (canDecide gate)', () => {
    const admin = makeApprover({ role: 'admin' });
    const draft = makeRequest({ status: 'DRAFT' });
    expect(canDecideStep(admin, draft, makeStep())).toBe(false);
  });

  it('ne-aprover (teikėjas) — negali', () => {
    const submitter = makeSubmitter();
    expect(canDecideStep(submitter, submitted, makeStep())).toBe(false);
  });
});
