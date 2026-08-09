import { AnalyticsView } from "./analytics-view";

export const dynamic = "force-dynamic";

export default function AnalyticsPage() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Pipeline decisions, throughput, and extraction health.
        </p>
      </div>
      <AnalyticsView />
    </section>
  );
}
