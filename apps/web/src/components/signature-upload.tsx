"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { Loader2, PenLine, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@open-hrms/ui/cn";
import { Button } from "@open-hrms/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@open-hrms/ui/card";
import { Skeleton } from "@open-hrms/ui/skeleton";

const SIGNATURE_KEY = ["org-signature"];
const MAX_BYTES = 2 * 1024 * 1024; // mirrors the API's upload limit
const ACCEPT = ".png,.jpg,.jpeg";
const ACCEPTED_TYPES = ["image/png", "image/jpeg"];

/** What POST /org/signature reports back once it has removed the paper and cropped to the ink. */
interface ProcessedSize {
  width: number;
  height: number;
}

/**
 * Fetch the stored signature. The API 404s when none is set, which is the normal
 * empty state (letters fall back to the name over a rule), not a failure: it
 * becomes `null` rather than a query error.
 */
async function fetchSignature(): Promise<Blob | null> {
  try {
    return (await api.get("/org/signature", { responseType: "blob" })).data as Blob;
  } catch (e) {
    if ((e as AxiosError)?.response?.status === 404) return null;
    throw e;
  }
}

/** The current signature as an object URL (null when unset), revoked on change. */
export function useOrgSignature() {
  const query = useQuery({
    queryKey: SIGNATURE_KEY,
    queryFn: fetchSignature,
    retry: false,
    staleTime: 60_000,
  });
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!query.data) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(query.data);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [query.data]);

  return { url, isLoading: query.isLoading, isError: query.isError };
}

/** Client-side gate, so obvious mistakes never cost an upload round trip. */
function rejectReason(file: File): string | null {
  if (file.size > MAX_BYTES) return "That file is over 2 MB. Export it smaller, or photograph it at a lower resolution.";
  const byExtension = new RegExp(`(${ACCEPT.split(",").join("|")})$`, "i").test(file.name);
  if (!ACCEPTED_TYPES.includes(file.type) && !byExtension)
    return "The signature must be a PNG or JPEG photo or scan.";
  return null;
}

