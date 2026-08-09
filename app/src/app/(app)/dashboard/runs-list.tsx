"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  MoreHorizontal,
  RefreshCw,
  PenSquare,
  Eye,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatDateTime, formatPct } from "@/lib/utils";
import { RunDetailSheet } from "@/components/run-detail-sheet";
import { OverrideDialog, type Decision } from "@/components/override-dialog";

type RunSummary = {
  runId: string;
  filename: string;
  uploadedAt: string | null;
  status: string;
  finalDecision: Decision | null;
  pass1Decision: string | null;
  reason: string | null;
  amountDelta: string | null;
  amountDeltaPct: string | null;
  vendorMatchScore: string | null;
  currencyOk: boolean | null;
  duplicateOf: string | null;
  duplicateConfidence: string | null;
  matchedPoId: string | null;
  extractedJson: Record<string, unknown> | null;
};

const FILTERS = [
  { key: "ALL", label: "All" },
  { key: "APPROVED", label: "Approved" },
  { key: "FLAGGED_FOR_REVIEW", label: "Flagged" },
  { key: "REJECTED", label: "Rejected" },
  { key: "DUPLICATE", label: "Duplicate" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

function decisionBadge(d: Decision | null | undefined): React.ReactNode {
  if (!d) return <Badge variant="secondary">pending</Badge>;
  if (d === "APPROVED")
    return <Badge variant="approved">APPROVED</Badge>;
  if (d === "FLAGGED_FOR_REVIEW")
    return <Badge variant="flagged">FLAGGED</Badge>;
  if (d === "REJECTED")
    return <Badge variant="rejected">REJECTED</Badge>;
  return <Badge variant="duplicate">DUPLICATE</Badge>;
}

export function RunsList() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [loading, setLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRunId, setDetailRunId] = useState<string | null>(null);
  const [overrideRunId, setOverrideRunId] = useState<string | null>(null);
  const [overrideCurrent, setOverrideCurrent] =
    useState<Decision>("FLAGGED_FOR_REVIEW");
  const [overrideOpen, setOverrideOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/runs", { cache: "no-store" });
      if (!res.ok) {
        toast.error("Failed to load runs");
        return;
      }
      const data = (await res.json()) as { runs: RunSummary[] };
      setRuns(data.runs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "ALL") return runs;
    return runs.filter((r) => r.finalDecision === filter);
  }, [runs, filter]);

  function openDetail(runId: string): void {
    setDetailRunId(runId);
    setDetailOpen(true);
  }

  function openOverride(runId: string, current: Decision): void {
    setOverrideRunId(runId);
    setOverrideCurrent(current);
    setOverrideOpen(true);
  }

  async function handleRerun(runId: string): Promise<void> {
    try {
      const res = await fetch(`/api/runs/${runId}/rerun`, {
        method: "POST",
        cache: "no-store",
      });
      if (!res.ok) {
        toast.error("Rerun failed");
        return;
      }
      toast.success("Rerun started");
      setTimeout(() => void load(), 2500);
    } catch (err) {
      toast.error("Rerun failed", { description: (err as Error).message });
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Invoice runs</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Every invoice processed by the pipeline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => {
              window.location.href = "/api/export";
            }}
          >
            <Download className="h-4 w-4" />
            Export Excel
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium transition-colors",
              filter === f.key
                ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                : "bg-transparent text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Filename</TableHead>
              <TableHead>Uploaded</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>PO #</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Amount Δ</TableHead>
              <TableHead>Vendor match</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && runs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center text-sm text-[var(--muted-foreground)]"
                >
                  Loading...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center text-sm text-[var(--muted-foreground)]"
                >
                  No runs match this filter.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => {
                const json = r.extractedJson ?? {};
                const poNumber =
                  typeof json.po_number === "string"
                    ? (json.po_number as string)
                    : "";
                const currency =
                  typeof json.currency === "string"
                    ? (json.currency as string)
                    : "";
                const vendorPct =
                  r.vendorMatchScore !== null
                    ? `${(Number(r.vendorMatchScore) * 100).toFixed(1)}%`
                    : "";
                return (
                  <TableRow
                    key={r.runId}
                    className="cursor-pointer"
                    onClick={() => openDetail(r.runId)}
                  >
                    <TableCell className="max-w-[240px]">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(`/api/runs/${r.runId}/pdf`, "_blank");
                        }}
                        className="inline-flex max-w-full items-center gap-1 truncate text-left text-sm text-[var(--foreground)] hover:underline"
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">{r.filename}</span>
                      </button>
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDateTime(r.uploadedAt)}
                    </TableCell>
                    <TableCell>{decisionBadge(r.finalDecision)}</TableCell>
                    <TableCell
                      className="max-w-[280px] truncate text-xs"
                      title={r.reason ?? ""}
                    >
                      {r.reason ?? ""}
                    </TableCell>
                    <TableCell className="text-xs">{poNumber}</TableCell>
                    <TableCell className="text-xs">{currency}</TableCell>
                    <TableCell className="text-xs">
                      {formatPct(r.amountDeltaPct)}
                    </TableCell>
                    <TableCell className="text-xs">{vendorPct}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => openDetail(r.runId)}
                          >
                            <Eye className="h-4 w-4" />
                            View details
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => void handleRerun(r.runId)}
                          >
                            <RefreshCw className="h-4 w-4" />
                            Rerun
                          </DropdownMenuItem>
                          {r.finalDecision && (
                            <DropdownMenuItem
                              onClick={() =>
                                openOverride(r.runId, r.finalDecision as Decision)
                              }
                            >
                              <PenSquare className="h-4 w-4" />
                              Override
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <RunDetailSheet
        runId={detailRunId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onMutate={() => void load()}
      />

      {overrideRunId && (
        <OverrideDialog
          open={overrideOpen}
          onOpenChange={setOverrideOpen}
          runId={overrideRunId}
          currentDecision={overrideCurrent}
          onSuccess={() => void load()}
        />
      )}
    </>
  );
}
