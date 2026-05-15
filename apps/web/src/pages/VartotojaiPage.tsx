import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type {
  PaginatedResponse,
  Tenant,
  User,
} from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { UserDialog } from '@/components/users/UserDialog';
import { useAuth } from '@/lib/auth';
import { tenantsList, userDelete, usersList } from '@/lib/api';
import { canManageUsers, roleLabel } from '@/lib/roles';

export default function VartotojaiPage(): JSX.Element {
  const { user: me } = useAuth();
  const qc = useQueryClient();

  const [q, setQ] = React.useState('');
  const [debouncedQ, setDebouncedQ] = React.useState('');
  const [tenantId, setTenantId] = React.useState<number | undefined>(undefined);
  const [editing, setEditing] = React.useState<User | null>(null);
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const tenantsQ = useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: () => tenantsList(),
    staleTime: 5 * 60_000,
  });

  const listQ = useQuery<PaginatedResponse<User>>({
    queryKey: ['users', { q: debouncedQ, tenantId }],
    queryFn: () =>
      usersList({
        q: debouncedQ || undefined,
        tenantId,
        page: 1,
        pageSize: 200,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => userDelete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  function handleDelete(u: User): void {
    if (!window.confirm(`Ar tikrai šalinti ${u.fullName} (${u.username})?`)) {
      return;
    }
    deleteMutation.mutate(u.id);
  }

  const canManage = canManageUsers(me);
  const tenants = tenantsQ.data ?? [];

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vartotojai</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {listQ.isLoading
              ? 'Kraunama…'
              : `${listQ.data?.total ?? 0} vartotoj${listQ.data?.total === 1 ? 'as' : 'ai'}`}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreating(true)} data-testid="open-new-user">
            <Plus className="h-4 w-4" />
            Naujas vartotojas
          </Button>
        )}
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Ieškoti pagal vardą, vartotojo vardą ar el. paštą…"
              className="pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Paieška"
            />
          </div>
          {me?.tenantIsApprover && tenants.length > 0 && (
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={tenantId ?? ''}
              onChange={(e) =>
                setTenantId(e.target.value ? Number(e.target.value) : undefined)
              }
              aria-label="Filtras pagal organizaciją"
            >
              <option value="">Visos organizacijos</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} — {t.name}
                </option>
              ))}
            </select>
          )}
        </CardContent>
      </Card>

      {listQ.isLoading ? (
        <div className="space-y-2" data-testid="users-skeleton">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : listQ.isError ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">
            Nepavyko užkrauti vartotojų. Pamėginkite atnaujinti puslapį.
          </CardContent>
        </Card>
      ) : (listQ.data?.items.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-sm text-muted-foreground">
            Vartotojų pagal filtrą nėra.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border" data-testid="users-list">
              {(listQ.data?.items ?? []).map((u) => (
                <li
                  key={u.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  data-testid={`user-row-${u.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{u.fullName}</span>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                        {u.username}
                      </code>
                      <Badge variant="outline" className="text-[10px]">
                        {roleLabel(u)}
                      </Badge>
                      {!u.active && (
                        <Badge variant="destructive" className="text-[10px]">
                          neaktyvus
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {u.email ?? '—'} · {u.tenantName}
                      {u.amScopeOrgIds && u.amScopeOrgIds.length > 0 && (
                        <> · Scope: {u.amScopeOrgIds.join(', ')}</>
                      )}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(u)}
                        data-testid={`edit-user-${u.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                        Redaguoti
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(u)}
                        disabled={u.id === me?.id}
                        title={u.id === me?.id ? 'Negalima ištrinti savęs' : ''}
                        data-testid={`delete-user-${u.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {(creating || editing !== null) && (
        <UserDialog
          mode={editing ? 'edit' : 'create'}
          user={editing}
          tenants={tenants}
          open={creating || editing !== null}
          onOpenChange={(o) => {
            if (!o) {
              setCreating(false);
              setEditing(null);
            }
          }}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['users'] });
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