export function SignatureUploadCard() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can("settings.manage");
  const { url, isLoading } = useOrgSignature();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  // Size of the stored PNG. Comes from the upload response while it is fresh, and
  // otherwise from the preview image, so a returning admin still sees the crop.
  const [size, setSize] = useState<ProcessedSize | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      // The field name the API matches on. "logo" is a different endpoint.
      form.append("signature", file);
      return (
        await api.post<ProcessedSize>("/org/signature", form, {
          onUploadProgress: (e) => setProgress(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
        })
      ).data;
    },
    // A File is a Blob, so the picked file doubles as the preview until the refetch
    // lands. Unlike the logo, what comes back is visibly different (paper removed,
    // cropped to the ink), so the measured size is dropped until the server answers.
    onMutate: async (file: File) => {
      setProgress(0);
      setSize(null);
      await qc.cancelQueries({ queryKey: SIGNATURE_KEY });
      const previous = qc.getQueryData<Blob | null>(SIGNATURE_KEY) ?? null;
      qc.setQueryData(SIGNATURE_KEY, file);
      return { previous };
    },
    onSuccess: (data) => {
      setSize({ width: data.width, height: data.height });
      toast.success("Signature updated");
    },
    onError: (e, _file, ctx) => {
      qc.setQueryData(SIGNATURE_KEY, ctx?.previous ?? null);
      // The API's rejections are written for the person uploading, so show them as they are.
      toast.error(apiError(e));
    },
    onSettled: () => {
      setProgress(null);
      qc.invalidateQueries({ queryKey: SIGNATURE_KEY });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete("/org/signature").then((r) => r.data),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: SIGNATURE_KEY });
      const previous = qc.getQueryData<Blob | null>(SIGNATURE_KEY) ?? null;
      qc.setQueryData(SIGNATURE_KEY, null);
      setSize(null);
      return { previous };
    },
    onSuccess: () => toast.success("Signature removed"),
    onError: (e, _v, ctx) => {
      qc.setQueryData(SIGNATURE_KEY, ctx?.previous ?? null);
      toast.error(apiError(e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SIGNATURE_KEY }),
  });

  const accept = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      const reason = rejectReason(file);
      if (reason) {
        toast.error(reason);
        return;
      }
      upload.mutate(file);
    },
    [upload]
  );

  const busy = upload.isPending || remove.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Authorised signature</CardTitle>
        <CardDescription>
          Sits above the signatory name in the signature block of every issued letter: offer,
          relieving, appraisal and the rest.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Preview. The checkerboard is the proof: the paper really is gone, not painted white. */}
        <div
          className="flex min-h-[104px] items-center justify-center rounded-[12px] border border-border p-4"
          style={{
            backgroundImage:
              "repeating-conic-gradient(color-mix(in srgb, var(--muted) 80%, transparent) 0% 25%, transparent 0% 50%)",
            backgroundSize: "16px 16px",
          }}
        >
          {isLoading ? (
            <Skeleton className="h-12 w-40" />
          ) : url ? (
            // eslint-disable-next-line @next/next/no-img-element -- an object URL cannot go through next/image
            <img
              src={url}
              alt="Authorised signature"
              className="max-h-16 w-auto max-w-full object-contain"
              onLoad={(e) => {
                // Only meaningful once the stored PNG is on screen: mid-upload the preview
                // is still the untrimmed original the person picked.
                if (upload.isPending) return;
                const img = e.currentTarget;
                setSize((s) => s ?? { width: img.naturalWidth, height: img.naturalHeight });
              }}
            />
          ) : (
            <div className="flex flex-col items-center gap-1.5 px-4 text-center text-muted-foreground">
              <PenLine className="size-5" />
              <span className="text-[13px]">
                No signature yet. Letters sign with the signatory&apos;s name over a rule, which is
                still valid.
              </span>
            </div>
          )}
        </div>

        {url && size && !upload.isPending && (
          <p className="text-xs text-muted-foreground">
            Background removed and cropped to the ink: {size.width} x {size.height} px.
          </p>
        )}

        {canManage && (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!busy) accept(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                "flex flex-col items-center justify-center rounded-[12px] border-2 border-dashed px-6 py-8 text-center transition-colors duration-200",
                dragging ? "border-primary bg-primary/5" : "border-border bg-muted/40"
              )}
            >
              <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
                <Upload className="size-5" />
              </span>
              <p className="mt-3 text-[15px] font-semibold">Drop a photo or scan of your signature</p>
              <p className="mt-1 text-[13px] text-muted-foreground">PNG or JPEG, up to 2 MB.</p>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  accept(e.target.files?.[0]);
                  e.target.value = ""; // allow re-selecting the same file
                }}
              />
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
                  {upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
                  {url ? "Replace signature" : "Choose file"}
                </Button>
                {url && (
                  <Button size="sm" variant="destructive-soft" disabled={busy} onClick={() => remove.mutate()}>
                    {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    Remove
                  </Button>
                )}
              </div>
            </div>

            {progress !== null && (
              <div className="space-y-1.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {progress < 100 ? `Uploading ${progress}%` : "Removing the background..."}
                </p>
              </div>
            )}

            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>Sign on plain white paper in dark ink: black or dark blue, and unhurried.</li>
              <li>Photograph or scan it straight on in even light, not at an angle.</li>
              <li>The paper is removed and the image cropped to the ink, so nothing else should be on the sheet.</li>
              <li>Removing the signature is safe: letters go back to the signatory&apos;s name over a rule.</li>
            </ul>
          </>
        )}
        {!canManage && (
          <p className="text-xs text-muted-foreground">Only workspace admins can change the signature.</p>
        )}
      </CardContent>
    </Card>
  );
}
