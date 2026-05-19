/**
 * Klasifikatorių valdymas (tik AM administratoriams).
 *
 * Rodo visas grupes ir jų reikšmes su 2 lygiais hierarchijos (parent/child).
 * Iš čia pridedamas / redaguojamas / ištrinamas tiek grupės, tiek reikšmės.
 *
 * Naudojama: biudžeto skaidymas (issue #1), IS dropdown (issue #7),
 * šaltinio programa (issue #8), statistika (issue #6).
 */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import type { ClassifierGroup, ClassifierItem } from '@biip-finansai/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  classifierGroupDelete,
  classifierGroupsList,
  classifierItemDelete,
  classifierItemsList,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { canManageClassifiers } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { ClassifierGroupDialog } from '@/components/classifiers/ClassifierGroupDialog';
import { ClassifierItemDialog } from '@/components/classifiers/ClassifierItemDialog';

/**
 * Sistemos grupių kodai — UI sinchronizuotas su backend'u
 * (`apps/api/src/services/classifiers.service.ts`). Audit #12.
 */
const SYSTEM_GROUP_CODES = new Set<string>([
  'funding_type',
  'is_system',
  'project_type',
  'source_program',
  'approval_levels',
]);

export default function KlasifikatoriaiPage(): JSX.Element {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [editingGroup, setEditingGroup] = React.useState<ClassifierGroup | null>(null);
  const [creatingGroup, setCreatingGroup] = React.useState(false);
  const [itemDialog, setItemDialog] = React.useState<{
    groupId: number;
    parentId: number | null;
    item: ClassifierItem | null;
  } | null>(null);

  const groupsQ = useQuery<ClassifierGroup[]>({
    queryKey: ['classifierGroups', { withCounts: true }],
    queryFn: () => classifierGroupsList(true),
  });

  const itemsQ = useQuery<ClassifierItem[]>({
    queryKey: ['classifierItems', { all: true }],
    queryFn: () => classifierItemsList({ includeInactive: true }),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (id: number) => classifierGroupDelete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['classifierGroups'] });
      void qc.invalidateQueries({ queryKey: ['classifierItems'] });
    },
    onError: (err: unknown) => {
      const msg = extractErrorMessage(err) ?? 'Nepavyko ištrinti grupės.';
      window.alert(msg);
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: (id: number) => classifierItemDelete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['classifierItems'] });
      void qc.invalidateQueries({ queryKey: ['classifierGroups'] });
    },
    onError: (err: unknown) => {
      const msg = extractErrorMessage(err) ?? 'Nepavyko ištrinti reikšmės.';
      window.alert(msg);
    },
  });

  if (!canManageClassifiers(user)) {
    return (
      <div className="mx-auto max-w-2xl p-4 md:p-6">
        <Card>
          <CardContent className="p-12 text-center text-sm text-muted-foreground">
            Šis puslapis prieinamas tik AM administratoriams.
          </CardContent>
        </Card>
      </div>
    );
  }

  const groups = groupsQ.data ?? [];
  const items = itemsQ.data ?? [];
  const itemsByGroup = new Map<number, ClassifierItem[]>();
  for (const it of items) {
    if (!itemsByGroup.has(it.groupId)) itemsByGroup.set(it.groupId, []);
    itemsByGroup.get(it.groupId)!.push(it);
  }

  function handleDeleteGroup(g: ClassifierGroup): void {
    if (SYSTEM_GROUP_CODES.has(g.code)) {
      window.alert(
        'Sistemos grupę ištrinti negalima — sistema priklauso nuo šio klasifikatoriaus.',
      );
      return;
    }
    if ((g.itemsCount ?? 0) > 0) {
      if (
        !window.confirm(
          `Grupė „${g.name}" turi ${g.itemsCount} reikšmių — kartu su grupe bus ištrintos visos jos reikšmės. Tęsti?`,
        )
      ) {
        return;
      }
    } else if (!window.confirm(`Ar tikrai ištrinti grupę „${g.name}"?`)) {
      return;
    }
    deleteGroupMutation.mutate(g.id);
  }

  function handleDeleteItem(it: ClassifierItem): void {
    if (!window.confirm(`Ar tikrai ištrinti reikšmę „${it.name}"?`)) return;
    deleteItemMutation.mutate(it.id);
  }

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Klasifikatoriai</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Valdomi sąrašai sistemoje: lėšų tipai, IS sąrašas, projekto tipai, šaltinio programos.
          </p>
        </div>
        <Button onClick={() => setCreatingGroup(true)}>
          <Plus className="h-4 w-4" />
          Nauja grupė
        </Button>
      </div>

      {groupsQ.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : groupsQ.isError ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-destructive">
            Nepavyko užkrauti klasifikatorių.
          </CardContent>
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-sm text-muted-foreground">
            Klasifikatorių dar nėra. Pradžiai sukurkite naują grupę.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              items={itemsByGroup.get(g.id) ?? []}
              onEditGroup={() => setEditingGroup(g)}
              onDeleteGroup={() => handleDeleteGroup(g)}
              onAddItem={(parentId) =>
                setItemDialog({ groupId: g.id, parentId, item: null })
              }
              onEditItem={(item) =>
                setItemDialog({ groupId: g.id, parentId: item.parentId, item })
              }
              onDeleteItem={handleDeleteItem}
            />
          ))}
        </div>
      )}

      {(creatingGroup || editingGroup !== null) && (
        <ClassifierGroupDialog
          mode={editingGroup ? 'edit' : 'create'}
          group={editingGroup}
          open={creatingGroup || editingGroup !== null}
          onOpenChange={(o) => {
            if (!o) {
              setCreatingGroup(false);
              setEditingGroup(null);
            }
          }}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['classifierGroups'] });
            setCreatingGroup(false);
            setEditingGroup(null);
          }}
        />
      )}

      {itemDialog !== null && (
        <ClassifierItemDialog
          mode={itemDialog.item ? 'edit' : 'create'}
          groupId={itemDialog.groupId}
          parentId={itemDialog.parentId}
          item={itemDialog.item}
          siblings={items.filter(
            (i) => i.groupId === itemDialog.groupId && i.parentId === null,
          )}
          open
          onOpenChange={(o) => {
            if (!o) setItemDialog(null);
          }}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['classifierItems'] });
            void qc.invalidateQueries({ queryKey: ['classifierGroups'] });
            setItemDialog(null);
          }}
        />
      )}
    </div>
  );
}

