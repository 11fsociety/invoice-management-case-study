"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Parameter = {
  id: string;
  name: string;
  displayName: string;
  type: string;
  formatHint: string | null;
  required: boolean | null;
  active: boolean | null;
  isPredefined: boolean | null;
  createdAt: string | null;
};

type AddMode = "predefined" | "custom";

type AddValues = {
  raw_name: string;
  raw_description: string;
};

export function ParametersTab() {
  const [params, setParams] = useState<Parameter[]>([]);
  const [tolerance, setTolerance] = useState<number>(2.0);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("predefined");
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddValues>({
    defaultValues: { raw_name: "", raw_description: "" },
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, tRes] = await Promise.all([
        fetch("/api/parameters", { cache: "no-store" }),
        fetch("/api/settings/tolerance", { cache: "no-store" }),
      ]);
      if (!pRes.ok) {
        toast.error("Failed to load parameters");
      } else {
        const data = (await pRes.json()) as { parameters: Parameter[] };
        setParams(data.parameters);
      }
      if (tRes.ok) {
        const data = (await tRes.json()) as { tolerance_pct: number };
        setTolerance(data.tolerance_pct);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(id: string, active: boolean): Promise<void> {
    // Optimistic update.
    setParams((prev) =>
      prev.map((p) => (p.id === id ? { ...p, active } : p))
    );
    try {
      const res = await fetch("/api/parameters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active }),
        cache: "no-store",
      });
      if (!res.ok) {
        toast.error("Failed to update parameter");
        await load();
      }
    } catch (err) {
      toast.error("Failed to update parameter", {
        description: (err as Error).message,
      });
      await load();
    }
  }

  const toleranceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleToleranceSave(next: number): void {
    if (toleranceTimer.current) clearTimeout(toleranceTimer.current);
    toleranceTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/settings/tolerance", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tolerance_pct: next }),
            cache: "no-store",
          });
          if (!res.ok) {
            toast.error("Failed to save tolerance");
          } else {
            toast.success("Tolerance saved");
          }
        } catch (err) {
          toast.error("Failed to save tolerance", {
            description: (err as Error).message,
          });
        }
      })();
    }, 500);
  }

  async function onAddCustom(values: AddValues): Promise<void> {
    setSubmitting(true);
    try {
      const res = await fetch("/api/parameters/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        cache: "no-store",
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        toast.error("Refine failed", {
          description:
            typeof detail === "object" && detail && "detail" in detail
              ? String((detail as { detail: string }).detail)
              : `HTTP ${res.status}`,
        });
        return;
      }
      toast.success("Custom parameter added");
      reset({ raw_name: "", raw_description: "" });
      setDialogOpen(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = params.filter((p) => {
    if (p.isPredefined && p.active === false && p.name === "currency") return false;
    return true;
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Parameters</CardTitle>
          <p className="text-sm text-[var(--muted-foreground)]">
            Fields the extractor should pull from each invoice.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Add parameter
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Display name</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Format hint</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Extras</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && params.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-[var(--muted-foreground)]">
                  Loading...
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.displayName}</TableCell>
                  <TableCell className="font-mono text-xs">{p.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.type}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate text-xs text-[var(--muted-foreground)]">
                    {p.formatHint ?? "-"}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={p.active === true}
                      onCheckedChange={(v) => void toggleActive(p.id, v)}
                    />
                  </TableCell>
                  <TableCell>
                    {p.name === "invoice_total" && (
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor="tolerance"
                          className="whitespace-nowrap text-xs"
                        >
                          % tolerance
                        </Label>
                        <Input
                          id="tolerance"
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          className="w-24"
                          value={tolerance}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (!Number.isFinite(v)) return;
                            setTolerance(v);
                            if (v >= 0 && v <= 100) {
                              scheduleToleranceSave(v);
                            }
                          }}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v) && v >= 0 && v <= 100) {
                              if (toleranceTimer.current) {
                                clearTimeout(toleranceTimer.current);
                                toleranceTimer.current = null;
                              }
                              void fetch("/api/settings/tolerance", {
                                method: "PUT",
                                headers: {
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({ tolerance_pct: v }),
                                cache: "no-store",
                              }).catch(() => {});
                            }
                          }}
                        />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog
        open={dialogOpen}
        onOpenChange={(v) => {
          setDialogOpen(v);
          if (!v) setAddMode("predefined");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add parameter</DialogTitle>
            <DialogDescription>
              Choose a predefined parameter or design a custom one.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select
                value={addMode}
                onValueChange={(v) => setAddMode(v as AddMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="predefined">Predefined</SelectItem>
                  <SelectItem value="custom">Custom (LLM refined)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {addMode === "predefined" ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                All predefined parameters are already loaded in the table
                above. Toggle Active to include them in the extraction schema.
              </p>
            ) : (
              <form
                onSubmit={handleSubmit(onAddCustom)}
                className="space-y-3"
                id="add-custom-form"
              >
                <div className="space-y-2">
                  <Label htmlFor="raw_name">Raw name</Label>
                  <Input
                    id="raw_name"
                    placeholder="gst_number"
                    {...register("raw_name", {
                      required: "Required",
                    })}
                  />
                  {errors.raw_name && (
                    <p className="text-xs text-[var(--destructive)]">
                      {errors.raw_name.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="raw_description">Description</Label>
                  <Textarea
                    id="raw_description"
                    rows={4}
                    placeholder="Check the GST is a 15-character alphanumeric code..."
                    {...register("raw_description", {
                      required: "Required",
                    })}
                  />
                  {errors.raw_description && (
                    <p className="text-xs text-[var(--destructive)]">
                      {errors.raw_description.message}
                    </p>
                  )}
                </div>
              </form>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            {addMode === "custom" && (
              <Button
                type="submit"
                form="add-custom-form"
                disabled={submitting}
              >
                {submitting ? "Refining..." : "Add"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
