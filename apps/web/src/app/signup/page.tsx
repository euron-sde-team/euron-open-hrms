"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, MailCheck, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { http, apiError } from "@/lib/api";
import { productName } from "@/lib/runtime-env";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { PasswordInput } from "@open-hrms/ui/password-input";
import { PhoneField, joinPhone } from "@/components/phone-field";
import { Field, FormGrid } from "@open-hrms/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@open-hrms/ui/select";

interface CountryOption { country: string; label: string }

interface SignupResult {
  ok: boolean;
  verifyRequired?: boolean;
  mail?: { to: string; mode: string };
}

export default function SignupPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [companyName, setCompanyName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [email, setEmail] = useState("");
  const [dialCode, setDialCode] = useState("+91");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [country, setCountry] = useState("IN");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SignupResult | null>(null);

  // Full ISO country list (public endpoint, no auth needed pre-signup).
  const { data: countries = [] } = useQuery({
    queryKey: ["signup-countries"],
    queryFn: () => http.get<CountryOption[]>("/signup/countries"),
  });

  // Already signed in → go to the app.
  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await http.post<SignupResult>("/signup", {
        companyName,
        adminName,
        email,
        phone: joinPhone(dialCode, phone),
        password,
        country,
      });
      setDone(res);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  const countryOptions = countries.length ? countries : [{ country: "IN", label: "India" }];
  const mailUnconfigured =
    done?.mail?.mode && done.mail.mode !== "smtp" && done.mail.mode !== "ses";

  if (done) {
    return (
      <AuthShell
        title="Check your email"
        headline="One click away from your new workspace."
        points={[
          "Verify your address to activate the organisation",
          "You become the workspace admin",
          "Invite your team straight after",
        ]}
        footer={
          <p className="text-center text-[15px] text-muted-foreground">
            <Link href="/login" className="font-semibold text-primary hover:underline">
              Back to sign in
            </Link>
          </p>
        }
      >
        <div className="space-y-6">
          <div className="flex items-start gap-4 rounded-[16px] border border-border bg-card p-5 shadow-[var(--elev-1)]">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <MailCheck className="size-5" />
            </span>
            <p className="text-[16px] leading-[23px] text-muted-foreground">
              We&apos;ve sent a verification link to{" "}
              <strong className="font-semibold text-foreground">{done.mail?.to || email}</strong>.
              Open it to activate{" "}
              <strong className="font-semibold text-foreground">{companyName}</strong> and sign in
              as its admin.
            </p>
          </div>

          {mailUnconfigured && (
            <div className="flex items-start gap-3 rounded-[14px] bg-[var(--warn-bg)] p-4 text-[var(--warn)]">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <p className="text-[14px] leading-[20px]">
                Email delivery isn&apos;t configured on this environment ({done.mail?.mode} mode).
                Ask an administrator for the verification link, or configure SMTP/SES.
              </p>
            </div>
          )}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      wide
      title="Create your workspace"
      subtitle={`Set your company up on ${productName()}. It takes about a minute.`}
      headline="Your company, running on one system."
      points={[
        "Create the workspace, you're the admin",
        "Import your whole team from a single sheet",
        "Attendance, leave, payroll and documents built in",
      ]}
      footer={
        <p className="text-center text-[15px] text-muted-foreground">
          Already have a workspace?{" "}
          <Link href="/login" className="font-semibold text-primary hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-6">
        <Field label="Company name" htmlFor="companyName">
          <Input
            id="companyName"
            required
            placeholder="Acme Technologies Pvt Ltd"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </Field>

        <FormGrid columns={2}>
          <Field label="Your name" htmlFor="adminName">
            <Input
              id="adminName"
              required
              autoComplete="name"
              placeholder="Jane Doe"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
            />
          </Field>
          <Field label="Country" htmlFor="country">
            <Select value={country} onValueChange={(v) => setCountry(String(v))}>
              <SelectTrigger id="country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {countryOptions.map((c) => (
                  <SelectItem key={c.country} value={c.country}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FormGrid>

        <Field label="Work email" htmlFor="email">
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field
          label={
            <>
              Phone <span className="font-normal text-muted-foreground">(optional)</span>
            </>
          }
          htmlFor="phone"
        >
          <PhoneField
            id="phone"
            dialCode={dialCode}
            number={phone}
            onDialCodeChange={setDialCode}
            onNumberChange={setPhone}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          hint="At least 8 characters, using two of: lowercase, uppercase, number, symbol."
        >
          <PasswordInput
            id="password"
            required
            autoComplete="new-password"
            placeholder="Create a strong password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} Create workspace
        </Button>

        <p className="text-[14px] leading-[20px] text-muted-foreground">
          You&apos;ll become the workspace admin and can invite your team once your email is
          verified.
        </p>
      </form>
    </AuthShell>
  );
}
