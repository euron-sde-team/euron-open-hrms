"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { PasswordInput } from "@open-hrms/ui/password-input";
import { Field } from "@open-hrms/ui/field";
import { Badge } from "@open-hrms/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@open-hrms/ui/card";
import { TwoFactorCard } from "@/components/two-factor";

/** Humanize a role key (e.g. TEAM_LEAD → "Team Lead"). */
function roleLabel(role?: string): string {
  if (!role) return "-";
  return role
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export default function ProfilePage() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");

  const change = useMutation({
    mutationFn: () => http.post("/auth/change-password", { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast.success("Password updated");
      setCurrent("");
      setNext("");
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <>
      <PageHeader title="My profile" description="Your account details and security." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Name</span>
              <span className="font-medium">{user?.name}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="shrink-0 text-muted-foreground">Email</span>
              <span className="min-w-0 truncate font-medium" title={user?.email}>{user?.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Role</span>
              <Badge variant="violet">{roleLabel(user?.role)}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Organisation</span>
              <span className="font-medium">{user?.org?.name}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                change.mutate();
              }}
              className="space-y-4"
            >
              <Field label="Current password" htmlFor="current">
                <PasswordInput id="current" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
              </Field>
              <Field label="New password" htmlFor="next">
                <PasswordInput id="next" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
              </Field>
              <Button type="submit" disabled={change.isPending}>
                {change.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Update password
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <TwoFactorCard />
        </div>
      </div>
    </>
  );
}
