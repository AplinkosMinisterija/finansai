import { afterEach, describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { toast, useToast, useToastStore } from './use-toast';

afterEach(() => {
  // Clear visus toast'us tarp testų — kviečiam tiesiogiai (useToastStore yra
  // hook'as, bet `clear` selektoriumi grąžina ne funkciją; naudojam useToast).
  useToast().clear();
});

describe('useToast', () => {
  it('prideda toastą į store ir grąžina ID', () => {
    const id = toast({ title: 'Sveiki', variant: 'success' });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const { result } = renderHook(() => useToastStore((s) => s.toasts));
    expect(result.current.length).toBeGreaterThan(0);
    expect(result.current.some((t) => t.title === 'Sveiki')).toBe(true);

    // Cleanup
    act(() => useToast().dismiss(id));
  });

  it('dismiss išima konkretų toastą iš sąrašo', () => {
    const id1 = toast({ title: 'A' });
    const id2 = toast({ title: 'B' });

    const { result } = renderHook(() => useToastStore((s) => s.toasts));

    expect(result.current.find((t) => t.id === id1)).toBeDefined();
    expect(result.current.find((t) => t.id === id2)).toBeDefined();

    act(() => useToast().dismiss(id1));

    expect(result.current.find((t) => t.id === id1)).toBeUndefined();
    expect(result.current.find((t) => t.id === id2)).toBeDefined();

    act(() => useToast().dismiss(id2));
  });
});
