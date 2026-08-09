"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

type Provider = {
  id: string;
  provider: string;
  modelId: string;
  region: string | null;
  isActive: boolean | null;
  connectionOk: boolean | null;
  lastChecked: string | null;
};

export function ModelTab() {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/providers", { cache: "no-store" });
      if (!res.ok) {
        toast.error("Failed to load provider");
        return;
      }
      const data = (await res.json()) as { provider: Provider | null };
      setProvider(data.provider);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onTest(): Promise<void> {
    setTesting(true);
    try {
      const res = await fetch("/api/providers/test", {
        method: "POST",
        cache: "no-store",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        detail?: string;
        error?: string;
      };
      if (!res.ok) {
        toast.error("Test failed", {
          description: data.error ?? `HTTP ${res.status}`,
        });
      } else if (data.ok) {
        toast.success("Connection OK", {
          description: data.detail?.slice(0, 100) ?? "",
        });
      } else {
        toast.error("Connection failed", {
          description: data.detail ?? "unknown error",
        });
      }
      await load();
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model</CardTitle>
        <p className="text-sm text-[var(--muted-foreground)]">
          Active provider used by the extraction pipeline.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !provider ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading...</p>
        ) : !provider ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No active provider configured.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-[var(--muted-foreground)]">Provider</div>
                <div className="font-medium">{provider.provider}</div>
              </div>
              <div>
                <div className="text-[var(--muted-foreground)]">Model ID</div>
                <div className="font-mono text-xs">{provider.modelId}</div>
              </div>
              <div>
                <div className="text-[var(--muted-foreground)]">Region</div>
                <div className="font-medium">{provider.region ?? "-"}</div>
              </div>
              <div>
                <div className="text-[var(--muted-foreground)]">
                  Connection status
                </div>
                <div className="font-medium">
                  {provider.connectionOk === true ? (
                    <Badge variant="approved">OK</Badge>
                  ) : provider.connectionOk === false ? (
                    <Badge variant="rejected">FAIL</Badge>
                  ) : (
                    <Badge variant="secondary">unknown</Badge>
                  )}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-[var(--muted-foreground)]">
                  Last checked
                </div>
                <div className="font-medium">
                  {provider.lastChecked
                    ? formatDateTime(provider.lastChecked)
                    : "never"}
                </div>
              </div>
            </div>
            <Button onClick={onTest} disabled={testing}>
              <Zap className="h-4 w-4" />
              {testing ? "Testing..." : "Test connection"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
