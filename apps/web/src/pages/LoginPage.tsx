import * as React from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth';

const loginSchema = z.object({
  username: z.string().min(1, 'Įveskite vartotojo vardą').max(64, 'Per ilgas vartotojo vardas'),
  password: z.string().min(1, 'Įveskite slaptažodį').max(200, 'Per ilgas slaptažodis'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const DEMO_ACCOUNTS: { username: string; description: string }[] = [
  { username: 'demo', description: 'AM administratorius (alias)' },
  { username: 'am-admin', description: 'AM administratorius' },
  { username: 'am-user', description: 'AM specialistas (visos org.)' },
  { username: 'am-user-aad', description: 'AM specialistas (tik AAD scope)' },
  { username: 'am-departamentas', description: 'AM tvirtintojas — Departamento aprobacija (#9)' },
  { username: 'am-kancleris', description: 'AM tvirtintojas — Kanclerio aprobacija (#9)' },
  { username: 'aad-admin', description: 'AAD administratorius' },
  { username: 'aad-user', description: 'AAD specialistas' },
  { username: 'vstt-admin', description: 'VSTT administratorius' },
  { username: 'vstt-user', description: 'VSTT specialistas' },
  { username: 'lgt-admin', description: 'LGT administratorius' },
  { username: 'lgt-user', description: 'LGT specialistas' },
];

interface LocationState {
  from?: string;
}

export default function LoginPage(): JSX.Element {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const fromUrl = (location.state as LocationState | null)?.from;
  const redirectTo = fromUrl && fromUrl !== '/login' ? fromUrl : '/';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  });

  if (!loading && user) {
    return <Navigate to={redirectTo} replace />;
  }

  const onSubmit = async (values: LoginFormValues): Promise<void> => {
    setSubmitError(null);
    try {
      await login(values.username, values.password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      let message = 'Nepavyko prisijungti. Patikrinkite duomenis ir bandykite dar kartą.';
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        if (data?.message) {
          message = data.message;
        } else if (!err.response) {
          message = 'Nepavyko pasiekti serverio. Pabandykite vėliau.';
        }
      }
      setSubmitError(message);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-xl font-bold text-primary-foreground">
            €
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Prisijunkite prie Finansai</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Aplinkos ministerijos finansavimo prašymų sistema
          </p>
        </div>

        <Card>
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <CardHeader>
              <CardTitle>Prisijungimas</CardTitle>
              <CardDescription>Naudokite savo darbo paskyrą arba demo prieigą.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Vartotojo vardas</Label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  aria-invalid={!!errors.username}
                  {...register('username')}
                />
                {errors.username && (
                  <p className="text-xs text-destructive">{errors.username.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Slaptažodis</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={!!errors.password}
                  {...register('password')}
                />
                {errors.password && (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                )}
              </div>

              {submitError && (
                <div
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  role="alert"
                >
                  {submitError}
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full" size="lg" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Jungiamasi…
                  </>
                ) : (
                  'Prisijungti'
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>

        <Card className="bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Demo paskyros</CardTitle>
            <CardDescription className="text-xs">
              Slaptažodis visiems: <code className="font-mono">demo</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-4">
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {DEMO_ACCOUNTS.map((acc) => (
                <li key={acc.username} className="flex items-center gap-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
                    {acc.username}
                  </code>
                  <span>{acc.description}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
