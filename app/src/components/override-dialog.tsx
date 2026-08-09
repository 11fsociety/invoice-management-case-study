"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type Decision =
  | "APPROVED"
  | "FLAGGED_FOR_REVIEW"
  | "REJECTED"
  | "DUPLICATE";

type FormValues = {
  to_decision: Decision;
  reason: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  currentDecision: Decision;
  onSuccess?: () => void;
};

export function OverrideDialog({
  open,
  onOpenChange,
  runId,
  currentDecision,
  onSuccess,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      to_decision: currentDecision,
      reason: "",
    },
  });

  const currentTarget = watch("to_decision");

  async function onSubmit(values: FormValues): Promise<void> {
    if (values.to_decision === currentDecision) {
      toast.error("Choose a different target decision.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/runs/${runId}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        cache: "no-store",
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        toast.error("Override failed", {
          description:
            typeof detail === "object" && detail && "error" in detail
              ? String((detail as { error: string }).error)
              : `HTTP ${res.status}`,
        });
        return;
      }
      toast.success("Decision overridden");
      reset({ to_decision: values.to_decision, reason: "" });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error("Override failed", {
        description: (err as Error).message,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override decision</DialogTitle>
          <DialogDescription>
            Current decision: <strong>{currentDecision}</strong>. Provide a
            reason - it will be recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="to_decision">New decision</Label>
            <Select
              value={currentTarget}
              onValueChange={(v) =>
                setValue("to_decision", v as Decision, { shouldDirty: true })
              }
            >
              <SelectTrigger id="to_decision">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="APPROVED">APPROVED</SelectItem>
                <SelectItem value="FLAGGED_FOR_REVIEW">
                  FLAGGED_FOR_REVIEW
                </SelectItem>
                <SelectItem value="REJECTED">REJECTED</SelectItem>
                <SelectItem value="DUPLICATE">DUPLICATE</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reason">Reason (required)</Label>
            <Textarea
              id="reason"
              rows={4}
              placeholder="Why are you changing this decision?"
              {...register("reason", {
                required: "Reason is required",
                minLength: {
                  value: 3,
                  message: "Reason must be at least 3 characters",
                },
              })}
            />
            {errors.reason && (
              <p className="text-xs text-[var(--destructive)]">
                {errors.reason.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Save override"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
