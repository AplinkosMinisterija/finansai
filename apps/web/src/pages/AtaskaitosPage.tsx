/**
 * Ataskaitų puslapis (Iter 14, FVM-6) — F12/F13/F14 ataskaitų generavimas
 * iš sukauptų FVM duomenų.
 *
 * 3 tab'ai:
 *  1. Biudžeto vykdymas (F12) — visiems prisijungusiems
 *  2. Spec. programos (F13) — visiems prisijungusiems
 *  3. DU paskirstymas (F14) — TIK `canViewPayroll` (AM admin + org_admin)
 *
 * Backend forsuoja DU permission per `requireDuAccess` — UI papildomai paslepia
 * tab'ą per `canViewPayroll` helper'į (`apps/web/src/lib/roles.ts`).
 *
 * Excel/PDF eksportas — per `reportsApi.*Download` Blob download'ą (browser
 * native fetch + anchor element trigger). Server backend pateikia
 * `Content-Disposition: attachment; filename=...` header'į, kurio fallback'as —
 * statinis pavadinimas iš client'o.
 */
import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import {
  AlertCircle,
  BarChart3,
  Banknote,
  Download,
  FileSpreadsheet,
  FileText,
  Play,
  Sparkles,
} from 'lucide-react';
import type {
  BudgetExecutionReport as BudgetExecutionReportData,
  PayrollDistributionReport as PayrollDistributionReportData,
  SpecProgramReport as SpecProgramReportData,
} from '@biip-finansai/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BudgetExecutionReport } from '@/components/reports/BudgetExecutionReport';
import { SpecProgramReport } from '@/components/reports/SpecProgramReport';
import { PayrollDistributionReport } from '@/components/reports/PayrollDistributionReport';
import { useAuth } from '@/lib/auth';
import { canViewPayroll } from '@/lib/roles';
import { reportsApi } from '@/lib/api/fvm';
import { toast } from '@/lib/use-toast';

function extractAxiosMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string } | undefined;
    if (data?.message) return data.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

