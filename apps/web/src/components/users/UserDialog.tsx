import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import type {
  Tenant,
  User,
  UserCreateRequest,
  UserRole,
  UserUpdateRequest,
} from '@biip-finansai/shared';
import { Button } from '@/components/ui/button';
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
import { userCreate, userUpdate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { isAmRole, ROLE_LABELS } from '@/lib/roles';

interface FormState {
  username: string;
  password: string;
  fullName: string;
  email: string;
  role: UserRole;
  tenantId: number | '';
  amScopeOrgIds: string; // CSV
  active: boolean;
}

function emptyForm(): FormState {
  return {
    username: '',
    password: '',
    fullName: '',
    email: '',
    role: 'org_user',
    tenantId: '',
    amScopeOrgIds: '',
    active: true,
  };
}

function fromUser(u: User): FormState {
  return {
    username: u.username,
    password: '',
    fullName: u.fullName,
    email: u.email ?? '',
    role: u.role,
    tenantId: u.tenantId,
    amScopeOrgIds: u.amScopeOrgIds ? u.amScopeOrgIds.join(',') : '',
    active: u.active,
  };
}

export interface UserDialogProps {
  mode: 'create' | 'edit';
  user: User | null;
  tenants: Tenant[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function UserDialog({
  mode,
  user,
  tenants,
  open,
  onOpenChange,
  onSuccess,
}: UserDialogProps): JSX.Element {
  const { user: me } = useAuth();

  const [state, setState] = React.useState<FormState>(
    user ? fromUser(user) : emptyForm(),
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setError(null);
    setState(user ? fromUser(user) : emptyForm());
  }, [user, open]);

  const mutation = useMutation({
    mutationFn: async (): Promise<User> => {
      if (state.tenantId === '') {
        throw new Error('Pasirinkite organizaciją');
      }
      const amScope =
        isAmRole(state.role) && state.amScopeOrgIds.trim() !== ''
          ? state.amScopeOrgIds
              .split(',')
              .map((s) => Number(s.trim()))
              .filter((n) => Number.isFinite(n))
          : isAmRole(state.role)
            ? null
            : null;

      if (mode === 'create') {
        const body: UserCreateRequest = {
          username: state.username,
          password: state.password,
          fullName: state.fullName,
          email: state.email || null,
          role: state.role,
          tenantId: Number(state.tenantId),
          amScopeOrgIds: amScope,
          active: state.active,
        };
        return userCreate(body);
      }
      if (!user) throw new Error('No user');
      const patch: UserUpdateRequest = {
        username: state.username,
        fullName: state.fullName,
        email: state.email || null,
        role: state.role,
        tenantId: Number(state.tenantId),
        amScopeOrgIds: amScope,
        active: state.active,
      };
      if (state.password) patch.password = state.password;
      return userUpdate(user.id, patch);
    },
    onSuccess: () => {
      onSuccess();
    },
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

  // Tenant pasirinkimas — org_admin tik savo
  const allowedTenants = React.useMemo(() => {
    if (!me) return tenants;
    if (me.role === 'am_admin') return tenants;
    if (me.role === 'org_admin') return tenants.filter((t) => t.id === me.tenantId);
    return tenants;
  }, [me, tenants]);

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  const isCreate = mode === 'create';
  const passwordRequired = isCreate;
  const passwordPlaceholder = isCreate ? '' : 'Palikti tuščią — nekeisti';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {isCreate ? 'Naujas vartotojas' : `Redaguoti — ${user?.username}`}
            </DialogTitle>
            <DialogDescription>
              {isCreate
                ? 'Užpildykite duomenis ir paspauskite „Sukurti".'
                : 'Atnaujinkite duomenis ir paspauskite „Išsaugoti".'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ud-username">Vartotojo vardas</Label>
                <Input
                  id="ud-username"
                  required
                  value={state.username}
                  onChange={(e) =>
                    setState((s) => ({ ...s, username: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ud-fullname">Vardas pavardė</Label>
                <Input
                  id="ud-fullname"
                  required
                  value={state.fullName}
                  onChange={(e) =>
                    setState((s) => ({ ...s, fullName: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ud-email">El. paštas</Label>
              <Input
                id="ud-email"
                type="email"
                value={state.email}
                onChange={(e) =>
                  setState((s) => ({ ...s, email: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ud-password">Slaptažodis</Label>
              <Input
                id="ud-password"
                type="password"
                required={passwordRequired}
                placeholder={passwordPlaceholder}
                value={state.password}
                onChange={(e) =>
                  setState((s) => ({ ...s, password: e.target.value }))
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ud-tenant">Organizacija</Label>
                <select
                  id="ud-tenant"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  required
                  value={state.tenantId}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      tenantId: e.target.value ? Number(e.target.value) : '',
                    }))
                  }
                  disabled={me?.role === 'org_admin'}
                >
                  <option value="">Pasirinkite…</option>
                  {allowedTenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code} — {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ud-role">Rolė</Label>
                <select
                  id="ud-role"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  required
                  value={state.role}
                  onChange={(e) =>
                    setState((s) => ({ ...s, role: e.target.value as UserRole }))
                  }
                >
                  {(['am_admin', 'am_user', 'org_admin', 'org_user'] as UserRole[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isAmRole(state.role) && (
              <div className="space-y-2">
                <Label htmlFor="ud-scope">
                  AM scope — organizacijų ID (CSV, palikt tuščią = visos)
                </Label>
                <Input
                  id="ud-scope"
                  placeholder="pvz., 2,3"
                  value={state.amScopeOrgIds}
                  onChange={(e) =>
                    setState((s) => ({ ...s, amScopeOrgIds: e.target.value }))
                  }
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                id="ud-active"
                type="checkbox"
                checked={state.active}
                onChange={(e) =>
                  setState((s) => ({ ...s, active: e.target.checked }))
                }
              />
              <Label htmlFor="ud-active" className="text-sm">
                Aktyvus
              </Label>
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
