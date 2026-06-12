/**
 * AI dashboard spec'o persistencija localStorage (Iter 17).
 *
 * Paskutinis AI nupieštas vaizdas išsaugomas per vartotoją (raktas su user.id),
 * kad po puslapio perkrovimo grįžtų ne default'inis, o paskutinis pakeitimas.
 * Spec'as iš storage VISADA pervaliduojamas per `validateDashboardSpec` —
 * sugadinti/pasenę duomenys tyliai ignoruojami (grįžtam į default).
 */
import { validateDashboardSpec, type AiDashboardSpec } from '@biip-finansai/shared';

const PREFIX = 'finansai:ai-dashboard-spec:';

export function aiSpecStorageKey(userId: number | string | undefined): string {
  return `${PREFIX}${userId ?? 'anon'}`;
}

export function loadSavedAiSpec(key: string): AiDashboardSpec | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { spec?: unknown };
    const result = validateDashboardSpec(parsed.spec);
    return result.ok ? result.spec : null;
  } catch {
    return null;
  }
}

export function saveAiSpec(key: string, spec: AiDashboardSpec): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ spec, savedAt: new Date().toISOString() }));
  } catch {
    // localStorage nepasiekiamas/pilnas — persistencija tiesiog neveiks šioje sesijoje.
  }
}

export function clearSavedAiSpec(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
