"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Upload, Settings, LogOut, Download, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { createBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Props = {
  email: string;
  role: "admin" | "auditor";
  children: React.ReactNode;
};

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

export function AppShell({ email, role, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  const navItems: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/dashboard/upload", label: "Upload", icon: Upload },
    { href: "/analytics", label: "Analytics", icon: BarChart3 },
  ];
  if (role === "admin") {
    navItems.push({ href: "/admin", label: "Admin", icon: Settings });
  }

  async function handleSignOut(): Promise<void> {
    try {
      const supabase = createBrowserClient();
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } catch (err) {
      toast.error("Sign-out failed", {
        description: (err as Error).message,
      });
    }
  }

  function handleExport(): void {
    window.location.href = "/api/export";
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-[var(--border)] bg-[var(--muted)]/40">
        <div className="border-b border-[var(--border)] px-6 py-4">
          <div className="text-sm font-semibold">Invoice Ops</div>
          <div className="text-xs text-[var(--muted-foreground)]">v0.2</div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/dashboard"
                ? pathname === item.href
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
          {role === "admin" && (
            <button
              type="button"
              onClick={handleExport}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
          )}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-3">
          <div className="text-sm font-semibold">Invoice Ops</div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[var(--muted-foreground)]">{email}</span>
              <Badge variant={role === "admin" ? "default" : "secondary"}>
                {role}
              </Badge>
            </div>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
