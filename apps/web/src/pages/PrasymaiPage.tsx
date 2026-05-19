import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Loader2, Plus, Search } from 'lucide-react';
import type {
  FinancingRequest,
  PaginatedResponse,
  RequestStatus,
  Tenant,
} from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { requestCreate, requestsList, tenantsList } from '@/lib/api';
import {
  canCreate,
  fmtDate,
  fmtEur,
  isCreateOnBehalf,
  STATUS_LABELS,
  STATUS_VARIANTS,
  totalRequested,
} from '@/lib/requests';
import { classifierLabel, useClassifier } from '@/lib/classifiers';
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
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerTenant, setPickerTenant] = React.useState<string>('');
  const [pickerError, setPickerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const isLookup = useClassifier('is_system');

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
    mutationFn: (args: { tenantId?: number }) =>
      args.tenantId !== undefined
        ? requestCreate({ tenantId: args.tenantId })
        : requestCreate({}),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['requests'] });
      setPickerOpen(false);
      navigate(`/prasymai/${r.id}/redaguoti`);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Nepavyko sukurti prašymo.';
      setPickerError(msg);
    },
  });

  const tenants = tenantsQ.data ?? [];
  const items = listQ.data?.items ?? [];
  const isApprover = user?.tenantIsApprover === true;
  const onBehalf = isCreateOnBehalf(user);
  const submitterTenants = React.useMemo(
    () => tenants.filter((t) => !t.isApprover && t.active),
    [tenants],
  );

  function handleNewRequest(): void {
    setPickerError(null);
    if (onBehalf) {
      setPickerTenant('');
      setPickerOpen(true);
      return;
    }
    createMutation.mutate({});
  }

  function handlePickerSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setPickerError(null);
    if (!pickerTenant) {
      setPickerError('Pasirinkite organizaciją.');
      return;
    }
    createMutation.mutate({ tenantId: Number(pickerTenant) });
  }

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
            onClick={handleNewRequest}
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
          {isApprover && tenants.length > 0 && (
            <Select
              value={tenantId !== undefined ? String(tenantId) : 'all'}
              onValueChange={(v) => setTenantId(v === 'all' ? undefined : Number(v))}
            >
              <SelectTrigger
                className="h-9 w-full sm:w-56"
                aria-label="Filtras pagal organizaciją"
              >
                <SelectValue placeholder="Organizacija" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Visos organizacijos</SelectItem>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">
                      {t.code}
                    </span>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                        {r.systemCode ? `${classifierLabel(isLookup, r.systemCode)} · ` : ''}
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

      {onBehalf && (
        <Dialog
          open={pickerOpen}
          onOpenChange={(o) => {
            if (!o && !createMutation.isPending) setPickerOpen(false);
          }}
        >
          <DialogContent className="max-w-md">
            <form onSubmit={handlePickerSubmit} noValidate>
              <DialogHeader>
                <DialogTitle>Naujas prašymas — kurios org. vardu?</DialogTitle>
                <DialogDescription>
                  Kaip AM administratorius, jūs sukursite prašymą pasirinktos organizacijos vardu.
                  Kūrėjas liks jūsų vardas, bet prašymas priklausys tai organizacijai.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-4">
                <div className="space-y-2">
                  <Label htmlFor="picker-tenant">Organizacija</Label>
                  <Select value={pickerTenant} onValueChange={setPickerTenant}>
                    <SelectTrigger id="picker-tenant" data-testid="picker-tenant">
                      <SelectValue placeholder="Pasirinkite organizaciją…" />
                    </SelectTrigger>
                    <SelectContent>
                      {submitterTenants.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">
                            {t.code}
                          </span>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {pickerError && (
                  <div
                    className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    role="alert"
                  >
                    {pickerError}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPickerOpen(false)}
                  disabled={createMutation.isPending}
                >
                  Atšaukti
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  data-testid="picker-submit"
                >
                  {createMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Kuriama…
                    </>
                  ) : (
                    'Tęsti'
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
