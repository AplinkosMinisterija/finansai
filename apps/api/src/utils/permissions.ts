/**
 * Bendros teisių taisyklės (audit #4).
 *
 * Trijuose servisuose (requests, requestAttachments, requestReports) ta pati
 * `canView` logika kartojosi — sinchronizuoti tris vietas rankomis rizikinga.
 * Šis modulis yra autoritetingas šaltinis.
 *
 * `canEdit` / `canDecide` / `canManageReport` / `canUpload` lieka servisuose,
 * nes turi service-specific kontekstą (statuso pereinamumas, kind kategorijos).
 */
import type { AuthUser } from '@biip-finansai/shared';

type ScopedUser = Pick<
  AuthUser,
  'id' | 'role' | 'tenantId' | 'tenantIsApprover' | 'amScopeOrgIds'
>;

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
