/**
 * Requests servisas — finansavimo prašymai.
 *
 * Statuso mašina (žr. docs/05-prasymo-modelis.md):
 *   DRAFT → SUBMITTED → (RETURNED → SUBMITTED)* → APPROVED | REJECTED
 *
 * Scope rules (žr. docs/04-vartotoju-modelis.md):
 *   - am_admin: visi prašymai
 *   - am_user: scope organizacijų prašymai
 *   - org_admin: savo tenant prašymai (CRUD draft, submit)
 *   - org_user: tik savo (=user) prašymai
 *
 * Iter 10 (FVM-2) papildymai:
 *   - 4 nauji laukai: budget_category_id, funding_source_type_id,
 *     spec_program_funding_type, fvm_project_id
 *   - Validacija create/update/decision metu (klasifikatoriaus grupė turi sutapti)
 *   - `createFvmProject` placeholder endpoint'as (real impl. Iter 11)
 */
import type { ServiceSchema, Context } from 'moleculer';
import { Errors } from 'moleculer';
import type {
  CreateFvmProjectResponse,
  FinancingRequest as RequestDTO,
  FinancingRequestDetail,
  PaginatedResponse,
  RequestComment as RequestCommentDTO,
  RequestDecisionPayload,
  RequestListQuery,
  RequestPayload,
  RequestStatus,
  SpecProgramFundingType,
} from '@biip-finansai/shared';
import { Request } from '../models/Request';
import { RequestComment } from '../models/RequestComment';
import { ApprovalStep } from '../models/ApprovalStep';
import type { ApprovalStepStatus } from '../models/ApprovalStep';
import { BudgetAllocationV2 } from '../models/BudgetAllocationV2';
import { ClassifierItem } from '../models/ClassifierItem';
import { ClassifierGroup } from '../models/ClassifierGroup';
import { FundingSource } from '../models/FundingSource';
import { Project } from '../models/Project';
import { Tenant } from '../models/Tenant';
import { User } from '../models/User';
import { normalizeAmount } from '../utils/money';
import { canViewRequest } from '../utils/permissions';
import type { AuthMeta } from './auth.service';

// ---------- FVM (Iter 10) ----------
const BUDGET_CATEGORY_GROUP_CODE = 'budget_category';
const FUNDING_SOURCE_TYPE_GROUP_CODE = 'funding_source_type';
const SPEC_PROGRAMA_CODE = 'spec_programa';
const SPEC_PROGRAM_FUNDING_TYPE_VALUES: readonly SpecProgramFundingType[] = [
  'atskiras',
  'biudzeto_dalis',
];

/**
 * Default workflow AAD scope'ui (issue #9, „šiame etape biški mažiau, bet
 * tegul daro normaliai"). AM-wide vėliau bus konfigūruojama per
 * `approval_workflows` lentelę (TODO atskirai).
 */
const DEFAULT_WORKFLOW_LEVELS = ['AM_ADMIN'] as const;

interface RequestWithRels extends Request {
  tenant?: Tenant;
  createdByUser?: User;
  decidedByUser?: User;
  comments?: (RequestComment & { authorUser?: User })[];
  approvalSteps?: (ApprovalStep & { decidedByUser?: User })[];
  budgetCategory?: ClassifierItem;
  fundingSourceType?: ClassifierItem;
}

const PAYLOAD_FIELDS = [
  'year',
  'projectName',
  'systemCode',
  'projectType',
  'description',
  'plannedWorks',
  'priority',
  'procurementStage',
  'costDu',
  'costEquipment',
  'costCreation',
  'costAnalysis',
  'costDevelopment',
  'costMaintenance',
  'costModernization',
  'costDecommissioning',
  'fundingFromIt',
  'otherFunds',
  'otherFundsSource',
  'q1Amount',
  'q2Amount',
  'q3Amount',
  'q4Amount',
  'responsibleInstitution',
  'executorName',
  'executorEmail',
  'implementationDeadline',
  'submitterNotes',
] as const;

const NUMERIC_FIELDS = new Set([
  'costDu',
  'costEquipment',
  'costCreation',
  'costAnalysis',
  'costDevelopment',
  'costMaintenance',
  'costModernization',
  'costDecommissioning',
  'fundingFromIt',
  'otherFunds',
  'q1Amount',
  'q2Amount',
  'q3Amount',
  'q4Amount',
]);

