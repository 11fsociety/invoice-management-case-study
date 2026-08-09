"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type LoginFormValues = {
  email: string;
  password: string;
};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginFormValues): Promise<void> {
    setSubmitting(true);
    try {
      const supabase = createBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });
      if (error) {
        toast.error("Sign-in failed", { description: error.message });
        return;
      }
      const res = await fetch("/api/auth/whoami", { cache: "no-store" });
      if (!res.ok) {
        toast.error("Could not load profile");
        return;
      }
      const profile = (await res.json()) as {
        id: string;
        email: string | null;
        role: string | null;
      };
      const isSafeNext =
        typeof next === "string" &&
        next.startsWith("/") &&
        !next.startsWith("//") &&
        !next.startsWith("/\\");
      const target = isSafeNext
        ? next
        : profile.role === "admin"
          ? "/admin"
          : "/dashboard";
      router.replace(target);
      router.refresh();
    } catch (err) {
      toast.error("Sign-in failed", {
        description: (err as Error).message,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-2 text-center">
        <CardTitle className="text-2xl">Zamp Invoice Ops</CardTitle>
        <CardDescription>Sign in to continue</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              {...register("email", {
                required: "Email is required",
              })}
            />
            {errors.email && (
              <p className="text-xs text-[var(--destructive)]">
                {errors.email.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register("password", {
                required: "Password is required",
              })}
            />
            {errors.password && (
              <p className="text-xs text-[var(--destructive)]">
                {errors.password.message}
              </p>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              "Sign in"
            )}
          </Button>
          {process.env.NODE_ENV !== "production" && (
            <p className="text-center text-xs text-[var(--muted-foreground)]">
              Demo credentials: admin123@gmail.com / admin123 &nbsp;|&nbsp;
              auditor123@gmail.com / auditor123
            </p>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
