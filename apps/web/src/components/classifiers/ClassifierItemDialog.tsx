import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import type {
  ClassifierItem,
  ClassifierItemCreateRequest,
  ClassifierItemUpdateRequest,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { classifierItemCreate, classifierItemUpdate } from '@/lib/api';

interface FormState {
  parentId: number | null;
  code: string;
  name: string;
  sortOrder: string;
  active: boolean;
}

function emptyForm(parentId: number | null): FormState {
  return {
    parentId,
    code: '',
    name: '',
    sortOrder: '0',
    active: true,
  };
}

function fromItem(it: ClassifierItem): FormState {
  return {
    parentId: it.parentId,
    code: it.code,
    name: it.name,
    sortOrder: String(it.sortOrder),
    active: it.active,
  };
}

export interface ClassifierItemDialogProps {
  mode: 'create' | 'edit';
  groupId: number;
  /** Grupės kodas — naudojamas conditional UI (is_system, source_program). */
  groupCode?: string;
  parentId: number | null;
  item: ClassifierItem | null;
  /** Top-level item'ai grupėje — galimas parent_id sąrašas. */
  siblings: ClassifierItem[];
  /**
   * UAT #42 (PA-005): cross-group tėvinės reikšmės (pvz. funding_source_type
   * item'ai, kuriuos galima priskirti source_program reikšmei). Tuščia, jei
   * grupė neturi cross-group tėvų.
   */
  crossGroupParents?: ClassifierItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function ClassifierItemDialog({
  mode,
  groupId,
  groupCode,
  parentId,
  item,
  siblings,
  crossGroupParents = [],
  open,
  onOpenChange,
  onSuccess,
}: ClassifierItemDialogProps): JSX.Element {
  const [state, setState] = React.useState<FormState>(item ? fromItem(item) : emptyForm(parentId));
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setError(null);
    setState(item ? fromItem(item) : emptyForm(parentId));
  }, [item, parentId, open]);

  const mutation = useMutation({
    mutationFn: async (): Promise<ClassifierItem> => {
      const sortOrder = Number.parseInt(state.sortOrder, 10) || 0;
      if (mode === 'create') {
        const body: ClassifierItemCreateRequest = {
          groupId,
          parentId: state.parentId,
          code: state.code.trim(),
          name: state.name.trim(),
          sortOrder,
          active: state.active,
        };
        return classifierItemCreate(body);
      }
      if (!item) throw new Error('No item');
      const patch: ClassifierItemUpdateRequest = {
        parentId: state.parentId,
        code: state.code.trim(),
        name: state.name.trim(),
        sortOrder,
        active: state.active,
      };
      return classifierItemUpdate(item.id, patch);
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
  const isSystemGroup = groupCode === 'is_system';
  const isSourceProgram = groupCode === 'source_program';
  // UAT #42 (PA-005): source_program reikšmei tėvas yra funding_source_type
  // item'as (cross-group). Kitoms grupėms — tos pačios grupės top-level reikšmės.
  const eligibleParents = (isSourceProgram ? crossGroupParents : siblings).filter(
    (s) => !item || s.id !== item.id,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{isCreate ? 'Nauja reikšmė' : `Redaguoti — ${item?.code}`}</DialogTitle>
            <DialogDescription>
              {isCreate
                ? 'Įveskite reikšmės kodą, pavadinimą ir tėvinę reikšmę (jei reikia).'
                : 'Atnaujinkite reikšmės duomenis.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="ci-parent">
                {isSourceProgram ? 'Finansavimo šaltinio tipas (tėvas)' : 'Tėvinė reikšmė'}
              </Label>
              <Select
                value={state.parentId === null ? 'none' : String(state.parentId)}
                onValueChange={(v) =>
                  setState((s) => ({
                    ...s,
                    parentId: v === 'none' ? null : Number.parseInt(v, 10),
                  }))
                }
              >
                <SelectTrigger id="ci-parent">
                  <SelectValue placeholder="Be tėvinės" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {isSourceProgram ? 'Be šaltinio tipo' : 'Be tėvinės (top-level)'}
                  </SelectItem>
                  {eligibleParents.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name} ({p.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {isSourceProgram
                  ? 'UAT #42 (PA-005): programą galima susieti su finansavimo šaltinio tipu (šaltinis → programa).'
                  : 'Pvz. „IT" yra top-level, o „Licencijos" — jos sub-reikšmė.'}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2 col-span-1">
                <Label htmlFor="ci-code">{isSystemGroup ? 'Trumpinys' : 'Kodas'}</Label>
                <Input
                  id="ci-code"
                  required
                  maxLength={64}
                  placeholder={isSystemGroup ? 'IAMS' : 'IT_LICENSES'}
                  value={state.code}
                  onChange={(e) => setState((s) => ({ ...s, code: e.target.value }))}
                />
                {isSystemGroup && (
                  <p className="text-[11px] text-muted-foreground">
                    Trumpinys — rodomas sąrašuose (pvz. „IAMS").
                  </p>
                )}
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="ci-name">Pavadinimas</Label>
                <Input
                  id="ci-name"
                  required
                  maxLength={200}
                  placeholder={
                    isSystemGroup ? 'Informacinė aplinkos monitoringo sistema' : 'Licencijos'
                  }
                  value={state.name}
                  onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
                />
                {isSystemGroup && (
                  <p className="text-[11px] text-muted-foreground">
                    Pilnas pavadinimas — rodomas detalioje peržiūroje.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ci-order">Tvarka</Label>
              <Input
                id="ci-order"
                type="number"
                value={state.sortOrder}
                onChange={(e) => setState((s) => ({ ...s, sortOrder: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">
                Mažesnis skaičius rodomas viršuje (0, 10, 20…).
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-border p-3">
              <Checkbox
                id="ci-active"
                checked={state.active}
                onCheckedChange={(checked) => setState((s) => ({ ...s, active: checked === true }))}
              />
              <div className="flex-1">
                <Label htmlFor="ci-active" className="cursor-pointer text-sm">
                  Aktyvi
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Neaktyvi reikšmė nesirodo dropdown'uose.
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
