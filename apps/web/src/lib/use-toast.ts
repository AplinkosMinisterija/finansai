/**
 * `useToast()` — labai paprastas globalus toast'ų storage'as (be Zustand'o, be
 * external deps). Pridedi toast'ą per `toast({ title, description, variant })`,
 * jis pasirodo Toaster komponente.
 *
 * Toast'ai automatiškai dingsta po `duration` (default'inė reikšmė nustatoma
 * Toaster komponente).
 */
import * as React from 'react';

export type ToastVariant = 'default' | 'success' | 'error';

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

export interface ToastEntry extends ToastInput {
  id: string;
  createdAt: number;
}

type Listener = (state: ToastState) => void;

export interface ToastState {
  toasts: ToastEntry[];
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

let entries: ToastEntry[] = [];
const listeners = new Set<Listener>();
let seq = 0;

function genId(): string {
  seq += 1;
  return `t${Date.now().toString(36)}-${seq}`;
}

function emit(): void {
  const snapshot = getState();
  for (const l of listeners) {
    l(snapshot);
  }
}

function getState(): ToastState {
  return {
    toasts: entries,
    toast: addToast,
    dismiss: dismissToast,
    clear: clearToasts,
  };
}

function addToast(input: ToastInput): string {
  const id = genId();
  const entry: ToastEntry = {
    id,
    title: input.title,
    description: input.description,
    variant: input.variant ?? 'default',
    createdAt: Date.now(),
  };
  entries = [...entries, entry];
  emit();
  return id;
}

function dismissToast(id: string): void {
  const before = entries.length;
  entries = entries.filter((t) => t.id !== id);
  if (entries.length !== before) emit();
}

function clearToasts(): void {
  if (entries.length === 0) return;
  entries = [];
  emit();
}

/**
 * Subscribe'inamas hook'as komponentams.
 */
export function useToastStore<T>(selector: (s: ToastState) => T): T {
  // Naudojam useSyncExternalStore tam, kad mažas pakeitimas konteinerį
  // perrender'intų tik vieną kartą.
  const subscribe = React.useCallback((cb: () => void): (() => void) => {
    const wrapper: Listener = () => cb();
    listeners.add(wrapper);
    return () => {
      listeners.delete(wrapper);
    };
  }, []);
  const getSnapshot = React.useCallback(() => selector(getState()), [selector]);
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Pagrindinis API — `const { toast } = useToast(); toast({ title: '...' });`.
 *
 * Veikia ir už React'o ribų (mutacijų `onSuccess` callback'uose) — žr. žemiau.
 */
export function useToast(): Pick<ToastState, 'toast' | 'dismiss' | 'clear'> {
  return {
    toast: addToast,
    dismiss: dismissToast,
    clear: clearToasts,
  };
}

/**
 * Imperatyvi API išorinė versija — naudoti tik už React komponentų ribų.
 */
export const toast = addToast;
