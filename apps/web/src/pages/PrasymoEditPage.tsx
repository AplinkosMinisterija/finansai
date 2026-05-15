import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FinancingRequestDetail } from '@biip-finansai/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RequestWizard } from '@/components/requests/RequestWizard';
import { useAuth } from '@/lib/auth';
import { requestGet } from '@/lib/api';
import { canEdit } from '@/lib/requests';

export default function PrasymoEditPage(): JSX.Element {
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

  if (!canEdit(user, q.data)) {
    return (
      <Card className="mx-auto my-12 max-w-md">
        <CardContent className="p-6 text-center text-sm">
          <p className="mb-3 text-destructive">
            Šis prašymas nėra DRAFT/RETURNED būsenoje arba neturite teisės redaguoti.
          </p>
          <button
            type="button"
            onClick={() => navigate(`/prasymai/${requestId}`)}
            className="text-sm text-primary underline-offset-2 hover:underline"
          >
            Atidaryti peržiūrai
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <RequestWizard
      request={q.data}
      onSaved={() => {
        void qc.invalidateQueries({ queryKey: ['requests'] });
      }}
    />
  );
}