interface GroupCardProps {
  group: ClassifierGroup;
  items: ClassifierItem[];
  onEditGroup: () => void;
  onDeleteGroup: () => void;
  onAddItem: (parentId: number | null) => void;
  onEditItem: (item: ClassifierItem) => void;
  onDeleteItem: (item: ClassifierItem) => void;
}

function GroupCard({
  group,
  items,
  onEditGroup,
  onDeleteGroup,
  onAddItem,
  onEditItem,
  onDeleteItem,
}: GroupCardProps): JSX.Element {
  const tops = items.filter((i) => i.parentId === null);
  const isSystem = SYSTEM_GROUP_CODES.has(group.code);
  return (
    <Card className={cn(!group.active && 'opacity-60')}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Tags className="h-4 w-4 text-muted-foreground" />
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
              {group.code}
            </code>
            <span className="font-medium">{group.name}</span>
            <Badge variant="secondary" className="text-[10px]">
              {items.length} reikš.
            </Badge>
            {isSystem && (
              <Badge variant="outline" className="text-[10px]">
                Sistemos grupė
              </Badge>
            )}
            {!group.active && (
              <Badge variant="destructive" className="text-[10px]">
                neaktyvi
              </Badge>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={() => onAddItem(null)}>
              <Plus className="h-4 w-4" />
              Reikšmė
            </Button>
            <Button variant="outline" size="sm" onClick={onEditGroup}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onDeleteGroup}
              disabled={isSystem}
              title={
                isSystem
                  ? 'Sistemos grupę ištrinti negalima — sistema priklauso nuo šio klasifikatoriaus'
                  : 'Ištrinti grupę'
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {group.description && (
          <p className="text-xs text-muted-foreground">{group.description}</p>
        )}

        {tops.length === 0 ? (
          <p className="text-xs text-muted-foreground">Reikšmių dar nėra.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {tops.map((top) => {
              const children = items.filter((i) => i.parentId === top.id);
              return (
                <li key={top.id}>
                  <ItemRow
                    item={top}
                    onAddChild={() => onAddItem(top.id)}
                    onEdit={() => onEditItem(top)}
                    onDelete={() => onDeleteItem(top)}
                  />
                  {children.length > 0 && (
                    <ul className="ml-6 mt-1 space-y-1 border-l pl-3">
                      {children.map((c) => (
                        <li key={c.id}>
                          <ItemRow
                            item={c}
                            onEdit={() => onEditItem(c)}
                            onDelete={() => onDeleteItem(c)}
                            child
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface ItemRowProps {
  item: ClassifierItem;
  onAddChild?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  child?: boolean;
}

function ItemRow({ item, onAddChild, onEdit, onDelete, child }: ItemRowProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-muted/40',
        !item.active && 'opacity-60',
      )}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <code className="rounded bg-muted px-1 text-[11px] font-mono">{item.code}</code>
        <span className={child ? 'text-sm' : 'font-medium'}>{item.name}</span>
        {!item.active && (
          <Badge variant="destructive" className="text-[10px]">
            neaktyvi
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onAddChild && (
          <Button variant="ghost" size="sm" onClick={onAddChild} title="Pridėti sub-reikšmę">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onEdit} title="Redaguoti">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
          title="Ištrinti"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function extractErrorMessage(err: unknown): string | null {
  if (err instanceof Error && 'response' in err) {
    const resp = (err as { response?: { data?: { message?: string } } }).response;
    return resp?.data?.message ?? null;
  }
  return null;
}
