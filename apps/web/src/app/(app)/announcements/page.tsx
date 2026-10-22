"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, Trash2, Pin, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Label } from "@open-hrms/ui/label";
import { Field } from "@open-hrms/ui/field";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Badge } from "@open-hrms/ui/badge";
import { Textarea } from "@open-hrms/ui/textarea";
import { Skeleton } from "@open-hrms/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@open-hrms/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@open-hrms/ui/dialog";

interface Announcement {
  id: string;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  authorId: string | null;
  authorName: string;
  createdAt: string;
}

type AnnouncementForm = {
  title: string;
  body: string;
  pinned: boolean;
};

function emptyForm(): AnnouncementForm {
  return { title: "", body: "", pinned: false };
}

function fromAnnouncement(a: Announcement): AnnouncementForm {
  return { title: a.title ?? "", body: a.body ?? "", pinned: !!a.pinned };
}

function formatDate(x: string): string {
  return new Date(x).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function AnnouncementDialog({
  announcement,
  open,
  onOpenChange,
}: {
  announcement: Announcement | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const isNew = !announcement;
  const [form, setForm] = useState<AnnouncementForm>(
    announcement ? fromAnnouncement(announcement) : emptyForm()
  );
  const set = (k: keyof AnnouncementForm, v: unknown) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () =>
      isNew
        ? http.post("/announcements", form)
        : http.put(`/announcements/${announcement!.id}`, form),
    onSuccess: () => {
      toast.success(isNew ? "Announcement posted" : "Announcement updated");
      qc.invalidateQueries({ queryKey: ["announcements"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "New announcement" : "Edit announcement"}</DialogTitle>
          <DialogDescription>
            Posting an announcement notifies everyone in the organisation.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Title">
            <Input
              required
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>
          <Field label="Body">
            <Textarea
              required
              rows={6}
              value={form.body}
              onChange={(e) => set("body", e.target.value)}
            />
          </Field>
          <Label className="text-sm">
            <Checkbox checked={form.pinned} onCheckedChange={(v) => set("pinned", v === true)} />
            Pin to the top of the feed
          </Label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{" "}
              {isNew ? "Post" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AnnouncementsPage() {
  const { isStaff } = useAuth();
  const qc = useQueryClient();
  const [dialogAnnouncement, setDialogAnnouncement] = useState<Announcement | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ["announcements"],
    queryFn: () => http.get<Announcement[]>("/announcements"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => http.del(`/announcements/${id}`),
    onSuccess: () => {
      toast.success("Announcement deleted");
      qc.invalidateQueries({ queryKey: ["announcements"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const openNew = () => {
    setDialogAnnouncement(null);
    setDialogOpen(true);
  };
  const openEdit = (a: Announcement) => {
    setDialogAnnouncement(a);
    setDialogOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Company-wide updates and notices."
        actions={
          isStaff ? (
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" /> New announcement
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="mt-2 h-3 w-1/4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="mt-2 h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : announcements.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Megaphone className="h-8 w-8" />
            <p className="font-medium text-foreground">No announcements yet</p>
            <p>
              {isStaff
                ? "Post the first update for your team."
                : "Check back later for company updates."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {announcements.map((a) => (
            <Card
              key={a.id}
              className={a.pinned ? "border-l-2 border-l-[var(--coral)]" : undefined}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2">
                      {a.pinned && <Pin className="h-4 w-4 shrink-0 text-primary" />}
                      <span className="truncate">{a.title}</span>
                    </CardTitle>
                    <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge variant="grey">
                        {a.category.charAt(0) + a.category.slice(1).toLowerCase()}
                      </Badge>
                      <span>{a.authorName}</span>
                      <span aria-hidden>&middot;</span>
                      <span>{formatDate(a.createdAt)}</span>
                    </CardDescription>
                  </div>
                  {isStaff && (
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(a)}>
                        <Pencil className="mr-1 size-4" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (window.confirm(`Delete "${a.title}"?`)) remove.mutate(a.id);
                        }}
                      >
                        <Trash2 className="mr-1 size-4" /> Delete
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {a.body}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {dialogOpen && (
        <AnnouncementDialog
          key={dialogAnnouncement?.id ?? "new"}
          announcement={dialogAnnouncement}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </>
  );
}
