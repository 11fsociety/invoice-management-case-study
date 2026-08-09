"use client";

import { CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { cn, formatPct } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type DecisionRow = {
  finalDecision: "APPROVED" | "FLAGGED_FOR_REVIEW" | "REJECTED" | "DUPLICATE";
  pass1Decision: "APPROVED" | "FLAGGED_FOR_REVIEW" | "REJECTED";
  reason: string | null;
  amountDeltaPct: string | number | null;
  amountDelta: string | number | null;
  vendorMatchScore: string | number | null;
  currencyOk: boolean | null;
  dateDeltaDays: number | null;
  matchedPoId: string | null;
  duplicateOf: string | null;
  duplicateConfidence: string | number | null;
};

type CheckStatus = "PASS" | "FAIL" | "N/A";

function iconFor(status: CheckStatus): React.ReactNode {
  if (status === "PASS")
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "FAIL")
    return <XCircle className="h-4 w-4 text-red-500" />;
  return <MinusCircle className="h-4 w-4 text-[var(--muted-foreground)]" />;
}

function headerVariant(
  decision: DecisionRow["finalDecision"]
): "approved" | "flagged" | "rejected" | "duplicate" {
  if (decision === "APPROVED") return "approved";
  if (decision === "FLAGGED_FOR_REVIEW") return "flagged";
  if (decision === "REJECTED") return "rejected";
  return "duplicate";
}

function headerLabel(
  decision: DecisionRow["finalDecision"]
): string {
  if (decision === "FLAGGED_FOR_REVIEW") return "FLAGGED FOR REVIEW";
  return decision;
}

function decideCheckStatuses(d: DecisionRow): {
  poFound: CheckStatus;
  vendor: CheckStatus;
  currency: CheckStatus;
  invoiceDate: CheckStatus;
  amountTolerance: CheckStatus;
  duplicateSweep: CheckStatus;
} {
  const isRejected = d.pass1Decision === "REJECTED";
  const isFlagged = d.pass1Decision === "FLAGGED_FOR_REVIEW";
  const reason = (d.reason ?? "").toLowerCase();

  if (isRejected) {
    // PRD section 12: show ONLY the failing check + FAIL. No trailing N/A rows.
    const poFail =
      reason.includes("no matching po") ||
      reason.includes("no po reference") ||
      reason.includes("unparseable");
    return {
      poFound: poFail ? "FAIL" : "N/A",
      vendor: "N/A",
      currency: "N/A",
      invoiceDate: "N/A",
      amountTolerance: "N/A",
      duplicateSweep: "N/A",
    };
  }

  if (isFlagged) {
    const invoiceDate: CheckStatus = reason.includes("predates") ? "FAIL" : "PASS";
    const vendor: CheckStatus = reason.includes("vendor mismatch") ? "FAIL" : "PASS";
    const currency: CheckStatus = reason.includes("currency mismatch") ? "FAIL" : "PASS";
    const amountTolerance: CheckStatus = reason.includes("outside tolerance")
      ? "FAIL"
      : reason.includes("missing")
        ? "FAIL"
        : "PASS";
    return {
      poFound: "PASS",
      vendor,
      currency,
      invoiceDate,
      amountTolerance,
      duplicateSweep: "N/A",
    };
  }

  // APPROVED (pass1) or DUPLICATE (final)
  return {
    poFound: "PASS",
    vendor: "PASS",
    currency: "PASS",
    invoiceDate: "PASS",
    amountTolerance: "PASS",
    duplicateSweep: d.finalDecision === "DUPLICATE" ? "FAIL" : "PASS",
  };
}

