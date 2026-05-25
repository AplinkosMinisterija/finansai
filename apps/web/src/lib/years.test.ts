/**
 * `yearOptions` testai (UAT #40 FS-001/BP-002 helper, auditas P7).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { yearOptions } from './years';

describe('yearOptions', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function freezeYear(year: number): void {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${year}-06-15T00:00:00Z`));
  }

  it('numatytasis diapazonas — einamieji ±3, surūšiuoti didėjančia tvarka', () => {
    freezeYear(2026);
    expect(yearOptions()).toEqual([2023, 2024, 2025, 2026, 2027, 2028, 2029]);
  });

  it('include — įtraukia metus už diapazono ribų (pvz. nukopijuotą 2035)', () => {
    freezeYear(2026);
    const opts = yearOptions({ include: 2035 });
    expect(opts).toContain(2035);
    // Vis tiek surūšiuota, be dublikatų.
    expect(opts).toEqual([...new Set(opts)].sort((a, b) => a - b));
    expect(opts[opts.length - 1]).toBe(2035);
  });

  it('include diapazone — nedubliuoja', () => {
    freezeYear(2026);
    const opts = yearOptions({ include: 2026 });
    expect(opts.filter((y) => y === 2026)).toHaveLength(1);
  });

  it('include null — ignoruojamas', () => {
    freezeYear(2026);
    expect(yearOptions({ include: null })).toEqual([2023, 2024, 2025, 2026, 2027, 2028, 2029]);
  });

  it('custom back/forward', () => {
    freezeYear(2026);
    expect(yearOptions({ back: 1, forward: 1 })).toEqual([2025, 2026, 2027]);
  });
});
