const SUFFIXES = /\b(private limited|pvt\.? ?ltd|ltd|llp|inc|gmbh|co\.?|corp|corporation)\b/gi;

export function normalizeVendorName(name: string | null | undefined): string {
  if (!name) return "";
  let s = name.toLowerCase().replace(SUFFIXES, "");
  s = s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

// Common vendor-id "namespace" prefixes we ignore for comparison.
const ID_PREFIX = /^(GST|GSTIN|PAN|VAT|TAX|VID|EIN|TIN|UEN|CIN)[-_ ]*/i;

export function normalizeVendorId(id: string | null | undefined): string | null {
  if (!id) return null;
  let s = id.toString().trim();
  // Strip common namespace prefixes ("GST-27..." -> "27...").
  s = s.replace(ID_PREFIX, "");
  s = s.toUpperCase().replace(/[\s\-_]/g, "");
  return s || null;
}
