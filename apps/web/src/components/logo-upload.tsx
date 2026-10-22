"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { ImageOff, Loader2, Trash2, Upload } from "lucide-react";
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

const LOGO_KEY = ["org-logo"];
const MAX_BYTES = 2 * 1024 * 1024; // mirrors the API's upload limit
const ACCEPT = ".svg,.png,.jpg,.jpeg,.gif,.webp";
const ACCEPTED_TYPES = ["image/svg+xml", "image/png", "image/jpeg", "image/gif", "image/webp"];
const MIN_WIDTH = 300;

/**
 * Fetch the workspace logo. The API 404s when none is set, which is the normal
 * empty state, not a failure: it becomes `null` rather than a query error.
 * Returns the raw Blob so callers own the object-URL lifecycle.
 */
async function fetchLogo(): Promise<Blob | null> {
  try {
    return (await api.get("/org/logo", { responseType: "blob" })).data as Blob;
  } catch (e) {
    if ((e as AxiosError)?.response?.status === 404) return null;
    throw e;
  }
}

/** The current logo as an object URL (null when unset), revoked on change. */
export function useOrgLogo() {
  const query = useQuery({ queryKey: LOGO_KEY, queryFn: fetchLogo, retry: false, staleTime: 60_000 });
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

/** Read-only logo, for anywhere the workspace brand should show. Renders nothing when unset. */
export function OrgLogo({ className, alt = "Company logo" }: { className?: string; alt?: string }) {
  const { url } = useOrgLogo();
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element -- an object URL cannot go through next/image
  return <img src={url} alt={alt} className={cn("h-10 w-auto max-w-[220px] object-contain", className)} />;
}

/** Client-side gate, so obvious mistakes never cost an upload round trip. */
function rejectReason(file: File): string | null {
  if (file.size > MAX_BYTES) return "That file is over 2 MB. Export it smaller, or use an SVG.";
  const byExtension = new RegExp(`(${ACCEPT.split(",").join("|")})$`, "i").test(file.name);
  if (!ACCEPTED_TYPES.includes(file.type) && !byExtension)
    return "Upload an SVG, PNG, JPEG, GIF or WEBP file.";
  return null;
}

/**
 * Letterhead advice based on the actual pixels. Raster only: an SVG scales, so
 * its intrinsic size says nothing. Warns, never blocks.
 */
function warnAboutShape(file: File) {
  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const { naturalWidth: w, naturalHeight: h } = img;
    if (w && w < MIN_WIDTH) toast.warning(`That logo is only ${w}px wide. Letterheads look soft below ${MIN_WIDTH}px.`);
    else if (h > w) toast.warning("That logo is taller than it is wide. Letterheads suit a landscape logo.");
    URL.revokeObjectURL(url);
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

export function LogoUploadCard() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can("settings.manage");
  const { url, isLoading } = useOrgLogo();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("logo", file);
      return (
        await api.post("/org/logo", form, {
          onUploadProgress: (e) => setProgress(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
        })
      ).data;
    },
    // A File is a Blob, so the picked file doubles as the preview until the
    // refetch lands. The stored bytes can differ slightly (SVGs are sanitised
    // server-side), which is why onSettled still invalidates.
    onMutate: async (file: File) => {
      setProgress(0);
      await qc.cancelQueries({ queryKey: LOGO_KEY });
      const previous = qc.getQueryData<Blob | null>(LOGO_KEY) ?? null;
      qc.setQueryData(LOGO_KEY, file);
      return { previous };
    },
    onSuccess: () => toast.success("Logo updated"),
    onError: (e, _file, ctx) => {
      qc.setQueryData(LOGO_KEY, ctx?.previous ?? null);
      toast.error(apiError(e));
    },
    onSettled: () => {
      setProgress(null);
      qc.invalidateQueries({ queryKey: LOGO_KEY });
      qc.invalidateQueries({ queryKey: ["org"] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete("/org/logo").then((r) => r.data),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: LOGO_KEY });
      const previous = qc.getQueryData<Blob | null>(LOGO_KEY) ?? null;
      qc.setQueryData(LOGO_KEY, null);
      return { previous };
    },
    onSuccess: () => toast.success("Logo removed"),
    onError: (e, _v, ctx) => {
      qc.setQueryData(LOGO_KEY, ctx?.previous ?? null);
      toast.error(apiError(e));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: LOGO_KEY });
      qc.invalidateQueries({ queryKey: ["org"] });
    },
  });

  const accept = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      const reason = rejectReason(file);
      if (reason) {
        toast.error(reason);
        return;
      }
      warnAboutShape(file);
      upload.mutate(file);
    },
    [upload]
  );

  const busy = upload.isPending || remove.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Company logo</CardTitle>
        <CardDescription>
          Printed on your letterhead: offer letters, payslips and every other generated PDF.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Preview. The checkerboard shows where a transparent logo is actually transparent. */}
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
            <img src={url} alt="Company logo" className="max-h-16 w-auto max-w-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
              <ImageOff className="size-5" />
              <span className="text-[13px]">No logo yet. PDFs use your company name instead.</span>
            </div>
          )}
        </div>

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
              <p className="mt-3 text-[15px] font-semibold">Drop your logo here</p>
              <p className="mt-1 text-[13px] text-muted-foreground">SVG, PNG, JPEG, GIF or WEBP, up to 2 MB.</p>
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
                  {url ? "Replace logo" : "Choose file"}
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
                  {progress < 100 ? `Uploading ${progress}%` : "Processing..."}
                </p>
              </div>
            )}

            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>A transparent PNG or an SVG sits cleanly on a white letterhead.</li>
              <li>Landscape works best: roughly 3:1, and at least {MIN_WIDTH}px wide.</li>
              <li>Uploaded SVGs are cleaned on the server: scripts and external references are stripped.</li>
            </ul>
          </>
        )}
        {!canManage && (
          <p className="text-xs text-muted-foreground">Only workspace admins can change the logo.</p>
        )}
      </CardContent>
    </Card>
  );
}
