import { UploadClient } from "./upload-client";

export const dynamic = "force-dynamic";

export default function UploadPage() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Upload</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Drop invoice PDFs and a PO spreadsheet. Each upload streams live-run
          progress below.
        </p>
      </div>
      <UploadClient />
    </section>
  );
}
