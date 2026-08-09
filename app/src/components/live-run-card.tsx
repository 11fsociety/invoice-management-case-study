"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type StageStatus = "pending" | "running" | "done" | "failed";

export type StageKey =
  | "upload"
  | "validation"
  | "text_or_vision"
  | "llm"
  | "po_matching"
  | "date_check"
  | "vendor_check"
  | "currency_check"
  | "amount_check"
  | "pass1"
  | "pass2"
  | "final";

const STAGE_ORDER: { key: StageKey; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "validation", label: "File validation" },
  { key: "text_or_vision", label: "Text extraction / Vision fallback" },
  { key: "llm", label: "LLM extraction (Bedrock Claude Opus 4.7)" },
  { key: "po_matching", label: "PO matching" },
  { key: "date_check", label: "Date check" },
  { key: "vendor_check", label: "Vendor check" },
  { key: "currency_check", label: "Currency check" },
  { key: "amount_check", label: "Amount / tolerance check" },
  { key: "pass1", label: "Pass 1 decision" },
  { key: "pass2", label: "Duplicate sweep" },
  { key: "final", label: "Final decision" },
];

type FinalDecision =
  | "APPROVED"
  | "FLAGGED_FOR_REVIEW"
  | "REJECTED"
  | "DUPLICATE"
  | null;

type SSEEnvelope = {
  reason?: string;
  decision?: string;
};

function stageIcon(status: StageStatus): React.ReactNode {
  if (status === "done")
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "failed")
    return <XCircle className="h-4 w-4 text-red-500" />;
  if (status === "running")
    return <Loader2 className="h-4 w-4 animate-spin text-[var(--foreground)]" />;
  return <Circle className="h-4 w-4 text-[var(--muted-foreground)]" />;
}

function initialStages(): Record<StageKey, StageStatus> {
  const map = {} as Record<StageKey, StageStatus>;
  for (const { key } of STAGE_ORDER) map[key] = "pending";
  return map;
}

function decisionBadgeVariant(
  d: NonNullable<FinalDecision>
): "approved" | "flagged" | "rejected" | "duplicate" {
  if (d === "APPROVED") return "approved";
  if (d === "FLAGGED_FOR_REVIEW") return "flagged";
  if (d === "REJECTED") return "rejected";
  return "duplicate";
}

