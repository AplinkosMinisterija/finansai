import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, Search } from 'lucide-react';
import type {
  FinancingRequest,
  PaginatedResponse,
  RequestStatus,
  Tenant,
} from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { requestCreate, requestsList, tenantsList } from '@/lib/api';
import { canCreate, fmtDate, fmtEur, STATUS_LABELS, STATUS_VARIANTS, totalRequested } from '@/lib/requests';
import { cn } from '@/lib/utils';

const STATUSES: { value: 'all' | RequestStatus; label: string }[] = [
  { value: 'all', label: 'Visi' },
  { value: 'DRAFT', label: 'Juodraščiai' },
  { value: 'SUBMITTED', label: 'Pateikti' },
  { value: 'RETURNED', label: 'Grąžinti' },
  { value: 'APPROVED', label: 'Patvirtinti' },
  { value: 'REJECTED', label: 'Atmesti' },
];

export default function PrasymaiPage(): JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [q, setQ] = React.useState('');
  const [debouncedQ, setDebouncedQ] = React.useState('');
  const [status, setStatus] = React.useState<'all' | RequestStatus>('all');
  const [tenantId, setTenantId] = React.useState<number | undefined>(undefined);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const tenantsQ = useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: () => tenantsList(),
    staleTime: 5 * 60_000,
  });

  const listQ = useQuery<PaginatedResponse<FinancingRequest>>({
    queryKey: ['requests', { q: debouncedQ, status, tenantId }],
    queryFn: () =>
      requestsList({
        q: debouncedQ || undefined,
        status: status === 'all' ? undefined : status,
        tenantId,
        pageSize: 200,
      }),
  });

  const createMutation = useMutation({
    mutationFn: () => requestCreate({}),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['requests'] });
      navigate(`/prasymai/${r.id}/redaguoti`);
    },
  });

  const tenants = tenantsQ.data ?? [];
  const items = listQ.data?.items ?? [];
  const isAmRole = user?.role === 'am_admin' || user?.role === 'am_user';

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Prašymai</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {listQ.isLoading
              ? 'Kraunama…'
              : `${listQ.data?.total ?? 0} prašym${listQ.data?.total === 1 ? 'as' : 'ai'}`}
          </p>
        </div>
        {canCreate(user) && (
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            data-testid="open-new-request"
          >
            <Plus className="h-4 w-4" />
            Naujas prašymas
          </Button>
        )}
      </div>

      {/* Status pills */}
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Statusas">
        {STATUSES.map((s) => {
          const active = status === s.value;
          return (
            <button
              key={s.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setStatus(s.value)}
              className={cn(
                'inline-flex min-h-[36px] items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-transparent bg-muted text-muted-foreground hover:bg-muted/80',
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Ieškoti pagal projekto pavadinimą…"
              className="pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Paieška"
            />
          </div>
          {isAmRole && tenants.length > 0 && (
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={tenantId ?? ''}
              onChange={(e) => setTenantId(e.target.value ? Number(e.target.value) : undefined)}
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
        <div className="space-y-2" data-testid="requests-skeleton">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : listQ.isError ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">
            Nepavyko užkrauti prašymų. Pamėginkite atnaujinti puslapį.
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-sm text-muted-foreground">
            Prašymų pagal filtrą nėra.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2" data-testid="requests-list">
          {items.map((r) => (
            <li key={r.id}>
              <Link
                to={`/prasymai/${r.id}`}
                className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
                data-testid={`request-row-${r.id}`}
              >
                <Card className="hover:bg-muted/40 transition-colors">
                  <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{r.projectName || 'Be pavadinimo'}</span>
                        <Badge variant={STATUS_VARIANTS[r.status]} className="text-[10px]">
                          {STATUS_LABELS[r.status]}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {r.tenantCode}
                        </Badge>
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {r.systemCode ? `${r.systemCode} · ` : ''}
                        {r.createdByName}
                        {r.implementationDeadline ? ` · iki ${fmtDate(r.implementationDeadline)}` : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium tabular-nums">
                        {fmtEur(totalRequested(r))}
                      </div>
                      <div className="text-[10px] text-muted-foreground">prašoma</div>
                    </div>
                    <ChevronRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
