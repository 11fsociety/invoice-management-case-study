"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, RefreshCw, PenSquare } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  DecisionExplanation,
  type DecisionRow,
} from "@/components/decision-explanation";
import { OverrideDialog, type Decision } from "@/components/override-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type RunDetail = {
  run: {
    id: string;
    filename: string;
    uploadedAt: string | null;
    status: string;
    extractionMode: string | null;
    storagePath: string;
  };
  extraction: {
    runId: string;
    extractedJson: Record<string, unknown>;
    lineItems: unknown;
    providerUsed: string | null;
    modelUsed: string | null;
    tokensIn: number | null;
    tokensOut: number | null;
    latencyMs: number | null;
  } | null;
  decision: DecisionRow | null;
  matchedPo: {
    poNumber: string;
    poDate: string;
    vendorName: string;
    vendorId: string | null;
    poAmount: string;
    currency: string | null;
  } | null;
};

type AuditEntry = {
  id: string;
  fromDecision: string | null;
  toDecision: string | null;
  reason: string;
  at: string | null;
  actorEmail: string | null;
};

type LineItem = {
  description?: string;
  quantity?: number | string;
  unit_price?: number | string;
  total?: number | string;
};

function isLineItem(v: unknown): v is LineItem {
  return typeof v === "object" && v !== null;
}

type Props = {
  runId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutate?: () => void;
};

