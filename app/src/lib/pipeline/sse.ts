import { EventEmitter } from "node:events";

/**
 * In-memory per-run event bus for streaming pipeline progress via SSE.
 *
 * NOTE: In Vercel serverless the emitter cannot bridge invocations; on prod we
 * rely on client polling /api/runs/[id] every 1s. SSE works locally and on
 * long-running processes.
 */

type Listener = (event: string, data?: unknown) => void;

const bus = new EventEmitter();
bus.setMaxListeners(0);

function channel(runId: string) {
  return `run:${runId}`;
}

export function emit(runId: string, event: string, data?: unknown): void {
  bus.emit(channel(runId), event, data);
}

export function subscribe(runId: string, cb: Listener): () => void {
  const handler = (event: string, data?: unknown) => cb(event, data);
  bus.on(channel(runId), handler);
  return () => bus.off(channel(runId), handler);
}
