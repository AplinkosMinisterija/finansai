/**
 * `ApprovalStepsList` testai — Issue #9 „Jūsų eilė" žyma.
 *
 * Tikriname:
 *  - „Jūsų eilė" rodoma prie dabartinio PENDING žingsnio, kai jo lygis ∈
 *    vartotojo lygiai.
 *  - Nerodoma, kai lygis nesutampa.
 *  - AM admin (super-approver) — žyma rodoma bet kuriam dabartiniam žingsniui.
 *  - Be `viewer` prop — žyma niekada nerodoma.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ApprovalStep } from '@biip-finansai/shared';
import { ApprovalStepsList } from '../ApprovalStepsList';

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

// 3-pakopė grandinė: AM_ADMIN patvirtintas, DEPARTMENT — dabartinis PENDING.
const STEPS: ApprovalStep[] = [
  makeStep({ id: 1, sequence: 1, levelCode: 'AM_ADMIN', levelName: 'AM administratorius', status: 'APPROVED' }),
  makeStep({ id: 2, sequence: 2, levelCode: 'DEPARTMENT', levelName: 'Departamentas', status: 'PENDING' }),
  makeStep({ id: 3, sequence: 3, levelCode: 'CHANCELLOR', levelName: 'Kancleris', status: 'PENDING' }),
];

describe('ApprovalStepsList — „Jūsų eilė" (Issue #9)', () => {
  it('rodo „Jūsų eilė" kai dabartinio žingsnio lygis sutampa', () => {
    render(
      <ApprovalStepsList
        steps={STEPS}
        viewer={{ role: 'user', approvalLevelCodes: ['DEPARTMENT'] }}
      />,
    );
    expect(screen.getByText('Jūsų eilė')).toBeInTheDocument();
  });

  it('nerodo „Jūsų eilė" kai lygis nesutampa', () => {
    render(
      <ApprovalStepsList
        steps={STEPS}
        viewer={{ role: 'user', approvalLevelCodes: ['CHANCELLOR'] }}
      />,
    );
    // CHANCELLOR žingsnis (id=3) NĖRA dabartinis PENDING (dabartinis = DEPARTMENT).
    expect(screen.queryByText('Jūsų eilė')).not.toBeInTheDocument();
  });

  it('AM admin (super) mato „Jūsų eilė" dabartiniam žingsniui', () => {
    render(
      <ApprovalStepsList steps={STEPS} viewer={{ role: 'admin', approvalLevelCodes: [] }} />,
    );
    expect(screen.getByText('Jūsų eilė')).toBeInTheDocument();
  });

  it('be viewer prop — žyma nerodoma', () => {
    render(<ApprovalStepsList steps={STEPS} />);
    expect(screen.queryByText('Jūsų eilė')).not.toBeInTheDocument();
  });
});
