import { RunsList } from "./runs-list";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <section className="space-y-6">
      <RunsList />
    </section>
  );
}
