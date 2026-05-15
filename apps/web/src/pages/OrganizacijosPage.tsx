/**
 * Organizacijų valdymas (tik AM administratoriams).
 *
 * Rodo:
 *  - Tvirtintojas (AM) — atskirai viršuje
 *  - Pavaldžios institucijos — sąraše
 *  - CRUD per TenantDialog
 *  - Vartotojų/prašymų skaičiukai pagal organizaciją
 */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, FileText, Pencil, Plus, Trash2, Users } from 'lucide-react';
import type { Tenant } from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TenantDialog } from '@/components/tenants/TenantDialog';
import { tenantDelete, tenantsList } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { canManageTenants } from '@/lib/roles';
import { cn } from '@/lib/utils';

export default function OrganizacijosPage(): JSX.Element {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [editing, setEditing] = React.useState<Tenant | null>(null);
  const [creating, setCreating] = React.useState(false);

  const listQ = useQuery<Tenant[]>({
    queryKey: ['tenants', { withCounts: true }],
    queryFn: () => tenantsList(true),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => tenantDelete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (err: unknown) => {
      const data =
        err instanceof Error && 'response' in err
          ? ((err as { response?: { data?: { message?: string } } }).response?.data?.message ?? null)
          : null;
      window.alert(data ?? 'Nepavyko ištrinti organizacijos.');
    },
  });

  function handleDelete(t: Tenant): void {
    if (!window.confirm(`Ar tikrai ištrinti organizaciją „${t.name}"?`)) {
      return;
    }
    deleteMutation.mutate(t.id);
  }

  if (!canManageTenants(user)) {
    return (
      <div className="mx-auto max-w-2xl p-4 md:p-6">
        <Card>
          <CardContent className="p-12 text-center text-sm text-muted-foreground">
            Šis puslapis prieinamas tik AM administratoriams.
          </CardContent>
        </Card>
      </div>
    );
  }

  const items = listQ.data ?? [];
  const approvers = items.filter((t) => t.isApprover);
  const submitters = items.filter((t) => !t.isApprover);

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organizacijos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {listQ.isLoading
              ? 'Kraunama…'
              : `${items.length} organizacij${items.length === 1 ? 'a' : 'os'} — ` +
                `${approvers.length} tvirtintoj${approvers.length === 1 ? 'as' : 'ai'}, ` +
                `${submitters.length} pavaldž${submitters.length === 1 ? 'i' : 'ios'}`}
          </p>
        </div>
        <Button onClick={() => setCreating(true)} data-testid="open-new-tenant">
          <Plus className="h-4 w-4" />
          Nauja organizacija
        </Button>
      </div>

      {listQ.isLoading ? (
        <div className="space-y-2" data-testid="tenants-skeleton">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : listQ.isError ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">
            Nepavyko užkrauti organizacijų.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {approvers.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                Tvirtintojai
              </h2>
              <ul className="space-y-2">
                {approvers.map((t) => (
                  <TenantRow
                    key={t.id}
                    tenant={t}
                    canDelete={false}
                    onEdit={() => setEditing(t)}
                    onDelete={() => handleDelete(t)}
                  />
                ))}
              </ul>
            </section>
          )}

          {submitters.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                Pavaldžios institucijos
              </h2>
              <ul className="space-y-2">
                {submitters.map((t) => (
                  <TenantRow
                    key={t.id}
                    tenant={t}
                    canDelete={
                      (t.usersCount ?? 0) === 0 && (t.requestsCount ?? 0) === 0
                    }
                    onEdit={() => setEditing(t)}
                    onDelete={() => handleDelete(t)}
                  />
                ))}
              </ul>
            </section>
          )}

          {items.length === 0 && (
            <Card>
              <CardContent className="p-12 text-center text-sm text-muted-foreground">
                Organizacijų dar nėra.
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {(creating || editing !== null) && (
        <TenantDialog
          mode={editing ? 'edit' : 'create'}
          tenant={editing}
          open={creating || editing !== null}
          onOpenChange={(o) => {
            if (!o) {
              setCreating(false);
              setEditing(null);
            }
          }}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['tenants'] });
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

interface TenantRowProps {
  tenant: Tenant;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function TenantRow({ tenant, canDelete, onEdit, onDelete }: TenantRowProps): JSX.Element {
  return (
    <li>
      <Card
        className={cn(!tenant.active && 'opacity-60')}
        data-testid={`tenant-row-${tenant.code}`}
      >
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                {tenant.code}
              </code>
              <span className="font-medium">{tenant.name}</span>
              {tenant.isApprover && (
                <Badge variant="default" className="text-[10px]">
                  Tvirtintojas
                </Badge>
              )}
              {!tenant.active && (
                <Badge variant="destructive" className="text-[10px]">
                  neaktyvi
                </Badge>
              )}
            </div>
            {tenant.description && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {tenant.description}
              </p>
            )}
            <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                {tenant.usersCount ?? 0}
              </span>
              <span className="inline-flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {tenant.requestsCount ?? 0}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onEdit}
              data-testid={`edit-tenant-${tenant.id}`}
            >
              <Pencil className="h-4 w-4" />
              Redaguoti
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
              disabled={!canDelete}
              title={
                !canDelete
                  ? 'Negalima ištrinti — yra vartotojų ar prašymų'
                  : 'Ištrinti organizaciją'
              }
              data-testid={`delete-tenant-${tenant.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
