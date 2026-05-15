import { describe, expect, it } from 'vitest';
import type { AuthUser, FinancingRequest, RequestStatus } from '@biip-finansai/shared';
import {
  canCreate,
  canDecide,
  canDelete,
  canEdit,
  canSubmit,
  fmtEur,
  STATUS_LABELS,
  totalQuarterly,
  totalRequested,
} from './requests';

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 100,
    username: 'u',
    fullName: 'Test User',
    email: 'u@am.lt',
    role: 'org_user',
    tenantId: 2,
    tenantCode: 'AAD',
    tenantName: 'AAD',
    amScopeOrgIds: null,
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
    decidedAt: null,
    decidedByUserId: null,
    decidedByName: null,
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
  it('org_user / org_admin gali', () => {
    expect(canCreate(makeUser({ role: 'org_user' }))).toBe(true);
    expect(canCreate(makeUser({ role: 'org_admin' }))).toBe(true);
  });
  it('AM rolės negali', () => {
    expect(canCreate(makeUser({ role: 'am_admin' }))).toBe(false);
    expect(canCreate(makeUser({ role: 'am_user' }))).toBe(false);
  });
});

describe('canEdit', () => {
  const u = makeUser({ role: 'org_user', id: 100 });

  it('savininkas gali redaguoti DRAFT', () => {
    const r = makeRequest({ status: 'DRAFT', createdByUserId: 100 });
    expect(canEdit(u, r)).toBe(true);
  });

  it('savininkas gali redaguoti RETURNED', () => {
    const r = makeRequest({ status: 'RETURNED', createdByUserId: 100 });
    expect(canEdit(u, r)).toBe(true);
  });

  it('negalima redaguoti SUBMITTED', () => {
    const r = makeRequest({ status: 'SUBMITTED', createdByUserId: 100 });
    expect(canEdit(u, r)).toBe(false);
  });

  it('negalima redaguoti APPROVED', () => {
    const r = makeRequest({ status: 'APPROVED', createdByUserId: 100 });
    expect(canEdit(u, r)).toBe(false);
  });

  it('kitas org_user negali redaguoti', () => {
    const r = makeRequest({ status: 'DRAFT', createdByUserId: 999 });
    expect(canEdit(u, r)).toBe(false);
  });

  it('org_admin gali redaguoti bet kurio savo tenant DRAFT', () => {
    const admin = makeUser({ role: 'org_admin' });
    const r = makeRequest({ status: 'DRAFT', createdByUserId: 999 });
    expect(canEdit(admin, r)).toBe(true);
  });

  it('kito tenant org_admin negali redaguoti', () => {
    const admin = makeUser({ role: 'org_admin', tenantId: 99 });
    const r = makeRequest({ status: 'DRAFT', tenantId: 2 });
    expect(canEdit(admin, r)).toBe(false);
  });

  it('am_admin negali redaguoti (tik AM rolės sprendžia)', () => {
    const admin = makeUser({ role: 'am_admin', tenantId: 1 });
    const r = makeRequest({ status: 'DRAFT', tenantId: 2 });
    expect(canEdit(admin, r)).toBe(false);
  });
});

describe('canSubmit', () => {
  it('toks pats kaip canEdit', () => {
    const u = makeUser({ role: 'org_user' });
    const r = makeRequest({ status: 'DRAFT', createdByUserId: 100 });
    expect(canSubmit(u, r)).toBe(canEdit(u, r));
  });
});

describe('canDecide', () => {
  it('am_admin gali decide SUBMITTED', () => {
    const u = makeUser({ role: 'am_admin', tenantId: 1, amScopeOrgIds: null });
    const r = makeRequest({ status: 'SUBMITTED', tenantId: 2 });
    expect(canDecide(u, r)).toBe(true);
  });

  it('am_admin negali decide ne-SUBMITTED', () => {
    const u = makeUser({ role: 'am_admin', tenantId: 1 });
    const r = makeRequest({ status: 'APPROVED', tenantId: 2 });
    expect(canDecide(u, r)).toBe(false);
  });

  it('am_user su scope mato tik scope orgs', () => {
    const u = makeUser({ role: 'am_user', tenantId: 1, amScopeOrgIds: [2] });
    expect(canDecide(u, makeRequest({ status: 'SUBMITTED', tenantId: 2 }))).toBe(true);
    expect(canDecide(u, makeRequest({ status: 'SUBMITTED', tenantId: 3 }))).toBe(false);
  });

  it('org rolės negali decide', () => {
    const u = makeUser({ role: 'org_admin' });
    const r = makeRequest({ status: 'SUBMITTED' });
    expect(canDecide(u, r)).toBe(false);
  });
});

describe('canDelete', () => {
  it('tik DRAFT, savininko', () => {
    const u = makeUser({ role: 'org_user', id: 100 });
    expect(canDelete(u, makeRequest({ status: 'DRAFT', createdByUserId: 100 }))).toBe(true);
    expect(canDelete(u, makeRequest({ status: 'SUBMITTED', createdByUserId: 100 }))).toBe(false);
    expect(canDelete(u, makeRequest({ status: 'DRAFT', createdByUserId: 999 }))).toBe(false);
  });
});

describe('STATUS_LABELS', () => {
  it('turi visus 5 statusus su LT label', () => {
    expect(STATUS_LABELS.DRAFT).toBe('Juodraštis');
    expect(STATUS_LABELS.SUBMITTED).toBe('Pateiktas');
    expect(STATUS_LABELS.RETURNED).toBe('Grąžintas pataisymui');
    expect(STATUS_LABELS.APPROVED).toBe('Patvirtintas');
    expect(STATUS_LABELS.REJECTED).toBe('Atmestas');
  });
});
