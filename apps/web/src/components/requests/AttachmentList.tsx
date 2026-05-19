/**
 * Prikabintų dokumentų sąrašas su upload + download + delete.
 *
 * Naudojama paraiškos detalės puslapyje. Filtruojama pagal `kind` —
 * pvz. 'order_pdf' rodomas tik prie sprendimo metaduomenų.
 */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Download, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import type { AttachmentKind, RequestAttachment } from '@biip-finansai/shared';
import { Button } from '@/components/ui/button';
import { attachmentDelete, attachmentDownload, attachmentUpload, attachmentsList } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export interface AttachmentListProps {
  requestId: number;
  /** Jei nustatyta — rodomi tik šio tipo dokumentai. */
  kind?: AttachmentKind;
  /** Ar leisti įkelti naują dokumentą (rodyti upload mygtuką). */
  canUpload: boolean;
  /** Kokio tipo dokumentą galima įkelti per šitą instance. */
  uploadKind?: AttachmentKind;
  /** UI label uploaduojant. */
  uploadLabel?: string;
  /** Tuščio sąrašo pranešimas. */
  emptyText?: string;
  /** Prašymo statusas — naudojamas delete pre-check'ui (order_pdf po APPROVED tik AM admin). */
  requestStatus?: string;
}

interface DeleteCheckUser {
  id: number;
  tenantIsApprover: boolean;
  role: string;
}

function canDelete(
  a: RequestAttachment,
  user: DeleteCheckUser | null,
  requestStatus: string | undefined,
): boolean {
  if (!user) return false;
  const isAmAdmin = user.tenantIsApprover && user.role === 'admin';
  // order_pdf po APPROVED — tik AM admin
  if (a.kind === 'order_pdf' && requestStatus === 'APPROVED') {
    return isAmAdmin;
  }
  // Kitais atvejais — uploader arba AM admin
  return a.uploadedByUserId === user.id || isAmAdmin;
}

const MAX_BYTES = 5 * 1024 * 1024;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader grąžino ne string'));
        return;
      }
      // result yra "data:application/pdf;base64,XXXX" — paimam tik base64 dalį
      const idx = result.indexOf(',');
      resolve(idx === -1 ? result : result.slice(idx + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(file);
  });
}

function triggerBrowserDownload(fileName: string, mimeType: string, dataBase64: string): void {
  const bytes = Uint8Array.from(atob(dataBase64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AttachmentList({
  requestId,
  kind,
  canUpload,
  uploadKind = 'other',
  uploadLabel = 'Įkelti dokumentą',
  emptyText = 'Dokumentų dar nėra.',
  requestStatus,
}: AttachmentListProps): JSX.Element {
  const { user } = useAuth();
  const qc = useQueryClient();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);

  const q = useQuery<RequestAttachment[]>({
    queryKey: ['attachments', requestId],
    queryFn: () => attachmentsList(requestId),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File): Promise<RequestAttachment> => {
      if (file.size > MAX_BYTES) {
        throw new Error(`Failas per didelis (max ${MAX_BYTES / 1024 / 1024} MB).`);
      }
      const dataBase64 = await readFileAsBase64(file);
      return attachmentUpload(requestId, {
        kind: uploadKind,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataBase64,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attachments', requestId] });
      setError(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err: unknown) => {
      let msg = 'Nepavyko įkelti failo.';
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        if (data?.message) msg = data.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setError(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => attachmentDelete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attachments', requestId] });
    },
    onError: (err: unknown) => {
      let msg = 'Nepavyko ištrinti.';
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        if (data?.message) msg = data.message;
      }
      window.alert(msg);
    },
  });

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadMutation.mutate(file);
  }

  async function onDownload(att: RequestAttachment): Promise<void> {
    try {
      const data = await attachmentDownload(att.id);
      triggerBrowserDownload(data.fileName, data.mimeType, data.dataBase64);
    } catch {
      window.alert('Nepavyko parsisiųsti failo.');
    }
  }

  function onDelete(att: RequestAttachment): void {
    if (!window.confirm(`Ar tikrai ištrinti „${att.fileName}"?`)) return;
    deleteMutation.mutate(att.id);
  }

  const items = (q.data ?? []).filter((a) => (kind ? a.kind === kind : true));

  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((a) => {
            const showDelete = canDelete(a, user, requestStatus);
            return (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded border border-border bg-background px-2 py-1.5 text-sm"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{a.fileName}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {fmtBytes(a.sizeBytes)}
                    {a.uploadedByName ? ` · ${a.uploadedByName}` : ''}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void onDownload(a);
                  }}
                  title="Atsisiųsti"
                >
                  <Download className="h-4 w-4" />
                </Button>
                {showDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDelete(a)}
                    title="Ištrinti"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canUpload && (
        <div className="flex flex-col gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className="hidden"
            onChange={onFileSelected}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploadMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Įkeliama…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                {uploadLabel}
              </>
            )}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            PDF arba paveiksliukas. Maks. {MAX_BYTES / 1024 / 1024} MB.
          </p>
          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
