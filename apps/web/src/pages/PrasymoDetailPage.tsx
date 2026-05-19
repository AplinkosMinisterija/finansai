import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { CheckCircle2, MessageCircle, Pencil, Send, Trash2, XCircle, RotateCcw, Loader2 } from 'lucide-react';
import type {
  FinancingRequestDetail,
  RequestCommentKind,
} from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import {
  requestAddComment,
  requestDecision,
  requestDelete,
  requestGet,
  requestSubmit,
} from '@/lib/api';
import { classifierLabel, useClassifier } from '@/lib/classifiers';
import { ClassifierSelect } from '@/components/classifiers/ClassifierSelect';
import {
  canDecide,
  canDelete,
  canEdit,
  canSubmit,
  fmtDate,
  fmtDateTime,
  fmtEur,
  STATUS_LABELS,
  STATUS_VARIANTS,
  totalQuarterly,
  totalRequested,
} from '@/lib/requests';
import { ROLE_LABELS } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const KIND_LABELS: Record<RequestCommentKind, string> = {
  comment: 'Komentaras',
  status_change: 'Statuso pakeitimas',
  submitted: 'Pateikta AM',
  returned: 'Grąžinta pataisymui',
  approved: 'Patvirtinta',
  rejected: 'Atmesta',
};

const KIND_COLORS: Record<RequestCommentKind, string> = {
  comment: 'bg-muted text-foreground',
  status_change: 'bg-muted text-foreground',
  submitted: 'bg-primary/10 text-primary',
  returned: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100',
  approved: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100',
  rejected: 'bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-100',
};

