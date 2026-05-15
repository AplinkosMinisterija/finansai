import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import type {
  Tenant,
  TenantCreateRequest,
  TenantUpdateRequest,
} from '@biip-finansai/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { tenantCreate, tenantUpdate } from '@/lib/api';

interface FormState {
  code: string;
  name: string;
  description: string;
  isApprover: boolean;
  active: boolean;
}

function emptyForm(): FormState {
  return {
    code: '',
    name: '',
    description: '',
    isApprover: false,
    active: true,
  };
}

function fromTenant(t: Tenant): FormState {
  return {
    code: t.code,
    name: t.name,
    description: t.description ?? '',
    isApprover: t.isApprover,
    active: t.active,
  };
}

export interface TenantDialogProps {
  mode: 'create' | 'edit';
  tenant: Tenant | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function TenantDialog({
  mode,
  tenant,
  open,
  onOpenChange,
  onSuccess,
}: TenantDialogProps): JSX.Element {
  const [state, setState] = React.useState<FormState>(
    tenant ? fromTenant(tenant) : emptyForm(),
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setError(null);
    setState(tenant ? fromTenant(tenant) : emptyForm());
  }, [tenant, open]);

  const mutation = useMutation({
    mutationFn: async (): Promise<Tenant> => {
      if (mode === 'create') {
        const body: TenantCreateRequest = {
          code: state.code.trim(),
          name: state.name.trim(),
          description: state.description.trim() || null,
          isApprover: state.isApprover,
          active: state.active,
        };
        return tenantCreate(body);
      }
      if (!tenant) throw new Error('No tenant');
      const patch: TenantUpdateRequest = {
        code: state.code.trim(),
        name: state.name.trim(),
        description: state.description.trim() || null,
        isApprover: state.isApprover,
        active: state.active,
      };
      return tenantUpdate(tenant.id, patch);
    },
    onSuccess: () => onSuccess(),
    onError: (err: unknown) => {
      let msg = 'Nepavyko išsaugoti.';
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        if (data?.message) msg = data.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setError(msg);
    },
  });

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  const isCreate = mode === 'create';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {isCreate ? 'Nauja organizacija' : `Redaguoti — ${tenant?.code}`}
            </DialogTitle>
            <DialogDescription>
              {isCreate
                ? 'Užpildykite duomenis ir paspauskite „Sukurti".'
                : 'Atnaujinkite organizacijos duomenis.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2 col-span-1">
                <Label htmlFor="td-code">Kodas</Label>
                <Input
                  id="td-code"
                  required
                  maxLength={32}
                  placeholder="pvz., AAD"
                  value={state.code}
                  onChange={(e) =>
                    setState((s) => ({ ...s, code: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="td-name">Pavadinimas</Label>
                <Input
                  id="td-name"
                  required
                  maxLength={200}
                  value={state.name}
                  onChange={(e) =>
                    setState((s) => ({ ...s, name: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="td-desc">Aprašymas</Label>
              <textarea
                id="td-desc"
                rows={3}
                maxLength={2000}
                placeholder="Trumpas organizacijos aprašymas"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={state.description}
                onChange={(e) =>
                  setState((s) => ({ ...s, description: e.target.value }))
                }
              />
            </div>

            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="td-approver"
                  checked={state.isApprover}
                  onCheckedChange={(checked) =>
                    setState((s) => ({ ...s, isApprover: checked === true }))
                  }
                />
                <div className="flex-1">
                  <Label htmlFor="td-approver" className="cursor-pointer text-sm">
                    Tvirtintojas (AM)
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Šios organizacijos vartotojai tvirtina kitų organizacijų prašymus.
                    Paprastai tik viena — Aplinkos ministerija.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="td-active"
                  checked={state.active}
                  onCheckedChange={(checked) =>
                    setState((s) => ({ ...s, active: checked === true }))
                  }
                />
                <div className="flex-1">
                  <Label htmlFor="td-active" className="cursor-pointer text-sm">
                    Aktyvi
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Neaktyvioms org'oms negalima kurti vartotojų ar teikti prašymų.
                  </p>
                </div>
              </div>
            </div>

            {error && (
              <div
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Atšaukti
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saugoma…
                </>
              ) : isCreate ? (
                'Sukurti'
              ) : (
                'Išsaugoti'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
