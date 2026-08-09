import { z, type ZodTypeAny } from "zod";
import { or, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { parameters } from "@/lib/db/schema";

export type ParameterRow = {
  id: string;
  name: string;
  displayName: string;
  type: string;
  formatHint: string | null;
  required: boolean | null;
  active: boolean | null;
  isPredefined: boolean | null;
};

type ExtractionSchema = z.ZodObject<Record<string, ZodTypeAny>>;

/**
 * Read the currently active parameters plus the always-included currency
 * parameter, then build a matching Zod object schema + a system prompt.
 */
export async function buildPrompt(): Promise<{
  system: string;
  zodSchema: ExtractionSchema;
  activeParamNames: string[];
  activeParams: ParameterRow[];
}> {
  const rows = (await db
    .select()
    .from(parameters)
    .where(or(eq(parameters.active, true), eq(parameters.name, "currency")))
    .orderBy(parameters.id)) as ParameterRow[];

  const shape: Record<string, ZodTypeAny> = {};
  const activeParamNames: string[] = [];
  const seen = new Set<string>();

  for (const p of rows) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    shape[p.name] = fieldForType(p.type);
    activeParamNames.push(p.name);
  }

  // Line items are always captured (audit-only).
  shape.line_items_raw = z.string().nullable();
  shape.line_items = z
    .array(
      z.object({
        description: z.string(),
        quantity: z.number().nullable(),
        rate: z.number().nullable(),
        amount: z.number().nullable(),
      })
    )
    .nullable();

  const zodSchema = z.object(shape) as ExtractionSchema;

  const descriptions = rows
    .map((p) => `- ${p.name}: ${p.formatHint ?? p.displayName}`)
    .join("\n");

  const system = [
    "You are an accounts-payable clerk. Extract the specified fields from the attached invoice document.",
    "Return only valid JSON matching the given schema.",
    "For any field not present in the invoice, return null (do not guess).",
    "Return line_items as structured objects; also return line_items_raw as the verbatim string of the line-item section from the invoice.",
    "Line items are captured for audit only in this system - they do not affect the decision.",
    "`invoice_total` should be the grand total payable including taxes.",
    "`currency` should be the 3-letter ISO code (INR, USD, EUR).",
    "Field descriptions:",
    descriptions,
  ].join("\n");

  return { system, zodSchema, activeParamNames, activeParams: rows };
}

function fieldForType(type: string): ZodTypeAny {
  switch (type) {
    case "string":
      return z.string().nullable();
    case "date":
      return z.string().nullable();
    case "currency":
      return z.number().nullable();
    case "number":
      return z.number().nullable();
    case "regex_match":
      return z.string().nullable();
    case "boolean":
      return z.boolean().nullable();
    default:
      return z.string().nullable();
  }
}
