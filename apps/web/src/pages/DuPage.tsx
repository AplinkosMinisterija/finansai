/**
 * DU (darbo užmokestis) puslapis (Iter 13, FVM-5).
 *
 * Pateikia darbuotojų finansinių profilių sąrašą, jų DU paskirstymą tarp
 * finansavimo šaltinių ir AM administratoriui — mėnesio DU compute mygtuką.
 *
 * SAUGUMAS (docx §4.4 + Iter 13 saugumo reikalavimai):
 *  1. Route guard: `canViewPayroll(user) === false` → redirect į /
 *     + toast'as „Neturite teisės matyti DU duomenų".
 *  2. Sidebar punktas paslepiamas tame pačiame `canViewPayroll` lygyje.
 *  3. „Apskaičiuoti mėnesį" mygtukas paslepiamas su `canComputePayroll` (AM only).
 *  4. Dialog'ai turi defense-in-depth `canViewPayroll` patikrinimą prieš mutation'us.
 *
 * Backend (`payroll.service.ts`) lygiagrečiai forsuoja per `requireDuAccess` —
 * 403 jei kažkaip URL'as praeitų UI guard'ą.
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Banknote, Calculator, Plus } from 'lucide-react';
import type {
  AuthUser,
  PayrollProfile,
  PayrollProfileListQuery,
  Tenant,
} from '@biip-finansai/shared';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/lib/auth';
import { canComputePayroll, canViewPayroll } from '@/lib/roles';
import { payrollApi } from '@/lib/api/fvm';
import { tenantsList } from '@/lib/api';
import { toast } from '@/lib/use-toast';
import { PayrollList } from '@/components/payroll/PayrollList';
import { PayrollProfileDialog } from '@/components/payroll/PayrollProfileDialog';
import { PayrollDistributionsList } from '@/components/payroll/PayrollDistributionsList';
import { ComputeMonthDialog } from '@/components/payroll/ComputeMonthDialog';

const ALL = '__all__';

function formatEur(value: string | number): string {
  const num = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(num)) return '0,00 €';
  return new Intl.NumberFormat('lt-LT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export default function DuPage(): JSX.Element | null {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const hasAccess = canViewPayroll(user);
  const canCompute = canComputePayroll(user);
  const isAmAdmin =
    user?.tenantIsApprover === true && user.role === 'admin';

  // SAUGUMAS — sluoksnis 1: route guard. Specialistas (org_user) — visada redirect.
  // `useEffect` užtikrina kad navigacija pasikartos tiktai vieną kartą per render'įmą.
  React.useEffect(() => {
    if (!hasAccess) {
      toast({
        title: 'Neturite teisės matyti DU duomenų',
        variant: 'error',
      });
      navigate('/', { replace: true });
    }
  }, [hasAccess, navigate]);

  // Anksti grįžtam tuščia — kol redirect'inama, nieko nerodyti.
  // `canViewPayroll(null) === false`, todėl jei hasAccess'as — user yra ne-null.
  if (!hasAccess || user === null) {
    return null;
  }

  return (
    <DuPageContent
      isAmAdmin={isAmAdmin}
      canCompute={canCompute}
      user={user}
      qc={qc}
    />
  );
}

interface DuPageContentProps {
  isAmAdmin: boolean;
  canCompute: boolean;
  user: AuthUser;
  qc: ReturnType<typeof useQueryClient>;
}

function DuPageContent({
  isAmAdmin,
  canCompute,
  user,
  qc,
}: DuPageContentProps): JSX.Element {
  const [onlyActive, setOnlyActive] = React.useState<boolean>(true);
  const [tenantId, setTenantId] = React.useState<number | null>(
    isAmAdmin ? null : user.tenantId,
  );
  const [creatingDialogOpen, setCreatingDialogOpen] = React.useState(false);
  const [editingProfile, setEditingProfile] = React.useState<PayrollProfile | null>(
    null,
  );
  const [detailProfile, setDetailProfile] = React.useState<PayrollProfile | null>(
    null,
  );
  const [computeDialogOpen, setComputeDialogOpen] = React.useState(false);

  const filters: PayrollProfileListQuery = React.useMemo(() => {
    const q: PayrollProfileListQuery = {};
    if (tenantId !== null) q.tenantId = tenantId;
    if (onlyActive) q.active = true;
    return q;
  }, [tenantId, onlyActive]);

  const listQ = useQuery<PayrollProfile[]>({
    queryKey: ['payrollProfiles', filters],
    queryFn: () => payrollApi.listProfiles(filters),
  });

  const tenantsQ = useQuery<Tenant[]>({
    queryKey: ['tenants', { withCounts: false }],
    queryFn: () => tenantsList(false),
    enabled: isAmAdmin,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => payrollApi.removeProfile(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['payrollProfiles'] });
      toast({ title: 'DU profilis ištrintas', variant: 'success' });
    },
    onError: (err: unknown) => {
      let msg = 'Nepavyko ištrinti DU profilio.';
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        if (data?.message) msg = data.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      toast({ title: msg, variant: 'error' });
    },
  });

  function handleDelete(p: PayrollProfile): void {
    if (
      !window.confirm(
        `Ar tikrai ištrinti DU profilį „${p.vardasPavarde}"?`,
      )
    ) {
      return;
    }
    deleteMutation.mutate(p.id);
  }

  const profiles = listQ.data ?? [];
  const tenants = tenantsQ.data ?? [];

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Banknote className="h-6 w-6 text-muted-foreground" />
            Darbo užmokestis
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Darbuotojų finansiniai profiliai ir DU paskirstymas tarp finansavimo
            šaltinių. Tik bruto + priedai (ADR-003).
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {canCompute && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setComputeDialogOpen(true)}
              data-testid="open-compute-month"
            >
              <Calculator className="h-4 w-4" />
              Apskaičiuoti mėnesį
            </Button>
          )}
          <Button
            type="button"
            onClick={() => setCreatingDialogOpen(true)}
            data-testid="open-new-payroll"
          >
            <Plus className="h-4 w-4" />
            Naujas profilis
          </Button>
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          {isAmAdmin && (
            <div className="space-y-1">
              <Label
                htmlFor="payroll-filter-tenant"
                className="text-xs text-muted-foreground"
              >
                Organizacija
              </Label>
              <Select
                value={tenantId === null ? ALL : String(tenantId)}
                onValueChange={(v) =>
                  setTenantId(v === ALL ? null : Number.parseInt(v, 10))
                }
              >
                <SelectTrigger
                  id="payroll-filter-tenant"
                  className="w-56"
                  data-testid="payroll-filter-tenant-trigger"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Visos organizacijos</SelectItem>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name} ({t.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <Label
              htmlFor="payroll-filter-active"
              className="text-xs text-muted-foreground"
            >
              Aktyvumas
            </Label>
            <Select
              value={onlyActive ? 'active' : 'all'}
              onValueChange={(v) => setOnlyActive(v === 'active')}
            >
              <SelectTrigger
                id="payroll-filter-active"
                className="w-44"
                data-testid="payroll-filter-active-trigger"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Tik aktyvūs</SelectItem>
                <SelectItem value="all">Visi profiliai</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <PayrollList
        profiles={profiles}
        isLoading={listQ.isLoading}
        isError={listQ.isError}
        canEdit
        canDelete={isAmAdmin}
        emptyMessage="Nėra DU profilių. Sukurkite naują."
        onSelect={(p) => setDetailProfile(p)}
        onEdit={(p) => setEditingProfile(p)}
        onDelete={handleDelete}
      />

      {(creatingDialogOpen || editingProfile !== null) && (
        <PayrollProfileDialog
          mode={editingProfile ? 'edit' : 'create'}
          profile={editingProfile}
          defaultTenantId={tenantId ?? user.tenantId}
          open={creatingDialogOpen || editingProfile !== null}
          onOpenChange={(o) => {
            if (!o) {
              setCreatingDialogOpen(false);
              setEditingProfile(null);
            }
          }}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['payrollProfiles'] });
            toast({
              title: editingProfile
                ? 'DU profilis atnaujintas'
                : 'DU profilis sukurtas',
              variant: 'success',
            });
            setCreatingDialogOpen(false);
            setEditingProfile(null);
          }}
        />
      )}

      {detailProfile !== null && (
        <ProfileDetailDialog
          profile={detailProfile}
          canEdit
          open
          onOpenChange={(o) => {
            if (!o) setDetailProfile(null);
          }}
          onEdit={() => {
            setEditingProfile(detailProfile);
            setDetailProfile(null);
          }}
        />
      )}

      {computeDialogOpen && (
        <ComputeMonthDialog
          open
          onOpenChange={(o) => {
            if (!o) setComputeDialogOpen(false);
          }}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['payrollProfiles'] });
            void qc.invalidateQueries({ queryKey: ['expenses'] });
          }}
        />
      )}
    </div>
  );
}

interface ProfileDetailDialogProps {
  profile: PayrollProfile;
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
}

function ProfileDetailDialog({
  profile,
  canEdit,
  open,
  onOpenChange,
  onEdit,
}: ProfileDetailDialogProps): JSX.Element {
  const brutoNum = Number.parseFloat(profile.atlyginimasBruto) || 0;
  const priedaiNum = Number.parseFloat(profile.priedai) || 0;
  const monthlyTotal = brutoNum + priedaiNum;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{profile.vardasPavarde}</DialogTitle>
          <DialogDescription>
            {profile.pareigos} ·{' '}
            {profile.tenantName ?? `Tenant #${profile.tenantId}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Stat label="Bruto" value={formatEur(brutoNum)} />
            <Stat label="Priedai" value={formatEur(priedaiNum)} />
            <Stat label="Iš viso / mėn." value={formatEur(monthlyTotal)} tone="success" />
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>
              <div className="uppercase tracking-wide">Galioja nuo</div>
              <div className="mt-0.5 font-medium text-foreground">
                {profile.galiojaNuo.slice(0, 10)}
              </div>
            </div>
            <div>
              <div className="uppercase tracking-wide">Galioja iki</div>
              <div className="mt-0.5 font-medium text-foreground">
                {profile.galiojaIki ? profile.galiojaIki.slice(0, 10) : '—'}
              </div>
            </div>
          </div>

          <PayrollDistributionsList profile={profile} canEdit={canEdit} />
        </div>

        <DialogFooter>
          {canEdit && (
            <Button type="button" variant="outline" onClick={onEdit}>
              Redaguoti profilį
            </Button>
          )}
          <Button type="button" onClick={() => onOpenChange(false)}>
            Uždaryti
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface StatProps {
  label: string;
  value: string;
  tone?: 'default' | 'success';
}

function Stat({ label, value, tone = 'default' }: StatProps): JSX.Element {
  return (
    <div
      className={
        'rounded-md border p-2 ' +
        (tone === 'success' ? 'border-emerald-500/30 bg-emerald-500/5' : '')
      }
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-semibold tabular-nums">{value}</div>
    </div>
  );
}
