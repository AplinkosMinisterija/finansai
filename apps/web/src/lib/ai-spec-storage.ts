/**
 * AI dashboard spec'o persistencija localStorage (Iter 17–18).
 *
 * Paskutinis AI nupieštas vaizdas išsaugomas per vartotoją (raktas su user.id),
 * kad po puslapio perkrovimo grįžtų ne default'inis, o paskutinis pakeitimas.
 * Spec'as iš storage VISADA pervaliduojamas per `validateDashboardSpec` —
 * sugadinti/pasenę duomenys tyliai ignoruojami (grįžtam į default).
 *
 * Versija (Iter 18): saugom `v` lauką. SENI (v<2) vaizdai turėjo literalius
 * (užšalusius) skaičius be dataRef — jie nebepersihidruoja, todėl ATMETAMI
 * (grįžtam į gyvą default), kad vartotojas nematytų amžinai užšalusių skaičių.
 */
import { validateDashboardSpec, type AiDashboardSpec } from '@biip-finansai/shared';

const PREFIX = 'finansai:ai-dashboard-spec:';
/** Storage formato versija. <2 = Iter 17 literalūs (užšalę) spec'ai → atmetami. */
const STORAGE_VERSION = 2;

export function aiSpecStorageKey(userId: number | string | undefined): string {
  return `${PREFIX}${userId ?? 'anon'}`;
}

export function loadSavedAiSpec(key: string): AiDashboardSpec | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; spec?: unknown };
    // Senesnė versija (literalūs skaičiai be dataRef) — atmetam, naudojam gyvą default.
    if (parsed.v !== STORAGE_VERSION) return null;
    const result = validateDashboardSpec(parsed.spec);
    return result.ok ? result.spec : null;
  } catch {
    return null;
  }
}

export function saveAiSpec(key: string, spec: AiDashboardSpec): void {
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ v: STORAGE_VERSION, spec, savedAt: new Date().toISOString() }),
    );
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