export function RunDetailSheet({ runId, open, onOpenChange, onMutate }: Props) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [poRow, setPoRow] = useState<RunDetail["matchedPo"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);

  const load = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    try {
      const [runRes, auditRes] = await Promise.all([
        fetch(`/api/runs/${runId}`, { cache: "no-store" }),
        fetch(`/api/runs/${runId}/audit`, { cache: "no-store" }),
      ]);
      if (!runRes.ok) {
        toast.error("Could not load run");
        return;
      }
      const runData = (await runRes.json()) as {
        run: RunDetail["run"];
        extraction: RunDetail["extraction"];
        decision: DecisionRow | null;
        audit: unknown;
      };
      let matchedPo: RunDetail["matchedPo"] | null = null;
      if (runData.decision?.matchedPoId) {
        // The API returns matchedPoId; we don't have a PO detail endpoint,
        // so surface the fields carried on the extraction if present.
        const j = runData.extraction?.extractedJson ?? {};
        matchedPo = {
          poNumber:
            typeof j.po_number === "string"
              ? (j.po_number as string)
              : "",
          poDate: "",
          vendorName:
            typeof j.vendor_name === "string"
              ? (j.vendor_name as string)
              : "",
          vendorId:
            typeof j.vendor_id === "string" ? (j.vendor_id as string) : null,
          poAmount: "",
          currency:
            typeof j.currency === "string" ? (j.currency as string) : null,
        };
      }
      setDetail({
        run: runData.run,
        extraction: runData.extraction,
        decision: runData.decision,
        matchedPo,
      });
      setPoRow(matchedPo);

      if (auditRes.ok) {
        const auditData = (await auditRes.json()) as { audit: AuditEntry[] };
        setAudit(auditData.audit);
      } else {
        setAudit([]);
      }
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (open && runId) {
      void load();
    } else {
      setDetail(null);
      setAudit([]);
      setPoRow(null);
    }
  }, [open, runId, load]);

  async function handleRerun(): Promise<void> {
    if (!runId) return;
    try {
      const res = await fetch(`/api/runs/${runId}/rerun`, {
        method: "POST",
        cache: "no-store",
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        toast.error("Rerun failed", {
          description:
            typeof detail === "object" && detail && "error" in detail
              ? String((detail as { error: string }).error)
              : `HTTP ${res.status}`,
        });
        return;
      }
      toast.success("Rerun started");
      onMutate?.();
      // Reload once the pipeline has had a moment.
      setTimeout(() => {
        void load();
      }, 2000);
    } catch (err) {
      toast.error("Rerun failed", {
        description: (err as Error).message,
      });
    }
  }

  async function handleCopyJson(): Promise<void> {
    if (!detail?.extraction) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(detail.extraction.extractedJson, null, 2)
      );
      toast.success("Copied to clipboard");
    } catch (err) {
      toast.error("Copy failed", { description: (err as Error).message });
    }
  }

  const lineItems: LineItem[] = Array.isArray(detail?.extraction?.lineItems)
    ? (detail!.extraction!.lineItems as unknown[]).filter(isLineItem)
    : [];

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>
              {detail?.run.filename ?? "Run details"}
            </SheetTitle>
            <SheetDescription>
              {detail?.run.uploadedAt
                ? `Uploaded ${formatDateTime(detail.run.uploadedAt)}`
                : ""}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-6">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (runId)
                    window.open(`/api/runs/${runId}/pdf`, "_blank");
                }}
                disabled={!runId}
              >
                <ExternalLink className="h-4 w-4" />
                Open PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRerun}
                disabled={!runId}
              >
                <RefreshCw className="h-4 w-4" />
                Rerun
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOverrideOpen(true)}
                disabled={!detail?.decision}
              >
                <PenSquare className="h-4 w-4" />
                Override
              </Button>
            </div>

            {loading && !detail ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                Loading...
              </p>
            ) : detail?.decision ? (
              <DecisionExplanation
                decision={detail.decision}
                matchedPoNumber={poRow?.poNumber ?? null}
              />
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">
                No decision yet - the pipeline may still be running.
              </p>
            )}

            {detail?.extraction && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Extracted JSON</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyJson}
                  >
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                </div>
                <pre className="max-h-64 overflow-auto rounded-md bg-[var(--muted)] p-3 text-xs">
                  {JSON.stringify(detail.extraction.extractedJson, null, 2)}
                </pre>
                <div className="text-xs text-[var(--muted-foreground)]">
                  Provider: {detail.extraction.providerUsed} /{" "}
                  {detail.extraction.modelUsed} - Tokens in{" "}
                  {detail.extraction.tokensIn ?? "?"} / out{" "}
                  {detail.extraction.tokensOut ?? "?"} - Latency{" "}
                  {detail.extraction.latencyMs ?? "?"}ms - Mode{" "}
                  {detail.run.extractionMode ?? "?"}
                </div>
              </div>
            )}

            {lineItems.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Line items</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lineItems.map((li, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{String(li.description ?? "")}</TableCell>
                        <TableCell className="text-right">
                          {li.quantity !== undefined
                            ? String(li.quantity)
                            : ""}
                        </TableCell>
                        <TableCell className="text-right">
                          {li.unit_price !== undefined
                            ? String(li.unit_price)
                            : ""}
                        </TableCell>
                        <TableCell className="text-right">
                          {li.total !== undefined ? String(li.total) : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {poRow && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Matched PO</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div>
                    <span className="text-[var(--muted-foreground)]">
                      PO number:
                    </span>{" "}
                    {poRow.poNumber || "-"}
                  </div>
                  <div>
                    <span className="text-[var(--muted-foreground)]">
                      Vendor:
                    </span>{" "}
                    {poRow.vendorName || "-"}
                    {poRow.vendorId ? ` (${poRow.vendorId})` : ""}
                  </div>
                  <div>
                    <span className="text-[var(--muted-foreground)]">
                      Amount:
                    </span>{" "}
                    {poRow.poAmount
                      ? formatCurrency(poRow.poAmount, poRow.currency)
                      : "-"}
                  </div>
                  <div>
                    <span className="text-[var(--muted-foreground)]">
                      PO date:
                    </span>{" "}
                    {poRow.poDate ? formatDate(poRow.poDate) : "-"}
                  </div>
                </CardContent>
              </Card>
            )}

            <Separator />

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Audit log</h3>
              {audit.length === 0 ? (
                <p className="text-xs text-[var(--muted-foreground)]">
                  No overrides recorded.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>{formatDateTime(a.at)}</TableCell>
                        <TableCell>{a.actorEmail ?? "-"}</TableCell>
                        <TableCell>{a.fromDecision ?? "-"}</TableCell>
                        <TableCell>{a.toDecision ?? "-"}</TableCell>
                        <TableCell>{a.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {detail?.decision && runId && (
        <OverrideDialog
          open={overrideOpen}
          onOpenChange={setOverrideOpen}
          runId={runId}
          currentDecision={detail.decision.finalDecision as Decision}
          onSuccess={() => {
            void load();
            onMutate?.();
          }}
        />
      )}
    </>
  );
}
