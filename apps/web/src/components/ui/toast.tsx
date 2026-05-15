/**
 * Toast primitive — shadcn-stiliaus wrapper'is virš @radix-ui/react-toast.
 *
 * Naudojimas:
 *   <Toaster /> mount'inamas main.tsx'e prie App'o.
 *   `useToast()` (žr. lib/use-toast.ts) prideda toast'ą į queue.
 */
import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToastStore, type ToastVariant } from '@/lib/use-toast';

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  default: 'border bg-background text-foreground',
  success: 'border-green-200 bg-green-50 text-green-900',
  error: 'border-red-200 bg-red-50 text-red-900',
};

export interface ToasterProps {
  /** Position iš viršaus (default 16 desktop'e, naudojam viewport pozicijoms). */
  duration?: number;
}

/**
 * Toaster — privalo būti tarpdedinklis kontekste, kuriame `useToast` veiks.
 */
export function Toaster({ duration = 5000 }: ToasterProps): JSX.Element {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <ToastPrimitive.Provider duration={duration} swipeDirection="right">
      {toasts.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          className={cn(
            'group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-lg p-4 shadow-lg',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-80 data-[state=open]:slide-in-from-top-full',
            'data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)]',
            'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]',
            'data-[swipe=move]:transition-none data-[swipe=end]:animate-out',
            VARIANT_CLASSES[t.variant ?? 'default'],
          )}
          onOpenChange={(open) => {
            if (!open) dismiss(t.id);
          }}
          data-testid={`toast-${t.variant ?? 'default'}`}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <ToastPrimitive.Title className="text-sm font-semibold">
              {t.title}
            </ToastPrimitive.Title>
            {t.description ? (
              <ToastPrimitive.Description className="text-xs opacity-90">
                {t.description}
              </ToastPrimitive.Description>
            ) : null}
          </div>
          <ToastPrimitive.Close
            className="shrink-0 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Uždaryti"
          >
            <X className="h-4 w-4" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}

      <ToastPrimitive.Viewport
        className={cn(
          'fixed top-4 right-4 z-[100] flex max-h-screen w-full max-w-sm flex-col gap-2 outline-none',
          // Mobile: pinned to bottom + full width with side padding.
          'sm:top-4 sm:right-4',
          'max-sm:top-auto max-sm:bottom-0 max-sm:right-0 max-sm:left-0 max-sm:max-w-none max-sm:p-4',
        )}
      />
    </ToastPrimitive.Provider>
  );
}
