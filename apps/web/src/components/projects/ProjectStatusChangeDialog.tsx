/**
 * `ProjectStatusChangeDialog` — projekto statuso keitimo dialog'as.
 *
 * Backend logika:
 *  - Forward tranzicijos (planuojama → vykdoma → baigta) — AM admin + org_admin
 *  - „baigta → uzdaryta" — TIK AM admin
 *  - Reverse — TIK AM admin
 *
 * Frontend'as paskaičiuoja valid transitions iš current statusas + user role'ės
 * ir rodo tik leistinus pasirinkimus radio'uose.
 */
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import type { Project, ProjectStatus } from '@biip-finansai/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { projectsApi } from '@/lib/api/fvm';
import { useAuth } from '@/lib/auth';
import {
  PROJECT_STATUS_LABELS,
  ProjectStatusBadge,
} from './ProjectStatusBadge';

const STATUSES: ProjectStatus[] = ['planuojama', 'vykdoma', 'baigta', 'uzdaryta'];

const FORWARD_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  planuojama: ['vykdoma'],
  vykdoma: ['baigta'],
  baigta: ['uzdaryta'],
  uzdaryta: [],
};

const AM_ONLY_FORWARD_TARGETS: ProjectStatus[] = ['uzdaryta'];

/**
 * Pagal current statusas ir vartotojo role'ę grąžina galimas tranzicijas.
 */
function getValidTransitions(
  from: ProjectStatus,
  isAmAdmin: boolean,
): ProjectStatus[] {
  const out: ProjectStatus[] = [];
  for (const to of STATUSES) {
    if (to === from) continue;
    const fromIdx = STATUSES.indexOf(from);
    const toIdx = STATUSES.indexOf(to);
    const isForward = toIdx > fromIdx;
    if (!isForward) {
      // reverse — tik AM admin
      if (isAmAdmin) out.push(to);
      continue;
    }
    const allowed = FORWARD_TRANSITIONS[from];
    if (!allowed.includes(to)) continue;
    if (AM_ONLY_FORWARD_TARGETS.includes(to) && !isAmAdmin) continue;
    out.push(to);
  }
  return out;
}

export interface ProjectStatusChangeDialogProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (project: Project) => void;
}

export function ProjectStatusChangeDialog({
  project,
  open,
  onOpenChange,
  onSuccess,
}: ProjectStatusChangeDialogProps): JSX.Element {
  const { user } = useAuth();
  const isAmAdmin =
    user?.tenantIsApprover === true && user.role === 'admin';
  const validTransitions = React.useMemo(
    () => getValidTransitions(project.statusas, isAmAdmin),
    [project.statusas, isAmAdmin],
  );

  const [newStatus, setNewStatus] = React.useState<ProjectStatus | null>(
    validTransitions[0] ?? null,
  );
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setServerError(null);
    setNewStatus(validTransitions[0] ?? null);
  }, [project.id, validTransitions, open]);

  const mutation = useMutation({
    mutationFn: async (): Promise<Project> => {
      if (newStatus === null) throw new Error('Pasirinkite naują statusą.');
      return projectsApi.changeStatus(project.id, { statusas: newStatus });
    },
    onSuccess: (p) => onSuccess(p),
    onError: (err: unknown) => {
      let msg = 'Nepavyko pakeisti statuso.';
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        if (data?.message) msg = data.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setServerError(msg);
    },
  });

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setServerError(null);
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>Keisti projekto statusą</DialogTitle>
            <DialogDescription>
              Pasirinkite naują projekto statusą iš galimų tranzicijų.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Esamas statusas</Label>
              <div>
                <ProjectStatusBadge status={project.statusas} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Naujas statusas</Label>
              {validTransitions.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                  Nėra galimų statuso pakeitimų jūsų rolėje.
                </p>
              ) : (
                <div role="radiogroup" className="space-y-2">
                  {validTransitions.map((s) => (
                    <label
                      key={s}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-border p-2 hover:bg-muted/50"
                    >
                      <input
                        type="radio"
                        name="project-new-status"
                        checked={newStatus === s}
                        onChange={() => setNewStatus(s)}
                        className="h-4 w-4"
                      />
                      <ProjectStatusBadge status={s} />
                      <span className="text-sm text-muted-foreground">
                        {PROJECT_STATUS_LABELS[s]}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {serverError && (
              <div
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {serverError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Atšaukti
            </Button>
            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                newStatus === null ||
                validTransitions.length === 0
              }
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Pakeisti
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ProjectStatusChangeDialog;
