ALTER TABLE "invoice_extractions" ADD COLUMN IF NOT EXISTS "document_type" text;
--> statement-breakpoint
ALTER TABLE "invoice_extractions" ADD COLUMN IF NOT EXISTS "references_invoice_number" text;
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "cumulative_approved_amount" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "remaining_po_balance" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "item_match_score" numeric(4, 3);
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "document_type" text;
--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "credit_note_linked_run_id" uuid REFERENCES "invoice_runs"("id");
