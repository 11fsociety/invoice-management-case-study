export const ITEM_ALIASES: Record<string, string> = {
  "new kushaq": "kushaq",
  "kushak": "kushaq",
  "brake pad set": "brake pads",
  "front brake pads": "brake pads",
  "brake pad": "brake pads",
};

export function normalizeItemName(raw: string): string {
  let s = raw.toLowerCase().trim();
  // Strip a leading quantity prefix like "20x " or "40 x " (common in PO summaries).
  s = s.replace(/^\d+\s*x\s+/i, "");
  s = s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return ITEM_ALIASES[s] ?? s;
}

// tokenize -> jaccard
function jaccard(a: string, b: string): number {
  const A = new Set(normalizeItemName(a).split(" ").filter(Boolean));
  const B = new Set(normalizeItemName(b).split(" ").filter(Boolean));
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

export function itemSimilarity(a: string, b: string): number {
  const na = normalizeItemName(a), nb = normalizeItemName(b);
  if (!na && !nb) return 1;
  const lev = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length, 1);
  const jac = jaccard(a, b);
  return (lev + jac) / 2;
}

export function matchLineItems(
  invoiceItems: Array<{ description?: string | null }> | null | undefined,
  poLineItemSummary: string | null | undefined
): { score: number; pairs: Array<{ invoice: string; po: string; sim: number }> } {
  if (!invoiceItems?.length || !poLineItemSummary) return { score: 1, pairs: [] };
  const poItems = poLineItemSummary.split(";").map((x) => x.trim()).filter(Boolean);
  if (!poItems.length) return { score: 1, pairs: [] };
  const pairs: Array<{ invoice: string; po: string; sim: number }> = [];
  for (const inv of invoiceItems) {
    const invDesc = inv.description ?? "";
    if (!invDesc) continue;
    let best = { po: "", sim: 0 };
    for (const po of poItems) {
      const sim = itemSimilarity(invDesc, po);
      if (sim > best.sim) best = { po, sim };
    }
    pairs.push({ invoice: invDesc, po: best.po, sim: best.sim });
  }
  if (!pairs.length) return { score: 1, pairs: [] };
  const avg = pairs.reduce((s, p) => s + p.sim, 0) / pairs.length;
  return { score: avg, pairs };
}
