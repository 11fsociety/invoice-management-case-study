import { NextResponse } from "next/server";
import { subscribe } from "@/lib/pipeline/sse";
import { createClient } from "@/lib/supabase/server";
import { checkRunOwnership } from "@/lib/auth/ownership";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ownership = await checkRunOwnership(id, user.id);
  if (ownership === "not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (ownership === "forbidden") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data?: unknown) => {
        try {
          const payload =
            data === undefined ? "{}" : JSON.stringify(data);
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${payload}\n\n`)
          );
        } catch {
          // stream closed
        }
      };

      send("ready", { runId: id });

      const unsub = subscribe(id, (event, data) => send(event, data));

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`event: keepalive\ndata: {}\n\n`));
        } catch {
          // stream closed
        }
      }, 15_000);

      const abort = () => {
        clearInterval(keepalive);
        unsub();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener("abort", abort);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