function isoToday(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function isoMonthsBack(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

export default function AtaskaitosPage(): JSX.Element {
  const { user } = useAuth();
  const showPayrollTab = canViewPayroll(user);
  const currentYear = new Date().getFullYear();

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <BarChart3 className="h-6 w-6 text-muted-foreground" />
          Ataskaitos
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Finansinių ataskaitų generavimas ir eksportas (Excel, PDF).
        </p>
      </div>

      <Tabs defaultValue="budget-execution" className="w-full">
        <TabsList
          className="w-full flex-wrap justify-start"
          data-testid="reports-tabs"
        >
          <TabsTrigger
            value="budget-execution"
            data-testid="reports-tab-budget-execution"
          >
            <FileText className="mr-1 h-4 w-4" />
            Biudžeto vykdymas
          </TabsTrigger>
          <TabsTrigger
            value="spec-program"
            data-testid="reports-tab-spec-program"
          >
            <Sparkles className="mr-1 h-4 w-4" />
            Spec. programos
          </TabsTrigger>
          {showPayrollTab && (
            <TabsTrigger
              value="payroll-distribution"
              data-testid="reports-tab-payroll-distribution"
            >
              <Banknote className="mr-1 h-4 w-4" />
              DU paskirstymas
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="budget-execution">
          <BudgetExecutionSection defaultYear={currentYear} />
        </TabsContent>

        <TabsContent value="spec-program">
          <SpecProgramSection defaultYear={currentYear} />
        </TabsContent>

        {showPayrollTab && (
          <TabsContent value="payroll-distribution">
            <PayrollDistributionSection />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ---------- F12 Biudžeto vykdymas section ----------

interface BudgetExecutionSectionProps {
  defaultYear: number;
}

function BudgetExecutionSection({
  defaultYear,
}: BudgetExecutionSectionProps): JSX.Element {
  const [year, setYear] = React.useState<number>(defaultYear);
  const [activeYear, setActiveYear] = React.useState<number | null>(null);

  const reportQ = useQuery<BudgetExecutionReportData>({
    queryKey: ['reports', 'budget-execution', { year: activeYear }],
    queryFn: () => reportsApi.budgetExecution({ year: activeYear! }),
    enabled: activeYear !== null,
  });

  const xlsxMutation = useMutation({
    mutationFn: () =>
      reportsApi.budgetExecutionDownload({ year, format: 'xlsx' }),
    onSuccess: () =>
      toast({ title: 'Excel atsisiųstas', variant: 'success' }),
    onError: (err: unknown) => {
      toast({
        title: extractAxiosMessage(
          err,
          'Nepavyko parsisiųsti Excel failo.',
        ),
        variant: 'error',
      });
    },
  });

  const pdfMutation = useMutation({
    mutationFn: () =>
      reportsApi.budgetExecutionDownload({ year, format: 'pdf' }),
    onSuccess: () => toast({ title: 'PDF atsisiųstas', variant: 'success' }),
    onError: (err: unknown) => {
      toast({
        title: extractAxiosMessage(err, 'Nepavyko parsisiųsti PDF failo.'),
        variant: 'error',
      });
    },
  });

  function onGenerate(): void {
    setActiveYear(year);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label
              htmlFor="be-year"
              className="text-xs text-muted-foreground"
            >
              Metai
            </Label>
            <Input
              id="be-year"
              type="number"
              min={2000}
              max={3000}
              step={1}
              value={year}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(n)) setYear(n);
              }}
              className="w-32"
              data-testid="be-year-input"
            />
          </div>
          <Button
            type="button"
            onClick={onGenerate}
            data-testid="be-generate"
          >
            <Play className="h-4 w-4" />
            Generuoti
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => xlsxMutation.mutate()}
              disabled={xlsxMutation.isPending}
              data-testid="be-download-xlsx"
              aria-label="Atsisiųsti biudžeto vykdymo Excel"
            >
              {xlsxMutation.isPending ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              Atsisiųsti Excel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => pdfMutation.mutate()}
              disabled={pdfMutation.isPending}
              data-testid="be-download-pdf"
              aria-label="Atsisiųsti biudžeto vykdymo PDF"
            >
              {pdfMutation.isPending ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Atsisiųsti PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {activeYear === null ? (
        <Card>
          <CardContent
            className="p-8 text-center text-sm text-muted-foreground"
            data-testid="be-idle"
          >
            Pasirinkite metus ir paspauskite „Generuoti".
          </CardContent>
        </Card>
      ) : reportQ.isLoading ? (
        <Card>
          <CardContent
            className="flex items-center justify-center gap-3 p-8 text-sm text-muted-foreground"
            data-testid="be-loading"
            role="status"
            aria-live="polite"
          >
            <Spinner className="h-4 w-4" />
            Kraunama ataskaita…
          </CardContent>
        </Card>
      ) : reportQ.isError ? (
        <Card>
          <CardContent
            className="flex items-center gap-2 p-6 text-sm text-destructive"
            data-testid="be-error"
            role="alert"
          >
            <AlertCircle className="h-4 w-4" />
            Nepavyko užkrauti biudžeto vykdymo ataskaitos.
          </CardContent>
        </Card>
      ) : reportQ.data ? (
        <BudgetExecutionReport data={reportQ.data} />
      ) : null}
    </div>
  );
}

// ---------- F13 Spec. programos section ----------

interface SpecProgramSectionProps {
  defaultYear: number;
}

function SpecProgramSection({
  defaultYear,
}: SpecProgramSectionProps): JSX.Element {
  const [year, setYear] = React.useState<number>(defaultYear);
  const [activeYear, setActiveYear] = React.useState<number | null>(null);

  const reportQ = useQuery<SpecProgramReportData>({
    queryKey: ['reports', 'spec-program', { year: activeYear }],
    queryFn: () => reportsApi.specProgramExecution({ year: activeYear! }),
    enabled: activeYear !== null,
  });

  const xlsxMutation = useMutation({
    mutationFn: () =>
      reportsApi.specProgramExecutionDownload({ year, format: 'xlsx' }),
    onSuccess: () =>
      toast({ title: 'Excel atsisiųstas', variant: 'success' }),
    onError: (err: unknown) => {
      toast({
        title: extractAxiosMessage(
          err,
          'Nepavyko parsisiųsti Excel failo.',
        ),
        variant: 'error',
      });
    },
  });

  const pdfMutation = useMutation({
    mutationFn: () =>
      reportsApi.specProgramExecutionDownload({ year, format: 'pdf' }),
    onSuccess: () => toast({ title: 'PDF atsisiųstas', variant: 'success' }),
    onError: (err: unknown) => {
      toast({
        title: extractAxiosMessage(err, 'Nepavyko parsisiųsti PDF failo.'),
        variant: 'error',
      });
    },
  });

  function onGenerate(): void {
    setActiveYear(year);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label
              htmlFor="sp-year"
              className="text-xs text-muted-foreground"
            >
              Metai
            </Label>
            <Input
              id="sp-year"
              type="number"
              min={2000}
              max={3000}
              step={1}
              value={year}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(n)) setYear(n);
              }}
              className="w-32"
              data-testid="sp-year-input"
            />
          </div>
          <Button type="button" onClick={onGenerate} data-testid="sp-generate">
            <Play className="h-4 w-4" />
            Generuoti
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => xlsxMutation.mutate()}
              disabled={xlsxMutation.isPending}
              data-testid="sp-download-xlsx"
              aria-label="Atsisiųsti spec. programų Excel"
            >
              {xlsxMutation.isPending ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              Atsisiųsti Excel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => pdfMutation.mutate()}
              disabled={pdfMutation.isPending}
              data-testid="sp-download-pdf"
              aria-label="Atsisiųsti spec. programų PDF"
            >
              {pdfMutation.isPending ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Atsisiųsti PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {activeYear === null ? (
        <Card>
          <CardContent
            className="p-8 text-center text-sm text-muted-foreground"
            data-testid="sp-idle"
          >
            Pasirinkite metus ir paspauskite „Generuoti".
          </CardContent>
        </Card>
      ) : reportQ.isLoading ? (
        <Card>
          <CardContent
            className="flex items-center justify-center gap-3 p-8 text-sm text-muted-foreground"
            data-testid="sp-loading"
            role="status"
            aria-live="polite"
          >
            <Spinner className="h-4 w-4" />
            Kraunama ataskaita…
          </CardContent>
        </Card>
      ) : reportQ.isError ? (
        <Card>
          <CardContent
            className="flex items-center gap-2 p-6 text-sm text-destructive"
            data-testid="sp-error"
            role="alert"
          >
            <AlertCircle className="h-4 w-4" />
            Nepavyko užkrauti spec. programų ataskaitos.
          </CardContent>
        </Card>
      ) : reportQ.data ? (
        <SpecProgramReport data={reportQ.data} />
      ) : null}
    </div>
  );
}

// ---------- F14 DU paskirstymas section ----------

function PayrollDistributionSection(): JSX.Element {
  const [from, setFrom] = React.useState<string>(isoMonthsBack(1));
  const [to, setTo] = React.useState<string>(isoToday());
  const [active, setActive] = React.useState<{
    from: string;
    to: string;
  } | null>(null);

  const reportQ = useQuery<PayrollDistributionReportData>({
    queryKey: [
      'reports',
      'payroll-distribution',
      { from: active?.from, to: active?.to },
    ],
    queryFn: () =>
      reportsApi.payrollDistribution({ from: active!.from, to: active!.to }),
    enabled: active !== null,
  });

  const xlsxMutation = useMutation({
    mutationFn: () =>
      reportsApi.payrollDistributionDownload({ from, to, format: 'xlsx' }),
    onSuccess: () =>
      toast({ title: 'Excel atsisiųstas', variant: 'success' }),
    onError: (err: unknown) => {
      toast({
        title: extractAxiosMessage(
          err,
          'Nepavyko parsisiųsti Excel failo.',
        ),
        variant: 'error',
      });
    },
  });

  const pdfMutation = useMutation({
    mutationFn: () =>
      reportsApi.payrollDistributionDownload({ from, to, format: 'pdf' }),
    onSuccess: () => toast({ title: 'PDF atsisiųstas', variant: 'success' }),
    onError: (err: unknown) => {
      toast({
        title: extractAxiosMessage(err, 'Nepavyko parsisiųsti PDF failo.'),
        variant: 'error',
      });
    },
  });

  function onGenerate(): void {
    setActive({ from, to });
  }

  const dateRangeInvalid = from > to;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label
              htmlFor="pd-from"
              className="text-xs text-muted-foreground"
            >
              Nuo
            </Label>
            <Input
              id="pd-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-44"
              data-testid="pd-from-input"
            />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor="pd-to"
              className="text-xs text-muted-foreground"
            >
              Iki
            </Label>
            <Input
              id="pd-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-44"
              data-testid="pd-to-input"
            />
          </div>
          <Button
            type="button"
            onClick={onGenerate}
            disabled={dateRangeInvalid}
            data-testid="pd-generate"
          >
            <Play className="h-4 w-4" />
            Generuoti
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => xlsxMutation.mutate()}
              disabled={xlsxMutation.isPending || dateRangeInvalid}
              data-testid="pd-download-xlsx"
              aria-label="Atsisiųsti DU paskirstymo Excel"
            >
              {xlsxMutation.isPending ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              Atsisiųsti Excel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => pdfMutation.mutate()}
              disabled={pdfMutation.isPending || dateRangeInvalid}
              data-testid="pd-download-pdf"
              aria-label="Atsisiųsti DU paskirstymo PDF"
            >
              {pdfMutation.isPending ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Atsisiųsti PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {dateRangeInvalid && (
        <Card>
          <CardContent
            className="flex items-center gap-2 p-4 text-sm text-destructive"
            role="alert"
            data-testid="pd-date-error"
          >
            <AlertCircle className="h-4 w-4" />
            Pradžios data turi būti ne vėlesnė už pabaigos datą.
          </CardContent>
        </Card>
      )}

      {active === null ? (
        <Card>
          <CardContent
            className="p-8 text-center text-sm text-muted-foreground"
            data-testid="pd-idle"
          >
            Pasirinkite laikotarpį ir paspauskite „Generuoti".
          </CardContent>
        </Card>
      ) : reportQ.isLoading ? (
        <Card>
          <CardContent
            className="flex items-center justify-center gap-3 p-8 text-sm text-muted-foreground"
            data-testid="pd-loading"
            role="status"
            aria-live="polite"
          >
            <Spinner className="h-4 w-4" />
            Kraunama ataskaita…
          </CardContent>
        </Card>
      ) : reportQ.isError ? (
        <Card>
          <CardContent
            className="flex items-center gap-2 p-6 text-sm text-destructive"
            data-testid="pd-error"
            role="alert"
          >
            <AlertCircle className="h-4 w-4" />
            Nepavyko užkrauti DU paskirstymo ataskaitos.
          </CardContent>
        </Card>
      ) : reportQ.data ? (
        <PayrollDistributionReport data={reportQ.data} />
      ) : null}
    </div>
  );
}
