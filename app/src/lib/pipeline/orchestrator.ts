import { runExtraction } from "./extract";
import { runPass1 } from "./matcher";
import { runPass2Global } from "./dedupe";

const inflight = new Map<string, Promise<void>>();

/**
 * Kick off extraction -> pass1 -> pass2 for a run. Re-triggers on the same
 * runId return the existing in-flight promise so a page refresh doesn't
 * double-fire the pipeline.
 */
export function triggerPipeline(runId: string): Promise<void> {
  const existing = inflight.get(runId);
  if (existing) return existing;

  const p = (async () => {
    try {
      await runExtraction(runId);
      await runPass1(runId);
      await runPass2Global();
    } finally {
      inflight.delete(runId);
    }
  })();

  inflight.set(runId, p);
  return p;
}
