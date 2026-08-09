import {
  pgTable, uuid, text, boolean, integer, bigint, numeric, timestamp, date, jsonb, index,
} from "drizzle-orm/pg-core";

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  createdBy: uuid("created_by"),
});

export const providers = pgTable("providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  modelId: text("model_id").notNull(),
  region: text("region"),
  isActive: boolean("is_active").default(false),
  connectionOk: boolean("connection_ok"),
  lastChecked: timestamp("last_checked", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const parameters = pgTable("parameters", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  type: text("type").notNull(),
  formatHint: text("format_hint"),
  required: boolean("required").default(false),
  active: boolean("active").default(true),
  isPredefined: boolean("is_predefined").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

export const poRows = pgTable("po_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  poNumber: text("po_number").notNull(),
  poDate: date("po_date").notNull(),
  vendorName: text("vendor_name").notNull(),
  vendorId: text("vendor_id"),
  poAmount: numeric("po_amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").default("INR"),
  lineItemSummary: text("line_item_summary"),
  uploadedBy: uuid("uploaded_by"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  poNumberIdx: index("po_rows_po_number_idx").on(t.poNumber),
}));

export const invoiceRuns = pgTable("invoice_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  storagePath: text("storage_path").notNull(),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  uploadedBy: uuid("uploaded_by"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow(),
  status: text("status").notNull().default("received"),
  extractionMode: text("extraction_mode"),
}, (t) => ({
  uploadedAtIdx: index("invoice_runs_uploaded_at_idx").on(t.uploadedAt),
}));

export const invoiceExtractions = pgTable("invoice_extractions", {
  runId: uuid("run_id").primaryKey().references(() => invoiceRuns.id, { onDelete: "cascade" }),
  extractedJson: jsonb("extracted_json").notNull(),
  lineItemsRaw: text("line_items_raw"),
  lineItems: jsonb("line_items"),
  documentType: text("document_type"),
  referencesInvoiceNumber: text("references_invoice_number"),
  providerUsed: text("provider_used"),
  modelUsed: text("model_used"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  latencyMs: integer("latency_ms"),
  rawResponse: text("raw_response"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const decisions = pgTable("decisions", {
  runId: uuid("run_id").primaryKey().references(() => invoiceRuns.id, { onDelete: "cascade" }),
  pass1Decision: text("pass1_decision").notNull(),
  finalDecision: text("final_decision").notNull(),
  reason: text("reason"),
  matchedPoId: uuid("matched_po_id").references(() => poRows.id),
  amountDelta: numeric("amount_delta", { precision: 14, scale: 2 }),
  amountDeltaPct: numeric("amount_delta_pct", { precision: 6, scale: 3 }),
  dateDeltaDays: integer("date_delta_days"),
  vendorMatchScore: numeric("vendor_match_score", { precision: 4, scale: 3 }),
  currencyOk: boolean("currency_ok"),
  duplicateOf: uuid("duplicate_of").references(() => invoiceRuns.id),
  duplicateConfidence: numeric("duplicate_confidence", { precision: 4, scale: 3 }),
  cumulativeApprovedAmount: numeric("cumulative_approved_amount", { precision: 14, scale: 2 }),
  remainingPoBalance: numeric("remaining_po_balance", { precision: 14, scale: 2 }),
  itemMatchScore: numeric("item_match_score", { precision: 4, scale: 3 }),
  documentType: text("document_type"),
  creditNoteLinkedRunId: uuid("credit_note_linked_run_id").references(() => invoiceRuns.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").references(() => invoiceRuns.id),
  actor: uuid("actor"),
  fromDecision: text("from_decision"),
  toDecision: text("to_decision"),
  reason: text("reason").notNull(),
  at: timestamp("at", { withTimezone: true }).defaultNow(),
});
