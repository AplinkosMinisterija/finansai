import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { ROLE_LABELS } from '@/lib/roles';

export default function HomePage(): JSX.Element {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Sveiki, {user?.fullName ?? 'naudotojau'}!
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {user ? (
            <>
              {ROLE_LABELS[user.role]} · {user.tenantName}
            </>
          ) : (
            'Finansavimo prašymų sistema — Aplinkos ministerija.'
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Iter 1 — Vartotojų valdymas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Vartotojai ir organizacijos jau veikia. Eikite į{' '}
            <Link
              to="/vartotojai"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Vartotojai
            </Link>{' '}
            — pamatysite sąrašą pagal jūsų rolę.
          </p>
          <p>
            <strong className="text-foreground">Kas toliau:</strong>
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Iter 2</strong> — prašymo duomenų modelis, DB schema
            </li>
            <li>
              <strong>Iter 3</strong> — prašymo teikimo wizard'as (multi-step)
            </li>
            <li>
              <strong>Iter 4</strong> — tvirtinimo flow (AM perspektyva, ping-pong)
            </li>
            <li>
              <strong>Iter 5</strong> — docsai, testai, polish
            </li>
          </ul>
          <p className="pt-2">
            Pilna dokumentacija —{' '}
            <a
              href="/docs/"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              /docs/
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
