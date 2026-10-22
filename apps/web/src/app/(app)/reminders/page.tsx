"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Skeleton } from "@open-hrms/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@open-hrms/ui/select";
import { Field, FormGrid } from "@open-hrms/ui/field";
import { Textarea } from "@open-hrms/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@open-hrms/ui/dialog";

type Priority = "LOW" | "MEDIUM" | "HIGH";
type ReminderStatus = "OPEN" | "DONE";

type Reminder = {
  id: string;
  userId: string;
  title: string;
  note?: string | null;
  dueDate?: string | null;
  priority: Priority;
  link?: string | null;
  status: ReminderStatus;
  completedAt?: string | null;
  createdAt: string;
};

type BadgeColour = "green" | "amber" | "red" | "blue" | "grey" | "violet";

const PRIORITY_VARIANT: Record<Priority, BadgeColour> = {
  HIGH: "red",
  MEDIUM: "violet",
  LOW: "grey",
};

const PRIORITIES: Priority[] = ["MEDIUM", "HIGH", "LOW"];

function priorityLabel(p: Priority) {
  return p.charAt(0) + p.slice(1).toLowerCase();
}

function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function RemindersPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");

  const { data: reminders = [], isLoading } = useQuery({
    queryKey: ["reminders"],
    queryFn: () => http.get<Reminder[]>("/reminders"),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["reminders"] });

  const add = useMutation({
    mutationFn: () =>
      http.post<Reminder>("/reminders", {
        title: title.trim(),
        note: note.trim() || undefined,
        dueDate: due || null,
        priority,
      }),
    onSuccess: () => {
      toast.success("Reminder added");
      setTitle("");
      setNote("");
      setDue("");
      setPriority("MEDIUM");
      setAddOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const toggle = useMutation({
    mutationFn: (id: string) => http.post<Reminder>(`/reminders/${id}/toggle`, {}),
    onSuccess: invalidate,
    onError: (e) => toast.error(apiError(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => http.del(`/reminders/${id}`),
    onSuccess: () => {
      toast.success("Deleted");
      invalidate();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const submitQuickAdd = () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    add.mutate();
  };

  const today = todayStr();
  const open = reminders.filter((r) => r.status === "OPEN");
  const done = reminders.filter((r) => r.status === "DONE");

  const renderRow = (r: Reminder) => {
    const overdue = r.status === "OPEN" && !!r.dueDate && r.dueDate < today;
    return (
      <div key={r.id} className="flex items-start gap-3 border-b px-4 py-3 last:border-b-0">
        <Checkbox
          checked={r.status === "DONE"}
          onCheckedChange={() => toggle.mutate(r.id)}
          aria-label="Toggle done"
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <div
            className={
              r.status === "DONE"
                ? "font-medium text-muted-foreground line-through"
                : "font-medium"
            }
          >
            {r.title}
          </div>
          {r.note && <div className="mt-0.5 text-xs text-muted-foreground">{r.note}</div>}
        </div>
        <Badge variant={PRIORITY_VARIANT[r.priority]}>{priorityLabel(r.priority)}</Badge>
        {r.dueDate && (
          <span
            className={
              overdue
                ? "shrink-0 text-xs font-medium text-[var(--bad)]"
                : "shrink-0 text-xs text-muted-foreground"
            }
          >
            {formatDate(r.dueDate)}
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={remove.isPending}
          onClick={() => remove.mutate(r.id)}
          aria-label="Delete reminder"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="Reminders"
        description="Your personal to-dos."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add reminder
          </Button>
        }
      />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add reminder</DialogTitle>
            <DialogDescription>A personal to-do, visible only to you.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submitQuickAdd();
            }}
          >
            <Field label="Title" htmlFor="rem-title">
              <Input
                id="rem-title"
                autoFocus
                placeholder="e.g. Follow up on offer letter"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Note (optional)" htmlFor="rem-note">
              <Textarea
                id="rem-note"
                rows={2}
                placeholder="Any extra context"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <FormGrid columns={2}>
              <Field label="Due date" htmlFor="rem-due">
                <Input
                  id="rem-due"
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </Field>
              <Field label="Priority">
                <Select
                  items={PRIORITIES.map((p) => ({ value: p, label: priorityLabel(p) }))}
                  value={priority}
                  onValueChange={(v) => setPriority(v as Priority)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {priorityLabel(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FormGrid>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={add.isPending}>
                {add.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Add reminder
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <Card className="divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-4 py-3">
              <Skeleton className="h-6 w-full" />
            </div>
          ))}
        </Card>
      ) : reminders.length === 0 ? (
        <Card>
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nothing here yet. Use Add reminder to create your first one.
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <div>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
              Open ({open.length})
            </h2>
            <Card>
              {open.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  All caught up.
                </div>
              ) : (
                open.map(renderRow)
              )}
            </Card>
          </div>

          {done.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                Done ({done.length})
              </h2>
              <Card>{done.map(renderRow)}</Card>
            </div>
          )}
        </div>
      )}
    </>
  );
}