function sanitizePayload(payload: RequestPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PAYLOAD_FIELDS) {
    const value = (payload as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (NUMERIC_FIELDS.has(key)) {
      out[key] = normalizeAmount(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function requireMe(ctx: Context<unknown, AuthMeta>): NonNullable<AuthMeta['user']> {
  if (!ctx.meta.user) {
    throw new Errors.MoleculerClientError('Neautentifikuota', 401, 'AUTH_REQUIRED');
  }
  return ctx.meta.user;
}

function toRequestDTO(r: RequestWithRels): RequestDTO {
  if (!r.tenant || !r.createdByUser) {
    throw new Error(`Request ${r.id} loaded without relations`);
  }
  return {
    id: r.id,
    tenantId: r.tenantId,
    tenantCode: r.tenant.code,
    tenantName: r.tenant.name,
    createdByUserId: r.createdByUserId,
    createdByName: r.createdByUser.fullName,
    status: r.status,
    year: r.year,
    projectName: r.projectName,
    systemCode: r.systemCode,
    projectType: r.projectType,
    description: r.description,
    plannedWorks: r.plannedWorks,
    priority: r.priority,
    procurementStage: r.procurementStage,
    costDu: String(r.costDu),
    costEquipment: String(r.costEquipment),
    costCreation: String(r.costCreation),
    costAnalysis: String(r.costAnalysis),
    costDevelopment: String(r.costDevelopment),
    costMaintenance: String(r.costMaintenance),
    costModernization: String(r.costModernization),
    costDecommissioning: String(r.costDecommissioning),
    fundingFromIt: String(r.fundingFromIt),
    otherFunds: String(r.otherFunds),
    otherFundsSource: r.otherFundsSource,
    q1Amount: String(r.q1Amount),
    q2Amount: String(r.q2Amount),
    q3Amount: String(r.q3Amount),
    q4Amount: String(r.q4Amount),
    responsibleInstitution: r.responsibleInstitution,
    executorName: r.executorName,
    executorEmail: r.executorEmail,
    implementationDeadline: r.implementationDeadline,
    submitterNotes: r.submitterNotes,
    decisionGrantedAmount:
      r.decisionGrantedAmount === null ? null : String(r.decisionGrantedAmount),
    decisionFundingSource: r.decisionFundingSource,
    decisionProtocol: r.decisionProtocol,
    decisionOrder: r.decisionOrder,
    decisionOrderDate: r.decisionOrderDate,
    decidedAt: r.decidedAt,
    decidedByUserId: r.decidedByUserId,
    decidedByName: r.decidedByUser?.fullName ?? null,
    // FVM laukai (Iter 10)
    budgetCategoryId: r.budgetCategoryId,
    budgetCategoryCode: r.budgetCategory?.code ?? null,
    budgetCategoryName: r.budgetCategory?.name ?? null,
    fundingSourceTypeId: r.fundingSourceTypeId,
    fundingSourceTypeCode: r.fundingSourceType?.code ?? null,
    fundingSourceTypeName: r.fundingSourceType?.name ?? null,
    specProgramFundingType: r.specProgramFundingType,
    fvmProjectId: r.fvmProjectId,
    submittedAt: r.submittedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toCommentDTO(c: RequestComment & { authorUser?: User }): RequestCommentDTO {
  if (!c.authorUser) {
    throw new Error(`Comment ${c.id} loaded without author`);
  }
  return {
    id: c.id,
    requestId: c.requestId,
    authorUserId: c.authorUserId,
    authorName: c.authorUser.fullName,
    authorRole: c.authorUser.role,
    kind: c.kind,
    body: c.body,
    metadata: c.metadata,
    createdAt: c.createdAt,
  };
}

async function loadRequest(id: number): Promise<RequestWithRels | undefined> {
  const r = await Request.query()
    .findById(id)
    .withGraphFetched('[tenant, createdByUser, decidedByUser, budgetCategory, fundingSourceType]');
  return r as RequestWithRels | undefined;
}

async function loadRequestDetail(id: number): Promise<RequestWithRels | undefined> {
  const r = await Request.query()
    .findById(id)
    .withGraphFetched(
      '[tenant, createdByUser, decidedByUser, budgetCategory, fundingSourceType, comments.authorUser, approvalSteps.decidedByUser]',
    )
    .modifyGraph('comments', (b) => {
      b.orderBy('created_at', 'asc');
    })
    .modifyGraph('approvalSteps', (b) => {
      b.orderBy('sequence', 'asc');
    });
  return r as RequestWithRels | undefined;
}

async function resolveLevelName(code: string): Promise<string> {
  // Saugom label'ą snapshot — net jei klasifikatorius pasikeis, istorija lieka.
  const group = await ClassifierGroup.query().findOne({ code: 'approval_levels' });
  if (!group) return code;
  const item = await ClassifierItem.query().findOne({ group_id: group.id, code });
  return item?.name ?? code;
}

// ---------- FVM validacijos (Iter 10) ----------

/**
 * Patikrina, kad classifier_item priklauso `budget_category` grupei. Grąžina
 * item'ą su denormalizuotu kodu (reikia tolesniam validation'ui, pvz., ar
 * = `spec_programa`).
 *
 * Tikrina ne-NULL `itemId`'us; null'ams praleidžia validation'ą — laukas
 * optional ir backward compat'ui leidžiamas tuščias.
 */
async function validateBudgetCategory(itemId: number): Promise<ClassifierItem> {
  const item = await ClassifierItem.query().findById(itemId).withGraphFetched('group');
  if (!item) {
    throw new Errors.MoleculerClientError(
      'Biudžeto kategorija nerasta klasifikatoriuje',
      400,
      'INVALID_BUDGET_CATEGORY',
    );
  }
  const group = (item as ClassifierItem & { group?: ClassifierGroup }).group;
  if (!group || group.code !== BUDGET_CATEGORY_GROUP_CODE) {
    throw new Errors.MoleculerClientError(
      'Biudžeto kategorija turi būti iš grupės budget_category',
      400,
      'INVALID_BUDGET_CATEGORY_GROUP',
    );
  }
  return item;
}

/**
 * Patikrina, kad classifier_item priklauso `funding_source_type` grupei.
 */
async function validateFundingSourceType(itemId: number): Promise<ClassifierItem> {
  const item = await ClassifierItem.query().findById(itemId).withGraphFetched('group');
  if (!item) {
    throw new Errors.MoleculerClientError(
      'Finansavimo šaltinio tipas nerastas klasifikatoriuje',
      400,
      'INVALID_FUNDING_SOURCE_TYPE',
    );
  }
  const group = (item as ClassifierItem & { group?: ClassifierGroup }).group;
  if (!group || group.code !== FUNDING_SOURCE_TYPE_GROUP_CODE) {
    throw new Errors.MoleculerClientError(
      'Finansavimo šaltinio tipas turi būti iš grupės funding_source_type',
      400,
      'INVALID_FUNDING_SOURCE_TYPE_GROUP',
    );
  }
  return item;
}

/**
 * UAT #42 (PA-005): patikrina šaltinio programos (`source_program`) ir
 * finansavimo šaltinio tipo (`funding_source_type`) suderinamumą.
 *
 * Hierarchija: `source_program` item'as gali turėti `parent_id`, rodantį į
 * `funding_source_type` grupės item'ą. Jei AM sprendime pasirenka tiek programą
 * (`fundingSource` code), tiek šaltinio tipą (`fundingSourceTypeId`) — programos
 * tėvas TURI sutapti su pasirinktu šaltinio tipu, kitaip 400 klaida.
 *
 * Validuoja tik kai abu nurodyti. Programos be tėvo (legacy) praleidžiamos.
 */
async function validateProgramSourceConsistency(
  fundingSourceCode: string | undefined,
  fundingSourceTypeId: number | null | undefined,
): Promise<void> {
  if (!fundingSourceCode || fundingSourceTypeId === undefined || fundingSourceTypeId === null) {
    return;
  }
  const group = await ClassifierGroup.query().findOne({ code: 'source_program' });
  if (!group) return;
  const program = await ClassifierItem.query().findOne({
    group_id: group.id,
    code: fundingSourceCode,
  });
  // Programa ne iš source_program grupės arba neturi tėvo — nieko netikrinam.
  if (!program || program.parentId === null) return;
  if (program.parentId !== fundingSourceTypeId) {
    throw new Errors.MoleculerClientError(
      'Pasirinkta programa nepriklauso pasirinktam finansavimo šaltinio tipui',
      400,
      'PROGRAM_SOURCE_MISMATCH',
    );
  }
}

/**
 * Apskaičiuoja FVM laukų patch'ą iš input'o.
 *
 * Logika:
 *  - Jei `budgetCategoryId === null` arba apvis nenurodytas — atstatom NULL.
 *  - Jei `budgetCategoryId` skaičius — validuojam grupę, gauname code.
 *  - Jei `fundingSourceTypeId` — analogiškai validuojam grupę.
 *  - Jei `specProgramFundingType` nurodytas (ne null) — tik kai
 *    `budgetCategoryCode` == `spec_programa`. Kitaip 400 error.
 *
 * `existingBudgetCategoryId` reikalingas, kai input'as `specProgramFundingType`
 * yra perduotas, bet `budgetCategoryId` neperduotas — tada naudojam DB esamą
 * kategoriją validation'ui (update kontekstas).
 */
async function buildFvmPatch(
  input: {
    budgetCategoryId?: number | null;
    fundingSourceTypeId?: number | null;
    specProgramFundingType?: SpecProgramFundingType | null;
  },
  existingBudgetCategoryId?: number | null,
): Promise<Record<string, unknown>> {
  const patch: Record<string, unknown> = {};

  // Budget category
  let effectiveBudgetCategoryId: number | null | undefined = input.budgetCategoryId;
  let effectiveBudgetCategoryCode: string | null = null;
  if (input.budgetCategoryId === null) {
    patch['budgetCategoryId'] = null;
    effectiveBudgetCategoryId = null;
  } else if (typeof input.budgetCategoryId === 'number') {
    const item = await validateBudgetCategory(input.budgetCategoryId);
    patch['budgetCategoryId'] = item.id;
    effectiveBudgetCategoryCode = item.code;
  } else if (existingBudgetCategoryId !== undefined && existingBudgetCategoryId !== null) {
    // Input nesuteikia budgetCategoryId, bet update kontekste reikia žinoti
    // esamą kategoriją, kad galėtume validuoti specProgramFundingType.
    const item = await ClassifierItem.query().findById(existingBudgetCategoryId);
    if (item) effectiveBudgetCategoryCode = item.code;
    effectiveBudgetCategoryId = existingBudgetCategoryId;
  }

  // Funding source type
  if (input.fundingSourceTypeId === null) {
    patch['fundingSourceTypeId'] = null;
  } else if (typeof input.fundingSourceTypeId === 'number') {
    const item = await validateFundingSourceType(input.fundingSourceTypeId);
    patch['fundingSourceTypeId'] = item.id;
  }

  // Spec program funding type
  if (input.specProgramFundingType === null) {
    patch['specProgramFundingType'] = null;
  } else if (input.specProgramFundingType !== undefined) {
    if (!SPEC_PROGRAM_FUNDING_TYPE_VALUES.includes(input.specProgramFundingType)) {
      throw new Errors.MoleculerClientError(
        'Neteisinga spec.programos finansavimo tipo reikšmė. Galimos reikšmės: atskiras, biudzeto_dalis.',
        400,
        'INVALID_SPEC_PROGRAM_FUNDING_TYPE',
      );
    }
    if (effectiveBudgetCategoryCode !== SPEC_PROGRAMA_CODE) {
      throw new Errors.MoleculerClientError(
        'Specialiosios programos finansavimo tipą galima nurodyti tik kai biudžeto kategorija = Specialioji programa',
        400,
        'SPEC_PROGRAM_FUNDING_TYPE_REQUIRES_SPEC_PROGRAMA',
      );
    }
    patch['specProgramFundingType'] = input.specProgramFundingType;
  } else if (
    // Jei kategorija pakeičiama (ar nustatoma) į ne-spec_programa — null'inam
    // specProgramFundingType (kad neliktų inconsistent state'o).
    patch['budgetCategoryId'] !== undefined &&
    effectiveBudgetCategoryId !== null &&
    effectiveBudgetCategoryCode !== null &&
    effectiveBudgetCategoryCode !== SPEC_PROGRAMA_CODE
  ) {
    patch['specProgramFundingType'] = null;
  } else if (
    // Jei budgetCategoryId nustatomas į null — null'inam ir specProgramFundingType.
    patch['budgetCategoryId'] === null
  ) {
    patch['specProgramFundingType'] = null;
  }

  return patch;
}

function approvalStepDTO(
  s: ApprovalStep & { decidedByUser?: User },
): import('@biip-finansai/shared').ApprovalStep {
  return {
    id: s.id,
    requestId: s.requestId,
    sequence: s.sequence,
    levelCode: s.levelCode,
    levelName: s.levelName,
    status: s.status,
    decidedByUserId: s.decidedByUserId,
    decidedByName: s.decidedByUser?.fullName ?? null,
    decidedAt: s.decidedAt,
    comment: s.comment,
    createdAt: s.createdAt,
  };
}

function canEdit(
  viewer: NonNullable<AuthMeta['user']>,
  r: { tenantId: number; createdByUserId: number; status: RequestStatus },
): boolean {
  if (r.status !== 'DRAFT' && r.status !== 'RETURNED') return false;
  // AM admin gali redaguoti tai, ką pats sukūrė (kitų org vardu)
  if (viewer.tenantIsApprover) {
    return viewer.role === 'admin' && r.createdByUserId === viewer.id;
  }
  if (r.tenantId !== viewer.tenantId) return false;
  if (viewer.role === 'admin') return true;
  return r.createdByUserId === viewer.id;
}

/**
 * Issue #9: ar vartotojas „valdo" prašymą (gali archyvuoti / grąžinti /
 * ištrinti), neatsižvelgiant į status. Ta pati org/role taisyklė kaip
 * `canEdit`, tik be statuso patikros — naudojam NEAKTUALU perėjimams ir
 * delete (kur status jau patikrintas atskirai).
 */
function canManage(
  viewer: NonNullable<AuthMeta['user']>,
  r: { tenantId: number; createdByUserId: number },
): boolean {
  if (viewer.tenantIsApprover) {
    return viewer.role === 'admin' && r.createdByUserId === viewer.id;
  }
  if (r.tenantId !== viewer.tenantId) return false;
  if (viewer.role === 'admin') return true;
  return r.createdByUserId === viewer.id;
}

function canDecide(
  viewer: NonNullable<AuthMeta['user']>,
  r: { tenantId: number; status: RequestStatus },
): boolean {
  if (!viewer.tenantIsApprover) return false;
  if (r.status !== 'SUBMITTED') return false;
  if (viewer.role === 'admin') return true;
  // user role — scope
  if (viewer.amScopeOrgIds === null) return true;
  return viewer.amScopeOrgIds.includes(r.tenantId);
}

const RequestsService: ServiceSchema = {
  name: 'requests',

  actions: {
    list: {
      params: {
        q: { type: 'string', optional: true },
        status: {
          type: 'enum',
          optional: true,
          // Issue #9: pridėtas NEAKTUALU (soft-archive).
          values: ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'NEAKTUALU'],
        },
        tenantId: { type: 'number', integer: true, optional: true, convert: true },
        year: { type: 'number', integer: true, optional: true, convert: true },
        plansOnly: { type: 'boolean', optional: true, convert: true },
        page: { type: 'number', integer: true, optional: true, default: 1, convert: true },
        pageSize: { type: 'number', integer: true, optional: true, default: 50, convert: true },
      },
      async handler(
        ctx: Context<RequestListQuery, AuthMeta>,
      ): Promise<PaginatedResponse<RequestDTO>> {
        const me = requireMe(ctx);
        const { q, status, tenantId, year, plansOnly } = ctx.params;
        const page = ctx.params.page ?? 1;
        const pageSize = Math.min(ctx.params.pageSize ?? 50, 200);
        const currentYear = new Date().getFullYear();

        const query = Request.query()
          .withGraphFetched('[tenant, createdByUser, decidedByUser]')
          .orderBy('requests.id', 'desc');

        // Scope pre-filter
        if (me.tenantIsApprover) {
          // AM admin — visi; AM user — scope (NULL = visi)
          if (me.role === 'user' && me.amScopeOrgIds !== null) {
            if (me.amScopeOrgIds.length === 0) {
              return { items: [], total: 0, page, pageSize };
            }
            query.whereIn('requests.tenant_id', me.amScopeOrgIds);
          }
          // AM nemato pavaldžių institucijų juodraščių — tik savo „on behalf" sukurtus.
          query.where((qb) => {
            qb.whereNot('requests.status', 'DRAFT').orWhere('requests.created_by_user_id', me.id);
          });
        } else {
          // Pavaldi institucija
          if (me.role === 'admin') {
            query.where('requests.tenant_id', me.tenantId);
          } else {
            // user — tik savo prašymai. Tačiau gali matyti AM admin sukurtus jų org vardu.
            query
              .where('requests.tenant_id', me.tenantId)
              .andWhere('requests.created_by_user_id', me.id);
          }
        }

        if (q !== undefined && q.trim() !== '') {
          const like = `%${q.trim().toLowerCase()}%`;
          query.whereRaw('LOWER(requests.project_name) LIKE ?', [like]);
        }
        if (status !== undefined) {
          query.where('requests.status', status);
        } else {
          // Issue #9: NEAKTUALU (soft-archive) prašymai NErodomi default sąraše —
          // jie pasiekiami tik eksplicitiškai pasirinkus „Neaktualūs" filtrą.
          query.whereNot('requests.status', 'NEAKTUALU');
        }
        if (tenantId !== undefined) {
          query.where('requests.tenant_id', tenantId);
        }
        if (year !== undefined) {
          query.where('requests.year', year);
        }
        if (plansOnly) {
          query.where('requests.year', '>', currentYear);
        }

        const total = await query.clone().resultSize();
        const items = (await query
          .offset((page - 1) * pageSize)
          .limit(pageSize)) as RequestWithRels[];

        return {
          items: items.map(toRequestDTO),
          total,
          page,
          pageSize,
        };
      },
    },

    get: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<FinancingRequestDetail> {
        const me = requireMe(ctx);
        const r = await loadRequestDetail(ctx.params.id);
        if (!r) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        if (
          !canViewRequest(me, {
            tenantId: r.tenantId,
            createdByUserId: r.createdByUserId,
            status: r.status,
          })
        ) {
          throw new Errors.MoleculerClientError(
            'Neturite teisės matyti šio prašymo',
            403,
            'FORBIDDEN',
          );
        }
        const dto = toRequestDTO(r);
        const comments = (r.comments ?? []).map(toCommentDTO);
        const approvalSteps = (r.approvalSteps ?? []).map(approvalStepDTO);
        return { ...dto, comments, approvalSteps };
      },
    },

    create: {
      params: {
        tenantId: { type: 'number', integer: true, optional: true, convert: true },
        year: { type: 'number', integer: true, optional: true, convert: true },
        projectName: { type: 'string', optional: true, max: 500 },
        // FVM laukai (Iter 10) — opcionalūs (backward compat)
        budgetCategoryId: {
          type: 'number',
          integer: true,
          optional: true,
          nullable: true,
          convert: true,
        },
        fundingSourceTypeId: {
          type: 'number',
          integer: true,
          optional: true,
          nullable: true,
          convert: true,
        },
        specProgramFundingType: {
          type: 'enum',
          values: ['atskiras', 'biudzeto_dalis'],
          optional: true,
          nullable: true,
        },
      },
      async handler(
        ctx: Context<RequestPayload & { tenantId?: number }, AuthMeta>,
      ): Promise<RequestDTO> {
        const me = requireMe(ctx);
        let targetTenantId: number;

        if (me.tenantIsApprover) {
          // AM administratorius gali teikti kitų organizacijų vardu.
          // AM specialistas (user) — negali teikti, tik tvirtina.
          if (me.role !== 'admin') {
            throw new Errors.MoleculerClientError(
              'Aprover specialistai negali teikti prašymų',
              403,
              'FORBIDDEN',
            );
          }
          if (!ctx.params.tenantId) {
            throw new Errors.MoleculerClientError(
              'AM administratorius privalo nurodyti organizaciją, kurios vardu teikiamas prašymas',
              400,
              'TENANT_REQUIRED',
            );
          }
          const target = await Tenant.query().findById(ctx.params.tenantId);
          if (!target || !target.active) {
            throw new Errors.MoleculerClientError(
              'Organizacija nerasta arba neaktyvi',
              400,
              'TENANT_INVALID',
            );
          }
          if (target.isApprover) {
            throw new Errors.MoleculerClientError(
              'Prašymai teikiami tik pavaldžių organizacijų vardu',
              400,
              'TENANT_NOT_SUBMITTER',
            );
          }
          targetTenantId = target.id;
        } else {
          // Pavaldi institucija — naudoja savo tenant'ą.
          targetTenantId = me.tenantId;
        }

        const { tenantId: _tid, ...rest } = ctx.params;
        void _tid;
        const patch = sanitizePayload(rest);
        const currentYear = new Date().getFullYear();
        const requestedYear = (patch['year'] as number | undefined) ?? currentYear;
        // Leidžiame nuo current iki +5 metų (Giedrė: „planavom iki 2029 m. imtinai").
        if (
          !Number.isFinite(requestedYear) ||
          requestedYear < currentYear ||
          requestedYear > currentYear + 5
        ) {
          throw new Errors.MoleculerClientError(
            `Metai turi būti tarp ${currentYear} ir ${currentYear + 5}`,
            400,
            'YEAR_OUT_OF_RANGE',
          );
        }
        // FVM laukai (Iter 10): validuojam ir įdedam, jei pateikti.
        const fvmPatch = await buildFvmPatch({
          budgetCategoryId: ctx.params.budgetCategoryId,
          fundingSourceTypeId: ctx.params.fundingSourceTypeId,
          specProgramFundingType: ctx.params.specProgramFundingType,
        });
        const inserted = await Request.query().insert({
          tenantId: targetTenantId,
          createdByUserId: me.id,
          status: 'DRAFT',
          year: requestedYear,
          projectName: (patch['projectName'] as string) ?? 'Naujas prašymas',
          ...patch,
          ...fvmPatch,
        });
        const full = await loadRequest(inserted.id);
        if (!full) throw new Error('Inserted request not found');
        return toRequestDTO(full);
      },
    },

    update: {
      params: {
        id: { type: 'number', integer: true, convert: true },
        // FVM laukai (Iter 10) — opcionalūs
        budgetCategoryId: {
          type: 'number',
          integer: true,
          optional: true,
          nullable: true,
          convert: true,
        },
        fundingSourceTypeId: {
          type: 'number',
          integer: true,
          optional: true,
          nullable: true,
          convert: true,
        },
        specProgramFundingType: {
          type: 'enum',
          values: ['atskiras', 'biudzeto_dalis'],
          optional: true,
          nullable: true,
        },
      },
      async handler(ctx: Context<RequestPayload & { id: number }, AuthMeta>): Promise<RequestDTO> {
        const me = requireMe(ctx);
        const r = await Request.query().findById(ctx.params.id);
        if (!r) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        if (
          !canEdit(me, {
            tenantId: r.tenantId,
            createdByUserId: r.createdByUserId,
            status: r.status,
          })
        ) {
          throw new Errors.MoleculerClientError(
            'Neturite teisės redaguoti šio prašymo arba jis nėra DRAFT/RETURNED būsenoje',
            403,
            'FORBIDDEN',
          );
        }
        const { id: _id, ...rest } = ctx.params;
        void _id;
        const patch = sanitizePayload(rest);
        // FVM laukai (Iter 10): validuojam tik tai, ką input atneša; perduodam
        // DB esamą `budgetCategoryId`, kad specProgramFundingType validation
        // veiktų net jei input atneša tik šitą lauką.
        const fvmPatch = await buildFvmPatch(
          {
            budgetCategoryId: ctx.params.budgetCategoryId,
            fundingSourceTypeId: ctx.params.fundingSourceTypeId,
            specProgramFundingType: ctx.params.specProgramFundingType,
          },
          r.budgetCategoryId,
        );
        await Request.query()
          .findById(r.id)
          .patch({ ...patch, ...fvmPatch });
        const full = await loadRequest(r.id);
        if (!full) throw new Error('Updated request not found');
        return toRequestDTO(full);
      },
    },

    submit: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<RequestDTO> {
        const me = requireMe(ctx);
        const r = await Request.query().findById(ctx.params.id);
        if (!r) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        if (
          !canEdit(me, {
            tenantId: r.tenantId,
            createdByUserId: r.createdByUserId,
            status: r.status,
          })
        ) {
          throw new Errors.MoleculerClientError(
            'Neturite teisės teikti arba prašymas ne DRAFT/RETURNED būsenoje',
            403,
            'FORBIDDEN',
          );
        }
        if (!r.projectName || r.projectName.trim() === '') {
          throw new Errors.MoleculerClientError(
            'Projekto pavadinimas privalomas',
            400,
            'VALIDATION_PROJECT_NAME',
          );
        }
        await Request.query().findById(r.id).patch({
          status: 'SUBMITTED',
          submittedAt: new Date().toISOString(),
        });
        await RequestComment.query().insert({
          requestId: r.id,
          authorUserId: me.id,
          kind: 'submitted',
          body: null,
          metadata: { fromStatus: r.status, toStatus: 'SUBMITTED' },
        });

        // Issue #9: sukuriam aprobacijos žingsnius (default workflow).
        // Resubmit iš RETURNED — sukuriam naują seriją žingsnių (next sequence).
        const existing = (await ApprovalStep.query()
          .where('request_id', r.id)
          .max('sequence as max')) as unknown as Array<{ max: number | null }>;
        const startSeq = (existing[0]?.max ?? 0) + 1;
        for (let i = 0; i < DEFAULT_WORKFLOW_LEVELS.length; i++) {
          const code = DEFAULT_WORKFLOW_LEVELS[i]!;
          const name = await resolveLevelName(code);
          await ApprovalStep.query().insert({
            requestId: r.id,
            sequence: startSeq + i,
            levelCode: code,
            levelName: name,
            status: 'PENDING',
          });
        }

        const full = await loadRequest(r.id);
        if (!full) throw new Error('Submitted request not found');
        return toRequestDTO(full);
      },
    },

    delete: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<{ ok: true }> {
        const me = requireMe(ctx);
        const r = await Request.query().findById(ctx.params.id);
        if (!r) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        // Issue #9: ištrinti galima DRAFT arba NEAKTUALU (soft-archive) prašymus.
        if (r.status !== 'DRAFT' && r.status !== 'NEAKTUALU') {
          throw new Errors.MoleculerClientError(
            'Galima ištrinti tik DRAFT arba NEAKTUALU prašymus',
            400,
            'INVALID_STATUS',
          );
        }
        // NEAKTUALU prašymas `canEdit` netinka (jis reikalauja DRAFT/RETURNED),
        // todėl teisę tikrinam per bendrą „valdo prašymą" taisyklę.
        if (!canManage(me, { tenantId: r.tenantId, createdByUserId: r.createdByUserId })) {
          throw new Errors.MoleculerClientError('Neturite teisės', 403, 'FORBIDDEN');
        }
        await Request.query().deleteById(r.id);
        return { ok: true };
      },
    },

    /**
     * Issue #9: pažymėti prašymą neaktualiu (soft-archive). Suplanuotą/
     * sugeneruotą DRAFT arba RETURNED prašymą institucija gali pažymėti
     * „neaktualiu" vietoj pateikimo — jis pašalinamas iš aktyvaus srauto.
     *
     * Teisės: tos pačios kaip teikti (`canEdit`) — teikėjas iš tos org,
     * org admin arba AM admin „on behalf" savo sukurtam juodraščiui.
     */
    markNotRelevant: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<RequestDTO> {
        const me = requireMe(ctx);
        const r = await Request.query().findById(ctx.params.id);
        if (!r) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        // `canEdit` reikalauja DRAFT/RETURNED — tas pat reikalavimas galioja
        // ir archyvavimui (negalima archyvuoti pateikto/patvirtinto/atmesto).
        if (
          !canEdit(me, {
            tenantId: r.tenantId,
            createdByUserId: r.createdByUserId,
            status: r.status,
          })
        ) {
          throw new Errors.MoleculerClientError(
            'Neturite teisės arba prašymas ne DRAFT/RETURNED būsenoje',
            403,
            'FORBIDDEN',
          );
        }
        await Request.query().findById(r.id).patch({ status: 'NEAKTUALU' });
        await RequestComment.query().insert({
          requestId: r.id,
          authorUserId: me.id,
          kind: 'marked_not_relevant',
          body: null,
          metadata: { fromStatus: r.status, toStatus: 'NEAKTUALU' },
        });
        const full = await loadRequest(r.id);
        if (!full) throw new Error('Marked request not found');
        return toRequestDTO(full);
      },
    },

    /**
     * Issue #9: grąžinti neaktualų prašymą atgal į juodraštį (reaktyvuoti).
     * Klaidingai archyvuotą planą galima atgaivinti.
     *
     * Teisės: tos pačios kaip archyvuoti — teikėjas iš tos org, org admin
     * arba AM admin „on behalf".
     */
    markActive: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<RequestDTO> {
        const me = requireMe(ctx);
        const r = await Request.query().findById(ctx.params.id);
        if (!r) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        if (r.status !== 'NEAKTUALU') {
          throw new Errors.MoleculerClientError(
            'Grąžinti į juodraštį galima tik NEAKTUALU prašymą',
            400,
            'INVALID_STATUS',
          );
        }
        if (!canManage(me, { tenantId: r.tenantId, createdByUserId: r.createdByUserId })) {
          throw new Errors.MoleculerClientError('Neturite teisės', 403, 'FORBIDDEN');
        }
        await Request.query().findById(r.id).patch({ status: 'DRAFT' });
        await RequestComment.query().insert({
          requestId: r.id,
          authorUserId: me.id,
          kind: 'reactivated',
          body: null,
          metadata: { fromStatus: 'NEAKTUALU', toStatus: 'DRAFT' },
        });
        const full = await loadRequest(r.id);
        if (!full) throw new Error('Reactivated request not found');
        return toRequestDTO(full);
      },
    },

    /**
     * Issue #4: konvertuoti planą (year > currentYear, status != DRAFT) į einamųjų
     * metų prašymą — sukuriama nauja DRAFT kopija su year = currentYear.
     * Plano įrašas paliekamas kaip istorija.
     */
    convertPlanToCurrentYear: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<RequestDTO> {
        const me = requireMe(ctx);
        const src = await Request.query().findById(ctx.params.id);
        if (!src) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        if (
          !canViewRequest(me, {
            tenantId: src.tenantId,
            createdByUserId: src.createdByUserId,
            status: src.status,
          })
        ) {
          throw new Errors.MoleculerClientError('Neturite teisės', 403, 'FORBIDDEN');
        }
        // Tik teikėjas iš tos org (arba AM admin „on behalf") gali konvertuoti.
        if (me.tenantIsApprover) {
          if (me.role !== 'admin') {
            throw new Errors.MoleculerClientError(
              'Tik AM admin gali konvertuoti',
              403,
              'FORBIDDEN',
            );
          }
        } else if (src.tenantId !== me.tenantId) {
          throw new Errors.MoleculerClientError('Neturite teisės', 403, 'FORBIDDEN');
        }

        const currentYear = new Date().getFullYear();
        if (src.year <= currentYear) {
          throw new Errors.MoleculerClientError(
            'Konvertuoti galima tik ateinančių metų planą',
            400,
            'PLAN_NOT_FUTURE',
          );
        }
        if (src.status === 'DRAFT') {
          throw new Errors.MoleculerClientError(
            'Juodraščio konvertuoti nereikia — tiesiog atnaujinkite metus',
            400,
            'INVALID_STATUS',
          );
        }

        // Patikriname ar jau yra einamų metų DRAFT, sukurtas iš to paties tenant'o
        // su tuo pačiu projektu (paprasta duplikatų prevencija).
        const dup = await Request.query()
          .where({
            tenant_id: src.tenantId,
            year: currentYear,
            project_name: src.projectName,
            status: 'DRAFT',
          })
          .first();
        if (dup) {
          throw new Errors.MoleculerClientError(
            `Einamųjų metų juodraštis tokiu pat pavadinimu jau egzistuoja (#${dup.id})`,
            409,
            'DUPLICATE_DRAFT',
          );
        }

        // Patikriname, ar planas turi bent vieną įvestą sumą — kitaip neprasminga konvertuoti.
        const costSum =
          Number(src.costDu) +
          Number(src.costEquipment) +
          Number(src.costCreation) +
          Number(src.costAnalysis) +
          Number(src.costDevelopment) +
          Number(src.costMaintenance) +
          Number(src.costModernization) +
          Number(src.costDecommissioning);
        if (!(costSum > 0)) {
          throw new Errors.MoleculerClientError(
            'Planas neturi įvestų sumų — pirma užpildykite finansavimo dalį',
            400,
            'PLAN_EMPTY',
          );
        }

        const inserted = await Request.query().insert({
          tenantId: src.tenantId,
          createdByUserId: me.id,
          status: 'DRAFT',
          year: currentYear,
          projectName: src.projectName,
          systemCode: src.systemCode,
          projectType: src.projectType,
          description: src.description,
          plannedWorks: src.plannedWorks,
          priority: src.priority,
          procurementStage: src.procurementStage,
          costDu: src.costDu,
          costEquipment: src.costEquipment,
          costCreation: src.costCreation,
          costAnalysis: src.costAnalysis,
          costDevelopment: src.costDevelopment,
          costMaintenance: src.costMaintenance,
          costModernization: src.costModernization,
          costDecommissioning: src.costDecommissioning,
          fundingFromIt: src.fundingFromIt,
          otherFunds: src.otherFunds,
          otherFundsSource: src.otherFundsSource,
          q1Amount: src.q1Amount,
          q2Amount: src.q2Amount,
          q3Amount: src.q3Amount,
          q4Amount: src.q4Amount,
          responsibleInstitution: src.responsibleInstitution,
          executorName: src.executorName,
          executorEmail: src.executorEmail,
          implementationDeadline: src.implementationDeadline,
          submitterNotes: src.submitterNotes,
        });
        const full = await loadRequest(inserted.id);
        if (!full) throw new Error('Inserted request not found');
        return toRequestDTO(full);
      },
    },

    decision: {
      params: {
        id: { type: 'number', integer: true, convert: true },
        decision: { type: 'enum', values: ['approve', 'reject', 'return'] },
        comment: { type: 'string', optional: true, max: 4000 },
        grantedAmount: { type: 'number', optional: true, min: 0, convert: true },
        fundingSource: { type: 'string', optional: true, max: 500 },
        protocol: { type: 'string', optional: true, max: 500 },
        order: { type: 'string', optional: true, max: 500 },
        // UAT #42 (PA-006): įsakymo data — date picker (YYYY-MM-DD).
        orderDate: { type: 'string', optional: true, nullable: true, max: 10 },
        // UAT #42 (PA-002): prioritetas + pirkimo stadija tapo AM sprendimo laukais.
        priority: {
          type: 'number',
          integer: true,
          optional: true,
          nullable: true,
          min: 1,
          max: 5,
          convert: true,
        },
        procurementStage: { type: 'string', optional: true, nullable: true, max: 500 },
        // UAT #42 (PA-003): finansavimo šaltinio laukai tapo AM sprendimo laukais.
        fundingFromIt: { type: 'number', optional: true, nullable: true, min: 0, convert: true },
        otherFunds: { type: 'number', optional: true, nullable: true, min: 0, convert: true },
        otherFundsSource: { type: 'string', optional: true, nullable: true, max: 500 },
        // FVM laukai (Iter 10, docx §3.3): AM gali pakeisti kategoriją per
        // patvirtinimą. Visi optional — be jų veikia kaip iki šiol.
        budgetCategoryId: {
          type: 'number',
          integer: true,
          optional: true,
          nullable: true,
          convert: true,
        },
        fundingSourceTypeId: {
          type: 'number',
          integer: true,
          optional: true,
          nullable: true,
          convert: true,
        },
        specProgramFundingType: {
          type: 'enum',
          values: ['atskiras', 'biudzeto_dalis'],
          optional: true,
          nullable: true,
        },
      },
      async handler(
        ctx: Context<RequestDecisionPayload & { id: number }, AuthMeta>,
      ): Promise<RequestDTO> {
        const me = requireMe(ctx);
        const r = await Request.query().findById(ctx.params.id);
        if (!r) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        if (!canDecide(me, { tenantId: r.tenantId, status: r.status })) {
          throw new Errors.MoleculerClientError(
            'Neturite teisės arba prašymas ne SUBMITTED būsenoje',
            403,
            'FORBIDDEN',
          );
        }
        const p = ctx.params;
        const isApprove = p.decision === 'approve';
        const isReject = p.decision === 'reject';
        const isReturn = p.decision === 'return';

        if (isReturn) {
          // Grąžinimui komentaras privalomas — teikėjas turi žinoti, ką taisyti.
          // Atmetimui neprivalomas (pvz. AM nenori paskelbti tikrosios priežasties).
          if (!p.comment || p.comment.trim() === '') {
            throw new Errors.MoleculerClientError(
              'Grąžinimas pataisymui reikalauja komentaro',
              400,
              'COMMENT_REQUIRED',
            );
          }
        }

        const now = new Date().toISOString();
        const patch: Record<string, unknown> = {};
        let newStatus: RequestStatus;
        let kind: 'returned' | 'approved' | 'rejected';

        // FVM laukai (Iter 10): AM gali koreguoti per patvirtinimą.
        // Validuojam ANKSTI — jei klaidinga reikšmė, niekas nesikeičia.
        // Esamą `r.budgetCategoryId` perduodam fallback'ui (jei nurodytas
        // tik `specProgramFundingType` be `budgetCategoryId` — validuoti
        // pagal esamą kategoriją).
        const fvmPatch = await buildFvmPatch(
          {
            budgetCategoryId: p.budgetCategoryId,
            fundingSourceTypeId: p.fundingSourceTypeId,
            specProgramFundingType: p.specProgramFundingType,
          },
          r.budgetCategoryId,
        );

        // UAT #42 (PA-005): jei AM nurodo tiek programą, tiek šaltinio tipą —
        // jie turi būti suderinti (programos tėvas = šaltinio tipas). Validuojam
        // ANKSTI — prieš bet kokį patch'ą.
        await validateProgramSourceConsistency(p.fundingSource, p.fundingSourceTypeId);

        if (isApprove) {
          newStatus = 'APPROVED';
          kind = 'approved';
          patch['decisionGrantedAmount'] =
            p.grantedAmount !== undefined ? normalizeAmount(p.grantedAmount) : null;
          patch['decisionFundingSource'] = p.fundingSource ?? null;
          patch['decisionProtocol'] = p.protocol ?? null;
          patch['decisionOrder'] = p.order ?? null;
          // UAT #42 (PA-006): įsakymo data per date picker.
          patch['decisionOrderDate'] = p.orderDate ?? null;
          patch['decidedAt'] = now;
          patch['decidedByUserId'] = me.id;
        } else if (isReject) {
          newStatus = 'REJECTED';
          kind = 'rejected';
          patch['decidedAt'] = now;
          patch['decidedByUserId'] = me.id;
        } else {
          newStatus = 'RETURNED';
          kind = 'returned';
        }

        // FVM laukai įdedami nepriklausomai nuo sprendimo tipo (approve/reject/return),
        // — AM gali koreguoti kategoriją prieš return ar reject taip pat.
        Object.assign(patch, fvmPatch);

        // UAT #42 (PA-002 / PA-003): prioritetas, pirkimo stadija ir finansavimo
        // šaltinio laukai tapo AM sprendimo laukais (nebepildomi teikėjo). AM
        // nustato juos per sprendimo formą — nepriklausomai nuo sprendimo tipo.
        if (p.priority !== undefined) patch['priority'] = p.priority;
        if (p.procurementStage !== undefined) patch['procurementStage'] = p.procurementStage;
        if (p.fundingFromIt !== undefined) {
          patch['fundingFromIt'] = p.fundingFromIt === null ? 0 : normalizeAmount(p.fundingFromIt);
        }
        if (p.otherFunds !== undefined) {
          patch['otherFunds'] = p.otherFunds === null ? 0 : normalizeAmount(p.otherFunds);
        }
        if (p.otherFundsSource !== undefined) patch['otherFundsSource'] = p.otherFundsSource;

        // Audit #10: visi Request + ApprovalStep + RequestComment rašymai turi
        // įvykti atominėje transakcijoje. Read'ai po commit'o (loadRequest)
        // paliekam ne transakcijoje.
        const knex = Request.knex();
        const trx = await knex.transaction();
        try {
          // Issue #9: pažymim dabartinį PENDING žingsnį.
          const currentStep = await ApprovalStep.query(trx)
            .where({ request_id: r.id, status: 'PENDING' })
            .orderBy('sequence', 'asc')
            .first();

          let stepStatus: ApprovalStepStatus;
          if (isApprove) stepStatus = 'APPROVED';
          else if (isReject) stepStatus = 'REJECTED';
          else stepStatus = 'RETURNED';

          if (currentStep) {
            await ApprovalStep.query(trx)
              .findById(currentStep.id)
              .patch({
                status: stepStatus,
                decidedByUserId: me.id,
                decidedAt: now,
                comment: p.comment ?? null,
              });
          }

          // Daugiapakopei aprobacijai (visa AM): jei APPROVED + dar yra PENDING žingsnių
          // → newStatus = SUBMITTED (toliau eina kitam approver'iui).
          // Šitam etape (AAD, 1 žingsnis) — neegzistuoja kitas PENDING žingsnis,
          // todėl pereinam į APPROVED, kaip iki šiol.
          if (isApprove && currentStep) {
            const nextPending = await ApprovalStep.query(trx)
              .where({ request_id: r.id, status: 'PENDING' })
              .first();
            if (nextPending) {
              newStatus = 'SUBMITTED';
              // Decision metadata einam atsekti tik kai paskutinis žingsnis OK.
              delete patch['decisionGrantedAmount'];
              delete patch['decisionFundingSource'];
              delete patch['decisionProtocol'];
              delete patch['decisionOrder'];
              delete patch['decidedAt'];
              delete patch['decidedByUserId'];
            }
          }

          patch['status'] = newStatus;
          await Request.query(trx).findById(r.id).patch(patch);
          await RequestComment.query(trx).insert({
            requestId: r.id,
            authorUserId: me.id,
            kind,
            body: p.comment ?? null,
            metadata: {
              fromStatus: r.status,
              toStatus: newStatus,
              ...(currentStep
                ? { stepSequence: currentStep.sequence, stepLevel: currentStep.levelCode }
                : {}),
              ...(isApprove
                ? {
                    grantedAmount: patch['decisionGrantedAmount'],
                    fundingSource: patch['decisionFundingSource'],
                    protocol: patch['decisionProtocol'],
                    order: patch['decisionOrder'],
                  }
                : {}),
            },
          });

          await trx.commit();
        } catch (e) {
          await trx.rollback();
          throw e;
        }

        const full = await loadRequest(r.id);
        if (!full) throw new Error('Decided request not found');
        return toRequestDTO(full);
      },
    },

    addComment: {
      params: {
        id: { type: 'number', integer: true, convert: true },
        body: { type: 'string', min: 1, max: 4000 },
      },
      async handler(
        ctx: Context<{ id: number; body: string }, AuthMeta>,
      ): Promise<RequestCommentDTO> {
        const me = requireMe(ctx);
        const r = await Request.query().findById(ctx.params.id);
        if (!r) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        if (
          !canViewRequest(me, {
            tenantId: r.tenantId,
            createdByUserId: r.createdByUserId,
            status: r.status,
          })
        ) {
          throw new Errors.MoleculerClientError('Neturite teisės', 403, 'FORBIDDEN');
        }
        const inserted = await RequestComment.query().insert({
          requestId: r.id,
          authorUserId: me.id,
          kind: 'comment',
          body: ctx.params.body,
          metadata: null,
        });
        const full = await RequestComment.query()
          .findById(inserted.id)
          .withGraphFetched('authorUser');
        if (!full) throw new Error('Comment not found');
        return toCommentDTO(full as RequestComment & { authorUser: User });
      },
    },

    /**
     * `createFvmProject` — Iter 11 real implementation (P04 docx §3.3).
     *
     * Sukuria `projects` įrašą iš patvirtinto spec.programos prašymo:
     *  - tipas = `spec_programa`
     *  - biudzetas = `request.decisionGrantedAmount`
     *  - request_id = prašymo ID
     *  - tenant_id = prašymo tenant'as
     *  - budget_allocation_id = automatiškai parinkta budget eilutė
     *    (tenant'o, šių metų, kurioje kategorija = `spec_programa`)
     *
     * Visa transakcijoje: jei kuris žingsnis fail'ina, niekas nepasikeičia.
     *
     * Tik AM admin gali kviesti (`tenantIsApprover` + `role === 'admin'`).
     * Prašymas turi būti APPROVED ir dar neturėti `fvmProjectId`.
     *
     * Jei prašymo `budgetCategory` ne `spec_programa` — grąžinama LT klaida
     * „rankiniu būdu", kviečiant naudoti /projektai puslapį.
     */
    createFvmProject: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<CreateFvmProjectResponse> {
        const me = requireMe(ctx);
        if (!me.tenantIsApprover || me.role !== 'admin') {
          throw new Errors.MoleculerClientError(
            'FVM projektą iš prašymo gali sukurti tik AM administratorius',
            403,
            'FORBIDDEN',
          );
        }
        const r = (await Request.query()
          .findById(ctx.params.id)
          .withGraphFetched('budgetCategory')) as
          | (Request & { budgetCategory?: ClassifierItem })
          | undefined;
        if (!r) {
          throw new Errors.MoleculerClientError('Prašymas nerastas', 404, 'REQUEST_NOT_FOUND');
        }
        if (r.status !== 'APPROVED') {
          throw new Errors.MoleculerClientError(
            'Galima sukurti tik patvirtinto prašymo projektą',
            400,
            'INVALID_STATUS',
          );
        }
        if (r.fvmProjectId !== null) {
          throw new Errors.MoleculerClientError(
            'Šiam prašymui projektas jau sukurtas',
            400,
            'REQUEST_ALREADY_HAS_PROJECT',
          );
        }

        // Šio iter'o auto-create palaiko TIK spec.programos kategorijos
        // prašymus. Kitiems (DU, prekes_paslaugos, investicijos, kita) AM
        // turi sukurti projektą rankiniu būdu per /projektai (frontend),
        // nes biudžeto eilutės pasirinkimas reikalauja kontekstinio
        // sprendimo (kuriai konkrečiai allocation tipui pridėti).
        if (!r.budgetCategory || r.budgetCategory.code !== SPEC_PROGRAMA_CODE) {
          throw new Errors.MoleculerClientError(
            'Šio tipo prašymui projektas kuriamas rankiniu būdu per /projektai',
            400,
            'NOT_SPEC_PROGRAMA',
          );
        }

        if (r.budgetCategoryId === null) {
          // Defensyvi patikra — į šitą šaką neturėtų patekti, nes budgetCategory
          // egzistuoja tik kai FK užpildytas.
          throw new Errors.MoleculerClientError(
            'Prašymas neturi nustatytos biudžeto kategorijos',
            400,
            'NO_BUDGET_CATEGORY',
          );
        }

        // Surasti budget_allocation: tenant + metai + kategorija = spec_programa
        // item ID. Per funding_sources.tenant_id chain'ą. Naudojam raw join,
        // nes Objection `joinRelated` alias'ai neperleidžia camelCase columnNameMappers
        // į snake_case at JOIN level.
        const candidateAllocations = (await BudgetAllocationV2.query()
          .innerJoin(
            'funding_sources',
            'budget_allocations_v2.funding_source_id',
            'funding_sources.id',
          )
          .where('budget_allocations_v2.metai', r.year)
          .where('budget_allocations_v2.category_classifier_item_id', r.budgetCategoryId)
          .where('funding_sources.tenant_id', r.tenantId)
          .orderBy('budget_allocations_v2.id', 'asc')
          .select('budget_allocations_v2.*')) as BudgetAllocationV2[];

        if (candidateAllocations.length === 0) {
          throw new Errors.MoleculerClientError(
            'Nerasta tinkama biudžeto eilutė šiam prašymui. Pirma sukurkite spec.programos biudžeto eilutę šiems metams.',
            400,
            'NO_MATCHING_ALLOCATION',
          );
        }
        // TODO Iter 14: kai allocation kandidatų yra kelios, leisti AM admin
        // pasirinkti per UI (dabar imam pirmąjį pagal ID ASC — stabilus deterministic
        // pasirinkimas).
        const allocation = candidateAllocations[0]!;

        const grantedAmount = r.decisionGrantedAmount ?? '0';

        const knex = Request.knex();
        const newProject = await knex.transaction(async (trx) => {
          const projectName =
            r.projectName.length > 280
              ? r.projectName.slice(0, 280)
              : `Spec. programa: ${r.projectName}`;
          const inserted = await Project.query(trx).insert({
            tenantId: r.tenantId,
            budgetAllocationId: allocation.id,
            requestId: r.id,
            pavadinimas: projectName.length > 300 ? projectName.slice(0, 300) : projectName,
            tipas: 'spec_programa',
            biudzetas: grantedAmount,
            statusas: 'planuojama',
            atsakingasUserId: r.createdByUserId,
            aprasymas: r.description ?? null,
          });
          await Request.query(trx).findById(r.id).patch({ fvmProjectId: inserted.id });
          return inserted;
        });

        // Eager load relations response'ui (transakcijos pabaigoje).
        const full = (await Project.query()
          .findById(newProject.id)
          .withGraphFetched('[tenant, budgetAllocation, request, atsakingasUser]')) as
          | (Project & {
              tenant?: Tenant;
              budgetAllocation?: BudgetAllocationV2;
              request?: Request;
              atsakingasUser?: User;
            })
          | undefined;
        if (!full) {
          throw new Error('Created project not found after commit');
        }

        return {
          status: 'created',
          message: 'Projektas sėkmingai sukurtas',
          requestId: r.id,
          project: {
            id: full.id,
            tenantId: full.tenantId,
            tenantCode: full.tenant?.code,
            tenantName: full.tenant?.name,
            budgetAllocationId: full.budgetAllocationId,
            budgetAllocationName: full.budgetAllocation?.pavadinimas,
            requestId: full.requestId,
            requestProjectName: full.request?.projectName ?? null,
            pavadinimas: full.pavadinimas,
            tipas: full.tipas,
            biudzetas: full.biudzetas,
            pradziosData: full.pradziosData,
            pabaigosData: full.pabaigosData,
            statusas: full.statusas,
            atsakingasUserId: full.atsakingasUserId,
            atsakingasUserName: full.atsakingasUser?.fullName ?? null,
            aprasymas: full.aprasymas,
            isDuSystem: full.isDuSystem,
            createdAt: full.createdAt,
            updatedAt: full.updatedAt,
          },
        };
      },
    },
  },
};

export default RequestsService;
