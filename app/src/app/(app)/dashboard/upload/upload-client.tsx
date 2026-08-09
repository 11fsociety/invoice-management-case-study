"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, Sheet as SheetIcon, Upload as UploadIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LiveRunCard } from "@/components/live-run-card";

type Kind = "invoice" | "po";

type SignResp = {
  id: string;
  bucket: string;
  path: string;
  uploadUrl: string;
  token: string;
};

type InvoiceRun = {
  runId: string;
  filename: string;
};

type PoResult = {
  inserted: number;
};

async function signAndUpload(
  file: File,
  kind: Kind
): Promise<SignResp> {
  const contentType =
    kind === "invoice"
      ? "application/pdf"
      : file.name.endsWith(".csv")
        ? "text/csv"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  const signRes = await fetch("/api/uploads/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      kind,
      filename: file.name,
      size: file.size,
      contentType,
    }),
  });
  if (!signRes.ok) {
    const detail = await signRes.json().catch(() => ({}));
    throw new Error(
      typeof detail === "object" && detail && "error" in detail
        ? String((detail as { error: string }).error)
        : `sign failed (HTTP ${signRes.status})`
    );
  }
  const signed = (await signRes.json()) as SignResp;

  const putRes = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-upsert": "false",
    },
    body: file,
  });
  if (!putRes.ok) {
    const detail = await putRes.text().catch(() => "");
    throw new Error(`storage upload failed (${putRes.status}) ${detail}`);
  }
  return signed;
}

export function UploadClient() {
  const invoiceInputRef = useRef<HTMLInputElement | null>(null);
  const poInputRef = useRef<HTMLInputElement | null>(null);
  const [invoiceDrag, setInvoiceDrag] = useState(false);
  const [poDrag, setPoDrag] = useState(false);
  const [invoiceRuns, setInvoiceRuns] = useState<InvoiceRun[]>([]);
  const [poUploading, setPoUploading] = useState(false);

  async function handleInvoiceFiles(files: FileList | File[]): Promise<void> {
    const list = Array.from(files);
    for (const file of list) {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        toast.error(`Skipped ${file.name} (not a PDF)`);
        continue;
      }
      try {
        const signed = await signAndUpload(file, "invoice");
        const commitRes = await fetch("/api/uploads/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            kind: "invoice",
            id: signed.id,
            filename: file.name,
            path: signed.path,
            size: file.size,
          }),
        });
        if (!commitRes.ok) {
          const detail = await commitRes.json().catch(() => ({}));
          toast.error(`Commit failed for ${file.name}`, {
            description:
              typeof detail === "object" && detail && "error" in detail
                ? String((detail as { error: string }).error)
                : `HTTP ${commitRes.status}`,
          });
          continue;
        }
        const commit = (await commitRes.json()) as { run_id: string };
        setInvoiceRuns((prev) => [
          { runId: commit.run_id, filename: file.name },
          ...prev,
        ]);
      } catch (err) {
        toast.error(`Failed ${file.name}`, {
          description: (err as Error).message,
        });
      }
    }
  }

  async function handlePoFile(file: File): Promise<void> {
    const name = file.name.toLowerCase();
    if (!(name.endsWith(".xlsx") || name.endsWith(".csv"))) {
      toast.error("PO file must be .xlsx or .csv");
      return;
    }
    setPoUploading(true);
    try {
      const signed = await signAndUpload(file, "po");
      const commitRes = await fetch("/api/uploads/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          kind: "po",
          id: signed.id,
          filename: file.name,
          path: signed.path,
          size: file.size,
        }),
      });
      if (!commitRes.ok) {
        const detail = await commitRes.json().catch(() => ({}));
        toast.error("PO upload failed", {
          description:
            typeof detail === "object" && detail && "error" in detail
              ? String((detail as { error: string }).error)
              : `HTTP ${commitRes.status}`,
        });
        return;
      }
      const result = (await commitRes.json()) as PoResult;
      toast.success(`Uploaded and parsed ${result.inserted} rows`);
    } catch (err) {
      toast.error("PO upload failed", {
        description: (err as Error).message,
      });
    } finally {
      setPoUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card
          className={cn(
            "border-dashed transition-colors",
            invoiceDrag && "border-[var(--primary)] bg-[var(--muted)]"
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setInvoiceDrag(true);
          }}
          onDragLeave={() => setInvoiceDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setInvoiceDrag(false);
            void handleInvoiceFiles(e.dataTransfer.files);
          }}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              Invoice PDFs
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <UploadIcon className="h-8 w-8 text-[var(--muted-foreground)]" />
            <p className="text-sm text-[var(--muted-foreground)]">
              Drag PDFs here, or click to browse. Multiple files supported.
            </p>
            <Button
              onClick={() => invoiceInputRef.current?.click()}
              variant="outline"
              size="sm"
            >
              Select PDFs
            </Button>
            <input
              ref={invoiceInputRef}
              type="file"
              accept="application/pdf"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) {
                  void handleInvoiceFiles(e.target.files);
                  e.target.value = "";
                }
              }}
            />
          </CardContent>
        </Card>

        <Card
          className={cn(
            "border-dashed transition-colors",
            poDrag && "border-[var(--primary)] bg-[var(--muted)]"
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setPoDrag(true);
          }}
          onDragLeave={() => setPoDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setPoDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handlePoFile(f);
          }}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SheetIcon className="h-4 w-4" />
              PO spreadsheet
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <UploadIcon className="h-8 w-8 text-[var(--muted-foreground)]" />
            <p className="text-sm text-[var(--muted-foreground)]">
              Drop the PO master (.xlsx or .csv).
            </p>
            <Button
              onClick={() => poInputRef.current?.click()}
              variant="outline"
              size="sm"
              disabled={poUploading}
            >
              {poUploading ? "Uploading..." : "Select spreadsheet"}
            </Button>
            <input
              ref={poInputRef}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  void handlePoFile(f);
                  e.target.value = "";
                }
              }}
            />
          </CardContent>
        </Card>
      </div>

      {invoiceRuns.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Live runs</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {invoiceRuns.map((r) => (
              <LiveRunCard
                key={r.runId}
                runId={r.runId}
                filename={r.filename}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
