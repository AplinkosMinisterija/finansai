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
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { userCreate, userUpdate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ROLE_LABELS } from '@/lib/roles';

interface FormState {
  username: string;
  password: string;
  fullName: string;
  email: string;
  role: UserRole;
  tenantId: number | '';
  amScopeOrgIds: string[]; // string IDs
  active: boolean;
}

function emptyForm(): FormState {
  return {
    username: '',
    password: '',
    fullName: '',
    email: '',
    role: 'user',
    tenantId: '',
    amScopeOrgIds: [],
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
    amScopeOrgIds: u.amScopeOrgIds ? u.amScopeOrgIds.map(String) : [],
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

  // Pasirinkto tenant'o info — žinome ar tai aprover (AM) ar teikėjas.
  const selectedTenant = React.useMemo(
    () => (state.tenantId === '' ? null : tenants.find((t) => t.id === state.tenantId) ?? null),
    [tenants, state.tenantId],
  );
  // AM scope laukas aktualus tik AM specialistui (aprover tenant + user rolė).
  const showAmScope =
    selectedTenant?.isApprover === true && state.role === 'user';

  const mutation = useMutation({
    mutationFn: async (): Promise<User> => {
      if (state.tenantId === '') {
        throw new Error('Pasirinkite organizaciją');
      }
      const amScope = showAmScope
        ? state.amScopeOrgIds
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n))
        : null;
      const amScopeFinal: number[] | null =
        showAmScope && amScope && amScope.length > 0 ? amScope : null;

      if (mode === 'create') {
        const body: UserCreateRequest = {
          username: state.username,
          password: state.password,
          fullName: state.fullName,
          email: state.email || null,
          role: state.role,
          tenantId: Number(state.tenantId),
          amScopeOrgIds: amScopeFinal,
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
        amScopeOrgIds: amScopeFinal,
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

  // Kokias org'as gali pasirinkti šis vartotojas.
  // Aprover admin'as — visas. Submitter admin'as — tik savo.
  const allowedTenants = React.useMemo(() => {
    if (!me) return tenants;
    if (me.tenantIsApprover && me.role === 'admin') return tenants;
    if (!me.tenantIsApprover && me.role === 'admin') {
      return tenants.filter((t) => t.id === me.tenantId);
    }
    return tenants;
  }, [me, tenants]);

  // Kitos pavaldžios organizacijos — kandidatai į AM scope.
  const scopeOptions: MultiSelectOption[] = React.useMemo(
    () =>
      tenants
        .filter((t) => !t.isApprover && t.active)
        .map((t) => ({
          value: String(t.id),
          label: t.name,
          sublabel: t.code,
        })),
    [tenants],
  );

  const tenantPickerDisabled = me?.tenantIsApprover === false && me.role === 'admin';

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
                <Select
                  value={state.tenantId === '' ? '' : String(state.tenantId)}
                  onValueChange={(v) =>
                    setState((s) => ({
                      ...s,
                      tenantId: v ? Number(v) : '',
                      // Numatytuoju įsijungus AM tenant'ui apvalome scope (gali būti aktualu vėliau).
                      amScopeOrgIds: [],
                    }))
                  }
                  disabled={tenantPickerDisabled}
                >
                  <SelectTrigger id="ud-tenant">
                    <SelectValue placeholder="Pasirinkite…" />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedTenants.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">
                          {t.code}
                        </span>
                        {t.name}
                        {t.isApprover && (
                          <span className="ml-1 text-[10px] uppercase text-primary">
                            tvirtintojas
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ud-role">Rolė</Label>
                <Select
                  value={state.role}
                  onValueChange={(v) =>
                    setState((s) => ({ ...s, role: v as UserRole }))
                  }
                >
                  <SelectTrigger id="ud-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['admin', 'user'] as UserRole[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {showAmScope && (
              <div className="space-y-2">
                <Label htmlFor="ud-scope">AM scope — organizacijos</Label>
                <MultiSelect
                  id="ud-scope"
                  options={scopeOptions}
                  value={state.amScopeOrgIds}
                  onChange={(next) =>
                    setState((s) => ({ ...s, amScopeOrgIds: next }))
                  }
                  emptyLabel="Visos organizacijos"
                  placeholder="Pasirinkite organizacijas…"
                  aria-label="AM scope organizacijos"
                />
                <p className="text-[11px] text-muted-foreground">
                  Palikus tuščią — specialistas matys visus pavaldžių institucijų prašymus.
                </p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Checkbox
                id="ud-active"
                checked={state.active}
                onCheckedChange={(checked) =>
                  setState((s) => ({ ...s, active: checked === true }))
                }
              />
              <Label htmlFor="ud-active" className="cursor-pointer text-sm">
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