export function DecisionExplanation({
  decision,
  matchedPoNumber,
  duplicateOfFilename,
}: {
  decision: DecisionRow;
  matchedPoNumber?: string | null;
  duplicateOfFilename?: string | null;
}) {
  const variant = headerVariant(decision.finalDecision);
  const checks = decideCheckStatuses(decision);
  const isRejected = decision.pass1Decision === "REJECTED";
  const deltaPct =
    decision.amountDeltaPct !== null && decision.amountDeltaPct !== undefined
      ? Number(decision.amountDeltaPct)
      : null;
  const absPct = deltaPct !== null ? Math.abs(deltaPct) : null;
  const dupConf =
    decision.duplicateConfidence !== null &&
    decision.duplicateConfidence !== undefined
      ? Number(decision.duplicateConfidence)
      : null;

  return (
    <div className="space-y-4 rounded-lg border border-[var(--border)]">
      <div
        className={cn(
          "flex items-center justify-between rounded-t-lg px-4 py-3",
          variant === "approved" && "bg-emerald-500/10",
          variant === "flagged" && "bg-amber-500/10",
          variant === "rejected" && "bg-red-500/10",
          variant === "duplicate" && "bg-purple-500/10"
        )}
      >
        <div className="text-sm font-semibold">Decision</div>
        <Badge variant={variant}>{headerLabel(decision.finalDecision)}</Badge>
      </div>

      <div className="space-y-2 px-4 pb-4">
        {decision.finalDecision === "DUPLICATE" && (
          <div className="mb-2 rounded-md bg-[var(--muted)] p-3 text-sm">
            <div>Pass 1: APPROVED</div>
            <div>
              Duplicate sweep: FAIL
              {dupConf !== null && ` (confidence ${dupConf.toFixed(2)})`}
            </div>
            {duplicateOfFilename && (
              <div className="text-xs text-[var(--muted-foreground)]">
                Matches earlier approved run: {duplicateOfFilename}
              </div>
            )}
          </div>
        )}

        <div className="text-sm font-semibold">Checks</div>
        <ul className="space-y-1 text-sm">
          {(!isRejected || checks.poFound === "FAIL") && (
            <li className="flex items-center gap-2">
              {iconFor(checks.poFound)}
              <span>PO found: {checks.poFound}</span>
            </li>
          )}
          {(!isRejected || checks.vendor === "FAIL") && (
            <li className="flex items-center gap-2">
              {iconFor(checks.vendor)}
              <span>
                Vendor: {checks.vendor}
                {decision.vendorMatchScore !== null &&
                decision.vendorMatchScore !== undefined
                  ? ` (score ${Number(decision.vendorMatchScore).toFixed(3)})`
                  : ""}
              </span>
            </li>
          )}
          {(!isRejected || checks.currency === "FAIL") && (
            <li className="flex items-center gap-2">
              {iconFor(checks.currency)}
              <span>Currency: {checks.currency}</span>
            </li>
          )}
          {(!isRejected || checks.invoiceDate === "FAIL") && (
            <li className="flex items-center gap-2">
              {iconFor(checks.invoiceDate)}
              <span>
                Invoice date: {checks.invoiceDate}
                {decision.dateDeltaDays !== null &&
                decision.dateDeltaDays !== undefined
                  ? ` (${decision.dateDeltaDays}d)`
                  : ""}
              </span>
            </li>
          )}
          {(!isRejected || checks.amountTolerance === "FAIL") && (
            <li className="flex items-center gap-2">
              {iconFor(checks.amountTolerance)}
              <span>
                Amount tolerance: {checks.amountTolerance}
                {absPct !== null ? ` (${formatPct(deltaPct)})` : ""}
              </span>
            </li>
          )}
          {(!isRejected || checks.duplicateSweep === "FAIL") && (
            <li className="flex items-center gap-2">
              {iconFor(checks.duplicateSweep)}
              <span>
                Duplicate sweep: {checks.duplicateSweep}
                {dupConf !== null && decision.finalDecision === "DUPLICATE"
                  ? ` (${dupConf.toFixed(2)})`
                  : ""}
              </span>
            </li>
          )}
        </ul>

        {decision.reason && (
          <div className="pt-2">
            <div className="text-sm font-semibold">Reason</div>
            <p className="text-sm text-[var(--muted-foreground)]">
              &quot;{decision.reason}&quot;
            </p>
          </div>
        )}
        {matchedPoNumber && (
          <div className="pt-1 text-xs text-[var(--muted-foreground)]">
            Matched PO: {matchedPoNumber}
          </div>
        )}
      </div>
    </div>
  );
}
