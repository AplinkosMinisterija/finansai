/**
 * Bendros teisių taisyklės (audit #4).
 *
 * Trijuose servisuose (requests, requestAttachments, requestReports) ta pati
 * `canView` logika kartojosi — sinchronizuoti tris vietas rankomis rizikinga.
 * Šis modulis yra autoritetingas šaltinis.
 *
 * `canEdit` / `canDecide` / `canManageReport` / `canUpload` lieka servisuose,
 * nes turi service-specific kontekstą (statuso pereinamumas, kind kategorijos).
 *
 * Payroll (Iter 13, FVM-5):
 *  - `requireDuAccess` — visiems payroll endpoint'ams (CRUD profile/distribution
 *    + listing)
 *  - `requireAmDuAccess` — AM-only operacijoms (pvz. `computeMonth`)
 */
import { Errors } from 'moleculer';
import type { AuthUser } from '@biip-finansai/shared';

type ScopedUser = Pick<
  AuthUser,
  'id' | 'role' | 'tenantId' | 'tenantIsApprover' | 'amScopeOrgIds'
>;

/**
 * Meta type'as su `user` field'u — atitinka `AuthMeta` iš auth.service'o, bet
 * nereikalauja import'avimo iš ten (kad išvengtume cikliškos priklausomybės).
 */
interface MetaWithUser {
  user?: AuthUser;
}

/**
 * Ar vartotojas gali matyti prašymą pagal scope ir status.
 *
 * - AM (tvirtintojų tenant'as): mato visus scope org'ų prašymus, IŠSKYRUS
 *   pavaldžių institucijų DRAFT'us. Vienintelė išimtis — AM admin sukurtas
 *   prašymas „on behalf" (tas pats user == createdByUserId) — savo juodraštį mato.
 * - Pavaldi institucija: tik savo tenant'o prašymus.
 *   `admin` — visus tenant'e, `user` — tik savo sukurtus.
 *
 * `status` paliktas optional, nes requests.service.ts kontekste (pvz., kuriant
 * naują DRAFT) jis kartais dar neegzistuoja prieš invariantų patikrą.
 */
export function canViewRequest(
  viewer: ScopedUser,
  r: { tenantId: number; createdByUserId: number; status?: string },
): boolean {
  if (viewer.tenantIsApprover) {
    if (r.status === 'DRAFT' && r.createdByUserId !== viewer.id) return false;
    if (viewer.role === 'admin') return true;
    if (viewer.amScopeOrgIds === null) return true;
    return viewer.amScopeOrgIds.includes(r.tenantId);
  }
  if (r.tenantId !== viewer.tenantId) return false;
  if (viewer.role === 'admin') return true;
  return r.createdByUserId === viewer.id;
}

/**
 * Payroll (DU) prieigos gate'as (Iter 13, docx §4.4).
 *
 * SAUGUMO REIKALAVIMAS: DU duomenis mato TIK:
 *  - AM administratorius (visi tenant'ai)
 *  - Org admin (TIK savo tenant'as)
 *  - Specialistas (`role='user'`) — VISADA 403, net su `user_id=mine` arba
 *    tiesioginiu `GET /payroll-profiles/:savo_id`
 *
 * Šis helper'is metamas KIEKVIENAME payroll endpoint'e PIRMAS — prieš bet
 * kokias kitas operacijas (DB query, validation, etc.). Jokia operacija
 * payroll srityje neturi būti vykdoma be šio guard'o.
 *
 * @param meta - Moleculer Context.meta (paprastai `AuthMeta`).
 * @param tenantId - Jei nurodyta, org_admin gali pasiekti tik kai jo
 *   `tenantId === tenantId`. Jei `undefined` (pvz., bendras list'as) —
 *   gali patekti AM admin ir org_admin (filter'avimas tada vyksta servise
 *   pagal `me.tenantId`).
 *
 * @throws MoleculerClientError 401 jei `meta.user` nėra.
 * @throws MoleculerClientError 403 visais kitais permission'ų sutrikimais.
 */
export function requireDuAccess(
  meta: MetaWithUser,
  tenantId?: number,
): void {
  const user = meta.user;
  if (!user) {
    throw new Errors.MoleculerClientError(
      'Neautentifikuota',
      401,
      'AUTH_REQUIRED',
    );
  }
  const isAmAdmin = user.role === 'admin' && user.tenantIsApprover;
  const isOrgAdmin = user.role === 'admin' && !user.tenantIsApprover;
  if (isAmAdmin) return;
  if (isOrgAdmin) {
    if (tenantId !== undefined && user.tenantId !== tenantId) {
      throw new Errors.MoleculerClientError(
        'Neturite teisės matyti šios organizacijos DU duomenų',
        403,
        'DU_TENANT_FORBIDDEN',
      );
    }
    return;
  }
  // Specialistas / Org user — VISADA 403, net savo duomenims (docx §4.4
  // „Specialistas savo duomenų nematosi").
  throw new Errors.MoleculerClientError(
    'Neturite teisės matyti DU duomenų',
    403,
    'DU_FORBIDDEN',
  );
}

/**
 * Boolean variantas `requireDuAccess`'o (Iter 13.x saugumo patch'as).
 *
 * Naudojama, kai reikia VARYTI filter'o sluoksnį (pvz., SQL WHERE clause)
 * ne throw'inant — backend'inis ekvivalentas `apps/web/src/lib/roles.ts`
 * `canViewPayroll` helper'iui.
 *
 * Returns `true` jei:
 *  - AM administratorius (`admin` + `tenantIsApprover`), arba
 *  - Org admin (`admin` + NOT `tenantIsApprover`).
 *
 * Returns `false`:
 *  - Specialistas / org user (`role !== 'admin'`)
 *  - Neautentifikuotas (user undefined)
 *
 * SVARBU: org admin VISADA grąžina `true`, tenant scope priklauso nuo
 * vietos servise (paprastai per project.tenant_id chain'ą). Tenant scope
 * NE patikrinamas šitame helper'yje, nes naudojamas tiek single-record
 * pre-check, tiek list filter — semantiškai skirtingos vietos.
 */
export function canViewPayroll(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role !== 'admin') return false;
  // AM admin (visi tenant'ai) + Org admin (savo tenant — scope per servisus).
  return true;
}

/**
 * AM-only DU operacijų gate'as (Iter 13).
 *
 * Naudoti operacijoms, kurias gali atlikti TIK AM administratorius:
 *  - `computeMonth` (mėnesinis DU recompute į expenses)
 *  - `deleteProfile` (jei tame iter būtų buvęs hard-restrict'as iš AM pusės)
 *
 * Org admin ir žemesni vartotojai gauna 403.
 */
export function requireAmDuAccess(meta: MetaWithUser): void {
  const user = meta.user;
  if (!user) {
    throw new Errors.MoleculerClientError(
      'Neautentifikuota',
      401,
      'AUTH_REQUIRED',
    );
  }
  if (user.role !== 'admin' || !user.tenantIsApprover) {
    throw new Errors.MoleculerClientError(
      'Tik AM administratorius gali atlikti šį veiksmą',
      403,
      'AM_DU_FORBIDDEN',
    );
  }
}
