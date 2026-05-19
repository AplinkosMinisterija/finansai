import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import type {
  ClassifierGroup,
  ClassifierGroupCreateRequest,
  ClassifierGroupUpdateRequest,
} from '@biip-finansai/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { classifierGroupCreate, classifierGroupUpdate } from '@/lib/api';

interface FormState {
  code: string;
  name: string;
  description: string;
  active: boolean;
}

function emptyForm(): FormState {
  return { code: '', name: '', description: '', active: true };
}

function fromGroup(g: ClassifierGroup): FormState {
  return {
    code: g.code,
    name: g.name,
    description: g.description ?? '',
    active: g.active,
  };
}

export interface ClassifierGroupDialogProps {
  mode: 'create' | 'edit';
  group: ClassifierGroup | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function ClassifierGroupDialog({
  mode,
  group,
  open,
  onOpenChange,
  onSuccess,
}: ClassifierGroupDialogProps): JSX.Element {
  const [state, setState] = React.useState<FormState>(
    group ? fromGroup(group) : emptyForm(),
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setError(null);
    setState(group ? fromGroup(group) : emptyForm());
  }, [group, open]);

  const mutation = useMutation({
    mutationFn: async (): Promise<ClassifierGroup> => {
      if (mode === 'create') {
        const body: ClassifierGroupCreateRequest = {
          code: state.code.trim(),
          name: state.name.trim(),
          description: state.description.trim() || null,
          active: state.active,
        };
        return classifierGroupCreate(body);
      }
      if (!group) throw new Error('No group');
      const patch: ClassifierGroupUpdateRequest = {
        code: state.code.trim(),
        name: state.name.trim(),
        description: state.description.trim() || null,
        active: state.active,
      };
      return classifierGroupUpdate(group.id, patch);
    },
    onSuccess: () => onSuccess(),
    onError: (err: unknown) => {
      let msg = 'Nepavyko išsaugoti.';
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        if (data?.message) msg = data.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setError(msg);
    },
  });

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  const isCreate = mode === 'create';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {isCreate ? 'Nauja klasifikatoriaus grupė' : `Redaguoti — ${group?.code}`}
            </DialogTitle>
            <DialogDescription>
              {isCreate
                ? 'Grupė talpina susijusias reikšmes, pvz. „lėšų tipai".'
                : 'Atnaujinkite grupės duomenis.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2 col-span-1">
                <Label htmlFor="cg-code">Kodas</Label>
                <Input
                  id="cg-code"
                  required
                  maxLength={64}
                  placeholder="funding_type"
                  value={state.code}
                  onChange={(e) =>
                    setState((s) => ({ ...s, code: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="cg-name">Pavadinimas</Label>
                <Input
                  id="cg-name"
                  required
                  maxLength={200}
                  placeholder="Lėšų tipai"
                  value={state.name}
                  onChange={(e) =>
                    setState((s) => ({ ...s, name: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cg-desc">Aprašymas</Label>
              <textarea
                id="cg-desc"
                rows={3}
                maxLength={2000}
                placeholder="Kam skirta ši grupė"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={state.description}
                onChange={(e) =>
                  setState((s) => ({ ...s, description: e.target.value }))
                }
              />
            </div>

            <div className="flex items-start gap-2 rounded-md border border-border p-3">
              <Checkbox
                id="cg-active"
                checked={state.active}
                onCheckedChange={(checked) =>
                  setState((s) => ({ ...s, active: checked === true }))
                }
              />
              <div className="flex-1">
                <Label htmlFor="cg-active" className="cursor-pointer text-sm">
                  Aktyvi
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Neaktyvi grupė nesirodo dropdown'uose, bet duomenys išlieka.
                </p>
              </div>
            </div>

            {error && (
              <div
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {error}
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
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saugoma…
                </>
              ) : isCreate ? (
                'Sukurti'
              ) : (
                'Išsaugoti'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
