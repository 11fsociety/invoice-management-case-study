"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Decision = "APPROVED" | "FLAGGED_FOR_REVIEW" | "REJECTED" | "DUPLICATE";

type AnalyticsPayload = {
  role: "admin" | "auditor";
  totalRuns: number;
  decisionsByBucket: Array<{ bucket: Decision; count: number }>;
  timeline: Array<{
    day: string;
    APPROVED: number;
    FLAGGED_FOR_REVIEW: number;
    REJECTED: number;
    DUPLICATE: number;
  }>;
  amountByVendor: Array<{ vendor_name: string; total: number }>;
  currencyBreakdown: Array<{ currency: string; count: number; total: number }>;
  latency: Array<{
    mode: "pdf";
    avg_ms: number;
    p95_ms: number;
    count: number;
  }>;
  toleranceHist: Array<{ bucket: string; count: number }>;
};

const COLORS: Record<Decision, string> = {
  APPROVED: "#16a34a",
  FLAGGED_FOR_REVIEW: "#f59e0b",
  REJECTED: "#dc2626",
  DUPLICATE: "#a855f7",
};

const NEUTRAL = "#6366f1";
const TOLERANCE_BAND = "#fde68a";

const CURRENCY_PALETTE = [
  "#6366f1",
  "#0ea5e9",
  "#14b8a6",
  "#f97316",
  "#ec4899",
  "#84cc16",
];

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function formatMs(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}s`;
  return `${v} ms`;
}

export function AnalyticsView(): React.ReactElement {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const res = await fetch("/api/analytics", { cache: "no-store" });
        if (!res.ok) {
          toast.error("Failed to load analytics");
          return;
        }
        const json = (await res.json()) as AnalyticsPayload;
        if (!cancelled) setData(json);
      } catch (err) {
        toast.error("Failed to load analytics", {
          description: (err as Error).message,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 text-sm text-[var(--muted-foreground)]">
        Loading analytics...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 text-sm text-[var(--muted-foreground)]">
        No analytics available.
      </div>
    );
  }

  const approved = data.decisionsByBucket.find((d) => d.bucket === "APPROVED");
  const approvedRate =
    data.totalRuns > 0 && approved
      ? (approved.count / data.totalRuns) * 100
      : 0;

  const latencyRows = data.latency.filter((l) => l.count > 0);
  const avgLatency =
    latencyRows.length > 0
      ? Math.round(
          latencyRows.reduce((a, b) => a + b.avg_ms * b.count, 0) /
            latencyRows.reduce((a, b) => a + b.count, 0)
        )
      : 0;

  const deltaWeighted = data.toleranceHist.reduce(
    (a, b) => a + b.count,
    0
  );
  const avgAbsDelta = (() => {
    // rough midpoint per bucket for a quick tile figure
    const mids: Record<string, number> = {
      "<-2": 2.5,
      "-2..-1": 1.5,
      "-1..0": 0.5,
      "0..1": 0.5,
      "1..2": 1.5,
      ">2": 2.5,
    };
    if (deltaWeighted === 0) return 0;
    const sum = data.toleranceHist.reduce(
      (a, b) => a + b.count * (mids[b.bucket] ?? 0),
      0
    );
    return sum / deltaWeighted;
  })();

  const pdfRow = data.latency.find((l) => l.mode === "pdf");
  const showLatencyEmptyChip = !pdfRow || pdfRow.count === 0;

  const decisionPieData = data.decisionsByBucket.map((d) => ({
    name: d.bucket,
    value: d.count,
  }));
  const totalDecisions = decisionPieData.reduce((a, b) => a + b.value, 0);

  const currencyPieData = data.currencyBreakdown.map((c) => ({
    name: c.currency,
    value: c.count,
  }));

  const latencyData = (["pdf"] as const).map((mode) => {
    const row = data.latency.find((l) => l.mode === mode);
    return {
      mode,
      avg_ms: row?.avg_ms ?? 0,
      p95_ms: row?.p95_ms ?? 0,
      count: row?.count ?? 0,
    };
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Total runs" value={String(data.totalRuns)} />
        <StatTile
          label="Approved rate"
          value={`${approvedRate.toFixed(1)}%`}
          accent="#16a34a"
        />
        <StatTile
          label="Avg extraction latency"
          value={formatMs(avgLatency)}
        />
        <StatTile
          label="Avg amount delta"
          value={`${avgAbsDelta.toFixed(2)}%`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Chart 1 - Decision breakdown pie */}
        <Card>
          <CardHeader>
            <CardTitle>Decision breakdown</CardTitle>
            <CardDescription>
              Final decisions across {data.totalRuns} runs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={decisionPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={95}
                    paddingAngle={2}
                    label={(entry: { name?: string; value?: number }) => {
                      const value = entry.value ?? 0;
                      if (totalDecisions === 0) return "";
                      const pct = ((value / totalDecisions) * 100).toFixed(0);
                      return `${value} (${pct}%)`;
                    }}
                    labelLine={false}
                  >
                    {decisionPieData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={COLORS[entry.name as Decision]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                  <text
                    x="50%"
                    y="50%"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-[var(--muted-foreground)] text-xs"
                  >
                    Decisions
                  </text>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Chart 2 - Decisions over time */}
        <Card>
          <CardHeader>
            <CardTitle>Decisions over time</CardTitle>
            <CardDescription>Stacked by outcome, per upload day.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.timeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="day" fontSize={11} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="APPROVED"
                    stackId="a"
                    fill={COLORS.APPROVED}
                  />
                  <Bar
                    dataKey="FLAGGED_FOR_REVIEW"
                    stackId="a"
                    fill={COLORS.FLAGGED_FOR_REVIEW}
                  />
                  <Bar
                    dataKey="REJECTED"
                    stackId="a"
                    fill={COLORS.REJECTED}
                  />
                  <Bar
                    dataKey="DUPLICATE"
                    stackId="a"
                    fill={COLORS.DUPLICATE}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Chart 3 - Amount by vendor */}
        <Card>
          <CardHeader>
            <CardTitle>Amount by vendor</CardTitle>
            <CardDescription>Top 8 vendors by invoice total.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.amountByVendor.map((v) => ({
                    ...v,
                    label: truncate(v.vendor_name, 20),
                  }))}
                  layout="vertical"
                  margin={{ left: 20, right: 16, top: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" fontSize={11} />
                  <YAxis
                    dataKey="label"
                    type="category"
                    width={140}
                    fontSize={11}
                  />
                  <Tooltip
                    formatter={(value) => Number(value).toLocaleString()}
                  />
                  <Bar dataKey="total" fill={NEUTRAL} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Chart 4 - Currency mix */}
        <Card>
          <CardHeader>
            <CardTitle>Currency mix</CardTitle>
            <CardDescription>Distribution of invoice currencies.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={currencyPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="40%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={95}
                    label={(entry: { value?: number }) => String(entry.value ?? 0)}
                    labelLine={false}
                  >
                    {currencyPieData.map((entry, i) => (
                      <Cell
                        key={entry.name}
                        fill={CURRENCY_PALETTE[i % CURRENCY_PALETTE.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend
                    layout="vertical"
                    align="right"
                    verticalAlign="middle"
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Chart 5 - Latency by mode */}
        <Card>
          <CardHeader>
            <CardTitle>Extraction latency</CardTitle>
            <CardDescription>
              Avg and p95 latency across all PDF runs.
              {showLatencyEmptyChip && (
                <span className="ml-2 inline-flex items-center rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
                  no runs yet
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={latencyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="mode" fontSize={11} />
                  <YAxis
                    fontSize={11}
                    tickFormatter={(v) => `${v}`}
                    label={{
                      value: "ms",
                      angle: -90,
                      position: "insideLeft",
                      fontSize: 11,
                    }}
                  />
                  <Tooltip formatter={(v) => `${Number(v)} ms`} />
                  <Legend />
                  <Bar dataKey="avg_ms" name="avg" fill={NEUTRAL} />
                  <Bar dataKey="p95_ms" name="p95" fill={COLORS.FLAGGED_FOR_REVIEW} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Chart 6 - Amount delta histogram */}
        <Card>
          <CardHeader>
            <CardTitle>Amount delta % distribution</CardTitle>
            <CardDescription>
              How far invoices land from PO amount. Shaded band is the ±2%
              tolerance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.toleranceHist}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="bucket" fontSize={11} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <ReferenceArea
                    x1="-2..-1"
                    x2="1..2"
                    fill={TOLERANCE_BAND}
                    fillOpacity={0.4}
                    ifOverflow="visible"
                  />
                  <Bar dataKey="count" fill={NEUTRAL} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </div>
      <div
        className="mt-2 text-2xl font-semibold"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