export function LiveRunCard({
  runId,
  filename,
  initialStage,
  onFinal,
}: {
  runId: string;
  filename: string;
  initialStage?: StageKey;
  onFinal?: (decision: NonNullable<FinalDecision>) => void;
}) {
  const [stages, setStages] = useState<Record<StageKey, StageStatus>>(() => {
    const s = initialStages();
    // Upload is already done before this card mounts.
    s.upload = "done";
    if (initialStage) s[initialStage] = "running";
    return s;
  });
  const [finalDecision, setFinalDecision] = useState<FinalDecision>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const es = new EventSource(`/api/runs/${runId}/events`);

    function updateStage(key: StageKey, status: StageStatus): void {
      setStages((prev) => {
        if (prev[key] === "done" || prev[key] === "failed") return prev;
        return { ...prev, [key]: status };
      });
    }

    function advanceThrough(...keys: StageKey[]): void {
      setStages((prev) => {
        const next = { ...prev };
        for (const k of keys) {
          if (next[k] === "pending" || next[k] === "running") next[k] = "done";
        }
        return next;
      });
    }

    function markRemainingFailed(): void {
      setStages((prev) => {
        const next = { ...prev };
        for (const { key } of STAGE_ORDER) {
          if (next[key] === "pending" || next[key] === "running") {
            next[key] = "failed";
          }
        }
        return next;
      });
    }

    function safeParse(data: string): SSEEnvelope {
      try {
        return JSON.parse(data) as SSEEnvelope;
      } catch {
        return {};
      }
    }

    es.addEventListener("ready", () => {
      updateStage("validation", "done");
      updateStage("text_or_vision", "running");
    });
    es.addEventListener("extraction_started", () => {
      updateStage("validation", "done");
      updateStage("text_or_vision", "running");
    });
    es.addEventListener("text_extracted", () => {
      advanceThrough("text_or_vision");
      updateStage("llm", "running");
    });
    es.addEventListener("vision_started", () => {
      updateStage("text_or_vision", "running");
    });
    es.addEventListener("text_error", () => {
      updateStage("text_or_vision", "running");
    });
    es.addEventListener("llm_called", () => {
      advanceThrough("text_or_vision");
      updateStage("llm", "running");
    });
    es.addEventListener("llm_returned", () => {
      advanceThrough("llm");
    });
    es.addEventListener("persisted", () => {
      advanceThrough("llm");
    });
    es.addEventListener("matching_started", () => {
      advanceThrough("llm");
      updateStage("po_matching", "running");
    });
    es.addEventListener("decision", (event: MessageEvent) => {
      const payload = safeParse(event.data);
      const dec = payload.decision ?? null;
      const reason = (payload.reason ?? "").toLowerCase();

      // Deterministically walk the check stages based on decision + reason.
      advanceThrough("po_matching");

      if (dec === "REJECTED" && (
        reason.includes("no matching po") ||
        reason.includes("no po reference")
      )) {
        setStages((prev) => ({ ...prev, po_matching: "failed" }));
      } else {
        advanceThrough("po_matching", "date_check", "vendor_check", "currency_check", "amount_check");
        if (dec === "FLAGGED_FOR_REVIEW") {
          if (reason.includes("predates")) {
            setStages((prev) => ({ ...prev, date_check: "failed" }));
          } else if (reason.includes("vendor mismatch")) {
            setStages((prev) => ({ ...prev, vendor_check: "failed" }));
          } else if (reason.includes("currency mismatch")) {
            setStages((prev) => ({ ...prev, currency_check: "failed" }));
          } else if (reason.includes("outside tolerance") || reason.includes("missing")) {
            setStages((prev) => ({ ...prev, amount_check: "failed" }));
          }
        }
      }

      setStages((prev) => ({
        ...prev,
        pass1: dec === "REJECTED" || dec === "FLAGGED_FOR_REVIEW" || dec === "APPROVED"
          ? "done"
          : prev.pass1,
      }));

      if (dec === "APPROVED") {
        setStages((prev) => ({ ...prev, pass2: "running" }));
      } else {
        // No dedup sweep for non-approved.
        setStages((prev) => ({ ...prev, pass2: "done", final: "done" }));
        setFinalDecision(dec as FinalDecision);
        if (dec === "APPROVED" || dec === "FLAGGED_FOR_REVIEW" || dec === "REJECTED") {
          onFinal?.(dec);
        }
      }
    });
    es.addEventListener("pass2_complete", (event: MessageEvent) => {
      const payload = safeParse(event.data);
      advanceThrough("pass2");
      const dec = payload.decision ?? null;
      if (dec) {
        setStages((prev) => ({ ...prev, final: "done" }));
        setFinalDecision(dec as FinalDecision);
        if (
          dec === "APPROVED" ||
          dec === "FLAGGED_FOR_REVIEW" ||
          dec === "REJECTED" ||
          dec === "DUPLICATE"
        ) {
          onFinal?.(dec);
        }
      } else {
        // Assume approved unchanged
        setStages((prev) => ({ ...prev, final: "done" }));
        setFinalDecision("APPROVED");
        onFinal?.("APPROVED");
      }
    });
    es.addEventListener("extraction_failed", (event: MessageEvent) => {
      const payload = safeParse(event.data);
      setErrorMsg(payload.reason ?? "extraction failed");
      markRemainingFailed();
      setFinalDecision("REJECTED");
      onFinal?.("REJECTED");
    });

    es.onerror = () => {
      // Best-effort: let the browser retry, keep the current UI.
    };

    return () => {
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Poll /api/runs/[id] once the stream may have closed, to catch a race
  // where the decision landed before the client subscribed.
  useEffect(() => {
    if (finalDecision !== null) return;
    let cancelled = false;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          decision?: { finalDecision?: string } | null;
        };
        const d = data.decision?.finalDecision ?? null;
        if (
          !cancelled &&
          d &&
          (d === "APPROVED" ||
            d === "FLAGGED_FOR_REVIEW" ||
            d === "REJECTED" ||
            d === "DUPLICATE")
        ) {
          setFinalDecision(d);
          onFinal?.(d);
          setStages((prev) => {
            const next = { ...prev };
            for (const { key } of STAGE_ORDER) {
              if (next[key] === "pending" || next[key] === "running") {
                next[key] = "done";
              }
            }
            return next;
          });
        }
      } catch {
        // ignore
      }
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [finalDecision, runId, onFinal]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="truncate text-sm">{filename}</CardTitle>
        {finalDecision ? (
          <Badge variant={decisionBadgeVariant(finalDecision)}>
            {finalDecision === "FLAGGED_FOR_REVIEW"
              ? "FLAGGED"
              : finalDecision}
          </Badge>
        ) : (
          <Badge variant="secondary">Running</Badge>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <ol className="space-y-2 text-sm">
          {STAGE_ORDER.map(({ key, label }) => (
            <li
              key={key}
              className={cn(
                "flex items-center gap-2",
                stages[key] === "pending" && "text-[var(--muted-foreground)]",
                stages[key] === "failed" && "text-red-500"
              )}
            >
              {stageIcon(stages[key])}
              <span>{label}</span>
            </li>
          ))}
        </ol>
        {errorMsg && (
          <p className="mt-3 text-xs text-red-500">{errorMsg}</p>
        )}
      </CardContent>
    </Card>
  );
}