export default function PrasymoDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const requestId = Number(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const q = useQuery<FinancingRequestDetail>({
    queryKey: ['requests', requestId],
    queryFn: () => requestGet(requestId),
    enabled: Number.isFinite(requestId) && requestId > 0,
  });

  const isLookup = useClassifier('is_system');
  const ptLookup = useClassifier('project_type');
  const spLookup = useClassifier('source_program');

  const [commentBody, setCommentBody] = React.useState('');
  const [decisionForm, setDecisionForm] = React.useState<{
    open: 'approve' | 'reject' | 'return' | null;
    comment: string;
    grantedAmount: string;
    fundingSource: string;
    protocol: string;
    order: string;
  }>({
    open: null,
    comment: '',
    grantedAmount: '',
    fundingSource: '',
    protocol: '',
    order: '',
  });
  const [error, setError] = React.useState<string | null>(null);

  const addComment = useMutation({
    mutationFn: (body: string) => requestAddComment(requestId, body),
    onSuccess: () => {
      setCommentBody('');
      void qc.invalidateQueries({ queryKey: ['requests', requestId] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const submitMutation = useMutation({
    mutationFn: () => requestSubmit(requestId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['requests', requestId] });
      void qc.invalidateQueries({ queryKey: ['requests'] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => requestDelete(requestId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['requests'] });
      navigate('/prasymai');
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const decisionMutation = useMutation({
    mutationFn: () => {
      if (!decisionForm.open) throw new Error('No decision');
      return requestDecision(requestId, {
        decision: decisionForm.open,
        comment: decisionForm.comment || undefined,
        grantedAmount: decisionForm.grantedAmount || undefined,
        fundingSource: decisionForm.fundingSource || undefined,
        protocol: decisionForm.protocol || undefined,
        order: decisionForm.order || undefined,
      });
    },
    onSuccess: () => {
      setDecisionForm({
        open: null,
        comment: '',
        grantedAmount: '',
        fundingSource: '',
        protocol: '',
        order: '',
      });
      void qc.invalidateQueries({ queryKey: ['requests', requestId] });
      void qc.invalidateQueries({ queryKey: ['requests'] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  function getErrorMessage(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const data = err.response?.data as { message?: string } | undefined;
      if (data?.message) return data.message;
    }
    if (err instanceof Error) return err.message;
    return 'Įvyko klaida.';
  }

  if (!Number.isFinite(requestId) || requestId <= 0) {
    return (
      <Card className="mx-auto my-12 max-w-md">
        <CardContent className="p-6 text-center text-sm text-destructive">
          Klaidingas prašymo ID.
        </CardContent>
      </Card>
    );
  }

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 p-4 md:p-6">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-60" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <Card className="mx-auto my-12 max-w-md">
        <CardContent className="p-6 text-center text-sm text-destructive">
          Nepavyko užkrauti prašymo.
        </CardContent>
      </Card>
    );
  }

  const r = q.data;
  const totalReq = totalRequested(r);
  const totalQ = totalQuarterly(r);
  const canEditNow = canEdit(user, r);
  const canSubmitNow = canSubmit(user, r);
  const canDecideNow = canDecide(user, r);
  const canDeleteNow = canDelete(user, r);

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-4">
        <Link to="/prasymai" className="text-xs text-muted-foreground hover:text-foreground">
          ← Prašymai
        </Link>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {r.projectName || 'Be pavadinimo'}
            </h1>
            <Badge variant={STATUS_VARIANTS[r.status]}>{STATUS_LABELS[r.status]}</Badge>
            <Badge variant="outline">{r.tenantCode}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Pateikė: {r.createdByName} · {r.tenantName}
            {r.submittedAt && <> · pateikta {fmtDateTime(r.submittedAt)}</>}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canEditNow && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/prasymai/${r.id}/redaguoti`}>
                <Pencil className="h-4 w-4" />
                Redaguoti
              </Link>
            </Button>
          )}
          {canSubmitNow && r.status === 'RETURNED' && (
            <Button
              size="sm"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
            >
              <Send className="h-4 w-4" />
              Pateikti pakartotinai
            </Button>
          )}
          {canDeleteNow && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (window.confirm('Ar tikrai ištrinti šį prašymą?')) {
                  deleteMutation.mutate();
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
              Ištrinti
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      {/* AM decision actions */}
      {canDecideNow && (
        <Card className="mb-4 border-primary/40">
          <CardContent className="p-4">
            <p className="mb-3 text-sm font-medium">AM veiksmai šiam prašymui:</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => setDecisionForm((f) => ({ ...f, open: 'approve' }))}
                className="bg-emerald-700 hover:bg-emerald-700/90"
              >
                <CheckCircle2 className="h-4 w-4" />
                Patvirtinti
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDecisionForm((f) => ({ ...f, open: 'return' }))}
              >
                <RotateCcw className="h-4 w-4" />
                Grąžinti pataisymui
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setDecisionForm((f) => ({ ...f, open: 'reject' }))}
              >
                <XCircle className="h-4 w-4" />
                Atmesti
              </Button>
            </div>

            {decisionForm.open && (
              <div className="mt-4 space-y-3 rounded-md border border-border bg-muted/30 p-3">
                <p className="text-sm font-medium">
                  {decisionForm.open === 'approve' && 'Patvirtinimo metaduomenys'}
                  {decisionForm.open === 'return' && 'Grąžinimas pataisymui'}
                  {decisionForm.open === 'reject' && 'Atmetimas'}
                </p>
                {decisionForm.open === 'approve' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="d-amount">Skirta suma (EUR)</Label>
                      <Input
                        id="d-amount"
                        type="number"
                        min={0}
                        step="0.01"
                        value={decisionForm.grantedAmount}
                        onChange={(e) =>
                          setDecisionForm((f) => ({ ...f, grantedAmount: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="d-source">Finansavimo šaltinis (programa)</Label>
                      <ClassifierSelect
                        id="d-source"
                        groupCode="source_program"
                        value={decisionForm.fundingSource}
                        onChange={(v) =>
                          setDecisionForm((f) => ({ ...f, fundingSource: v ?? '' }))
                        }
                        emptyLabel="— Nepasirinkta —"
                        placeholder="Pasirinkite programą"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="d-protocol">Posėdžio protokolas</Label>
                      <Input
                        id="d-protocol"
                        value={decisionForm.protocol}
                        onChange={(e) =>
                          setDecisionForm((f) => ({ ...f, protocol: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="d-order">Įsakymas (data, nr.)</Label>
                      <Input
                        id="d-order"
                        value={decisionForm.order}
                        onChange={(e) =>
                          setDecisionForm((f) => ({ ...f, order: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <Label htmlFor="d-comment">
                    {decisionForm.open === 'reject' ? 'Priežastis (neprivaloma)' : 'Komentaras'}
                    {decisionForm.open === 'return' && (
                      <span className="text-destructive"> *</span>
                    )}
                  </Label>
                  <textarea
                    id="d-comment"
                    className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder={
                      decisionForm.open === 'reject'
                        ? 'Galite nurodyti priežastį, bet nebūtina.'
                        : ''
                    }
                    value={decisionForm.comment}
                    onChange={(e) =>
                      setDecisionForm((f) => ({ ...f, comment: e.target.value }))
                    }
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => decisionMutation.mutate()}
                    disabled={decisionMutation.isPending}
                  >
                    {decisionMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Patvirtinti veiksmą
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDecisionForm((f) => ({ ...f, open: null }))}
                  >
                    Atšaukti
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Section title="Pagrindinė informacija">
            <KV label="Informacinė sistema">{classifierLabel(isLookup, r.systemCode)}</KV>
            <KV label="Projekto tipas">{classifierLabel(ptLookup, r.projectType)}</KV>
            <KV label="Prioritetas">{r.priority !== null ? String(r.priority) : '—'}</KV>
            <KV label="Pirkimo stadija">{r.procurementStage ?? '—'}</KV>
            <KV label="Aprašymas" wide>
              <p className="whitespace-pre-wrap text-sm">{r.description || '—'}</p>
            </KV>
            <KV label="Planuojami darbai" wide>
              <p className="whitespace-pre-wrap text-sm">{r.plannedWorks || '—'}</p>
            </KV>
          </Section>

          <Section title="Finansavimas">
            <KV label="DU">{fmtEur(r.costDu)}</KV>
            <KV label="Įranga / licencijos">{fmtEur(r.costEquipment)}</KV>
            <KV label="Kūrimas">{fmtEur(r.costCreation)}</KV>
            <KV label="Analizė">{fmtEur(r.costAnalysis)}</KV>
            <KV label="Vystymas">{fmtEur(r.costDevelopment)}</KV>
            <KV label="Palaikymas">{fmtEur(r.costMaintenance)}</KV>
            <KV label="Modernizavimas">{fmtEur(r.costModernization)}</KV>
            <KV label="Likvidavimas">{fmtEur(r.costDecommissioning)}</KV>
            <KV label="Iš viso prašoma" emph>{fmtEur(totalReq)}</KV>
            <KV label="Finansavimas iš IT">{fmtEur(r.fundingFromIt)}</KV>
            <KV label="Kitos lėšos">{fmtEur(r.otherFunds)}</KV>
            <KV label="Kitų lėšų šaltinis">{r.otherFundsSource ?? '—'}</KV>
          </Section>

          <Section title="Ketvirtinis paskirstymas">
            <KV label="I ketv.">{fmtEur(r.q1Amount)}</KV>
            <KV label="II ketv.">{fmtEur(r.q2Amount)}</KV>
            <KV label="III ketv.">{fmtEur(r.q3Amount)}</KV>
            <KV label="IV ketv.">{fmtEur(r.q4Amount)}</KV>
            <KV label="Viso ketv." emph>{fmtEur(totalQ)}</KV>
          </Section>

          <Section title="Atsakingi asmenys">
            <KV label="Atsakinga įstaiga">{r.responsibleInstitution ?? '—'}</KV>
            <KV label="Vykdo">{r.executorName ?? '—'}</KV>
            <KV label="El. paštas">{r.executorEmail ?? '—'}</KV>
            <KV label="Terminas">{fmtDate(r.implementationDeadline)}</KV>
            <KV label="Pastabos" wide>
              <p className="whitespace-pre-wrap text-sm">{r.submitterNotes || '—'}</p>
            </KV>
          </Section>

          {(r.status === 'APPROVED' || r.status === 'REJECTED') && (
            <Section title="Sprendimas">
              <KV label="Statusas">{STATUS_LABELS[r.status]}</KV>
              <KV label="Sprendė">{r.decidedByName ?? '—'}</KV>
              <KV label="Data">{fmtDateTime(r.decidedAt)}</KV>
              <KV label="Skirta suma" emph>{fmtEur(r.decisionGrantedAmount)}</KV>
              <KV label="Finansavimo šaltinis (programa)">
                {classifierLabel(spLookup, r.decisionFundingSource)}
              </KV>
              <KV label="Protokolas">{r.decisionProtocol ?? '—'}</KV>
              <KV label="Įsakymas">{r.decisionOrder ?? '—'}</KV>
            </Section>
          )}
        </div>

        <div>
          <Card>
            <CardContent className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <MessageCircle className="h-4 w-4" />
                Komentarai ir istorija
              </h3>
              <ul className="space-y-3" data-testid="comments-list">
                {r.comments.length === 0 ? (
                  <li className="text-xs text-muted-foreground">Komentarų dar nėra.</li>
                ) : (
                  r.comments.map((c) => (
                    <li key={c.id} className="rounded-md bg-muted/30 p-3 text-sm">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                            KIND_COLORS[c.kind],
                          )}
                        >
                          {KIND_LABELS[c.kind]}
                        </span>
                        <span className="text-xs font-medium">{c.authorName}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {ROLE_LABELS[c.authorRole]}
                        </span>
                      </div>
                      {c.body && <p className="whitespace-pre-wrap text-sm">{c.body}</p>}
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {fmtDateTime(c.createdAt)}
                      </p>
                    </li>
                  ))
                )}
              </ul>

              <div className="mt-4 space-y-2 border-t border-border pt-3">
                <Label htmlFor="new-comment">Pridėti komentarą</Label>
                <textarea
                  id="new-comment"
                  className="min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={!commentBody.trim() || addComment.isPending}
                  onClick={() => addComment.mutate(commentBody)}
                >
                  Skelbti
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="mb-3 text-sm font-semibold">{title}</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">{children}</dl>
      </CardContent>
    </Card>
  );
}

function KV({
  label,
  emph,
  wide,
  children,
}: {
  label: string;
  emph?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <>
      <dt className={cn('text-muted-foreground', wide && 'col-span-2 mt-2 font-medium')}>{label}</dt>
      <dd
        className={cn(
          wide ? 'col-span-2' : 'text-right tabular-nums',
          emph && 'font-semibold',
        )}
      >
        {children}
      </dd>
    </>
  );
}
