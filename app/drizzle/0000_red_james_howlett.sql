CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"actor" uuid,
	"from_decision" text,
	"to_decision" text,
	"reason" text NOT NULL,
	"at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"pass1_decision" text NOT NULL,
	"final_decision" text NOT NULL,
	"reason" text,
	"matched_po_id" uuid,
	"amount_delta" numeric(14, 2),
	"amount_delta_pct" numeric(6, 3),
	"date_delta_days" integer,
	"vendor_match_score" numeric(4, 3),
	"currency_ok" boolean,
	"duplicate_of" uuid,
	"duplicate_confidence" numeric(4, 3),
	"decided_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoice_extractions" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"extracted_json" jsonb NOT NULL,
	"line_items_raw" text,
	"line_items" jsonb,
	"provider_used" text,
	"model_used" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"latency_ms" integer,
	"raw_response" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoice_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_size_bytes" bigint,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now(),
	"status" text DEFAULT 'received' NOT NULL,
	"extraction_mode" text
);
--> statement-breakpoint
CREATE TABLE "parameters" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"type" text NOT NULL,
	"format_hint" text,
	"required" boolean DEFAULT false,
	"active" boolean DEFAULT true,
	"is_predefined" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "parameters_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "po_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_number" text NOT NULL,
	"po_date" date NOT NULL,
	"vendor_name" text NOT NULL,
	"vendor_id" text,
	"po_amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'INR',
	"line_item_summary" text,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"created_by" uuid,
	CONSTRAINT "profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"region" text,
	"is_active" boolean DEFAULT false,
	"connection_ok" boolean,
	"last_checked" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_run_id_invoice_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."invoice_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_run_id_invoice_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."invoice_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_matched_po_id_po_rows_id_fk" FOREIGN KEY ("matched_po_id") REFERENCES "public"."po_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_duplicate_of_invoice_runs_id_fk" FOREIGN KEY ("duplicate_of") REFERENCES "public"."invoice_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_extractions" ADD CONSTRAINT "invoice_extractions_run_id_invoice_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."invoice_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_runs_uploaded_at_idx" ON "invoice_runs" USING btree ("uploaded_at");--> statement-breakpoint
CREATE INDEX "po_rows_po_number_idx" ON "po_rows" USING btree ("po_number");